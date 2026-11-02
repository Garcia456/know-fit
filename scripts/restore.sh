#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# 恢复演练（不碰生产库）
#
# 用法：bash scripts/restore.sh backups/knowfit-xxxx.dump
#
# 会新建临时库 knowfit_restore_YYYYmmdd_HHMMSS，导入后打印行数；
# 确认无误后可手动删除，或留给作者检查。
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-deploy/.env.production}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f compose.prod.yml)
DUMP="${1:?用法: scripts/restore.sh backups/<dump>}"

if [ ! -f "$DUMP" ]; then
  echo "✗ 找不到 $DUMP" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ 缺少 $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

USER="${POSTGRES_USER:-knowfit}"
TARGET="knowfit_restore_$(date +%Y%m%d_%H%M%S)"

echo "== 建临时库 $TARGET =="
"${COMPOSE[@]}" exec -T db psql -U "$USER" -d postgres -c "CREATE DATABASE $TARGET"

echo "== 导入 =="
"${COMPOSE[@]}" exec -T db pg_restore \
  -U "$USER" -d "$TARGET" --no-owner --no-privileges < "$DUMP"

echo "== 校验行数 =="
"${COMPOSE[@]}" exec -T db psql -U "$USER" -d "$TARGET" -c "
SELECT 'knowledge_source' AS t, count(*) FROM knowledge_source
UNION ALL SELECT 'knowledge_chunk', count(*) FROM knowledge_chunk
UNION ALL SELECT 'user', count(*) FROM \"user\"
UNION ALL SELECT 'knowledge_access', count(*) FROM knowledge_access;
"

echo "✓ 恢复演练完成：$TARGET"
echo "  检查完可删：docker compose --env-file $ENV_FILE -f compose.prod.yml exec -T db psql -U $USER -d postgres -c 'DROP DATABASE $TARGET'"