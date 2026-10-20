# syntax=docker/dockerfile:1.7
# Samadhaan web (Next.js) — production image (Prompt 30).
#
#   docker build -f infrastructure/docker/web.Dockerfile \
#     --build-arg API_INTERNAL_URL=http://api:4000 -t samadhaan/web .
#
# Next.js evaluates rewrites and the Content-Security-Policy at build time, so
# the API's internal URL and every NEXT_PUBLIC_* value are BUILD arguments:
# build one image per environment. Leave NEXT_PUBLIC_API_URL empty in
# production — the browser then calls /api on the same origin (cookies stay
# first-party) and the server proxies to API_INTERNAL_URL. Never pass a
# secret as a build argument: NEXT_PUBLIC_* values are visible to everyone.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace @samadhaan/web --workspace @samadhaan/shared --no-audit --no-fund

FROM deps AS build
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_API_URL=
ARG NEXT_PUBLIC_APP_NAME=Samadhaan
ARG NEXT_PUBLIC_MAP_STYLE_URL=
ARG NEXT_PUBLIC_MAP_PROVIDER=
ARG NEXT_PUBLIC_MAP_DEFAULT_VIEW=
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT_STANDALONE=true \
    API_INTERNAL_URL=${API_INTERNAL_URL} \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME} \
    NEXT_PUBLIC_MAP_STYLE_URL=${NEXT_PUBLIC_MAP_STYLE_URL} \
    NEXT_PUBLIC_MAP_PROVIDER=${NEXT_PUBLIC_MAP_PROVIDER} \
    NEXT_PUBLIC_MAP_DEFAULT_VIEW=${NEXT_PUBLIC_MAP_DEFAULT_VIEW}
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build --workspace @samadhaan/shared \
 && npm run build --workspace @samadhaan/web

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3100
WORKDIR /app
# The standalone server and only the files it traced, plus static assets.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "apps/web/server.js"]
