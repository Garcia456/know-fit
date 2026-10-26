import type { VolumeHook } from '../contracts/metrics.js';
import type { LlmClient } from '../llm/client.js';
import {
  DraftSchema,
  dedupeBySource,
  remapDraftIndices,
  validateDraft,
  type Draft,
  type DraftProblem,
} from './advice.js';
import { DRAFT_SYSTEM, draftInput } from './prompts.js';
import type { AssessmentCandidate } from './types.js';

/**
 * 起草一次，不合法就带明确修正要求重试一次。
 *
 * 重试只救模型自己能改的错（漏了 personal claim、两条指着同一个视频）。
 * 两次都不合法就交回去降级无源 —— 不在这里放宽规则。
 */

const REPAIR_HINT: Record<DraftProblem, string> = {
  claim_count: 'claims 总数必须 2–4 条。',
  no_personal: '必须至少有 1 条 basis=personal_data 的 claim，只复述判定里的数字。',
  source_count: 'basis=source 的 claim 必须正好 1–2 条。',
  bad_source_index: 'source_index 必须是候选编号（0 到候选数减一）。',
  personal_has_source: 'basis=personal_data 的 claim 不要带 source_index。',
  duplicate_source: '两条 source claim 必须指向不同的候选编号。',
  empty_claim: '每条 claim 都要有实际内容。',
};

export interface DraftOutcome {
  draft: Draft | null;
  problem: DraftProblem | null;
}

export async function draftAdvice(
  llm: LlmClient,
  verdict: VolumeHook,
  candidates: AssessmentCandidate[],
): Promise<DraftOutcome> {
  const { picked, keep } = dedupeBySource(candidates);
  const input = draftInput(verdict, picked);

  let problem: DraftProblem | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const system = problem ? `${DRAFT_SYSTEM}\n【修正】${REPAIR_HINT[problem]}` : DRAFT_SYSTEM;
    const draft = await llm.structured({ system, input, schema: DraftSchema, name: 'draft_advice' });
    remapDraftIndices(draft, keep);
    problem = validateDraft(draft, candidates);
    if (problem === null) return { draft, problem: null };
  }
  return { draft: null, problem };
}