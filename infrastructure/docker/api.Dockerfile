# syntax=docker/dockerfile:1.7
# Samadhaan API (NestJS) — production image (Prompt 30).
#
#   docker build -f infrastructure/docker/api.Dockerfile -t samadhaan/api .            # runtime
#   docker build -f infrastructure/docker/api.Dockerfile --target migrate -t samadhaan/api-migrate .
#
# Build context: the repository root (npm workspaces). Targets:
#   runtime  (default) — compiled API, production dependencies only, non-root.
#   migrate            — Prisma CLI + psql, runs `prisma migrate deploy` and
#                        post-migrate.sql as a one-off release job. The runtime
#                        image never changes the schema on start.

ARG NODE_VERSION=22

# ---------------------------------------------------------------- dependencies
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# Lockfile-exact install of the API and the shared package only.
RUN npm ci --workspace @samadhaan/api --workspace @samadhaan/shared --no-audit --no-fund

# ---------------------------------------------------------------- build
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
# Prisma's config requires a URL to generate the client; nothing connects here.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/unused npm run db:generate --workspace @samadhaan/api \
 && npm run build --workspace @samadhaan/shared \
 && npm run build --workspace @samadhaan/api

# ---------------------------------------------------------------- migrate (release job)
FROM build AS migrate
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client \
 && rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /repo/apps/api
# DATABASE_URL comes from the job's environment (never baked in).
CMD ["sh", "-c", "npx prisma migrate deploy && bash scripts/post-migrate.sh"]

# ---------------------------------------------------------------- production deps
FROM build AS prod-deps
RUN npm prune --omit=dev --workspace @samadhaan/api --workspace @samadhaan/shared

# ---------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000
WORKDIR /app
COPY --from=prod-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
# Local-storage deployments mount a volume here (STORAGE_LOCAL_ROOT).
RUN mkdir -p /app/apps/api/.storage && chown node:node /app/apps/api/.storage
USER node
WORKDIR /app/apps/api
EXPOSE 4000
# Liveness only: readiness (GET /api/v1/health) is for the load balancer.
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# SIGTERM: Nest shutdown hooks close Prisma and Redis before exit.
STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]
