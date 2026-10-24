import { describe, expect, it } from 'vitest';
import { buildTurnGraph } from './turn.js';
import type { AssessInput, PersistWorkoutInput } from './deps.js';
import { createFakeClient } from '../llm/fake.js';
import { buildVolumeHook } from '../metrics/hook.js';

/**
 * 主图的条件边与三个出口 —— 替身 LLM + 桩落库，**不连库**。
 *
 * 这里验的是「图走对没走对」；「写进库没写进库」由 services 的落库往返测试管。
 * ⚠️ 替身返回固定结构，**它证明不了模型抽得准** —— 准确率只能来自真实 smoke。
 */

const NOW = new Date('2026-10-13T09:00:00');

function stub() {
  const calls: PersistWorkoutInput[] = [];
  return {
    calls,
    persistWorkout: async (input: PersistWorkoutInput) => {
      calls.push(input);
      return { session_id: `stub-${calls.length}` };
    },
  };
}

function build() {
  const s = stub();
  const graph = buildTurnGraph({
    llm: createFakeClient(),
    persistWorkout: s.persistWorkout,
    now: () => NOW,
  });
  return { graph, calls: s.calls };
}

const COMPLETE = '卧推 70kg×8 四组，飞鸟 15kg×12 三组，深蹲 100kg×5 五组';

describe('记录链路：走通 → 落库 → 出卡片', () => {
  it('3 个动作 / 12 组，状态 complete，卡片带回规范化结果', async () => {
    const { graph, calls } = build();
    const state = await graph.invoke({ message: COMPLETE });

    expect(state.intent).toBe('record');
    expect(state.card?.kind).toBe('workout');
    expect(calls).toHaveLength(1);

    const card = state.card;
    if (card?.kind !== 'workout') throw new Error('卡片类型不对');
    expect(card.exercises).toHaveLength(3);
    expect(card.exercises.flatMap((e) => e.sets)).toHaveLength(12);
    expect(card.status).toBe('complete');
    expect(state.notices).toHaveLength(0);
    // 落库那颗 id 与卡片里的 session_id 是同一个
    expect(card.session_id).toBe('stub-1');
    expect(card.exercises[0]?.exercise_id).toBe('bench_press');
    expect(card.exercises[2]?.exercise_id).toBe('back_squat');
  });

  it('歧义动作「飞鸟」→ exercise_id 为 null，但原文留着', async () => {
    const { graph } = build();
    const state = await graph.invoke({ message: COMPLETE });
    const fly = state.card?.kind === 'workout' ? state.card.exercises[1] : undefined;
    expect(fly?.raw_name).toBe('飞鸟');
    expect(fly?.exercise_id).toBeNull();
  });

  it('lb → kg 换算由确定性代码做（155 磅 ≈ 70.31kg）', async () => {
    const { graph, calls } = build();
    await graph.invoke({ message: '卧推 155 磅 五组五次' });
    const set = calls[0]?.exercises[0]?.sets[0];
    expect(set?.weight_kg).toBeCloseTo(70.31, 2);
  });

  it('时间状语交给代码解析：昨天 → 前一天', async () => {
    const { graph, calls } = build();
    await graph.invoke({ message: '昨天练了胸' });
    expect(calls[0]?.date).toBe('2026-10-12');
  });

  it('缺重量 → incomplete + 一条补充提示（至多 1 条）', async () => {
    const { graph } = build();
    const state = await graph.invoke({ message: '卧推做了四组，每组 8 个' });
    expect(state.record_status).toBe('incomplete');
    expect(state.missing_fields).toContain('weight_kg');
    expect(state.notices).toHaveLength(1);
  });

  it('只说部位：「今天练了背」—— 动作数为 0 也要落库，不拦住录入', async () => {
    const { graph, calls } = build();
    const state = await graph.invoke({ message: '今天练了背' });
    expect(calls).toHaveLength(1);
    expect(state.missing_fields).toContain('exercises');
    expect(state.notices).toHaveLength(1);
  });

  it('混合意图：「…帮我看下够不够」先落库出卡片（评估接线另测）', async () => {
    const { graph, calls } = build();
    const state = await graph.invoke({ message: '卧推 70kg×8 四组，帮我看下够不够' });
    expect(state.intent).toBe('mixed');
    expect(calls).toHaveLength(1);
    expect(state.card?.kind).toBe('workout');
  });
});

