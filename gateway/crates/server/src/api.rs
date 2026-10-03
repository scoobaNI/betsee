use crate::{
    MODEL_LABEL,
    auth::Claims,
    connectors::action_hash,
    pipeline::{ActionRequest, Gateway, STAGES, agent_ref, append_span, summary, tier, tier_rank},
    store::{find_entity, now, text},
};
use axum::{
    Extension, Json, Router,
    extract::{Path, Request, State},
    http::{HeaderMap, Method, StatusCode},
    middleware::{self, Next},
    response::{
        IntoResponse, Response, Sse,
        sse::{Event, KeepAlive},
    },
    routing::{get, post},
};
use betsee_decision::{effective, entity_ref, uid};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use std::{collections::BTreeSet, convert::Infallible, sync::Arc, time::Duration};
use tokio_stream::wrappers::ReceiverStream;

#[derive(Clone)]
pub struct Correlation(pub String);

pub struct ApiError {
    status: StatusCode,
    message: String,
    trace_id: String,
}
impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>, trace_id: &str) -> Self {
        Self {
            status,
            message: message.into(),
            trace_id: trace_id.into(),
        }
    }
    fn unavailable(error: anyhow::Error, trace_id: &str) -> Self {
        tracing::error!(%error,trace_id,"gateway dependency failed");
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Gateway dependency unavailable; action not authorized",
            trace_id,
        )
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status,Json(json!({"error":self.status.as_str(),"message":self.message,"trace_id":self.trace_id}))).into_response()
    }
}
type ApiResult = Result<Json<Value>, ApiError>;
pub fn router(gateway: Arc<Gateway>) -> Router {
    let api = Router::new()
        .route("/api/v1/me", get(me))
        .route("/api/v1/agents", get(agents))
        .route("/api/v1/agents/{id}/release", post(release_agent))
        .route("/api/v1/use-cases", get(use_cases))
        .route("/api/v1/sessions", get(sessions).post(create_session))
        .route("/api/v1/sessions/{id}", get(session))
        .route("/api/v1/sessions/{id}/end", post(end_session))
        .route("/api/v1/actions", post(action))
        .route("/api/v1/actions/{id}", get(action_status))
        .route("/api/v1/chat/inputs", post(chat_input))
        .route("/api/v1/traces", get(traces))
        .route("/api/v1/traces/{id}", get(trace))
        .route("/api/v1/approvals", get(approvals))
        .route("/api/v1/approvals/{id}/approve", post(approve))
        .route("/api/v1/approvals/{id}/reject", post(reject))
        .route("/api/v1/controls", get(controls))
        .route(
            "/api/v1/controls/attachments",
            get(attachments).post(attach_control),
        )
        .route("/api/v1/policies", get(policies))
        .route("/api/v1/policies/{id}", get(policy))
        .route("/api/v1/connectors", get(connectors))
        .route("/api/v1/agent-messages", get(messages).post(send_message))
        .route("/api/v1/coverage", get(coverage))
        .route("/api/v1/security-events", get(security_events))
        .route("/api/v1/summary", get(overview))
        .route("/api/v1/events/stream", get(events))
        .layer(middleware::from_fn_with_state(
            gateway.clone(),
            authenticate,
        ));
    Router::new()
        .merge(api)
        .route("/healthz", get(health))
        .layer(axum::extract::DefaultBodyLimit::max(256 * 1024))
        .layer(middleware::from_fn(correlate))
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(gateway)
}

