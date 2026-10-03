FROM node:22-alpine AS web
WORKDIR /build/web
COPY web/ ./
COPY docs/design/ /build/docs/design/
RUN --mount=type=cache,id=betsee-npm,target=/root/.npm npm ci && npm run build

FROM caddy:2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /build/web/apps/ecosystem/dist/ /srv/ecosystem/
COPY --from=web /build/web/apps/director/dist/ /srv/director/
