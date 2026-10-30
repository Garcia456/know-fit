import { describe, expect, it } from 'vitest';
import {
  BODY_PATHS,
  LIBRARY_TO_REGION,
  REGION_IDS,
  UNMAPPED_LIBRARY_IDS,
  computeHeatTiers,
  sumByMuscle,
  validateBodyMap,
  viewPaths,
} from './bodyMap';

describe('body-muscles → 20 区映射', () => {
  it('契约校验通过（89 条路径全部有归属）', () => {
    expect(validateBodyMap()).toEqual([]);
    expect(BODY_PATHS).toHaveLength(89);
    expect(Object.keys(LIBRARY_TO_REGION)).toHaveLength(60);
    expect(UNMAPPED_LIBRARY_IDS).toHaveLength(25);
  });

  it('除留白的下背外，19 个区都至少有一条路径', () => {
    const front = viewPaths('FRONT').groups.map((g) => g.region);
    const back = viewPaths('BACK').groups.map((g) => g.region);
    expect(new Set([...front, ...back]).size).toBe(19);
    for (const region of REGION_IDS) {
      const rendered = [...front, ...back].includes(region);
      expect(rendered).toBe(region !== 'lower_back');
    }
  });

  it('腹直肌上六下四，各自成组', () => {
    const front = viewPaths('FRONT').groups;
    expect(front.find((g) => g.region === 'abs_upper')?.paths).toHaveLength(6);
    expect(front.find((g) => g.region === 'abs_lower')?.paths).toHaveLength(4);
  });

  it('下背四块不上图', () => {
    const back = viewPaths('BACK').groups.map((g) => g.region);
    expect(back).not.toContain('lower_back');
  });

  it('未映射路径只出现在剪影里，不带上色分组', () => {
    const silhouettes = [...viewPaths('FRONT').silhouettes, ...viewPaths('BACK').silhouettes];
    expect(silhouettes).toHaveLength(25);
    const mapped = [...viewPaths('FRONT').groups, ...viewPaths('BACK').groups].flatMap((g) => g.paths);
    expect(mapped).toHaveLength(72);
  });
});

describe('computeHeatTiers', () => {
  it('全 0 / 缺键都落 0 档，不除零', () => {
    const tiers = computeHeatTiers({});
    expect(Object.values(tiers).every((t) => t === 0)).toBe(true);
  });

  it('按当日最大值分 4 档', () => {
    const tiers = computeHeatTiers({ chest: 100, lats: 50, quads: 25, calves: 1 });
    expect(tiers.chest).toBe(4);
    expect(tiers.lats).toBe(2);
    expect(tiers.quads).toBe(1);
    expect(tiers.calves).toBe(1);
    expect(tiers.biceps).toBe(0);
  });

  it('负值与非有限值当 0', () => {
    const tiers = computeHeatTiers({ chest: -10, lats: Number.NaN, quads: Number.POSITIVE_INFINITY });
    expect(tiers.chest).toBe(0);
    expect(tiers.lats).toBe(0);
    expect(tiers.quads).toBe(0);
  });
});

describe('sumByMuscle', () => {
  it('同日多条 session 先求和再上色', () => {
    expect(sumByMuscle([{ chest: 100, lats: 20 }, { chest: 50 }])).toEqual({ chest: 150, lats: 20 });
  });

  it('忽略非有限值', () => {
    expect(sumByMuscle([{ chest: Number.NaN, lats: 10 }])).toEqual({ lats: 10 });
  });
});