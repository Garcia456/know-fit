# RAG pilot（20 条）—— 流程与现状

> 本目录是 **dev-005 §3.1 D** 的评测位。评测层**不进** `check-dev.sh` / CI（ADR-025 / ADR-032）。

## 现状：**未开跑**

替身管线（`pnpm verify` + `check-dev.sh`）已全绿，但 pilot 需要**作者本人**：

1. 填 20 条个人数据状态 → 生成 query；
2. 标注每条期望命中的来源；
3. 逐条复核引用是否真支撑；
4. A/B 盲评 RAG vs 裸 LLM。

在这些完成前，**不得**报 hit@5 / 无源率 / 来源可用率 / 胜率。

## 三步

```bash
# ① 填 states.jsonl（先复制模板，20 行）
cp evals/rag/states.template.jsonl evals/rag/states.jsonl

# ② 状态 → query（模板优先，未命中走真实 LLM 兜底）
pnpm rag:eval:queries

# ③ 作者在 queries.jsonl 里标 expected_source_ids 与 author_reviewed=true
#    再跑评测（检索 → 起草 → 闸② → 引用），产出逐条报告
pnpm rag:eval
```

## 标注口径

- `expected_source_ids`：这条 query **应该**命中的 `knowledge_source.id`。
  可以先跑一次 `pnpm rag:eval` 看候选，再把「真讲了这个内容」的源 id 填回去。
  留空 = 未标注，不计入 hit@5。
- 来源可用率：逐条看 `report-*.md` 里 A 侧的 `short_quote` 与 source claim，
  标「真实讲了 / 没讲 / 讲的是另一回事」；目标 ≥95%。
- A/B：`ab-*.jsonl` 里 A/B 顺序随机、映射在 `ab-key-*.json`（评审时别看）。

## 偏差声明（必须写进报告）

评审者是作者本人，也是产品负责人；20 条来自同一人的训练数据。
结果按**强假设**使用，不当作已验证的结论；样本量与评审者单一都会放大确认偏差。

## 已知边界

- 评测只验「这条 query 下检索与引用是否成立」，不验弱网 / 并发。
- 真实 rerank（`qwen3-rerank`）与真实 embedding 需要作者本机 key；替身只证管道。
- 闸③（定期复核引用是否仍成立）不在 v1，评测不覆盖。
