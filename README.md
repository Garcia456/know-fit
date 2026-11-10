# know-fit

健身 / 运动人群的 AI Agent：用一句话录入训练与饮食，Agent 解析成结构化记录、算训练量与热量、
给评估与建议；**建议锚定头部健身博主的视频，并附时间戳链接，点得回原片**。

对话入口之外还有四页：会话 / 统计（训练量趋势 + 肌群热力图）/ 历史（可编辑）/ 我的。

> **状态：** 功能完整、已部署。开发过程中带 AI 协作（提交里有 `Co-Authored-By`），
> 项目文档与决策记录不在本仓库。

---

## 它解决什么

健身记录工具的通病是**记录成本高、记录之后不给东西**。市面上的产品要么让你在表单里
一行行填动作 / 重量 / 组数，要么只把训练折算成一个笼统的「消耗多少大卡」。

know-fit 做两件事：

1. **说话就行。**「今天推日：卧推 70kg 5×5，上斜哑铃 25kg 4×10」→ 直接落成结构化记录，
   动作名、重量、次数、组数、力竭 / 递减标签都单独存，能据此算训练容量与趋势。
2. **建议有出处。** 涉及训练建议时走 RAG：从知识库里召回博主的原话片段，生成建议时标注来源，
   **界面上给出视频标题 + 时间戳，点开直接跳到那一段**。没有可靠来源时明确说「没有找到出处」，
   不编。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19 + Vite |
| 后端 | Fastify 5 |
| 编排 | LangGraph JS + Zod（意图路由 → 抽取 / 查询 / 计划 / 知识子图） |
| 数据 | PostgreSQL 18 + pgvector（HNSW）+ Drizzle ORM |
| 模型 | 千问云 / 百炼（OpenAI 兼容协议），embedding `text-embedding-v4` |
| 测试 | Vitest（API 单测 + 集成、Web 组件测试）+ 端到端脚本 |

---

## 本地跑起来

**前置：** Node ≥ 22.22、pnpm 12、Docker Desktop。

```bash
git clone https://github.com/<you>/know-fit.git
cd know-fit
pnpm install
cp .env.example .env          # 默认 LLM_PROVIDER=fake，不填 key 也能跑通
pnpm db:up                    # 起 pgvector
pnpm db:migrate
pnpm db:check                 # 断言扩展、索引、记录表都在
pnpm dev                      # web :5173，api :3000
```

打开 http://localhost:5173 注册一个账号即可。

### fake 模式与真实模型

`.env` 里 `LLM_PROVIDER=fake` 时，对话走**替身**：返回固定话术，只用于验证管道通不通。
要看真实对话，填上 OpenAI 兼容端点的三项并改成 `openai`：

```bash
LLM_PROVIDER=openai
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_API_KEY=sk-...
OPENAI_MODEL=qwen3.8-flash
```

### 知识库

知识库里**没有数据**，RAG 就没有来源可引。采集链路要自建抖音 / B 站解析服务与本机 ASR
（faster-whisper），属于作者本机环境，不在本仓库：

```bash
# 白名单在 apps/api/seed/knowledge_whitelist.json（现在是占位，填自己的博主）
pnpm kb:ingest     # 采集 → 转写
pnpm kb:index      # 切片 → embedding → 入库
pnpm kb:smoke      # 复核转写是不是口播
```

没有知识库时，训练记录、统计、计划功能照常可用，知识问答会如实回答「没有找到出处」。

---

## 命令

```bash
pnpm verify        # typecheck + lint + test（提交前必跑）
bash scripts/check-dev.sh   # 执行闸门：起库 → 迁移 → verify → 起服务 → 探活 → 端到端
```

`check-dev.sh` 是唯一的执行闸门：它验「它真的跑得起来吗」，代码坏了必须非零退出。
CI（`.github/workflows/ci.yml`）跑的就是同一个脚本，只是数据库由 runner 的 service 容器提供。

其余脚本：`scripts/` 下有部署 / 备份 / 恢复（`deploy.sh` `backup.sh` `restore.sh`）、
数据库体检（`db-check.mjs`）、demo 账号种子、RAG 体检（`rag-doctor.sh`）。

⚠️ `scripts/check-dev.sh` 固定用 **5173 / 3000** 端口。Windows 上 5140–5239 是系统保留端口，
5173 起不来 —— 用 WSL / macOS / Linux，或在 CI 上跑。

---

## 部署

`Dockerfile` 有 `api` / `web` / `migrate` 三个 target，`compose.prod.yml` 编排
db / api / web / caddy + 一次性迁移。Caddy 支持「有域名自动 TLS」与「无域名 HTTP」两种形态。

```bash
docker compose -f compose.prod.yml --env-file deploy/.env.production up -d
```

首次上线需要把知识库数据从本机导进去：`pg_dump -Fc` → `pg_restore --no-owner --no-privileges`。
**不要**先 migrate 再 `--data-only` 导入 —— 知识表会静默变成 0 行。

`.github/workflows/release.yml` 构建镜像并推到 GHCR（`sha-<12>` tag），不做自动 SSH 部署。

---

## 目录

```
apps/api       Fastify 服务：意图图、抽取、计算、检索、知识问答、评估
apps/web       React 前端：会话 / 统计 / 历史 / 我的
scripts        闸门、端到端、部署与运维脚本
deploy         Caddyfile 与生产环境变量样例
docker         nginx 配置（web 静态产物）
apps/web/src/design-system   设计令牌与组件样式（构建直接消费）
```

---

## 已知限制

- **知识库采集依赖第三方解析服务**，公开版不包含，RAG 需要自备数据链路。
- **博主视频的内容采集涉及平台协议**：本项目的采集只走公开页面、不碰站内 API、非商业用途、
  提供下架通道；但各平台用户协议明文禁止爬虫，这一点没有干净的解法。
- **评测集不公开**（含博主转写原文）。
- 流式输出、多端同步、离线记录都还没做。

---

## 许可

代码 MIT，见 [LICENSE](LICENSE)。第三方组件见 [NOTICE](NOTICE)。
