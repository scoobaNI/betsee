//! The chat service: a human talks to Claude Code through it, and Betsee governs both directions.
//! Typed text passes the Gateway's content filter (CTL-IN-001) before the model sees it; every
//! tool call passes the Gateway through the PreToolUse hook (CTL-RT-001).

use anyhow::{Context, Result, bail};
use axum::{
    Json, Router,
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, StatusCode},
    response::{
        IntoResponse, Response, Sse,
        sse::{Event, KeepAlive},
    },
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    convert::Infallible,
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    sync::{Mutex, broadcast},
};
use tokio_stream::wrappers::ReceiverStream;

pub const AGENT_ID: &str = "employee-assistant";
const USE_CASE: &str = "employee-assistance";
const DELEGATED: [&str; 3] = ["files.read", "files.write", "shell.exec"];
const TOOLS: &str = "Bash,Read,Glob,Grep,Write,Edit,WebFetch,WebSearch";
const RUN_LIMIT: Duration = Duration::from_secs(600);
const TEXT_LIMIT: usize = 4000;

#[derive(Clone)]
pub struct Config {
    pub listen: Vec<SocketAddr>,
    pub gateway: String,
    pub token_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub workspace: PathBuf,
    pub state_dir: PathBuf,
    pub claude: String,
    pub model: Option<String>,
    pub approval_wait_secs: u64,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let var =
            |name: &str, default: &str| std::env::var(name).unwrap_or_else(|_| default.into());
        let listen = var("AGENT_HOST_LISTEN", "127.0.0.1:8095")
            .split(',')
            .map(|address| address.trim().parse().context("AGENT_HOST_LISTEN"))
            .collect::<Result<Vec<_>>>()?;
        Ok(Self {
            listen,
            gateway: var("BETSEE_GATEWAY_URL", "http://api.betsee.localhost"),
            token_url: var(
                "BETSEE_TOKEN_URL",
                "http://auth.betsee.localhost/realms/betsee/protocol/openid-connect/token",
            ),
            client_id: var("AGENT_CLIENT_ID", AGENT_ID),
            client_secret: std::env::var("AGENT_CLIENT_SECRET")
                .context("AGENT_CLIENT_SECRET is not set")?,
            workspace: PathBuf::from(
                std::env::var("AGENT_WORKSPACE").context("AGENT_WORKSPACE is not set")?,
            )
            .canonicalize()
            .context("AGENT_WORKSPACE does not exist")?,
            state_dir: PathBuf::from(var("AGENT_HOST_STATE", "state/agent-host")),
            claude: var("CLAUDE_BIN", "claude"),
            model: std::env::var("CLAUDE_MODEL")
                .ok()
                .filter(|model| !model.is_empty()),
            approval_wait_secs: var("BETSEE_APPROVAL_WAIT_SECS", "150")
                .parse()
                .unwrap_or(150),
        })
    }
}

struct Chat {
    id: String,
    owner: String,
    human_name: String,
    session: Value,
    claude_session: Option<String>,
    run_token: String,
    busy: bool,
    events: Vec<Value>,
    pending: HashMap<String, String>,
    sender: broadcast::Sender<Value>,
    created_at: String,
}

impl Chat {
    fn push(&mut self, mut event: Value) -> Value {
        event["id"] = json!(self.events.len() + 1);
        event["at"] = json!(now());
        self.events.push(event.clone());
        let _ = self.sender.send(event.clone());
        event
    }
    fn summary(&self) -> Value {
        json!({"chat_id":self.id,"session":self.session,"busy":self.busy,"created_at":self.created_at,"events":self.events.len(),"agent_id":AGENT_ID,"use_case":{"id":USE_CASE,"name":"Employee assistance"}})
    }
}

pub struct Host {
    config: Config,
    http: reqwest::Client,
    chats: Mutex<HashMap<String, Chat>>,
    token: Mutex<Option<(String, Instant)>>,
    hooks_file: PathBuf,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

struct ApiError(StatusCode, String);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.0,
            Json(json!({"error":self.0.as_str(),"message":self.1})),
        )
            .into_response()
    }
}
type ApiResult<T = Json<Value>> = Result<T, ApiError>;

