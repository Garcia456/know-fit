import { describe, expect, it } from 'vitest';
import { loadSeed } from './load.js';

/**
 * 映射表数据的断言 —— 20 个肌群分区 / 64 个动作 / 5 条兜底。
 *
 * ⚠️ 数字写死在这里，是为了让「数据被悄悄改小」这件事必须显式过闸门。
 */
describe('seed 数据（apps/api/seed/exercises.json）', () => {
  const seed = loadSeed();

  it('结构合法 + 引用完整（loadSeed 内含 Zod 校验与「无未知 muscle id」检查）', () => {
    expect(seed.$schema_version).toBeTruthy();
    expect(seed.muscle_regions.length).toBeGreaterThan(0);
  });

  it('20 个肌群分区', () => {
    expect(seed.muscle_regions).toHaveLength(20);
  });

  it('64 个动作', () => {
    expect(seed.exercises).toHaveLength(64);
  });

  it('5 条部位级兜底', () => {
    expect(seed.region_fallbacks).toHaveLength(5);
  });

  it('$counts 与文件里的实际行数一致（防止「概述数 ≠ 实际行数」那类错复发）', () => {
    expect(seed.$counts.muscle_regions).toBe(seed.muscle_regions.length);
    expect(seed.$counts.exercises).toBe(seed.exercises.length);
    expect(seed.$counts.region_fallbacks).toBe(seed.region_fallbacks.length);
  });

  it('无未知 muscle id', () => {
    const known = new Set(seed.muscle_regions.map((m) => m.id));
    for (const ex of seed.exercises) {
      for (const m of [...ex.primary_muscles, ...ex.secondary_muscles]) {
        expect(known.has(m), `exercise ${ex.id} 引用了未知 muscle id: ${m}`).toBe(true);
      }
    }
    for (const fb of seed.region_fallbacks) {
      for (const m of fb.covers) {
        expect(known.has(m), `fallback ${fb.id} 引用了未知 muscle id: ${m}`).toBe(true);
      }
    }
  });

  it('每个动作至少一个主动肌（否则热力图算不出训练量归谁）', () => {
    for (const ex of seed.exercises) {
      expect(ex.primary_muscles.length, `exercise ${ex.id} 没有主动肌`).toBeGreaterThan(0);
    }
  });

  it('动作 id 唯一', () => {
    const ids = seed.exercises.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});