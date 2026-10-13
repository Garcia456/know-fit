export interface VolumeSet {
  weight_kg: number | null;
  reps: number | null;
  set_type: 'warmup' | 'working';
  is_inferred: boolean;
}

export interface VolumeSummary {
  /** 容量 = Σ(重量 × 次数)，只取正式组 */
  total_kg: number;
  working_sets: number;
  /** 热身组 —— 不计入容量 */
  warmup_sets: number;
  /** 正式组里缺重量或缺次数、被跳过的组 */
  skipped_sets: number;
  /** 计入的组里，有几组的值是系统推测的 */
  inferred_sets: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 算一次训练（或一组动作）的容量。
 * 热身组不计入；缺重量或缺次数的正式组跳过并计数，不当 0。
 */
export function computeVolume(sets: VolumeSet[]): VolumeSummary {
  let total = 0;
  let working = 0;
  let warmup = 0;
  let skipped = 0;
  let inferred = 0;

  for (const s of sets) {
    if (s.set_type === 'warmup') {
      warmup += 1;
      continue;
    }
    if (s.weight_kg === null || s.reps === null) {
      skipped += 1;
      continue;
    }
    total += s.weight_kg * s.reps;
    working += 1;
    if (s.is_inferred) inferred += 1;
  }

  return {
    total_kg: round2(total),
    working_sets: working,
    warmup_sets: warmup,
    skipped_sets: skipped,
    inferred_sets: inferred,
  };
}