pub fn incoming_trace(headers: &HeaderMap) -> String {
    if let Some(value) = headers.get("traceparent").and_then(|v| v.to_str().ok()) {
        let pieces: Vec<_> = value.split('-').collect();
        if pieces.len() == 4
            && pieces[0] == "00"
            && pieces[1].len() == 32
            && pieces[2].len() == 16
            && pieces[3].len() == 2
            && pieces
                .iter()
                .all(|part| part.bytes().all(|b| b.is_ascii_hexdigit()))
            && pieces[1] != "00000000000000000000000000000000"
            && pieces[2] != "0000000000000000"
        {
            return pieces[1].to_lowercase();
        }
    }
    if let Some(value) = headers.get("x-request-id").and_then(|v| v.to_str().ok())
        && !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        return value.into();
    }
    uuid::Uuid::new_v4().simple().to_string()
}
async fn correlate(mut request: Request, next: Next) -> Response {
    let id = incoming_trace(request.headers());
    request.extensions_mut().insert(Correlation(id.clone()));
    let mut response = next.run(request).await;
    if let Ok(value) = id.parse() {
        response.headers_mut().insert("x-request-id", value);
    }
    response
}
async fn authenticate(
    State(gateway): State<Arc<Gateway>>,
    mut request: Request,
    next: Next,
) -> Response {
    let trace_id = request
        .extensions()
        .get::<Correlation>()
        .map(|id| id.0.clone())
        .unwrap_or_default();
    let claims = match gateway.auth.verify(request.headers()).await {
        Ok(claims) => claims,
        Err(error) => {
            if let Err(store_error) = gateway
                .security(
                    "token_rejected",
                    "medium",
                    &trace_id,
                    "Token verification failed",
                    json!({"path":request.uri().path(),"reason":error.to_string()}),
                )
                .await
            {
                tracing::error!(%store_error,"token rejection evidence unavailable");
            }
            return ApiError::new(
                StatusCode::UNAUTHORIZED,
                "Missing or invalid token",
                &trace_id,
            )
            .into_response();
        }
    };
    let agent_route = (request.method() == Method::POST
        && matches!(
            request.uri().path(),
            "/api/v1/actions" | "/api/v1/agent-messages"
        ))
        || (request.method() == Method::GET
            && request.uri().path().starts_with("/api/v1/actions/"));
    let allow_runner = request.method() == Method::GET
        || (request.method() == Method::POST && request.uri().path() == "/api/v1/sessions");
    if agent_route {
        if !claims.agent() || !request.headers().contains_key("authorization") {
            return ApiError::new(StatusCode::FORBIDDEN, "Agent bearer required", &trace_id)
                .into_response();
        }
    } else {
        match gateway
            .auth
            .human(&claims, &gateway.store, allow_runner)
            .await
        {
            Ok(human) => {
                request.extensions_mut().insert(Human(human));
            }
            Err(_) => {
                return ApiError::new(
                    StatusCode::FORBIDDEN,
                    "Human principal not permitted on this route",
                    &trace_id,
                )
                .into_response();
            }
        }
    }
    request.extensions_mut().insert(claims);
    next.run(request).await
}
#[derive(Clone)]
struct Human(Value);
fn privileged(claims: &Claims) -> bool {
    claims.role("org-admin") || claims.role("security-officer")
}
fn can_read(claims: &Claims, record: &Value) -> bool {
    privileged(claims) || record["human"]["sub"] == claims.sub
}
fn require_admin(claims: &Claims, trace_id: &str) -> Result<(), ApiError> {
    if !claims.browser() || !(claims.role("org-admin") || claims.role("security-officer")) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Administrator or security officer required",
            trace_id,
        ));
    }
    Ok(())
}
async fn health(State(gateway): State<Arc<Gateway>>) -> ApiResult {
    sqlx::query("SELECT 1")
        .execute(&gateway.store.pool)
        .await
        .map_err(|e| ApiError::unavailable(e.into(), "health"))?;
    Ok(Json(
        json!({"status":"ok","service":"betsee-gateway","policy_engine":"Cedar 4.13","model_label":MODEL_LABEL}),
    ))
}
async fn me(Extension(claims): Extension<Claims>, Extension(human): Extension<Human>) -> ApiResult {
    Ok(Json(
        json!({"human":{"sub":human.0["sub"],"display_name":human.0["display_name"]},"roles":claims.realm_access["roles"],"organization":{"id":"acme","name":"Acme Logistics"},"acr":claims.acr}),
    ))
}
async fn agents(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
) -> ApiResult {
    let entities = gateway
        .store
        .entities()
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let sessions = gateway
        .store
        .list("session")
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let states = gateway
        .store
        .list("agent_state")
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let items:Vec<_>=entities.as_array().unwrap().iter().filter(|e|e["uid"]["type"]=="Betsee::Agent").map(|entity|{
        let agent_id=text(&entity["uid"],"id");
        let session=sessions.iter().find(|s|s["agent_id"]==agent_id&&s["status"]=="active"&&can_read(&claims,s));
        let state=states.iter().find(|s|s["agent_id"]==agent_id);
        json!({"id":agent_id,"name":agent_id,"team":entity["parents"][0]["id"],"provider":MODEL_LABEL,"model":"mock-model-demo","state":entity["attrs"]["state"],"state_reason":state.map(|s|s["reason"].clone()),"state_changed_at":state.map(|s|s["occurred_at"].clone()),"current_session":session,"budget":session.map(|s|s["budget"].clone()).unwrap_or(json!({"limit":2000,"used":0,"unit":"cents"}))})
    }).collect();
    Ok(Json(json!({"items":items})))
}
async fn use_cases(
    State(gateway): State<Arc<Gateway>>,
    Extension(id): Extension<Correlation>,
) -> ApiResult {
    let entities = gateway
        .store
        .entities()
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let items:Vec<_>=entities.as_array().unwrap().iter().filter(|e|e["uid"]["type"]=="Betsee::UseCase").map(|entity|{
        let attrs=&entity["attrs"];let id=text(&entity["uid"],"id");
        json!({"id":id,"name":use_case_name(id),"permitted":refs(&attrs["permitted"]),"tier_ceiling":tier(attrs["tierCeiling"].as_i64().unwrap_or(0)),"approval_required":refs(&attrs["approvalRequired"]),"step_up_required":refs(&attrs["stepUpRequired"]),"approval_threshold_cents":attrs["approvalThresholdCents"],"budget":{"limit":if id=="weekly-reporting" {2000} else {5000},"used":0,"unit":"cents"},"agent_ids":refs(&attrs["agents"]),"peer_ids":refs(&attrs["peers"])})
    }).collect();
    Ok(Json(json!({"items":items})))
}
fn use_case_name(id: &str) -> &str {
    match id {
        "invoice-processing" => "Invoice processing",
        "ticket-triage" => "Ticket triage",
        "market-research" => "Market research",
        "deployment-helper" => "Deployment helper",
        "weekly-reporting" => "Weekly reporting",
        "regression-a2a-sender" => "A2A sender (test-only)",
        "regression-a2a-receiver" => "A2A receiver (test-only)",
        "employee-assistance" => "Employee assistance",
        _ => id,
    }
}
fn refs(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v["__entity"]["id"].as_str().map(str::to_owned))
        .collect()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateSession {
    agent_id: String,
    use_case_id: String,
    delegated: Vec<String>,
    tier_ceiling: String,
    budget_cents: Option<i64>,
}
async fn create_session(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(human): Extension<Human>,
    Extension(id): Extension<Correlation>,
    Json(body): Json<CreateSession>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let _gate = gateway.action_gate.lock().await;
    let rank = tier_rank(&body.tier_ceiling)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Invalid information tier", &id.0))?;
    let budget = body
        .budget_cents
        .unwrap_or(if body.use_case_id == "weekly-reporting" {
            2000
        } else {
            5000
        });
    if !(1..=5000).contains(&budget) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Demo session budget must be between 1 and 5000 cents",
            &id.0,
        ));
    }
    let entities = gateway
        .store
        .entities()
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let use_case = find_entity(&entities, "UseCase", &body.use_case_id)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Unknown use case", &id.0))?;
    let human_id = text(&human.0, "username");
    let context = json!({"useCase":entity_ref("UseCase",&body.use_case_id),"delegated":body.delegated.iter().map(|cap|entity_ref("Capability",cap)).collect::<Vec<_>>(),"tierCeiling":rank});
    let engine = gateway
        .engine()
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let outcome = engine.evaluate(
        &uid("Human", human_id),
        &uid("Action", "session.create"),
        &uid("Agent", &body.agent_id),
        entities.clone(),
        context,
    );
    if outcome.decision() != "allow" {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            format!(
                "Delegation denied: {} ({})",
                outcome.reasons.into_iter().collect::<Vec<_>>().join(", "),
                outcome
                    .control_ids
                    .into_iter()
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            &id.0,
        ));
    }
    let session_id = uuid::Uuid::new_v4().to_string();
    let expires = Utc::now() + chrono::Duration::hours(2);
    let session = json!({"id":session_id,"human":{"sub":claims.sub,"display_name":human.0["display_name"]},"agent_id":body.agent_id,"use_case":{"id":body.use_case_id,"name":use_case_name(&body.use_case_id)},"delegated":body.delegated,"effective":effective(&body.delegated,&refs(&use_case["attrs"]["permitted"])),"tier_ceiling":body.tier_ceiling,"budget":{"limit":budget,"used":0,"unit":"cents"},"approval_state":"none","status":"active","started_at":now(),"expires_at":expires.to_rfc3339()});
    let entity = json!({"uid":{"type":"Betsee::AgentSession","id":session_id},"attrs":{"human":entity_ref("Human",human_id),"agent":entity_ref("Agent",&body.agent_id),"useCase":entity_ref("UseCase",&body.use_case_id),"delegated":body.delegated.iter().map(|cap|entity_ref("Capability",cap)).collect::<Vec<_>>(),"tierCeiling":rank,"taint":0,"untrustedInput":false,"status":"active","expiresAt":expires.timestamp(),"budgetCents":budget,"spentCents":0},"parents":[]});
    gateway
        .store
        .put_entity(&entity)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    gateway
        .store
        .put("session", &session_id, &session)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    gateway
        .store
        .event("session.started", Some(&id.0), &session)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    Ok((StatusCode::CREATED, Json(session)))
}
async fn sessions(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
) -> ApiResult {
    let items: Vec<_> = gateway
        .store
        .list("session")
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .into_iter()
        .filter(|s| can_read(&claims, s))
        .collect();
    Ok(Json(json!({"items":items})))
}
async fn session(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
    Path(session_id): Path<String>,
) -> ApiResult {
    let session = gateway
        .store
        .get("session", &session_id)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .filter(|s| can_read(&claims, s))
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Session not found", &id.0))?;
    Ok(Json(session))
}
async fn end_session(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
    Path(session_id): Path<String>,
) -> ApiResult {
    let _gate = gateway.action_gate.lock().await;
    let mut session = gateway
        .store
        .get("session", &session_id)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .filter(|s| can_read(&claims, s))
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Session not found", &id.0))?;
    session["status"] = json!("closed");
    let entities = gateway
        .store
        .entities()
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let mut entity = find_entity(&entities, "AgentSession", &session_id)
        .cloned()
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Session entity missing", &id.0))?;
    entity["attrs"]["status"] = json!("closed");
    gateway
        .store
        .put_entity(&entity)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    gateway
        .store
        .put("session", &session_id, &session)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    for mut approval in gateway
        .store
        .list("approval")
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
    {
        if approval["state"] == "pending" && approval["request"]["session_id"] == session_id {
            approval["state"] = json!("voided");
            approval["decided_at"] = json!(now());
            gateway
                .store
                .put("approval", text(&approval, "id"), &approval)
                .await
                .map_err(|e| ApiError::unavailable(e, &id.0))?;
            // The approval's trace still read approval_state "pending", so trace consumers
            // (the Director feed and its awaiting-human count) saw a human still awaited on a
            // session that has ended. Mark the trace voided and emit action.updated so every
            // consumer stays true; a later run's audit suite voids approvals on every pass.
            let trace_id = text(&approval, "trace_id").to_owned();
            if let Some(mut trace) = gateway
                .store
                .get("trace", &trace_id)
                .await
                .map_err(|e| ApiError::unavailable(e, &id.0))?
            {
                trace["approval_state"] = json!("voided");
                gateway
                    .store
                    .audit(&trace, "voided", Some("action.updated"))
                    .await
                    .map_err(|e| ApiError::unavailable(e, &id.0))?;
            }
        }
    }
    gateway
        .store
        .event("session.ended", Some(&id.0), &session)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    Ok(Json(session))
}
async fn action(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
    Json(body): Json<ActionRequest>,
) -> ApiResult {
    if !body.parameters.is_object() || tier_rank(&body.resource.tier).is_none() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Object parameters and valid tier required",
            &id.0,
        ));
    }
    let _gate = gateway.action_gate.lock().await;
    let trace = gateway
        .decide_action(&claims, body, &id.0, false, false, None)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let mut response = summary(&trace);
    if trace["policy_ids"].as_array().is_some_and(|policies| {
        policies
            .iter()
            .any(|policy| policy == "forbid-session-not-bound-to-agent")
    }) {
        let map = response.as_object_mut().unwrap();
        map.remove("human");
        map.remove("use_case");
        map.remove("session_id");
    }
    Ok(Json(response))
}
/// An agent polls the decision on its own action, e.g. while a human approval is pending.
async fn action_status(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
    Path(trace_id): Path<String>,
) -> ApiResult {
    let trace = gateway
        .store
        .get("trace", &trace_id)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .filter(|trace| trace["agent"]["id"] == claims.azp && trace["record_type"].is_null())
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Action not found", &id.0))?;
    Ok(Json(summary(&trace)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChatInput {
    session_id: String,
    text: String,
}

/// CTL-IN-001: text a human types to their session's agent, checked before any model sees it.
async fn chat_input(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(human): Extension<Human>,
    Extension(id): Extension<Correlation>,
    Json(body): Json<ChatInput>,
) -> ApiResult {
    if body.text.trim().is_empty() || body.text.chars().count() > 8000 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Message must be 1 to 8000 characters",
            &id.0,
        ));
    }
    let session = gateway
        .store
        .get("session", &body.session_id)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .filter(|session| can_read(&claims, session))
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Session not found", &id.0))?;
    gateway
        .check_input(&claims, &human.0, &session, &body.text, &id.0)
        .await
        .map(|trace| Json(summary(&trace)))
        .map_err(|e| ApiError::unavailable(e, &id.0))
}

