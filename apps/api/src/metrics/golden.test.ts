import { describe, expect, it } from 'vitest';
import { computeVolume, type VolumeSet } from './volume.js';

/**
 * 容量黄金用例表 —— 期望值是**手算的**，不是另一个实现的输出。
 *
 * 这是 dev-003 §3.2 那条一手验证：容量由确定性代码算，数字与手算一致。
 * 逐条报出「输入 → 期望 → 实得」，对不上就当场喊。
 */

const w = (weight_kg: number | null, reps: number | null, extra: Partial<VolumeSet> = {}): VolumeSet => ({
  weight_kg,
  reps,
  set_type: 'working',
  is_inferred: false,
  ...extra,
});

interface Case {
  name: string;
  sets: VolumeSet[];
  total: number;
  skipped: number;
}

const CASES: Case[] = [
  { name: '三组正式组：3×60×10', sets: [w(60, 10), w(60, 10), w(60, 10)], total: 1800, skipped: 0 },
  {
    name: '热身要滤掉：2 组 40×10 热身 + 3 组 60×10',
    sets: [w(40, 10, { set_type: 'warmup' }), w(40, 10, { set_type: 'warmup' }), w(60, 10), w(60, 10), w(60, 10)],
    total: 1800,
    skipped: 0,
  },
  {
    name: '缺字段跳过并计数（不是当 0）：1 组缺重量 + 2 组 50×8',
    sets: [w(null, 8), w(50, 8), w(50, 8)],
    total: 800,
    skipped: 1,
  },
  { name: '小数不丢精度：70.31×8', sets: [w(70.31, 8)], total: 562.48, skipped: 0 },
  { name: '系统推测的组也计入：1 组推断的 60×10', sets: [w(60, 10, { is_inferred: true })], total: 600, skipped: 0 },
  {
    name: '休息暂停：75×16 + 5 次，仍算一组 = 1575',
    sets: [w(75, 16, { tags: ['rest_pause'], drops: [{ weight_kg: null, reps: 5 }] })],
    total: 1575,
    skipped: 0,
  },
  {
    name: '递减组后续段：12×10 + 8×10 + 6×12 = 272',
    sets: [
      w(12, 10, {
        tags: ['drop'],
        drops: [
          { weight_kg: 8, reps: 10 },
          { weight_kg: 6, reps: 12 },
        ],
      }),
    ],
    total: 272,
    skipped: 0,
  },
  {
    name: '旧的递减格式（drops 含主段）不重复算 = 272',
    sets: [
      w(12, 10, {
        tags: ['drop'],
        drops: [
          { weight_kg: 12, reps: 10 },
          { weight_kg: 8, reps: 10 },
          { weight_kg: 6, reps: 12 },
        ],
      }),
    ],
    total: 272,
    skipped: 0,
  },
  { name: '空记录：0', sets: [], total: 0, skipped: 0 },
];

describe('容量黄金用例表（离线，纯函数）', () => {
  it('逐条：输入 → 期望容量 → 实得容量', () => {
    for (const c of CASES) {
      const got = computeVolume(c.sets);
      console.log(`  ${c.name}  →  期望 ${c.total}  实得 ${got.total_kg}  （跳过 ${got.skipped_sets}）`);
      expect(got.total_kg, `${c.name} 的容量对不上`).toBe(c.total);
      expect(got.skipped_sets, `${c.name} 的跳过组数对不上`).toBe(c.skipped);
    }
  });
});