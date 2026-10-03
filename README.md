# Betsee

**Better see what your agents do.** See every agent.

Betsee is an enterprise agent control ecosystem: the control plane through which an organization
sees, governs, constrains and safely operates its whole population of AI agents. Agents may reason
nondeterministically; their ability to affect the outside world runs inside deterministic execution
boundaries. Every important agent action is a small, observable request that passes through the
Betsee Gateway, is decided by explicit policy, and leaves a trace that answers who initiated it,
which agent acted, why, with what capability, on what resource, under which policy, and what was
decided.

## Quick start

Prerequisites: Docker with Compose 2.20 or newer, host port 80 free, and a browser (Chrome, Firefox,
Edge) that resolves `*.localhost` to loopback, which they all do.

```sh
docker compose up
```

That one command builds and starts the whole stack. On first start it creates `.env` from
`.env.example` (demo values only), imports the Keycloak realm, migrates PostgreSQL and seeds the
Acme Logistics demo organization. The first build compiles the Rust Gateway and takes a few minutes;
later starts reuse the cache.

| Open                               | What                                                    |
| ---------------------------------- | ------------------------------------------------------- |
| http://betsee.localhost            | Ecosystem home: Approvals, Policy Studio, Identity, Connect |
| http://director.betsee.localhost   | Director: the live control room                         |
| http://auth.betsee.localhost       | Keycloak sign-in and step-up                            |
| http://api.betsee.localhost        | Gateway API, for agents, scripts and tests              |

Sign in as **Daniel Ortiz** (`daniel`, security officer and approver); the demo passwords are in
`.env.example`. Step-up asks for a one-time code: `scripts/otp.sh` prints Daniel's current code.

The seven-act stage demo is in [`docs/demo-script.md`](docs/demo-script.md). Each act launches from
the Director's scenario dock; `demo/` holds the scenarios and the runner that drives them through the
real Gateway.

## The ecosystem

| Product           | Host                        | Purpose                                                          |
| ----------------- | --------------------------- | ---------------------------------------------------------------- |
| **Director**      | `director.betsee.localhost` | See every agent, every action, every decision, live.             |
| **Gateway**       | `api.betsee.localhost`      | Every agent action passes one deterministic boundary.            |
| **Policy Studio** | `betsee.localhost`          | Controls, Cedar policies and use cases in one place.             |
| **Identity**      | `betsee.localhost`          | Every agent is a principal with its own identity.                |
| **Connect**       | `betsee.localhost`          | Every model, provider and tool behind one boundary.              |
| **Approvals**     | `betsee.localhost`          | High-impact actions wait for a human, with proof of who they are. |

## Architecture

```text
 humans (browser, OIDC PKCE)           agents (OAuth client credentials)
          |                                         |
          v                                         v
   +-------------- Caddy reverse proxy (*.betsee.localhost) --------------+
   |  betsee.localhost   director.betsee.localhost   api.  auth.          |
   +------|----------------------|------------------|------|--------------+
          | /api                 | /api             |      |
          v                      v                  v      v
   +----------------------- Betsee Gateway (Rust, Axum, Tower) ---+  Keycloak
   | authenticate -> resolve context -> identity -> capability   |  (OIDC, MFA,
   | -> Cedar authz -> information tier -> command validation    |   step-up)
   | -> budget -> AI analysis (tighten only) -> decision         |
   | -> approval -> step-up -> connector -> output controls      |
   | -> audit                                                    |
   +----|-------------------|--------------------|---------------+
        v                   v                    v
   PostgreSQL         MCP tool server      OpenAI-compatible model
   (audit, traces,    (real MCP protocol,   endpoint (mock-llm in the
   events, catalog)   pinned descriptors)   demo; any company gateway)
```

Each of the fifteen pipeline stages is a span. The Director renders them as a trace; the same
events stream to the Director over Server-Sent Events.

Design rules the code enforces:

- **Humans and agents are distinct principals.** Each agent is its own Keycloak client. A human
  creates an AgentSession that binds human, agent, use case, delegated capabilities, information-tier
  ceiling and budget. Agent tokens are accepted only on agent routes, human tokens only on human
  routes.
- **Effective capability = delegated ∩ permitted.** The only Cedar permit for an agent action is the
  intersection of what the human delegated to the agent and what organization policy permits for
  the use case. Delegation is itself a Cedar decision: a human can delegate only what they hold. An
  agent never inherits its human's whole privilege set, and a human reaches nothing through an agent
  that policy denies them.
