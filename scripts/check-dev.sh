#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# know-fit 执行闸门
#
# 它验的是「它真的跑得起来吗」—— 在代码坏掉时**必须非零退出**。
# 它与环境自检（应当永远 exit 0）契约相反，故两者不可合并。
#
# 三层闸门各答一问，不可互相替代：
#   环境自检              → 环境齐不齐（应当永远 exit 0）
#   文档闸门              → 定义写全没（只存在于带文档的私有仓）
#   check-dev.sh（本文件）→ 它真的跑得起来吗   ← 完成证据的落点
#
# CI 跑的就是本文件（见 .github/workflows/ci.yml），不另写一套命令。
#
# 用法：   bash scripts/check-dev.sh
# 退出码： 0 = 全过 ； 非 0 = 有失败
#
# ⚠️ 它会起容器（pnpm db:up）与 dev server（pnpm dev）—— 需 Docker Desktop 已启动。
#    设 SKIP_DB_UP=1 可跳过 db:up（CI 里库由 services: 容器提供）。
# ─────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WEB_URL="http://localhost:5173/"
HEALTH_URL="http://localhost:5173/api/health"
DEV_PID=""
FAILED=0

bold() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILED=1; }
hint() { printf '    \033[33m%s\033[0m\n' "$1"; }

# 跨平台杀进程树（Windows 上 pnpm 会拉起子进程，只 kill 父进程会留孤儿）
kill_tree() {
  local pid="$1"
  [ -z "$pid" ] && return 0
  if command -v taskkill >/dev/null 2>&1; then
    taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  else
    pkill -P "$pid" >/dev/null 2>&1 || true
    kill "$pid" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  if [ -n "$DEV_PID" ]; then
    bold "收尾：停掉 dev server"
    kill_tree "$DEV_PID"
  fi
}
trap cleanup EXIT

wait_for_http() { # url  label  tries
  local url="$1" label="$2" tries="${3:-40}" i
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
      ok "$label 可达（$url）"
      return 0
    fi
    sleep 1
  done
  bad "$label 不可达（$url，等了 ${tries}s）"
  return 1
}

# ── 1/4 数据库：起库 → 应用迁移 → 断言扩展、索引与记录表 ───────────────
# ⚠️ migrate 不能省：迁移 0000_enable_vector.sql 才是 `CREATE EXTENSION vector`
#    的执行者 —— 空卷上不跑它，db:check 必然断言失败（「克隆即跑」会断在这）。
# ⚠️ 顺序：必须在 pnpm verify **之前** —— 有测试要连真库
#    （落库往返 / 端到端）；先 verify 会在干净克隆上假失败。
#
# SKIP_DB_UP=1 → 跳过 `pnpm db:up`：CI 里数据库由 services: 容器提供，
#   此时在 runner 上再 `docker compose up` 会撞端口。CI 与本地跑的是**同一个脚本**。
bold "1/4  数据库（pnpm db:up && pnpm db:migrate && pnpm db:check）"
DB_READY=1
if [ "${SKIP_DB_UP:-}" = "1" ]; then
  ok "SKIP_DB_UP=1 —— 容器由外部提供（CI 的 services:）"
else
  if pnpm db:up; then
    ok "容器已起"
  else
    bad "pnpm db:up 失败"
    hint "Docker Desktop 启动了吗？"
    DB_READY=0
  fi
fi

if [ "$DB_READY" = "1" ]; then
  if pnpm db:migrate; then
    ok "迁移已应用（vector 扩展 + smoke 表 + 6 张记录表）"
    if pnpm db:check; then
      ok "数据库检查通过"
    else
      bad "pnpm db:check 失败"
    fi
  else
    bad "pnpm db:migrate 失败"
    hint "drizzle.config.ts 的 DATABASE_URL 对吗？"
  fi
fi

# ── demo 凭据：轮换过密码后，本地 e2e 仍用同一组账号 ─────────────────
# 凭据文件只在本机存在（伺服 / 轮换时生成）；CI 没有它，回退迁移 0009 的默认密码。
if [ -f .demo-accounts.json ]; then
  # 新卷 / 重跑迁移会把 demo 密码写回默认值，先按凭据文件同步一次
  if [ "$DB_READY" != "1" ]; then
    hint "数据库未就绪，跳过 demo 账号同步"
  elif node --env-file-if-exists=.env scripts/seed-demo-users.mjs >/dev/null; then
    E2E_PASSWORD="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('.demo-accounts.json','utf8'));process.stdout.write(j.accounts?.['demo@knowfit.local']?.password ?? '')")"
    if [ -n "$E2E_PASSWORD" ]; then
      E2E_EMAIL="demo@knowfit.local"
      export E2E_EMAIL E2E_PASSWORD
      ok "e2e 使用 .demo-accounts.json 的 demo 凭据"
    else
      bad "凭据文件里没有 demo@knowfit.local"
    fi
  else
    bad "demo 账号同步失败"
  fi
else
  hint "没有 .demo-accounts.json —— e2e 用迁移默认密码（本机可跑 pnpm demo:seed）"
fi

