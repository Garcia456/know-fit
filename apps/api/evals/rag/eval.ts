#!/usr/bin/env node
/**
 * 20 条 pilot 的逐条评测 —— 检索 → 起草 → 闸② → 引用，不落库。
 *
 * 输入：evals/rag/queries.jsonl（expected_source_ids / author_reviewed 已由作者填）
 * 输出：
 *   results-*.jsonl   逐条结果（机器可读）
 *   report-*.md       逐条表格 + 汇总（hit@5 / 无源率 / 闸② 拒绝 / 耗时）
 *   ab-*.jsonl        A/B 盲评材料（顺序随机，不带标签）
 *   ab-key-*.json     A/B 映射（评审时别看）
 *
 * 🔴 评测层不进 check-dev / CI。它要真实模型与作者标注，不是「管道通」。
 *
 * 用法：pnpm rag:eval
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { assembleCitations, renderAdvice } from '../../src/assessment/advice.js';
import { draftAdvice } from '../../src/assessment/draft.js';
import { GATE_QUOTE_MAX, type GateCheck, type GateClaim } from '../../src/assessment/gate.js';
import { windowSpan } from '../../src/assessment/windows.js';
import { verifyClaims } from '../../src/assessment/verify.js';
import { ragConfig } from '../../src/assessment/types.js';
import { SINGLE_USER_ID } from '../../src/graph/state.js';
import { createEmbeddingClient, resolveEmbeddingProvider } from '../../src/kb/embedding.js';
import { createRerankClient, resolveRerankProvider } from '../../src/kb/rerank.js';
import { createLlmClient, resolveProvider } from '../../src/llm/index.js';
import { buildVolumeHook } from '../../src/metrics/hook.js';
import { createAssessmentRepo } from '../../src/services/assessment.js';

interface QueryRow {
  id: string;
  state: { goal: string | null; split: string | null; current: number; baseline: number | null; note?: string };
  query: string;
  query_source: string;
  expected_source_ids: string[];
  author_reviewed: boolean;
}

interface RowResult {
  id: string;
  query: string;
  candidates: number;
  candidate_sources: string[];
  hit: boolean | null;
  gate_passed: boolean;
  has_source: boolean;
  citations: number;
  citations_detail: { claim: string; quote: string; creator: string; title: string }[];
  gate_rejects: {
    claim: string;
    reason: string;
    from_window: number | null;
    to_window: number | null;
    quote: string;
    quote_len: number;
  }[];
  no_source_reason: string | null;
  latency_ms: number;
  advice: string;
}

const USER = SINGLE_USER_ID;
const BARE_SYSTEM = [
  '你是健身教练。根据给定的训练判定与本轮目标，给一条建议。',
  '不要提任何博主、视频、出处（你没有检索）。数字只能来自判定。',
  '2–4 句，短、具体。',
].join('\n');

const dir = new URL('.', import.meta.url);
const queriesPath = new URL('queries.jsonl', dir);
if (!existsSync(queriesPath)) {
  console.error('缺 queries.jsonl —— 先跑 pnpm rag:eval:queries 并完成标注。');
  process.exit(1);
}

const rows = readFileSync(queriesPath, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l) as QueryRow);
if (rows.length !== 20) {
  console.error(`queries.jsonl 应是 20 行，现在是 ${rows.length} 行。`);
  process.exit(1);
}
const unlabeled = rows.filter((r) => !r.author_reviewed).length;
if (unlabeled > 0) {
  console.warn(`⚠️ 有 ${unlabeled} 条没标 author_reviewed=true —— 它们不进 hit@5 汇总。`);
}

// 🔴 替身管线会让 20 条全部 no_candidate、看起来像「100% 无源」—— 直接拒绝，别给假数字
if (resolveProvider() !== 'openai' || resolveEmbeddingProvider() !== 'real') {
  console.error(
    'rag:eval 需要真实端点：LLM_PROVIDER=openai EMBEDDING_PROVIDER=real RERANK_PROVIDER=real pnpm rag:eval',
  );
  process.exit(1);
}
if (resolveRerankProvider() !== 'real') {
  console.warn('⚠️ RERANK_PROVIDER 不是 real —— 本轮按向量顺序取 topN，结果不可与真实 rerank 的轮次横比。');
}

const llm = createLlmClient();
const repo = createAssessmentRepo({ embedder: createEmbeddingClient(), reranker: createRerankClient() });
const cfg = ragConfig();

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const results: RowResult[] = [];
const ab: { id: string; first: string; second: string }[] = [];
const abKey: Record<string, { 1: 'A' | 'B'; 2: 'A' | 'B' }> = {};

for (const row of rows) {
  const started = Date.now();
  const verdict = buildVolumeHook({
    current: row.state.current,
    baseline: row.state.baseline,
    split_label: row.state.split,
  });

  const retrieved = await repo.retrieve({ user_id: USER, query: row.query });
  const candidates = retrieved.status === 'ok' ? retrieved.candidates.slice(0, cfg.topN) : [];
  const candidateSources = [...new Set(candidates.map((c) => c.source_id))];
  const hit =
    row.expected_source_ids.length === 0
      ? null
      : row.expected_source_ids.some((id) => candidateSources.includes(id));

  let checks: GateCheck[] = [];
  let advice = '';
  let hasSource = false;
  let noSourceReason: string | null = null;
  let citationDetail: RowResult['citations_detail'] = [];
  let gateRejects: RowResult['gate_rejects'] = [];

  if (candidates.length > 0) {
    let drafted: Awaited<ReturnType<typeof draftAdvice>> | null = null;
    try {
      drafted = await draftAdvice(llm, verdict, candidates);
    } catch {
      // 一条 query 的解析失败不该让整轮评测挂掉
      noSourceReason = 'draft_invalid';
    }
    const draft = drafted?.draft ?? null;
    const problem = drafted?.problem ?? null;
    if (!draft || problem) {
      noSourceReason = problem === 'source_count' ? 'generator_no_source_claim' : 'draft_invalid';
    } else {
      const claims: GateClaim[] = draft.claims.flatMap((c, i) => {
        if (c.basis !== 'source' || c.source_index === null) return [];
        const candidate = candidates[c.source_index];
        if (!candidate) return [];
        return [{ claim_id: `C${i}`, claim: c.claim, candidate_id: `K${c.source_index}`, chunk_text: candidate.chunk_text, windows: candidate.windows }];
      });
      try {
        const verdicts = await verifyClaims(llm, verdict, claims);
        checks = verdicts.map((v) => v.check);
        gateRejects = verdicts
          .filter((v) => !v.check.supported)
          .map((v) => {
            const picked = v.raw ? windowSpan(v.claim.windows, v.raw.from_window) : null;
            return {
              claim: v.claim.claim,
              reason: v.check.reason,
              from_window: v.raw?.from_window ?? null,
              to_window: picked?.to_index ?? null,
              quote: picked?.text ?? '',
              quote_len: picked?.text.length ?? 0,
            };
          });
      } catch {
        noSourceReason = 'gate2_reject';
      }

      const assembled = assembleCitations({
        draft,
        checks,
        candidates,
        maxCitations: cfg.maxCitations,
      });
      if (assembled.problem) {
        noSourceReason = 'gate2_reject';
      } else {
        hasSource = true;
        advice = renderAdvice(draft);
        citationDetail = assembled.plans.map((plan) => ({
          claim: draft.claims[plan.claim_index]!.claim,
          quote: plan.candidate.chunk_text.slice(plan.quote_start, plan.quote_end),
          creator: plan.candidate.creator,
          title: plan.candidate.title,
        }));
      }
    }
  } else {
    noSourceReason = retrieved.status === 'error' ? 'retrieval_error' : 'no_candidate';
  }

  if (!hasSource) {
    advice = await llm.generate({
      system: '你是健身教练。给一条通用建议，不提任何博主或出处，数字只用判定里的。',
      input: `判定：${JSON.stringify(verdict)}`,
    });
  }

  const latency = Date.now() - started;
  results.push({
    id: row.id,
    query: row.query,
    candidates: candidates.length,
    candidate_sources: candidateSources,
    hit,
    gate_passed: checks.length > 0 && checks.every((c) => c.supported),
    has_source: hasSource,
    citations: checks.filter((c) => c.supported).length,
    citations_detail: citationDetail,
    gate_rejects: gateRejects,
    no_source_reason: noSourceReason,
    latency_ms: latency,
    advice,
  });

  // A/B：A = 完整 RAG 的建议，B = 裸 LLM；顺序随机、材料里不带标签
  const bare = await llm.generate({
    system: BARE_SYSTEM,
    input: `判定：${JSON.stringify(verdict)}\n本轮目标：${row.state.goal ?? '未填'}`,
  });
  const aFirst = Math.random() < 0.5;
  ab.push({ id: row.id, first: aFirst ? advice : bare, second: aFirst ? bare : advice });
  abKey[row.id] = aFirst ? { 1: 'A', 2: 'B' } : { 1: 'B', 2: 'A' };

  const mark = hit === null ? '—' : hit ? '✓' : '✗';
  console.log(`  ${row.id}  ${mark}  候选 ${candidates.length}  有源 ${hasSource ? '是' : '否'}  ${latency}ms`);
}

writeFileSync(new URL(`results-${stamp}.jsonl`, dir), `${results.map((r) => JSON.stringify(r)).join('\n')}\n`);
writeFileSync(new URL(`ab-${stamp}.jsonl`, dir), `${ab.map((r) => JSON.stringify(r)).join('\n')}\n`);
writeFileSync(new URL(`ab-key-${stamp}.json`, dir), JSON.stringify(abKey, null, 2));

const reviewed = new Set(rows.filter((r) => r.author_reviewed).map((r) => r.id));
const labeled = results.filter((r) => reviewed.has(r.id) && r.hit !== null);
const hitRate = labeled.length === 0 ? null : labeled.filter((r) => r.hit).length / labeled.length;
const noSourceRate = results.filter((r) => !r.has_source).length / results.length;
const gateRejects = results.filter((r) => r.no_source_reason === 'gate2_reject').length;
const allRejects = results.flatMap((r) => r.gate_rejects);
const reasons = results.reduce<Record<string, number>>((acc, r) => {
  if (r.no_source_reason) acc[r.no_source_reason] = (acc[r.no_source_reason] ?? 0) + 1;
  return acc;
}, {});
const sorted = results.map((r) => r.latency_ms).sort((a, b) => a - b);
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

const md = [
  `# RAG pilot 报告（${stamp}）`,
  '',
  '> 评审者是作者本人，也是产品负责人；样本 20 条来自同一人的训练数据。',
  '> 结果按**强假设**使用，不当作已验证的结论。',
  '',
  '## 汇总',
  '',
  `- hit@5：${hitRate === null ? '未标注' : `${(hitRate * 100).toFixed(1)}%（${labeled.filter((r) => r.hit).length}/${labeled.length}）`}`,
  `- 无源率：${(noSourceRate * 100).toFixed(1)}%（目标 ≤40%）`,
  `- 闸② 拒绝：${gateRejects} 条（编号无效 ${allRejects.filter((j) => j.quote_len === 0).length} 条 / 引文超 ${GATE_QUOTE_MAX} 字 ${allRejects.filter((j) => j.quote_len > GATE_QUOTE_MAX).length} 条）`,
  `- no-source 原因分布：${JSON.stringify(reasons)}`,
  `- 唯一 query：${new Set(results.map((r) => r.query)).size} / ${results.length}（模板优先：同 split + 同趋势会生成同一句）`,
  `- 耗时：p50 ${pct(0.5)}ms / p95 ${pct(0.95)}ms（目标 ≤10s）`,
  `- 未标注 query：${unlabeled} 条`,
  '',
  '## 逐条',
  '',
  '| id | query | 候选 | hit | 闸② | 有源 | 引用 | 耗时 | 无源原因 |',
  '|---|---|---|---|---|---|---|---|---|',
  ...results.map(
    (r) =>
      `| ${r.id} | ${r.query} | ${r.candidates} | ${r.hit === null ? '—' : r.hit ? '✓' : '✗'} | ${r.gate_passed ? '✓' : '✗'} | ${r.has_source ? '✓' : '✗'} | ${r.citations} | ${r.latency_ms}ms | ${r.no_source_reason ?? '—'} |`,
  ),
  '',
  '## 闸② 拒绝明细（判得对不对，看这里）',
  '',
  ...results.flatMap((r) =>
    r.gate_rejects.map(
      (j) =>
        `- ${r.id}：${j.claim} —— ${j.reason}（窗口 ${j.from_window ?? '—'}–${j.to_window ?? '—'} / ${j.quote_len} 字）\n  - 原始 quote：${j.quote || '（无）'}`,
    ),
  ),
  '',
  '## 逐条引用（来源可用率复核 —— 每条标「真实讲了 / 没讲 / 另一回事」）',
  '',
  ...results.flatMap((r) =>
    r.citations_detail.length === 0
      ? []
      : [
          `### ${r.id} · ${r.query}`,
          '',
          `建议：${r.advice.replace(/\n/g, ' / ')}`,
          '',
          ...r.citations_detail.flatMap((c) => [
            `- claim：${c.claim}`,
            `  - 引用：${c.creator}「${c.quote}」`,
          ]),
          '',
        ],
  ),
  '## 下一步（作者）',
  '',
  `1. 逐条看 \`results-${stamp}.jsonl\` 里的引用句与 advice，标「真实讲了 / 没讲 / 另一回事」；`,
  `2. 盲评 \`ab-${stamp}.jsonl\`（每条在 \`winner\` 填 1 / 2 / tie），映射见 \`ab-key-${stamp}.json\`（评审时别看）；`,
  '3. 把来源可用率、胜率与偏差声明补进本文件。',
  '',
].join('\n');

writeFileSync(new URL(`report-${stamp}.md`, dir), md);
console.log(`\n结果：hit@5 ${hitRate === null ? '未标注' : `${(hitRate * 100).toFixed(1)}%`}；无源率 ${(noSourceRate * 100).toFixed(1)}%；p50 ${pct(0.5)}ms / p95 ${pct(0.95)}ms`);
console.log(`报告：apps/api/evals/rag/report-${stamp}.md`);
