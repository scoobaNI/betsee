# Running Betsee

Two ways to run it, on the same stack:

- **Demo**: the Compose stack plus the scripted scenarios. Five demo agents act against the mock
  model; you watch them in the Director.
- **Real setup**: the same stack plus Betsee Desk, where a person chats with real Claude Code or
  Codex and every message, tool call and file goes through the Gateway as the agent
  `employee-assistant`.

Both need the Compose stack first.

## 1. Start the stack

Prerequisites: Docker with Compose 2.20 or newer, host port 80 free, a browser that resolves
`*.localhost` to loopback (Chrome, Firefox and Edge do).

```sh
docker compose up -d --build --wait
```

The first build compiles the Rust Gateway and takes several minutes. `--build` matters after any
source change: the Director and the ecosystem are served as static builds from the images, so an
image built before your change shows the old UI.

| Open                             | What                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| http://betsee.localhost          | Ecosystem home: Approvals, Policy Studio, Identity, Connect |
| http://director.betsee.localhost | Director: the live control room                             |
| http://auth.betsee.localhost     | Keycloak sign-in and step-up                                |
| http://api.betsee.localhost      | Gateway API                                                 |

Sign-in users (passwords are the `DEMO_PASSWORD_*` entries in `.env`):

| User     | Use it for                                                     |
| -------- | -------------------------------------------------------------- |
| `daniel` | Director, Approvals, step-up (`scripts/otp.sh` prints his OTP) |
| `maya`   | the employee signing in to Betsee Desk                         |
| `priya`  | org admin: policies, identity                                  |

Checks:

```sh
docker compose ps                 # every service healthy, bootstrap exited 0
./scripts/stage-check.sh          # read-only preflight, ends with GO or NO-GO
```

A volume created before the Desk existed lacks its Keycloak clients, because Keycloak imports the
realm only once. Add them without touching anything else:

```sh
python3 scripts/keycloak-sync-clients.py employee-assistant betsee-desk
```

## 2. Demo: scripted scenarios

1. Open http://director.betsee.localhost and sign in as `daniel`.
2. Press `Ctrl+K` (or `Cmd+K`, or click the sidebar search field). The command palette lists
   `Act N: <title>` for each scenario; pick one to run it through the real Gateway.
3. Watch the steps arrive in **Activity** (`/activity`); click a row for its trace.
4. Act 5 waits for an approval: approve it at http://betsee.localhost (Approvals) as `daniel`, with
   the one-time code from `scripts/otp.sh`.
5. Between rehearsals, `Ctrl+K` then **Reset scenario**: ends demo sessions, releases agents,
   restores the payments tool pin. Audit rows and traces stay.

The narrated seven-act flow is in [`demo-script.md`](demo-script.md).

Terminal fallback, one act at a time, non-zero exit on any unexpected decision:

```sh
docker compose exec demo-runner python -m runner list
docker compose exec demo-runner python -m runner run act2-deterministic-boundaries
```

The language model in the demo is `mock-llm`, labelled "mock model (demo)" in the UI.

## 3. Real setup: Betsee Desk with Claude Code or Codex

Betsee Desk (`desk/`, Tauri 2, window UI in `web/apps/desk`) embeds the governing service
(agent-host) on `127.0.0.1:8097`. It is the PreToolUse hook of the runtime it starts, so the
runtime cannot act without a Gateway decision.

Prerequisites on the host, besides the running stack:

- Node.js and npm, a Rust toolchain, and Tauri 2's Linux build dependencies (WebKitGTK 4.1 and
  friends, see the Tauri prerequisites page);
- the runtime itself on `PATH`: `claude` signed in with `claude auth login` (or an Anthropic API
  key entered in the Desk), or `codex` signed in (or an OpenAI API key).

Run it:

```sh
cd desk
npm install
npm run dev                      # development window, Vite on :1430
```

or build the app:

```sh
cd desk
npm run build                    # .deb, .rpm, AppImage under desk/src-tauri/target/release/bundle
npx tauri build --no-bundle      # just the binary: desk/src-tauri/target/release/betsee-desk
```

In the window:

1. **Sign in**: opens the system browser on Keycloak (`betsee-desk` client, PKCE). Sign in as
   `maya`.
2. **Runtime**: choose Claude Code or Codex and how it authenticates.
3. Chat. The workspace is `~/.local/share/betsee-desk/workspace`, seeded from `demo/workspace`.

What the Gateway decides:

- every message first passes the content filter (CTL-IN-001): card numbers, IBANs, PESEL, API and
  private keys, names of resources above the session tier;
- every tool call the runtime attempts goes to `POST /api/v1/actions` (CTL-RT-001): catalogued file
  reads by tier, read-only shell templates, writes only after an approver says yes in Approvals, no
  network egress, deny when the Gateway is unreachable;
- uploads and downloads go through `POST /api/v1/files/intake` and `/release` (CTL-FILE-001).

A write the assistant asks for waits up to 150 seconds for `daniel` to approve it at
http://betsee.localhost (Approvals).

Environment overrides read by the Desk at start:

| Variable              | Default                                      |
| --------------------- | -------------------------------------------- |
| `BETSEE_GATEWAY_URL`  | `http://api.betsee.localhost`                |
| `BETSEE_ISSUER`       | `http://auth.betsee.localhost/realms/betsee` |
| `AGENT_CLIENT_SECRET` | the demo secret of `employee-assistant`      |
| `CLAUDE_MODEL`        | the Claude Code default                      |

The agent's client secret sitting in a desktop app is a demo shortcut; a deployment mints agent
tokens server-side.

Headless, for tests or a browser instead of the window:

```sh
desk/src-tauri/target/release/betsee-desk --serve-only
# prints BETSEE_DESK api=http://127.0.0.1:8097 token=...
# then, with `cd web && npm run dev -w @betsee/desk` running,
# open http://localhost:1430/?api=<api>&token=<token>
```

End-to-end test: `node tests/desk/e2e.mjs --live-gateway-stop` (needs the built Desk, `cd web && npm run dev -w @betsee/desk`
and a signed-in `claude`).

## 4. Watching Desk chats in the Director

Everything the Desk sends is ordinary Gateway traffic, so the Director shows it live with no extra
setup. Keep http://director.betsee.localhost open, signed in as `daniel`, while someone chats.

| Where                      | What you see                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------ |
| **Activity** (`/activity`) | one row per decision: each message (`input.submit`), tool call and file transfer     |
| a row -> **Trace**         | the decision sentence, the pipeline spans, controls and policies that decided it     |
| **Agents** (`/agents`)     | `employee-assistant` with the open chats per person; a chat disappears when it ends  |
| **Access** (`/access`)     | per person: chat requests, flagged requests and above-tier requests in the last hour |

The Director must be the Compose-served one at `director.betsee.localhost`. `npm run dev:director`
on port 5174 cannot sign in (the `betsee-director` client allows only the
`director.betsee.localhost` redirect), and with `VITE_BETSEE_MOCK=1` it shows the mock world, not
your chats.

## Stop and reset

```sh
docker compose stop              # stop, keep data
docker compose down              # remove containers, keep volumes
docker compose down -v           # also delete the database and Keycloak state: full re-seed on next up
```

`down -v` throws away every trace and approval; use **Reset scenario** for rehearsals instead.
