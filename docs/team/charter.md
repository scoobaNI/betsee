# Betsee team charter

Owner: kierownik-session. Read this before writing anything. Change requests go to kierownik-session
on the board.

Betsee is an Enterprise Agent Control Ecosystem. Tagline: "better see what your agents do". Core
message: See every agent. It is the control plane through which an organization sees, governs,
constrains and safely operates its whole population of AI agents. Never call it an "AI firewall" or a
"prompt injection filter", in code, UI copy or docs.

Flagship principle: nondeterministic agents operate inside deterministic execution boundaries.

## One shared checkout

All eight sessions work in the same checkout, `/home/t-kozlowski/Repos/betsee`, on `main`. Another
session's uncommitted work sits in the same tree as yours. Therefore:

- Write only inside the paths you own (table below). To change someone else's file, post to its owner.
  A one-line obvious fix is allowed if you post a `--kind fix` note to the owner at once.
- Never run `git checkout -- <path>`, `git restore`, `git reset`, `git stash`, `git clean`, a branch
  switch, or a formatter or codemod over paths you do not own. Each of these destroys other sessions'
  uncommitted work and cannot be undone.
- Never `git commit` (a hook blocks it). At the end of a change, write a Conventional Commits message
  as text, scoped to your area: `gateway`, `policies`, `contracts`, `infra`, `identity`, `web`,
  `director`, `ecosystem`, `demo`, `tests`, `docs`.
- `npm install` runs only from `web/` (npm workspaces, one lockfile). Announce a new dependency on the
  board. If the lockfile conflicts, rerun `npm install` in `web/`.
- One Cargo workspace in `gateway/`; only backend-gateway edits its root `Cargo.toml`.
- No emoji anywhere: code, comments, UI, docs, commit messages, board posts.

## Path ownership

| Path                                                                       | Owner                                                     |
| -------------------------------------------------------------------------- | --------------------------------------------------------- |
| `README.md`, `docs/team/`, `docs/demo-script.md`                           | kierownik-session                                         |
| `docs/security/` (crabify reuse report, OWASP mapping, threat model, ADRs) | security-architect                                        |
| `policies/` (Cedar schema, policies, controls catalog seed)                | security-architect; backend-gateway after posting         |
| `demo/` (demo agents, scenario definitions, scenario runner)               | security-architect                                        |
| `contracts/` (`openapi.yaml`, event schema)                                | backend-gateway                                           |
| `gateway/` (Rust workspace, migrations, seed data, connectors)             | backend-gateway                                           |
| `gateway/crates/server/src/bin/betsee-mcp.rs`, `.../bin/mock-llm.rs`       | identity-infra (handed over 16:30, p-177)                 |
| `docker-compose.yml`, `.env.example`, `infra/`, `scripts/`, `.gitignore`   | identity-infra                                            |
| `web/` root files, `web/packages/ui/`, `web/apps/ecosystem/`               | frontend-ecosystem                                        |
| `web/apps/director/`, `web/packages/api/`                                  | frontend-director (frontend-ecosystem may add its own resource modules in `packages/api`) |
| `docs/design/` (Design Contract)                                           | product-designer                                          |
| `tests/` (security suite, end-to-end demo check)                           | security-tester                                           |

## Hosts and ports

| Host                              | Serves                                                          |
| --------------------------------- | --------------------------------------------------------------- |
| `http://betsee.localhost`          | Ecosystem shell (`web/apps/ecosystem`)                          |
| `http://director.betsee.localhost` | Director (`web/apps/director`)                                  |
| `http://auth.betsee.localhost`     | Keycloak                                                        |
| `http://api.betsee.localhost`      | Gateway, for agents, scripts and tests                          |

- Both UI hosts also proxy `/api/*` to the Gateway, so browser code calls relative `/api/...`: same
  origin, no CORS, plain SSE.
- Reverse proxy: Caddy on host port 80 (verified free on this machine), plain HTTP. `*.localhost` is a
  secure context in browsers and resolves to loopback here.
- Compose project name `betsee`. Other stacks run on this machine (`tester-pp-*`, `tester-lsp-*`):
  publish no host port except 80, plus Postgres on `127.0.0.1:55432` for local tooling.
- Containers must not reach each other through the public hostnames: inside a container
  `auth.betsee.localhost` is the container's own loopback. Token issuer stays
  `http://auth.betsee.localhost/realms/betsee`; the Gateway fetches JWKS from the in-network Keycloak.

## Shared vocabulary

Use these names in code, API, UI copy and tests. A rename goes through kierownik-session.

- **Organization**, **Team**.
- **Human**: a person, linked to Keycloak by `sub`. **Agent**: a first-class principal with its own
  credential, an owning team, a provider/model, and a lifecycle state `active | quarantined |
  suspended`. Humans and agents are distinct principals.
