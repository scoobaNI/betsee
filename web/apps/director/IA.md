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
  parser and query hooks; only the network is fake. Real builds leave it out of the bundle. The
  Director turns on two world options the ecosystem leaves off: `variety` (background traffic also
  gets denied, approval, step-up and AI-tightened decisions) and `chats` (Betsee Desk chat sessions
  that start and end on their own).
- Live: the static build behind Caddy signs in with Keycloak (public PKCE client `betsee-director`)
  and calls same-origin `/api/v1/*` and `/api/v1/demo/*` with a bearer token, the event stream
  included (D9).
- Tests: `npm test -w @betsee/director` (domain logic) and `npm test -w @betsee/api` (SSE reader,
  mock world end to end).

## Principles

- No page titles or descriptions: a page opens on its breadcrumbs and its own controls, then its
  content (an accessible h1 still names it for screen readers).
- From the general to the specific. Every screen opens on its answer (one sentence, one number,
  one verdict); detail sits one click deeper, never on the first screen.
- Colour means an outcome and nothing else: green allowed, red denied, amber waiting for a human,
  violet step-up, pink tightened by AI analysis, orange quarantined. Everything else is greyscale.
- White workspace, one roomy centred column, large type (Plus Jakarta Sans, Remix Icon fill set);
  canvases (org chart, graph) break out to the full width and fit themselves, with zoom.
- Motion says what changed and that the page is live: pages fade through on navigation, counts
  glide and pop, rows grow in with an outcome-coloured edge, a status that changes in place rolls
  its word and rings in its new colour, marks ping in the colour of each decision as it arrives.
  Everything respects `prefers-reduced-motion` (positions stay correct, the flourishes go).
- One status badge (`StatusBadge` in `src/components/ui.tsx`) for every outcome and state: a fixed
  width per size (124, 136, 164 px) so badges line up in lists, the icon in a circle of the outcome's
  colour, short labels for waits ("Approval", "Step-up"; the full text in the tooltip), a breathing
  halo and turning hourglass while a person has yet to decide, and AI tightening as a pink marker
  inside the badge rather than a second pill.
- No dark blocks: emphasis comes from a soft tint of the accent or outcome colour, not from ink.
- The visual system is the Director's own (`src/director.css`, `src/components/icon.tsx`,
  `src/components/ui.tsx`); it does not depend on `@betsee/ui`.

## Levels of detail

| Level | Route                                                         | Answers                                                                                             |
| ----- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 0     | `/` Overview                                                  | Is anything wrong right now?                                                                        |
| 1     | `/agents`, `/activity`, `/graph`, `/determinism`, `/coverage` | Who runs which agent, which actions, who touched what, why a model never decides alone, which risks |
| 2     | `/agents/:agentId`                                            | What this agent may do, who launched it, everything it did                                          |
| 3     | `/traces/:traceId`                                            | Why exactly this action was decided this way, stage by stage                                        |

`/traces/:traceId` and `/agents/:agentId` are linked from the ecosystem (Home, Identity, Approvals,
chat); keep both paths stable. Sign-in returns to the page that started it.

## Shell

- A macOS-style dock on the left edge, vertically centred: glossy app tiles that swell under the
  pointer (neighbours less), a label beside the tile under the pointer, a dot at the current place
  and a bounce on click. Tiles: Director (home), the six places in three groups (Overview,
  Activity, Graph; Org chart; Determinism, Coverage), Search (Ctrl/Cmd K), the approvals inbox on
  `betsee.localhost/approvals` with an amber badge counting what awaits a human, and the account
  (photo; menu with the ecosystem link and sign out). Activity carries a badge with the decisions
  that arrived since Activity was last open. Tile colours stay in blues and greys, because the
  outcome colours mean outcomes. Below the large breakpoint the dock moves to the bottom edge.
- No stream or mock-data marker; only Offline shows, as a banner with "Try again" and the data's age.
- Search palette (Ctrl/Cmd K): places, demo acts, agents, people and recent decisions, keyboard driven.
- Demo controls live in the search palette (Ctrl/Cmd K), under Demo, only when the demo runner
  answers: Act 1 to Act 7 and "Reset scenario"; starting one shows a notification. Nothing about
  the demo is on screen otherwise.
- Live notifications, top right, at most three: denied (AI-tightened called out), waiting for
  approval or step-up, resolved by a human or voided, agent quarantined, suspended or released,
  blocked mediated message, tool blocked or restored. Repeats within 5 s fold into one with a count;
  each closes after 6.5 s (paused under the pointer) and opens its trace or agent. Allowed actions
  never notify.

## Overview (`/`)

