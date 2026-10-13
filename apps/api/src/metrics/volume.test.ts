import { describe, expect, it } from 'vitest';
import { computeVolume, type VolumeSet } from './volume.js';

const working = (weight: number | null, reps: number | null): VolumeSet => ({
  weight_kg: weight,
  reps,
  set_type: 'working',
  is_inferred: false,
});

const warmup = (weight: number | null, reps: number | null): VolumeSet => ({
  weight_kg: weight,
  reps,
  set_type: 'warmup',
  is_inferred: false,
});

describe('容量 = Σ(重量 × 次数)，只取正式组', () => {
  it('五组 100kg×5 → 2500', () => {
    const r = computeVolume([working(100, 5), working(100, 5), working(100, 5), working(100, 5), working(100, 5)]);
    expect(r.total_kg).toBe(2500);
    expect(r.working_sets).toBe(5);
  });

  it('热身组不计入容量，但要计数', () => {
    const r = computeVolume([warmup(40, 10), warmup(40, 10), working(100, 5)]);
    expect(r.total_kg).toBe(500);
    expect(r.warmup_sets).toBe(2);
    expect(r.working_sets).toBe(1);
  });

  it('缺重量或缺次数的正式组跳过并计数，不当 0', () => {
    const r = computeVolume([working(100, 5), working(null, 5), working(100, null)]);
    expect(r.total_kg).toBe(500);
    expect(r.skipped_sets).toBe(2);
    expect(r.working_sets).toBe(1);
  });

  it('推测出来的值照算，但计数记下', () => {
    const r = computeVolume([{ ...working(100, 5), is_inferred: true }, working(100, 5)]);
    expect(r.total_kg).toBe(1000);
    expect(r.inferred_sets).toBe(1);
  });

  it('空集 → 全 0', () => {
    expect(computeVolume([])).toEqual({
      total_kg: 0,
      working_sets: 0,
      warmup_sets: 0,
      skipped_sets: 0,
      inferred_sets: 0,
    });
  });

  it('小数重量不产生浮点噪声（70.31 × 8）', () => {
    expect(computeVolume([working(70.31, 8)]).total_kg).toBe(562.48);
  });
});