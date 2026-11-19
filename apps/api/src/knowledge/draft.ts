import { z } from 'zod';
import { ragConfig, type AssessmentCandidate } from '../assessment/types.js';
import type { LlmClient } from '../llm/client.js';
import { KNOWLEDGE_DRAFT_SYSTEM, knowledgeDraftInput } from './prompts.js';

/**
 * 知识回答的起草与校验。
 *
 * 与评估不同：没有 personal_data claim，每条都必须来自候选片段。
 * 同源不在这里判失败 —— 装配层逐条去重（ADR-068）。
 */

export const KnowledgeDraftSchema = z.object({
  claims: z.array(
    z.object({
      claim: z.string(),
      source_index: z.number().int().nullable().default(null),
    }),
  ),
});

export type KnowledgeDraft = z.infer<typeof KnowledgeDraftSchema>;
export type KnowledgeDraftProblem = 'claim_count' | 'empty_claim' | 'bad_source_index';

function repairHint(problem: KnowledgeDraftProblem, maxClaims: number): string {
  const hints: Record<KnowledgeDraftProblem, string> = {
    claim_count: `claims 总数必须 1–${maxClaims} 条，每条都要带 source_index。`,
    empty_claim: '每条 claim 都要有实际内容。',
    bad_source_index: 'source_index 必须是候选编号（0 到候选数减一）。',
  };
  return hints[problem];
}

function validateDraft(
  draft: KnowledgeDraft,
  candidates: AssessmentCandidate[],
  maxClaims: number,
): KnowledgeDraftProblem | null {
  if (draft.claims.length < 1 || draft.claims.length > maxClaims) return 'claim_count';
  if (draft.claims.some((c) => c.claim.trim().length === 0)) return 'empty_claim';

  // 同源不再判整卡失败：装配层按 source_id / url 去重（ADR-068）
  for (const claim of draft.claims) {
    if (claim.source_index === null || claim.source_index < 0 || claim.source_index >= candidates.length) {
      return 'bad_source_index';
    }
  }
  return null;
}

/** 同一视频只留一片 —— 起草看到的编号换回候选全集 */
function dedupeBySource(candidates: AssessmentCandidate[]): { picked: AssessmentCandidate[]; keep: number[] } {
  const keep: number[] = [];
  const seen = new Set<string>();
  candidates.forEach((c, i) => {
    if (seen.has(c.source_id)) return;
    seen.add(c.source_id);
    keep.push(i);
  });
  return { picked: keep.map((i) => candidates[i]!), keep };
}

export interface KnowledgeDraftOutcome {
  draft: KnowledgeDraft | null;
  problem: KnowledgeDraftProblem | null;
}

export async function draftKnowledge(
  llm: LlmClient,
  query: string,
  candidates: AssessmentCandidate[],
): Promise<KnowledgeDraftOutcome> {
  const { picked, keep } = dedupeBySource(candidates);
  const input = knowledgeDraftInput(query, picked);
  // 起草上限与引用上限一致；多出来的截掉 —— 装配层逐条保留，不会因此整卡降级
  const maxClaims = Math.max(1, Math.min(3, ragConfig().maxCitations));
  const baseSystem = `${KNOWLEDGE_DRAFT_SYSTEM}\n【上限】最多 ${maxClaims} 条 claim。`;

  let problem: KnowledgeDraftProblem | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const system = problem ? `${baseSystem}\n【修正】${repairHint(problem, maxClaims)}` : baseSystem;
    const draft = await llm.structured({
      system,
      input,
      schema: KnowledgeDraftSchema,
      name: 'draft_knowledge',
    });
    // 超出的 claim 直接截掉 —— 装配层还会按闸② 与同源逐条筛
    if (draft.claims.length > maxClaims) draft.claims = draft.claims.slice(0, maxClaims);
    for (const claim of draft.claims) {
      if (claim.source_index !== null) claim.source_index = keep[claim.source_index] ?? null;
    }
    problem = validateDraft(draft, candidates, maxClaims);
    if (problem === null) return { draft, problem: null };
  }
  return { draft: null, problem };
}