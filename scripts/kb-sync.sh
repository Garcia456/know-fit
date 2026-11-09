#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# 知识库增量同步 —— 把本地采好、索引好的某位博主，搬到另一套库（通常是上线库）
#
# 只搬两张表的两类行：`knowledge_source` 里该 creator 的源、
# 以及挂在这些源下的 `knowledge_chunk`。不碰 user / workout / assessment。
#
# 为什么必须按 creator 过滤、而不是整表搬：
#   `kb:index` 是「删旧片、插新片」，重跑过的源在本地拿到新 uuid，
#   而上线库里的旧行还是**老的 uuid**。整表搬过去，主键不同 →
#   每个来源会多出一整套重复片，且唯一索引（source_id, content_hash）拦不住。
#
# 用法（本地导出，先 pnpm db:up）：
#   pnpm kb:sync --creator 阿奇力量塑形终点站
#   pnpm kb:sync --creator 阿奇力量塑形终点站 --dry-run    # 只报数，不写文件
#
# 用法（上线库导入，在服务器仓库根目录）：
#   bash scripts/kb-sync.sh --apply tmp/kb-sync.sql
#
# 退出码：0 = 成功；1 = 失败
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 🔴 目标库由模式决定，不做「有生产 env 就用生产」的自动判断 ——
#    本机也可能留着 deploy/.env.production（本地演练用），那样导出会读错库。
#    导出永远读**本地开发库**（docker-compose.yml）；导入才走生产 compose。
MODE_APPLY=0
if [ "${1:-}" = "--apply" ]; then MODE_APPLY=1; fi

if [ "$MODE_APPLY" = "1" ] && [ -f deploy/.env.production ]; then
  COMPOSE=(docker compose --env-file deploy/.env.production -f compose.prod.yml)
  # 用户名 / 库名在 env 文件里
  set -a
  # shellcheck disable=SC1090
  . deploy/.env.production
  set +a
else
  COMPOSE=(docker compose -f docker-compose.yml)
fi
DB_USER="${POSTGRES_USER:-knowfit}"
DB_NAME="${POSTGRES_DB:-knowfit}"

# 列顺序取自 drizzle 里 CREATE TABLE 的声明顺序。
# 🔴 用显式列名而不是 `SELECT *`：COPY 的文本格式按**位置**对列，
#    将来某次迁移插了新列，位置就会错位 —— 而错位不报错，只会把向量写进别的列。
SOURCE_COLUMNS="id, creator, platform, video_id, title, original_url, duration_sec, published_at, compliance_status, platform_video_key, subtitle_source, fetched_at, robots_checked_at, robots_allowed, is_indexable, topic_domain, transcript_segments, content_hash, created_at"
CHUNK_COLUMNS="id, source_id, chunk_index, segment_key, text, context_prefix, start_ts, end_ts, topic_tags, exercise_tags, claim_type, is_citable, asr_confidence, content_hash, embedding_model, embedding"

psql_db() {
  "${COMPOSE[@]}" exec -T db psql -X -q -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" "$@"
}
psql_db_file() { # 从 stdin 读 SQL（不加 -q：NOTICE 里的「新插入 N 条」要看得见）
  "${COMPOSE[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -f -
}

arg_value() { # $1 = 参数名 → 取后面的值
  local name="$1" i j
  i=2
  while [ "$i" -le "$#" ]; do
    j=$((i + 1))
    if [ "${!i}" = "$name" ]; then
      printf '%s' "${!j:-}"
      return 0
    fi
    i=$((i + 1))
  done
  printf '%s' ''
}

lit() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }

# ─────────────────────────────────────────────────────────────────────
# 导入模式：--apply <file>
# ─────────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--apply" ]; then
  FILE="${2:-}"
  if [ -z "$FILE" ]; then
    echo "✗ 用法：bash scripts/kb-sync.sh --apply <file.sql>" >&2
    exit 1
  fi
  if [ ! -f "$FILE" ]; then
    echo "✗ 找不到 $FILE" >&2
    exit 1
  fi

  echo "== 导入 $FILE =="
  # 整份 SQL 自带 BEGIN / COMMIT：中途失败会整体回滚，不会留下半套数据
  psql_db_file < "$FILE"
  echo
  echo "✓ 导入完成。上面的 NOTICE「本次新插入」在重复执行时应为 0。"
  echo
  echo "-- 导入后体检（与导出时的报数比一比）--"
  psql_db -c "
    SELECT s.creator, count(DISTINCT s.id) AS sources, count(c.id) AS chunks,
           count(c.id) FILTER (WHERE c.is_citable) AS citable,
           min(c.embedding_model) AS model
      FROM knowledge_source s LEFT JOIN knowledge_chunk c ON c.source_id = s.id
     GROUP BY s.creator ORDER BY 2 DESC"
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────
# 导出模式：--creator <名字>
# ─────────────────────────────────────────────────────────────────────
CREATOR="$(arg_value --creator "$@")"
if [ -z "$CREATOR" ]; then CREATOR="${KB_SYNC_CREATOR:-}"; fi
CREATOR="$(printf '%s' "$CREATOR" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

