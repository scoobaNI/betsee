# Betsee components

Companion to `design-contract.md` (the rules). This file specifies the shared components so both
frontends build the same thing. Sizes and colours are tokens from `tokens.json`; class names are the
Tailwind utilities generated in `tailwind-theme.css` (`bg-surface-1`, `text-deny-fg`,
`border-line-subtle`, `rounded-lg`, `shadow-e1`).

Build split (agreed on the board): frontend-ecosystem builds the shared primitives in
`web/packages/ui` in this order: Icon, DecisionChip, LifecycleBadge, TierBadge, IdToken, MockBadge,
StreamStatus, KpiTile, then CapabilityIntersection, ApprovalCard, ControlCard. frontend-director
builds the Director-only components in `web/apps/director`: AgentTile, FeedRow, PipelineRail,
SpanRow, CompositionPanel, GraphCanvas, ScenarioDock. A component needed by both moves into
`packages/ui`; never copy it.

## DecisionChip

- Pill, height `chip` (24; `sm` 20 in tables), padding 0 10, gap 6, icon 14, label 12/600.
- `bg`, 1px `border`, `fg` from `color.decision.*`. Pending decisions use a dashed border.
- Props: `decision` (`allow | deny | require_approval | require_step_up`), `resolution`
  (`approved | rejected | verified | failed | null`), `aiTightened`, `size`, `variant`
  (`chip | compact | tick`).
- Labels and icons: contract section 5.
- **AI-tightened** (`chip`): a split pill `[icon Decision | spark AI-tightened]`, 1px divider in the
  modifier border colour, right segment in `modifier.ai-tightened.*`. `compact` (narrow rows): a 6px
  violet dot on the chip's top-right corner. Tooltip: "AI-tightened: the analyzer raised allow to
  awaiting approval. Model: mock model (demo)", the model text from the Gateway's `model_label`.
