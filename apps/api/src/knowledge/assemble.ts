import { randomUUID } from 'node:crypto';
import type { Citation } from '../contracts/assessment.js';
import type { KnowledgeClaim } from '../contracts/turn.js';
import type { AssessmentCandidate } from '../assessment/types.js';

/**
 * 知识卡的装配 —— 逐条保留 + 每条视频只出现一次（ADR-068）。
 *
 * 与评估路径（ADR-036 整条 all-or-nothing）不同：
 * 一条 claim 不过闸② 只丢它自己；同源 / 同链接的后来者直接丢。
 * 🔴 链接唯一性由这里保证 —— 不靠提示词、不靠模型自觉。
 */

export interface AssembledKnowledge {
  knowledgeClaims: KnowledgeClaim[];
  citations: Citation[];
}

interface CheckLike {
  supported: boolean;
  quote: string;
  quote_start: number | null;
  quote_end: number | null;
}

export function assembleKnowledge(input: {
  claims: { claim: string; source_index: number | null }[];
  /** 与 claims 同序：checks[i] 是 claims[i] 的闸② 结果 */
  checks: CheckLike[];
  candidates: AssessmentCandidate[];
  maxCitations: number;
  /** 测试注入；默认随机 uuid */
  newId?: () => string;
}): AssembledKnowledge | null {
  const { claims, checks, candidates } = input;
  const max = Math.max(1, Math.min(3, input.maxCitations));
  const newId = input.newId ?? randomUUID;

  const knowledgeClaims: KnowledgeClaim[] = [];
  const citations: Citation[] = [];
  const usedSources = new Set<string>();
  const usedUrls = new Set<string>();

  for (const [i, claim] of claims.entries()) {
    if (citations.length >= max) break;

    const check = checks[i];
    const candidate = claim.source_index === null ? undefined : candidates[claim.source_index];
    // 只丢当前这条 —— 不整卡失败
    if (!check?.supported || !candidate) continue;
    if (check.quote_start === null || check.quote_end === null) continue;
    // 同一条视频（同一来源或同一链接）只留第一次出现
    if (usedSources.has(candidate.source_id) || usedUrls.has(candidate.url)) continue;

    usedSources.add(candidate.source_id);
    usedUrls.add(candidate.url);

    const citation_id = newId();
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

  // 一条都不剩 → 调用方降级无源
  if (knowledgeClaims.length === 0) return null;
  return { knowledgeClaims, citations };
}
