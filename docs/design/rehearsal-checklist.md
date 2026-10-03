# Rehearsal design checklist

Used by product-designer in the F18 dress rehearsal (D16) to check every screenshot against
`design-contract.md` and `components.md`. One line per beat in `docs/demo-script.md`; a beat
passes when every check holds at 1920x1080.

Screenshot naming: `act<N>-<beat>.png` (for example `act2-tier-deny-trace.png`), all in one folder
per driver.

## Every screenshot

- Dark theme, tokens only; no browser chrome, bookmarks bar hidden, zoom 100%.
- No "Mock data" badge (live stack); stream pill reads "Live".
- Every action row has a decision chip with icon and word; deny rows carry the left bar.
- No truncated agent id or state message; identifiers never break mid-word.
- Nothing hidden behind the scenario dock.
- No forbidden words; every AI verdict sits next to "mock model (demo)".

## Per beat

| Beat          | Surface                                           | Must show                                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 opening     | betsee.localhost Home                             | Hero "See every agent." and tagline; KPI row with one feature tile; six product tiles; Streamline credit in the footer                                                                                                                                              |
| 0 host change | director.betsee.localhost Live                    | Address bar or host visible in the shot; all agents visible without scrolling                                                                                                                                                                                       |
| 1 feed        | Director Live                                     | Feed mostly Allowed; "n new" pill in the header if frozen, never over a row                                                                                                                                                                                         |
| 1 trace       | Trace explorer (allow)                            | Decision sentence; seven cells; pipeline rail; measured bars only on measured stages, stages with parent_stage cedar_authz (identity, capability, tier, command validation, budget) as child rows; decision, approval, step-up never nested; "<0.1 ms" not "0.0 ms" |
| 2 tier deny   | Trace explorer                                    | "Denied because CTL-TIER-001 Resource tier ceiling: the resource is restricted, the session ceiling is internal."; tier stage red; later stages "not reached" except decision (denied) and audit (passed)                                                           |
| 2 drawer      | Agent drawer                                      | Delegated / Effective / Permitted cells and the matrix with the caption; qualifier under the capability with the currency                                                                                                                                           |
| 2 curl deny   | Feed or trace                                     | Command validation stage red; Gateway reason sentence                                                                                                                                                                                                               |
| 3 email deny  | Trace explorer                                    | CTL-TIER-002 sentence (session read internal data, destination public)                                                                                                                                                                                              |
| 3 tightened   | Trace explorer                                    | Split chip "Awaiting approval / AI-tightened"; composition panel Deterministic -> AI analysis (with mock model badge) -> Final, fixed caption under it                                                                                                              |
| 4 graph       | Director Graph                                    | Denied agent-to-agent edge with "denied" pill in the gutter; then "breaker open"; research-agent node quarantined; OTHER CALLERS styled per spec if present                                                                                                         |
| 5 counter     | Director top bar                                  | "Awaiting human" count links to Approvals                                                                                                                                                                                                                           |
| 5 card        | Approvals                                         | Step-up badge before the click; "48,000.00 EUR" headline with "Source: Gateway"; payee; agent memo only in the dashed unverified block; resting card at full contrast                                                                                               |
| 5 OTP         | auth.betsee.localhost                             | Themed card, mark tile, fingerprint, "Confirm it is you", one-time code field                                                                                                                                                                                       |
| 5 approved    | Approvals and Director trace                      | Approved chip with approver and acr 2; trace shows the approval and step-up spans                                                                                                                                                                                   |
| 5 reject      | Approvals                                         | Act 3 memory write rejected; deny styling                                                                                                                                                                                                                           |
| 6 tool        | Director Graph                                    | payments node red, "Descriptor changed - blocked" on two lines, not truncated                                                                                                                                                                                       |
| 6 quarantine  | Director Live                                     | report-bot tile hatched with the full reason (CTL-RUN-003 ... on consumption ...); burst row collapsed with "xN"                                                                                                                                                    |
| 7 coverage    | Director Coverage                                 | Ten rows with primitive, CTL chips and evidence; "Not claimed in v0" block; no row without its act                                                                                                                                                                  |
| 7 reset       | Director Live after "Reset scenario"              | Quarantined tiles return to Active; release rows render as Observation rows (Gateway mark, "Observed"), not as Allowed requests                                                                                                                                     |
| 7 suite       | Director Live feed during ./tests/run-security.sh | Feed fills with decided rows and Observation rows; "Awaiting human" in the top bar matches Home                                                                                                                                                                     |