# ── 2/4 代码正确性闸门：typecheck + lint + test ───────────────────────
bold "2/4  pnpm verify （typecheck && lint && test）"
if pnpm verify; then
  ok "pnpm verify 通过"
else
  bad "pnpm verify 失败"
fi

# 前端构建 —— 类型过了不代表打得出来；构建失败 = 闸门失败。
if pnpm --filter @know-fit/web build; then
  ok "web 构建通过（pnpm --filter @know-fit/web build）"
else
  bad "web 构建失败"
fi

# ── 3/4 前后端能起：pnpm dev + 探活 ───────────────────────────────────
bold "3/4  pnpm dev 起前后端，并探活"
if command -v curl >/dev/null 2>&1; then
  # 端口若已被占用，先记一笔（避免把「上一个 dev server」误当成这次起成功了）
  if curl -fsS -o /dev/null "$HEALTH_URL" 2>/dev/null; then
    hint "注意：端口上已有服务在响应 —— 本步骤可能探到的不是本次启动的进程"
  fi

  # 🔴 三个 provider 显式写死 fake：闸门绝不联网、绝不需要 key。
  #    （dev server 不读 .env，默认也是 fake —— 这里显式设是为了防外部环境变量把它翻过去。）
  #    REGISTRATION_INVITE_CODE= 显式清空：作者 .env 里配了邀请码时，e2e 仍要能注册。
  LLM_PROVIDER=fake EMBEDDING_PROVIDER=fake RERANK_PROVIDER=fake REGISTRATION_INVITE_CODE= pnpm dev >/tmp/knowfit-dev.log 2>&1 &
  DEV_PID=$!

  wait_for_http "$WEB_URL"            "web 聊天页 GET /" 40
  wait_for_http "${WEB_URL}stats"     "web 统计页 GET /stats" 10
  wait_for_http "${WEB_URL}data"      "web 历史页 GET /data" 10
  wait_for_http "${WEB_URL}profile"   "web 档案页 GET /profile" 10
  wait_for_http "$HEALTH_URL"         "api 健康检查 GET /api/health" 20
else
  bad "找不到 curl —— 无法探活"
fi

# ── 4/4 端到端往返：说一句训练 → 变成一条记录 ──────────────────────────
# 这一步与 3/4 分开，是因为它答的是另一个问题：
#   「进程活着」≠「路真的通」。路由挂没挂上、代理转对没转对、应答契约对不对得上，
#   只有真发一次请求才知道。
#
# 本步两块：
#   A. 录入往返 —— POST /api/turns → 库里真有这条记录
#   B. 采集转写 —— 真跑一遍 kb:ingest → 库里真有知识源、
#      正文没漏出去、下架通道通。走**替身 provider**（不联网、不加载模型）。
#   C. 切片与索引 —— 真跑 kb:index → 片落对、重跑幂等、下架带走片。
#   D. 检索与引用 —— 造源 → 检索过滤 → 闸② → 引用偏移 → R-C 计数。
#   E. 历史 / 档案 / 提示 —— 档案往返 → 体重落 body_metric → 提示只出现一次。
#   F. 读聚合 / 范围统计 / 历史 / 评估缺失 / 窄修正 —— 与前端四页消费同一批接口。
#   G. 用户系统 —— 注册 / 隔离 / 改资料 / 清空训练 / 注销，全部走会话 cookie。
#   H. 身份 / 知识问答 / 空抽取 / 会话记录 —— 会话创建、恢复、改名、删除。
bold "4/4  端到端往返（POST /api/turns + 采集转写 + 切片索引 + 检索引用 + 档案提示 + 读聚合修正 + 用户系统 + 会话记录）"
if [ "$FAILED" -eq 0 ]; then
  if node scripts/e2e-turn.mjs; then
    ok "端到端往返通过"
  else
    bad "端到端往返失败"
    hint "dev server 起了吗？vite 代理的 /api 重写对了吗？"
  fi

  # 历史 / 档案 / F7 提示补齐 —— 走 5173 代理，再用裸 SQL 验落库。
  if node scripts/e2e-dev006.mjs; then
    ok "档案读写 / 历史读取 / 提示去重通过"
  else
    bad "档案读写 / 历史读取 / 提示去重失败"
    hint "0007 迁移跑了吗？pnpm db:migrate"
  fi

  # 读聚合 / 范围统计 / 历史 / 评估缺失 / 窄修正 —— 走 5173 代理，裸 SQL 验落库。
  if node scripts/e2e-dev007.mjs; then
    ok "读聚合 / 范围统计 / 历史 / 评估缺失 / 窄修正通过"
  else
    bad "读聚合 / 范围统计 / 历史 / 评估缺失 / 窄修正失败"
    hint "0007 迁移跑了吗？pnpm db:migrate"
  fi

