import { randomUUID } from 'node:crypto';
import type { Citation } from '../contracts/assessment.js';
import type { KnowledgeCard, KnowledgeClaim } from '../contracts/turn.js';
import type { AssessmentCandidate } from '../assessment/types.js';
import { ragConfig } from '../assessment/types.js';
import { verifyClaims } from '../assessment/verify.js';
import type { RetrieveResult } from '../assessment/repo.js';
import { bindSignal, type LlmClient } from '../llm/client.js';
import { createLlmClient } from '../llm/index.js';
import { retrieveKnowledge, withDeadline, ASSESSMENT_DEADLINE_MS } from '../services/assessment.js';
import { draftKnowledge } from './draft.js';
import { KNOWLEDGE_NO_SOURCE_SYSTEM, knowledgeNoSourceInput } from './prompts.js';

/**
 * 知识问答 —— 检索、闸②、组装卡片。
 *
 * 有源：每条 claim 都过闸②，引用由服务端按窗口切出。
 * 无源 / 失败：通用回答 + 显式标注，绝不暗示有来源。
 */

export const KNOWLEDGE_NO_SOURCE_NOTICE = '这条没有找到可靠的博主依据';
export const KNOWLEDGE_RETRIEVAL_FAILURE_NOTICE = '这次没连上知识库，先给你一条通用回答';

const FALLBACK_ANSWER = '先按通用原则：动作做标准、重量循序渐进，感觉不对就减重。';
const SOURCE_HINT = /博主|up主|UP主|视频里说|视频里讲/;

export interface KnowledgeInput {
  user_id: string;
  query: string;
}

function noSourceCard(answer: string, notice: string): KnowledgeCard {
  return {
    kind: 'knowledge',
    answer,
    claims: [],
    citations: [],
    has_source: false,
    no_source_notice: notice,
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
  } catch {
    return FALLBACK_ANSWER;
  }
}

function assemble(
  claims: { claim: string; source_index: number }[],
  checks: { supported: boolean; quote: string; quote_start: number | null; quote_end: number | null }[],
  candidates: AssessmentCandidate[],
): { knowledgeClaims: KnowledgeClaim[]; citations: Citation[] } | null {
  const max = Math.min(3, ragConfig().maxCitations);
  const citations: Citation[] = [];
  const knowledgeClaims: KnowledgeClaim[] = [];
  const usedSources = new Set<string>();

  for (const [i, claim] of claims.entries()) {
    const check = checks[i];
    const candidate = candidates[claim.source_index];
    if (!check?.supported || !candidate || check.quote_start === null || check.quote_end === null) {
      return null;
    }
    if (usedSources.has(candidate.source_id)) return null;
    if (citations.length >= max) return null;
    usedSources.add(candidate.source_id);

    const citation_id = randomUUID();
    citations.push({
      citation_id,
      creator: candidate.creator,
      title: candidate.title,
      url: candidate.url,
      start_ts: candidate.start_ts,
      short_quote: check.quote,
    });
    knowledgeClaims.push({ claim: claim.claim.trim(), citation_id });
  }

  return { knowledgeClaims, citations };
}

export async function answerKnowledge(input: KnowledgeInput): Promise<KnowledgeCard> {
  try {
    return await withDeadline(ASSESSMENT_DEADLINE_MS, (signal) =>
      run(input, bindSignal(createLlmClient(), signal)),
    );
  } catch {
    return noSourceCard(FALLBACK_ANSWER, KNOWLEDGE_RETRIEVAL_FAILURE_NOTICE);
  }
}

async function run(input: KnowledgeInput, llm: LlmClient): Promise<KnowledgeCard> {
  let retrieved: RetrieveResult;
  try {
    retrieved = await retrieveKnowledge({ user_id: input.user_id, query: input.query });
  } catch {
    return noSourceCard(await generalAnswer(llm, input.query), KNOWLEDGE_RETRIEVAL_FAILURE_NOTICE);
  }
  if (retrieved.status === 'error') {
    return noSourceCard(await generalAnswer(llm, input.query), KNOWLEDGE_RETRIEVAL_FAILURE_NOTICE);
  }

  const candidates = retrieved.candidates;
  if (candidates.length === 0) {
    return noSourceCard(await generalAnswer(llm, input.query), KNOWLEDGE_NO_SOURCE_NOTICE);
  }

  const { draft } = await draftKnowledge(llm, input.query, candidates);
  if (!draft) {
    return noSourceCard(await generalAnswer(llm, input.query), KNOWLEDGE_NO_SOURCE_NOTICE);
  }

  // 起草时的 source_index 已换回候选全集下标
  const gateClaims = draft.claims.map((claim, i) => {
    const candidate = candidates[claim.source_index!]!;
    return {
      claim_id: `C${i}`,
      claim: claim.claim,
      candidate_id: `K${claim.source_index}`,
      chunk_text: candidate.chunk_text,
      windows: candidate.windows,
    };
  });
  const checks = await verifyClaims(llm, null, gateClaims);
  const assembled = assemble(
    draft.claims.map((c) => ({ claim: c.claim, source_index: c.source_index! })),
    checks.map((c) => c.check),
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
  };
}