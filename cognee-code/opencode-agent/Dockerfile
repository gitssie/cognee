FROM oven/bun:1.2-alpine AS deps

WORKDIR /app

COPY package.json bun.lock ./
COPY src/opencode-router/shims ./src/opencode-router/shims
RUN bun install --production

FROM oven/bun:1.2-alpine AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY src/ ./src/
RUN bun install && bun run build

FROM ghcr.io/anomalyco/opencode:latest

COPY --from=oven/bun:1.2-alpine /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

RUN apk add --no-cache tzdata

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY src/opencode-router/workspace-template ./dist/src/opencode-router/workspace-template

COPY package.json bunfig.toml tsconfig.json opencode-router.json docker-entrypoint.sh ./
RUN chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    OPENCODE_HOST=0.0.0.0 \
    OPENCODE_PORT=4096 \
    OPENCODE_ROUTER_HEALTH_PORT=3005

EXPOSE 4096 3005

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["bun", "run", "dist/src/index.js"]