OUT="$(arg_value --out "$@")"
if [ -z "$OUT" ]; then OUT="tmp/kb-sync.sql"; fi
DRY_RUN=0
for a in "$@"; do if [ "$a" = "--dry-run" ]; then DRY_RUN=1; fi; done

if [ -z "$CREATOR" ]; then
  cat >&2 <<'EOF'
✗ 缺 --creator <博主名>（按 knowledge_source.creator 全等匹配，与白名单里写的一致）

  本地导出：pnpm kb:sync --creator 阿奇力量塑形终点站
  上线导入：bash scripts/kb-sync.sh --apply tmp/kb-sync.sql
EOF
  exit 1
fi

WHERE="WHERE s.creator = $(lit "$CREATOR")"

echo "=== know-fit 知识库增量同步 ==="
echo
echo "博主：$CREATOR"

EXISTS="$(psql_db -At -c "SELECT count(*) FROM knowledge_source s $WHERE")"
if [ "$EXISTS" = "0" ]; then
  echo "✗ 本地库里没有 creator =「$CREATOR」的源。" >&2
  echo "  先 pnpm kb:ingest（KB_CREATOR=… 只跑这一位），再 pnpm kb:index。" >&2
  exit 1
fi

echo
echo "-- 源 --"
psql_db -c "
  SELECT s.platform_video_key,
         left(s.title, 32) AS title,
         CASE WHEN s.is_indexable THEN '可索引' ELSE '不可索引' END,
         CASE WHEN s.compliance_status = 'ok' THEN 'ok' ELSE s.compliance_status END,
         CASE WHEN s.transcript_segments IS NULL THEN '无转写' ELSE '' END
    FROM knowledge_source s $WHERE
   ORDER BY s.platform_video_key"

echo "-- 片 --"
psql_db -c "
  SELECT count(*)::int AS chunks,
         count(*) FILTER (WHERE c.is_citable)::int AS citable,
         count(DISTINCT c.embedding_model)::int AS models,
         min(c.embedding_model) AS model
    FROM knowledge_chunk c JOIN knowledge_source s ON s.id = c.source_id $WHERE"

CHUNKS="$(psql_db -At -c "SELECT count(*) FROM knowledge_chunk c JOIN knowledge_source s ON s.id = c.source_id $WHERE")"
MODELS="$(psql_db -At -c "SELECT count(DISTINCT c.embedding_model) FROM knowledge_chunk c JOIN knowledge_source s ON s.id = c.source_id $WHERE")"
MODEL="$(psql_db -At -c "SELECT min(c.embedding_model) FROM knowledge_chunk c JOIN knowledge_source s ON s.id = c.source_id $WHERE")"

if [ "$CHUNKS" = "0" ]; then
  echo "✗ 这些源一条片都没有 —— 索引还没跑。先 pnpm kb:index。" >&2
  exit 1
fi
if [ "$MODELS" != "1" ]; then
  echo "✗ 这些片混用了多个 embedding 模型（$MODELS 个）—— 先统一重索引再同步。" >&2
  exit 1
fi

LOCAL_MODEL="$(sed -n 's/^OPENAI_EMBEDDING_MODEL=//p' .env 2>/dev/null | head -1 | tr -d '\r')"
if [ -n "$LOCAL_MODEL" ] && [ "$MODEL" != "$LOCAL_MODEL" ]; then
  echo
  echo "⚠️ 片的 embedding_model 是「$MODEL」，本地 .env 配的是「$LOCAL_MODEL」。"
  echo "   上线库的 OPENAI_EMBEDDING_MODEL 必须也是「$MODEL」，否则查询向量对不上，必然 0 召回。"
fi

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "--dry-run：不写文件。去掉 --dry-run 再跑一次。"
  exit 0
fi

mkdir -p "$(dirname "$OUT")"
SRC_TMP="$(mktemp)"
CHUNK_TMP="$(mktemp)"
trap 'rm -f "$SRC_TMP" "$CHUNK_TMP"' EXIT

psql_db -c "COPY (SELECT $SOURCE_COLUMNS FROM knowledge_source s $WHERE) TO STDOUT" > "$SRC_TMP"
psql_db -c "COPY (SELECT c.$(printf '%s' "$CHUNK_COLUMNS" | sed 's/, /, c./g')
                    FROM knowledge_chunk c
                    JOIN knowledge_source s ON s.id = c.source_id $WHERE) TO STDOUT" > "$CHUNK_TMP"

