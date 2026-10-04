//! Desktop mode (Betsee Desk). The same service, listening on loopback only, for one person:
//! - the human signs in through the system browser (OIDC authorization code + PKCE, loopback
//!   redirect per RFC 8252) and agent-host holds their tokens, refreshing them;
//! - the desktop frontend reaches agent-host with a per-launch desk token, never a Keycloak token;
//! - runtime setup: pick Claude Code or Codex, bring your own login or API key;
//! - files: uploads and downloads cross the workspace boundary only after a Gateway scan
//!   (CTL-FILE-001), and every scan is a trace.

use crate::{
    runtime::{self, Runtime},
    server::Host,
};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
};
use base64::Engine as _;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct DeskConfig {
    /// Shared with the desktop frontend at launch; required on every desk call.
    pub token: String,
    pub issuer: String,
    pub client_id: String,
    pub redirect_uri: String,
}

struct Login {
    access: String,
    refresh: Option<String>,
    expires: Instant,
}

pub struct DeskState {
    config: DeskConfig,
    login: Mutex<Option<Login>>,
    /// state -> PKCE verifier for logins in flight.
    pending: Mutex<HashMap<String, String>>,
}

impl DeskState {
    pub fn new(config: DeskConfig) -> Self {
        Self {
            config,
            login: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
        }
    }

    pub fn authorized(&self, headers: &HeaderMap) -> bool {
        headers
            .get("x-desk-token")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| constant_eq(value.as_bytes(), self.config.token.as_bytes()))
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}/protocol/openid-connect/{path}", self.config.issuer)
    }

    pub async fn access_token(&self, http: &reqwest::Client) -> Result<String, DeskError> {
        let mut login = self.login.lock().await;
        let Some(current) = login.as_ref() else {
            return Err(DeskError(
                StatusCode::UNAUTHORIZED,
                "Sign in to Betsee first".into(),
            ));
        };
        if Instant::now() + Duration::from_secs(30) < current.expires {
            return Ok(current.access.clone());
        }
        let Some(refresh) = current.refresh.clone() else {
            *login = None;
            return Err(DeskError(
                StatusCode::UNAUTHORIZED,
                "Session expired; sign in again".into(),
            ));
        };
        let response = http
            .post(self.endpoint("token"))
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh.as_str()),
                ("client_id", self.config.client_id.as_str()),
            ])
            .send()
            .await
            .map_err(|error| {
                DeskError(
                    StatusCode::SERVICE_UNAVAILABLE,
                    format!("Identity unreachable: {error}"),
                )
            })?;
        if !response.status().is_success() {
            *login = None;
            return Err(DeskError(
                StatusCode::UNAUTHORIZED,
                "Session expired; sign in again".into(),
            ));
        }
        let tokens: Value = response.json().await.unwrap_or(Value::Null);
        let next = Login::from_tokens(&tokens).ok_or_else(|| {
            DeskError(StatusCode::BAD_GATEWAY, "Identity returned no token".into())
        })?;
        let access = next.access.clone();
        *login = Some(next);
        Ok(access)
    }
}

impl Login {
    fn from_tokens(tokens: &Value) -> Option<Self> {
        Some(Self {
            access: tokens["access_token"].as_str()?.to_owned(),
            refresh: tokens["refresh_token"].as_str().map(str::to_owned),
            expires: Instant::now()
                + Duration::from_secs(tokens["expires_in"].as_u64().unwrap_or(60)),
        })
    }
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn base64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// API keys a person brings for a runtime. Stored owner-only in the agent-host state directory,
/// never passed to a process environment other than the runtime's own.
#[derive(Default, serde::Serialize, serde::Deserialize)]
pub struct ApiKeys {
    pub anthropic: Option<String>,
}

impl ApiKeys {
    fn path(state: &Path) -> PathBuf {
        state.join("keys.json")
    }
    pub fn load(state: &Path) -> Self {
        std::fs::read(Self::path(state))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }
    fn save(&self, state: &Path) -> std::io::Result<()> {
        use std::io::Write;
        #[cfg(unix)]
        use std::os::unix::fs::OpenOptionsExt;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(Self::path(state))?;
        file.write_all(&serde_json::to_vec(self)?)
    }
}

pub struct DeskError(pub StatusCode, pub String);
impl IntoResponse for DeskError {
    fn into_response(self) -> Response {
        (
            self.0,
            Json(json!({"error":self.0.as_str(),"message":self.1})),
        )
            .into_response()
    }
}
type DeskResult<T = Json<Value>> = Result<T, DeskError>;

fn desk(host: &Host) -> DeskResult<&DeskState> {
    host.desk
        .as_ref()
        .ok_or_else(|| DeskError(StatusCode::NOT_FOUND, "Not running as Betsee Desk".into()))
}

fn guard<'a>(host: &'a Host, headers: &HeaderMap) -> DeskResult<&'a DeskState> {
    let desk = desk(host)?;
    if desk.authorized(headers) {
        Ok(desk)
    } else {
        Err(DeskError(
            StatusCode::FORBIDDEN,
            "Missing desk token".into(),
        ))
    }
}

