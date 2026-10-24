#!/usr/bin/env node
/**
 * 真实检索链路的本地观测 —— 只读，不落库、不改库。
 *
 * 走的是真库 + 真模型（作者本机）：最近一次训练 → 判定 → query → 召回 → 重排
 * → 起草 → 闸②。把每一步的中间结果打出来，用来判断「召回准不准 / 引用贴不贴切」。
 *
 * 🔴 替身模式也能跑（不配 key），但那时它只证明管道通 —— 相关性只能看真实模型。
 *
 * 用法： pnpm rag:smoke
 *        EMBEDDING_PROVIDER=real RERANK_PROVIDER=real LLM_PROVIDER=openai pnpm rag:smoke
 */
import { assembleCitations, DraftSchema, renderAdvice, validateDraft } from '../assessment/advice.js';
import { GateBatchSchema, checkGateResult, type GateCheck, type GateClaim } from '../assessment/gate.js';
import { DRAFT_SYSTEM, GATE_SYSTEM, draftInput, gateInput } from '../assessment/prompts.js';
import { buildQuery } from '../assessment/query.js';
import { ragConfig } from '../assessment/types.js';
import { SINGLE_USER_ID } from '../graph/state.js';
import { resolveEmbeddingProvider, createEmbeddingClient } from '../kb/embedding.js';
import { createRerankClient, resolveRerankProvider } from '../kb/rerank.js';
import { createLlmClient } from '../llm/index.js';
import { buildVolumeHook } from '../metrics/hook.js';
import { createAssessmentRepo } from '../services/assessment.js';
import type { VolumeHook } from '../contracts/metrics.js';

const USER = SINGLE_USER_ID;
const EXCERPT = 60;

const ms = (t: number) => `${Date.now() - t}ms`;
const line = (label: string, value: string) => console.log(`  ${label.padEnd(12)}${value}`);

console.log('\n=== know-fit 检索链路观测（只读）===\n');
line('embedding', resolveEmbeddingProvider());
line('rerank', resolveRerankProvider());
line('llm', process.env.LLM_PROVIDER || 'fake');
const cfg = ragConfig();
line('参数', `topK=${cfg.topK} topN=${cfg.topN} 相似度≥${cfg.minSimilarity} 引用≤${cfg.maxCitations}`);

const llm = createLlmClient();
const repo = createAssessmentRepo({
  embedder: createEmbeddingClient(),
  reranker: createRerankClient(),
});

const session = await repo.resolveSession({ user_id: USER, related_record_id: null });
const computed =
  session.status === 'ok' ? await repo.computeTarget({ user_id: USER, session: session.session }) : null;

// 干净克隆里还没有训练记录 —— 用一个明示的合成判定把管道跑通，不假装是真数据
let verdict: VolumeHook;
let goal: string | null;
let synthetic = false;
if (computed?.status === 'ok') {
  verdict = computed.target.verdict;
  goal = computed.target.goal;
} else {
  synthetic = true;
  verdict = buildVolumeHook({ current: 2000, baseline: 2500, split_label: '推日' });
  goal = null;
  console.log('\n⚠️ 没有可用的最近训练，下面用**合成判定**演示管道（不是你的数据）。');
  if (computed?.status === 'insufficient') console.log(`   最近这次训练缺：${computed.missing.join('、')}`);
}
console.log(`\n── 1. 判定 ──`);
line('训练', `${verdict.scope.split_label ?? '（无 split）'} ${verdict.current}kg`);
line('基线', verdict.baseline === null ? '无' : `${verdict.baseline}kg`);
line('变化', verdict.delta_pct === null ? '无' : `${verdict.delta_pct}%`);
line('目标', goal ?? (synthetic ? '（合成判定）' : '（档案没填）'));

const t1 = Date.now();
const built = await buildQuery(verdict, goal, llm);
console.log(`\n── 2. query（${built.source}，${ms(t1)}）──`);
line('', built.query);

const t2 = Date.now();
const retrieved = await repo.retrieve({ user_id: USER, query: built.query });
if (retrieved.status === 'error') {
  console.error(`\n检索失败：${retrieved.message}\n`);
  process.exit(1);
}
console.log(`\n── 3. 召回 ${retrieved.candidates.length} 条（${ms(t2)}）──`);
line('模型', `${retrieved.meta.embedding_model} / ${retrieved.meta.rerank_model}${retrieved.meta.rerank_degraded ? '（重排降级）' : ''}`);
retrieved.candidates.forEach((c, i) => {
  const excerpt = c.chunk_text.replace(/\s+/g, ' ').slice(0, EXCERPT);
  console.log(`  K${i}  sim=${c.similarity.toFixed(3)} rerank=${c.rerank_score.toFixed(3)}  ${c.creator} · ${c.title}`);
  console.log(`      ${excerpt}${c.chunk_text.length > EXCERPT ? '…' : ''}`);
});

if (retrieved.candidates.length === 0) {
  console.log('\n没有过门槛的候选 —— 真实路径会降级为无源。\n');
  process.exit(0);
}

const t3 = Date.now();
const draft = await llm.structured({
  system: DRAFT_SYSTEM,
  input: draftInput(verdict, retrieved.candidates),
  schema: DraftSchema,
  name: 'draft_advice',
});
console.log(`\n── 4. 起草（${ms(t3)}，校验：${validateDraft(draft, retrieved.candidates) ?? '通过'}）──`);
draft.claims.forEach((c, i) => line(`C${i} [${c.basis}]`, c.claim));

const claims: GateClaim[] = draft.claims.flatMap((c, i) => {
  if (c.basis !== 'source' || c.source_index === null) return [];
  const candidate = retrieved.candidates[c.source_index];
  if (!candidate) return [];
  return [{ claim_id: `C${i}`, claim: c.claim, candidate_id: `K${c.source_index}`, chunk_text: candidate.chunk_text }];
});

let checks: GateCheck[] = [];
if (claims.length > 0) {
  const t4 = Date.now();
  try {
    const out = await llm.structured({
      system: GATE_SYSTEM,
      input: gateInput(verdict, claims),
      schema: GateBatchSchema,
      name: 'verify_citation',
    });
    const byId = new Map(out.results.map((r) => [r.claim_id, r]));
    checks = claims.map((claim) =>
      checkGateResult({
        result:
          byId.get(claim.claim_id) ?? {
            claim_id: claim.claim_id,
            candidate_id: claim.candidate_id,
            supported: false,
            supporting_quote: '',
            reason: '闸② 没给出结果',
          },
        claim,
        verdict,
      }),
    );
    console.log(`\n── 5. 闸②（${ms(t4)}）──`);
    for (const c of checks) {
      line(`${c.claim_id} ${c.supported ? '✓' : '✗'}`, c.reason);
      if (c.quote) line('', `「${c.quote}」 [${c.quote_start}, ${c.quote_end})`);
    }
  } catch (e) {
    console.log(`\n── 5. 闸② 失败（fail-closed）：${(e as Error).message} ──`);
  }
}

const assembled = assembleCitations({
  draft,
  checks,
  candidates: retrieved.candidates,
  maxCitations: cfg.maxCitations,
});
console.log('\n── 6. 结论 ──');
if (assembled.problem) {
  line('', `${assembled.problem} —— 真实路径会整条降级为无源`);
} else {
  line('建议', renderAdvice(draft).replace(/\n/g, ' / '));
  for (const plan of assembled.plans) {
    const quote = plan.candidate.chunk_text.slice(plan.quote_start, plan.quote_end);
    line('引用', `${plan.candidate.creator}「${quote}」`);
  }
}
console.log('');
