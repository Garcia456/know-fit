import { describe, expect, it } from 'vitest';
import { describeSets } from './exercise';
import type { WorkoutCardSet } from '../api/types';

function set(input: Partial<WorkoutCardSet>): WorkoutCardSet {
  return {
    weight_kg: null,
    reps: 10,
    set_type: 'working',
    is_inferred: false,
    ...input,
  };
}

describe('describeSets：自重动作', () => {
  it('有体重记录时显示实际重量（体重 + 额外负重）', () => {
    const text = describeSets({
      is_bodyweight: true,
      sets: [set({ bodyweight_kg: 75 }), set({ bodyweight_kg: 75 })],
    });
    expect(text).toContain('75kg');
    expect(text).not.toContain('自重');
  });

  it('负重引体显示体重 + 负重后的总重', () => {
    const text = describeSets({
      is_bodyweight: true,
      sets: [set({ weight_kg: 10, bodyweight_kg: 75 })],
    });
    expect(text).toContain('85kg');
  });

  it('没有体重记录时退回「自重」，不编数字', () => {
    const text = describeSets({
      is_bodyweight: true,
      sets: [set({ bodyweight_kg: null })],
    });
    expect(text).toContain('自重');
  });
});

describe('describeSets：普通动作', () => {
  it('重量一致直接显示，次数不一说明', () => {
    const text = describeSets({
      is_bodyweight: false,
      sets: [set({ weight_kg: 60, reps: 8 }), set({ weight_kg: 60, reps: 10 })],
    });
    expect(text).toBe('60kg · 次数不一 · 2 组');
  });
});