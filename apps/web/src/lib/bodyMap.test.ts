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

  it('除不上图的外展肌群、下背外，18 个区都至少有一条路径', () => {
    const front = viewPaths('FRONT').groups.map((g) => g.region);
    const back = viewPaths('BACK').groups.map((g) => g.region);
    const notRendered = new Set(['abductors', 'lower_back']);
    expect(new Set([...front, ...back]).size).toBe(18);
    for (const region of REGION_IDS) {
      expect([...front, ...back].includes(region)).toBe(!notRendered.has(region));
    }
  });

  it('腹直肌上六下四，各自成组', () => {
    const front = viewPaths('FRONT').groups;
    expect(front.find((g) => g.region === 'abs_upper')?.paths).toHaveLength(6);
    expect(front.find((g) => g.region === 'abs_lower')?.paths).toHaveLength(4);
  });

  it('下背与臀中肌都不画，背阔肌最下一块拉长到臀部', () => {
    const back = viewPaths('BACK').groups;
    expect(back.map((g) => g.region)).not.toContain('abductors');
    expect(back.map((g) => g.region)).not.toContain('lower_back');
    expect(back.find((g) => g.region === 'glutes')?.paths).toHaveLength(2);
    expect(back.find((g) => g.region === 'lats')?.paths).toHaveLength(6);
    // 背阔肌外缘折边切下来归后束，后束在背面只剩这一条
    expect(back.find((g) => g.region === 'delt_post')?.paths).toHaveLength(2);
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