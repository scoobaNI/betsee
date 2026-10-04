//! Betsee Desk: a desktop workspace where a person uses Claude Code or Codex with their own login or
//! API key, and Betsee governs everything: what they type, every tool call, every file in or out.
//! The governing service is agent-host, embedded here and listening on loopback only; the window
//! talks to it with a per-launch desk token. The same binary is the runtimes' PreToolUse hook.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine as _;
use betsee_agent_host::{
    desk::DeskConfig,
    hook,
    runtime::Runtime,
    server::{self, Config},
};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const PORT: u16 = 8097;
/// Largest file the Gateway scans; anything larger is refused before upload.
const MAX_FILE: u64 = 8 * 1024 * 1024;

/// The demo employee workspace, the same files the Gateway catalogue labels.
const DEMO_WORKSPACE: [(&str, &[u8]); 6] = [
    (
        "README.md",
        include_bytes!("../../../demo/workspace/README.md"),
    ),
    (
        "handbook/onboarding.md",
        include_bytes!("../../../demo/workspace/handbook/onboarding.md"),
    ),
    (
        "handbook/expense-policy.md",
        include_bytes!("../../../demo/workspace/handbook/expense-policy.md"),
    ),
    (
        "notes/team-sync.md",
        include_bytes!("../../../demo/workspace/notes/team-sync.md"),
    ),
    (
        "finance/q4-budget.csv",
        include_bytes!("../../../demo/workspace/finance/q4-budget.csv"),
    ),
    (
        "hr/salaries-2026.csv",
        include_bytes!("../../../demo/workspace/hr/salaries-2026.csv"),
    ),
];

#[derive(Clone, Serialize)]
struct Bootstrap {
    api: String,
    token: String,
}

#[derive(Serialize)]
struct PickedFile {
    name: String,
    size: u64,
    content_base64: String,
}

fn data_dir() -> PathBuf {
    let base = std::env::var("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".local/share")
        });
    base.join("betsee-desk")
}

fn seed_workspace(workspace: &Path) -> std::io::Result<()> {
    if workspace.join("README.md").exists() {
        return Ok(());
    }
    for (path, bytes) in DEMO_WORKSPACE {
        let target = workspace.join(path);
        std::fs::create_dir_all(target.parent().expect("demo files sit in folders"))?;
        std::fs::write(target, bytes)?;
    }
    std::fs::create_dir_all(workspace.join("uploads"))
}

/// Reads a file the person picked or dropped: the real path, a regular file, within the scan limit.
/// (Same rules as Crabify's dropped-file reader.)
fn read_local(path: &str) -> Result<PickedFile, String> {
    let real =
        std::fs::canonicalize(path).map_err(|_| "The file could not be opened".to_owned())?;
    let meta = std::fs::metadata(&real).map_err(|_| "The file could not be opened".to_owned())?;
    if !meta.is_file() {
        return Err("Only files can be sent, not folders".into());
    }
    if meta.len() > MAX_FILE {
        return Err("Betsee scans files up to 8 MiB; this one is larger".into());
    }
    let bytes = std::fs::read(&real).map_err(|_| "The file could not be read".to_owned())?;
    Ok(PickedFile {
        name: real
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "file".into()),
        size: meta.len(),
        content_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[tauri::command]
fn bootstrap(state: tauri::State<'_, Bootstrap>) -> Bootstrap {
    state.inner().clone()
}

#[tauri::command]
fn open_sign_in(app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(format!("http://127.0.0.1:{PORT}/desk/login"), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only web links open outside Betsee Desk".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn read_dropped(paths: Vec<String>) -> Vec<Result<PickedFile, String>> {
    paths.iter().map(|path| read_local(path)).collect()
}

#[tauri::command]
async fn pick_files(app: tauri::AppHandle) -> Vec<Result<PickedFile, String>> {
    let picked = app
        .dialog()
        .file()
        .set_title("Send files to the assistant")
        .blocking_pick_files();
    picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| path.into_path().ok())
        .map(|path| read_local(&path.to_string_lossy()))
        .collect()
}

#[tauri::command]
async fn save_file(
    app: tauri::AppHandle,
    name: String,
    content_base64: String,
) -> Result<Option<String>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content_base64.as_bytes())
        .map_err(|_| "The file content was not valid".to_owned())?;
    let Some(target) = app
        .dialog()
        .file()
        .set_file_name(&name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = target.into_path().map_err(|error| error.to_string())?;
    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("hook") {
        // Exit code 2 blocks the tool call, so a crash in the hook never lets one through.
        std::panic::set_hook(Box::new(|info| {
            eprintln!("Betsee hook failed ({info}); tool call denied (fail closed)");
            std::process::exit(2);
        }));
        println!("{}", hook::output(&hook::run()));
        return;
    }
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let data = data_dir();
    let workspace = std::env::var("BETSEE_DESK_WORKSPACE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| data.join("workspace"));
    std::fs::create_dir_all(&workspace).expect("workspace directory");
    seed_workspace(&workspace).expect("demo workspace");
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let issuer = std::env::var("BETSEE_ISSUER")
        .unwrap_or_else(|_| "http://auth.betsee.localhost/realms/betsee".into());
    let config = Config {
        listen: vec![
            format!("127.0.0.1:{PORT}")
                .parse()
                .expect("loopback address"),
        ],
        gateway: std::env::var("BETSEE_GATEWAY_URL")
            .unwrap_or_else(|_| "http://api.betsee.localhost".into()),
        token_url: format!("{issuer}/protocol/openid-connect/token"),
        client_id: "employee-assistant".into(),
        // Demo only: the agent's client secret sits with the desktop app. A deployment mints agent
        // tokens server-side and never ships this secret to a laptop.
        client_secret: std::env::var("AGENT_CLIENT_SECRET")
            .unwrap_or_else(|_| "employee-assistant-demo-secret".into()),
        workspace: workspace.canonicalize().expect("workspace path"),
        state_dir: data.join("agent-host"),
        claude: "claude".into(),
        model: std::env::var("CLAUDE_MODEL")
            .ok()
            .filter(|model| !model.is_empty()),
        approval_wait_secs: 150,
        runtime: Runtime::Claude,
        codex_home: data.join("agent-host/codex-home"),
        desk: Some(DeskConfig {
            token: token.clone(),
            issuer,
            client_id: "betsee-desk".into(),
            redirect_uri: format!("http://127.0.0.1:{PORT}/desk/callback"),
        }),
    };
    if std::env::args().nth(1).as_deref() == Some("--serve-only") {
        // The governing service without a window: the same UI then runs in a browser at
        // http://localhost:1430/?api=...&token=... (development and automated tests).
        println!("BETSEE_DESK api=http://127.0.0.1:{PORT} token={token}");
        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
        if let Err(error) = runtime.block_on(server::serve(config)) {
            eprintln!("Betsee Desk could not start its governing service: {error:#}");
            std::process::exit(1);
        }
        return;
    }
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
        if let Err(error) = runtime.block_on(server::serve(config)) {
            eprintln!("Betsee Desk could not start its governing service: {error:#}");
            std::process::exit(1);
        }
    });
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Bootstrap {
            api: format!("http://127.0.0.1:{PORT}"),
            token,
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            open_sign_in,
            open_external,
            read_dropped,
            pick_files,
            save_file
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Betsee Desk");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Betsee Desk failed to start");
}
