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

| Variable                                                        | Required            | Default                   | Purpose                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_APP_URL`                                                | in production yes\* | `http://localhost:5173`   | Public URL of the app. Used for CORS, the CSRF Origin check, OAuth redirect and QR codes. Set it to `https://your-domain`.                                |
| `NODE_ENV`                                                      | no                  | `production` (in image)   | `production` disables the dev login at `/login`. Already set in the Docker image.                                                                         |
| `PORT`                                                          | no                  | `3001`                    | HTTP server port (frontend + API).                                                                                                                        |
| `DATABASE_URL`                                                  | no                  | `file:/data/app.db`       | Path to the SQLite file. Keep it on the `/data` volume.                                                                                                   |
| `UPLOAD_DIR`                                                    | no                  | `/data/uploads`           | Directory for uploaded photos/attachments. Keep it on `/data`.                                                                                            |
| `UPLOAD_MAX_BYTES`                                              | no                  | `5242880` (5 MB)          | Max size of a single upload.                                                                                                                              |
| `GOOGLE_CLIENT_ID`                                              | no                  | –                         | Google OAuth login. Without it only the dev login works (disabled in production).                                                                         |
| `GOOGLE_CLIENT_SECRET`                                          | no                  | –                         | Google OAuth secret.                                                                                                                                      |
| `GOOGLE_REDIRECT_URL`                                           | no                  | –                         | `https://your-domain/auth/google/callback`.                                                                                                               |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | no                  | –                         | Sending email (invitations, notifications). Without them, emails are just logged to the console.                                                          |
| `MCP_BASE_URL`                                                  | no                  | `PUBLIC_APP_URL` + `/mcp` | Canonical URL of the remote MCP server (the `/mcp` endpoint). Access tokens are audience-bound to it. Must be HTTPS in production. Requires Google OAuth. |
| `MCP_ACCESS_TOKEN_TTL`                                          | no                  | `3600`                    | MCP access-token lifetime in seconds.                                                                                                                     |
| `MCP_REFRESH_TOKEN_TTL`                                         | no                  | `2592000`                 | MCP refresh-token lifetime in seconds (rotated on use).                                                                                                   |

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

SQLite is a single file, so backups are easy. **There is no backup UI in the
app** — you need server access to grab the files.

### Option A: cron + sqlite3 .backup (simple)

`sqlite3 .backup` is safe even while running; it uses the online backup API.

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

docker exec inventory-hub sqlite3 /data/app.db ".backup /data/backup-$TS.db"
docker cp inventory-hub:/data/backup-$TS.db "$BACKUP_DIR/"
docker exec inventory-hub rm /data/backup-$TS.db

# uploads (rsync or tar)
docker run --rm \
  -v inventory_data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  busybox tar czf "/backup/uploads-$TS.tar.gz" -C /data uploads

# off-site (S3, rsync, …)
aws s3 sync "$BACKUP_DIR" s3://my-backups/inventory-hub/ --delete

# rotation: delete anything older than 30 days
find "$BACKUP_DIR" -mtime +30 -delete
```

> Note: the `sqlite3` CLI is not in the default `node:bookworm-slim` image. For
> this option either install `sqlite3` into the image, or use option B.

### Option B: Litestream (continuous replication, recommended for production)

Litestream replicates SQLite changes to S3-compatible storage in real time.
Recovery point ≈ a few seconds.

`docker-compose.override.yml`:

```yaml
services:
  app:
    depends_on:
      - litestream

  litestream:
    image: litestream/litestream:latest
    container_name: inventory-hub-litestream
    restart: unless-stopped
    command: replicate -config /etc/litestream.yml
    environment:
      LITESTREAM_ACCESS_KEY_ID: ${S3_ACCESS_KEY}
      LITESTREAM_SECRET_ACCESS_KEY: ${S3_SECRET_KEY}
    volumes:
      - inventory_data:/data
      - ./litestream.yml:/etc/litestream.yml:ro
```

`litestream.yml`:

```yaml
dbs:
  - path: /data/app.db
    replicas:
      - type: s3
        bucket: my-backups
        path: inventory-hub
        endpoint: https://s3.example.com
        region: auto
```

Litestream does not handle uploads (binary photos) — for those use option A or
`rclone`/`restic` on the `/data/uploads` directory.

## Restore

1. Stop the container: `docker compose down`.
2. Restore the files into the volume:
   ```bash
   docker run --rm \
     -v inventory_data:/data \
     -v "$PWD":/restore \
     busybox sh -c "cp /restore/app.db /data/app.db && \
                    tar xzf /restore/uploads.tar.gz -C /data"
   ```
3. Litestream restore (if from S3):
   ```bash
   docker run --rm \
     -v inventory_data:/data \
     -e LITESTREAM_ACCESS_KEY_ID -e LITESTREAM_SECRET_ACCESS_KEY \
     litestream/litestream:latest \
     restore -config /etc/litestream.yml /data/app.db
   ```
4. Start: `docker compose up -d`.

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