async fn login(State(host): State<Arc<Host>>) -> DeskResult<Redirect> {
    let desk = desk(&host)?;
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let state = uuid::Uuid::new_v4().simple().to_string();
    let challenge = base64url(&Sha256::digest(verifier.as_bytes()));
    desk.pending.lock().await.insert(state.clone(), verifier);
    let url = reqwest::Url::parse_with_params(
        &desk.endpoint("auth"),
        &[
            ("client_id", desk.config.client_id.as_str()),
            ("redirect_uri", desk.config.redirect_uri.as_str()),
            ("response_type", "code"),
            ("scope", "openid profile email"),
            ("state", state.as_str()),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
        ],
    )
    .map_err(|error| DeskError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Redirect::to(url.as_str()))
}

#[derive(Deserialize)]
struct Callback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

// The same card as the Desk's Keycloak login (themes/betsee/login/resources/css/director.css), so
// the browser tab that finishes sign-in matches the page it came from.
const PAGE_STYLE: &str = "*{box-sizing:border-box}html{color-scheme:light}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;color:#101828;font:15px/1.5 \"Plus Jakarta Sans\",ui-sans-serif,system-ui,sans-serif;background:radial-gradient(900px 520px at 100% 0%,rgb(58 91 217/.07),transparent 70%),radial-gradient(800px 600px at 60% 100%,rgb(20 160 90/.05),transparent 70%),#f5f6f9}main{width:460px;max-width:100%;padding:44px 44px 40px;border:1px solid #e8eaee;border-radius:28px;background:#fff;box-shadow:0 2px 6px rgb(16 24 40/.04),0 30px 60px -24px rgb(16 24 40/.22)}.brand{display:flex;align-items:center;gap:12px;font-size:18px;font-weight:700;letter-spacing:-.02em}.brand svg{width:40px;height:40px;fill:#101828}h1{margin:36px 0 8px;font-size:28px;font-weight:700;letter-spacing:-.03em}p{margin:0;color:#475467}code{display:block;margin-top:16px;padding:10px 12px;border-radius:12px;background:#fdeeee;color:#b8262c;font:13px ui-monospace,monospace;overflow-wrap:anywhere}";

