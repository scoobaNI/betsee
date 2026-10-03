# Betsee SSE contract v0.1

`GET /api/v1/events/stream` returns `text/event-stream`. It requires a valid human token in
Authorization: Bearer, with security-officer or org-admin role. Cookies are never accepted (D9).
Browsers use fetch-based SSE. Agent tokens cannot read the
organization feed. All list resources return `{ "items": [...] }`.

Each event has a PostgreSQL-generated, monotonically increasing decimal `id`, a named `event`, and
one JSON `data` value. IDs may have gaps. Delivery is at least once; clients deduplicate by ID.
The server emits `: ping` every 15 seconds. Client reconnect uses `Last-Event-ID`; the server
replays persisted events greater than that ID in ascending order before tailing live events.
Clients without a cursor receive the latest 100 events in ascending order. Audit and event rows
are persisted before an event is visible. Slow consumers reconnect and replay from their cursor.

```text
id: 42
event: action.decided
data: {"trace_id":"...","decision":"deny","executed":false,...}

: ping

```

| Event | JSON payload schema in openapi.yaml | Meaning |
| --- | --- | --- |
| `action.decided` | ActionSummary | Initial decision, including denials and queued approvals |
| `action.updated` | ActionSummary | Same trace_id after approval, rejection or step-up |
| `agent.state_changed` | AgentStateChanged | Lifecycle change, including automatic quarantine |
| `message.mediated` | AgentMessage | Allowed or blocked mediated message; blocked content is never delivered |
| `session.started` | AgentSession | Human created an agent run |
| `session.ended` | AgentSession | Run closed or revoked |
| `tool.descriptor_changed` | ToolDescriptorChanged | Tool pin mismatch blocks the tool; restore retains the reviewed pin |
| `security.event` | SecurityEvent | Structured security event with a closed type and severity |

This is the versioned closed event vocabulary. Changes within this version are additive; clients
ignore unknown event types. SecurityEvent types are `breaker_tripped`, `agent_quarantined`,
`descriptor_drift`, `step_up_failed`, `approval_rejected`, `token_rejected`, `trace_id_reused`.
Severities are `info | low | medium | high | critical`.

`GET /api/v1/summary` returns `agents_active`, `actions_last_15m`, `denied_last_15m`,
`awaiting_human`, and `stage_counts` (a map from all 15 D6 stage names to counts). The server counts
unique actions and their current decisions; approval updates do not double count.

Incoming valid W3C trace IDs are used for new actions. Reusing an existing action's ID mints a fresh
ID, retains `caller_trace_id`, and emits a `trace_id_reused` security event. Original evidence stays
unchanged. Audit rows also carry an independent server-generated primary key.

ActionSummary carries human, agent, use case, capability, resource, tool, deterministic_decision,
decision, analyzer, ai_tightened, controls, policies, reasons, approval_state, latency_ms, executed
and output. Analyzer `model_label` is always `mock model (demo)` in this demo; skipped and unavailable
verdicts remain explicit. A deterministic deny cannot be loosened by analysis or human approval.

Trace detail uses these stages, in order: `authenticate`, `resolve_context`, `identity`,
`capability`, `cedar_authz`, `information_tier`, `command_validation`, `budget`,
`ai_analysis`, `decision`, `approval`, `step_up`, `connector`, `output_controls`, `audit`.
Span status is `passed | denied | tightened | pending | skipped`. Missing spans mean the stage
was not reached. Approval and step_up attributes include approver sub/name, decided_at and acr.
Every audit record retains the resolved execution context for later OpenTelemetry export.

Approval IDs bind the exact persisted ActionRequest and its hash. Approve may return
`status: step_up_required`, `acr_values: "2"` without executing anything. After Keycloak step-up,
the approver retries with the fresh token. The Gateway checks current controls before execution;
the agent's persuasive summary never replaces the stored parameters shown to the approver.