fn bearer(headers: &HeaderMap) -> ApiResult<String> {
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_owned)
        .ok_or_else(|| ApiError(StatusCode::UNAUTHORIZED, "Missing bearer token".into()))
}

impl Host {
    pub fn new(config: Config) -> Result<Arc<Self>> {
        std::fs::create_dir_all(&config.state_dir)?;
        let exe = std::env::current_exe()?;
        let quoted = format!("'{}' hook", exe.to_string_lossy().replace('\'', "'\\''"));
        let hooks_file = config
            .state_dir
            .join("hooks.json")
            .canonicalize()
            .unwrap_or_else(|_| {
                std::env::current_dir()
                    .unwrap_or_default()
                    .join(config.state_dir.join("hooks.json"))
            });
        // The hook must outlive the longest approval wait, or Claude Code gives up on it first.
        let hooks = json!({"hooks":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":quoted,"timeout":config.approval_wait_secs + 120}]}]}});
        std::fs::write(&hooks_file, serde_json::to_vec_pretty(&hooks)?)?;
        Ok(Arc::new(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .build()?,
            config,
            chats: Mutex::new(HashMap::new()),
            token: Mutex::new(None),
            hooks_file,
        }))
    }

    /// The human behind a browser token, as the Gateway verifies it.
    async fn human(&self, token: &str) -> ApiResult<Value> {
        let response = self
            .http
            .get(format!("{}/api/v1/me", self.config.gateway))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| {
                ApiError(
                    StatusCode::SERVICE_UNAVAILABLE,
                    format!("Betsee Gateway unreachable: {error}"),
                )
            })?;
        if !response.status().is_success() {
            return Err(ApiError(
                StatusCode::UNAUTHORIZED,
                "The Gateway did not accept this token".into(),
            ));
        }
        let me: Value = response
            .json()
            .await
            .map_err(|_| ApiError(StatusCode::BAD_GATEWAY, "Unreadable identity".into()))?;
        Ok(me["human"].clone())
    }

    async fn owned(&self, headers: &HeaderMap, chat_id: &str) -> ApiResult<(String, Value)> {
        let token = bearer(headers)?;
        let human = self.human(&token).await?;
        let chats = self.chats.lock().await;
        match chats.get(chat_id) {
            Some(chat) if human["sub"] == chat.owner => Ok((token, human)),
            _ => Err(ApiError(StatusCode::NOT_FOUND, "Chat not found".into())),
        }
    }

    async fn agent_token(&self) -> Result<String> {
        let mut cached = self.token.lock().await;
        if let Some((token, expires)) = cached.as_ref()
            && Instant::now() < *expires
        {
            return Ok(token.clone());
        }
        let response: Value = self
            .http
            .post(&self.config.token_url)
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", self.config.client_id.as_str()),
                ("client_secret", self.config.client_secret.as_str()),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let token = response["access_token"]
            .as_str()
            .context("no access_token")?
            .to_owned();
        let lifetime = response["expires_in"]
            .as_u64()
            .unwrap_or(300)
            .saturating_sub(30);
        *cached = Some((
            token.clone(),
            Instant::now() + Duration::from_secs(lifetime),
        ));
        Ok(token)
    }

    async fn push(&self, chat_id: &str, event: Value) {
        if let Some(chat) = self.chats.lock().await.get_mut(chat_id) {
            chat.push(event);
        }
    }

    fn system_prompt(name: &str) -> String {
        // The limits live in Betsee, not here: an agent that pre-judges its own permissions hides
        // the very decisions the Gateway exists to make and record.
        format!(
            "You are the Acme Logistics employee assistant, helping {name}. You work in a demo \
             employee workspace (your current directory) with the tools Read, Glob, Grep, Bash, \
             Write and Edit; use relative paths. Betsee, the company's agent control plane, decides \
             every tool call before it runs and may allow it, deny it or hold it for a human \
             approver. Do not guess what Betsee will allow: when {name} asks for something, make \
             the tool call and let Betsee decide. When Betsee denies a tool call, do not retry it \
             or try another way around it; tell {name} plainly what was denied and quote Betsee's \
             reason. Keep answers short and practical."
        )
    }