// The Betsee mark, docs/design/brand/betsee-mark.svg (0..100 viewBox).
const MARK: &str = "M46.67 92.36C46.49 92.33 45.79 92.26 45.12 92.19C35.66 91.27 26.61 87.42 18.88 81.05C17.18 79.64 13.51 75.89 12.11 74.12C6.90 67.55 3.16 59.57 2.10 52.76C1.88 51.33 1.88 51.23 2.14 51.81C2.55 52.69 4.01 54.76 5.06 55.93C8.55 59.83 15.24 64.30 22.50 67.60C26.87 69.59 32.91 71.56 38.41 72.79C44.12 74.07 50.69 74.75 53.59 74.35C55.74 74.06 57.02 73.66 58.87 72.69C61.48 71.33 63.15 70.21 65.25 68.40C69.33 64.88 72.19 60.11 73.18 55.15C73.47 53.73 73.53 50.64 73.30 49.09C72.70 44.99 70.86 41.47 67.64 38.24C65.11 35.71 62.09 33.73 58.89 32.52L57.90 32.15L58.78 31.96C61.56 31.35 65.45 31.24 68.58 31.69C72.71 32.29 76.49 33.55 80.94 35.80C88.62 39.69 94.32 44.88 96.71 50.19C97.97 52.98 98.36 55.73 97.86 58.37C97.73 59.07 97.52 59.97 97.39 60.37C95.52 66.17 90.73 73.20 84.98 78.57C79.11 84.04 72.51 87.83 64.53 90.31C62.36 90.98 59.12 91.66 56.21 92.05C54.40 92.29 53.60 92.34 50.55 92.37C48.60 92.38 46.86 92.38 46.67 92.36ZM48.31 68.57C45.59 68.31 42.56 67.17 40.40 65.58C39.19 64.69 37.53 63.01 36.67 61.81C34.70 59.06 33.59 55.32 33.79 52.08C33.95 49.51 34.44 47.58 35.44 45.63C36.26 44.05 37.01 43.03 38.35 41.68C41.48 38.55 45.52 36.82 50.11 36.67C51.60 36.62 52.11 36.65 53.26 36.85C55.74 37.27 57.67 38.04 59.76 39.43C64.97 42.90 67.61 49.34 66.35 55.52C66.04 57.05 65.80 57.75 65.03 59.32C63.47 62.53 60.99 65.05 57.83 66.67C55.24 68.00 53.36 68.49 50.50 68.62C49.86 68.65 48.88 68.62 48.31 68.57ZM20.39 60.18C19.34 59.44 15.96 57.28 13.57 55.81C7.88 52.30 5.46 50.25 4.15 47.83C2.93 45.55 2.83 42.83 3.86 39.65C4.67 37.16 7.18 32.81 10.23 28.60C13.80 23.68 18.37 19.30 23.29 16.09C29.44 12.08 36.33 9.39 43.57 8.20C48.21 7.43 54.16 7.38 59.04 8.09C66.91 9.22 74.82 12.52 81.27 17.35C84.24 19.57 85.61 20.80 88.27 23.64C90.56 26.08 92.55 28.57 94.10 30.92C95.27 32.71 95.79 33.58 96.56 35.08C98.05 38.00 98.05 37.99 96.78 36.64C94.75 34.49 91.75 32.09 88.93 30.37C81.26 25.70 72.06 24.02 62.59 25.55C55.54 26.69 45.74 29.95 39.52 33.22C36.50 34.81 33.15 36.94 30.87 38.73C29.36 39.91 27.35 41.38 25.66 42.53C21.57 45.31 17.74 47.07 14.12 47.85C13.20 48.05 12.60 48.10 11.24 48.10C10.29 48.10 9.31 48.05 9.05 47.98C8.79 47.91 8.58 47.90 8.58 47.94C8.58 47.99 8.86 48.42 9.20 48.90C11.93 52.72 16.03 56.80 20.31 59.96C21.18 60.61 21.44 60.83 21.30 60.81C21.29 60.81 20.88 60.52 20.39 60.18Z";

fn page(title: &str, body: &str, detail: Option<&str>) -> Html<String> {
    let detail = detail
        .map(|detail| format!("<code>{}</code>", escape(detail)))
        .unwrap_or_default();
    Html(format!(
        "<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>{title} - Betsee Desk</title><style>{PAGE_STYLE}</style><body><main><div class=brand><svg viewBox=\"0 0 100 100\" aria-hidden=true><path fill-rule=evenodd d=\"{MARK}\"/></svg>Betsee</div><h1>{title}</h1><p>{body}</p>{detail}</main>"
    ))
}

async fn callback(State(host): State<Arc<Host>>, Query(query): Query<Callback>) -> Response {
    let Ok(desk) = desk(&host) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Some(error) = query.error {
        return page(
            "Sign-in not completed",
            "Start again from Betsee Desk.",
            Some(&error),
        )
        .into_response();
    }
    let verifier = match &query.state {
        Some(state) => desk.pending.lock().await.remove(state),
        None => None,
    };
    let (Some(code), Some(verifier)) = (query.code, verifier) else {
        return page(
            "Sign-in link expired",
            "Start again from Betsee Desk.",
            None,
        )
        .into_response();
    };
    let response = host
        .http
        .post(desk.endpoint("token"))
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", desk.config.redirect_uri.as_str()),
            ("client_id", desk.config.client_id.as_str()),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await;
    let tokens: Option<Value> = match response {
        Ok(response) if response.status().is_success() => response.json().await.ok(),
        _ => None,
    };
    match tokens.as_ref().and_then(Login::from_tokens) {
        Some(login) => {
            *desk.login.lock().await = Some(login);
            page(
                "Signed in",
                "You can close this tab and return to Betsee Desk.",
                None,
            )
            .into_response()
        }
        None => page(
            "Sign-in failed",
            "No token was issued. Start again from Betsee Desk.",
            None,
        )
        .into_response(),
    }
}

