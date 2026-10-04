# Betsee SSE contract v0.2

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

| Event                     | JSON payload schema in openapi.yaml | Meaning                                                                 |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `action.decided`          | ActionSummary                       | Initial decision, including denials and queued approvals                |
| `action.updated`          | ActionSummary                       | Same trace_id after approval, rejection or step-up                      |
| `agent.state_changed`     | AgentStateChanged                   | Lifecycle change, including automatic quarantine                        |
| `message.mediated`        | AgentMessage                        | Allowed or blocked mediated message; blocked content is never delivered |
| `session.started`         | AgentSession                        | Human created an agent run                                              |
| `session.ended`           | AgentSession                        | Run closed or revoked                                                   |
| `tool.descriptor_changed` | ToolDescriptorChanged               | Tool pin mismatch blocks the tool; restore retains the reviewed pin     |
| `security.event`          | SecurityEvent                       | Structured security event with a closed type and severity               |

This is the versioned closed event vocabulary. Changes within this version are additive; clients
ignore unknown event types. SecurityEvent types are `breaker_tripped`, `agent_quarantined`,
`descriptor_drift`, `step_up_failed`, `approval_rejected`, `token_rejected`, `trace_id_reused`,
`agent_released`, `control_attachment_changed`.
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

`execution` (optional, additive) says who executes after allow: `connector` (a Gateway connector),
`delegated` (the agent runtime executes after allow, CTL-RT-001; the Gateway decided and audited
but ran nothing, and `executed: true` means handed to the runtime) or `forwarded` (an input check,
CTL-IN-001: the human's message went on to the agent). Input checks are ordinary `action.decided`
events with capability `input.submit`, resource type `chat_input` and audit phase `input_check`;
they store masked findings only, never the matched text. Agent-runtime capabilities are
`files.read`, `files.write`, `shell.exec`, `web.egress` and `runtime.unmapped`.

Trace detail uses these stages, in order: `authenticate`, `resolve_context`, `identity`,
`capability`, `cedar_authz`, `information_tier`, `command_validation`, `budget`,
`ai_analysis`, `decision`, `approval`, `step_up`, `connector`, `output_controls`, `audit`.
Span status is `passed | denied | tightened | pending | skipped`. Missing spans mean the stage
was not reached. Approval and step_up attributes include approver sub/name, decided_at and acr.
Every audit record retains the resolved execution context for later OpenTelemetry export.

D11 timing: `duration_ms` is a measured number or `null`. Statuses derived from the same Cedar
evaluation have `duration_ms: null` and `parent_stage: "cedar_authz"`; clients render those as
status rows without a timing bar. The Cedar call itself has a measured duration. Token validation,
context resolution, analysis, connector execution, output controls and audit measure their own
boundaries. A zero duration must never stand in for an unmeasured boundary.

D12 decision reasons use `{ "policy_id": "...", "control_id": "CTL-...", "text": "..." }`.
Historical traces may retain string reasons. New reason text comes from policy annotations and
Gateway-owned facts, with a control explanation as fallback if a fact cannot be resolved. Tiers
are lowercase words; amounts use a grouped decimal amount followed by ISO currency, such as
`48,000.00 EUR`. Only deciding policies appear: hard forbids for a denial, obligations for a
pending action, permits for an allow. Analyzer `finding` carries the mock finding together with
`model_label`; the optional `analysis` field aliases `analyzer` for clients rendering findings.

An unknown or foreign session denial omits `human`, `use_case` and `session_id` in the agent
response. The human Director feed and append-only audit retain the resolved context (D9).

Approval IDs bind the exact persisted ActionRequest and its hash. Approve may return
`status: step_up_required`, `acr_values: "2"` without executing anything. After Keycloak step-up,
the approver retries with the fresh token. The Gateway checks current controls before execution;
the agent's persuasive summary never replaces the stored parameters shown to the approver.

`Approval.requested_reasons` retains the original reasons requiring human review after approval or
rejection. The approved action's `reasons` describe its execution re-check instead. Historical
approvals recover requested reasons from their first append-only pending audit record when available;
reading them does not rewrite the approval, trace or audit evidence.
`Approval.approver_acr` records the verified resolving human token's ACR. Historical records expose
it only from a resolved approval or step-up span matching the recorded approver; a requested step-up
does not prove that it happened.

Ending a session voids its still-pending approvals: the approval record and its trace move to
`approval_state` `voided` and emit an `action.updated` event, so the feed, the awaiting-human count
and every other trace consumer stop reporting a human as awaited on a session that has ended.

Every security event correlation resolves to a trace. Events outside an agent action use a
`record_type: security_observation` trace; tool transitions use `tool_observation`. Summary action
counters exclude both observation kinds. Summary reads are scoped to the human actor for employees.

## Betsee Desk chat stream

`GET /api/v1/chat/stream/{chat_id}` is served by the agent-host embedded in Betsee Desk on
`127.0.0.1:8097`, to the desktop window holding the per-launch desk token (fetch-based SSE,
`Last-Event-ID` resumes; ids are per chat and start at 1; `: ping` every 15 seconds). Each `data` is
one JSON object whose `type` equals the SSE event name and which carries `id` and `at`. Files add
`file_shared`, `file_blocked` and `file_released` events (`direction`, `name`, `path`, `tier`,
`kind`, `reasons`, `control_ids`, `trace_id`, masked `findings`).

| Event              | Payload fields                                                                                                                                                                                                                                            | Meaning                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `session`          | `session` (AgentSession)                                                                                                                                                                                                                                  | The Betsee session the chat runs in                                           |
| `user_message`     | `message_id`, `text`, `trace_id`, `control_ids`                                                                                                                                                                                                           | The message passed the content filter and went to the agent                   |
| `input_blocked`    | `message_id`, `reasons`, `control_ids`, `trace_id` (null when the filter was unreachable), `findings` (masked)                                                                                                                                            | The message stayed with the human; the model never saw it                     |
| `run_started`      | `model`, `tools`                                                                                                                                                                                                                                          | Claude Code started a turn                                                    |
| `assistant_text`   | `text`                                                                                                                                                                                                                                                    | Text from the assistant                                                       |
| `tool_call`        | `tool_use_id`, `tool`, `input` (long strings shortened)                                                                                                                                                                                                   | The agent asked to use a tool                                                 |
| `decision`         | `tool_use_id`, `tool`, `capability`, `resource`, `decision`, `approval_state`, `reasons`, `control_ids`, `policy_ids`, `trace_id`, `execution`; `waiting_seconds` while an approval is pending; `unreachable: true` when the Gateway could not be reached | The Gateway's decision on that tool call, as the hook received it             |
| `approval_timeout` | `tool_use_id`, `tool`, `trace_id`                                                                                                                                                                                                                         | The bounded wait ended; the call was denied and can be retried after approval |
| `tool_result`      | `tool_use_id`, `is_error`, `content` (at most 4000 characters)                                                                                                                                                                                            | What the tool returned, or the hook's denial                                  |
| `turn_end`         | `subtype`, `is_error`, `duration_ms`, `num_turns`, `total_cost_usd`                                                                                                                                                                                       | Claude Code finished the turn                                                 |
| `error`            | `message`                                                                                                                                                                                                                                                 | The run failed                                                                |
| `idle`             | none                                                                                                                                                                                                                                                      | The assistant can take the next message                                       |