async fn traces(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
) -> ApiResult {
    let items: Vec<_> = gateway
        .store
        .list("trace")
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .into_iter()
        .filter(|trace| can_read(&claims, trace))
        .take(200)
        .map(|trace| summary(&trace))
        .collect();
    Ok(Json(json!({"items":items})))
}
async fn trace(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
    Path(trace_id): Path<String>,
) -> ApiResult {
    let trace = gateway
        .store
        .get("trace", &trace_id)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .filter(|trace| can_read(&claims, trace))
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Trace not found", &id.0))?;
    Ok(Json(trace))
}
async fn approvals(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
) -> ApiResult {
    let approvals = gateway
        .store
        .list("approval")
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .into_iter()
        .filter(|approval| claims.role("approver") || can_read(&claims, &approval["action"]));
    let mut items = Vec::new();
    for mut approval in approvals {
        if approval.get("requested_reasons").is_none()
            && let Some(reasons) = gateway
                .store
                .approval_requested_reasons(text(&approval, "trace_id"))
                .await
                .map_err(|e| ApiError::unavailable(e, &id.0))?
        {
            approval["requested_reasons"] = reasons;
        }
        if approval.get("approver_acr").is_none()
            && matches!(approval["state"].as_str(), Some("approved" | "rejected"))
            && let Some(trace) = gateway
                .store
                .get("trace", text(&approval, "trace_id"))
                .await
                .map_err(|e| ApiError::unavailable(e, &id.0))?
            && let Some(acr) = recorded_approver_acr(&approval, &trace)
        {
            approval["approver_acr"] = json!(acr);
        }
        approval.as_object_mut().unwrap().remove("request");
        items.push(approval);
    }
    Ok(Json(json!({"items":items})))
}
fn recorded_approver_acr<'a>(approval: &Value, trace: &'a Value) -> Option<&'a str> {
    let approver_sub = approval["approver"]["sub"].as_str()?;
    trace["spans"].as_array()?.iter().rev().find_map(|span| {
        (matches!(span["stage"].as_str(), Some("approval" | "step_up"))
            && matches!(span["status"].as_str(), Some("passed" | "denied"))
            && span["attributes"]["approver_sub"] == approver_sub)
            .then(|| span["attributes"]["acr"].as_str())
            .flatten()
    })
}
async fn approve(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(human): Extension<Human>,
    Extension(id): Extension<Correlation>,
    Path(approval_id): Path<String>,
) -> ApiResult {
    let _gate = gateway.action_gate.lock().await;
    if !claims.role("approver") {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Approver role required",
            &id.0,
        ));
    }
    let mut approval = gateway
        .store
        .get("approval", &approval_id)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Approval not found", &id.0))?;
    if approval["action"]["human"]["sub"] == claims.sub {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Four-eyes requires a different human",
            &id.0,
        ));
    }
    if approval["state"] != "pending" {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Approval already resolved or execution may have started",
            &id.0,
        ));
    }
    let trace_id = text(&approval, "trace_id").to_owned();
    let mut previous = gateway
        .store
        .get("trace", &trace_id)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Bound trace missing", &id.0))?;
    let attributes = json!({"approver_sub":claims.sub,"approver_name":human.0["display_name"],"decided_at":now(),"acr":claims.acr});
    if approval["requires_step_up"] == true && !claims.fresh_step_up() {
        append_span(
            &mut previous,
            "step_up",
            "pending",
            "Fresh acr=2 and approver proof required",
            attributes,
            0.0,
        );
        gateway
            .store
            .audit(&previous, "step_up_pending", Some("action.updated"))
            .await
            .map_err(|e| ApiError::unavailable(e, &id.0))?;
        gateway
            .security(
                "step_up_failed",
                "medium",
                &trace_id,
                "Approval awaits fresh OTP proof",
                json!({"approver_sub":claims.sub,"acr":claims.acr}),
            )
            .await
            .map_err(|e| ApiError::unavailable(e, &id.0))?;
        return Ok(Json(
            json!({"status":"step_up_required","trace_id":trace_id,"approval_id":approval_id,"acr_values":"2","action":summary(&previous)}),
        ));
    }
    let mut request: ActionRequest = serde_json::from_value(approval["request"].clone())
        .map_err(|_| ApiError::new(StatusCode::CONFLICT, "Invalid stored action", &id.0))?;
    if action_hash(&serde_json::to_value(&request).unwrap()) != approval["action_hash"] {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Stored action hash mismatch",
            &id.0,
        ));
    }
    request.mediated = approval["origin"] == "agent_message";
    approval["state"] = json!("executing");
    approval["approver"] = json!({"sub":claims.sub,"display_name":human.0["display_name"]});
    approval["approver_acr"] = json!(claims.acr);
    approval["decided_at"] = json!(now());
    gateway
        .store
        .put("approval", &approval_id, &approval)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let mut agent_claims = claims.clone();
    agent_claims.azp = text(&previous["agent"], "id").to_owned();
    agent_claims.agent_id = Some(agent_claims.azp.clone());
    agent_claims.sub = previous["spans"]
        .as_array()
        .and_then(|spans| spans.iter().find(|span| span["stage"] == "authenticate"))
        .and_then(|span| span["attributes"]["sub"].as_str())
        .unwrap_or("bound-agent")
        .to_owned();
    agent_claims.realm_access = json!({"roles":[]});
    agent_claims.acr.clear();
    agent_claims.auth_time = None;
    agent_claims.authentication_timing = None;
    let mut result = gateway
        .decide_action(
            &agent_claims,
            request,
            &trace_id,
            true,
            claims.fresh_step_up(),
            Some(previous),
        )
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    if let Some(spans) = result["spans"].as_array_mut() {
        for span in spans {
            if matches!(span["stage"].as_str(), Some("approval" | "step_up")) {
                span["attributes"] = attributes.clone();
            }
        }
    }
    approval["state"] = json!(if result["executed"] == true {
        "approved"
    } else {
        "rejected"
    });
    approval["action"] = summary(&result);
    result["approval_state"] = approval["state"].clone();
    gateway
        .store
        .put("approval", &approval_id, &approval)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    gateway
        .store
        .audit(&result, "approval_resolved", Some("action.updated"))
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    Ok(Json(
        json!({"status":approval["state"],"trace_id":trace_id,"approval_id":approval_id,"acr_values":null,"action":summary(&result)}),
    ))
}
async fn reject(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(human): Extension<Human>,
    Extension(id): Extension<Correlation>,
    Path(approval_id): Path<String>,
) -> ApiResult {
    let _gate = gateway.action_gate.lock().await;
    if !claims.role("approver") {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Approver required",
            &id.0,
        ));
    }
    let mut approval = gateway
        .store
        .get("approval", &approval_id)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Approval not found", &id.0))?;
    if approval["state"] != "pending" {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Approval already resolved",
            &id.0,
        ));
    }
    let trace_id = text(&approval, "trace_id").to_owned();
    let mut trace = gateway
        .store
        .get("trace", &trace_id)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Trace missing", &id.0))?;
    approval["state"] = json!("rejected");
    approval["decided_at"] = json!(now());
    approval["approver"] = json!({"sub":claims.sub,"display_name":human.0["display_name"]});
    approval["approver_acr"] = json!(claims.acr);
    trace["decision"] = json!("deny");
    trace["approval_state"] = json!("rejected");
    trace["reasons"]
        .as_array_mut()
        .unwrap()
        .push(json!("Human rejected the exact action"));
    append_span(
        &mut trace,
        "approval",
        "denied",
        "Human rejected exact action",
        json!({"approver_sub":claims.sub,"approver_name":human.0["display_name"],"decided_at":now(),"acr":claims.acr}),
        0.0,
    );
    gateway
        .store
        .put("approval", &approval_id, &approval)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    gateway
        .store
        .audit(&trace, "approval_rejected", Some("action.updated"))
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    gateway
        .security(
            "approval_rejected",
            "info",
            &trace_id,
            "Approver rejected bound action",
            json!({"approver_sub":claims.sub}),
        )
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    Ok(Json(
        json!({"status":"rejected","trace_id":trace_id,"approval_id":approval_id,"acr_values":null,"action":summary(&trace)}),
    ))
}

