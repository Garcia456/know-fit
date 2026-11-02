# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
# 生产镜像（三个 target：api / migrate 复用 api / web）
# 构建上下文 = 仓库根目录；本地与 CI 用同一条 build 路径。
# ─────────────────────────────────────────────────────────────

FROM node:22.23.2-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# 先只拷清单，依赖层可缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY . .
RUN pnpm --filter @know-fit/api build \
 && pnpm --filter @know-fit/web build \
 && pnpm --filter @know-fit/api deploy --prod /prod/api

# ── API 运行镜像（migrate 也用它：node dist/db/migrate.js）
FROM node:22.23.2-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/api ./
EXPOSE 3000
CMD ["node", "dist/server.js"]

# ── 静态前端
FROM nginx:1.29-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80