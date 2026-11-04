import { END, START, StateGraph } from '@langchain/langgraph';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AssessmentCardSchema, type AssessmentCard } from '../contracts/assessment.js';
import { VolumeHookSchema } from '../contracts/metrics.js';
import {
  DraftSchema,
  assembleCitations,
  renderAdvice,
  sanitizeNoSourceAdvice,
  toAdviceClaims,
} from '../assessment/advice.js';
import { draftAdvice } from '../assessment/draft.js';
import { GateCheckSchema, type GateCheck, type GateClaim } from '../assessment/gate.js';
import { NO_SOURCE_SYSTEM, noSourceInput } from '../assessment/prompts.js';
import { verifyClaims } from '../assessment/verify.js';
import { buildQuery } from '../assessment/query.js';
import type { AssessmentRepo } from '../assessment/repo.js';
import { ragConfig, type NoSourceReason, type PipelineMeta } from '../assessment/types.js';
import type { LlmClient } from '../llm/client.js';

/**
 * 评估子图 —— 独立、可单测，只依赖注入的接口。
 *
 * 🔴 引用是凭证，不是摘要：闸② 说支撑不算数，还要过确定性校验（逐字子串 / 长度 / 数字）。
 *    核验不过就整条降级为无源，绝不硬挂一个错的链接。
 *
 * `candidates` 里带 `chunk_text`（检索与闸② 必须读全文）——
 * **出图前一律丢掉**：它只在本状态里活，不是对外契约。
 */

export const NO_SOURCE_NOTICE = '这条没有找到可靠的博主依据';
export const RETRIEVAL_FAILURE_NOTICE = '这次没连上知识库，先给你一条通用建议';
export const GENERATION_FAILURE_NOTICE = '评估暂时没生成出来，稍后再试';
export const NO_RECORD_NOTICE = '还没有可评估的训练记录';
export const NOT_FOUND_NOTICE = '没有这条训练记录';

const CandidateStateSchema = z.object({
  chunk_id: z.string(),
  source_id: z.string(),
  creator: z.string(),
  title: z.string(),
  url: z.string(),
  start_ts: z.number(),
  chunk_text: z.string(),
  windows: z
    .array(z.object({ index: z.number(), start: z.number(), end: z.number(), text: z.string() }))
    .default([]),
  context_prefix: z.string(),
  similarity: z.number(),
  rerank_score: z.number(),
});

const SessionStateSchema = z.object({
  session_id: z.string(),
  session_date: z.string(),
  split_label: z.string().nullable(),
});

const PipelineMetaSchema = z.object({
  embedding_model: z.string(),
  rerank_model: z.string(),
  rerank_degraded: z.boolean(),
  max_per_source: z.number().int().optional(),
  rerank_fetch_n: z.number().int().optional(),
  distinct_sources: z.number().int().optional(),
  backfilled: z.number().int().optional(),
  rerank_error: z.string().optional(),
  no_source_reason: z
    .enum([
      'no_candidate',
      'gate2_reject',
      'retrieval_error',
      'generator_no_source_claim',
      'draft_invalid',
      'generation_failed',
    ])
    .nullable(),
});

const EMPTY_META: PipelineMeta = {
  embedding_model: '',
  rerank_model: '',
  rerank_degraded: false,
  no_source_reason: null,
};

export const AssessmentState = z.object({
  user_id: z.string(),
  related_record_id: z.string().nullable().default(null),
  trigger: z.enum(['explicit', 'hook']).default('explicit'),

  lookup_status: z.enum(['ok', 'none', 'not_found', 'insufficient']).default('ok'),
  missing: z.array(z.string()).default([]),
  session: SessionStateSchema.nullable().default(null),
  target: z
    .object({
      session_id: z.string(),
      session_date: z.string(),
      split_label: z.string().nullable(),
      goal: z.string().nullable(),
      body_parts: z.array(z.string()).default([]),
      verdict: VolumeHookSchema,
    })
    .nullable()
    .default(null),

  query: z.string().default(''),
  query_source: z.enum(['template', 'llm', 'fallback']).default('fallback'),

  candidates: z.array(CandidateStateSchema).default([]),
  retrieval_failed: z.boolean().default(false),
  meta: PipelineMetaSchema.default(EMPTY_META),

  draft: DraftSchema.nullable().default(null),
  draft_problem: z.string().nullable().default(null),
  checks: z.array(GateCheckSchema).default([]),
  citation_problem: z.string().nullable().default(null),

  card: AssessmentCardSchema.nullable().default(null),
  notices: z.array(z.string()).default([]),
  failure: z.string().nullable().default(null),
});

export type AssessmentStateValue = z.infer<typeof AssessmentState>;

export interface AssessmentDeps {
  llm: LlmClient;
  repo: AssessmentRepo;
  now?: () => Date;
}

