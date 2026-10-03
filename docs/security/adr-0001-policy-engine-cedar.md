# ADR-0001: Cedar as the policy engine, and how the Gateway maps it to Betsee decisions

Status: accepted (v0, 2026-10-03). Owner: security-architect. Implements: F03. Consumers: backend-gateway
(F09, F10, F13), security-tester (F17), frontend-ecosystem (Policy Studio, controls catalog).

Files: `policies/schema.cedarschema`, `policies/*.cedar`, `policies/controls.yaml`,
`policies/tests/acme-cases.json`, reference checker `policies/tests/cedar-check/`.

## Decision

Betsee's deterministic decisions are made by **Cedar**, embedded in the Gateway through the
`cedar-policy` crate (4.13), evaluated in process, with the schema validated in **strict** mode at
startup. No Betsee-specific policy language exists or will be written.

## Why Cedar

- **Deterministic and bounded.** No loops, no I/O, guaranteed termination. A decision is a pure
  function of policies, entities and context, which is exactly the "deterministic execution boundary"
  of the flagship principle.
- **Schema-validated.** Strict validation rejects a policy that reads an attribute that does not
  exist, compares the wrong types or can never apply. Typos fail the build, not the demo.
- **Explainable.** Every decision returns the ids of the policies that decided it. With an `@id` and
  a `@control` annotation on every policy, the trace explorer can say "denied by
  `forbid-write-down`, control CTL-TIER-002" with no extra bookkeeping.
- **RBAC and ABAC in one model.** The entity hierarchy (Agent in Team in Organization) carries roles
  and scope. Attributes (tier, taint, budget, amount) carry conditions.
- **Rust-native.** One crate in the Gateway's pure decision crate, tested with plain `cargo test`
  and no container.
- **Default deny, forbid overrides permit.** Adding a forbid can only make the system stricter. That
  property is what makes the AI analyzer safe to compose (below).

Alternatives considered:

| Engine                          | Why not                                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPA / Rego (or regorus in Rust) | Untyped. A misspelled attribute is `undefined`, which is a silent fail-open risk. More expressive than we need, and OPA proper is another service.              |
| OpenFGA / SpiceDB (Zanzibar)    | Relationship tuples are good for sharing graphs. They are poor at attribute conditions (tier, amount, taint, budget), and they need a server and a tuple store. |
| Casbin                          | Matcher strings with no schema, no type checking and no analysis tooling.                                                                                       |
| Custom DSL                      | Ruled out by the brief, and every property above would have to be rebuilt.                                                                                      |

Cedar's limits, none of them blocking:

- No ordered enums. Tiers are `Long` ranks: 0 public, 1 internal, 2 confidential, 3 restricted.
- Only Allow or Deny. The obligation mapping below produces `require_approval` and
  `require_step_up`.
- Template slots are limited to principal and resource. Team and agent attachments use templates.
  Use case, tool, model, tier and user attachments are data.
- **A forbid whose evaluation errors is skipped.** Strict validation removes type errors. The Gateway
  also treats any evaluation error as deny (CTL-POL-001).

## The model

| Cedar     | Betsee                                                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| principal | the authenticated `Agent` (for `session.create`: the `Human`)                                                                                                                                                                                                                        |
| action    | the capability verb, `Action::"payments.transfer"`, grouped into `read`, `write`, `egress`, `high_impact`, `mcp`, all under `agent_action`                                                                                                                                           |
| resource  | the data `Resource` (customer record, ticket, file, recipient, payment account, host, memory store) whose parent is the `Tool` serving it. For `agent.message` the resource is the receiving `Agent`; for `llm.complete` it is the `Model`.                                          |
| context   | the execution context: `session` (AgentSession entity), `capability`, `now`, `costCents`, `actionsLastMinute`, `approval {granted, stepUp}`, and optionally `analysis`, `toolCall {tool, observedDescriptorHash}`, `command {template, valid}`, `amountCents`, `requestedCapability` |

**Effective capability is explicit in the schema.** `AgentSession.delegated` and
`UseCase.permitted` are both `Set<Capability>`. The only permit for agent actions is:

```cedar
permit (principal is Betsee::Agent, action in Betsee::Action::"agent_action", resource)
when {
  context.session.delegated.contains(context.capability) &&
  context.session.useCase.permitted.contains(context.capability)
};
```

Every other agent policy is a `forbid`. Two forbids mirror the two halves of the intersection, so a
denial names which side failed. Delegation is itself a Cedar decision (`session.create`). A human
can delegate only `delegated ⊆ Human.entitlements ∩ UseCase.permitted`, at a tier no higher than
`min(Human.clearance, UseCase.tierCeiling, Agent.clearance)`.

