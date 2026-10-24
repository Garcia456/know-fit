import { z } from 'zod';
import type { AdviceClaim } from '../contracts/assessment.js';
import type { VolumeHook } from '../contracts/metrics.js';
import type { AssessmentCandidate } from './types.js';

/**
 * 建议的组装与校验。
 *
 * 🔴 有源路径不允许 `general` claim —— `basis` 的枚举里根本没有这个值。
 *    「博主没讲、模型自己知道」的话只能走无源路径（ADR-037）。
 */

export const DraftClaimSchema = z.object({
  claim: z.string(),
  basis: z.enum(['personal_data', 'source']),
  source_index: z.number().int().nullable(),
});

export const DraftSchema = z.object({ claims: z.array(DraftClaimSchema) });

export type Draft = z.infer<typeof DraftSchema>;
export type DraftProblem =
  | 'claim_count'
  | 'no_personal'
  | 'source_count'
  | 'bad_source_index'
  | 'personal_has_source'
  | 'duplicate_source'
  | 'empty_claim';

export function validateDraft(draft: Draft, candidates: AssessmentCandidate[]): DraftProblem | null {
  const claims = draft.claims;
  if (claims.length < 2 || claims.length > 4) return 'claim_count';
  if (claims.some((c) => c.claim.trim().length === 0)) return 'empty_claim';

  const personal = claims.filter((c) => c.basis === 'personal_data');
  const source = claims.filter((c) => c.basis === 'source');
  if (personal.length < 1) return 'no_personal';
  if (source.length < 1 || source.length > 2) return 'source_count';
  if (personal.some((c) => c.source_index !== null)) return 'personal_has_source';

  const sourceIds = new Set<string>();
  for (const c of source) {
    if (c.source_index === null || c.source_index < 0 || c.source_index >= candidates.length) {
      return 'bad_source_index';
    }
    const id = candidates[c.source_index]!.source_id;
    if (sourceIds.has(id)) return 'duplicate_source';
    sourceIds.add(id);
  }
  return null;
}

/** 按 claim 顺序拼成对外建议 —— 不改变 claim 文本 */
export function renderAdvice(draft: Draft): string {
  return draft.claims.map((c) => c.claim.trim()).join('\n');
}

export interface CitationPlan {
  claim_index: number;
  candidate: AssessmentCandidate;
  quote_start: number;
  quote_end: number;
}

/**
 * 把过闸② 的 source claim 变成引用。
 * 同一 source 只留一条（防御性；validateDraft 已要求不同 source），最多 N 条。
 */
export function assembleCitations(input: {
  draft: Draft;
  checks: { claim_id: string; supported: boolean; quote_start: number | null; quote_end: number | null }[];
  candidates: AssessmentCandidate[];
  maxCitations: number;
}): { plans: CitationPlan[]; claimCitations: (string | null)[]; problem: string | null } {
  const { draft, checks, candidates, maxCitations } = input;
  const checkByClaim = new Map(checks.map((c) => [c.claim_id, c]));
  const usedSources = new Set<string>();
  const plans: CitationPlan[] = [];
  const claimCitations: (string | null)[] = [];

  for (const [i, claim] of draft.claims.entries()) {
    if (claim.basis !== 'source') {
      claimCitations.push(null);
      continue;
    }
    const check = checkByClaim.get(`C${i}`);
    const candidate = claim.source_index === null ? undefined : candidates[claim.source_index];
    if (!check?.supported || !candidate || check.quote_start === null || check.quote_end === null) {
      return { plans: [], claimCitations: [], problem: `C${i} 没有通过闸②` };
    }
    if (usedSources.has(candidate.source_id)) {
      return { plans: [], claimCitations: [], problem: `C${i} 与前面的引用同源` };
    }
    if (plans.length >= maxCitations) {
      return { plans: [], claimCitations: [], problem: `引用超过 ${maxCitations} 条` };
    }
    usedSources.add(candidate.source_id);
    plans.push({
      claim_index: i,
      candidate,
      quote_start: check.quote_start,
      quote_end: check.quote_end,
    });
    claimCitations.push(null); // 真实 id 由落库后回填
  }

  return { plans, claimCitations, problem: null };
}

/** 有源建议的 claim 契约化 —— citation_id 由落库后的引用顺序回填 */
export function toAdviceClaims(draft: Draft, citationIds: (string | null)[]): AdviceClaim[] {
  return draft.claims.map((c, i) => ({
    claim: c.claim.trim(),
    basis: c.basis,
    citation_id: c.basis === 'source' ? (citationIds[i] ?? null) : null,
  }));
}

const SOURCE_HINT = /博主|up主|UP主|视频里说|视频里讲/;

/** 无源建议不得暗示来源；命中就退回确定性模板（不把措辞交给模型） */
export function sanitizeNoSourceAdvice(text: string, verdict: VolumeHook): string {
  const trimmed = text.trim();
  if (trimmed.length > 0 && !SOURCE_HINT.test(trimmed)) return trimmed;

  const delta = verdict.delta_pct;
  const change =
    delta === null
      ? ''
      : `，比上次同 split ${delta > 0 ? '高' : '低'} ${Math.abs(delta)}%`;
  return `这次训练容量是 ${verdict.current}kg${change}。先把训练节奏稳住，再考虑调整。`;
}