    async fn run(self: Arc<Self>, chat_id: String, text: String) {
        let result = self.clone().run_inner(&chat_id, &text).await;
        if let Err(error) = result {
            self.push(
                &chat_id,
                json!({"type":"error","message":format!("{error:#}")}),
            )
            .await;
        }
        if let Some(chat) = self.chats.lock().await.get_mut(&chat_id) {
            chat.busy = false;
            chat.push(json!({"type":"idle"}));
        }
    }

    async fn run_inner(self: Arc<Self>, chat_id: &str, text: &str) -> Result<()> {
        let (resume, run_token, session_id, name) = {
            let chats = self.chats.lock().await;
            let chat = chats.get(chat_id).context("chat vanished")?;
            (
                chat.claude_session.clone(),
                chat.run_token.clone(),
                chat.session["id"].as_str().unwrap_or("").to_owned(),
                chat.human_name.clone(),
            )
        };
        let config = &self.config;
        let mut command = tokio::process::Command::new(&config.claude);
        command
            .current_dir(&config.workspace)
            .arg("-p")
            .args(["--output-format", "stream-json", "--verbose"])
            .arg("--settings")
            .arg(&self.hooks_file)
            // Only the hook settings: no user hooks, no user CLAUDE.md, no MCP servers, no skills.
            .args(["--setting-sources", "project", "--strict-mcp-config"])
            .args(["--tools", TOOLS])
            .args(["--permission-mode", "default"])
            .arg("--append-system-prompt")
            .arg(Self::system_prompt(&name))
            .env("CLAUDE_CODE_DISABLE_CLAUDE_MDS", "1")
            .env("CLAUDE_CODE_DISABLE_AUTO_MEMORY", "1")
            .env("CLAUDE_CODE_DISABLE_BUNDLED_SKILLS", "1")
            .env(
                "BETSEE_AGENT_HOST_URL",
                format!("http://127.0.0.1:{}", config.listen[0].port()),
            )
            .env("BETSEE_CHAT_ID", chat_id)
            .env("BETSEE_RUN_TOKEN", &run_token)
            .env("BETSEE_SESSION_ID", &session_id)
            .env("BETSEE_GATEWAY_URL", &config.gateway)
            .env("BETSEE_WORKSPACE", &config.workspace)
            .env(
                "BETSEE_APPROVAL_WAIT_SECS",
                config.approval_wait_secs.to_string(),
            )
            .env_remove("AGENT_CLIENT_SECRET")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        if let Some(model) = &config.model {
            command.args(["--model", model]);
        }
        if let Some(resume) = &resume {
            command.args(["--resume", resume]);
        }
        let mut child = command.spawn().context("claude CLI could not start")?;
        let mut stdin = child.stdin.take().context("claude stdin")?;
        stdin.write_all(text.as_bytes()).await?;
        drop(stdin);
        let stdout = child.stdout.take().context("claude stdout")?;
        let mut stderr = child.stderr.take().context("claude stderr")?;
        let errors = tokio::spawn(async move {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text).await;
            text
        });
        let mut lines = BufReader::new(stdout).lines();
        let mut finished = false;
        let reading = async {
            while let Some(line) = lines.next_line().await? {
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                finished |= message["type"] == "result";
                for event in self.translate(chat_id, &message).await {
                    self.push(chat_id, event).await;
                }
            }
            anyhow::Ok(())
        };
        match tokio::time::timeout(RUN_LIMIT, reading).await {
            Ok(result) => result?,
            Err(_) => {
                child.kill().await.ok();
                bail!(
                    "the agent run exceeded {} minutes and was stopped",
                    RUN_LIMIT.as_secs() / 60
                );
            }
        }
        let status = child.wait().await?;
        let errors = errors.await.unwrap_or_default();
        if !finished {
            let tail: String = errors.lines().rev().take(5).collect::<Vec<_>>().join(" | ");
            bail!("the agent run ended without a result ({status}): {tail}");
        }
        Ok(())
    }

    /// Claude Code stream-json messages as chat events.
    async fn translate(&self, chat_id: &str, message: &Value) -> Vec<Value> {
        let mut events = Vec::new();
        match message["type"].as_str() {
            Some("system") if message["subtype"] == "init" => {
                if let Some(session) = message["session_id"].as_str()
                    && let Some(chat) = self.chats.lock().await.get_mut(chat_id)
                {
                    chat.claude_session = Some(session.to_owned());
                }
                events.push(json!({"type":"run_started","model":message["model"],"tools":message["tools"]}));
            }
            Some("assistant") => {
                for block in message["message"]["content"].as_array().into_iter().flatten() {
                    match block["type"].as_str() {
                        Some("text") if block["text"].as_str().is_some_and(|t| !t.trim().is_empty()) => {
                            events.push(json!({"type":"assistant_text","text":block["text"]}));
                        }
                        Some("tool_use") => events.push(
                            json!({"type":"tool_call","tool_use_id":block["id"],"tool":block["name"],"input":clip(&block["input"])}),
                        ),
                        _ => {}
                    }
                }
            }
            Some("user") => {
                for block in message["message"]["content"].as_array().into_iter().flatten() {
                    if block["type"] == "tool_result" {
                        let content = match &block["content"] {
                            Value::String(text) => text.clone(),
                            Value::Array(parts) => parts
                                .iter()
                                .filter_map(|part| part["text"].as_str())
                                .collect::<Vec<_>>()
                                .join("\n"),
                            _ => String::new(),
                        };
                        events.push(json!({"type":"tool_result","tool_use_id":block["tool_use_id"],"is_error":block["is_error"].as_bool().unwrap_or(false),"content":content.chars().take(TEXT_LIMIT).collect::<String>()}));
                    }
                }
            }
            Some("result") => events.push(
                json!({"type":"turn_end","subtype":message["subtype"],"is_error":message["is_error"],"duration_ms":message["duration_ms"],"num_turns":message["num_turns"],"total_cost_usd":message["total_cost_usd"]}),
            ),
            _ => {}
        }
        events
    }
}

