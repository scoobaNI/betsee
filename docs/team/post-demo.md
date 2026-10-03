# After the demo

Owner: kierownik-session. Items found after the scope freeze (D21, 19:44). Each one is real and
deliberately not fixed before the demo, because none of them blocks the stage.

| Area | Item | Found by |
| --- | --- | --- |
| Audit | The Gateway's database role owns the audit tables, so the append-only triggers stop bugs, not a compromised Gateway. Use a least-privilege insert-only role, hash-chained or signed rows, and an external sink. | kierownik-session (F08) |
| Policy Studio | Control attachments can be added but not detached through the API. | kierownik-session (F09) |
| Gateway API | `ActionRequest.resource.tier` is required from the agent but ignored, because the catalog label wins. Drop the field from the request. | kierownik-session (F08) |
| Gateway API | `GET /api/v1/connectors` observes the MCP server and writes tool status: a GET with side effects. Move the observation to a background task. | identity-infra (stage-check) |
| Gateway performance | The Cedar evaluation takes 30 to 70 ms per action, most of it building and validating entities. Cache the schema-validated entities per session. | kierownik-session (D11 timings) |
| Tests | Connector-error attribution (CTL-POL-001) is code-reviewed, not live-tested; it needs a fault-injection fixture. | security-architect (p-633) |
| Policies | The `act4.s2` case name in `policies/tests/acme-cases.json` and the PRM-RUN row in `docs/security/owasp-mapping.md` say act 4's retries hit the rate limit; live, they deny on CTL-A2A-003 until the breaker quarantines research-agent. | security-architect (p-752) |
| Frontend | The Director's main chunk is over 500 KB; split it by route. | frontend-ecosystem (p-490) |
| Identity | The four rerouted tasks still list Codex as their default agent in Crabify; a task restart reopens the Codex tab. | kierownik-session (D19) |
| Director | A skipped stage nested under Cedar (command validation on act 1's allow) reads 'Skipped' in the rail but 'decided in the same Cedar evaluation' in the waterfall; the two views should agree. | product-designer (p-762) |
| Gateway | Ending a session voids its approvals but leaves their traces at approval_state 'pending' (D22). Fix is IN TREE, NOT IN THE DEMO IMAGE (D24/p-816): api.rs `end_session` + contracts, fmt/clippy/test/prettier green; voided approvals set the record and trace `approval_state` to `voided` plus an `action.updated` event. Deliberately not built before freeze (FAIL-1 covers the screen frontend-side); needs one Gateway `--build` to ship, since the 22:45 `up` reuses the existing image. | kierownik-session (p-764, p-816); backend-gateway (p-815) |
| Seed data | The test-only agent research-peer and its 0.01 EUR test session appear in the stage population; seed them only for test runs. | product-designer (p-759) |
| Director | Inline CTL IdTokens in the quarantine reason leave stray spaces ('CTL-RUN-003 : 5 denials', '( CTL-RUN-001 )'). | product-designer (p-793) |
| Director | The D22 'Voided (session ended)' chip uses deny styling; nobody denied anything, so style it neutral like the contract's 'expired' state. | product-designer (p-832) |
| Process | Rehearsal drivers capture the 1920x1080 viewport, not the full page, so screenshots stay readable. | product-designer (p-832) |
| Tests | privileged_human_agent failed once under a heavy back-to-back burst (not a Gateway race; decision always correct; 3/3 clean reset-then-suite runs and 4 later runs green). Add a bounded wait-and-retry on its GET reads. | security-tester (p-834) |