async fn logout(State(host): State<Arc<Host>>, headers: HeaderMap) -> DeskResult {
    let desk = guard(&host, &headers)?;
    *desk.login.lock().await = None;
    Ok(Json(json!({"signed_in":false})))
}

async fn state(State(host): State<Arc<Host>>, headers: HeaderMap) -> DeskResult {
    let desk = guard(&host, &headers)?;
    let human = match desk.access_token(&host.http).await {
        Ok(token) => host.human(&token).await.ok(),
        Err(_) => None,
    };
    let anthropic = host.keys.lock().await.anthropic.is_some();
    let codex_home = host.config.codex_home.clone();
    let statuses = tokio::task::spawn_blocking(move || {
        vec![
            runtime::status(Runtime::Claude, &codex_home, anthropic),
            runtime::status(Runtime::Codex, &codex_home, false),
        ]
    })
    .await
    .unwrap_or_default();
    Ok(Json(json!({
        "signed_in": human.is_some(),
        "human": human,
        "runtime": *host.runtime.lock().await,
        "runtimes": statuses,
        "workspace": host.config.workspace,
        "gateway": host.config.gateway,
    })))
}

#[derive(Deserialize)]
struct Choose {
    runtime: Runtime,
}

async fn choose(
    State(host): State<Arc<Host>>,
    headers: HeaderMap,
    Json(body): Json<Choose>,
) -> DeskResult {
    guard(&host, &headers)?;
    *host.runtime.lock().await = body.runtime;
    Ok(Json(json!({"runtime":body.runtime})))
}

#[derive(Deserialize)]
struct KeyBody {
    runtime: Runtime,
    key: Option<String>,
}

/// Bring-your-own key. Claude: kept owner-only and passed as ANTHROPIC_API_KEY to Claude Code.
/// Codex: handed to `codex login --with-api-key` inside the Betsee-owned CODEX_HOME.
async fn set_key(
    State(host): State<Arc<Host>>,
    headers: HeaderMap,
    Json(body): Json<KeyBody>,
) -> DeskResult {
    guard(&host, &headers)?;
    let key = body
        .key
        .map(|key| key.trim().to_owned())
        .filter(|key| !key.is_empty());
    match body.runtime {
        Runtime::Claude => {
            let mut keys = host.keys.lock().await;
            keys.anthropic = key;
            keys.save(&host.config.state_dir)
                .map_err(|error| DeskError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        }
        Runtime::Codex => {
            let key = key.ok_or_else(|| {
                DeskError(StatusCode::BAD_REQUEST, "Enter an OpenAI API key".into())
            })?;
            let binary = runtime::which("codex").ok_or_else(|| {
                DeskError(StatusCode::BAD_REQUEST, "Codex is not installed".into())
            })?;
            let mut child = tokio::process::Command::new(binary)
                .args(["login", "--with-api-key"])
                .env("CODEX_HOME", &host.config.codex_home)
                .env("PATH", runtime::login_path())
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .map_err(|error| DeskError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            if let Some(mut stdin) = child.stdin.take() {
                use tokio::io::AsyncWriteExt;
                let _ = stdin.write_all(key.as_bytes()).await;
            }
            let output = child
                .wait_with_output()
                .await
                .map_err(|error| DeskError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            if !output.status.success() {
                return Err(DeskError(
                    StatusCode::BAD_REQUEST,
                    "Codex rejected the API key".into(),
                ));
            }
        }
    }
    Ok(Json(json!({"ok":true})))
}

/// Uses the person's existing Codex sign-in: their auth.json is copied, owner-only, into the
/// Betsee-owned CODEX_HOME. Their own config, rules and hooks are not copied.
async fn import_codex(State(host): State<Arc<Host>>, headers: HeaderMap) -> DeskResult {
    guard(&host, &headers)?;
    let home = std::env::var("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".codex")
        });
    let bytes = std::fs::read(home.join("auth.json")).map_err(|_| {
        DeskError(
            StatusCode::BAD_REQUEST,
            "No Codex sign-in found; run `codex login` first".into(),
        )
    })?;
    write_private(&host.config.codex_home.join("auth.json"), &bytes)
        .map_err(|error| DeskError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    Ok(Json(json!({"ok":true})))
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    options.mode(0o600);
    options.open(path)?.write_all(bytes)
}

/// Paths inside the workspace only; the agent's own files are listed, hidden files are not.
fn workspace_path(workspace: &Path, relative: &str) -> Option<PathBuf> {
    let candidate = workspace.join(relative.trim_start_matches('/'));
    let resolved = candidate.canonicalize().ok()?;
    resolved.starts_with(workspace).then_some(resolved)
}

async fn files(State(host): State<Arc<Host>>, headers: HeaderMap) -> DeskResult {
    guard(&host, &headers)?;
    let root = host.config.workspace.clone();
    let mut items = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push(path);
            } else if let Ok(relative) = path.strip_prefix(&root) {
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs());
                items.push(json!({"path":relative.to_string_lossy(),"size":meta.len(),"modified":modified}));
            }
        }
    }
    items.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
    Ok(Json(json!({"items":items})))
}