**Controls attach in three ways** (`policies/controls.yaml`):

- `baseline`: always on.
- `data`: the attachment is an entity attribute such as `UseCase.approvalThresholdCents`,
  `Tool.pinnedDescriptorHash` or `Model.maxTier`.
- `template`: the Gateway links `tpl-suspend-high-impact` with `?principal` set to a Team or an
  Agent.

Each control names its primitive, so the ASI coverage view is derived from `controls.yaml` alone:
ASI, then controls, then primitive.

## Gateway contract for F09

1. **Load.** At startup, read `policies/schema.cedarschema`, then every `policies/*.cedar` in file
   order.
   - `PolicySet::from_str` numbers policies `policy0...`. Re-key every policy and template by its
     `@id` annotation (`Policy::new_id`, `Template::new_id`); a policy without `@id` is a startup
     error.
   - Link stored template attachments.
   - Run `Validator::validate(.., ValidationMode::Strict)`. **Refuse to start** on any validation
     error.
2. **Entities per request**, validated with `Entities::from_json_value(.., Some(&schema))`:
   - the session;
   - its human, agent and use case, and the use case's agents and peers;
   - the `Capability` entities referenced;
   - the resource with its parent tool and connector, or the model;
   - the receiving agent for `agent.message`;
   - the team and organization ancestors.

   Attribute values are Gateway facts loaded from PostgreSQL, never values the agent sent.

3. **Context** built with `Context::from_json_value(.., Some((&schema, &action)))`. `capability`
   is the same verb as the action. `approval` is computed from the approval record bound to this
   exact request (below). `toolCall.observedDescriptorHash` is the hash of the descriptor the MCP
   server reports now.
4. **Decision** (the composition the reference checker implements):

   ```text
   evaluate(ctx):
     resp = cedar(ctx)
     if resp has errors                  -> DENY [CTL-POL-001]          (fail closed)
     if resp == Allow                    -> ALLOW
     reasons = resp.reason()             (the forbids that fired)
     if reasons is empty                 -> DENY (no permit: capability not effective)
     if any reason lacks @outcome        -> DENY (hard), deciding = those reasons
     obligations = { @outcome of each reason }      // require_approval, require_step_up
     if cedar(ctx with approval = {granted: true, stepUp: true}) != Allow
                                         -> DENY   (a permit is missing; approval cannot help)
     else                                -> OBLIGATIONS(obligations)

   decide(request):
     det = evaluate(ctx without analysis)
     if det is DENY                      -> DENY, analyzer not called (recorded as skipped)
     ai  = evaluate(ctx with analysis)   // analyzer = mock model (demo), via the connector layer
     if ai is DENY                       -> DENY, tightened_by_ai = true
     final obligations = det.obligations ∪ ai.obligations
     tightened_by_ai = final != det
   ```

   Displayed decision:
   - `deny`, if the composition denies;
   - otherwise `require_approval`, with `step_up_required: true` when `require_step_up` is also an
     obligation;
   - otherwise `require_step_up`;
   - otherwise `allow`.

   **Correction to p-31:** obligations compose by **union**, not by `max` over a total order
   `deny > step_up > approval > allow`. Under `max`, an analyzer asking for approval on an action
   that already needs the human's own step-up would be dropped, because approval sorts below
   step-up. They are different obligations: a second person versus a fresh factor. Deny still
   dominates everything.

5. **Decision record** (audit row, SSE event, trace span):
   - `decision`, `obligations`, and `deciding_policies` (the `@id`s);
   - `controls` (their `@control`), and for each control its `name` and `explanation` from
     `controls.yaml`;
   - `analysis {verdict, analyzer: "mock model (demo)", skipped}` and `tightened_by_ai`;
   - `reasons`: one `{policy_id, control_id, text}` per deciding policy (D12). `text` is that policy's
     `@reason` annotation rendered from Gateway facts. The placeholders are `{resource.tier}`,
     `{session.tierCeiling}`, `{session.taint}`, `{recipient.tier}`, `{capability}`, `{useCase}`,
     `{amount}`, `{threshold}`, `{tool}` and `{receiver}`. If any placeholder cannot be resolved, the
     whole text falls back to the control's explanation, so a raw brace never reaches the screen.
     The reference checker fails on a policy without `@reason` or with an unknown placeholder;
   - `trace_id`.
