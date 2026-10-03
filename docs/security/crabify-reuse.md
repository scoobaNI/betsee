# Crabify reuse report (F01)

Status: v0, 2026-10-03, time-boxed to 30 minutes. Owner: security-architect.

Source: a read-only survey of `~/Repos/crabify` (Tauri desktop app, Rust and React, about 40k lines in
the files examined). The claims below were spot-checked against the code: the licence text, the
functions in `docker.rs`, socket authentication in `cli_server.rs`, and the board post model in
`runBoard.ts`.

## Verdict

**Betsee stays independent of Crabify.** It has no runtime dependency on it and shares no crate or
package, and no Crabify code is copied in. Crabify is the tool building Betsee, not a component of
it. The two runtimes do not match:

| Aspect      | Crabify                                                          | Betsee                                |
| ----------- | ---------------------------------------------------------------- | ------------------------------------- |
| Concurrency | desktop, std threads, blocking IO                                | server, tokio and axum                |
| Transport   | Unix socket NDJSON                                               | HTTP and SSE                          |
| State       | client-side `localStorage`                                       | PostgreSQL                            |
| Identity    | one per-boot token                                               | Keycloak principals                   |
| Crates      | none of tokio, axum, sqlx or jsonwebtoken as direct dependencies | the gateway stack depends on all four |

Copying code would bring in the wrong runtime model and save little.

Two further reasons:

- **Licence.** `LICENSE` is a proprietary EULA ("All rights reserved"). Section 3 forbids copying,
  modification and derivative works. Only the copyright holder can lift that. If Betsee is to belong
  to a different legal entity, a written licence or assignment comes first.
- **Patterns are enough.** Reusing ideas avoids the licence question altogether and costs nothing
  today.

## Mechanisms worth reusing, as patterns

Each item below has a concrete place in Betsee. Anything without one is left out.

| Crabify mechanism                                                                                                                                 | Where it lands in Betsee                                                                                                                                                                  | Status                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Board rule "the owner cannot verify their own item" (`src/lib/runBoard.ts`)                                                                       | Four-eyes on approvals: the approver is never the session's human (CTL-APR-004, ADR-0001 D1)                                                                                              | adopted                                            |
| Pure spec, so what is previewed is what is spawned (`docker.rs`: `build_spec`, `render_argv`, `render_preview`)                                   | An approval binds to a hash of the exact ActionRequest, so the approved action is the one executed (CTL-APR-004)                                                                          | adopted                                            |
| LLM output only proposes; pure rules decide (`crab_help.rs`)                                                                                      | The analyzer can only tighten; Cedar and the composition decide (CTL-AI-001)                                                                                                              | adopted (confirms the design)                      |
| Closed event enum, with a test that forbids free-form strings (`telemetry.rs`); additive-only protocol with ignore-unknown tags (`crabify-proto`) | Security event and SSE schema discipline: a closed `type` enum, versioned, additive changes only, clients ignore unknown types. Recommended to backend-gateway for `contracts/events.md`. | recommended                                        |
| URL validation that rejects userinfo and plain HTTP except exact loopback (`credentials.rs` `normalize_base_url`)                                 | Connector base URLs (`OPENAI_BASE_URL` for company gateways, vLLM, Ollama). Reject userinfo; in-network HTTP only through explicit config.                                                | recommended for F12                                |
| Monitor mode next to enforce (`sandbox.rs`, `SandboxModeSelector.tsx`)                                                                            | A control in "monitor" mode logs would-be denials without blocking: the safe rollout path for new policies                                                                                | later (v1, not in the demo)                        |
| Egress allowlist proxy whose 403 says why, with per-task deny counters (`proxy.rs`)                                                               | Connector egress control                                                                                                                                                                  | later; the Gateway is already the egress for tools |

## A lesson from a Crabify weakness

The board's sender (`from`) is not authenticated. All callers share one per-boot token, and the
acting task comes from the caller's own `--task` or working directory (`cli_server.rs`
`resolve_task_arg`). **Betsee must not repeat this for agent-to-agent messages:** the sender of an
`AgentMessage` is the agent authenticated by the token's `azp`, never a field in the message body.
This goes to backend-gateway for F11.

## Unnecessary complexity: stays out of Betsee

- macOS Seatbelt profiles (`sandbox.rs`). macOS-only, and inactive in shipped builds
  (`docs/sandbox.md`).
- The Docker cage for agent processes. Betsee does not run agent code on the host; it governs agent
  actions.
- PTY and terminal-screen reading, including permission answering from the screen
  (`permissionAnswer.ts`).
- The Tauri command layer (`lib.rs`, 20k lines), named pipes, job objects and the JS automation
  bridge.
- The Unix-socket NDJSON RPC and the per-boot shared token. Betsee has Keycloak principals.
- The keyring-backed encrypted cache (`atlas_cache.rs`) and `localStorage` persistence.

## UI

Crabify's `src/components/ui` primitives (Radix plus Tailwind, shadcn-style) suit Betsee's React and
Tailwind v4 stack. Take the same primitives from upstream shadcn/ui (MIT) instead, so no licence
question arises; product-designer's Design Contract decides their look. Crabify has no trace
explorer, span timeline or graph view to borrow.

## Possible future integration (not built)

`docs/ideas/mcp.md` in Crabify sketches an MCP surface with per-task bearer tokens. Later, Crabify's
coding agents could be one more agent population governed by Betsee: each Crabify task becomes a
Betsee Agent with its own credential, and its tool calls pass through the Gateway. That would make
Crabify a customer of Betsee, not a dependency.
