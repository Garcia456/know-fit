/**
 * 把本次训练的肌群容量聚成检索用的部位短词。
 * 取占比 ≥10% 的前几个；取不到就返回空，不猜。
 */

const COARSE_ZH: Record<string, string> = {
  chest: '胸',
  shoulders: '肩',
  biceps: '二头',
  triceps: '三头',
  forearms: '前臂',
  abdominals: '腹',
  quadriceps: '股四头',
  adductors: '内收',
  traps: '斜方',
  'middle back': '中背',
  lats: '背阔',
  'lower back': '下背',
  glutes: '臀',
  abductors: '臀中',
  hamstrings: '腘绳',
  calves: '小腿',
};

const MIN_SHARE = 0.1;

export function topBodyParts(
  byMuscle: Record<string, number>,
  regions: readonly { id: string; coarse: string }[],
  max = 3,
): string[] {
  const coarseOf = new Map(regions.map((r) => [r.id, r.coarse]));
  const sums = new Map<string, number>();
  for (const [id, volume] of Object.entries(byMuscle)) {
    const coarse = coarseOf.get(id);
    if (!coarse || volume <= 0) continue;
    sums.set(coarse, (sums.get(coarse) ?? 0) + volume);
  }
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return [];

  return [...sums.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, v]) => v / total >= MIN_SHARE)
    .slice(0, max)
    .map(([coarse]) => COARSE_ZH[coarse])
    .filter((zh): zh is string => Boolean(zh));
}