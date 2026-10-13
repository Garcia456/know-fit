import { describe, expect, it } from 'vitest';
import { normalizeExerciseName, normalizeKey } from './normalize.js';

/** 别名匹配的三级阶梯 —— 纯确定性，每一级都可测。1 级里还分权威层 / 补充层。 */
describe('normalizeKey：去噪', () => {
  it('去空白、大小写与中英文标点', () => {
    expect(normalizeKey(' 卧推（杠铃） ')).toBe('卧推杠铃');
    expect(normalizeKey('T杠划船')).toBe('t杠划船');
  });
});

describe('1 级：精确命中 name_zh 或 resolvable.alias', () => {
  it('resolvable 别名「卧推」→ bench_press', () => {
    const r = normalizeExerciseName('卧推');
    expect(r).toMatchObject({ exercise_id: 'bench_press', level: 1 });
  });

  it('name_zh「杠铃卧推」→ bench_press', () => {
    expect(normalizeExerciseName('杠铃卧推').exercise_id).toBe('bench_press');
  });

  it('name_zh「深蹲」不在数据里，别名「深蹲」→ back_squat 且 guard 未被踩', () => {
    const r = normalizeExerciseName('深蹲');
    expect(r).toMatchObject({ exercise_id: 'back_squat', level: 1 });
  });

  it('resolvable 别名「倒蹬」→ leg_press（作者裁定：口语指腿举）', () => {
    expect(normalizeExerciseName('倒蹬')).toMatchObject({ exercise_id: 'leg_press', level: 1 });
  });
});

describe('1 级补充层：exercise.aliases 精确命中（动作库长了就自动跟上）', () => {
  it('「上斜哑铃卧推」→ incline_dumbbell_press，不许被「哑铃卧推」的包含匹配吃掉', () => {
    expect(normalizeExerciseName('上斜哑铃卧推')).toMatchObject({
      exercise_id: 'incline_dumbbell_press',
      level: 1,
    });
  });

  it('「龙门架飞鸟」→ cable_crossover，不许被 ambiguous 的「飞鸟」拦住', () => {
    expect(normalizeExerciseName('龙门架飞鸟')).toMatchObject({
      exercise_id: 'cable_crossover',
      level: 1,
    });
  });

  it('「器械飞鸟」→ pec_deck；「反向飞鸟」→ rear_delt_fly', () => {
    expect(normalizeExerciseName('器械飞鸟').exercise_id).toBe('pec_deck');
    expect(normalizeExerciseName('反向飞鸟').exercise_id).toBe('rear_delt_fly');
  });

  it('「直腿硬拉」→ rdl（就是它自己的别名），guard 挡的是不许归到 deadlift', () => {
    expect(normalizeExerciseName('直腿硬拉')).toMatchObject({ exercise_id: 'rdl', level: 1 });
  });
});

describe('层间撞键：权威层说了算，不是二义', () => {
  it('「飞鸟」：alias_rules 判歧义（一层）压过 dumbbell_fly 的别名（二层）', () => {
    expect(normalizeExerciseName('飞鸟')).toMatchObject({
      exercise_id: null,
      level: 2,
      region_fallback: null,
    });
  });
});

describe('精确都没中时的包含匹配（长名优先）', () => {
  it('「龙门架下压」→ 靠 resolvable 的「下压」接住 → triceps_pushdown', () => {
    expect(normalizeExerciseName('龙门架下压')).toMatchObject({
      exercise_id: 'triceps_pushdown',
      level: 1,
    });
  });
});

describe('2 级：命中 ambiguous → 不强行归并', () => {
  it('「划船」→ exercise_id 为 null，带上部位兜底', () => {
    const r = normalizeExerciseName('划船');
    expect(r).toMatchObject({ exercise_id: null, level: 2, region_fallback: 'region_back' });
  });

  it('「飞鸟」→ 同样不归并，且它的 fallback 本身是 null', () => {
    const r = normalizeExerciseName('飞鸟');
    expect(r).toMatchObject({ exercise_id: null, level: 2, region_fallback: null });
  });
});

describe('3 级：未命中 → null（不是失败）', () => {
  it('「保加利亚深蹲」—— seed 里只有「保加利亚分腿蹲」，不给错答案', () => {
    expect(normalizeExerciseName('保加利亚深蹲')).toMatchObject({ exercise_id: null, level: 3 });
  });

  it('空串直接落 3 级', () => {
    expect(normalizeExerciseName('   ').level).toBe(3);
  });
});

describe('guard：限定词不许被吞掉', () => {
  it('「前蹲」是独立动作，不许归到 back_squat', () => {
    expect(normalizeExerciseName('前蹲').exercise_id).not.toBe('back_squat');
  });

  it('「罗马尼亚硬拉」不许归到 deadlift', () => {
    expect(normalizeExerciseName('罗马尼亚硬拉').exercise_id).not.toBe('deadlift');
  });

  it('「相扑硬拉」「六角杠硬拉」各有自己的 id', () => {
    expect(normalizeExerciseName('相扑硬拉').exercise_id).toBe('sumo_deadlift');
    expect(normalizeExerciseName('六角杠硬拉').exercise_id).toBe('trap_bar_deadlift');
  });

  it('裸别名照旧命中，带上限定词就不许再归并到它', () => {
    expect(normalizeExerciseName('硬拉').exercise_id).toBe('deadlift');
    expect(normalizeExerciseName('直腿硬拉').exercise_id).not.toBe('deadlift');
  });

  it('guard 词都是限定词 —— 踩上它的原文必然多带了字，故落 1 级或 3 级，没有中间档', () => {
    expect(normalizeExerciseName('深蹲')).toMatchObject({ exercise_id: 'back_squat', level: 1 });
    expect(normalizeExerciseName('硬拉')).toMatchObject({ exercise_id: 'deadlift', level: 1 });
    expect(normalizeExerciseName('弯举')).toMatchObject({ exercise_id: 'barbell_curl', level: 1 });
    // 「哈克深蹲」自带 name_zh → 1 级；guard 保证它没被「深蹲」吃掉
    expect(normalizeExerciseName('哈克深蹲')).toMatchObject({ exercise_id: 'hack_squat', level: 1 });
  });
});