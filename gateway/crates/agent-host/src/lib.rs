//! Betsee agent-host: runs an agent runtime (Claude Code or Codex) for a person and governs every
//! tool call through the Betsee Gateway. Used by the `agent-host` service behind the web chat and
//! embedded in the Betsee Desk desktop app.

pub mod desk;
pub mod hook;
pub mod mapping;
pub mod runtime;
pub mod server;
