#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# 生产部署 / 升级 / 回滚
#
# 用法（在服务器仓库根目录）：
#   bash scripts/deploy.sh sha-xxxxxxxxxxxx
#
# 步骤：拉镜像 → 跑迁移 → 起服务 → 等 /ready → 记录 tag
# 探活失败 → 自动切回上一版 tag（迁移不回滚，见文档）。
#
# 本机演练：SKIP_PULL=1 bash scripts/deploy.sh local
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-deploy/.env.production}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f compose.prod.yml)
TAG="${1:?用法: scripts/deploy.sh <image-tag>}"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ 缺少 $ENV_FILE（从 deploy/.env.production.example 复制并填写）" >&2
  exit 1
fi

PREV="$(cat .deployed-tag 2>/dev/null || true)"
export IMAGE_TAG="$TAG"

echo "== 部署 $TAG（上一版：${PREV:-无}）=="

if [ "${SKIP_PULL:-}" != "1" ]; then
  "${COMPOSE[@]}" pull api web
fi

echo "== 迁移 =="
"${COMPOSE[@]}" run --rm migrate

echo "== 起服务 =="
UP_OK=1
"${COMPOSE[@]}" up -d --remove-orphans || UP_OK=0

READY=0
if [ "$UP_OK" = "1" ]; then
  echo "== 等 /ready =="
  for _ in $(seq 1 60); do
    if "${COMPOSE[@]}" exec -T api node -e \
      "fetch('http://127.0.0.1:3000/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
      >/dev/null 2>&1; then
      READY=1
      break
    fi
    sleep 2
  done
fi

if [ "$READY" = "1" ]; then
  echo "$TAG" > .deployed-tag
  echo "✓ 部署完成：$TAG"
  exit 0
fi

echo "✗ 服务未就绪，部署失败" >&2
"${COMPOSE[@]}" logs --tail=50 api >&2 || true
if [ -n "$PREV" ]; then
  echo "== 回滚到 $PREV ==" >&2
  export IMAGE_TAG="$PREV"
  "${COMPOSE[@]}" up -d --remove-orphans
  echo "已切回 $PREV；请检查日志。" >&2
else
  echo "没有上一版可回滚。" >&2
fi
exit 1