/// Tool input as the chat shows it: long strings shortened.
fn clip(value: &Value) -> Value {
    match value {
        Value::String(text) if text.chars().count() > 600 => {
            json!(format!("{}...", text.chars().take(600).collect::<String>()))
        }
        Value::Object(map) => {
            Value::Object(map.iter().map(|(k, v)| (k.clone(), clip(v))).collect())
        }
        other => other.clone(),
    }
}

async fn create_session(
    State(host): State<Arc<Host>>,
    headers: HeaderMap,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let token = bearer(&headers)?;
    let human = host.human(&token).await?;
    let response = host
        .http
        .post(format!("{}/api/v1/sessions", host.config.gateway))
        .bearer_auth(&token)
        .json(&json!({"agent_id":AGENT_ID,"use_case_id":USE_CASE,"delegated":DELEGATED,"tier_ceiling":"internal"}))
        .send()
        .await
        .map_err(|error| ApiError(StatusCode::SERVICE_UNAVAILABLE, format!("Betsee Gateway unreachable: {error}")))?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(ApiError(
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            body["message"]
                .as_str()
                .unwrap_or("The Gateway refused the session")
                .to_owned(),
        ));
    }
    let chat_id = uuid::Uuid::new_v4().to_string();
    let (sender, _) = broadcast::channel(256);
    let mut chat = Chat {
        id: chat_id.clone(),
        owner: human["sub"].as_str().unwrap_or("").to_owned(),
        human_name: human["display_name"]
            .as_str()
            .unwrap_or("the employee")
            .to_owned(),
        session: body,
        claude_session: None,
        run_token: uuid::Uuid::new_v4().simple().to_string(),
        busy: false,
        events: Vec::new(),
        pending: HashMap::new(),
        sender,
        created_at: now(),
    };
    chat.push(json!({"type":"session","session":chat.session}));
    let summary = chat.summary();
    host.chats.lock().await.insert(chat_id, chat);
    Ok((StatusCode::CREATED, Json(summary)))
}