function missingNotice(missing: string[]): string {
  const parts: string[] = [];
  if (missing.includes('sets')) parts.push('这次还没有有效组');
  if (missing.includes('split_label')) parts.push('这次没标 split（推日 / 背日）');
  if (missing.includes('baseline')) parts.push('这是第一次练这个 split，还没有可对比的上一次');
  return parts.length > 0 ? `先补上：${parts.join('；')}。` : '这次的数据还不够判断趋势。';
}

/** 评估建议保持 1–2 条来源：知识路径放宽到 3，评估不跟着变长文 */
export function assessmentCitationCap(maxCitations: number): number {
  return Math.min(2, maxCitations);
}

export function buildAssessmentGraph(deps: AssessmentDeps) {
  const cfg = ragConfig();
  const assessmentMaxCitations = assessmentCitationCap(cfg.maxCitations);

  return (
    new StateGraph(AssessmentState)
      .addNode('load_target', async (state) => {
        const found = await deps.repo.resolveSession({
          user_id: state.user_id,
          related_record_id: state.related_record_id,
        });
        if (found.status !== 'ok') return { lookup_status: found.status };
        return { lookup_status: 'ok' as const, session: found.session };
      })

      .addNode('compute_metrics', async (state) => {
        if (!state.session) return { lookup_status: 'none' as const };
        const out = await deps.repo.computeTarget({ user_id: state.user_id, session: state.session });
        if (out.status !== 'ok') return { lookup_status: 'insufficient' as const, missing: out.missing };
        return { lookup_status: 'ok' as const, target: out.target };
      })

      .addNode('build_query', async (state) => {
        const target = state.target!;
        const built = await buildQuery(target.verdict, target.goal, deps.llm, target.body_parts);
        return { query: built.query, query_source: built.source };
      })

      .addNode('retrieve', async (state) => {
        const out = await deps.repo.retrieve({ user_id: state.user_id, query: state.query });
        if (out.status === 'error') {
          return { retrieval_failed: true, candidates: [], meta: { ...out.meta, no_source_reason: null } };
        }
        return { candidates: out.candidates, meta: { ...out.meta, no_source_reason: null } };
      })

      .addNode('generate_draft', async (state) => {
        const target = state.target!;
        try {
          const { draft, problem } = await draftAdvice(deps.llm, target.verdict, state.candidates);
          if (!draft || problem) {
            const reason: NoSourceReason =
              problem === 'source_count' ? 'generator_no_source_claim' : 'draft_invalid';
            return { draft: null, draft_problem: problem, meta: { ...state.meta, no_source_reason: reason } };
          }
          return { draft, draft_problem: null };
        } catch {
          return { failure: GENERATION_FAILURE_NOTICE };
        }
      })

      .addNode('verify_citation', async (state) => {
        const draft = state.draft!;
        const verdict = state.target!.verdict;

        const claims: GateClaim[] = [];
        for (const [i, claim] of draft.claims.entries()) {
          if (claim.basis !== 'source' || claim.source_index === null) continue;
          const candidate = state.candidates[claim.source_index];
          if (!candidate) continue;
          claims.push({
            claim_id: `C${i}`,
            claim: claim.claim,
            candidate_id: `K${claim.source_index}`,
            chunk_text: candidate.chunk_text,
            windows: candidate.windows,
          });
        }

        // 每条 claim 单独调用、并发发；失败一条也是 fail-closed
        const checks: GateCheck[] = (await verifyClaims(deps.llm, verdict, claims)).map((v) => v.check);

        const assembled = assembleCitations({
          draft,
          checks,
          candidates: state.candidates,
          maxCitations: assessmentMaxCitations,
        });
        return {
          checks,
          citation_problem: assembled.problem,
          meta: assembled.problem
            ? { ...state.meta, no_source_reason: 'gate2_reject' as const }
            : state.meta,
        };
      })

      .addNode('finalize', async (state) => {
        const draft = state.draft!;
        const target = state.target!;
        const assembled = assembleCitations({
          draft,
          checks: state.checks,
          candidates: state.candidates,
          maxCitations: assessmentMaxCitations,
        });
        if (assembled.problem) return { failure: GENERATION_FAILURE_NOTICE };

        const { plans } = assembled;
        const citationIds = plans.map(() => randomUUID());
        const claimCitationIds: (string | null)[] = draft.claims.map(() => null);
        plans.forEach((plan, i) => {
          claimCitationIds[plan.claim_index] = citationIds[i]!;
        });
        const adviceClaims = toAdviceClaims(draft, claimCitationIds);
        const advice = renderAdvice(draft);

        let assessmentId: string;
        try {
          const persisted = await deps.repo.persist({
            user_id: state.user_id,
            trigger: state.trigger,
            related_record_id: target.session_id,
            verdict: target.verdict,
            advice_text: advice,
            advice_claims: adviceClaims,
            has_source: true,
            citations: plans.map((plan, i) => ({
              citation_id: citationIds[i]!,
              claim_index: plan.claim_index,
              chunk_id: plan.candidate.chunk_id,
              url_with_ts: plan.candidate.url,
              quote_start: plan.quote_start,
              quote_end: plan.quote_end,
            })),
            model_version: deps.llm.model ?? 'unknown',
            judge_model_version: deps.llm.model ?? 'unknown',
            pipeline_meta: state.meta,
          });
          assessmentId = persisted.assessment_id;
        } catch {
          return { failure: GENERATION_FAILURE_NOTICE };
        }

        const card: AssessmentCard = {
          kind: 'assessment',
          assessment_id: assessmentId,
          trigger: state.trigger,
          verdict: target.verdict,
          advice,
          advice_claims: adviceClaims,
          has_source: true,
          citations: plans.map((plan, i) => ({
            citation_id: citationIds[i]!,
            creator: plan.candidate.creator,
            title: plan.candidate.title,
            url: plan.candidate.url,
            start_ts: plan.candidate.start_ts,
            short_quote: plan.candidate.chunk_text.slice(plan.quote_start, plan.quote_end),
          })),
          no_source_notice: null,
        };
        return { card };
      })

      .addNode('generate_no_source', async (state) => {
        const target = state.target!;
        const reason: NoSourceReason = state.retrieval_failed
          ? 'retrieval_error'
          : (state.meta.no_source_reason ?? 'no_candidate');

        let advice: string;
        try {
          const raw = await deps.llm.generate({ system: NO_SOURCE_SYSTEM, input: noSourceInput(target.verdict) });
          advice = sanitizeNoSourceAdvice(raw, target.verdict);
        } catch {
          return { failure: GENERATION_FAILURE_NOTICE };
        }

        const meta: PipelineMeta = { ...state.meta, no_source_reason: reason };
        const notice = reason === 'retrieval_error' ? RETRIEVAL_FAILURE_NOTICE : NO_SOURCE_NOTICE;

        let assessmentId: string;
        try {
          const persisted = await deps.repo.persist({
            user_id: state.user_id,
            trigger: state.trigger,
            related_record_id: target.session_id,
            verdict: target.verdict,
            advice_text: advice,
            advice_claims: [],
            has_source: false,
            citations: [],
            model_version: deps.llm.model ?? 'unknown',
            judge_model_version: deps.llm.model ?? 'unknown',
            pipeline_meta: meta,
          });
          assessmentId = persisted.assessment_id;
        } catch {
          return { failure: GENERATION_FAILURE_NOTICE };
        }

        const card: AssessmentCard = {
          kind: 'assessment',
          assessment_id: assessmentId,
          trigger: state.trigger,
          verdict: target.verdict,
          advice,
          advice_claims: [],
          has_source: false,
          citations: [],
          no_source_notice: notice,
        };
        return { card, meta };
      })

      .addNode('generation_failure', async (state) => ({
        card: null,
        notices: [state.failure ?? GENERATION_FAILURE_NOTICE],
      }))

      .addNode('finish_empty', async (state) => {
        if (state.lookup_status === 'not_found') return { notices: [NOT_FOUND_NOTICE] };
        if (state.lookup_status === 'insufficient') return { notices: [missingNotice(state.missing)] };
        return { notices: [NO_RECORD_NOTICE] };
      })

      .addEdge(START, 'load_target')
      .addConditionalEdges('load_target', (state) =>
        state.lookup_status === 'ok' ? 'compute_metrics' : 'finish_empty',
      )
      .addConditionalEdges('compute_metrics', (state) =>
        state.lookup_status === 'ok' && state.target ? 'build_query' : 'finish_empty',
      )
      .addEdge('build_query', 'retrieve')
      .addConditionalEdges('retrieve', (state) =>
        !state.retrieval_failed && state.candidates.length > 0 ? 'generate_draft' : 'generate_no_source',
      )
      .addConditionalEdges('generate_draft', (state) => {
        if (state.failure) return 'generation_failure';
        return state.draft ? 'verify_citation' : 'generate_no_source';
      })
      .addConditionalEdges('verify_citation', (state) =>
        state.citation_problem ? 'generate_no_source' : 'finalize',
      )
      .addConditionalEdges('finalize', (state) => (state.failure ? 'generation_failure' : END))
      .addConditionalEdges('generate_no_source', (state) => (state.failure ? 'generation_failure' : END))
      .addEdge('generation_failure', END)
      .addEdge('finish_empty', END)
      .compile()
  );
}

export type AssessmentGraph = ReturnType<typeof buildAssessmentGraph>;
