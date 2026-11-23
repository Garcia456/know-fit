<div align="center">
  <img src="./apps/web/public/icon-512.png" width="88" alt="know-fit" />
  <h1>know-fit</h1>
  <p><strong>说一句话记录训练。训练指标由代码算，每条建议都能回到原片。</strong></p>
  <p>自然语言录入 · 确定性训练指标 · 逐字引用与时间戳 · 自托管数据链路</p>

  <p>
    <a href="https://github.com/Garcia456/know-fit/actions/workflows/ci.yml"><img src="https://github.com/Garcia456/know-fit/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
    <a href="package.json"><img src="https://img.shields.io/badge/node-%E2%89%A522.22-339933?logo=node.js&logoColor=white" alt="Node >= 22.22" /></a>
    <a href="docker-compose.yml"><img src="https://img.shields.io/badge/PostgreSQL-18%20%2B%20pgvector-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL 18 + pgvector" /></a>
  </p>
</div>

---

know-fit 是面向力量训练者的 AI 训练日志。它把一句自然语言解析成可计算的结构化记录，再由确定性代码算出训练容量、有效组数、肌群分布与体重趋势；涉及训练建议时，从你自建的博主视频知识库中检索，给出**逐字引用 + 视频标题 + 起始时间戳**，一键打开原片。没有可靠出处时，不编造信息。

知识库的采集链路也随仓库提供：**白名单 → dtk → 本地语音转写 → 切片 / 索引 → 检索 / 引用**。平台解析交给开源项目 [dtk](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)，know-fit 不重写签名算法，只通过它的 REST API 取公开作品信息与音轨。

---

## 目录

