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
npm run db:seed              # naseje demo data

# v jednom terminálu
npm run dev:server
# v druhém
npm run dev:web
```

- Server: <http://localhost:3001>
- Web: <http://localhost:5173> (proxuje `/api` a `/health` na server)

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
