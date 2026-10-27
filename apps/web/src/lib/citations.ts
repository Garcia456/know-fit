import type { AdviceClaim, Citation } from '../api/types';

export interface NumberedClaim {
  claim: string;
  basis: AdviceClaim['basis'];
  /** 引用列表里的 1 基序号；对不上时为 null（不显示假编号）。 */
  number: number | null;
}

/** 按引用列表顺序编号；找不到的 citation_id 不硬凑序号。 */
export function numberClaims(
  claims: AdviceClaim[],
  citations: Citation[],
): NumberedClaim[] {
  const index = new Map(citations.map((citation, i) => [citation.citation_id, i + 1]));
  return claims.map((claim) => ({
    claim: claim.claim,
    basis: claim.basis,
    number:
      claim.basis === 'source' && claim.citation_id
        ? (index.get(claim.citation_id) ?? null)
        : null,
  }));
}