async fn release_agent(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
    Path(agent_id): Path<String>,
) -> ApiResult {
    require_admin(&claims, &id.0)?;
    let _gate = gateway.action_gate.lock().await;
    let entities = gateway
        .store
        .entities()
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let mut entity = find_entity(&entities, "Agent", &agent_id)
        .cloned()
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Agent not found", &id.0))?;
    entity["attrs"]["state"] = json!("active");
    gateway
        .store
        .put_entity(&entity)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let event = json!({"agent_id":agent_id,"state":"active","reason":"Released by authorized human","occurred_at":now()});
    gateway
        .store
        .put(
            "agent_release",
            &agent_id,
            &json!({"released_at":now(),"human_sub":claims.sub}),
        )
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    gateway
        .store
        .put("agent_state", &agent_id, &event)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    gateway
        .store
        .event("agent.state_changed", Some(&id.0), &event)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    gateway
        .security(
            "agent_released",
            "info",
            &id.0,
            "Agent released by authorized human",
            json!({"agent_id":agent_id,"human_sub":claims.sub,"state":"active"}),
        )
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    Ok(Json(event))
}
async fn attachments(
    State(gateway): State<Arc<Gateway>>,
    Extension(id): Extension<Correlation>,
) -> ApiResult {
    Ok(Json(
        json!({"items":gateway.store.list("attachment").await.map_err(|e|ApiError::unavailable(e,&id.0))?}),
    ))
}
fn catalog_controls(gateway: &Gateway, attachments: &[Value]) -> Vec<Value> {
    gateway.catalog["controls"].as_array().into_iter().flatten().map(|control|json!({"id":control["id"],"name":control["name"],"description":control["explanation"],"primitive":control["primitive"],"asi":control["asi"],"attachment_points":control["attach"],"enforcement":control["enforced_by"],"policy_ids":control.get("policies").cloned().unwrap_or(json!([])),"attachments":attachments.iter().filter(|attachment|attachment["control_id"]==control["id"]).collect::<Vec<_>>()})).collect()
}
async fn controls(
    State(gateway): State<Arc<Gateway>>,
    Extension(id): Extension<Correlation>,
) -> ApiResult {
    let attachments = gateway
        .store
        .list("attachment")
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    Ok(Json(
        json!({"items":catalog_controls(&gateway,&attachments)}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AttachmentRequest {
    control_id: String,
    target_type: String,
    target_id: String,
    parameters: Value,
}
async fn attach_control(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
    Json(body): Json<AttachmentRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    require_admin(&claims, &id.0)?;
    if !claims.role("org-admin") {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Organization admin required",
            &id.0,
        ));
    }
    let _gate = gateway.action_gate.lock().await;
    let control = gateway.catalog["controls"]
        .as_array()
        .and_then(|controls| {
            controls
                .iter()
                .find(|control| control["id"] == body.control_id)
        })
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Unknown control", &id.0))?;
    if !control["attach"]
        .as_array()
        .is_some_and(|points| points.iter().any(|point| point == &body.target_type))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Unsupported attachment point",
            &id.0,
        ));
    }
    let attachment_id = uuid::Uuid::new_v4().to_string();
    let attachment = json!({"id":attachment_id,"control_id":body.control_id,"target_type":body.target_type,"target_id":body.target_id,"parameters":body.parameters});
    let entities = gateway
        .store
        .entities()
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let mut previous_attributes = Value::Null;
    if control["mode"] == "template" {
        let kind = match body.target_type.as_str() {
            "team" => "Team",
            "agent" => "Agent",
            _ => {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "Template needs team or agent",
                    &id.0,
                ));
            }
        };
        if find_entity(&entities, kind, &body.target_id).is_none() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Unknown attachment target",
                &id.0,
            ));
        }
        let mut engine = gateway
            .engine()
            .await
            .map_err(|e| ApiError::unavailable(e, &id.0))?;
        engine
            .link(
                "tpl-suspend-high-impact",
                &attachment_id,
                &uid(kind, &body.target_id),
            )
            .map_err(|e| ApiError::new(StatusCode::BAD_REQUEST, e.to_string(), &id.0))?;
    } else if control["mode"] == "data" {
        let kind = match body.target_type.as_str() {
            "use_case" => "UseCase",
            "agent" => "Agent",
            "tool" => "Tool",
            "provider_model" => "Model",
            "user" => "Human",
            "tier" => "Resource",
            _ => {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "Unsupported data target",
                    &id.0,
                ));
            }
        };
        let mut entity = find_entity(&entities, kind, &body.target_id)
            .cloned()
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Unknown target", &id.0))?;
        previous_attributes = entity["attrs"].clone();
        let params = body.parameters.as_object().ok_or_else(|| {
            ApiError::new(StatusCode::BAD_REQUEST, "Object parameters required", &id.0)
        })?;
        let allowed = control["parameters"].as_array().ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "Control has no editable parameters",
                &id.0,
            )
        })?;
        for (key, value) in params {
            let qualified = format!("{kind}.{key}");
            if !allowed.iter().any(|parameter| parameter == &qualified) {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("Parameter {qualified} is not editable by this control"),
                    &id.0,
                ));
            }
            let converted = if matches!(
                key.as_str(),
                "permitted"
                    | "entitlements"
                    | "approvalRequired"
                    | "stepUpRequired"
                    | "delegated"
                    | "peers"
                    | "agents"
            ) {
                let kind = if matches!(key.as_str(), "peers" | "agents") {
                    "Agent"
                } else {
                    "Capability"
                };
                let values = value.as_array().ok_or_else(|| {
                    ApiError::new(StatusCode::BAD_REQUEST, "Array required", &id.0)
                })?;
                let mut converted = Vec::new();
                for value in values {
                    let target = value.as_str().ok_or_else(|| {
                        ApiError::new(StatusCode::BAD_REQUEST, "String item required", &id.0)
                    })?;
                    if find_entity(&entities, kind, target).is_none() {
                        return Err(ApiError::new(
                            StatusCode::BAD_REQUEST,
                            "Unknown referenced entity",
                            &id.0,
                        ));
                    }
                    converted.push(entity_ref(kind, target));
                }
                json!(converted)
            } else {
                value.clone()
            };
            entity["attrs"][key] = converted;
        }
        let mut candidate = entities.clone();
        if let Some(items) = candidate.as_array_mut() {
            items.retain(|e| e["uid"] != entity["uid"]);
            items.push(entity.clone());
        }
        gateway
            .engine
            .validate_entities(candidate)
            .map_err(|e| ApiError::new(StatusCode::BAD_REQUEST, e.to_string(), &id.0))?;
        gateway
            .store
            .put_entity(&entity)
            .await
            .map_err(|e| ApiError::unavailable(e, &id.0))?;
    } else {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Baseline control is always attached",
            &id.0,
        ));
    }
    gateway
        .store
        .put("attachment", &attachment_id, &attachment)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    gateway
        .security(
            "control_attachment_changed",
            "info",
            &id.0,
            "Control attachment changed by authorized human",
            json!({"attachment":attachment,"human_sub":claims.sub,"previous_attributes":previous_attributes}),
        )
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    Ok((StatusCode::CREATED, Json(attachment)))
}
fn policy_items(gateway: &Gateway) -> Vec<Value> {
    let mut items:Vec<_>=gateway.engine.policies.policies().map(|policy|json!({"id":policy.id().to_string(),"name":policy.id().to_string(),"cedar":policy.to_string(),"control_ids":[policy.annotation("control").unwrap_or("")]})).collect();
    items.extend(gateway.engine.policies.templates().map(|template|json!({"id":template.id().to_string(),"name":template.id().to_string(),"cedar":template.to_string(),"control_ids":[template.annotation("control").unwrap_or("")]})));
    items
}
async fn policies(State(gateway): State<Arc<Gateway>>) -> ApiResult {
    Ok(Json(json!({"items":policy_items(&gateway)})))
}
async fn policy(
    State(gateway): State<Arc<Gateway>>,
    Extension(id): Extension<Correlation>,
    Path(policy_id): Path<String>,
) -> ApiResult {
    Ok(Json(
        policy_items(&gateway)
            .into_iter()
            .find(|policy| policy["id"] == policy_id)
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Policy not found", &id.0))?,
    ))
}
async fn connectors(
    State(gateway): State<Arc<Gateway>>,
    Extension(id): Extension<Correlation>,
) -> ApiResult {
    let tools = gateway
        .observe_tools(None)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    Ok(Json(json!({"items":[
        {"id":"mcp-demo","name":"Acme enterprise MCP tools","kind":"mcp","status":"connected","model_label":null,"base_url":gateway.mcp.url,"tools":tools},
        {"id":"openai-compatible","name":"OpenAI-compatible adapter","kind":"company-ai-gateway","status":"connected","model_label":MODEL_LABEL,"base_url":gateway.llm.base_url,"tools":[]},
        {"id":"local-model","name":"Local model via OpenAI-compatible adapter","kind":"local-model","status":"not_configured","model_label":null,"base_url":null,"tools":[]},
        {"id":"self-hosted","name":"Self-hosted model via OpenAI-compatible adapter","kind":"self-hosted","status":"not_configured","model_label":null,"base_url":null,"tools":[]},
        {"id":"anthropic-direct","name":"Anthropic direct (not configured)","kind":"anthropic-direct","status":"not_configured","model_label":null,"base_url":null,"tools":[]}
    ]})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MessageRequest {
    session_id: String,
    receiver_id: String,
    requested_capability: String,
    content: String,
}
async fn send_message(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
    Json(body): Json<MessageRequest>,
) -> ApiResult {
    let _gate = gateway.action_gate.lock().await;
    let request = ActionRequest {
        mediated: true,
        session_id: body.session_id.clone(),
        capability: "agent.message".into(),
        resource: crate::pipeline::Resource {
            r#type: "agent".into(),
            id: body.receiver_id.clone(),
            tier: "public".into(),
        },
        parameters: json!({"requested_capability":body.requested_capability,"content":body.content}),
    };
    let trace = gateway
        .decide_action(&claims, request, &id.0, false, false, None)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let entities = gateway
        .store
        .entities()
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let event = json!({"id":uuid::Uuid::new_v4().to_string(),"sender":trace["agent"],"receiver":agent_ref(find_entity(&entities,"Agent",&body.receiver_id),&body.receiver_id),"use_case":trace["use_case"],"capability":body.requested_capability,"provenance":{"human":trace["human"],"session_id":body.session_id,"trusted":false,"source":"Gateway authenticated sender","message_is_delegation":false},"decision":trace["decision"],"trace_id":trace["trace_id"],"occurred_at":now(),"content":if trace["executed"]==true {body.content.as_str()} else {"[blocked content withheld]"},"executed":trace["executed"],"control_ids":trace["control_ids"],"policy_ids":trace["policy_ids"]});
    gateway
        .store
        .put("message", text(&event, "id"), &event)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    gateway
        .store
        .event("message.mediated", Some(text(&trace, "trace_id")), &event)
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let mut response = event;
    if trace["policy_ids"].as_array().is_some_and(|policies| {
        policies
            .iter()
            .any(|policy| policy == "forbid-session-not-bound-to-agent")
    }) {
        response.as_object_mut().unwrap().remove("use_case");
        response["provenance"] = json!({"trusted":false,"source":"Gateway authenticated sender","message_is_delegation":false});
    }
    Ok(Json(response))
}
async fn messages(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
) -> ApiResult {
    let items: Vec<_> = gateway
        .store
        .list("message")
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .into_iter()
        .filter(|message| {
            privileged(&claims) || message["provenance"]["human"]["sub"] == claims.sub
        })
        .collect();
    Ok(Json(json!({"items":items})))
}
async fn coverage(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
) -> ApiResult {
    let attachments = gateway
        .store
        .list("attachment")
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let controls = catalog_controls(&gateway, &attachments);
    let traces: Vec<_> = gateway
        .store
        .list("trace")
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .into_iter()
        .filter(|trace| can_read(&claims, trace))
        .collect();
    let names = [
        "Agent goal hijack",
        "Tool misuse and exploitation",
        "Identity and privilege abuse",
        "Agentic supply chain",
        "Unexpected code execution",
        "Memory and context poisoning",
        "Insecure inter-agent communication",
        "Cascading failures",
        "Human-agent trust exploitation",
        "Rogue agents",
    ];
    let items:Vec<_>=(1..=10).map(|index|{
        let asi=format!("ASI{index:02}");let matched:Vec<_>=controls.iter().filter(|control|control["asi"].as_array().is_some_and(|risks|risks.iter().any(|risk|risk==&asi))).collect();
        let primitive_ids:BTreeSet<_>=matched.iter().filter_map(|control|control["primitive"].as_str()).collect();
        let primitives:Vec<_>=gateway.catalog["primitives"].as_array().into_iter().flatten().filter(|primitive|primitive_ids.contains(text(primitive,"id"))).map(|primitive|json!({"id":primitive["id"],"name":primitive["name"]})).collect();
        let evidence:Vec<_>=traces.iter().filter(|trace|trace["control_ids"].as_array().is_some_and(|ids|ids.iter().any(|id|matched.iter().any(|control|control["id"]==*id)))).collect();
        let mut counts=json!({"allow":0,"deny":0,"require_approval":0,"require_step_up":0});for trace in &evidence{let decision=text(trace,"decision");if let Some(count)=counts.get_mut(decision){*count=json!(count.as_i64().unwrap_or(0)+1);}}
        json!({"asi_id":asi,"name":names[index-1],"primitives":primitives,"controls":matched,"evidence_count":evidence.len(),"decision_counts":counts})
    }).collect();
    Ok(Json(json!({"items":items})))
}
async fn security_events(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
) -> ApiResult {
    if !privileged(&claims) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Security role required",
            &id.0,
        ));
    }
    let items=sqlx::query_scalar::<_,Value>("SELECT data FROM security_events WHERE organization_id='acme' AND event_type='security.event' ORDER BY id DESC LIMIT 100").fetch_all(&gateway.store.pool).await.map_err(|e|ApiError::unavailable(e.into(),&id.0))?;
    Ok(Json(json!({"items":items})))
}
async fn overview(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
) -> ApiResult {
    let entities = gateway
        .store
        .entities()
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?;
    let active = entities
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["uid"]["type"] == "Betsee::Agent" && e["attrs"]["state"] == "active")
        .count();
    let cutoff = Utc::now() - chrono::Duration::minutes(15);
    let traces: Vec<_> = gateway
        .store
        .list("trace")
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .into_iter()
        .filter(|trace| {
            can_read(&claims, trace)
                && trace["record_type"].is_null()
                && text(trace, "occurred_at")
                    .parse::<DateTime<Utc>>()
                    .is_ok_and(|time| time > cutoff)
        })
        .collect();
    let mut stage_counts = json!({});
    for stage in STAGES {
        stage_counts[stage] = json!(
            traces
                .iter()
                .filter(|trace| trace["spans"].as_array().is_some_and(|spans| spans
                    .iter()
                    .any(|span| span["stage"] == stage && span["status"] != "skipped")))
                .count()
        );
    }
    let waiting = gateway
        .store
        .list("approval")
        .await
        .map_err(|e| ApiError::unavailable(e, &id.0))?
        .iter()
        .filter(|a| a["state"] == "pending" && can_read(&claims, &a["action"]))
        .count();
    Ok(Json(
        json!({"agents_active":active,"actions_last_15m":traces.len(),"denied_last_15m":traces.iter().filter(|trace|trace["decision"]=="deny").count(),"awaiting_human":waiting,"stage_counts":stage_counts}),
    ))
}
async fn events(
    State(gateway): State<Arc<Gateway>>,
    Extension(claims): Extension<Claims>,
    Extension(id): Extension<Correlation>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    if !privileged(&claims) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Security role required",
            &id.0,
        ));
    }
    let mut cursor = if let Some(value) = headers.get("last-event-id") {
        value
            .to_str()
            .ok()
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|id| *id >= 0)
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Invalid Last-Event-ID", &id.0))?
    } else {
        sqlx::query_scalar::<_,i64>("SELECT COALESCE((SELECT id-1 FROM security_events WHERE organization_id='acme' ORDER BY id DESC OFFSET 99 LIMIT 1),0)").fetch_one(&gateway.store.pool).await.map_err(|e|ApiError::unavailable(e.into(),&id.0))?
    };
    let (sender, receiver) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(128);
    tokio::spawn(async move {
        loop {
            if sender.is_closed() || Utc::now().timestamp() >= claims.exp {
                break;
            }
            let rows=match sqlx::query("SELECT id,event_type,data FROM security_events WHERE organization_id='acme' AND id>$1 ORDER BY id LIMIT 100").bind(cursor).fetch_all(&gateway.store.pool).await {Ok(rows)=>rows,Err(error)=>{tracing::error!(%error,"SSE event query failed");break;}};
            for row in rows {
                let event_id: i64 = match row.try_get("id") {
                    Ok(id) => id,
                    Err(_) => return,
                };
                cursor = event_id;
                let kind: String = match row.try_get("event_type") {
                    Ok(kind) => kind,
                    Err(_) => return,
                };
                let data: Value = match row.try_get("data") {
                    Ok(data) => data,
                    Err(_) => return,
                };
                let visible = privileged(&claims)
                    || match kind.as_str() {
                        "action.decided" | "action.updated" | "session.started"
                        | "session.ended" => can_read(&claims, &data),
                        "message.mediated" => data["provenance"]["human"]["sub"] == claims.sub,
                        "security.event" => false,
                        _ => true,
                    };
                if visible
                    && sender
                        .send(Ok(Event::default()
                            .id(event_id.to_string())
                            .event(kind)
                            .data(data.to_string())))
                        .await
                        .is_err()
                {
                    return;
                }
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    });
    Ok(Sse::new(ReceiverStream::new(receiver))
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("ping"),
        )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn historical_approval_acr_requires_resolved_matching_approver_evidence() {
        let approval = json!({"approver":{"sub":"daniel"},"requires_step_up":true});
        let mut trace = json!({"spans":[
            {"stage":"step_up","status":"pending","attributes":{"approver_sub":"daniel","acr":"2"}},
            {"stage":"approval","status":"passed","attributes":{"approver_sub":"other-human","acr":"2"}}
        ]});
        assert_eq!(recorded_approver_acr(&approval, &trace), None);
        trace["spans"].as_array_mut().unwrap().push(json!({"stage":"approval","status":"passed","attributes":{"approver_sub":"daniel","acr":"2"}}));
        assert_eq!(recorded_approver_acr(&approval, &trace), Some("2"));
        assert_eq!(recorded_approver_acr(&json!({}), &trace), None);
    }
    #[test]
    fn correlation_accepts_valid_w3c_and_rejects_invalid_ids() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "traceparent",
            "00-123456789012345678901234567890ab-1234567890123456-01"
                .parse()
                .unwrap(),
        );
        assert_eq!(incoming_trace(&headers), "123456789012345678901234567890ab");
        headers.insert(
            "traceparent",
            "00-00000000000000000000000000000000-1234567890123456-01"
                .parse()
                .unwrap(),
        );
        assert_ne!(incoming_trace(&headers), "00000000000000000000000000000000");
    }
}