- **Deterministic first.** Policies are [Cedar](https://www.cedarpolicy.com/), validated in strict
  mode at startup. The Gateway refuses to start on an invalid policy and denies on any evaluation
  error.
- **AI analysis may only tighten.** The analyzer runs after the deterministic decision and can raise
  `allow` to `require_approval` or `deny`. No permit policy reads its output, and a deterministic deny
  never reaches it.
- **Human approval and step-up.** High-impact actions wait for an approver who sees the exact
  parameters the Gateway stored, not the agent's summary. An approval binds to the hash of that exact
  request. The approver must be a different person from the session's human, and the most sensitive
  actions need a fresh one-time code (Keycloak acr level 2).
- **Agent-to-agent traffic is mediated.** Agents never talk directly. The Gateway records sender
  (from the token, never from the message body), receiver, use case, requested capability,
  provenance and trace id. A message never delegates authority.
- **Controls catalog.** Every guarantee is a named control with a human-readable explanation, the
  OWASP risks it mitigates, and attachment points: organization, team, user, agent, use case, tool,
  provider/model, information tier ([`policies/controls.yaml`](policies/controls.yaml)).
- **Traceability.** Every request carries a trace id (W3C `traceparent` honoured, re-minted on
  reuse). Audit rows are append-only and keep the resolved execution context, ready for
  OpenTelemetry export.

Decision record: [`docs/security/adr-0001-policy-engine-cedar.md`](docs/security/adr-0001-policy-engine-cedar.md).
API contract: [`contracts/openapi.yaml`](contracts/openapi.yaml) and
[`contracts/events.md`](contracts/events.md).

## OWASP Top 10 for Agentic Applications (2026)

Nine small primitives in one pipeline, not ten separate defences.

| Risk                                       | Primary Betsee primitive                      | Demo act |
| ------------------------------------------ | --------------------------------------------- | -------- |
| ASI01 Agent Goal Hijack                    | Information tiers + taint (no write-down)     | 3        |
| ASI02 Tool Misuse and Exploitation         | Capability intersection + Cedar authorization | 2        |
| ASI03 Identity and Privilege Abuse         | Agent identity + delegation (AgentSession)    | 2, 5     |
| ASI04 Agentic Supply Chain Vulnerabilities | Tool integrity (pinned MCP descriptors)       | 6        |
| ASI05 Unexpected Code Execution            | Command validation                            | 2        |
| ASI06 Memory and Context Poisoning         | Information tiers + taint; AI analysis tightens | 3      |
| ASI07 Insecure Inter-Agent Communication   | Mediated agent-to-agent channel               | 4        |
| ASI08 Cascading Failures                   | Budget, circuit breaker + quarantine          | 4        |
| ASI09 Human-Agent Trust Exploitation       | Human approval + step-up                      | 5        |
| ASI10 Rogue Agents                         | Budget, circuit breaker + quarantine          | 6        |

The full mapping, with every control, the Agent Control Standard, LLM Top 10 2026, MCP Top 10 and
AISVS cross-references, and an explicit list of what Betsee does **not** claim, is in
[`docs/security/owasp-mapping.md`](docs/security/owasp-mapping.md).

## Tests

```sh
# Cedar policies: strict validation plus the reference decision cases for the demo cast
cargo run --release --manifest-path policies/tests/cedar-check/Cargo.toml -- \
  policies/schema.cedarschema policies policies/tests/acme-cases.json

# Gateway decision crate: the same cases plus the composition rules, no containers needed
cargo test --manifest-path gateway/Cargo.toml -p betsee-decision

# Positive and negative security suite against the running stack
./tests/run-security.sh
```

The security suite sends real HTTP requests with real Keycloak tokens. Positive cases prove that
allowed actions execute; negative cases prove that each deny holds: capability not delegated, tier
above the session ceiling, no write-down, AI analysis unable to loosen a deny, an agent unable to
use its human's privileges, foreign or forged sessions, wrong-audience and expired tokens, approval
and step-up bypass, mediated agent messages, tool descriptor drift, budget, and quarantine. Each case
names its ASI categories. See [`tests/README.md`](tests/README.md).

## Repository layout

| Path                      | Contents                                                                 |
| ------------------------- | ------------------------------------------------------------------------ |
| `gateway/`                | Rust workspace: the pure decision crate and the Gateway server; MCP demo server and mock model binaries |
| `policies/`               | Cedar schema and policies, controls catalog, reference cases and checker |
| `contracts/`              | OpenAPI contract and SSE event contract                                  |
| `web/`                    | React, TypeScript, Vite, Tailwind: `apps/director`, `apps/ecosystem`, shared `packages/ui` and `packages/api` |
| `infra/`, `docker-compose.yml` | Compose services, Caddy, Keycloak realm, Dockerfiles                 |
| `scripts/`                | Bootstrap, OIDC login helper, one-time code helper                       |
| `demo/`                   | Demo scenarios and the scenario runner                                   |
| `tests/`                  | Security suite                                                           |
| `docs/`                   | Design Contract, security decisions and OWASP mapping, demo script       |

## Demo-only shortcuts

Stated plainly, because a control plane that hides its shortcuts would be a poor one:

- **The language model is a mock.** `mock-llm` speaks the OpenAI chat-completions protocol, and the
  Gateway's OpenAI-compatible adapter is real code. Pointing it at a company AI gateway, vLLM,
  Ollama or LM Studio is configuration. The AI security analyzer is labelled "mock model (demo)"
  wherever it appears.
- **Scenario sessions use a password grant.** The `betsee-demo-runner` client may obtain tokens for
  users holding the `demo-initiator` role (Maya and Priya), and those tokens are refused on
  approvals, step-up and admin writes. In production the human creates the session in the UI; the
  password grant is deprecated in OAuth 2.1.
- **Demo secrets and a pre-provisioned one-time-code secret** live in `.env.example` so the demo is
  reproducible. Real deployments generate their own.
- **Plain HTTP on `*.localhost`**, which browsers treat as a secure context.

Paths to scale, documented and not built: RFC 8693 token exchange for session-bound agent tokens,
OpenTelemetry export of the audit and span model, a monitor mode for rolling out new controls, and
signed tool manifests.

## Credits

Icons by Streamline (streamlinehq.com), CC BY 4.0. Policy engine: Cedar (Apache 2.0). Identity:
Keycloak (Apache 2.0).
