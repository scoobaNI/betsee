# Betsee web

Run commands from this directory. The npm workspaces share one lockfile.

```bash
npm ci
npm run dev:ecosystem
npm run dev:director
```

The ecosystem runs on port 5173 and the Director on 5174. Both use the shared
`@betsee/ui` components and `@betsee/api` client. Compose serves production builds
at `http://betsee.localhost` and `http://director.betsee.localhost` and proxies
relative `/api/` requests to the Gateway.

Live mode is the default. Keycloak uses authorization code with PKCE; human API
requests and the fetch-based SSE reader send bearer tokens. The ecosystem uses
the `betsee-ecosystem` client. Approval step-up requests `acr_values=2`, requires
fresh authentication, and returns to the exact approval for explicit human
review and submission. The Gateway verifies the signed token and action binding.

For offline development:

```bash
VITE_BETSEE_MOCK=1 npm run dev:ecosystem
VITE_BETSEE_MOCK=1 npm run dev:director
```

Mock data and the demo analyzer are labelled. Mock mode cannot verify MFA.
Each tab has its own mock world; cross-host approval updates require the live
Gateway.

The binding design sources are in `../docs/design/`. Shared CSS imports the
generated tokens directly. Fonts and the approved Streamline Flex line icon
subset are bundled; the Icon wrapper uses Iconify's offline entry point.
Streamline icons are attributed under CC BY 4.0 in the app footer.

```bash
npm run build
npm run typecheck
npm test
npm run test:ecosystem
npm run check:tokens
npm run check:icons
npm run check:policies
npm run format:check
```

Browser tests cover the ecosystem at 1440 and 1920 pixels. They check navigation,
capability intersection, control attachments, provider labels, exact-action
approvals, offline assets and Gateway failure recovery. Real Keycloak OTP is
verified separately against the live stack and must be coordinated on the team
board because Daniel's TOTP codes cannot be reused in one 30-second window.
