# Betsee demo: scenarios and runner (F14)

Owner: security-architect. The acts follow `docs/demo-script.md`. The policies these scenarios exercise
are in `policies/`, with their Cedar-level reference cases in `policies/tests/acme-cases.json`.

The scenarios drive real traffic through the real Gateway:

- real Keycloak tokens: agents use client credentials (D1), and the scenario's human is reached
  through `betsee-demo-runner` (D7, demo-only);
- real `POST /api/v1/sessions`, `/api/v1/actions` and `/api/v1/agent-messages` calls;
- a W3C `traceparent` minted per step.

Nothing in the runner decides anything. It sends requests, then compares the Gateway's answers with
the expected decisions.

## Scenario format (`demo/scenarios/*.json`, `format: betsee-scenario/v0`)

```text
id, act, title, asi[], summary
sessions: { alias: { human, agent, use_case, delegated[], tier_ceiling, budget_cents } }
steps[]:
  kind: action        session, capability, resource {type, id, tier} | resource_pattern, parameters
  kind: agent_message session, receiver, requested_capability, content
  kind: await_human   waits_for (a step id, also from an earlier run, e.g. act 5 waits on act3.s3), timeout_s
  kind: tool_drift    tool (MCP admin route on betsee-mcp, in-network only)
  expect: { decision, controls[] (subset of control_ids), policies[] (subset of policy_ids),
            deterministic_decision, ai_tightened, executed, approval_state }
  repeat: n, with expect_sequence: [{from, to, decision, controls[]}]   (bursts, retries)
  expect_after: { agent, state }   (agent state checked after the step, e.g. quarantined)
  narration, pace_ms
```

Every expected decision for a single action matches a case in `policies/tests/acme-cases.json` with
the same step id. That is how the Cedar-level reference becomes live HTTP evidence.

`expect_sequence` assumes the agreed Gateway parameters:

- the circuit breaker opens at 5 denials per agent within 60 s;
- `crm.read` costs 10 cents;
- the act 6 report-bot session budget is 120 cents.

## Runner

`python -m runner [serve | list | run <scenario-id> | reset]`. It uses only the Python 3.13 standard
library, has no dependencies, and runs in the `demo-runner` container (`demo/Dockerfile`, port 8090).

HTTP, routed by Caddy at `/api/v1/demo/*` on both UI hosts:

| Route                                   | Answer                                                                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz`                          | `{status: "ok"}`, no auth                                                                                                                                |
| `GET /api/v1/demo/scenarios`            | `[{id, act, title, asi[], summary, steps[{step_id, kind, agent, human, capability, resource, repeat, expected_decision, narration}]}]`                   |
| `POST /api/v1/demo/scenarios/{id}/runs` | `202 {run_id}`; the run proceeds in the background                                                                                                       |
| `GET /api/v1/demo/runs/{run_id}`        | `{run_id, scenario_id, status: running/passed/failed/error, steps[{step_id, n, trace_id, expected_decision, actual_decision, control_ids, ok, error?}]}` |
| `POST /api/v1/demo/reset`               | `{reset_at, results[]}`                                                                                                                                  |

Every `/api/v1/demo/*` route needs the caller's bearer token with realm role `security-officer` or
`org-admin` (D8). The runner validates the token by calling the Gateway's `/api/v1/me`. The Director
matches its SSE events to steps by `trace_id`.

Reset uses the caller's own token, so it is audited as the presenter. That token must come from a
browser app (`azp` `betsee-director` or `betsee-ecosystem`). A `betsee-demo-runner` token is refused
with 403, because the Gateway rejects it on the admin writes reset needs (D7a). Reset does three
things:

1. ends every active demo session, which voids pending approvals;
2. releases every demo agent, active or not, which starts a new breaker window. Test cases can
   therefore call reset to isolate one agent's denials from the next case;
3. restores the payments descriptor through the MCP server's in-network admin route.

The answer lists every operation with its HTTP status. It is 200 with `ok: true` when all succeed,
and 502 with `ok: false` otherwise. Reset never deletes audit rows, traces or security events.

Environment variables:

- `GATEWAY_URL`, `KEYCLOAK_TOKEN_URL`, `MCP_ADMIN_URL`, `MCP_ADMIN_TOKEN`, `PORT`, `SCENARIO_DIR`;
- `AGENT_CLIENT_SECRET_<AGENT_ID>`, one per agent, for example
  `AGENT_CLIENT_SECRET_INVOICE_ASSISTANT`;
- `DEMO_RUNNER_CLIENT_SECRET`, `DEMO_PASSWORD_MAYA`, `DEMO_PASSWORD_PRIYA`;
- `BETSEE_PRESENTER_TOKEN`, for `reset` from the terminal.

Terminal fallback on stage:

```sh
docker compose exec demo-runner python -m runner run act2-deterministic-boundaries
```

It prints one `PASS/FAIL` line per step with its trace id, and exits 1 on any mismatch.
