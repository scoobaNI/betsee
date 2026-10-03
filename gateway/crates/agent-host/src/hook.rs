//! `agent-host hook`: Claude Code's PreToolUse hook. Every tool call becomes an ActionRequest that
//! the Betsee Gateway decides before anything runs. The hook holds no credential: it asks the
//! local agent-host for a short-lived agent token with the run token of its chat.
//!
//! Fail closed everywhere: an unreachable agent-host or Gateway, an unexpected answer or a
//! timeout is a deny. The caller turns a panic into exit code 2, which blocks the tool call too.

use crate::mapping;
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{
    io::Read,
    path::PathBuf,
    time::{Duration, Instant},
};

struct Env {
    host: String,
    chat: String,
    run_token: String,
    session: String,
    gateway: String,
    workspace: PathBuf,
    approval_wait: Duration,
}

impl Env {
    fn load() -> Result<Self> {
        let var = |name: &str| std::env::var(name).with_context(|| format!("{name} is not set"));
        Ok(Self {
            host: var("BETSEE_AGENT_HOST_URL")?,
            chat: var("BETSEE_CHAT_ID")?,
            run_token: var("BETSEE_RUN_TOKEN")?,
            session: var("BETSEE_SESSION_ID")?,
            gateway: var("BETSEE_GATEWAY_URL")?,
            workspace: PathBuf::from(var("BETSEE_WORKSPACE")?),
            approval_wait: Duration::from_secs(
                var("BETSEE_APPROVAL_WAIT_SECS")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(150),
            ),
        })
    }
}

pub struct Verdict {
    pub allow: bool,
    pub reason: String,
}