- Tooltip always shows the raw value in mono (`require_approval`) and the deciding control ids;
  resolved chips also show the history ("Awaiting approval -> Approved by Daniel Ortiz, 21:32:07,
  acr 2").
- `tick` (agent tile strip): 4x14px, radius 2, gap 3, colour `decision.*.fg`, except allow ticks use
  `brand.700` so denies stand out; AI-tightened ticks get a 2px violet cap.

## AgentTile (Director)

- `bg-surface-1 rounded-lg shadow-e1`, padding 16, min width 280.
- Row 1: agent mark (32px rounded square `radius.sm`, `surface.3`, `streamline-flex:ai-chip-robot`
  16px, `accent.text` while active) + agent id (mono 13/500) + LifecycleBadge right.
- Row 2: team and provider/model (12 `fg-secondary`, model in mono).
- Row 3: session: human circle 20 + "Maya Chen" + "for Invoice processing"; none: "No active
  session" in `fg-tertiary`.
- Row 4: effective capabilities as `sm` mono IdTokens, up to 4, then "+n" (tooltip lists the rest).
  Every agent reads as a principal with its capabilities.
- Row 5: budget meter: 4px track `surface.inset`, fill `brand.500`, at >= 80% `approval.fg`,
  exhausted `deny.fg`; label "Budget 62 / 100" tabular 12.
- Row 6: last 12 decisions as ticks, oldest left.
- States: hover `surface.2` + `e2`; selected `shadow-selected`; **quarantined**: 1px
  `quarantined.border`, 135deg hatch overlay, badge "Quarantined", a reason line in
  `quarantined.fg`, rendered exactly as the Gateway sends it with CTL ids as IdTokens (e.g.
  "Quarantined 17:31:02 - CTL-RUN-003 circuit breaker: 5 denials in 60 s (CTL-RUN-002 rate,
  CTL-RUN-001 budget)"), the rest at 70% opacity; **suspended**: neutral hatch, content at 55%,
  badge "Suspended".

## PipelineRail and SpanRow (Director)

Canonical stages and icons:

| #   | Stage              | Icon                                   |
| --- | ------------------ | -------------------------------------- |
| 1   | authenticate       | `streamline-flex:key-frame`            |
| 2   | resolve context    | `streamline-flex:hierarchy-2`          |
| 3   | identity           | `streamline-flex:user-identifier-card` |
| 4   | capability         | `streamline-flex:tag`                  |
| 5   | Cedar authz        | `streamline-flex:justice-scale-1`      |
| 6   | information tier   | `streamline-flex:layers-1`             |
| 7   | command validation | `streamline-flex:code-analysis`        |
| 8   | budget             | `streamline-flex:dashboard-gauge-1`    |
| 9   | AI analysis        | `streamline-flex:ai-scanner-robot`     |
| 10  | decision           | `streamline-flex:arrow-roadmap`        |
| 11  | approval           | `streamline-flex:inbox`                |
| 12  | step-up            | `streamline-flex:fingerprint-1`        |
| 13  | connector          | `streamline-flex:link-chain`           |
| 14  | output controls    | `streamline-flex:filter-2`             |
| 15  | audit              | `streamline-flex:text-file`            |

Stage node: 32px rounded square `radius.sm`, `surface.2`, icon 14, label 11 under it, a 2px line to
the next node.

| Status      | Node                                                          | Badge (12px)            | Line to next          |
| ----------- | ------------------------------------------------------------- | ----------------------- | --------------------- |
| passed      | border `allow.border`, icon `fg-secondary`                    | check `allow.fg`        | `brand.600` solid     |
| denied      | `deny.bg`, border and icon `deny.fg`                          | block `deny.fg`         | `line-default` dashed |
| tightened   | border and icon `tightened.fg`                                | spark                   | `brand.600` solid     |
| pending     | dashed border `approval.fg` (step-up `stepup.fg`), ring pulse | hourglass / fingerprint | `line-default` dashed |
| skipped     | border `line-subtle`, icon `fg-disabled`, label "skipped"     | none                    | `line-default` solid  |
| not reached | 40% opacity, dashed `line-subtle`                             | none                    | `line-subtle` dashed  |

"Not required" (approval or step-up that policy did not ask for) is drawn as skipped with its own
label. Stages sit under four group labels: ingress; deterministic controls; analysis and decision;
execution and audit. A deny ends the rail; every later stage reads "not reached". The deciding
span is preselected.

SpanRow (waterfall): height 36; stage icon + name (13) | lane `surface.inset` with an 8px bar,
radius 4, on the trace time axis (passed `brand.600`, denied `deny.fg`, tightened `tightened.fg`,
pending amber hatched and growing) | duration mono 12 right-aligned ("3.2 ms"). Hover `surface.2`;
selected `surface.2` + 2px `accent` left bar. Expanded: status, reason sentence, deciding controls
(CTL chips), policy ids, attributes as a mono key/value table on `surface.inset`.

Timing honesty (D11): a stage shows only a time the Gateway measured.

- A stage with `duration_ms: null` and a `parent_stage` is a **child row** directly under its parent,
  in canonical stage order; under Cedar authz these are identity, capability, information tier,
  command validation and budget (D20), driven by `parent_stage`, never a hardcoded list; indented 20px
  with a 1px `line-subtle` tree line. It has no bar: the lane holds "decided in the same Cedar
  evaluation" in 12 `fg-tertiary`, and the duration column holds an en dash. Status icon, reason and
  deciding controls work as on any row. The parent's bar is the only time for the group.
- A null-duration stage with no `parent_stage` (decision, approval, step-up when not required) is a
  plain status row with no bar and never the Cedar sentence. The rail and waterfall render each stage
  from its own span status; a missing span reads "not reached". After a deny, decision (denied) and
  audit (passed) still appear.
- A measured duration under 0.1 ms reads "<0.1 ms", never "0.0 ms", and still gets a 2px minimum
  bar so it stays visible on the axis.
- The PipelineRail keeps all 15 stages in canonical order with their status; it shows no times, so
  it needs no change.

CompositionPanel (when AI analysis ran): Deterministic (chip) -> AI analysis (chip + MockBadge with
`model_label`) -> Final (chip, with the modifier if tightened). Under it, always: "AI analysis may
make a decision stricter. It can never make a deterministic deny go away."

## ControlCard

- `bg-surface-1 rounded-lg shadow-e1`, padding 16.
- Header: CTL IdToken + name (14/600) + a read-only "Enforced" badge right: pill 20, 1px
  `line-default`, `streamline-flex:shield-1` 12 + "Enforced" 11/600 in `fg-secondary`. It states a
  fact; there is no switch in v0 because the API has no control-enabled field. Never render a
  control that looks interactive but is not.
- Explanation: 13 `fg-secondary`, clamped to 3 lines.
- ASI badges: mono 11, 1px `line-default`, `radius.xs` ("ASI03").
- Attachment points, icon + word for attached points only: organization
  `streamline-flex:office-building-1`, team `streamline-flex:user-collaborate-group`, user
  `streamline-flex:user-circle-single`, agent `streamline-flex:ai-chip-robot`, use case
  `streamline-flex:target`, tool `streamline-flex:wrench-hand`, provider/model
  `streamline-flex:artificial-intelligence-brain-chip`, tier `streamline-flex:layers-1`.
- Footer: "Decided 14 actions this run" + a 4px split bar by decision (viz colours).
- States: hover `e2`; selected `shadow-selected`.

## CapabilityIntersection

Carries the act 2 line "Maya can see HR files. Her agent cannot."

- Header: either the diagram (two overlapping rounded rectangles outlined in `line-strong`,
  "Delegated 6" left, "Permitted 5" right, the overlap filled `accent.tint` with "Effective 4" in
  `accent.text`) or three joined count cells in the order Delegated | Effective | Permitted, with
  Effective in the middle on `accent.tint`. Static, not tabs.
- Caption, always visible: "Effective = delegated to the agent ∩ permitted by policy for the use
  case".
- Matrix: one row per capability in the union; columns Delegated, Permitted for <use case>,
  Effective. Capability in mono. Yes = `streamline:check` in `fg-secondary`; no = an en dash in
  `fg-tertiary`; effective yes = an accent-tinted mono chip. Qualifiers (tier ceiling, "above 10,000
  EUR: approval + step-up") as 12px `fg-secondary` in the column that imposes them.
- With a trace context the requested capability's row is highlighted: effective = allow left bar;
  not effective = deny left bar + reason ("not delegated", "not permitted for Invoice processing").
- Used in the Director agent drawer, Identity agent detail and the capability stage detail.

## ApprovalCard

- `bg-surface-1 rounded-lg`, padding 20; pending: 1px `approval.border` (step-up `stepup.border`),
  no glow.
- Header: agent mark + agent id + "for Invoice processing" + age right ("2 min ago", absolute time
  in the tooltip). "Initiated by" human circle + name. Decision chip "Awaiting approval", plus a
  "Step-up required" badge (`stepup.*`, `streamline-flex:fingerprint-1`, pill 20) **before** the
  click whenever `requires_step_up` is true.
- **Gateway facts** first, as a fact sheet on `surface.inset`, `rounded-sm`, padding 16; every value
  comes from Gateway-resolved fields, never from agent parameters:
  - the amount as the headline: display 28/600 tabular, formatted from integer `amount_cents` plus
    currency with `Intl.NumberFormat` ("48,000.00 EUR"), never from a float. The currency comes only
    from a Gateway fact: until the Gateway validates it (`amount {cents, currency}`), use the
    currency the Gateway enforces (EUR), and show the agent's own currency value only in the
    unverified block;
  - sources: `approval.action` (capability, resource type, id and tier, use case, session) and
    `action_hash`; nothing from `approval.parameters` except the bound `amount_cents`;
  - payee / resource on the next line: resource type and id in mono 14 (`payments/nordfreight-supplier`),
    then its display name if the Gateway sends one;
  - then key/value rows (label 12 `fg-secondary`, value mono 13): capability, tier (TierBadge),
    use case, session, action hash (shortened, copy on hover). Provenance per row comes only from
    the Gateway's `provenance.fields` map, as a 12px `fg-tertiary` line under the value; no lookup by
    parameter name.
- **Agent-supplied, unverified** second, always visible (the act 5 contrast needs both on screen): a
  block with a 1px dashed `line-default` border and no fill, label "Agent-supplied, unverified" 11/600
  with `streamline-flex:information-circle`, then the remaining parameter keys (memo, invoice ...)
  as key/value rows in **UI font**, `fg-secondary`, never mono. Mono, the inset fill and the
  headline are reserved for Gateway facts, so the two can never look alike. Empty: the block is
  omitted.
- **Why a human**: "<decision> because <CTL id> <control name>: <reason text>" per D12, control
  chips, AI analysis finding with MockBadge.
- Actions, `control-lg`: **Approve** (primary) and **Reject** (outline `deny.border`, text
  `deny.fg`). When policy requires step-up the primary reads **Approve with step-up** with
  `streamline-flex:fingerprint-1` and a helper line "Keycloak will ask for a one-time code."
- States: pending; submitting (buttons disabled, spinner inside the pressed button); awaiting step-up
  ("Waiting for the one-time code in Keycloak", `stepup.border`); approved (collapses to an Approved
  chip + "by Daniel Ortiz - acr 2 - 21:32:07" + Open trace); rejected; expired ("Expired. The agent
  was told no."); error (inline, HTTP status + trace id + Retry).
- Gateway-demanded step-up (D: p-632): the first Approve goes to the Gateway at the current acr. When
  it answers `step_up_required`, the card switches to the step-up state (`stepup.border`, fingerprint
  icon) with "The Gateway requires step-up. Opening Keycloak for your one-time code." and holds it for
  at least 1200 ms before the redirect, so the audience sees that the Gateway, not the UI, asked for
  the proof. On return at acr 2, the approval is sent again and the card resolves.
- Missing Gateway facts (e.g. a payment approval without a bound amount): the fact sheet shows the
  missing row as "Not provided by the Gateway" in `fg-tertiary`; **Approve is disabled**, **Reject
  stays enabled** (refusing is always safe), and one line under the buttons says why: "This cannot be
  approved here: the Gateway did not bind the amount. You can still reject it."
- Never: approve-all, a keyboard shortcut to approve, an auto-approve countdown, an approve button
  without the Gateway facts on screen, or an agent-supplied value rendered in the fact sheet.
- The mock fixture uses the live response shape; a mock card may not look better than a live one.

## Supporting primitives

- **StreamStatus** (top bar, both hosts): pill 28, dot 8 + word 12/600. Connecting (`info`, pulse),
  Live (`accent` + `shadow-live`, pulse), Reconnecting (`warning`, pulse), Stale (`warning`,
  static), Offline (`danger`, static, plus the offline banner). Timing is frontend-director's: Stale
  after 20 s without a byte, reconnect at 40 s.
- **MockBadge** (D2): pill, 1px dashed `mock-border`, text `mock-fg` 11/600, icon
  `streamline-flex:erlenmeyer-flask` 12. "Mock data" in the top bar whenever an app runs on fixtures;
  the Gateway's `model_label` ("mock model (demo)") next to every AI analysis verdict.
- **LifecycleBadge**: pill 20, dot or icon + word: Active, Quarantined, Suspended.
- **TierBadge**: four vertical bars 3x10, gap 2, filled count = level (public 1 to restricted 4),
  filled `fg-secondary` (restricted `fg-primary`), unfilled `line-default`, then the word 12/500.
- **SeverityBadge**: contract section 5.
- **IdToken**: mono 12, `surface.3`, `radius.xs`, copy on hover (`streamline:copy-paste`), a link
  when the id has a page.
- **KpiTile**: `rounded-lg`, padding 20 (Director stat strip: 12, number 28), label 13
  `fg-secondary`, number 36 display tabular, 12px delta line, arrow-in-circle link top-right. One
  feature tile (`gradient.feature`) per row at most.
- **FeedRow** (Director): min height 56, `radius.md`; time (mono 11 `fg-tertiary`), agent id,
  capability, resource + TierBadge, DecisionChip right; deny rows get a 2px `deny.fg` left bar;
  bursts collapse into one row with an "x24" badge; hover `surface.2`; click opens the trace. The
  feed header carries a "Live" accent pill (org-chart pattern). Line 1: agent id + chip; line 2:
  time, capability, resource, tier. The agent id never truncates: when it and a split AI-tightened
  chip do not fit on line 1, the chip uses its compact dot. The "n new" pill sits in the feed header
  or pushes the rows down; it never covers a row.
- **ScenarioDock** (Director): floating, `surface.overlay` + blur 16, `radius.pill`, height 52,
  `e3`; segments Act 1 to Act 7 (tooltip: act title) + divider + "Reset scenario"
  (`streamline:arrow-reload-horizontal-1`). The running act uses `gradient.feature`; finished acts
  show a check. Every scrolling view under the dock ends with at least 100px of bottom padding, so
  no content stays hidden behind it.
- **Coverage row** (Director): ASI id (mono) + risk name, then the primitive that mitigates it (from
  security-architect's F02 mapping, e.g. "Capability intersection + Cedar authz") in 13
  `fg-secondary`, then CTL chips, an evidence split bar by decision with counts, last evidence time,
  the act. No evidence: "No evidence yet this run" in `fg-tertiary` and an empty hatched bar.

## GraphCanvas (Director `/graph`)

- `bg-app` + dot grid. Columns Humans | Agents (grouped by team) | Tools and connectors, caps headers.
- Node: 208x56, `radius.md`, `surface.1`, 1px `line-default`, `e1`; mark on the left (human circle,
  agent rounded square, tool `streamline-flex:wrench-hand`, connector `streamline-flex:link-chain`);
  name (agent ids and tools in mono) + one sub line; tools show the pinned hash short ("sha256
  9f2c..e1", mono `fg-tertiary`).
- Ports: 6px circles at the vertical middle of the left and right edges, `surface.3`, 1px
  `line-strong`.
- Edges: cubic beziers with horizontal tangents, 1.5px. Colour by latest decision: allow `accent` at
  55% opacity; deny `deny.fg`; awaiting approval or step-up their `fg`, dashed 4 4 while pending;
  AI-tightened `tightened.fg`; none yet `line-strong`.
- Edge labels only on agent-to-agent edges (tool-edge labels pile up where edges converge); session
  edges (human to agent) are neutral `line-strong`. Label: `sm` pill on `surface.overlay`, 11px:
  "denied", "breaker open" (`deny.fg` + `streamline-flex:button-power-1`, edge dashed after the
  label), "x24". A label never covers a node or a team heading; place it in the gutter between
  columns.
- Callers that are not humans sit at the bottom of the Humans column under a caps sub-label "OTHER
  CALLERS", never drawn as a human circle or an agent square. `unknown` (no authenticated human or
  session): node with a 1px dashed `line-strong` border, mark `streamline-flex:shield-cross` in
  `fg-secondary`, name "Unauthenticated", sub line `unknown` in mono. `system`: node with the Gateway
  mark `streamline-flex:shield-2` in `accent.text`, name "Gateway", sub line `system` in mono. Both
  stay neutral: their edges already carry the decision colour.
- Node text: names may truncate with a tooltip; state messages ("Descriptor changed - blocked",
  "quarantined") never truncate: the sub line wraps to two lines and the node grows.
- Event pulse: one 24px segment of `accent.edge` (deny events `deny.fg`) travels the edge once in
  `edge-flow`.
- Tool with a changed descriptor: border `deny.fg`, `streamline-flex:shield-cross`, sub line
  "Descriptor changed - blocked". Quarantined agent: quarantined treatment, outgoing edges dashed in
  quarantined colour.
- Selected node `shadow-selected`; selected edge 2.5px. Zoom controls float bottom-right on
  `surface.overlay`. Fixed column layout from the data, no auto-layout library.

## Icon ids

All ids below exist in `@iconify-json/streamline-flex` 1.2.3 and `@iconify-json/streamline` 1.2.5
(checked).

Interface primitives, `streamline:`: add `add-1`, close `delete-1`, check `check`, chevron down
`interface-arrows-button-down-arrow-down-keyboard`, chevron right
`interface-arrows-button-right-arrow-right-keyboard`, chevron left
`interface-arrows-button-left-arrow-keyboard-left`, copy `copy-paste`, show
`interface-edit-view-eye-eyeball-open-view`, hide
`interface-edit-view-off-disable-eye-eyeball-hide-off-view`, sign out `logout-1`, reset
`arrow-reload-horizontal-1`, AI-tightened `ai-chip-spark`, Director mark `eye-optic`.

Domain glyphs, `streamline-flex:`: home `home-2`, search `magnifying-glass`, notifications `bell`,
settings `cog`, filter `filter-2`, info `information-circle`, open in other host `arrow-expand`,
agent `ai-chip-robot`, human `user-circle-single`, team `user-collaborate-group`, organization
`office-building-1`, use case `target`, session `time-lapse`, capability `tag`, control `shield-1`,
Gateway `shield-2`, policy `justice-scale-1`, tool `wrench-hand`, connector `link-chain`, model
`artificial-intelligence-brain-chip`, trace `hierarchy-2`, security event `warning-diamond`, agent
message `chat-bubble-text-square`, tier `layers-1`, budget `dashboard-gauge-1`, step-up
`fingerprint-1`, quarantined `padlock-square-1`, suspended `button-pause-circle`, breaker
`button-power-1`, deny `block-2`, awaiting approval `hourglass`, approvals `inbox`, analyzer
`ai-scanner-robot`, mock `erlenmeyer-flask`, live `wave-signal-circle`, audit `text-file`, blocked
tool `shield-cross`, Identity mark `user-identifier-card`, Connect mark `link-chain`.
