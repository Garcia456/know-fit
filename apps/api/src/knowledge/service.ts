import type { AssessmentCandidate } from '../assessment/types.js';
import type { Citation } from '../contracts/assessment.js';
import type { KnowledgeCard, KnowledgeClaim } from '../contracts/turn.js';
import { ragConfig } from '../assessment/types.js';
import { verifyClaims } from '../assessment/verify.js';
import type { RetrieveResult } from '../assessment/repo.js';
import { bindSignal, type LlmClient } from '../llm/client.js';
import { rethrowIfLlmConfig } from '../llm/errors.js';
import { createLlmClient } from '../llm/index.js';
import type { UsageRecorder } from '../llm/usage.js';
import { createEmbeddingClient } from '../kb/embedding.js';
import { createRerankClient } from '../kb/rerank.js';
import { createAssessmentRepo, retrieveKnowledge, withDeadline, ASSESSMENT_DEADLINE_MS } from '../services/assessment.js';
import { draftKnowledge } from './draft.js';
import { assembleKnowledge } from './assemble.js';
import { KNOWLEDGE_NO_SOURCE_SYSTEM, knowledgeNoSourceInput } from './prompts.js';

/**
 * 知识问答 —— 检索、闸②、组装卡片。
 *
 * 有源：每条 claim 都过闸②，引用由服务端按窗口切出；
 * 不过闸② / 同源的 claim 只丢自己，一条不剩才整卡降级（ADR-068）。
 * 无源 / 失败：通用回答 + 显式标注，绝不暗示有来源。
 */

export const KNOWLEDGE_NO_SOURCE_NOTICE = '这条没有找到可靠的博主依据';
export const KNOWLEDGE_RETRIEVAL_FAILURE_NOTICE = '这次没连上知识库，先给你一条通用回答';
export const KNOWLEDGE_DISABLED_NOTICE = '知识库未开启';
export const KNOWLEDGE_DISABLED_ANSWER =
  '知识库还没开启 —— 到「我的 → 知识库」填入邀请码后，就能按博主原片回答。';

const FALLBACK_ANSWER = '先按通用原则：动作做标准、重量循序渐进，感觉不对就减重。';
const SOURCE_HINT = /博主|up主|UP主|视频里说|视频里讲/;

export interface KnowledgeInput {
  user_id: string;
  query: string;
  /** 用量打点；不传就不打点（线上链路开销为零） */
  usage?: UsageRecorder;
  /** 本次请求用的模型客户端；不传就按服务端配置新建一个 */
  llm?: LlmClient;
}

/**
 * 与 `retrieveKnowledge` 同一条检索链路，只是把 usage 记录器接进两个客户端。
 * 不传记录器时仍然走 `retrieveKnowledge` —— 线上不重复造一份。
 */
function retrieveWithUsage(input: KnowledgeInput): Promise<RetrieveResult> {
  if (!input.usage) return retrieveKnowledge({ user_id: input.user_id, query: input.query });
  return createAssessmentRepo({
    embedder: createEmbeddingClient(undefined, { usage: input.usage }),
    reranker: createRerankClient(undefined, { usage: input.usage }),
  }).retrieve({ user_id: input.user_id, query: input.query });
}

function noSourceCard(answer: string, notice: string, knowledgeDisabled = false): KnowledgeCard {
  return {
    kind: 'knowledge',
    answer,
    claims: [],
    citations: [],
    has_source: false,
    no_source_notice: notice,
    knowledge_disabled: knowledgeDisabled,
  };
}

async function generalAnswer(llm: LlmClient, query: string): Promise<string> {
  try {
    const text = (await llm.generate({
      system: KNOWLEDGE_NO_SOURCE_SYSTEM,
      input: knowledgeNoSourceInput(query),
    })).trim();
    if (text.length === 0 || SOURCE_HINT.test(text)) return FALLBACK_ANSWER;
    return text;
  } catch (e) {
    rethrowIfLlmConfig(e);
    return FALLBACK_ANSWER;
  }
}

function assemble(
  claims: { claim: string; source_index: number | null }[],
  checks: { supported: boolean; quote: string; quote_start: number | null; quote_end: number | null }[],
  candidates: AssessmentCandidate[],
): { knowledgeClaims: KnowledgeClaim[]; citations: Citation[] } | null {
  return assembleKnowledge({
    claims,
    checks,
    candidates,
    maxCitations: ragConfig().maxCitations,
  });
}

export async function answerKnowledge(input: KnowledgeInput): Promise<KnowledgeCard> {
  try {
    return await withDeadline(ASSESSMENT_DEADLINE_MS, (signal) =>
      run(input, bindSignal(input.llm ?? createLlmClient(undefined, { usage: input.usage }), signal)),
    );
  } catch (e) {
    rethrowIfLlmConfig(e);
    return noSourceCard(FALLBACK_ANSWER, KNOWLEDGE_RETRIEVAL_FAILURE_NOTICE);
  }
}

async function run(input: KnowledgeInput, llm: LlmClient): Promise<KnowledgeCard> {
  let retrieved: RetrieveResult;
  try {
    retrieved = await retrieveWithUsage(input);
  } catch {
    return noSourceCard(await generalAnswer(llm, input.query), KNOWLEDGE_RETRIEVAL_FAILURE_NOTICE);
  }
  if (retrieved.status === 'error') {
    return noSourceCard(await generalAnswer(llm, input.query), KNOWLEDGE_RETRIEVAL_FAILURE_NOTICE);
  }
  // 没有授权平台 ≠ 库是空的：直接说清楚怎么开启，不消耗模型调用
  if (retrieved.meta.knowledge_disabled) {
    return noSourceCard(KNOWLEDGE_DISABLED_ANSWER, KNOWLEDGE_DISABLED_NOTICE, true);
  }

  const candidates = retrieved.candidates;
  if (candidates.length === 0) {
    return noSourceCard(await generalAnswer(llm, input.query), KNOWLEDGE_NO_SOURCE_NOTICE);
  }

  const { draft } = await draftKnowledge(llm, input.query, candidates);
  if (!draft) {
    return noSourceCard(await generalAnswer(llm, input.query), KNOWLEDGE_NO_SOURCE_NOTICE);
  }

  // 起草时的 source_index 已换回候选全集下标；校验层保证非 null（防御性再滤一次）
  const sourced = draft.claims.flatMap((c) =>
    c.source_index === null ? [] : [{ claim: c.claim, source_index: c.source_index }],
  );
  const gateClaims = sourced.map((claim, i) => {
    const candidate = candidates[claim.source_index]!;
    return {
      claim_id: `C${i}`,
      claim: claim.claim,
      candidate_id: `K${claim.source_index}`,
      chunk_text: candidate.chunk_text,
      windows: candidate.windows,
    };
  });
  const checks = await verifyClaims(llm, null, gateClaims);
  // 按下标回填闸② 结果 —— verifyClaims 与输入同序，缺位按不支撑（fail-closed）
  const assembled = assemble(
    sourced,
    gateClaims.map((_, i) => checks[i]?.check ?? { supported: false, quote: '', quote_start: null, quote_end: null }),
    candidates,
  );
  if (!assembled) {
    return noSourceCard(await generalAnswer(llm, input.query), KNOWLEDGE_NO_SOURCE_NOTICE);
  }

  return {
    kind: 'knowledge',
    answer: assembled.knowledgeClaims.map((c) => c.claim).join('\n'),
    claims: assembled.knowledgeClaims,
    citations: assembled.citations,
    has_source: true,
    no_source_notice: null,
    knowledge_disabled: false,
  };
}