export interface VolumeDrop {
  weight_kg: number | null;
  reps: number | null;
}

export interface VolumeSet {
  /** 自重动作里是「额外负重」 */
  weight_kg: number | null;
  reps: number | null;
  set_type: 'warmup' | 'working';
  is_inferred: boolean;
  /** 自重动作叠加的体重；非自重为 null */
  bodyweight_kg?: number | null;
  tags?: ('failure' | 'drop' | 'rest_pause')[];
  /** 主段之后的每一小段；weight_kg 为 null = 沿用主段重量 */
  drops?: VolumeDrop[] | null;
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

/** 有效重量 = 额外负重 + 自重；两项都没有才是「不知道」 */
function effectiveWeight(weight: number | null, bodyweight: number | null): number | null {
  if (weight === null && bodyweight === null) return null;
  return (weight ?? 0) + (bodyweight ?? 0);
}

/**
 * 算一次训练（或一组动作）的容量。
 * 热身组不计入；缺重量或缺次数的正式组跳过并计数，不当 0。
 * 自重动作按「自重 + 额外负重」算；一组多段（递减 / 休息暂停）每段分别算，但仍算一组。
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

    const drops = s.drops ?? [];
    let counted = false;

    // 旧数据把主段也写在 drops 里：第一段与主段相同就不再重复算
    const dropsCarryMain =
      drops.length > 0 &&
      drops[0] !== undefined &&
      drops[0].weight_kg === s.weight_kg &&
      drops[0].reps === s.reps;

    if (!dropsCarryMain) {
      const w = effectiveWeight(s.weight_kg, s.bodyweight_kg ?? null);
      if (w !== null && s.reps !== null) {
        total += w * s.reps;
        counted = true;
      }
    }

    for (const d of drops) {
      const w = effectiveWeight(d.weight_kg ?? s.weight_kg, s.bodyweight_kg ?? null);
      if (w === null || d.reps === null) continue;
      total += w * d.reps;
      counted = true;
    }

    if (counted) {
      working += 1;
      if (s.is_inferred) inferred += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    total_kg: round2(total),
    working_sets: working,
    warmup_sets: warmup,
    skipped_sets: skipped,
    inferred_sets: inferred,
  };
}