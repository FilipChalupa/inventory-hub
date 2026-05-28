# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /repo
ENV NODE_ENV=production

# ---- deps stage: install all workspace deps (incl. dev) for build ----
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm install --workspaces --include-workspace-root --include=dev

# ---- build stage ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN npm run build --workspace @inventory-hub/shared \
    && npm run build --workspace @inventory-hub/server \
    && npm run build --workspace @inventory-hub/web

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    DATABASE_URL=file:/data/app.db \
    UPLOAD_DIR=/data/uploads

# Install only production deps for the server
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm install --workspace @inventory-hub/server --omit=dev --include-workspace-root \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /root/.npm /tmp/*

# Copy compiled artefacts
COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/server/src/db/migrations apps/server/src/db/migrations
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/web/dist apps/web/dist

# Data volume for SQLite + uploads
VOLUME ["/data"]
RUN mkdir -p /data/uploads

EXPOSE 3001

# Health probe — fails the container if /health stops responding so
# docker-compose / orchestrator can restart it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3001) + '/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "--conditions=production", "apps/server/dist/index.js"]