- **UseCase**: why an agent runs. Carries a capability ceiling, an information-tier ceiling, approval
  rules and a budget.
- **AgentSession**: one run. Human actor + agent + use case + delegated capabilities + budget +
  approval state.
- **Capability**: dotted verb, e.g. `crm.read`, `tickets.write`, `email.send`, `payments.transfer`,
  `files.read`, `shell.exec`, `memory.write`, `agent.message`, `llm.complete`.
  **Effective capability = delegated to the agent ∩ permitted by organization policy for the use
  case.**
- **InformationTier**: `public < internal < confidential < restricted`, on resources and on
  sessions.
- **Tool** (an MCP tool, with a pinned descriptor hash), **Connector** (`anthropic-direct`,
  `company-ai-gateway`, `local-model`, `self-hosted`, `mcp`), **Model**.
- **Control**: a catalog entry with an id (`CTL-...`), a name, a human-readable explanation, the ASI
  risks it mitigates, and attachment points: organization, team, user, agent, use case, tool,
  provider/model, information tier. **Policy**: Cedar.
- **ActionRequest** -> **Decision** `allow | deny | require_approval | require_step_up`, with the
  deciding controls, policy ids, reasons, and the AI analysis verdict, which can only tighten.
- **Approval**, **SecurityEvent**, **AgentMessage** (sender agent, receiver agent, use case,
  capability, provenance, trace id), **Trace**: `trace_id` is the correlation id; each pipeline stage
  is a span.

## The flagship flow

Every important agent action passes through the Gateway:

```
agent -> POST /api/v1/actions
  -> authenticate agent
  -> resolve execution context (org, human, agent, use case, session, action, tier,
     delegated capability, approval state, budget)
  -> deterministic controls: identity, capability intersection, Cedar resource authz,
     information tier, command validation, budget
  -> AI security analysis (may tighten, never loosens a deterministic DENY)
  -> decision; if required: human approval and step-up MFA
  -> connector executes (MCP tool, LLM, API)
  -> output controls
  -> audit row in PostgreSQL + structured security event + SSE to the Director
```

Each stage is a span that the Director's trace explorer renders: who initiated, which agent, why
(use case), what capability, what resource, which policy, what decision.

## Models

Source: `~/Desktop/model_choices.md`.

| Session            | Model                    | Effort | Why                                                     |
| ------------------ | ------------------------ | ------ | ------------------------------------------------------- |
| kierownik-session  | Claude Opus 5.5          | high   | orchestration, decisions, review                        |
| security-architect | Claude Opus 5.5          | high   | OWASP interpretation, threat model, policy design       |
| product-designer   | Claude Opus 5.5          | high   | visual direction, UX architecture, UI verification      |
| frontend-director  | Claude Opus 5.5          | high   | flagship visual surface; cross-reviewed by Codex        |
| backend-gateway    | Claude Opus 5.5 (from 19:15, D19)        | high   | Rust, PostgreSQL, API implementation                    |
| identity-infra     | Claude Opus 5.5 (from 19:15, D19)        | high   | Docker, Keycloak, scripts                               |
| frontend-ecosystem | Claude Opus 5.5 (from 19:15, D19)        | high   | frontend implementation                                 |
| security-tester    | Claude Opus 5.5 (from 19:15, D19)        | high   | automated tests, end-to-end verification                |

From 19:15 (D19) the four Codex roles run on Claude Opus 5.5 because the Codex workspace hit its usage limit; model_choices.md allows this when a family is unavailable.
Claude sessions think, specify and review rather than own long implementation loops. Never give
Claude and Codex the same implementation task; use the other model as reviewer. Claude sessions
convert `.webp` to `.png` before reading (`magick in.webp out.png`, in your scratch directory).

## Working rules

- An item counts only when a session other than its owner verifies it:
  `crabify todo review Fxx --to <verifier>`. security-tester verifies backend, identity and
  scenario items; product-designer verifies UI items against the Design Contract;
  kierownik-session verifies research and design items.
- Contract first. backend-gateway posts `contracts/openapi.yaml` v0 early; frontends build
  against mocks of it from the start and switch to the live Gateway when it is up.
- Frontend workers follow the Design Contract autonomously; consult product-designer only for a new
  visual pattern, a material navigation change, a major new page, a change to core interaction, or a
  break of a defined rule.
- A path eating disproportionate time: its owner says why, proposes a simplification and posts it to
  kierownik-session.
- Prefer mocks behind real interfaces, demo adapters, seed data, a simplified policy schema and one
  working integration over removing a central Betsee concept.
- Only kierownik-session asks the person anything.
- Keep `crabify report --status "..."` current.
