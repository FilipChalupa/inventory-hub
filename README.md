# Inventory Hub

Self-hostable asset-tracking system — 1 Docker instance = 1 company.

## Local development

Requirements: Node.js 22+, npm 10+.

```bash
npm install
# .env is not needed for dev (every variable has a default).
# For Google OAuth, copy the template: cp apps/server/.env.example apps/server/.env

npm run db:seed              # seeds demo data + a dev admin (admin@example.com)

# in one terminal
npm run dev:server           # auto-migration runs on startup
# in another
npm run dev:web
```

- Server: <http://localhost:3001>
- Web: <http://localhost:5173> (proxies `/api`, `/health` and `/auth` to the server)

Migrations are applied automatically when the server starts. When you change
the schema, run `npm run db:generate` to create a new migration (Drizzle
writes the SQL file into `apps/server/src/db/migrations/`).

### Dev-mode login

Without Google OAuth configured, use the **dev login** at `/login` — enter the
email of an existing user (after seeding, `admin@example.com`) and the backend
creates a session for you. The `/auth/dev-login` endpoint is disabled in
production (`NODE_ENV=production`).

### Google OAuth (production, or dev with real credentials)

1. In the [Google Cloud Console](https://console.cloud.google.com/), create an
   OAuth 2.0 Client ID of type "Web application".
2. Set the authorized redirect URI to
   `https://<your-domain>/auth/google/callback`
   (locally `http://localhost:3001/auth/google/callback`).
3. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URL`
   to `apps/server/.env`.
4. The **first user to log in** automatically becomes an admin.
5. In the admin UI open **Settings → Allowed domains** and add the email
   domains whose users should be able to log in automatically without an
   invitation. Matching is strict-exact: `acme.com` does not cover
   `eng.acme.com`.

### Remote MCP server

The server can expose its data to AI assistants (Claude Desktop/Code, claude.ai
connectors) over the [Model Context Protocol](https://modelcontextprotocol.io)
at `/mcp`, secured with OAuth 2.1 per the MCP authorization spec. It acts as both
the authorization server and the resource server, reusing the existing Google
login to authenticate the human.

1. Configure Google OAuth (above) and set `MCP_BASE_URL` to your public
   `https://<domain>/mcp` (defaults to `PUBLIC_APP_URL` + `/mcp`).
2. Add the connector in your MCP client, e.g.
   `claude mcp add --transport http inventory-hub https://<domain>/mcp`.
3. On first use the client opens the browser through `/authorize`; after Google
   login you pick **read-write** (inherits your role) or **read-only**, and the
   client receives audience-bound access + refresh tokens.

Tools mirror the REST API (assets, loans, contacts, damages, locations, asset
types, and admin-gated org/users/invitations). Role checks are enforced exactly
as in the web app; read-only connections are blocked from write tools.

## Docker (production / self-hosting)

```bash
docker compose up -d --build
```

It runs without a single required variable. For production set at least
`PUBLIC_APP_URL` to your public domain — the full list of variables is in
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md#environment-variables).

A single Docker image serves both the frontend and the API from the same port
(3001) — **no reverse proxy is required** to run. For HTTPS/a custom domain,
put the usual Caddy/Traefik in front (see
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)).

Data (SQLite + uploads) lives in the named volume `inventory_data`. Migrations
run automatically on startup; the backup workflow is in
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Structure

```
apps/
  server/         # Hono + Drizzle + SQLite + custom session auth
  web/            # Vite + React + Tailwind + TanStack Query
packages/
  shared/         # Zod schemas and types shared between FE/BE
```

## Scripts (root)

| Script                | What it does                                                              |
| --------------------- | ------------------------------------------------------------------------- |
| `npm run dev`         | runs the dev server + web in parallel                                     |
| `npm run dev:server`  | backend only                                                              |
| `npm run dev:web`     | frontend only                                                             |
| `npm run build`       | builds all packages                                                       |
| `npm run lint`        | ESLint across the repo                                                    |
| `npm run format`      | formats the repo with Prettier (`format:check` to verify)                 |
| `npm run typecheck`   | type-checks all packages                                                  |
| `npm run test`        | tests for all packages                                                    |
| `npm run db:generate` | generates SQL migrations from the Drizzle schema                          |
| `npm run db:migrate`  | applies migrations manually (the server does it automatically on startup) |
| `npm run db:seed`     | seeds demo data (dev only)                                                |
| `npm run test:e2e`    | Playwright E2E against an ephemeral server                                |

## E2E tests

```bash
npx playwright install chromium    # one-time: downloads the browser
npm run test:e2e                   # runs Playwright against an ephemeral
                                   # server (port 3101 + 5173)
```

The E2E config in `playwright.config.ts` starts its own backend (`tsx watch`
against a DB at `apps/server/.e2e/app.db`) + Vite. After startup the global
setup calls `db:seed:e2e` (deterministic UUIDs + idempotent locations) against
that DB.

Tip: after a test failure open `playwright-report/index.html` or
`npx playwright show-trace test-results/<failed-test>/trace.zip`.
