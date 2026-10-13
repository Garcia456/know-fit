import type { VolumeHook } from '../contracts/metrics.js';

/**
 * 造一个容量环比判定 —— 一个算好的数，不是一句话（措辞归模板）。
 * 基线取同一个 split 的上一次训练；算不出基线时也出一个钩子，只是不带数字。
 */
export function buildVolumeHook(input: {
  current: number;
  baseline: number | null;
  split_label: string | null;
}): VolumeHook {
  const { current, baseline, split_label } = input;
  const delta_pct =
    baseline === null || baseline <= 0 ? null : Math.round(((current - baseline) / baseline) * 100);

  return {
    metric: 'volume',
    scope: { split_label },
    current,
    baseline,
    delta_pct,
    baseline_kind: 'prev_same_split',
  };
}