async fn list_sessions(State(host): State<Arc<Host>>, headers: HeaderMap) -> ApiResult {
    let human = host.human(&bearer(&headers)?).await?;
    let chats = host.chats.lock().await;
    let mut items: Vec<_> = chats
        .values()
        .filter(|chat| human["sub"] == chat.owner)
        .map(Chat::summary)
        .collect();
    items.sort_by(|a, b| b["created_at"].as_str().cmp(&a["created_at"].as_str()));
    Ok(Json(json!({"items":items})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Message {
    chat_id: String,
    text: String,
}

async fn send_message(
    State(host): State<Arc<Host>>,
    headers: HeaderMap,
    Json(body): Json<Message>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let (token, _) = host.owned(&headers, &body.chat_id).await?;
    let message_id = uuid::Uuid::new_v4().to_string();
    let session_id = {
        let mut chats = host.chats.lock().await;
        let chat = chats.get_mut(&body.chat_id).expect("owned checked it");
        if chat.busy {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "The assistant is still working on the previous message".into(),
            ));
        }
        chat.busy = true;
        chat.session["id"].as_str().unwrap_or("").to_owned()
    };
    let release = |host: Arc<Host>, chat_id: String| async move {
        if let Some(chat) = host.chats.lock().await.get_mut(&chat_id) {
            chat.busy = false;
        }
    };
    // CTL-IN-001: the Gateway checks the text before any model sees it. No answer means no send.
    let checked = host
        .http
        .post(format!("{}/api/v1/chat/inputs", host.config.gateway))
        .bearer_auth(&token)
        .json(&json!({"session_id":session_id,"text":body.text}))
        .send()
        .await;
    let check: Value = match checked {
        Ok(response) if response.status().is_success() => {
            response.json().await.unwrap_or(Value::Null)
        }
        Ok(response) => {
            let status = response.status();
            let detail: Value = response.json().await.unwrap_or(Value::Null);
            release(host.clone(), body.chat_id.clone()).await;
            let reason = format!(
                "The Betsee content filter refused the request ({}), so the message was not sent",
                detail["message"].as_str().unwrap_or(status.as_str())
            );
            host.push(&body.chat_id, json!({"type":"input_blocked","message_id":message_id,"reasons":[reason],"control_ids":["CTL-IN-001"],"trace_id":detail["trace_id"],"findings":[]})).await;
            return Ok((
                StatusCode::OK,
                Json(json!({"status":"blocked","message_id":message_id,"reasons":[reason]})),
            ));
        }
        Err(error) => {
            release(host.clone(), body.chat_id.clone()).await;
            let reason = format!(
                "The Betsee content filter is unreachable ({error}), so the message was not sent (fail closed)"
            );
            host.push(&body.chat_id, json!({"type":"input_blocked","message_id":message_id,"reasons":[reason],"control_ids":["CTL-IN-001"],"trace_id":null,"findings":[]})).await;
            return Ok((
                StatusCode::OK,
                Json(json!({"status":"blocked","message_id":message_id,"reasons":[reason]})),
            ));
        }
    };
    let reasons: Vec<Value> = check["reasons"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|reason| {
            reason
                .get("text")
                .cloned()
                .unwrap_or_else(|| reason.clone())
        })
        .collect();
    if check["decision"] != "allow" {
        release(host.clone(), body.chat_id.clone()).await;
        let event = json!({"type":"input_blocked","message_id":message_id,"reasons":reasons,"control_ids":check["control_ids"],"policy_ids":check["policy_ids"],"trace_id":check["trace_id"],"findings":check["findings"]});
        host.push(&body.chat_id, event).await;
        return Ok((
            StatusCode::OK,
            Json(
                json!({"status":"blocked","message_id":message_id,"reasons":reasons,"control_ids":check["control_ids"],"trace_id":check["trace_id"],"findings":check["findings"]}),
            ),
        ));
    }
    host.push(&body.chat_id, json!({"type":"user_message","message_id":message_id,"text":body.text,"trace_id":check["trace_id"],"control_ids":check["control_ids"]})).await;
    tokio::spawn(host.clone().run(body.chat_id.clone(), body.text));
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({"status":"accepted","message_id":message_id,"trace_id":check["trace_id"]})),
    ))
}

