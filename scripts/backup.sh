#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# 数据库备份
#
# 用法：bash scripts/backup.sh [--weekly]
#   --weekly → 额外留一份 weekly 备份（需手动拷回本机）
#
# 产出：backups/knowfit-YYYYmmdd-HHMMSS.dump（pg_dump -Fc）
# 保留：日备份 7 天；weekly-* 不自动删。
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-deploy/.env.production}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f compose.prod.yml)
DB_IMAGE="pgvector/pgvector:0.8.7-pg18-bookworm"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ 缺少 $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="backups/.knowfit-$STAMP.dump.tmp"
OUT="backups/knowfit-$STAMP.dump"

echo "== 备份 ${POSTGRES_DB:-knowfit} =="
"${COMPOSE[@]}" exec -T db pg_dump \
  -U "${POSTGRES_USER:-knowfit}" \
  -d "${POSTGRES_DB:-knowfit}" \
  -Fc > "$TMP"

# 可读性校验：能 list 才说明 dump 完整
if ! docker run --rm -i "$DB_IMAGE" pg_restore --list < "$TMP" > /dev/null; then
  rm -f "$TMP"
  echo "✗ dump 校验失败" >&2
  exit 1
fi

mv "$TMP" "$OUT"
echo "✓ $OUT ($(du -h "$OUT" | cut -f1))"

if [ "${1:-}" = "--weekly" ]; then
  cp "$OUT" "backups/knowfit-weekly-$STAMP.dump"
  echo "✓ weekly 备份已保留，请拷回本机"
fi

# 日备份保留 7 天；weekly 只留最近 4 份
find backups -maxdepth 1 -name 'knowfit-*.dump' ! -name 'knowfit-weekly-*' -mtime +7 -print -delete
ls -1t backups/knowfit-weekly-*.dump 2>/dev/null | tail -n +5 | xargs -r rm -f || true