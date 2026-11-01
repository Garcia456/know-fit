/**
 * rerank 之后按来源限流 —— 防止单一来源占满 top-N。
 *
 * 纯函数：不改原数组、不看库、不联网，直接单测。
 * `maxPerSource = 0` 时退化为原顺序切片（baseline）。
 */
export interface SourceQuotaOptions {
  topN: number;
  maxPerSource: number;
}

export interface SourceQuotaResult<T> {
  picked: T[];
  /** 因来源不足而回填的条数（>0 时允许突破配额） */
  backfilled: number;
  distinctSources: number;
}

export function selectWithSourceQuota<T extends { source_id: string }>(
  ranked: readonly T[],
  { topN, maxPerSource }: SourceQuotaOptions,
): SourceQuotaResult<T> {
  const limit = Math.max(0, topN);
  if (maxPerSource <= 0) {
    const picked = ranked.slice(0, limit);
    return { picked, backfilled: 0, distinctSources: countSources(picked) };
  }

  const picked: T[] = [];
  const perSource = new Map<string, number>();

  for (const item of ranked) {
    if (picked.length >= limit) break;
    const used = perSource.get(item.source_id) ?? 0;
    if (used >= maxPerSource) continue;
    picked.push(item);
    perSource.set(item.source_id, used + 1);
  }

  let backfilled = 0;
  if (picked.length < limit) {
    const chosen = new Set(picked);
    for (const item of ranked) {
      if (picked.length >= limit) break;
      if (chosen.has(item)) continue;
      picked.push(item);
      chosen.add(item);
      backfilled++;
    }
  }

  return { picked, backfilled, distinctSources: countSources(picked) };
}

function countSources(items: readonly { source_id: string }[]): number {
  return new Set(items.map((item) => item.source_id)).size;
}