/// Exactly what Claude Code reads from a PreToolUse hook on stdout.
pub fn output(verdict: &Verdict) -> String {
    json!({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":if verdict.allow {"allow"} else {"deny"},"permissionDecisionReason":verdict.reason}}).to_string()
}

pub fn run() -> Verdict {
    let mut stdin = String::new();
    if let Err(error) = std::io::stdin().read_to_string(&mut stdin) {
        return deny(format!(
            "Betsee hook could not read the tool call ({error}); denied"
        ));
    }
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => return deny(format!("Betsee hook could not start ({error}); denied")),
    };
    runtime.block_on(async {
        match decide(&stdin).await {
            Ok(verdict) => verdict,
            Err(error) => deny(format!(
                "Betsee could not decide this tool call ({error:#}); denied (fail closed)"
            )),
        }
    })
}

fn deny(reason: String) -> Verdict {
    Verdict {
        allow: false,
        reason,
    }
}

struct Client {
    env: Env,
    http: reqwest::Client,
}

impl Client {
    async fn internal(&self, path: &str, body: Value) -> Result<Value> {
        Ok(self
            .http
            .post(format!("{}/internal/{path}", self.env.host))
            .header("x-run-token", &self.env.run_token)
            .json(&json!({"chat_id":self.env.chat,"payload":body}))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }

    async fn publish(&self, event: Value) {
        if let Err(error) = self.internal("events", event).await {
            eprintln!("betsee hook: event not delivered: {error}");
        }
    }

    async fn token(&self) -> Result<String> {
        let token = self
            .internal("token", json!({}))
            .await
            .context("agent-host unreachable for an agent token")?;
        token["access_token"]
            .as_str()
            .map(str::to_owned)
            .context("agent-host returned no token")
    }

    /// The Gateway's answer, or an error that the caller turns into a fail-closed deny.
    async fn gateway(&self, request: reqwest::RequestBuilder) -> Result<Value> {
        let response = request
            .bearer_auth(self.token().await?)
            .send()
            .await
            .context("Betsee Gateway unreachable")?;
        let status = response.status();
        if !status.is_success() {
            bail!("Betsee Gateway answered HTTP {status}");
        }
        response
            .json()
            .await
            .context("Betsee Gateway answer unreadable")
    }
}

fn reasons(trace: &Value) -> Vec<String> {
    trace["reasons"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|reason| reason["text"].as_str().or(reason.as_str()))
        .map(str::to_owned)
        .collect()
}

fn sentence(trace: &Value) -> String {
    let controls: Vec<_> = trace["control_ids"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    format!(
        "{} [{}; trace {}]",
        reasons(trace)
            .first()
            .cloned()
            .unwrap_or_else(|| "no reason recorded".into()),
        controls.join(", "),
        trace["trace_id"].as_str().unwrap_or("unknown")
    )
}

fn event(kind: &str, tool_use_id: &str, tool: &str, request: &Value, trace: &Value) -> Value {
    json!({"type":kind,"tool_use_id":tool_use_id,"tool":tool,"capability":request["capability"],"resource":trace.get("resource").cloned().unwrap_or_else(||request["resource"].clone()),"decision":trace["decision"],"approval_state":trace["approval_state"],"reasons":reasons(trace),"control_ids":trace["control_ids"],"policy_ids":trace["policy_ids"],"trace_id":trace["trace_id"],"execution":trace["execution"]})
}

async fn decide(stdin: &str) -> Result<Verdict> {
    let call: Value = serde_json::from_str(stdin).context("tool call is not JSON")?;
    let tool = call["tool_name"]
        .as_str()
        .context("tool call names no tool")?;
    let tool_use_id = call["tool_use_id"].as_str().unwrap_or("");
    let env = Env::load()?;
    let mut request = mapping::action(&env.workspace, tool, &call["tool_input"]);
    request["session_id"] = json!(env.session);
    let key = mapping::call_key(tool, &call["tool_input"]);
    let client = Client {
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()?,
        env,
    };
    let previous = client
        .internal("pending/get", json!({"key":key}))
        .await
        .ok()
        .and_then(|found| found["trace_id"].as_str().map(str::to_owned));
    let mut trace = match &previous {
        Some(trace_id) => client
            .gateway(
                client
                    .http
                    .get(format!("{}/api/v1/actions/{trace_id}", client.env.gateway)),
            )
            .await
            .ok()
            .filter(|trace| trace["decision"] != "deny"),
        None => None,
    };
    if trace.is_none() {
        let result = client
            .gateway(
                client
                    .http
                    .post(format!("{}/api/v1/actions", client.env.gateway))
                    .json(&request),
            )
            .await;
        match result {
            Ok(decided) => trace = Some(decided),
            Err(error) => {
                let reason = format!("{error:#}; denied (fail closed)");
                client
                    .publish(json!({"type":"decision","tool_use_id":tool_use_id,"tool":tool,"capability":request["capability"],"resource":request["resource"],"decision":"deny","reasons":[reason],"control_ids":["CTL-RT-001"],"trace_id":null,"unreachable":true}))
                    .await;
                return Ok(deny(format!("Betsee denied this tool call: {reason}")));
            }
        }
    }
    let mut trace = trace.expect("decided above");
    let started = Instant::now();
    let mut announced = false;
    while matches!(
        trace["decision"].as_str(),
        Some("require_approval" | "require_step_up")
    ) && trace["approval_state"] == "pending"
    {
        let trace_id = trace["trace_id"].as_str().unwrap_or("").to_owned();
        if !announced {
            client
                .internal("pending/put", json!({"key":key,"trace_id":trace_id}))
                .await
                .ok();
            let mut waiting = event("decision", tool_use_id, tool, &request, &trace);
            waiting["waiting_seconds"] = json!(client.env.approval_wait.as_secs());
            client.publish(waiting).await;
            announced = true;
        }
        if started.elapsed() >= client.env.approval_wait {
            client
                .publish(json!({"type":"approval_timeout","tool_use_id":tool_use_id,"tool":tool,"trace_id":trace_id}))
                .await;
            return Ok(deny(format!(
                "Betsee is still waiting for a human to approve this action (trace {trace_id}). Approve it in Betsee Approvals and retry the same request."
            )));
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
        match client
            .gateway(
                client
                    .http
                    .get(format!("{}/api/v1/actions/{trace_id}", client.env.gateway)),
            )
            .await
        {
            Ok(next) => trace = next,
            Err(error) => {
                return Ok(deny(format!(
                    "{error:#} while waiting for approval; denied (fail closed)"
                )));
            }
        }
    }
    let allowed = trace["decision"] == "allow";
    if allowed || trace["decision"] == "deny" {
        client
            .internal("pending/put", json!({"key":key,"trace_id":null}))
            .await
            .ok();
    }
    client
        .publish(event("decision", tool_use_id, tool, &request, &trace))
        .await;
    Ok(if allowed {
        Verdict {
            allow: true,
            reason: format!("Betsee allowed: {}", sentence(&trace)),
        }
    } else {
        deny(format!(
            "Betsee denied this tool call: {}. Do not retry or work around it; tell the user what was denied and why.",
            sentence(&trace)
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hook_output_is_the_pre_tool_use_contract() {
        let out: Value = serde_json::from_str(&output(&Verdict {
            allow: false,
            reason: "no".into(),
        }))
        .unwrap();
        assert_eq!(out["hookSpecificOutput"]["hookEventName"], "PreToolUse");
        assert_eq!(out["hookSpecificOutput"]["permissionDecision"], "deny");
    }
    #[test]
    fn missing_environment_fails_closed() {
        let verdict = runtime_decide(r#"{"tool_name":"Read","tool_input":{}}"#);
        assert!(!verdict.allow);
    }
    fn runtime_decide(stdin: &str) -> Verdict {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                decide(stdin)
                    .await
                    .unwrap_or_else(|error| deny(error.to_string()))
            })
    }
}
