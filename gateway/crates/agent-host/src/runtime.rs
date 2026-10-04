//! The two agent runtimes Betsee governs: Claude Code and Codex. Detection, login state and the
//! exact command line each one runs with. Both run headless under a PreToolUse hook that asks the
//! Gateway before every tool call; Codex additionally needs flags that close its fail-open paths
//! (see `codex_args`).
//!
//! The login-shell PATH probe follows the approach of Crabify's shell_env (same author): a
//! desktop app launched from the menu has no shell PATH, so the CLIs would not be found.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::OnceLock,
    time::Duration,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Runtime {
    Claude,
    Codex,
}

impl Runtime {
    pub fn binary(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            _ => None,
        }
    }
}

static LOGIN_PATH: OnceLock<String> = OnceLock::new();

/// PATH of the user's login shell, plus the usual install locations of npm, cargo and installers.
pub fn login_path() -> &'static str {
    LOGIN_PATH.get_or_init(|| {
        let home = std::env::var("HOME").unwrap_or_default();
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let probed = run_with_timeout(
            Command::new(&shell).args(["-lc", "printf %s \"$PATH\""]),
            Duration::from_secs(5),
        )
        .unwrap_or_default();
        let mut dirs: Vec<String> = probed
            .split(':')
            .chain(std::env::var("PATH").unwrap_or_default().split(':'))
            .map(str::to_owned)
            .collect();
        for extra in [
            format!("{home}/.local/bin"),
            format!("{home}/.npm-global/bin"),
            format!("{home}/.cargo/bin"),
            format!("{home}/.bun/bin"),
            "/usr/local/bin".into(),
            "/opt/homebrew/bin".into(),
            "/usr/bin".into(),
            "/bin".into(),
        ] {
            dirs.push(extra);
        }
        let mut seen = std::collections::HashSet::new();
        dirs.retain(|dir| !dir.is_empty() && seen.insert(dir.clone()));
        dirs.join(":")
    })
}