- [为什么是 know-fit](#为什么是-know-fit)
- [一眼看懂](#一眼看懂)
- [核心能力](#核心能力)
- [快速开始](#快速开始)
- [架构](#架构)
- [知识链路：从博主原片到可定位引用](#知识链路从博主原片到可定位引用)
- [配置](#配置)
- [命令](#命令)
- [部署](#部署)
- [项目结构](#项目结构)
- [质量保障](#质量保障)
- [参与贡献](#参与贡献)
- [致谢](#致谢)
- [许可](#许可)

---

## 为什么是 know-fit

健身记录工具的通病是**记录成本高、记录之后不给东西**。市面上的产品要么让你在表单里一行行填动作、重量、组数，要么只把训练折算成一个笼统的「消耗多少大卡」。记录完，训练量和动作选择对不对，仍然靠猜。

know-fit 做三件事：

1. **说话就行。**「今天推日：卧推 70kg 5×5，上斜哑铃 25kg 4×10」直接落成结构化记录。动作、重量、次数、组数、力竭 / 递减 / 休息暂停标签分别存储，后续才能算容量、分肌群、比趋势。
2. **数字不让模型算。** LLM 只负责把话解析成动作、重量、次数和组数；日期解析、单位换算、动作归一、容量、有效组、肌群分摊、趋势和红线拦截全部由确定性代码完成。每个指标都有手算期望值的黄金用例。
3. **建议有出处。** 知识问答与训练评估走 RAG：召回博主原话片段，经过两道闸门校验后，只展示逐字引用与起始时间戳。没有可靠来源时显式降级为无源，不补写。

---

## 一眼看懂

```text
你：昨天推日，卧推 70kg 5×5，上斜哑铃 25kg 4×10，最后一组力竭

know-fit：
  已记录 · 2026-11-19 · 推日
  ─────────────────────────────────────
  卧推          70 kg × 5 组 × 5 次     1,750 kg
  上斜哑铃      25 kg × 4 组 × 10 次    1,000 kg
  ─────────────────────────────────────
  训练容量 2,750 kg · 有效组 9 组
```

> 以上为演示数据，数字由容量公式实际算出。

记录完成后，训练卡片和统计页会继续给出：

- **容量趋势**：按本次训练或同一分化训练对比，算环比。
- **有效组数（Hard Sets）**：所有正式组各计 1 组，热身不计；再按主动肌 / 协同肌 / 第三档权重摊到肌群。
- **20 区肌肉热力图**：细分肌群聚合成 9 个展示组，5 档强度显示训练分布。
- **体重趋势**：按日记录体重，区间内给出变化量与折线。
- **历史日历**：按日期回看每次训练，支持编辑、删除、拖动排序与系统推测值修正。

需要建议时：

```text
你：这次推日练得怎么样？

know-fit：
  判定：本次容量 2,750 kg，较上次同分化训练 +8.2%（示例）。
  建议：
  1. 卧推下次优先加次数，而不是继续加重量。 [1]
  2. 上斜哑铃保持 4 组，把最后一组做到接近力竭。

  [1] 某训练博主 · 视频标题 · 04:12 · 看原片
```

> 引用块展示博主、视频标题和起始时间戳；点「看原片」打开原视频，按时间戳定位到那句话。

---

## 核心能力

### 1. 一句话录入，结构化落库

- 支持一次说多个动作、多组、递减组、休息暂停、力竭与热身；日期可说「今天 / 昨天 / 前天 / 11 月 18 日」。
- 64 个动作、20 个细分肌群、别名与歧义规则：能确定的归一到 `exercise_id`，确定不了的走部位兜底，**不强行归并**。
- `lb → kg`、自重动作的「体重 + 额外负重」、缺失重量 / 次数的组全部确定性处理；算容量时缺数据的组只跳过并计数，不按 0 计算。
- 记录后立刻出训练卡：每个动作的容量、总容量、有效组数；系统推测的数字有标记，可在历史页改回。
- 支持窄修正：「刚才那组卧推是 75kg」会更新最近一次记录里对应的动作，而不是重新记一遍。

### 2. 训练指标全部由确定性代码计算

- **容量**：`Σ(重量 × 次数)`，只算正式组；一组多段（递减 / 休息暂停）每段分别算，但仍算一组。
- **有效组数**：所有 `working` 组各计 1 组；热身不计；缺重量、缺次数、自重、递减、休息暂停都照计。
- **肌群分摊**：主动肌 1.0、协同肌 0.5、第三档 0.25；说不清动作只能定部位时，覆盖到的肌群按 1.0 摊。
- **展示口径**：20 个细分肌群 → 9 个展示组；定不到动作的部分单列 `unclassified`，不静默丢弃。
- 容量、有效组、肌群分摊都有**手算期望值**的黄金用例；公式改动会让测试当场报错。

### 3. 建议可追溯，引用逐字校验

- 训练评估由「个人数据判定 + 1–2 条知识库主张」组成，每次 2–4 条；至少 1 条必须来自你的数据。
- 检索 query 由判定、目标与主要训练部位共同构造；向量召回后经 `qwen3-rerank` 重排，再按来源配额挑选，避免单一视频占满建议。
- **闸①** 在入库时把知识片判成「陈述 / 演示 / 寒暄」，只有「陈述」进入可引用池；转写置信度低于 0.75 的片同样排除。
- **闸②** 在生成时校验：模型只能选择引文的起始窗口，服务端从原文切出 12–200 字的连续子串；建议里的每个数字都必须能在判定或片段全文中找到。
- 评估路径 all-or-nothing：任一有源主张过不了闸②，整条评估降级为无源；知识卡按条降级，一条不过只丢它自己。
- 同一视频只产生一条引用；没有可靠来源时明确展示「这条没有找到可靠的博主依据」，不拿模型常识冒充博主原话。

### 4. 计划与恢复提醒

- 训练计划按二分化 / 三分化 / 四分化 / 五分化 / 不规律生成；分化与每周天数由确定性规则解析，LLM 只负责编排动作与措辞。
- 有知识库时，计划中的有源部分同样挂引用；没有来源时显式标注无源。
- 恢复提醒先补全未记完的训练；再按近 4 周平均训练间隔 × 2 计算断流阈值，夹在 7–14 天之间。同一断点只提醒一次。

### 5. 为训练场景做的界面与访问控制

- 四个主页面：会话 / 统计 / 历史 / 我的；会话页常驻，切 tab 不丢未回复的消息和「思考中」状态。
- 历史抽屉支持置顶、重命名、多选删除；训练记录支持编辑、删除、拖动排序。
- 统计页支持今天 / 本周 / 本月 / 自定义区间；有效组数可下钻到肌群分布与动作明细，区间写回 URL，刷新不丢。
- 会话 Cookie 鉴权、按路由的固定窗口限流、开放注册、API 安全响应头；知识库按平台做可见性授权。
- 账号分层：注册须先通过邮箱验证码；服务端模型对话按免费次数计，用尽后可自带 DeepSeek Key（加密保存，端点与模型白名单锁死）继续；用邀请码解锁知识库的账号不计次。

---

## 快速开始

**前置：** Node ≥ 22.22、pnpm 12、Docker Desktop。

```bash
git clone https://github.com/Garcia456/know-fit.git
cd know-fit

pnpm install
cp .env.example .env          # 默认 LLM_PROVIDER=fake，不填 key 也能跑通
pnpm db:up && pnpm db:migrate
pnpm db:check                 # 断言扩展、HNSW 索引、记录表都在
pnpm dev                      # web :5173，api :3000
```

打开 <http://localhost:5173>，注册一个账号即可。

默认 `MAIL_PROVIDER=fake`：注册验证码写进 `.mail-outbox/outbox.jsonl`，不联网也能完成注册。注册必须先过邮箱验证码，没有验证不能建号。

默认的 `fake` 模式是**刻意设计**的：LLM、embedding、rerank、ASR、采集全部走确定性替身，离线、不联网、不需要密钥。它验证的是管道是否打通，也是 CI 跑的路径。

### 接真实模型

```bash
LLM_PROVIDER=openai
OPENAI_BASE_URL=        # 兼容 OpenAI 协议的 URL
OPENAI_API_KEY=sk-...
OPENAI_MODEL=       
```


### 按需启用知识库

训练记录、统计、计划不依赖知识库。要让建议带上出处，需要把采集与检索链路接上：

1. 准备解析服务：自托管 dtk，或先用 [dtk 的在线 Demo](#快速上手先用-dtk-的在线-demo-拉数据) 验证链路；拿服务地址与 API key。
2. 在 `apps/api/seed/knowledge_whitelist.json` 填入你的博主与钉住视频。
3. 配置解析、转写与检索：

```bash
KB_PROVIDER=real
KB_PARSER_BASE_URL=http://127.0.0.1:8000
KB_PARSER_API_KEY=...
ASR_PROVIDER=local
ASR_PYTHON=/path/to/python-with-faster-whisper
EMBEDDING_PROVIDER=real
RERANK_PROVIDER=real
```

4. 跑通链路：

```bash
pnpm kb:smoke      # 先验少量视频：是不是口播、时间戳对不对
pnpm kb:ingest     # 全量采集与转写
pnpm kb:index      # 切片、判定、向量化、入库
pnpm rag:check     # 检查知识源 / 向量 / 授权
pnpm rag:smoke     # 用真实训练记录走一遍召回 → 重排 → 引用
```

---

## 架构

| 层 | 选型 |
|---|---|
| 前端 | React 19 + Vite + Motion |
| 后端 | Fastify 5 + Zod |
| 编排 | LangGraph JS：意图路由 → 抽取 / 查询 / 计划 / 知识子图 |
| 数据 | PostgreSQL 18 + pgvector 0.8.7（HNSW cosine）+ Drizzle ORM |
| 模型 | OpenAI 兼容端点（百炼 / 千问），embedding `text-embedding-v4`（1024 维），rerank `qwen3-rerank` |
| 语音 | 本机 faster-whisper `large-v3` |
| 采集 | 白名单 + 自托管 [dtk](https://github.com/Evil0ctal/Douyin_TikTok_Download_API) 解析服务 |
| 测试 | Vitest + promptfoo + 端到端脚本 |
| 部署 | Docker 多 target + compose + Caddy |

```text
浏览器（React 19）
   │  JSON / 会话 Cookie
   ▼
Fastify API
   ├─ 安全层：会话 / 限流 / 安全响应头 / 响应全文泄漏断言
   ├─ LangGraph 意图图
   │    ├─ preflight_guard        确定性红线拦截
   │    ├─ classify_intent        意图分类
   │    ├─ extract → normalize → units / dates → compute → persist
   │    ├─ knowledge              检索 → 重排 → 起草 → 闸② → 引用
   │    ├─ assessment             个人判定 + 有源建议
   │    └─ plan                   分化规则 + 动作编排
   ├─ PostgreSQL 18 + pgvector
   └─ OpenAI 兼容端点（chat / embedding / rerank）

离线数据链路
白名单 → dtk（自托管解析）→ 音频 → faster-whisper → 切片 / 闸① → embedding → pgvector
```

**确定性代码与 LLM 的边界：**

| 交给确定性代码 | 交给 LLM |
|---|---|
| 日期解析、单位换算、动作归一 | 意图分类 |
| 容量、有效组、肌群分摊、趋势 | 结构化抽取（动作 / 重量 / 次数 / 组 / 标签） |
| 红线拦截、限流、参数校验 | 建议与计划的措辞 |
| 检索 query 模板、来源配额、窗口切片、数字守卫、引用去重 | 判断哪段窗口支撑某条主张 |
| 分化与训练日规则、提醒阈值 | 计划中的动作选择 |

这条边界是项目的硬约束：**不让 LLM 直接算容量或热量**。模型可以抽错一个重量，但算错的容量不会因为模型「看起来合理」而被放过。

---

## 知识链路：从博主原片到可定位引用

RAG 的上游不是现成数据集，而是一条可复现的采集与加工链路。整条链路分成五段。

### 1. 白名单：配置采集对象

`apps/api/seed/knowledge_whitelist.json` 是唯一入口：

- `creators`：博主主页、领域、最多取多少条作品。
- `videos`：遍历拿不到时钉住的单条视频。
- `exclude_title_keywords`：标题命中即跳过，用来挡推广片。

**没有「发现」这个动作。** 白名单判定发生在任何外部请求之前，不会先抓再决定要不要抓。

### 2. 平台解析：dtk

平台侧解析由开源项目 **[dtk](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)** 提供。它是一个自托管的抖音 / TikTok / B 站数据采集服务，自带签名解析、身份池、REST API 与 MCP 接口。

know-fit 侧的适配方式：

- 通过 dtk 5.x 的 REST API 取博主作品列表与音频地址；`X-API-Key` 鉴权，默认异步任务用 `?wait=` 等待，超时后按 `task_id` 轮询。
- 列表按页遍历，客户端按「视频类型 / 音频地址存在 / 标题排除词 / 原声判定 / `max_items`」筛选，再跨页去重。
- 上游字段层级会随版本漂移，因此按语义找键（内容 id、标题、时长、`music.play_url`），找不到就退回白名单里的权威标签。
- 音频只作临时文件：下载 → 转写 → 在 `finally` 里删除；转写失败也照删。

> dtk 负责「拿到公开作品与音轨」，know-fit 负责「白名单、筛选、转写、加工、引用」。两边职责分开，签名算法不需要在业务仓库里再写一遍。

#### 快速上手：先用 dtk 的在线 Demo 拉数据

不想先自托管，也可以把采集链路先跑通。dtk 提供了一个公开实例：

1. 打开 <https://demo.douyin.wtf>，登录页会预填 demo 账号；登录后进入 [API keys](https://demo.douyin.wtf/api-keys)，复制明文显示的 key。
2. 在 `.env` 里把解析服务指向这个实例（转写仍在本机跑）：

```bash
KB_PROVIDER=real
KB_PARSER_BASE_URL=https://demo.douyin.wtf
KB_PARSER_API_KEY=dtk_...
ASR_PROVIDER=local
ASR_PYTHON=/path/to/python-with-faster-whisper
```

3. 先只跑模板里钉住的一条视频，确认「能解析、有人声、时间戳对」：

```bash
KB_SMOKE_LIMIT=1 pnpm kb:smoke
```

Demo 是共享的只读实例：限流 30 次 / 10 秒，不写请求日志与归档，随时可能重置或关闭。它适合验证链路与小样本试采；长期、批量采集请自托管 dtk，不要把 demo 当生产服务。

#### 让 Agent 帮你把博主写进白名单

把下面这段提示词交给你的编码 Agent，只把<博主名称>换成要采集的抖音博主，其余不用改。

```text
在 know-fit 仓库中，把抖音博主 <博主名称> 加入知识库白名单，最多采集 5 条。

先读 `apps/api/src/kb/types.ts`、`apps/api/src/kb/pipeline.ts`、`apps/api/src/kb/douyin.ts` 和 `apps/api/seed/knowledge_whitelist.json`，按它们的 schema 与筛选规则执行：

1. 从环境变量 `KB_PARSER_BASE_URL`、`KB_PARSER_API_KEY` 读取 dtk 连接信息；不要打印或写入 key。先用 `GET /api/v1/auth/me` 确认可用。
2. 找到该博主的主页 URL（可先查 dtk 控制台；找不到就向我要，不要猜 sec_uid），用 `GET /api/v1/douyin/user?url=主页URL` 核对昵称。
3. 用 `GET /api/v1/douyin/user/posts?url=主页URL&count=50&wait=30` 按 `cursor` 翻页，按 `pipeline.ts` 的规则筛出最多 5 条可采视频；`202/queued` 时按 `task_id` 轮询 `/api/v1/tasks/{task_id}`。
4. 把博主写入 `apps/api/seed/knowledge_whitelist.json` 的 `creators[]`：`creator` 用平台昵称，`profile_url` 用主页链接，`topic_domain` 填「健身」，`max_items` 填 5。保留已有条目和其他字段，不要新增 `videos[]`。
5. 运行 `KB_CREATOR="<博主名称>" pnpm kb:smoke`；通过后运行 `pnpm kb:ingest` 和 `pnpm kb:index`。
6. 只改白名单文件；不改代码、不提交、不写 key。接口字段不符就停下，报告原始键名。
```

> 这段提示词把「发现博主」留给人：Agent 只核对和落盘，不会顺着推荐流自己扩名单。

### 3. 转写：本机 faster-whisper

- 模型固定为 `large-v3`，默认 CPU + int8；有 NVIDIA 卡可切 `cuda`。
- 转写结果逐段保留时间戳；空转写不入库，避免把配乐片或纯音乐当成口播。
- 同音纠错表只做确定性替换：错形必须不是合法词、正形必须能在自有动作库中锚定，否则不收；表以外的文本一个字符都不动。

### 4. 切片与索引

- 按转写段边界切片，目标 300–600 字，优先在句末收片，相邻片保留 12.5% 重叠。
- 每片拼一个 `context_prefix`（博主、标题、领域、时间范围、上一片尾句），减少脱离语境的碎片；前缀参与 embedding，但**不参与对外呈现**。
- **闸①**：判定 `claim_type` 与置信度；不可引用的片只入库不召回。
- 动作标签从自有动作库匹配；同一份内容用 `content_hash` 幂等落库，重复跑不会产生重复片。
- 向量化走 `text-embedding-v4`（1024 维），写入 `knowledge_chunk.embedding`，HNSW cosine 索引。

### 5. 检索、重排与引用

- query 由训练部位、判定与目标构造；向量召回 `topK` 条，再交给 `qwen3-rerank` 重排。
- 同源配额限制每个来源最多贡献几片；候选不足时允许回填，但会在报告里标出。
- **闸②**：模型只返回引文起始窗口编号，服务端按 30–40 字窗口切出最多 5 窗、12–200 字的连续原文；数字守卫要求建议中的数字来自判定或片段全文。
- 引用按视频去重；输出只含 `short_quote`（逐字短引用）、博主、标题、`start_ts` 与视频链接，**不下发知识片全文**。

### 边界与运维

- 采集前检查 `robots.txt` 并记录 `checked_at`；结论只用于留痕，不冒充完整合规判定。
- 音频用完即删；下架通道保留行级留痕，可检索行数、转写段、知识片数量会同步下降。
- 各平台可见性独立判定：非受限平台全员可见，受限平台按用户授权。
- API 路由层不直接读库；对外契约不承载 `text` / `content` / `transcript` 全文型字段；运行期再把所有知识片全文切窗建哈希，扫描每个 JSON 响应，命中即返回 500。

常用命令：

| 命令 | 作用 |
|---|---|
| `pnpm kb:ingest` | 白名单 → 解析 → 下载音频 → 转写 → 落库 |
| `pnpm kb:index` | 切片 → 闸① → 动作标签 → embedding → 入库 |
| `pnpm kb:smoke` | 只跑钉住的少量视频，复核「管道通 + 是口播」 |
| `pnpm rag:check` | 检查知识源、向量版本、账号授权与检索配置 |
| `pnpm rag:smoke` | 走真库 + 真模型，打印召回、重排、起草、闸② 的中间结果 |
| `pnpm rag:doctor` | 生产 / 本机检索体检脚本 |
| `pnpm rag:eval` | RAG 端到端评测 |
| `pnpm rag:retrieval:eval` | 检索层评测 |

> 视频、音轨、转写与评测数据留在你的环境里，仓库只带代码、白名单模板与替身 fixture。你可以换成自己的博主清单，也可以把同一套链路接到别的语料。

---

## 配置

完整样例见 [`.env.example`](.env.example)。最常改的变量：

### 模型

| 变量 | 默认 | 作用 |
|---|---|---|
| `LLM_PROVIDER` | `fake` | `fake` 走替身；`openai` 走真实端点 |
| `OPENAI_BASE_URL` | 空 | OpenAI 兼容端点 |
| `OPENAI_API_KEY` | 空 | 模型密钥，只放 `.env` |
| `OPENAI_MODEL` | 空 | 聊天 / 抽取 / 起草用的模型 |
| `LLM_ENABLE_THINKING` | `off` | 思考模式，默认关闭以保证延迟 |

### 知识链路

| 变量 | 默认 | 作用 |
|---|---|---|
| `KB_PROVIDER` | `fake` | `fake` 替身 / `real` 走 dtk |
| `KB_PARSER_BASE_URL` | `http://127.0.0.1:8000` | dtk 服务地址 |
| `KB_PARSER_API_KEY` | 空 | dtk 的 `X-API-Key` |
| `ASR_PROVIDER` | `fake` | `fake` 替身 / `local` 本机 faster-whisper |
| `ASR_MODEL` | `large-v3` | 转写模型 |
| `ASR_DEVICE` | `cpu` | `cpu` / `cuda` |
| `EMBEDDING_PROVIDER` | `fake` | `fake` 确定性向量 / `real` 真实端点 |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-v4` | 换模型必须整库重建索引 |
| `RERANK_PROVIDER` | `fake` | `fake` 词面排序 / `real` `qwen3-rerank` |
| `RAG_TOP_K` / `RAG_TOP_N` | `50` / `5` | 召回数 / 最终候选数 |
| `RAG_MIN_SIMILARITY` | `0.5` | 向量相似度门槛 |
| `RAG_MAX_CITATIONS` | `3` | 单张卡最多引用数 |
| `RAG_MAX_PER_SOURCE` | `1` | 每个来源最多贡献几片 |

### 访问控制

| 变量 | 默认 | 作用 |
|---|---|---|
| `KNOWLEDGE_INVITE_CODE` | 空 | 设置后用户可在设置页填它解锁知识库；空 = 知识库暂未开放 |
| `RATE_LIMIT_LOGIN_PER_15MIN` | `20` | 登录限流 |
| `RATE_LIMIT_REGISTER_PER_HOUR` | `5` | 注册限流 |
| `RATE_LIMIT_REGISTER_CODE_PER_HOUR` | `10` | 注册邮箱验证码发送限流 |
| `RATE_LIMIT_INVITE_UNLOCK_PER_HOUR` | `5` | 邀请码解锁尝试限流 |
| `TURN_QUOTA_PER_HOUR` | `120` | 每用户对话配额 |
| `ASSESSMENT_QUOTA_PER_HOUR` | `60` | 每用户评估配额 |

### 账号、额度与邮件

| 变量 | 默认 | 作用 |
|---|---|---|
| `FREE_TURNS_LIMIT` | `20` | 服务端模型对话的免费次数上限（按账号计；邀请码账号不计次） |
| `KEY_ENCRYPTION_SECRET` | 空 | 自带 Key 的 AES-256-GCM KEK（32 字节 base64）；空 = 保存 Key 返回 503 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | 自带 Key 唯一允许的端点 |
| `DEEPSEEK_MODELS` | `deepseek-flash,deepseek-v4-pro` | 自带 Key 的模型白名单（逗号分隔） |
| `MAIL_PROVIDER` | `fake` | `fake` 写 outbox 文件 / `smtp` 真实投递 |
| `MAIL_OUTBOX_DIR` | `.mail-outbox` | fake 模式的 outbox 目录（注册验证码在这里） |
| `PUBLIC_APP_URL` | `http://localhost:5173` | 历史未验证账号的验证链接 / 邮件里的前端基址 |
| `RATE_LIMIT_VERIFY_RESEND_PER_HOUR` | `3` | 重发验证邮件限流 |
| `RATE_LIMIT_LLM_KEY_PER_HOUR` | `10` | 保存自带 Key 限流（每次保存都会探测上游） |

---

## 命令

```bash
pnpm dev                    # 前端 :5173 + API :3000
pnpm verify                 # typecheck + lint + 单元 / 集成测试
bash scripts/check-dev.sh   # 执行闸门：起库 → 迁移 → verify → 起服务 → 探活 → 端到端
pnpm db:up                  # 起 pgvector
pnpm db:migrate             # 跑 Drizzle 迁移
pnpm db:check               # 断言扩展、HNSW 索引、记录表
pnpm demo:seed              # 生成 demo 账号
```

知识库与检索：

```bash
pnpm kb:ingest / kb:index / kb:smoke
pnpm rag:check / rag:smoke / rag:doctor
pnpm rag:eval / rag:retrieval:eval
```

`bash scripts/check-dev.sh` 是唯一的执行闸门：它验证「它真的跑得起来吗」，代码坏了必须非零退出。CI 跑的是同一个脚本，只是数据库由 runner 的 service 容器提供。

运维脚本：

```bash
bash scripts/deploy.sh <image-tag>   # 拉镜像 → 迁移 → 起服务 → 等 /ready → 失败回滚
bash scripts/backup.sh               # pg_dump -Fc
bash scripts/restore.sh <dump>       # 恢复
```

---

## 部署

`Dockerfile` 有两个可部署 target：

- `api`：Fastify 运行镜像；迁移、demo 建号、检索体检都复用这个镜像。
- `web`：构建静态前端，交给 nginx。

`compose.prod.yml` 编排 `db / api / web / caddy`，另有 `migrate`、`demo-seed`、`rag-doctor` 三个 `tools` profile 的一次性服务，按需 `run --rm` 执行；只有 Caddy 对外发布端口，db / api / web 留在内部网络。

```bash
cp deploy/.env.production.example deploy/.env.production
# 填 POSTGRES_PASSWORD、OPENAI_*、APP_SITE_ADDR 等

docker compose --env-file deploy/.env.production -f compose.prod.yml build
docker compose --env-file deploy/.env.production -f compose.prod.yml run --rm migrate
docker compose --env-file deploy/.env.production -f compose.prod.yml up -d
```

- `APP_SITE_ADDR=knowfit.example.com` 时 Caddy 自动申请 TLS；临时无域名可用 `http://:80`，并设 `COOKIE_SECURE=0`。
- 生产镜像用不可变 tag（如 `sha-<12>`）部署，回滚按 tag 切回，不依赖 `latest`。
- 已有知识库迁移：`pg_dump -Fc` 导出 → `pg_restore --no-owner --no-privileges` 导入。**先恢复数据再启动 API**；不要先 migrate 再用 `--data-only` 导入知识表，否则知识表会静默变成 0 行。
- 备份 / 恢复：`scripts/backup.sh` 产出 `backups/knowfit-*.dump`；`scripts/restore.sh` 按 dump 恢复。

---

## 项目结构

| 路径 | 放什么 |
|---|---|
| `apps/api/src/routes/` | HTTP 路由：参数校验与编排，不直接读库 |
| `apps/api/src/contracts/` | 对外响应类型与 Zod schema，不承载全文型字段 |
| `apps/api/src/services/` | 读写实现与连接池；唯一允许 import `db/schema` 的一层 |
| `apps/api/src/extraction/` | 单位换算、日期解析、动作归一、状态计算 |
| `apps/api/src/metrics/` | 容量、有效组、肌群分摊、趋势与钩子 |
| `apps/api/src/graph/` | LangGraph 图与节点 |
| `apps/api/src/assessment/` | 判定、检索、起草、闸②、引用装配 |
| `apps/api/src/kb/` | 白名单、dtk 适配、切片、闸①、动作标签、embedding、rerank |
| `apps/api/src/asr/` | faster-whisper 调用、解析、同音纠错 |
| `apps/api/src/llm/` | provider 解析、提示词、fixture、用量记录 |
| `apps/api/seed/` | 动作 / 肌群数据、知识白名单模板 |
| `apps/web/src/pages/` | 会话 / 统计 / 历史 / 我的 / 设置 |
| `apps/web/src/design-system/` | 设计令牌与组件样式 |
| `scripts/` | 闸门、端到端、部署、备份、运维 |
| `deploy/` | Caddyfile 与生产环境变量样例 |

---

## 质量保障

- **两道闸门**：`pnpm verify` 做类型、lint、测试；`bash scripts/check-dev.sh` 做端到端真跑。两者都必须过。
- **离线可验证**：LLM、embedding、rerank、ASR、采集都有 fake provider；CI 不需要任何密钥，也不联网。
- **黄金用例**：容量与有效组数的期望值是手算的，不是另一个实现的输出；对不上就当场失败。
- **响应泄漏断言**：运行期把知识片全文切成 60 字窗口建哈希，递归扫描 API 返回的 JSON；命中即 500。契约层另有字段名约束，路由层禁止直接 import schema。
- **评测脚手架**：`apps/api/evals/` 下有 claim-type、RAG、检索、turn-cost 四组 promptfoo / 脚本评测；用你自己的数据即可复现。
- **成本可观测**：每轮记录 LLM、embedding、rerank 的用量；`turn-cost` 评测按轮汇总，便于对比模型与检索参数。
- **安全默认值**：会话 Cookie、按路由限流、开放注册、API 安全响应头、知识平台授权；敏感密钥只从环境变量注入，不进镜像。

---

## 参与贡献

欢迎开 issue 与提交 PR。开始之前：

1. 先跑 `pnpm verify` 和 `bash scripts/check-dev.sh`，确认改动没有破坏现有链路。
2. 一次只做一件事；无关文件不要顺手改。
3. 不提交密钥、`.env`、生产环境变量或 demo 凭据。
4. 提交信息按 scope 分线：`feat(web):` / `fix(api):` / `chore(harness):` / `docs:`。

如果发现安全问题，请先开 issue 描述影响范围，不要贴出密钥或可直接利用的细节。

---

## 致谢

- [dtk（Douyin_TikTok_Download_API）](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)：自托管的抖音 / TikTok / B 站数据采集与解析服务，本项目的平台解析上游。
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)：本地语音转写。
- [pgvector](https://github.com/pgvector/pgvector)：PostgreSQL 向量检索与 HNSW 索引。
- [LangGraph JS](https://github.com/langchain-ai/langgraphjs)：对话与任务编排。
- [Fastify](https://fastify.dev/)、[React](https://react.dev/)、[Vite](https://vite.dev/)、[Drizzle ORM](https://orm.drizzle.team/)、[Caddy](https://caddyserver.com/)：服务端、前端与部署基础设施。
- [body-muscles](https://github.com/vulovix/body-muscles)：热力图人体解剖路径数据。
- 思源黑体：界面中文字体，按 SIL Open Font License 1.1 使用。

第三方组件的完整清单与许可证见 [NOTICE](NOTICE)。

---

## 许可

代码以 MIT 许可发布，见 [LICENSE](LICENSE)。第三方组件遵循各自许可证。