1. One sentence: "All agents are working within policy." or "N things need your attention."
2. Four tiles, each a link one level down, each with a chart: agents active (with the registered
   total, quarantined and suspended counts, and a bar per agent for its last 15 minutes), actions in
   the last 15 minutes and denied in the last 15 minutes (change against the 15 minutes before, as
   a percentage from ten up, and a per-minute area chart that reads its value under the pointer),
   awaiting a human (how long the oldest has waited, and the pending count per minute rebuilt from
   the approval records). The Gateway's summary is authoritative for the counts it carries (FAIL-1).
3. Needs attention, only when something does: quarantined or suspended agents with the Gateway's
   reason, actions waiting for a person, tools blocked by descriptor drift. Four shown, the rest
   behind "Show more".
4. Decisions over time (15 minutes or an hour, stacked by outcome, a legend that hides a series,
   numbers on hover) beside the outcome mix as a ring.
5. Live traffic: one lane per agent (with who launched it), every decision of the window (1, 2 or
   5 minutes) as a dot drifting from "now" to the left; colour by outcome, denied and waiting dots
   larger. Pointing at a dot shows its detail, clicking opens the trace; Pause freezes the drift.
6. Most requested capabilities and busiest agents in the last hour, split by outcome, and the
   Gateway's decision time per minute (median and 95th percentile over decisions per minute).
7. Determinism: decided by policy, tightened and loosened by AI, linking to the Determinism page.
8. Teams: one card per team with its agents' states and the last 15 minutes as an outcome bar; a
   card rings when one of its agents acts. Links to the org chart.
9. Latest activity: six rows, then a link to Activity.

## Org chart (`/agents`, `?person=`, `?view=list`, `?view=list&team=`)

The Acme Logistics people directory as a tree, left to right: the chief executive, the people who
report to each person, and beside every person the agents they launched (an agent without a session
sits, dashed, beside the head of its team). The directory (`src/domain/people.ts`, photos in
`public/people/` with `CREDITS.md`) is the Director's own. Who is a Gateway principal (key badge) is
read from the data: anyone who is the human of a session, an action or an agent's current session
(Maya Chen, Daniel Ortiz and Priya Raman in the demo seed); everyone else is a directory profile.
Each open Betsee Desk chat (a session of use case `employee-assistance`) appears as its own "Chat"
chip beside the person having it, with that session's requests, and leaves when `session.ended`
arrives; the assistant agent itself has no fixed chip. Ended chats stay listed in the person's
profile under "Chats in Betsee Desk", with their request counts. Each
request runs as a dot from the person to the agent and the decision comes back in its colour, with
a reply bubble on the person. A person's report count collapses or expands their branch; "Expand
all" and "Leadership only" set the whole tree; the canvas fits its width and zooms. Clicking a
person opens their profile (`?person=`): role, department, manager and reports, their agents, their
chats and latest requests. Below the chart, Conversations lists the latest person-to-agent requests.

`?view=list`: grouped by team, filterable by team. A row shows the agent, its state (with the reason
and time when it is quarantined or suspended), the session's human and use case, the last 12
decisions as bars, and the budget in EUR.

## Agent (`/agents/:agentId`)

Hero card: 56 px mark, state, who launched it for which use case, the last 32 decisions as a strip
with the latest one named; a release banner with "Release agent"
(`POST /api/v1/agents/{id}/release`) when quarantined or suspended; three tiles (actions and denied
in the last 15 minutes, budget as a half dial); current session; effective capabilities with
approval and step-up qualifiers, and on demand the delegated / permitted / effective table; recent
actions; messages with other agents.

## Activity (`/activity`, `?show=denied|awaiting|ai|observed`, `?agent=`)

Newest first. Bursts of the same agent, capability and outcome within 2 s fold into one "xN" row;
rows waiting for a human never fold, read as amber-tinted cards, and update in place when
`action.updated` arrives. While the pointer rests on the list, new rows queue behind an "n new"
pill. Gateway observations (`security.observe`) read "Observed", with their severity from medium up.

Above the list, the last hour as decisions per 90 seconds, stacked by outcome, for the current filter.

## Determinism (`/determinism`)

