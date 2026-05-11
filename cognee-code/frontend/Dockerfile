# =============================================================================
# Frontend Dockerfile — Quasar SPA build → nginx serve
#
# 构建期 env:
#   VITE_API_URL      = 空 → 走同源 /api/* (nginx 反向代理到 server)
#   VITE_OPENCODE_URL = /opencode → nginx 反向代理到 opencode-agent:4096
# =============================================================================

FROM node:22-alpine AS build

WORKDIR /app

# 先复制全量 (quasar prepare 需要 quasar.config.ts 等文件)
COPY . .

RUN corepack enable && yarn install

RUN yarn build

# ── serve ─────────────────────────────────────────────────────────────────
FROM nginx:alpine

# 删除默认首页，复制 SPA 静态产物
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist/spa /usr/share/nginx/html

# nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