#[derive(Deserialize)]
struct Upload {
    chat_id: String,
    name: String,
    content_base64: String,
    tier: Option<String>,
}

async fn chat_session(
    host: &Host,
    headers: &HeaderMap,
    chat_id: &str,
) -> DeskResult<(String, String)> {
    let (token, _) = host
        .owned(headers, chat_id)
        .await
        .map_err(|_| DeskError(StatusCode::NOT_FOUND, "Chat not found".into()))?;
    let session = host
        .session_of(chat_id)
        .await
        .ok_or_else(|| DeskError(StatusCode::NOT_FOUND, "Chat not found".into()))?;
    Ok((token, session))
}

async fn gateway_file(host: &Host, token: &str, route: &str, body: Value) -> DeskResult<Value> {
    let response = host
        .http
        .post(format!("{}/api/v1/files/{route}", host.config.gateway))
        .bearer_auth(token)
        .timeout(Duration::from_secs(60))
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            DeskError(
                StatusCode::SERVICE_UNAVAILABLE,
                format!(
                    "Betsee Gateway unreachable, so the file was not moved (fail closed): {error}"
                ),
            )
        })?;
    let status = response.status();
    let value: Value = response.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(DeskError(
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            value["message"]
                .as_str()
                .unwrap_or("The Gateway refused the file")
                .to_owned(),
        ));
    }
    Ok(value)
}

fn reasons(trace: &Value) -> Vec<Value> {
    trace["reasons"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|reason| {
            reason
                .get("text")
                .cloned()
                .unwrap_or_else(|| reason.clone())
        })
        .collect()
}

