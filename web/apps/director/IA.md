# Director: information architecture and screen states

Owner: frontend-director. Host: `http://director.betsee.localhost`. Verifier: product-designer.
Visual rules come from the Design Contract (`docs/design/design-contract.md`, `components.md`); this
file fixes structure, content and states, and records the board decisions that shaped them.

The Director is the live operational surface of Betsee: a security officer watches the agent
population act, opens any action as a trace, and sees which controls decided it. It does not edit
policy (Policy Studio) and does not decide approvals (Approvals); it links to both on
`betsee.localhost`.

Audience: realm roles `security-officer` and `org-admin` (D8). Anyone else gets the Forbidden page.

## Run it

- Mock mode, no Gateway needed: `VITE_BETSEE_MOCK=1 npm run dev:director` from `web/`. The mock
  world (`@betsee/api/mock`) plays background traffic and acts 1 to 6 through the real client, SSE
  parser and query hooks; only the network is fake. Real builds leave it out of the bundle.
- Live: the static build behind Caddy signs in with Keycloak (public PKCE client `betsee-director`)
  and calls same-origin `/api/v1/*` and `/api/v1/demo/*` with a bearer token, the event stream
  included (D9).
- Tests: `npm test -w @betsee/director` (domain logic) and `npm test -w @betsee/api` (SSE reader,
  mock world end to end).

## Shell

- Nav rail: Live, Graph, Coverage; the Ecosystem link at the bottom.
- Top bar: organization, "Mock data" badge in mock builds, stream status pill, "Awaiting human"
  counter linking to `betsee.localhost/approvals`, signed-in human, sign out.
- Live feed: a floating panel on the right on every route.
- Scenario dock: floating over the content, Act 1 to Act 7 and Reset scenario.

## Routes

| Route              | Screen                                     | Acts       |
| ------------------ | ------------------------------------------ | ---------- |
| `/`                | Live: stat strip, agent population by team | 1, 3, 6    |
| `/traces/:traceId` | Trace explorer                             | 1, 2, 3, 5 |
| `/agents/:agentId` | Agent drawer over Live                     | 2, 6       |
| `/graph`           | Agent graph                                | 4, 6       |
| `/coverage`        | ASI coverage                               | 7          |

Cut order if time runs short (p-52): graph animation, then the agent drawer, then the scenario dock
(the terminal runner is its fallback). Live, trace explorer and coverage stay.

## Live (`/`)

- Stat strip: Agents active (feature tile, with quarantined and suspended counts), Actions in the
  last 15 min, Denied, Awaiting human, AI-tightened.
- Agent tiles, team groups side by side in a wrapping row so the whole population fits without
  scrolling at 1440x900 and 1920x1080 (contract 6). A tile shows the agent id (never truncated),
  team and provider/model, the session's human and use case, effective capabilities (up to 4, then
  "+n"), the budget meter in EUR, and the last 12 decisions as ticks. A quarantined or suspended
  agent shows its lifecycle badge at the start of the state line, then the time and the reason
  exactly as the Gateway sends it, with CTL ids as tokens (D10a).
- Live feed: newest first; agent, decision chip, time, capability, resource, tier. Deny rows carry
  the left bar; bursts of the same agent, capability and outcome within 2 s fold into one "xN" row;
  rows waiting for a human never fold and update in place when `action.updated` arrives. While the
  pointer is over the feed or it is scrolled, new rows queue behind an "n new" pill.

## Trace explorer (`/traces/:traceId`)

1. Decision sentence: who, through which agent, for which use case, asked for which capability on
   which resource; the outcome and the deciding policy.
2. Seven cells: who initiated, which agent, why (use case), what capability (and tool), what
   resource (tier), which policy and controls, what decision (with "<verdict> because <CTL id> <control name>: <reason>" and
   whether the connector executed).
3. Pipeline rail, 15 stages in four groups (ingress; deterministic controls; analysis and decision;
   execution and audit). A deny ends the rail and later stages read "not reached"; approval and
   step-up read "not required" when the action never needed them; step-up counts as expected when
   the trace says `step_up_required` or carries a `step_up` obligation (never from span
   attributes), and a rejected approval never expects it. The deciding stage is preselected; arrow keys
   move along the rail.
4. Timing waterfall.
5. Composition panel (deterministic, AI analysis with the Gateway's `model_label`, final) beside the
   span detail (reason, controls with their explanation, policies with Cedar on demand, attributes).
6. Mediated agent message, when the trace is one. Execution context as the Gateway resolved it.

## Agent drawer (`/agents/:agentId`)

Identity, current session, capability intersection (delegated, permitted for the use case,
effective, with approval and step-up qualifiers from the use case), recent actions, agent messages.
A quarantined or suspended agent shows "Release agent" (`POST /api/v1/agents/{id}/release`).

## Graph (`/graph`)

Fixed columns: humans, agents by team, tools and connectors. Session edges are neutral. Tool edges
take the colour of their latest decision; a quarantined agent's edges are dashed orange.
Agent-to-agent edges loop left of the agents column, are the only labelled edges ("denied",
"breaker open", "xN"), and read "breaker open" once a message on them was stopped by CTL-RUN-003 or
the quarantine it caused (CTL-ID-002). A tool reported by `tool.descriptor_changed` turns red.
Events that arrive while the page is open pulse once along their edge.

## Coverage (`/coverage`)

Ten rows, ASI01 to ASI10: risk name, mitigating primitives (dominant first, up to 3), controls (up
to 6), the evidence split by decision with counts, and the acts that exercise it. A row expands to
the recent traces those controls decided.

## Scenario dock

Lists the runner's scenarios (`GET /api/v1/demo/scenarios`), starts a run, polls
`GET /api/v1/demo/runs/{run_id}`; a finished act shows a check, or a marker with the mismatching
steps in its tooltip. Act 7 opens Coverage. Reset calls `POST /api/v1/demo/reset`. Steps are matched
to traces by trace id only (p-47). Hidden when the runner does not answer.

## States

| State                                              | UI                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Signing in                                         | Keycloak redirect, then back to the page that started it                                                                              |
| Forbidden                                          | Full page naming the roles needed, link to the ecosystem                                                                              |
| Connecting / Live / Stale / Reconnecting / Offline | Stream pill; Stale after 20 s without a byte, reconnect from Last-Event-ID at 40 s, Offline banner with Retry after 5 failed attempts |
| Loading                                            | Skeletons in the final layout                                                                                                         |
| Empty                                              | "No agents registered. Run scripts/bootstrap." / "No agent has acted yet. Launch Act 1."                                              |
| Error                                              | Card with HTTP status and the Gateway trace id, Retry; a failing view is caught by an error boundary and never blanks the Director    |
| Trace not found                                    | Empty state with a link back to Live                                                                                                  |
