# Self-hosting & backups

Inventory Hub runs as a **single Docker container** with a persistent `/data`
volume. No external database, no required secret.

## Contents

- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Reverse proxy and HTTPS](#reverse-proxy-and-https)
- [What the /data volume contains](#what-the-data-volume-contains)
- [Backups](#backups)
- [Restore](#restore)
- [Database migrations](#database-migrations)
- [What to monitor](#what-to-monitor)

## Quick start

```bash
docker compose up -d --build
```

It starts without a single required variable. For production behind a domain,
set `PUBLIC_APP_URL` (see below).

**Platforms that build from a Dockerfile (Coolify, Dokku, Railway, …):** set
env variables in that platform's UI (not via `docker-compose`). The image
already bakes in `NODE_ENV=production`, `PORT=3001` and the `/data` paths, so
typically you only need to add `PUBLIC_APP_URL`.

## Environment variables

**No variable is required to start** the process — the image ships sensible
defaults. In production behind your own domain you must set `PUBLIC_APP_URL`,
otherwise the app rejects requests (see `*`).

| Variable                                                        | Required            | Default                   | Purpose                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_APP_URL`                                                | in production yes\* | `http://localhost:5173`   | Public URL of the app. Used for CORS, the CSRF Origin check, OAuth redirect and QR codes. Set it to `https://your-domain`.                                                            |
| `NODE_ENV`                                                      | no                  | `production` (in image)   | `production` disables the dev login at `/login`. Already set in the Docker image.                                                                                                     |
| `PORT`                                                          | no                  | `3001`                    | HTTP server port (frontend + API).                                                                                                                                                    |
| `DATABASE_URL`                                                  | no                  | `file:/data/app.db`       | Path to the SQLite file. Keep it on the `/data` volume.                                                                                                                               |
| `UPLOAD_DIR`                                                    | no                  | `/data/uploads`           | Directory for uploaded photos/attachments. Keep it on `/data`.                                                                                                                        |
| `UPLOAD_MAX_BYTES`                                              | no                  | `5242880` (5 MB)          | Max size of a single upload.                                                                                                                                                          |
| `CURRENCY`                                                      | no                  | `CZK`                     | ISO 4217 currency code for asset purchase prices and the dashboard's inventory value.                                                                                                 |
| `GOOGLE_CLIENT_ID`                                              | no                  | –                         | Google OAuth login. Without it only the dev login works (disabled in production).                                                                                                     |
| `GOOGLE_CLIENT_SECRET`                                          | no                  | –                         | Google OAuth secret.                                                                                                                                                                  |
| `GOOGLE_REDIRECT_URL`                                           | no                  | –                         | `https://your-domain/auth/google/callback`.                                                                                                                                           |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | no                  | –                         | Sending email (invitations, notifications). Without them, emails are just logged to the console.                                                                                      |
| `MCP_BASE_URL`                                                  | no                  | `PUBLIC_APP_URL` + `/mcp` | Canonical URL of the remote MCP server (the `/mcp` endpoint). Access tokens are audience-bound to it. Must be HTTPS in production. Requires Google OAuth.                             |
| `MCP_ACCESS_TOKEN_TTL`                                          | no                  | `3600`                    | MCP access-token lifetime in seconds.                                                                                                                                                 |
| `MCP_REFRESH_TOKEN_TTL`                                         | no                  | `2592000`                 | MCP refresh-token lifetime in seconds (rotated on use).                                                                                                                               |
| `BACKUPS_CONFIGURED`                                            | no                  | `false`                   | Set to `1`/`true` once you've wired up backups. The app can't detect backups itself; while unset, admins see a "backups not configured" warning in Settings. See [Backups](#backups). |

\* `PUBLIC_APP_URL` is technically not needed to start the process, but without
the correct value the app won't work behind your own domain — login and all
POST/PUT/DELETE requests fail the CSRF/CORS Origin check (the default points at
`localhost:5173`).

Step-by-step Google OAuth setup is in the
[README](../README.md#google-oauth-production-or-dev-with-real-credentials).

## Reverse proxy and HTTPS

The frontend and API run on the same port (3001) — a reverse proxy is **not
required to run**, but it is useful for TLS termination, HTTPS-only cookies and
a custom domain (Caddy / Traefik / nginx). Caddy example:

```caddy
inventory.example.com {
  reverse_proxy localhost:3001
}
```

Then don't forget to set `PUBLIC_APP_URL=https://inventory.example.com` so the
CSRF (Origin check) and the Google OAuth redirect use the correct domain.

## What the /data volume contains

```
/data/app.db          # SQLite database (WAL mode)
/data/app.db-wal      # WAL log (appears during normal operation)
/data/app.db-shm      # shared memory file
/data/uploads/        # damage photos and other attachments
```

**Losing `/data` = losing everything.** Back it up.

## Backups

**Losing `/data/app.db` is the single biggest risk — it means losing
everything.** SQLite is a single file, so backups are easy, but **there is no
backup UI in the app** and the app can't tell whether backups are running. Once
you've set backups up, set `BACKUPS_CONFIGURED=1` so admins stop seeing the
"backups not configured" warning in **Settings**.

### Option A: Litestream (recommended, turn-key)

Litestream replicates every SQLite change to S3-compatible storage in near real
time (recovery point ≈ a few seconds). The repo ships a ready-to-use override —
`docker-compose.litestream.yml` plus `litestream.yml` — so you don't have to
write any config.

**1. Set the S3 env** (in `.env` next to `docker-compose.yml`, or your
platform's env UI):

```dotenv
LITESTREAM_S3_BUCKET=my-backups
LITESTREAM_S3_PATH=inventory-hub
LITESTREAM_S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com
LITESTREAM_S3_REGION=auto
LITESTREAM_ACCESS_KEY_ID=...
LITESTREAM_SECRET_ACCESS_KEY=...
```

Works with AWS S3, MinIO, Cloudflare R2, Backblaze B2 — any S3-compatible
endpoint.

**2. Start the stack with both compose files:**

```bash
docker compose -f docker-compose.yml -f docker-compose.litestream.yml up -d
```

The override adds a `litestream/litestream` sidecar that mounts the same
`inventory_data` volume and replicates `/data/app.db`. It also sets
`BACKUPS_CONFIGURED=1` on the app, so the admin warning disappears automatically.

> Litestream replicates only the database, **not** `/data/uploads` (damage
> photos & attachments). Back those up separately — see Option B.

### Option B: cron + tar/rsync (uploads, or DB without Litestream)

You still need to back up `/data/uploads`. This also works as a standalone DB
backup if you don't want Litestream.

```bash
# /etc/cron.d/inventory-hub-backup
0 */6 * * * root /usr/local/bin/inventory-hub-backup.sh
```

`/usr/local/bin/inventory-hub-backup.sh`:

```bash
#!/bin/sh
set -e
TS=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR=/var/backups/inventory-hub
mkdir -p "$BACKUP_DIR"

# Database + uploads in one shot, straight off the volume.
docker run --rm \
  -v inventory_data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  busybox tar czf "/backup/data-$TS.tar.gz" -C /data app.db uploads

# off-site (S3, rsync, …)
aws s3 sync "$BACKUP_DIR" s3://my-backups/inventory-hub/ --delete

# rotation: delete anything older than 30 days
find "$BACKUP_DIR" -mtime +30 -delete
```

> **Note:** the `sqlite3` CLI is **not** in the runtime image
> (`node:bookworm-slim`), so `sqlite3 .backup` isn't available inside the
> container. The `tar` snapshot above is safe as long as the DB is in WAL mode
> (it is) and you accept a snapshot-consistent copy; for a stronger guarantee,
> stop the container first or use Litestream (Option A).

If you set `BACKUPS_CONFIGURED=1` for this option, add it to the app service
env (it's already wired as a passthrough in `docker-compose.yml`):

```dotenv
BACKUPS_CONFIGURED=1
```

## Restore

### From Litestream (Option A)

Restore the latest DB snapshot from S3 into the volume before starting the app.
Point the same S3 env at the sidecar and let it pull `/data/app.db`:

1. Stop the container: `docker compose down`.
2. Restore the database from S3 (uses the shipped `litestream.yml`):
   ```bash
   docker run --rm \
     -v inventory_data:/data \
     -v "$PWD/litestream.yml":/etc/litestream.yml:ro \
     -e LITESTREAM_S3_BUCKET -e LITESTREAM_S3_PATH \
     -e LITESTREAM_S3_ENDPOINT -e LITESTREAM_S3_REGION \
     -e LITESTREAM_ACCESS_KEY_ID -e LITESTREAM_SECRET_ACCESS_KEY \
     litestream/litestream:latest \
     restore -config /etc/litestream.yml /data/app.db
   ```
3. Restore uploads from your separate backup (see Option B), e.g.:
   ```bash
   docker run --rm \
     -v inventory_data:/data \
     -v "$PWD":/restore \
     busybox tar xzf /restore/data-<TS>.tar.gz -C /data uploads
   ```
4. Start: `docker compose -f docker-compose.yml -f docker-compose.litestream.yml up -d`.

### From a tar snapshot (Option B)

1. Stop the container: `docker compose down`.
2. Restore DB + uploads into the volume:
   ```bash
   docker run --rm \
     -v inventory_data:/data \
     -v "$PWD":/restore \
     busybox tar xzf /restore/data-<TS>.tar.gz -C /data
   ```
3. Start: `docker compose up -d`.

## Database migrations

Migrations are applied **automatically when the server starts** (`migrate()`
called in `index.ts` before the server starts accepting requests). If a
migration fails, the container exits with code 1 and docker-compose restarts
it — so **always take a backup before deploying a new version**, to avoid
getting a corrupt DB stuck in a restart loop.

You can run them manually with
`docker exec inventory-hub node apps/server/dist/db/migrate.js`, but that's
usually not necessary.

## What to monitor

- Free disk space where the `inventory_data` volume lives.
- Size of `/data/app.db` (growth).
- With Litestream: that the process is running and the last replication isn't
  stale.
- HTTP healthcheck: `GET /health` → `{"status":"ok"}`. The image already has a
  built-in `HEALTHCHECK` (every 30 s), so you'll see the status in
  `docker ps`.