1. The boundary, live: one wavering line per agent (a model's request) into the deterministic
   controls, a straight line through AI analysis (may only tighten), fanning out to four outcomes
   with live counts. Each request that arrives crosses it as a dot, grey before the controls and in
   its deterministic, then final, colour after.
2. Four figures: decided by policy, tightened by AI, loosened by AI (computed: a decision less strict
   than its deterministic one before any human; zero by the composition rule), resolved by a person.
3. Same request, same decision: identical requests (agent, capability, resource, use case) with
   their deterministic decisions as bars; a repeat that changed names the controls behind it.
4. What AI analysis can and cannot do.

## Trace (`/traces/:traceId`)

1. Verdict, then one sentence: who, through which agent, for which use case, asked for which
   capability on which resource; the outcome and the deciding policy.
2. Why: "<verdict> because <CTL id> <control name>: <reason>", whether and by whom it was executed
   (connector, agent runtime after allow, or forwarded), and whether the reason came from AI
   analysis.
3. Six facts: who initiated, agent, use case and session, capability and tool, resource and tier,
   policies and controls.
4. Deterministic first, AI second: the deterministic decision, the AI analysis verdict and the final
   decision side by side, and how often this exact request was made and answered the same way.
5. How the Gateway decided: four phases (ingress; deterministic controls; analysis and decision;
   execution and audit) over the 15 stages. On arrival (and on "Replay") the phases light up one
   after another with a progress bar in each phase's outcome colour, and the deciding phase rings.
   The deciding phase and stage open on arrival; arrow keys walk the stages. A deny ends the rail
   and later stages read "not reached"; approval and step-up read "not required" when the action
   never needed them.
6. Deeper detail, closed by default: the mediated agent message (open when present), timing
   waterfall, execution context.

## Graph (`/graph`)

Fixed columns: people (other callers below them, never drawn as people), agents by team, tools and
connectors. Session edges are neutral; tool edges take the colour of their latest decision; a
quarantined agent's edges are dashed orange. Agent-to-agent edges loop left of the agents column and
are the only labelled edges ("denied", "breaker open", "xN"). A tool reported by
`tool.descriptor_changed` turns red. Events that arrive while the page is open send a spark along
their edges, human to agent and then agent to tool, light both ends and ring the node it reaches.
The legend floats over the full-width canvas; pointing at a node dims everything not connected to
it.

## Access (`/access`)

The director's hand on access. Every change is staged first (green to grant, red to revoke, amber
to adjust), reviewed in a tray that slides up from the bottom, and applied in one batch with a
reason (Ctrl or Cmd + Enter). The live Gateway has no write API for this yet: the page then
rebuilds the agents' side from their sessions and use cases, people's Desk access and tier ceiling
show as not exposed, and Apply stays disabled. The mock world implements the proposed contract
(`GET /api/v1/access`, `POST /api/v1/access/changes`) and decides every later request under it.

1. Four figures: capabilities delegated, delegated but unused this hour, requests flagged by AI
   analysis this hour, access changes made.
2. Suggestions, from the last hour of decisions: suspend an agent AI analysis flagged as malicious
   more than once; revoke a capability it flagged twice; revoke a delegated capability a busy agent
   never used (least privilege); for a person, turn Betsee Desk off after two flagged chat requests,
   or lower their tier ceiling one step after one flag or repeated requests above their tier. Agent
   flags never count against the person who launched the agent: injected data is not their doing;
   what they type into Desk is. Each card shows its evidence strength (0 to 100), the evidence and a
   link to it; Stage adds its changes to the tray, Dismiss hides it for this viewer.
3. Agents by capability: delegated cells filled, approval and step-up dots on top, hatched cells
   outside the use case, a bar under each cell for its use this hour; hovering lights the row and
   column, and a suggestion lights its subject. The state switch suspends or resumes an agent; a
   quarantined one offers Release.
4. People: their chat requests, AI flags and requests above tier this hour, a Betsee Desk switch and
   a four-notch tier slider.
5. History: every applied change with before and after, who made it, the reason, and whether it came
   from a suggestion.

## Configuration (`/configuration`, `?tab=agents|people|policies`)

Read-only: the Gateway has no write API for use cases, delegations, people or policies, so each
edit links to the ecosystem's Policy Studio or Identity.

1. Permissions: one card per use case with its tier ceiling, budget, approval threshold, the
   capabilities it permits (approval and step-up marked on each) and the agents registered for it.
2. Agents: each agent with its team, model and current session, what the session delegates
   (anything delegated outside the use case struck through: the Gateway denies it), and its budget.
3. People: the directory by department, principals (read from the data) marked with the key badge,
   with how many agents and chats each runs; a card opens the person on the org chart.
4. Policies: Cedar policies grouped by the control they implement, permit and forbid marked.

## Coverage (`/coverage`)

A ring with the number of risks evidenced this run, then ten rows, ASI01 to ASI10: risk, main
primitive, evidence as an outcome bar with counts, the acts that exercise it. A row opens in place to
its primitives, controls, what Betsee does not claim, and the traces those controls decided.

## States

| State                                              | UI                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Signing in                                         | Keycloak redirect, then back to the page that started it                              |
| Forbidden                                          | Full page naming the roles needed, link to the ecosystem                              |
| Connecting / Live / Quiet / Reconnecting / Offline | Not shown while connected; Offline shows a banner with "Try again" and the data's age |
| Loading                                            | Skeletons in the final layout, shown only after 150 ms                                |
| Empty                                              | A sentence saying what is missing and how to produce it                               |
| Error                                              | Card with HTTP status and the Gateway trace id, Retry; an error boundary per page     |
| Trace or agent not found                           | Empty state with a link back one level                                                |
