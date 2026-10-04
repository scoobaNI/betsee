# Security verification

Run the real-stack suite from the repository root:

```bash
./tests/run-security.sh
```

Python 3.10 or newer is the only harness dependency. The suite sends real HTTP requests to
`http://api.betsee.localhost` and `http://auth.betsee.localhost`. It obtains short-lived human and
agent tokens from the imported Acme realm. Credentials resolve from environment variables, `.env`,
then the documented demo defaults in `.env.example`. Requests do not print tokens or passwords.

Each case names its ASI categories. Expected outcomes live in `security/catalog.py`; request
fixtures cannot replace them. Each action must return the expected decision and execution flag.
Allowed actions must include connector output. Denied actions must name the expected control.
Every action is matched to the persisted trace listing by its `trace_id`, and every returned
action audit entry must carry a nonempty correlation ID.

The live analyzer skips deterministic denies. Its inability to loosen a deny with a clean verdict
is also checked in the Gateway's pure decision tests, alongside the architect's 37 policy cases:

```bash
cargo test --manifest-path gateway/Cargo.toml -p betsee-decision
```

The suite keeps unsupported fixtures pending, with their missing feature named. Pending checks
never count as live passes. Exit codes: `0` all selected checks passed; `1` a check failed; `2`
invalid fixture configuration; `3` pending coverage remains. `--allow-pending` is for development
and still fails on actual test failures. A selected subset reports the selected and total counts.

```bash
./tests/run-security.sh --identity
./tests/run-security.sh --self-test
./tests/run-security.sh --list
./tests/run-security.sh --case allowed_read --case capability_not_delegated
./tests/run-security.sh --report tests/security/results.local.json
```

`--identity` checks real Keycloak discovery/JWKS, the five distinct agent subjects and their
audience/identity claims, Maya/Priya demo grants, Daniel's role-gated rejection, and disabled password
grants on browser clients. It inspects issued JWT claims; Gateway signature validation is checked
by the action suite. `--self-test` checks the harness locally and does not verify the Betsee stack.

`security/live_fixtures.py` contains requests for the Acme cast and catalog resource IDs from
`policies/tests/acme-cases.json`. Cases requiring Daniel's browser step-up, a signed expired token,
or a valid wrong-audience token remain pending until their fixtures land. Shared agents must not be
quarantined or shared tool descriptors changed without a scenario reset. A regular run creates fresh
sessions; it does not reset the shared stack.

Four ASI08/ASI10 cases run on isolated principals so the demo cast is left exactly as found:

- `cascade_breaker` (CTL-RUN-002): the test-only `research-peer` reads up to its use case's
  `maxActionsPerMinute`, then one more action exceeds the rate. The denial-cascade breaker
  (quarantine at five denials) stays untouched, since the measured action is the only denial.
- `quarantined_agent` (CTL-ID-002): five tier denials quarantine `research-peer`, then a normally
  allowed read is refused because the agent is no longer active.
- `budget_exceeded` (CTL-RUN-001): a one-cent `research-peer` session cannot cover a ten-cent
  action, so the first read is denied on budget.
- `descriptor_drift` (CTL-TOOL-001): the payments MCP descriptor is drifted, a below-threshold
  transfer is denied before execution, and the pinned descriptor is restored afterwards.

Each of these releases its agent (and `descriptor_drift` restores the descriptor) in a `cleanup`
step that always runs, so a fresh breaker window, active agent state and the pinned descriptor are
all restored even if a step fails. `research-peer` is released with Daniel's real acr-1 browser
token (`scripts/oidc-login.py`; no OTP, no step-up).

The MCP admin descriptor route is in-network only, so `descriptor_drift` reaches it through the
`demo-runner` container with a `shell` setup/cleanup step (`docker compose exec`), run from the
repository root. That step needs a local Docker Compose stack; set `shell_timeout_seconds` to adjust
its timeout. A fixture `shell` step is `{"shell": [argv...]}` and must exit zero.

For a request-fixture override, pass `--fixtures <path>` or set `BETSEE_SECURITY_FIXTURES`. The JSON
has `version: 1`, an optional common `setup` list, and a `cases` mapping keyed by catalog case ID.
Each case has `setup`, `steps` and an `audit` request; each step has a `request` and optional
`before`, `save`, `action_path` (for nested approval results), and `trace` lookup (for A2A). Setup
requests must succeed, and can `save` response fields or `check` preconditions. A missing case or an
explicit `pending` reason produces a pending result. Missing credentials are pending; HTTP errors,
incorrect decisions, missing audit evidence, and setup failures are failures.

Request objects use `method`, an origin-relative `path`, `headers`, and either `json` or `form`.
`base` is `api` or `auth`. `{"$ref":"variable"}` preserves a saved JSON value's type;
`{"$format":"Bearer {token}"}` builds a string; `{"$env":"VARIABLE"}` reads a credential.
Response field mappings can be overridden through `fields` when an announced contract changes.
Requests cannot change service origins or follow redirects. `BETSEE_API_URL` and `BETSEE_AUTH_URL`
override the base addresses for another demo deployment.

F17 is complete only after the full live suite passes with no pending cases. F18 additionally needs
a cold startup and the actual acts in `docs/demo-script.md`; neither is proved by local self-tests.

## AI control layer

Twelve catalog cases run model calls and model loads as the test-only `research-peer` in the
`model-onboarding` use case (balanced profile, 500 cents, 3000 tokens): an allowlisted external
model priced from its usage, a model switched off in `guardrails.yaml`, a call whose worst case
exceeds the token budget, prompt redaction, output redaction of a contact card, removal of a
data-carrying image link, a Polish injection sent to approval, a Ray Jobs API payload, and four
`model.load` supply-chain cases. Plans may add `checks` per step (`path` plus `equals`, `contains`,
`excludes` or `at_least`) to assert fields beyond the decision.

`guardrails_live.py` adds ten checks outside the action envelope, with Maya's and Daniel's real
browser tokens: input redaction under the balanced profile and refusal under strict, a Polish
paraphrased injection, a base64-encoded injection, an ordinary Polish request, a Langflow exploit
URL, a malicious pickle at file intake, a GGUF chat template in the artifact scanner, and live
reconfiguration. `guardrails_hot_reload` edits `policies/guardrails.yaml` (assignment change, then a
broken value that must be rejected) and `threat_feed_hot_update` adds a canary signature to
`infra/threat-feed/feed.json`; both restore the file in a `finally` and wait until the Gateway
reports the original version again. Select them like catalog cases (`--case guardrails_hot_reload`).
