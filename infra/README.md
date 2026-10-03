# Betsee demo infrastructure

From the repository root, run `docker compose up`. Compose 2.20 or newer and a Docker
daemon are required. The first start builds three Rust binaries and the two static web
applications. `docker compose up -d --build --wait` is useful when rebuilding after changes.

The measured `docker compose build --no-cache gateway` took 97 seconds on the demo host,
with Cargo dependency cache mounts retained. A first-ever build also downloads and compiles
those dependencies. `scripts/check-cold-start.py --project betsee-cold-check` verifies a
fresh isolated startup with no host ports, generated `.env`, imported identities, local
user links and both static hosts. It retains its stack for independent inspection; use a
new `betsee-cold-*` project name for each fresh-volume run.

The project is named `betsee`. Caddy publishes port 80; PostgreSQL 17 publishes only
`127.0.0.1:55432`. Gateway, MCP, the mock model, the demo runner and Keycloak have no
published host ports. Both frontend hosts proxy `/api/v1/demo/*` to the runner first and
other `/api/*` requests to the Gateway. SSE responses use immediate proxy flushing and
no compression. MCP is on an internal network with Gateway, the scenario runner and
PostgreSQL. The model, proxy and identity provider cannot reach it. `/mcp` requires
`MCP_GATEWAY_TOKEN`, supplied only to Gateway and MCP; descriptor drift/restore uses
the separate `MCP_ADMIN_TOKEN`. Neither MCP route is exposed by Caddy.

The root Compose file includes `infra/compose.yml`, using `.env.example` as interpolation
defaults. The root `.env` and shell variables override those defaults. A one-shot service
creates `.env` from the example only if it is missing. Each container receives an explicit
set of variables; the mock model receives no credentials. The imported realm uses
environment placeholders for client secrets, passwords and Daniel's TOTP seed.

The CSS-only `betsee` login theme inherits Keycloak's `keycloak.v2` templates. Startup
copies the canonical design tokens into its generated CSS resource before Keycloak starts;
the theme is then mounted read-only. Inter, Urbanist and the Streamline fingerprint are
bundled locally. No login template or authentication logic is replaced.

Keycloak's issuer is `http://auth.betsee.localhost/realms/betsee`. The Gateway fetches keys
from `http://keycloak:8080/realms/betsee/protocol/openid-connect/certs`, because the public
hostname resolves to loopback inside containers. The public auth host blocks the admin
console/API and the master realm. Bootstrap talks directly to the internal admin API.

## Demo identities

| Username | Name         | Roles                      | Team           | Stable Keycloak sub                  |
| -------- | ------------ | -------------------------- | -------------- | ------------------------------------ |
| maya     | Maya Chen    | employee, demo-initiator   | finance        | 00000000-0000-4000-8000-000000000001 |
| daniel   | Daniel Ortiz | security-officer, approver | security       | 00000000-0000-4000-8000-000000000002 |
| priya    | Priya Raman  | org-admin, demo-initiator  | administration | 00000000-0000-4000-8000-000000000003 |

Passwords are the `DEMO_PASSWORD_*` entries in `.env`. Each agent has a confidential
client with client credentials, a five-minute token, `agent_id` and `azp` matching its
client ID, and the `betsee-gateway` audience. Browser clients are public and require
S256 PKCE. The built-in `basic` client scope supplies `sub` and `auth_time`.

The confidential `betsee-demo-runner` client has a demo-only password grant. Its direct
grant flow rejects users without `demo-initiator`, so Daniel cannot use it. D7a permits
its human tokens only for session creation, scenario endpoints and authorized reads;
the Gateway rejects approvals and admin writes from that client. Production humans
create sessions through the browser; the password grant is deprecated in OAuth 2.1.

The confidential `employee-assistant` client is the agent behind the employee chat. Its secret is
`AGENT_CLIENT_SECRET_EMPLOYEE_ASSISTANT`, defaulting in Compose to a demo value; agent-host on the
host holds it, never the Claude Code process. Keycloak imports the realm only once, so a stack
created before this client existed gets it from `python3 scripts/keycloak-sync-clients.py
employee-assistant` (kcadm inside the keycloak container; existing clients are left alone).
Caddy forwards `/api/v1/chat/*` on `betsee.localhost` to agent-host at
`host.docker.internal:8095` (`extra_hosts: host-gateway`); `/api/v1/chat/inputs` stays on the
Gateway.

## User bootstrap

The one-shot `bootstrap` service waits for Keycloak and Gateway health, then seeds the
three local users. The Gateway owns migrations. Bootstrap reads the Keycloak user ID
back and stores it as `users.sub`, with the initial role/team and organization `acme`.
Retries preserve the identity link and existing entitlements, clearance and active state.
A failed database link keeps the Keycloak user so the operation can be retried.

`scripts/bootstrap` reruns the seed. To create a user, provide the initial password in
`BETSEE_USER_PASSWORD` and run:

```sh
scripts/bootstrap-user.sh --username new-user --display-name "New User" \
  --role employee --team support
```

Pass that variable to the one-shot service with `docker compose run --rm --no-deps
-e BETSEE_USER_PASSWORD bootstrap ...` if it is set only in your shell.

## Payment step-up

The browser flow maps ACR `1` to a password and ACR `2` to password plus OTP. Level 2
has a zero maximum age, requiring a fresh OTP for each requested step-up. Daniel's
pre-provisioned credential uses explicit `BASE32` secret encoding, SHA-1, six digits,
and a 30-second period. `scripts/otp.sh` prints its current code. Keycloak prevents
reusing the same code within a period.

The UI requests `acr_values=2`, `prompt=login` and `max_age=0` for the payment approval.
The Gateway must verify the access-token signature, issuer, audience, expiry, ACR,
`auth_time` freshness, approver role and the separate initiating human. The approval
binds the exact payment parameters before execution. A UI claim alone grants nothing.

`python3 scripts/oidc-login.py --username daniel --acr 2` exercises real Keycloak
authorization-code PKCE and OTP forms with a cookie jar. Add `--token` for a test caller.
The helper decodes claims for diagnostics; the Gateway performs signature verification.

## Scope and updates

Before presenting, run `scripts/stage-check.sh`. It prints one result per check and ends
with `GO` (exit 0) or `NO-GO` (exit 1). It checks services, frontend hosts, OIDC, Daniel's
password-only sign-in, the six scenarios, agent states, pending approvals and the live
payments descriptor. It uses read-only PostgreSQL queries and confirms that operational
data and audit/security row counts stay unchanged. It neither consumes an OTP nor resets
the demo. Run it alone after the final fresh start; another session changing state during
the check correctly yields `NO-GO`.

The preflight skips an unauthenticated API request because the Gateway would record a
token-rejection event. It uses Daniel's authenticated `/api/v1/me` and internal Gateway
health instead, and reads the MCP descriptor directly without the Gateway's stateful
descriptor observer. Password sign-in creates an ordinary Keycloak browser session.

Keycloak imports a realm only if it is absent. Editing the JSON or `.env` does not rotate
credentials in an existing realm. Use the admin API for deliberate updates, or verify
imports in an isolated test stack with a fresh database. Do not remove the shared demo's
volumes as a routine reload.

Plain HTTP, fixed demo identities, disabled brute-force lockout and the labelled mock
model are deliberate demo settings. The fixture clients issue wrong-audience and
one-second tokens for the security suite and are not registered Betsee agents.
