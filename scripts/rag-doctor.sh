#!/usr/bin/env bash
# 知识检索体检 —— 本地用 .env，服务器用生产 compose 的 api 环境。
# 用法：bash scripts/rag-doctor.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f deploy/.env.production ]; then
  exec docker compose --env-file deploy/.env.production -f compose.prod.yml \
    --profile tools run --rm rag-doctor
fi

exec node --env-file-if-exists=.env scripts/rag-doctor.mjs