# Inventory Hub

Self-hostable systém pro trackování assetů — 1 Docker instance = 1 firma.

## Lokální vývoj

Předpoklady: Node.js 22+, npm 10+.

```bash
npm install
cp apps/server/.env.example apps/server/.env
# uprav SESSION_SECRET (min 16 znaků)

npm run db:generate          # vygeneruje migrace ze schématu
npm run db:migrate           # aplikuje migrace
npm run db:seed              # naseje demo data + dev admin

# v jednom terminálu
npm run dev:server
# v druhém
npm run dev:web
```

- Server: <http://localhost:3001>
- Web: <http://localhost:5173> (proxuje `/api`, `/health` a `/auth` na server)

### Přihlášení v dev módu

Bez nakonfigurovaného Google OAuth použij **dev login** na `/login` —
zadej e-mail existujícího uživatele (po seedu `admin@example.com`)
a backend ti vytvoří session. Endpoint `/auth/dev-login` je v produkci
zablokovaný (`NODE_ENV=production`).

### Google OAuth (produkce nebo dev s reálnými credentials)

1. V [Google Cloud Console](https://console.cloud.google.com/) vytvoř
   OAuth 2.0 Client ID typu „Web application".
2. Authorized redirect URI nastav na
   `https://<tvoje-doména>/auth/google/callback`
   (lokálně `http://localhost:3001/auth/google/callback`).
3. Do `apps/server/.env` doplň `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   a `GOOGLE_REDIRECT_URL`.
4. **První přihlášený uživatel** se automaticky stane adminem.
5. V adminu otevři **Nastavení → Povolené domény** a přidej e-mailové
   domény, jejichž uživatelé se mají přihlašovat automaticky bez pozvánky.
   Match je strict-exact: `acme.com` nepokrývá `eng.acme.com`.

## Docker (produkce / self-hosting)

```bash
SESSION_SECRET=$(openssl rand -hex 32) docker compose up -d --build
```

Data (SQLite + uploads) jsou v named volume `inventory_data`. Viz
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) pro instrukce ohledně záloh.

## Struktura

```
apps/
  server/         # Hono + Drizzle + SQLite + better-auth
  web/            # Vite + React + Tailwind + TanStack Query
packages/
  shared/         # Zod schémata a typy sdílené FE/BE
```

## Skripty (root)

| Skript                | Co dělá                                      |
|-----------------------|----------------------------------------------|
| `npm run dev`         | spustí dev server + web paralelně            |
| `npm run dev:server`  | jen backend                                  |
| `npm run dev:web`     | jen frontend                                 |
| `npm run build`       | build všech balíčků                          |
| `npm run typecheck`   | typecheck všech balíčků                      |
| `npm run test`        | testy všech balíčků                          |
| `npm run db:generate` | vygeneruje SQL migrace ze schématu Drizzle   |
| `npm run db:migrate`  | aplikuje migrace na DB                       |
| `npm run db:seed`     | naseje demo data (jen pro dev)               |
| `npm run test:e2e`    | Playwright E2E proti ephemeral serveru       |

## E2E testy

```bash
npx playwright install chromium    # jednorázově: stáhne browser
npm run test:e2e                   # spustí Playwright proti ephemeral
                                   # serveru (port 3101 + 5173)
```

E2E config v `playwright.config.ts` startuje vlastní backend (`tsx watch`
proti DB v `.e2e/app.db`) + Vite. Global setup po startu zavolá
`db:seed` proti té DB.

Tip: po pádu testu otevři `playwright-report/index.html` nebo
`npx playwright show-trace test-results/<failed-test>/trace.zip`.
