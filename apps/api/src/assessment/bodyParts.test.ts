import { describe, expect, it } from 'vitest';
import { topBodyParts } from './bodyParts.js';

const regions = [
  { id: 'chest', coarse: 'chest' },
  { id: 'delt_ant', coarse: 'shoulders' },
  { id: 'delt_lat', coarse: 'shoulders' },
  { id: 'triceps', coarse: 'triceps' },
  { id: 'lats', coarse: 'lats' },
  { id: 'biceps', coarse: 'biceps' },
];

const zeroed = (entries: Record<string, number>) => {
  const base: Record<string, number> = Object.fromEntries(regions.map((r) => [r.id, 0]));
  return { ...base, ...entries };
};

describe('topBodyParts', () => {
  it('按容量占比给前三个部位，肩束合并', () => {
    const byMuscle = zeroed({ chest: 3000, delt_ant: 600, delt_lat: 600, triceps: 900 });
    expect(topBodyParts(byMuscle, regions)).toEqual(['胸', '肩', '三头']);
  });

  it('占比不足 10% 的部位不进 query', () => {
    const byMuscle = zeroed({ lats: 9000, biceps: 500 });
    expect(topBodyParts(byMuscle, regions)).toEqual(['背阔']);
  });

  it('全为 0 → 空数组（退回原模板）', () => {
    expect(topBodyParts(zeroed({}), regions)).toEqual([]);
  });

  it('最多三个', () => {
    const byMuscle = zeroed({ chest: 1000, delt_ant: 1000, triceps: 1000, lats: 1000, biceps: 1000 });
    expect(topBodyParts(byMuscle, regions)).toHaveLength(3);
  });

  it('映射不到的部位直接丢掉，不写空串', () => {
    const byMuscle = zeroed({ mystery: 5000, chest: 5000 });
    expect(topBodyParts(byMuscle, [...regions, { id: 'mystery', coarse: 'unknown' }])).toEqual(['胸']);
  });
});