describe('数据钩子：记录完成后带一个算好的判定', () => {
  it('注入了 computeHook → 卡片带钩子（数是算好的，措辞归展示层）', async () => {
    const s = stub();
    const graph = buildTurnGraph({
      llm: createFakeClient(),
      persistWorkout: s.persistWorkout,
      computeHook: async (input) =>
        buildVolumeHook({ current: 2500, baseline: null, split_label: input.split_label }),
      now: () => NOW,
    });
    const state = await graph.invoke({ message: COMPLETE });
    const card = state.card;
    if (card?.kind !== 'workout') throw new Error('卡片类型不对');
    expect(card.hook?.metric).toBe('volume');
    expect(card.hook?.current).toBe(2500);
  });

  it('不注入 → 卡片不带钩子（图本身不读库）', async () => {
    const { graph } = build();
    const state = await graph.invoke({ message: COMPLETE });
    const card = state.card;
    if (card?.kind !== 'workout') throw new Error('卡片类型不对');
    expect(card.hook).toBeNull();
  });
});

describe('饮食：只走契约，不落库', () => {
  it('「午饭吃了两碗米饭」→ meal 卡片，且没有写库', async () => {
    const { graph, calls } = build();
    const state = await graph.invoke({ message: '午饭吃了两碗米饭' });
    expect(state.card?.kind).toBe('meal');
    expect(calls).toHaveLength(0);
  });
});

describe('三个出口：不落库', () => {
  it('闲聊 → chat 卡片', async () => {
    const { graph, calls } = build();
    const state = await graph.invoke({ message: '我不太想练了' });
    expect(state.card?.kind).toBe('chat');
    expect(calls).toHaveLength(0);
  });

  it('红线（伤病）→ refusal 卡片，且措辞来自模板', async () => {
    const { graph, calls } = build();
    const state = await graph.invoke({ message: '膝盖疼还能练吗' });
    expect(state.card?.kind).toBe('refusal');
    expect(state.card?.kind === 'refusal' ? state.card.reason : null).toBe('medical');
    expect(calls).toHaveLength(0);
  });

  it('非目标用户（关键词）→ boundary 卡片', async () => {
    const { graph, calls } = build();
    const state = await graph.invoke({ message: '我 14 岁，能练吗' });
    expect(state.card?.kind).toBe('boundary');
    expect(calls).toHaveLength(0);
  });

  it('非目标用户（档案说 < 3 个月）→ boundary 卡片，哪怕话里没有任何红线词', async () => {
    const { graph, calls } = build();
    const state = await graph.invoke({ message: COMPLETE, training_years_band: 'lt_3m' });
    expect(state.card?.kind).toBe('boundary');
    expect(calls).toHaveLength(0);
  });

  it('纯求评估 → 不落库、不出记录卡片', async () => {
    const { graph, calls } = build();
    const state = await graph.invoke({ message: '帮我看看最近怎么样' });
    expect(state.intent).toBe('assess');
    expect(state.card).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('评估接线', () => {
  function buildWithAssess(fail = false) {
    const s = stub();
    const calls: AssessInput[] = [];
    const graph = buildTurnGraph({
      llm: createFakeClient(),
      persistWorkout: s.persistWorkout,
      assess: async (input) => {
        calls.push(input);
        if (fail) throw new Error('boom');
        return { card: null, notices: ['评估桩'] };
      },
      now: () => NOW,
    });
    return { graph, calls };
  }

  it('纯评估 → 不带 related_record_id（评估最近一次）', async () => {
    const { graph, calls } = buildWithAssess();
    await graph.invoke({ message: '帮我评估一下' });
    expect(calls).toEqual([{ user_id: '00000000-0000-4000-8000-000000000001', related_record_id: null, trigger: 'explicit' }]);
  });

  it('混合意图 → 评估本轮刚落库的那条', async () => {
    const { graph, calls } = buildWithAssess();
    const state = await graph.invoke({ message: '卧推 70kg×8 四组，帮我看下够不够' });
    expect(state.card?.kind).toBe('workout');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.related_record_id).toBe('stub-1');
  });

  it('评估挂了也不吞掉录入卡片', async () => {
    const { graph } = buildWithAssess(true);
    const state = await graph.invoke({ message: '卧推 70kg×8 四组，帮我看下够不够' });
    expect(state.card?.kind).toBe('workout');
    expect(state.assessment).toBeNull();
    expect(state.notices).toContain('评估暂时没生成出来，稍后再试');
  });
});