SRC_LINES="$(wc -l < "$SRC_TMP" | tr -d ' ')"
CHUNK_LINES="$(wc -l < "$CHUNK_TMP" | tr -d ' ')"
if [ "$SRC_LINES" != "$EXISTS" ]; then
  echo "✗ COPY 取出 $SRC_LINES 行源，但查到 $EXISTS 条 —— 中止（数据不一致）。" >&2
  exit 1
fi
if [ "$CHUNK_LINES" != "$CHUNKS" ]; then
  echo "✗ COPY 取出 $CHUNK_LINES 行片，但查到 $CHUNKS 条 —— 中止（数据不一致）。" >&2
  exit 1
fi

{
  echo "-- 由 scripts/kb-sync.sh 生成；只含一位博主：$CREATOR"
  echo "-- 生成时间：$(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "-- 用法：bash scripts/kb-sync.sh --apply <本文件>（在服务器仓库根目录）"
  echo
  echo "\\set ON_ERROR_STOP on"
  echo "BEGIN;"
  echo
  echo "CREATE TEMP TABLE s_stage (LIKE knowledge_source) ON COMMIT DROP;"
  echo "COPY s_stage ($SOURCE_COLUMNS) FROM STDIN;"
  cat "$SRC_TMP"
  echo '\.'
  echo "-- 源：platform_video_key 唯一，重复导入只刷新字段（与 kb:ingest 的 upsert 同一口径）"
  echo "INSERT INTO knowledge_source ($SOURCE_COLUMNS) SELECT $SOURCE_COLUMNS FROM s_stage"
  echo "  ON CONFLICT (platform_video_key) DO UPDATE SET"
  echo "    creator = EXCLUDED.creator,"
  echo "    platform = EXCLUDED.platform,"
  echo "    video_id = EXCLUDED.video_id,"
  echo "    title = EXCLUDED.title,"
  echo "    original_url = EXCLUDED.original_url,"
  echo "    duration_sec = EXCLUDED.duration_sec,"
  echo "    published_at = EXCLUDED.published_at,"
  echo "    compliance_status = EXCLUDED.compliance_status,"
  echo "    subtitle_source = EXCLUDED.subtitle_source,"
  echo "    fetched_at = EXCLUDED.fetched_at,"
  echo "    robots_checked_at = EXCLUDED.robots_checked_at,"
  echo "    robots_allowed = EXCLUDED.robots_allowed,"
  echo "    is_indexable = EXCLUDED.is_indexable,"
  echo "    topic_domain = EXCLUDED.topic_domain,"
  echo "    transcript_segments = EXCLUDED.transcript_segments,"
  echo "    content_hash = EXCLUDED.content_hash;"
  echo
  echo "CREATE TEMP TABLE c_stage (LIKE knowledge_chunk) ON COMMIT DROP;"
  echo "COPY c_stage ($CHUNK_COLUMNS) FROM STDIN;"
  cat "$CHUNK_TMP"
  echo '\.'
  echo "-- 片：报告「本来就有多少 / 新插入多少」—— 重复跑应当是 0 新插入"
  echo "DO \$\$"
  echo "DECLARE before_n int; inserted_n int;"
  echo "BEGIN"
  echo "  SELECT count(*) INTO before_n FROM knowledge_chunk"
  echo "    WHERE source_id IN (SELECT id FROM s_stage)"
  echo "      AND content_hash IN (SELECT content_hash FROM c_stage);"
  echo "  INSERT INTO knowledge_chunk ($CHUNK_COLUMNS) SELECT $CHUNK_COLUMNS FROM c_stage"
  echo "  ON CONFLICT (source_id, content_hash) DO NOTHING;"
  echo "  GET DIAGNOSTICS inserted_n = ROW_COUNT;"
  echo "  RAISE NOTICE '片：导入前已有 % 条，本次新插入 % 条', before_n, inserted_n;"
  echo "END \$\$;"
  echo
  echo "COMMIT;"
  echo
  echo "-- 导入后的对照（应与本地输出一致）"
  echo "SELECT s.creator, count(DISTINCT s.id) AS sources, count(c.id) AS chunks,"
  echo "       count(c.id) FILTER (WHERE c.is_citable) AS citable"
  echo "  FROM knowledge_source s LEFT JOIN knowledge_chunk c ON c.source_id = s.id"
  echo " $WHERE"
  echo " GROUP BY s.creator;"
} > "$OUT"

echo
echo "✓ 已写出 $OUT（源 $SRC_LINES 行 / 片 $CHUNK_LINES 行，$(du -h "$OUT" | cut -f1)）"
echo "  下一步：把这个文件拷到服务器仓库根目录下的同一路径，然后"
echo "    bash scripts/kb-sync.sh --apply $OUT"
echo
echo "⚠️ 导入不会动授权表：新来源若属于受限平台，账号仍需要 knowledge_access 里对应的行。"