# 用户系统 —— 注册 → 隔离 → 改资料 → 清空训练 → 注销；收尾自删测试账号。
  if node scripts/e2e-dev008.mjs; then
    ok "用户系统端到端通过"
  else
    bad "用户系统端到端失败"
    hint "0009 迁移跑了吗？pnpm db:migrate"
  fi

  # 身份 / 知识问答 / 空抽取 / 会话记录 —— 走 5173 代理，裸 SQL 验落库。
  if node scripts/e2e-dev009.mjs; then
    ok "身份 / 知识问答 / 空抽取 / 会话记录通过"
  else
    bad "身份 / 知识问答 / 空抽取 / 会话记录失败"
    hint "0010 迁移跑了吗？pnpm db:migrate"
  fi

  # 训练计划子图 —— 问卷式追问、写回档案、7 天排布与来源标注。
  if node scripts/e2e-dev016.mjs; then
    ok "训练计划子图与计划卡通过"
  else
    bad "训练计划子图与计划卡失败"
    hint "0015 迁移跑了吗？pnpm db:migrate"
  fi

  # 区间容量 —— 本周 / 上周按自然周统计；没有记录时如实回答，不落到「没听清」。
  if node scripts/e2e-dev018.mjs; then
    ok "区间容量查询与无数据如实回答通过"
  else
    bad "区间容量查询与无数据如实回答失败"
    hint "dev server 起了吗？"
  fi

  # 邀请码 / 限流 / 安全头 —— 自己起一个生产模式 API（3101），不依赖 3000。
  if node scripts/e2e-dev013.mjs; then
    ok "邀请码 / 限流 / 安全头通过"
  else
    bad "邀请码 / 限流 / 安全头失败"
    hint "0014 迁移跑了吗？.demo-accounts.json 与库里密码一致吗？"
  fi

  # 采集转写 —— 走替身 provider：不联网、不加载模型。
  # 它证的是「管道通」；「抖音解析对 / 转写准」只在作者本机（kb:smoke）。
  # 不依赖 dev server，只依赖库。
  if node scripts/kb-check.mjs; then
    ok "采集转写管线通过"
  else
    bad "采集转写管线失败"
    hint "库起了吗？迁移（pnpm db:migrate）跑了吗？"
  fi

  # 切片与索引 —— 同样走替身：不联网、不需要 key。
  # 它证的是「片落对 + 幂等 + 下架联动」；「切得像不像一个观点 / 判得准不准」不在这一步。
  if node scripts/kb-index-check.mjs; then
    ok "切片与索引通过"
  else
    bad "切片与索引失败"
    hint "0004 迁移跑了吗？pnpm db:migrate"
  fi

  # 检索与引用 —— 走替身 embedding / rerank / LLM：不联网。
  # 它证的是「五条过滤都在、闸② 拒绝会降级、引用偏移能还原、R-C 计数在涨」；
  # 「召回准不准 / 引用贴不贴切」不在这一步（那只能来自作者盲评的 pilot）。
  if pnpm rag:check; then
    ok "检索与引用通过"
  else
    bad "检索与引用失败"
    hint "0006 迁移跑了吗？pnpm db:migrate"
  fi
else
  hint "跳过：前面的步骤已经失败（dev server / 库未必起着）"
fi

# ── 结论 ─────────────────────────────────────────────────────────────
if [ "$FAILED" -ne 0 ]; then
  printf '\n\033[31m执行闸门未通过。\033[0m 这不是「差一点点」—— 代码现在跑不起来。\n'
  [ -f /tmp/knowfit-dev.log ] && { echo '--- dev server 日志尾部 ---'; tail -n 30 /tmp/knowfit-dev.log; }
  exit 1
fi
printf '\n\033[32m执行闸门全部通过。\033[0m\n'
printf '  ⚠️ 本闸门跑在 LLM_PROVIDER=fake 上 —— 它证明的是「管道通」，\n'
printf '     **不是**「模型抽得准」；准确率只能来自本地 llm:smoke（要作者自己的 key）。\n'
printf '  ⚠️ 采集转写那步同样跑在替身上 —— 它证明「管道通」，\n'
printf '     **不是**「抖音解析对 / 转写准」；那两件事只能来自作者本机 kb:smoke。\n'
printf '  ⚠️ 切片与索引那步也跑在替身上 —— 它证明「落库 / 幂等 / 下架联动通」，\n'
printf '     **不是**「切得像一个完整观点 / claim_type 判得准」；那两件事只能来自\n'
printf '     作者本机肉眼复核 + promptfoo 评测（≥20 条人工标注）。\n'
printf '  ⚠️ 检索与引用那步同样跑在替身上 —— 它证明「过滤 / 闸② / 偏移 / 护栏通」，\n'
printf '     **不是**「召回准 / 引用贴切」；那只能来自作者盲评的 20 条 pilot。\n'
printf '  ⚠️ 会话 / 知识问答那步也跑在替身上 —— 它证明「路由 / 落库 / 恢复 / 级联通」，\n'
printf '     **不是**「身份语气对 / 知识答得好」；那只能来自真实模型 smoke + 作者目验。\n'
printf '  ⚠️ 闸③（定期复核引用是否仍成立）不在 v1：写入即判「可用」，没有后续复核。\n'
printf '  ⚠️ 检索参数（topK / topN / 相似度门槛 / 同源配额）是推断初值，尚未用真实数据校准。\n'
printf '     配额是否真的救回推日召回，只能来自作者本机 pnpm rag:retrieval:eval。\n'