6. **State the Gateway maintains after execution.** These become entity attributes on the next
   request:
   - `AgentSession.taint = max(taint, resource.tier)` after every allowed read. `resource.tier` is
     the catalog label, never a tier the connector reports (D9);
   - an allowed agent message raises the receiver's session taint to the sender's, and sets the
     receiver's `untrustedInput` (D9); the sender's session is unchanged;
   - `AgentSession.untrustedInput = true` after reading a ticket of external origin, or after
     reading a memory entry written by an untrusted session;
   - `AgentSession.spentCents += costCents`;
   - the actions-per-minute counter;
   - the circuit breaker (CTL-RUN-003), which sets `Agent.state = "quarantined"`.
7. **Approvals.** An approval binds to a hash of the exact ActionRequest: session, capability,
   resource and parameters. Re-submitting the same request with that approval sets
   `approval.granted`. `approval.stepUp` is true only when:
   - the approver's token carries the realm's acr for level 2 (OTP);
   - its `auth_time` is at most 300 s old;
   - the approver holds the realm role `approver`;
   - the approver is not the session's own human (four-eyes, CTL-APR-004).

## D1 review (agent identity): accepted, with amendments

D1 stands: each agent is a confidential Keycloak client using client credentials, a logged-in human
creates the AgentSession, and every action carries the agent token plus the session id. The
amendments:

1. **Session creation is a policy decision.** `POST /api/v1/sessions` evaluates `session.create`.
   Delegation must stay within the human's entitlements and the use case, and the tier ceiling within
   the human's clearance, the use case ceiling and the agent's clearance. This is what makes "the
   agent never inherits the human's whole privilege set" true by construction.
2. **The session id is not a credential.** It is checked against the authenticated agent
   (CTL-ID-001), so a leaked id is useless to any other agent. The agent is identified by the
   token's `azp` (client id), never by a claim the agent can choose.
3. **Principal types stay separate.**
   - Agent tokens (client-credentials grant, `aud` contains the gateway client) may call
     `/api/v1/actions` and `/api/v1/agent-messages` only.
   - Human tokens may call sessions, approvals and admin endpoints only.

   The Gateway rejects the other kind with 403, so an agent cannot approve its own action. Every
   route takes only `Authorization: Bearer`, with no cookie (D9). The full per-route matrix is
   `docs/security/route-matrix.md`.

   **Demo-only exception (D7).** The confidential client `betsee-demo-runner` may obtain human
   tokens through a direct-grant flow. It is limited to users holding the realm role
   `demo-initiator` (Maya and Priya, never Daniel). The Gateway accepts a human token with
   `azp = betsee-demo-runner` only for `POST /api/v1/sessions`. It rejects such a token on
   approvals, step-up and every admin write, and a security test proves the approvals rejection.
   The exception exists because scenario sessions must be created by the scenario's human (Maya),
   so that Daniel can still approve under four-eyes. In production the human creates the session in
   the UI, and the password grant is deprecated in OAuth 2.1.

   D7a extends the exception to read-only GET endpoints, still under the normal role checks. Reads
   cannot weaken four-eyes or step-up. Approvals, step-up and admin writes stay rejected, and the
   suite asserts one approval rejection and one admin-write rejection.

4. **Short-lived agent tokens** (300 s). The Gateway validates issuer
   `http://auth.betsee.localhost/realms/betsee`, audience, expiry and signature against the
   in-network JWKS. Client secrets live in `.env` for the demo; `private_key_jwt` is the production
   path.
5. **Scale path**, documented, not built: RFC 8693 token exchange mints a session-bound token with
   `sub` = human, `act.sub` = agent, and the session id as a claim. One bearer then carries the
   whole delegation, and the session lookup becomes a cache.

## Consequences

- backend-gateway implements the load, the context building and the composition above in the pure
  decision crate. `policies/tests/acme-cases.json` (37 cases over the Acme seed, one per demo-act step
  plus negative paths) is the conformance set its unit tests must pass. Each case gives principal,
  action, resource, context, optional entity `patch` and template `links`, the `expect`ed Betsee
  decision, and an `expect_reason` policy id.
- The reference checker `policies/tests/cedar-check` runs the same composition:

  ```sh
  cargo run --release --manifest-path policies/tests/cedar-check/Cargo.toml -- \
    policies/schema.cedarschema policies policies/tests/acme-cases.json
  ```

  It is a test oracle, not the Gateway implementation. It also enforces the analyzer invariant:
  no permit policy may read `context.analysis`.

- A policy change is a pull request to `policies/` that keeps strict validation and the case file
  green. Runtime attachment changes go through the catalog (data and template links), not through
  Cedar text edits.
- Policy Studio shows Cedar text read-only in v0.