fn run_with_timeout(command: &mut Command, limit: Duration) -> Option<String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let deadline = std::time::Instant::now() + limit;
    loop {
        match child.try_wait().ok()? {
            Some(_) => break,
            None if std::time::Instant::now() > deadline => {
                let _ = child.kill();
                return None;
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    }
    let output = child.wait_with_output().ok()?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    if !output.status.success() {
        text = format!(
            "__exit {}\n{}{}",
            output.status.code().unwrap_or(-1),
            text,
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Some(text)
}

pub fn which(binary: &str) -> Option<PathBuf> {
    login_path()
        .split(':')
        .map(|dir| Path::new(dir).join(binary))
        .find(|candidate| candidate.is_file())
}

#[derive(Clone, Debug, Serialize)]
pub struct RuntimeStatus {
    pub runtime: Runtime,
    pub label: &'static str,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub logged_in: bool,
    /// How the runtime authenticates: subscription login, API key, or none.
    pub auth: String,
    pub detail: String,
}

/// Version and login state. `codex_home` is the Betsee-owned CODEX_HOME, never the user's own.
pub fn status(runtime: Runtime, codex_home: &Path, api_key: bool) -> RuntimeStatus {
    let path = which(runtime.binary());
    let mut status = RuntimeStatus {
        runtime,
        label: runtime.label(),
        installed: path.is_some(),
        path: path.as_ref().map(|p| p.to_string_lossy().into_owned()),
        version: None,
        logged_in: false,
        auth: "none".into(),
        detail: format!("{} is not installed or not on PATH", runtime.binary()),
    };
    let Some(path) = path else { return status };
    status.version = run_with_timeout(
        Command::new(&path)
            .arg("--version")
            .env("PATH", login_path()),
        Duration::from_secs(10),
    )
    .map(|text| text.lines().next().unwrap_or("").trim().to_owned());
    match runtime {
        Runtime::Claude => {
            let output = run_with_timeout(
                Command::new(&path)
                    .args(["auth", "status"])
                    .env("PATH", login_path()),
                Duration::from_secs(15),
            )
            .unwrap_or_default();
            let parsed: Option<Value> = serde_json::from_str(output.trim()).ok();
            let logged = parsed
                .as_ref()
                .is_some_and(|value| value["loggedIn"] == true);
            status.logged_in = logged || api_key;
            status.auth = if api_key {
                "api_key".into()
            } else if logged {
                parsed
                    .as_ref()
                    .and_then(|value| value["authMethod"].as_str())
                    .unwrap_or("login")
                    .to_owned()
            } else {
                "none".into()
            };
            status.detail = if status.logged_in {
                "Ready".into()
            } else {
                "Not signed in: run `claude auth login` in a terminal, or add an Anthropic API key"
                    .into()
            };
        }
        Runtime::Codex => {
            let output = run_with_timeout(
                Command::new(&path)
                    .args(["login", "status"])
                    .env("PATH", login_path())
                    .env("CODEX_HOME", codex_home),
                Duration::from_secs(15),
            )
            .unwrap_or_default();
            status.logged_in = !output.starts_with("__exit") && output.contains("Logged in");
            status.auth = if !status.logged_in {
                "none".into()
            } else if output.contains("API key") {
                "api_key".into()
            } else {
                "chatgpt".into()
            };
            status.detail = if status.logged_in {
                "Ready".into()
            } else {
                "Not signed in for Betsee: import your Codex login or add an OpenAI API key".into()
            };
        }
    }
    status
}

/// The hooks file both runtimes read. The hook command outlives the longest approval wait, and the
/// hook enforces its own shorter deadline so it always answers deny rather than timing out (a Codex
/// hook timeout lets the call through).
pub fn hooks_json(hook_command: &str, timeout_secs: u64, codex: bool) -> Value {
    let matcher = if codex { ".*" } else { "*" };
    json!({"hooks":{"PreToolUse":[{"matcher":matcher,"hooks":[{"type":"command","command":hook_command,"timeout":timeout_secs}]}]}})
}

/// Codex exec under the Betsee hook. Each flag closes a path measured to fail open:
/// - `--dangerously-bypass-hook-trust`: without trust, Codex silently skips an untrusted hook;
/// - `--disable unified_exec_tty`: a TTY session accepts `write_stdin`, which never meets the hook;
/// - an explicit sandbox, also on resume, where it is otherwise not carried over;
/// - a Betsee-owned CODEX_HOME (set by the caller), so no user config or hook layering applies.
pub fn codex_args(workspace: &Path, resume: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = vec!["exec".into()];
    if let Some(thread) = resume {
        args.extend(["resume".into(), "--json".into()]);
        args.extend(common_codex_flags());
        args.extend(["-c".into(), "sandbox_mode=\"workspace-write\"".into()]);
        args.extend([thread.into(), "-".into()]);
    } else {
        args.push("--json".into());
        args.extend(common_codex_flags());
        args.extend([
            "-s".into(),
            "workspace-write".into(),
            "-C".into(),
            workspace.to_string_lossy().into_owned(),
            "-".into(),
        ]);
    }
    args
}

fn common_codex_flags() -> Vec<String> {
    [
        "--skip-git-repo-check",
        "--dangerously-bypass-hook-trust",
        "--disable",
        "unified_exec_tty",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn codex_runs_with_every_fail_open_path_closed() {
        let first = codex_args(Path::new("/w"), None);
        let resumed = codex_args(Path::new("/w"), Some("t-1"));
        for args in [&first, &resumed] {
            assert!(args.contains(&"--dangerously-bypass-hook-trust".to_owned()));
            assert!(
                args.windows(2)
                    .any(|w| w == ["--disable", "unified_exec_tty"])
            );
            assert_eq!(args.last().map(String::as_str), Some("-"));
        }
        assert!(first.windows(2).any(|w| w == ["-s", "workspace-write"]));
        assert!(resumed.contains(&"sandbox_mode=\"workspace-write\"".to_owned()));
        assert!(
            !first
                .iter()
                .any(|a| a.contains("dangerously-bypass-approvals"))
        );
    }
    #[test]
    fn hooks_match_every_tool() {
        assert_eq!(
            hooks_json("h", 9, true)["hooks"]["PreToolUse"][0]["matcher"],
            ".*"
        );
        assert_eq!(
            hooks_json("h", 9, false)["hooks"]["PreToolUse"][0]["matcher"],
            "*"
        );
    }
}
