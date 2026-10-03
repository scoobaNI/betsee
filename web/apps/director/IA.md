# Director: information architecture and screen states

Host: `http://director.betsee.localhost`.

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

## Principles

- From the general to the specific. Every screen opens on its answer (one sentence, one number,
  one verdict); detail sits one click deeper, never on the first screen.
- Colour means an outcome and nothing else: green allowed, red denied, amber waiting for a human,
  violet step-up, pink tightened by AI analysis, orange quarantined. Everything else is greyscale.
- White workspace, one centred column, generous spacing; motion only to show what changed (counts
  glide, rows slide in, sections open in place).
- The visual system is the Director's own (`src/director.css`, `src/components/icon.tsx`,
  `src/components/ui.tsx`); it does not depend on `@betsee/ui`.

## Levels of detail

| Level | Route                                         | Answers                                                      |
| ----- | --------------------------------------------- | ------------------------------------------------------------ |
| 0     | `/` Overview                                  | Is anything wrong right now?                                 |
| 1     | `/agents`, `/activity`, `/graph`, `/coverage` | Which agents, which actions, who touched what, which risks   |
| 2     | `/agents/:agentId`                            | What this agent may do, who launched it, everything it did   |
| 3     | `/traces/:traceId`                            | Why exactly this action was decided this way, stage by stage |

`/traces/:traceId` and `/agents/:agentId` are linked from the ecosystem (Home, Identity, Approvals,
chat); keep both paths stable. Sign-in returns to the page that started it.

## Shell

- Sticky header: wordmark, the five places (Overview, Agents, Activity, Graph, Coverage), "Mock
  data" in mock builds, an "awaiting a human" pill linking to `betsee.localhost/approvals` (only when
  the count is above zero), the stream state (Connecting, Live, Quiet, Reconnecting, Offline), and
  the account menu (ecosystem link, sign out).
- Demo dock: floating at the bottom, folded to one "Demo" pill by default (remembered per browser);
  open, it lists Act 1 to Act 7 and "Reset scenario".

## Overview (`/`)

1. One sentence: "All agents are working within policy." or "N things need your attention."
2. Four numbers, each a link one level down: agents active (quarantined and suspended counts),
   actions in the last 15 minutes (per-minute histogram, AI-tightened count), denied in the last 15
   minutes, awaiting a human. The Gateway's summary is authoritative for the counts it carries
   (FAIL-1).
3. Needs attention, only when something does: quarantined or suspended agents with the Gateway's
   reason, actions waiting for a person, tools blocked by descriptor drift. Four shown, the rest
   behind "Show more".
4. Teams: one card per team with its agents' states and the last 15 minutes as an outcome bar.
5. Latest activity: six rows, then a link to Activity.

## Agents (`/agents`, `?team=`)

Grouped by team, filterable by team. A row shows the agent, its state (with the reason and time when
it is quarantined or suspended), the session's human and use case, the last 12 decisions as bars,
and the budget in EUR.

## Agent (`/agents/:agentId`)

Header with state; a release banner with "Release agent" (`POST /api/v1/agents/{id}/release`) when
quarantined or suspended; three numbers (actions, denied, budget); current session; effective
capabilities with approval and step-up qualifiers, and on demand the delegated / permitted /
effective table; recent actions; messages with other agents.

## Activity (`/activity`, `?show=denied|awaiting|ai|observed`, `?agent=`)

Newest first. Bursts of the same agent, capability and outcome within 2 s fold into one "xN" row;
rows waiting for a human never fold and update in place when `action.updated` arrives. While the
pointer rests on the list, new rows queue behind an "n new" pill. Gateway observations
(`security.observe`) read "Observed", with their severity from medium up.

## Trace (`/traces/:traceId`)

1. Verdict, then one sentence: who, through which agent, for which use case, asked for which
   capability on which resource; the outcome and the deciding policy.
2. Why: "<verdict> because <CTL id> <control name>: <reason>", whether and by whom it was executed
   (connector, agent runtime after allow, or forwarded), and whether the reason came from AI
   analysis.
3. Six facts: who initiated, agent, use case and session, capability and tool, resource and tier,
   policies and controls.
4. How the Gateway decided: four phases (ingress; deterministic controls; analysis and decision;
   execution and audit) over the 15 stages. The deciding phase and stage open on arrival; arrow keys
   walk the stages. A deny ends the rail and later stages read "not reached"; approval and step-up
   read "not required" when the action never needed them.
5. Deeper detail, closed by default: the mediated agent message (open when present), decision
   composition (deterministic, AI analysis, final), timing waterfall, execution context.

## Graph (`/graph`)

Fixed columns: people (other callers below them, never drawn as people), agents by team, tools and
connectors. Session edges are neutral; tool edges take the colour of their latest decision; a
quarantined agent's edges are dashed orange. Agent-to-agent edges loop left of the agents column and
are the only labelled edges ("denied", "breaker open", "xN"). A tool reported by
`tool.descriptor_changed` turns red. Events that arrive while the page is open pulse once along their
edge.

## Coverage (`/coverage`)

A ring with the number of risks evidenced this run, then ten rows, ASI01 to ASI10: risk, main
primitive, evidence as an outcome bar with counts, the acts that exercise it. A row opens in place to
its primitives, controls, what Betsee does not claim, and the traces those controls decided.

## States

| State                                              | UI                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Signing in                                         | Keycloak redirect, then back to the page that started it                          |
| Forbidden                                          | Full page naming the roles needed, link to the ecosystem                          |
| Connecting / Live / Quiet / Reconnecting / Offline | Header indicator; Offline adds a banner with "Try again" and the data's age       |
| Loading                                            | Skeletons in the final layout, shown only after 150 ms                            |
| Empty                                              | A sentence saying what is missing and how to produce it                           |
| Error                                              | Card with HTTP status and the Gateway trace id, Retry; an error boundary per page |
| Trace or agent not found                           | Empty state with a link back one level                                            |
