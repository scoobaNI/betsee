# Production and commercial deployment

Status: plan. Betsee v0 runs as a demo stack (see [`running.md`](running.md)). This document says
what a full production deployment inside a company takes, what in the code has to change first, and
how to roll it out.

## Can a company run it?

Yes, as a pilot followed by production, after a bounded amount of engineering. The parts that make a
control plane trustworthy are already real, not mocked:

- identity: Keycloak with OIDC, PKCE for humans, client credentials per agent, step-up with OTP;
- decisions: Cedar policies validated in strict mode at startup, deny on any evaluation error;
- the Gateway pipeline: fifteen stages, each a span, every request audited in PostgreSQL;
- approvals bound to the hash of the exact stored request, with four-eyes and step-up;
- content, file and runtime controls (CTL-IN-001, CTL-FILE-001, CTL-RT-001) on real HTTP traffic;
- Betsee Desk governing real Claude Code and Codex through a PreToolUse hook that denies when the
  Gateway is unreachable.

What is not production-ready is the shape of the data and the deployment around it: one hard-coded
organization, demo identities, demo agents compiled into an allowlist, plain HTTP, Keycloak in dev
mode, a mock model. Section 2 lists each one with its location.

## 1. Target architecture

```text
 employees (browser, Betsee Desk)        agents (workloads, OAuth client credentials)
          |                                         |
          v                                         v
   +---------------- TLS ingress / reverse proxy (company domain) --------------+
   |  betsee.<corp>   director.betsee.<corp>   api.betsee.<corp>   auth.<corp>  |
   +------|-------------------|------------------------|-------------|---------+
          v                   v                        v             v
   static web apps     Betsee Gateway (N replicas)          Keycloak (production mode,
   (Ecosystem,         - Cedar policies from a              clustered) brokering to the
    Director)            reviewed policy repository         company IdP (Entra ID, Okta,
                       - connectors to real systems         Google, AD/LDAP)
                         over MCP or HTTP allowlist
                              |            |
                              v            v
                     PostgreSQL (managed,    company model gateway
                     HA, backups, PITR)      (Azure OpenAI, Bedrock, vLLM,
                              |               any OpenAI-compatible endpoint)
                              v
                     SIEM / log archive (audit export, write-once)
```

## 2. Code changes required before production

Each item is a defect against production use, not against the demo. File references are to the
current tree.

| Area               | Today                                                                                                                                                                                                             | Required                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Organization model | organization id `acme` is a literal in SQL inserts (`gateway/crates/server/src/store.rs:65`, `:156`, `:195`, `:234`, `:236`)                                                                                      | organization from configuration (single tenant) or from the token (multi-tenant), on every row                            |
| Seed data          | agents, use cases, teams and humans are loaded from the test fixture `policies/tests/acme-cases.json`; any human other than maya, daniel, priya aborts startup (`store.rs:22-71`)                                 | a real catalog source: an admin API or a reviewed data file per deployment; humans provisioned from the IdP               |
| Agent registry     | the agent allowlist is compiled in (`gateway/crates/server/src/auth.rs:40-49`)                                                                                                                                    | agents registered as data; a new agent must not need a release                                                            |
| Admin API          | agents, use cases and policies are read-only over the API; control attachments cannot be detached                                                                                                                 | create, update, retire for agents, use cases, delegations, attachments; all writes audited and four-eyes                  |
| Hostnames          | `*.betsee.localhost` is a literal in the frontends (`web/apps/director/src/components/ui.tsx:14`, `web/packages/chat/src/thread.tsx:8`, `web/apps/ecosystem/src/layout.tsx:103`, `web/apps/desk/src/app.tsx:495`) | every cross-link from build-time configuration, as `VITE_OIDC_AUTHORITY` already is                                       |
| Model              | `mock-llm`; Compose passes only `OPENAI_BASE_URL` to the Gateway, not `OPENAI_MODEL` or `OPENAI_API_KEY` (`infra/compose.yml:130`, read in `betsee-gateway.rs:34,61-62`)                                          | the company model endpoint, with model and key from a secret store                                                        |
| Connectors         | `betsee-mcp` serves demo tools (CRM, payments, files) against demo tables                                                                                                                                         | real connectors to company systems, each with pinned descriptors and its own credentials                                  |
| Desk agent secret  | the `employee-assistant` client secret ships with the desktop app (`desk/src-tauri/src/main.rs:211-214`)                                                                                                          | agent tokens minted server-side per signed-in person (RFC 8693 token exchange), no secret on laptops                      |
| Audit integrity    | append-only by trigger, but the Gateway's role owns the audit tables                                                                                                                                              | insert-only database role for the Gateway, hash-chained or signed rows, continuous export to an external write-once store |
| Demo-only parts    | `demo-runner`, `/api/v1/demo/*` route in Caddy, `betsee-demo-runner` password grant, fixture clients, Daniel's pre-provisioned TOTP                                                                               | removed from the production deployment, not just unused                                                                   |

## 3. Infrastructure and configuration

### Network and TLS

- Real DNS names under a company domain; TLS on every host. In the Caddyfile remove
  `auto_https off` and use real site addresses, or terminate TLS at the company load balancer.
- Keycloak: `sslRequired` to `external` or `all` in the realm, `KC_HOSTNAME` set to the public auth
  URL over HTTPS.
