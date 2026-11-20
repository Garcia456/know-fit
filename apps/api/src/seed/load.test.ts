import { describe, expect, it } from 'vitest';
import { loadSeed, parseSeed } from './load.js';

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

  it('无未知 muscle id（含第三档）', () => {
    const known = new Set(seed.muscle_regions.map((m) => m.id));
    for (const ex of seed.exercises) {
      for (const m of [...ex.primary_muscles, ...ex.secondary_muscles, ...ex.tertiary_muscles]) {
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

/** 注入合成数据验校验逻辑本身 —— 真数据不会为了测试故意写坏 */
function syntheticSeed(muscles: {
  primary: string[];
  secondary?: string[];
  tertiary?: string[];
}): unknown {
  return {
    $schema_version: 'test',
    $source: 'test',
    $generated: 'test',
    $counts: { muscle_regions: 2, exercises: 1, region_fallbacks: 0 },
    $notes: [],
    muscle_regions: [
      { id: 'chest', name_zh: '胸', name_en: 'chest', face: 'front', coarse: 'chest' },
      { id: 'delt_ant', name_zh: '前束', name_en: 'delt_ant', face: 'front', coarse: 'shoulders' },
    ],
    exercises: [
      {
        id: 'bench_press',
        name_zh: '杠铃卧推',
        aliases: [],
        equipment: ['杠铃'],
        mechanic: '推',
        primary_muscles: muscles.primary,
        secondary_muscles: muscles.secondary ?? [],
        tertiary_muscles: muscles.tertiary ?? [],
        coarse: ['chest'],
      },
    ],
    region_fallbacks: [],
  };
}

describe('seed 校验：第三档与跨角色重复', () => {
  it('tertiary_muscles 缺省为 []', () => {
    const parsed = parseSeed(syntheticSeed({ primary: ['chest'] }));
    expect(parsed.exercises[0]?.tertiary_muscles).toEqual([]);
  });

  it('第三档也做引用完整性校验', () => {
    expect(() => parseSeed(syntheticSeed({ primary: ['chest'], tertiary: ['ghost'] }))).toThrow(
      /未知 muscle id/,
    );
  });

  it('同一肌群跨角色重复声明 → 报错', () => {
    expect(() =>
      parseSeed(syntheticSeed({ primary: ['chest'], secondary: ['chest'] })),
    ).toThrow(/重复声明/);
  });

  it('不同肌群分属三档 → 通过', () => {
    const parsed = parseSeed(syntheticSeed({ primary: ['chest'], secondary: ['delt_ant'] }));
    expect(parsed.exercises[0]?.secondary_muscles).toEqual(['delt_ant']);
  });
});