async fn upload(
    State(host): State<Arc<Host>>,
    headers: HeaderMap,
    Json(body): Json<Upload>,
) -> DeskResult {
    guard(&host, &headers)?;
    let (token, session) = chat_session(&host, &headers, &body.chat_id).await?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(body.content_base64.as_bytes())
        .map_err(|_| DeskError(StatusCode::BAD_REQUEST, "File content is not base64".into()))?;
    let trace = gateway_file(
        &host,
        &token,
        "intake",
        json!({"session_id":session,"name":body.name,"content_base64":body.content_base64,"tier":body.tier}),
    )
    .await;
    let trace = match trace {
        Ok(trace) => trace,
        Err(error) => {
            host.push(&body.chat_id, json!({"type":"file_blocked","direction":"upload","name":body.name,"reasons":[error.1],"control_ids":["CTL-FILE-001"],"trace_id":null,"findings":[]})).await;
            return Err(error);
        }
    };
    let allowed = trace["decision"] == "allow";
    let resource = trace["file"]["resource_id"]
        .as_str()
        .unwrap_or("")
        .to_owned();
    if allowed {
        // The Gateway catalogued workspace/uploads/<name>; write exactly the scanned bytes there.
        let relative = resource.trim_start_matches("workspace/");
        let target = host.config.workspace.join(relative);
        if !target.starts_with(host.config.workspace.join("uploads")) {
            return Err(DeskError(
                StatusCode::BAD_GATEWAY,
                "Unexpected upload location".into(),
            ));
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| DeskError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        }
        std::fs::write(&target, &bytes)
            .map_err(|error| DeskError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }
    let event = json!({"type": if allowed {"file_shared"} else {"file_blocked"},"direction":"upload","name":body.name,"path":resource.trim_start_matches("workspace/"),"tier":trace["resource"]["tier"],"kind":trace["file"]["kind"],"size":trace["file"]["size"],"reasons":reasons(&trace),"control_ids":trace["control_ids"],"trace_id":trace["trace_id"],"findings":trace["findings"]});
    host.push(&body.chat_id, event.clone()).await;
    Ok(Json(event))
}

#[derive(Deserialize)]
struct Download {
    chat_id: String,
    path: String,
}

async fn download(
    State(host): State<Arc<Host>>,
    headers: HeaderMap,
    Json(body): Json<Download>,
) -> DeskResult {
    guard(&host, &headers)?;
    let (token, session) = chat_session(&host, &headers, &body.chat_id).await?;
    let path = workspace_path(&host.config.workspace, &body.path).ok_or_else(|| {
        DeskError(
            StatusCode::NOT_FOUND,
            "No such file in the workspace".into(),
        )
    })?;
    let relative = path
        .strip_prefix(&host.config.workspace)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let bytes = std::fs::read(&path)
        .map_err(|_| DeskError(StatusCode::NOT_FOUND, "File unreadable".into()))?;
    let content = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let trace = gateway_file(
        &host,
        &token,
        "release",
        json!({"session_id":session,"name":format!("workspace/{relative}"),"content_base64":content}),
    )
    .await;
    let trace = match trace {
        Ok(trace) => trace,
        Err(error) => {
            host.push(&body.chat_id, json!({"type":"file_blocked","direction":"download","name":relative,"path":relative,"reasons":[error.1],"control_ids":["CTL-FILE-001"],"trace_id":null,"findings":[]})).await;
            return Err(error);
        }
    };
    let allowed = trace["decision"] == "allow";
    let mut event = json!({"type": if allowed {"file_released"} else {"file_blocked"},"direction":"download","name":Path::new(&relative).file_name().map(|n| n.to_string_lossy().into_owned()),"path":relative,"tier":trace["resource"]["tier"],"kind":trace["file"]["kind"],"size":bytes.len(),"reasons":reasons(&trace),"control_ids":trace["control_ids"],"trace_id":trace["trace_id"],"findings":trace["findings"]});
    host.push(&body.chat_id, event.clone()).await;
    if allowed {
        event["content_base64"] = json!(content);
    }
    Ok(Json(event))
}

pub fn router() -> Router<Arc<Host>> {
    Router::new()
        .route("/desk/login", get(login))
        .route("/desk/callback", get(callback))
        .route("/desk/logout", post(logout))
        .route("/desk/state", get(state))
        .route("/desk/runtime", post(choose))
        .route("/desk/runtime/key", post(set_key))
        .route("/desk/runtime/codex/import", post(import_codex))
        .route("/desk/files", get(files))
        .route("/desk/files/upload", post(upload))
        .route("/desk/files/download", post(download))
        .layer(axum::extract::DefaultBodyLimit::max(12 * 1024 * 1024))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desk_token_compare_is_exact() {
        assert!(constant_eq(b"abc", b"abc"));
        assert!(!constant_eq(b"abc", b"abd"));
        assert!(!constant_eq(b"abc", b"ab"));
    }
    #[test]
    fn workspace_paths_cannot_escape() {
        let root = std::env::temp_dir().join(format!("betsee-desk-{}", std::process::id()));
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("notes/a.md"), "x").unwrap();
        let root = root.canonicalize().unwrap();
        assert!(workspace_path(&root, "notes/a.md").is_some());
        assert!(workspace_path(&root, "../../etc/passwd").is_none());
        assert!(workspace_path(&root, "/etc/passwd").is_none());
    }
}