- Only the ingress is public. Gateway, PostgreSQL, Keycloak admin and MCP stay on private networks,
  as they already do in Compose; keep the auth host's block on `/admin` and the master realm.

### Keycloak

- Run `start` (production mode), not `start-dev` (`infra/compose.yml`), with a clustered cache and
  its own database.
- Identity brokering to the company IdP (Entra ID, Okta, Google Workspace, LDAP/AD). Roles
  `employee`, `approver`, `security-officer`, `org-admin` mapped from IdP groups.
- MFA enforced by the company IdP or by Keycloak; real OTP or WebAuthn enrolment per approver.
- Brute-force protection on (`bruteForceProtected` is `false` in the demo realm).
- One confidential client per agent, secrets generated per deployment and rotated.
- Remove `betsee-demo-runner`, `fixture-wrong-audience`, `fixture-expired` and the demo users.

### PostgreSQL

- Managed or HA PostgreSQL 17, encrypted at rest, daily backups with point-in-time recovery.
- Separate roles: migrations owner, Gateway runtime (insert-only on audit tables), read-only
  reporting.
- Retention policy for traces and audit rows agreed with compliance before go-live.

### Secrets

- Nothing from `.env.example` survives into production. Every secret (client secrets, database
  passwords, `MCP_GATEWAY_TOKEN`, `MCP_ADMIN_TOKEN`, model keys) generated per environment and
  injected from a secret manager (Vault, AWS Secrets Manager, Azure Key Vault, Kubernetes
  secrets with encryption at rest).

### Runtime platform

- Kubernetes or another orchestrator instead of a single Compose host. The Gateway image already
  runs as a non-root user (`infra/gateway.Dockerfile`).
- At least two Gateway replicas behind the ingress; readiness on `/healthz`.
- Images built in CI, signed, scanned, pinned by digest.

### Observability

- OpenTelemetry export of the span and audit model (documented as a path, not built).
- Audit and security events streamed to the company SIEM.
- Alerts: Gateway unavailable (the Desk and agents fail closed, so this is an outage), breaker
  openings, quarantines, approval queue age, policy load failures.

## 4. Policies and controls

- Policies live in a dedicated repository with review and CI: the Cedar checker
  (`policies/tests/cedar-check`) runs on every change, against the company's own reference cases
  replacing `acme-cases.json`.
- Roll a new control out in monitor mode before enforcing (monitor mode is a documented path, not
  built).
- `policies/controls.yaml` maps each control to OWASP risks; keep that mapping current, auditors
  will read it.

## 5. Betsee Desk in a company

- Distribute signed builds (`cd desk && npm run build` produces .deb, .rpm, AppImage) through the
  company's software catalogue; Windows and macOS builds need their own signing.
- Point it at production with `BETSEE_GATEWAY_URL` and `BETSEE_ISSUER`; never ship
  `AGENT_CLIENT_SECRET` once token exchange exists.
- Runtime licensing: each person uses Claude Code or Codex under the company's own agreement with
  Anthropic or OpenAI (enterprise sign-in or company API keys). Betsee governs those runtimes; it
  does not resell them.
- Seed a real workspace instead of `demo/workspace`, and catalogue its files with real tiers.

## 6. Rollout

| Phase          | Scope                                                                          | Exit criterion                                                                        |
| -------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 0. Engineering | the changes in section 2                                                       | the security suite (`tests/run-security.sh`) passes against a stack with no demo data |
| 1. Staging     | sections 3 and 4 on company infrastructure, synthetic users                    | penetration test and threat-model review done, findings closed                        |
| 2. Pilot       | one team, Betsee Desk plus one or two real agents, approvals by real approvers | two weeks without a fail-open, every denied action explainable from its trace         |
| 3. Production  | more teams and agents, SLOs and on-call agreed                                 | audit export reconciled with the SIEM, backup restore rehearsed                       |

## 7. Commercial deployment

Betsee can be offered commercially as a self-hosted control plane deployed per customer, with the
customer's IdP, model gateway and systems behind it. What that requires beyond section 2:

- **Packaging**: a Helm chart or an equivalent installer, versioned releases, migration upgrades
  tested from every supported version.
- **Tenancy**: decide single-tenant per customer (simplest, matches self-hosting) or multi-tenant
  SaaS (needs the organization from the token on every query, and isolation tests).
- **Licences of components**, all compatible with commercial use: Cedar (Apache 2.0), Keycloak
  (Apache 2.0), Caddy (Apache 2.0), PostgreSQL (PostgreSQL licence), Streamline icons (CC BY 4.0,
  attribution kept in the app footer), bundled fonts under their own licences shipped beside them.
  Run a full dependency licence scan (`cargo deny`, `npm` licence check) before the first contract.
- **Claims**: sell what the code enforces. The README's "Demo-only shortcuts" and the "Not claimed"
  list in [`security/owasp-mapping.md`](security/owasp-mapping.md) are the honest boundary; a
  contract must not promise more.
- **Compliance evidence**: the controls catalog, the OWASP mapping and the trace for every decision
  are the material customers' auditors ask for (ISO 27001, SOC 2, EU AI Act logging duties).
- **Support**: security advisories, patch SLA, and a documented procedure for a Gateway outage,
  since every governed agent fails closed.