async fn stream(
    State(host): State<Arc<Host>>,
    headers: HeaderMap,
    Path(chat_id): Path<String>,
) -> ApiResult<Response> {
    host.owned(&headers, &chat_id).await?;
    let after = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let (replay, mut receiver) = {
        let chats = host.chats.lock().await;
        let chat = chats
            .get(&chat_id)
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Chat not found".into()))?;
        let replay: Vec<Value> = chat
            .events
            .iter()
            .filter(|e| e["id"].as_u64().unwrap_or(0) > after)
            .cloned()
            .collect();
        (replay, chat.sender.subscribe())
    };
    let (sender, events) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(256);
    tokio::spawn(async move {
        let mut last = after;
        let to_event = |event: &Value| {
            Event::default()
                .id(event["id"].to_string())
                .event(event["type"].as_str().unwrap_or("message"))
                .data(event.to_string())
        };
        for event in replay {
            last = event["id"].as_u64().unwrap_or(last);
            if sender.send(Ok(to_event(&event))).await.is_err() {
                return;
            }
        }
        loop {
            match receiver.recv().await {
                Ok(event) if event["id"].as_u64().unwrap_or(0) > last => {
                    last = event["id"].as_u64().unwrap_or(last);
                    if sender.send(Ok(to_event(&event))).await.is_err() {
                        return;
                    }
                }
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return,
            }
        }
    });
    Ok(Sse::new(ReceiverStream::new(events))
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("ping"),
        )
        .into_response())
}

#[derive(Deserialize)]
struct Internal {
    chat_id: String,
    payload: Value,
}

/// The hook's channel back: loopback only, and only with the run token of that chat.
async fn internal_guard(
    host: &Host,
    peer: SocketAddr,
    headers: &HeaderMap,
    chat_id: &str,
) -> ApiResult<()> {
    if !peer.ip().is_loopback() {
        return Err(ApiError(StatusCode::FORBIDDEN, "Loopback only".into()));
    }
    let token = headers
        .get("x-run-token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    match host.chats.lock().await.get(chat_id) {
        Some(chat) if !token.is_empty() && chat.run_token == token => Ok(()),
        _ => Err(ApiError(StatusCode::FORBIDDEN, "Unknown run".into())),
    }
}

async fn internal(
    State(host): State<Arc<Host>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(action): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Internal>,
) -> ApiResult {
    internal_guard(&host, peer, &headers, &body.chat_id).await?;
    match action.as_str() {
        "token" => {
            let token = host.agent_token().await.map_err(|error| {
                ApiError(
                    StatusCode::SERVICE_UNAVAILABLE,
                    format!("agent token unavailable: {error:#}"),
                )
            })?;
            Ok(Json(json!({"access_token":token})))
        }
        "events" => {
            host.push(&body.chat_id, body.payload).await;
            Ok(Json(json!({"ok":true})))
        }
        "pending/get" => {
            let chats = host.chats.lock().await;
            let key = body.payload["key"].as_str().unwrap_or("");
            let trace = chats
                .get(&body.chat_id)
                .and_then(|chat| chat.pending.get(key).cloned());
            Ok(Json(json!({"trace_id":trace})))
        }
        "pending/put" => {
            let mut chats = host.chats.lock().await;
            if let Some(chat) = chats.get_mut(&body.chat_id) {
                let key = body.payload["key"].as_str().unwrap_or("").to_owned();
                match body.payload["trace_id"].as_str() {
                    Some(trace) => chat.pending.insert(key, trace.to_owned()),
                    None => chat.pending.remove(&key),
                };
            }
            Ok(Json(json!({"ok":true})))
        }
        _ => Err(ApiError(
            StatusCode::NOT_FOUND,
            "Unknown internal route".into(),
        )),
    }
}

async fn health() -> Json<Value> {
    Json(json!({"status":"ok","service":"betsee-agent-host"}))
}

pub fn router(host: Arc<Host>) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/api/v1/chat/healthz", get(health))
        .route(
            "/api/v1/chat/sessions",
            get(list_sessions).post(create_session),
        )
        .route("/api/v1/chat/messages", post(send_message))
        .route("/api/v1/chat/stream/{chat_id}", get(stream))
        .route("/internal/{*action}", post(internal))
        .layer(axum::extract::DefaultBodyLimit::max(64 * 1024))
        .with_state(host)
}

pub async fn serve(config: Config) -> Result<()> {
    let listen = config.listen.clone();
    let host = Host::new(config)?;
    let app = router(host);
    let mut servers = Vec::new();
    for address in listen {
        let listener = tokio::net::TcpListener::bind(address)
            .await
            .with_context(|| format!("cannot listen on {address}"))?;
        tracing::info!(%address, "agent-host listening");
        let app = app.clone();
        servers.push(tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
        }));
    }
    for server in servers {
        server.await??;
    }
    Ok(())
}
