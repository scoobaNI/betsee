//! Betsee agent-host: runs Claude Code for the employee chat on this machine, where the claude
//! CLI and its login live, and governs it through the Betsee Gateway.
//!
//! `agent-host` (or `agent-host serve`) runs the chat service; `agent-host hook` is the
//! PreToolUse hook Claude Code calls before every tool call.

mod hook;
mod mapping;
mod server;

fn main() -> std::process::ExitCode {
    match std::env::args().nth(1).as_deref() {
        Some("hook") => {
            // Exit code 2 blocks the tool call, so a crash here can never let one through.
            std::panic::set_hook(Box::new(|info| {
                eprintln!("Betsee hook failed ({info}); tool call denied (fail closed)");
                std::process::exit(2);
            }));
            let verdict = hook::run();
            println!("{}", hook::output(&verdict));
            std::process::ExitCode::SUCCESS
        }
        None | Some("serve") => {
            tracing_subscriber::fmt()
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| "info".into()),
                )
                .init();
            let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
            match runtime.block_on(async { server::serve(server::Config::from_env()?).await }) {
                Ok(()) => std::process::ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("agent-host: {error:#}");
                    std::process::ExitCode::FAILURE
                }
            }
        }
        Some(other) => {
            eprintln!("usage: agent-host [serve|hook] (unknown command {other})");
            std::process::ExitCode::from(64)
        }
    }
}
