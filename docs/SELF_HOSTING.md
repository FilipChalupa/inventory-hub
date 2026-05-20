# Self-hosting & zálohy

Inventory Hub běží jako jeden Docker kontejner s perzistentním volumem
`/data`, který obsahuje:

```
/data/app.db          # SQLite databáze (WAL mode)
/data/app.db-wal      # WAL log (běžně se objevuje)
/data/app.db-shm      # shared memory file
/data/uploads/        # fotky poškození a další přílohy
```

**Ztráta `/data` = ztráta všeho.** Zálohujte ho.

## Reverse proxy

Doporučeno za reverse proxy s TLS (Caddy / Traefik / nginx). Příklad Caddy:

```caddy
inventory.example.com {
  reverse_proxy localhost:3001
}
```

## Zálohy

SQLite je jediný soubor, takže zálohovat lze snadno. **Backup UI v appce
neexistuje** — pro stažení potřebujete přístup k serveru.

### Varianta A: cron + sqlite3 .backup (jednoduché)

`sqlite3 .backup` je bezpečné i za běhu, používá online backup API.

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

# uploads (rsync nebo tar)
docker run --rm \
  -v inventory_data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  busybox tar czf "/backup/uploads-$TS.tar.gz" -C /data uploads

# off-site (S3, rsync, …)
aws s3 sync "$BACKUP_DIR" s3://my-backups/inventory-hub/ --delete

# rotace: smaž starší než 30 dní
find "$BACKUP_DIR" -mtime +30 -delete
```

> Pozn.: `sqlite3` CLI ve výchozím `node:bookworm-slim` image není. Pro tuto
> variantu buď doinstalujte `sqlite3` do image, nebo použijte variantu B.

### Varianta B: Litestream (continuous replication, doporučené pro produkci)

Litestream replikuje SQLite změny do S3-compatible storage v reálném čase.
Recovery point ≈ pár sekund.

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

Uploads (binární fotky) Litestream neřeší — pro ně varianta A nebo
`rclone`/`restic` na adresář `/data/uploads`.

## Obnova

1. Zastavte kontejner: `docker compose down`.
2. Obnovte soubory do volumu:
   ```bash
   docker run --rm \
     -v inventory_data:/data \
     -v "$PWD":/restore \
     busybox sh -c "cp /restore/app.db /data/app.db && \
                    tar xzf /restore/uploads.tar.gz -C /data"
   ```
3. Litestream restore (pokud z S3):
   ```bash
   docker run --rm \
     -v inventory_data:/data \
     -e LITESTREAM_ACCESS_KEY_ID -e LITESTREAM_SECRET_ACCESS_KEY \
     litestream/litestream:latest \
     restore -config /etc/litestream.yml /data/app.db
   ```
4. Start: `docker compose up -d`.

## Migrace databáze

Migrace se aplikují **manuálně** přes:

```bash
docker exec inventory-hub node apps/server/dist/db/migrate.js
```

Nebo přidat do startupu (TODO: zvážit auto-migrate při bootu). Před každou
migrací **udělej zálohu**.

## Co monitorovat

- Volné místo na disku, kde je volume `inventory_data`.
- Velikost `/data/app.db` (růst).
- Pokud Litestream: že proces běží a poslední replikace není stará.
- HTTP healthcheck: `GET /health` → `{"status":"ok"}`.
