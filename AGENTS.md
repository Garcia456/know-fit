# AGENTS.md —— know-fit

> 写给 AI 编码助手（和人类贡献者）的项目级纪律。
> 各包的 `apps/*/AGENTS.md` 只管「这个包怎么跑 / 怎么测 / 不许碰什么」，不重复本文件。

---

## 一、怎么跑起来

```bash
pnpm install
cp .env.example .env         # 默认 LLM_PROVIDER=fake，不填 key 也能跑通
pnpm db:up                   # 起 pgvector（容器名 knowfit-db）
pnpm db:migrate
pnpm db:check                # 断言扩展、索引、记录表都在
pnpm dev                     # web :5173，api :3000
```

`.env` 里 `LLM_PROVIDER=fake` 时对话走替身，返回固定话术，只验证管道通不通。
要看真实回复，改成 `openai` 并填 `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL`。

**收工前停掉自己起过的进程。** 功能点开发完、两道闸门都过、判断本轮不再需要改动时，在结束会话前把 `pnpm dev` / `bash scripts/check-dev.sh` 起的前后端进程停干净。维护者随后要做真实模型联调和人工验收，残留的 fake 进程会被误当成本机服务，请求实际仍走替身；而且进程不重启，注册 / 对话限流桶不会清零，会表现为莫名其妙的 429。

```bash
netstat -ano | grep -E ':3000|:5173'   # 收工时应没有 LISTENING
```

Windows 上 `check-dev.sh` 的收尾偶尔漏杀子进程。若端口仍被占、且 PID 的命令行来自本仓库的 `src/server.ts` 或 vite，用 `taskkill //PID <pid> //F //T` 结束它。

---

## 二、两道闸门

| 命令 | 验什么 | 期望退出码 |
|---|---|---|
| `pnpm verify` | 类型检查 + lint + 单元测试 | **0** |
| `bash scripts/check-dev.sh` | 端到端真跑一遍（含起服务、探活、往返） | **0**；坏掉时必须非零 |

`check-dev.sh` 是完成证据，**不是 `pnpm verify` 的同义词**。两者都要过。
它跑在 `LLM_PROVIDER=fake` 上——证明的是「管道通」，不是「模型准」。

CI 跑的就是 `bash scripts/check-dev.sh`，不另写一套命令。数据库由 CI 的 service 容器提供，故设 `SKIP_DB_UP=1`。

---

## 三、提交 scope 约定

单仓里前端 / 后端 / 脚手架走同一条 `main` 历史，靠 scope 分线：

| scope | 管什么 |
|---|---|
| `feat(web):` / `fix(web):` | `apps/web` 前端 |
| `feat(api):` / `fix(api):` | `apps/api` 后端 |
| `chore(harness):` | 闸门脚本、CI、根配置、指令文件 |
| `chore(seed):` | `apps/api/seed/` 数据 |
| `docs:` | README、NOTICE 等随仓库公开的说明 |

`git log --oneline -- apps/web` 即「前端这条线」。

---

## 四、提交尺寸

- 🔴 **单个 PR < 500 行改动、< 10 个文件。** 超了就拆。

---

## 五、两条与代码直接相关的硬约束

### 1. API 层绝不下发知识片全文

护栏盯的是**三条漏出通道**：

- **R-A**：`apps/api/src/routes/**` 禁止 import Drizzle schema 模块
- **R-B**：`apps/api/src/contracts/**` 出现 `text` / `content` / `transcript` 字段名即报错
- **R-C**：运行期遍历所有 API 响应体、断言不含 chunk 全文

⚠️ 落了 R-A / R-B ≠ 约束被保住——它们只是便宜的路径滤网，R-C 才是真正的证据。

### 2. 确定性代码与 LLM 的边界

容量 / 热量 / 趋势 / 红线拦截 / query 模板**一律确定性代码**；
LLM 只做抽结构化数据 / 讲人话 / 意图分类。

🔴 **本项目头号技术错误是：让 LLM 直接算容量或热量。**

---

## 六、目录

| 目录 | 放什么 |
|---|---|
| `apps/api/src/routes/` | HTTP 路由——只做参数校验与编排，不直接读库 |
| `apps/api/src/contracts/` | 对外响应类型 / Zod schema |
| `apps/api/src/services/` | 读写实现 + 连接池（🔴 唯一允许 import `db/schema` 的一层） |
| `apps/api/src/extraction/` | 抽取后的确定性加工：单位换算、日期解析、动作归一 |
| `apps/api/src/llm/` | 模型访问（provider 解析 / 提示词 / fixture） |
| `apps/api/src/graph/` | LangGraph 图与节点 |
| `apps/api/evals/` | promptfoo 评测脚本。**数据集不随仓库公开**，自备数据复现 |
| `apps/web/src/pages/` | 四个页面：聊天 / 统计 / 历史 / 档案 |
| `apps/web/src/design-system/` | 设计令牌与组件样式，构建直接消费 |
| `scripts/` | 闸门、端到端、部署与运维脚本 |

---

## 七、不许越界

- **一次只做一件事**；不动与当前任务无关的文件。
- 🔴 **不凭自己的判断裁剪已有结构**——觉得某文件「重复 / 无用」不是删除理由，先问维护者。
- **不提交密钥。** `.env`、`deploy/.env.production`、`.demo-accounts.json` 都在 `.gitignore` 里，别为了「跑通」把它们加进去。
- **CI 里不写 `secrets.*`**——全程 fake、不联网；真实 model 调用只在本地 `pnpm llm:smoke`。

---

## 八、这个仓库的来龙去脉

- 这是求职作品集项目，MIT 许可，**不接受 PR**；有问题开 issue。
- 提交信息里的 `ADR-0xx` / `dev-0xx` / `feat-0xx` 是内部文档编号，**对应文档不随仓库公开**。
- 知识库采集依赖第三方解析服务，公开版不含；RAG 需要自备数据链路。
