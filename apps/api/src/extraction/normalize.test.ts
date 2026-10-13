import { describe, expect, it } from 'vitest';
import { normalizeExerciseName, normalizeKey } from './normalize.js';

/**
 * 别名匹配的四级阶梯（定义 §1.3）—— 纯确定性，每一级都可测。
 *
 * ⚠️ **2 级在当前 seed 下不可达，原因见文件末尾那条测试** —— 不是漏测。
 */
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
});

describe('3 级：命中 ambiguous → 不强行归并', () => {
  it('「划船」→ exercise_id 为 null，带上部位兜底', () => {
    const r = normalizeExerciseName('划船');
    expect(r).toMatchObject({ exercise_id: null, level: 3, region_fallback: 'region_back' });
  });

  it('「飞鸟」→ 同样不归并，且它的 fallback 本身是 null', () => {
    const r = normalizeExerciseName('飞鸟');
    expect(r).toMatchObject({ exercise_id: null, level: 3, region_fallback: null });
  });

  it('「倒蹬」→ 不归并（不猜是哈克深蹲还是腿举）', () => {
    expect(normalizeExerciseName('倒蹬')).toMatchObject({ exercise_id: null, level: 3 });
  });
});

describe('4 级：未命中 → null（不是失败）', () => {
  it('「保加利亚深蹲」—— seed 里只有「保加利亚分腿蹲」，不给错答案', () => {
    expect(normalizeExerciseName('保加利亚深蹲')).toMatchObject({ exercise_id: null, level: 4 });
  });

  it('「直腿硬拉」—— 它挂在 rdl 的 aliases 数组里，但按 §1.3 数组不参与匹配', () => {
    expect(normalizeExerciseName('直腿硬拉')).toMatchObject({ exercise_id: null, level: 4 });
  });

  it('空串直接落 4 级', () => {
    expect(normalizeExerciseName('   ').level).toBe(4);
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

  it('含限定词的裸别名（「罗马尼亚硬拉」去掉名字后）不许落到硬拉', () => {
    // 「硬拉」本身没问题 —— 但一旦带上限定词就不该再归并到它
    expect(normalizeExerciseName('硬拉').exercise_id).toBe('deadlift');
    expect(normalizeExerciseName('直腿硬拉').exercise_id).toBeNull();
  });
});

describe('2 级：被 $guard 挡下后降级 —— 当前 seed 下不可达（记录在案）', () => {
  it('定义 §1.3 举的两个 2 级例子，其实都落在 1 级（它们是 name_zh）', () => {
    // 「前蹲」与「罗马尼亚硬拉」都是 seed 里独立的 name_zh → 1 级精确命中，
    // 根本走不到「先踩 guard、再降级」那一步。
    expect(normalizeExerciseName('前蹲')).toMatchObject({ exercise_id: 'front_squat', level: 1 });
    expect(normalizeExerciseName('罗马尼亚硬拉')).toMatchObject({ exercise_id: 'rdl', level: 1 });
  });

  it('guard 词都是限定词 —— 命中 guard 时原文必然不等于别名，故 2 级无入口', () => {
    // 三个别名上的 guard（深蹲/硬拉/弯举）都要求原文**多带**限定词，
    // 多带之后原文就不可能再与别名精确相等 → 精确命中那条路径永远不触发降级。
    expect(normalizeExerciseName('深蹲').level).toBe(1);
    expect(normalizeExerciseName('硬拉').level).toBe(1);
    expect(normalizeExerciseName('弯举').level).toBe(1);
  });
});