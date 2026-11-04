import { describe, expect, it } from 'vitest';
import type { Citation } from '../contracts/assessment.js';
import type { KnowledgeCard } from '../contracts/turn.js';
import { createFakeClient } from '../llm/fake.js';
import type { LlmClient } from '../llm/client.js';
import { answerKnowledge } from '../knowledge/service.js';
import type { TrainingFrequency } from '../contracts/sessions.js';
import { PLAN_DAYS_ASK, PLAN_FREQUENCY_ASK, answerPlan } from './plan.js';

/** 计划服务 —— 替身 LLM + 桩写库/检索，不连库。 */

const USER = '00000000-0000-4000-8000-000000000001';

const CITATION: Citation = {
  citation_id: 'C1',
  creator: '测试博主',
  title: '三分化训练安排',
  url: 'https://example.com/v',
  start_ts: 12,
  short_quote: '每个部位每周练两次比较稳',
};

function knowledge(hasSource: boolean): typeof answerKnowledge {
  return async (): Promise<KnowledgeCard> => ({
    kind: 'knowledge',
    answer: '先把复合动作排前面。',
    claims: hasSource ? [{ claim: '每个部位每周练两次比较稳', citation_id: 'C1' }] : [],
    citations: hasSource ? [CITATION] : [],
    has_source: hasSource,
    no_source_notice: hasSource ? null : '这次没找到能直接引用的原片。',
  });
}

function build(overrides: {
  frequency?: TrainingFrequency | null;
  message?: string;
  hasSource?: boolean;
  llm?: LlmClient;
  saveFails?: boolean;
  saved?: { value: TrainingFrequency | null };
} = {}) {
  const saved = overrides.saved ?? { value: null };
  return answerPlan(
    {
      user_id: USER,
      message: overrides.message ?? '帮我出个训练计划',
      history: [],
      frequency: overrides.frequency ?? null,
      goal: null,
      band: '3m_2y',
    },
    {
      llm: overrides.llm ?? createFakeClient(),
      knowledge: knowledge(overrides.hasSource ?? true),
      saveFrequency: async (_user_id, frequency) => {
        if (overrides.saveFails) throw new Error('boom');
        saved.value = frequency;
      },
    },
  );
}

describe('answerPlan：频率从哪来', () => {
  it('档案空、话里也没说 → 先问频率，不排计划', async () => {
    const card = await build();
    expect(card).toEqual({ kind: 'chat', reply: PLAN_FREQUENCY_ASK });
  });

  it('话里报了三分化 → 直接排，并写回档案', async () => {
    const saved = { value: null as TrainingFrequency | null };
    const card = await build({ message: '帮我排个三分化训练计划', saved });
    if (card.kind !== 'plan') throw new Error('应该是计划卡');
    expect(card.split).toBe('三分化');
    expect(card.cycle).toBe('练 3 天休 1 天');
    expect(card.days).toHaveLength(3);
    expect(saved.value).toBe('三分化');
  });

  it('档案里有频率 → 不用再问，也不重复写库', async () => {
    const saved = { value: null as TrainingFrequency | null };
    const card = await build({ frequency: '四分化', saved });
    if (card.kind !== 'plan') throw new Error('应该是计划卡');
    expect(card.split).toBe('四分化');
    // 只列循环里的训练日，不铺满一周
    expect(card.days.map((d) => d.day)).toEqual([1, 2, 3, 4]);
    expect(card.days.every((d) => d.kind === 'train')).toBe(true);
    expect(saved.value).toBeNull();
  });

  it('写档案失败不挡计划，只在提示里说', async () => {
    const card = await build({ message: '三分化', saveFails: true });
    if (card.kind !== 'plan') throw new Error('应该是计划卡');
    expect(card.notes.some((n) => n.includes('没写进档案'))).toBe(true);
  });
});

describe('answerPlan：不规律要先问天数', () => {
  it('只说「不规律」→ 问每周几天，频率先写回', async () => {
    const saved = { value: null as TrainingFrequency | null };
    const card = await build({ message: '我不规律，帮我排个计划', saved });
    expect(card).toEqual({ kind: 'chat', reply: PLAN_DAYS_ASK });
    expect(saved.value).toBe('不规律');
  });

  it('档案里是不规律、这一轮报了天数 → 按天数铺开', async () => {
    const card = await build({ frequency: '不规律', message: '每周 3 天' });
    if (card.kind !== 'plan') throw new Error('应该是计划卡');
    expect(card.split).toBe('不规律');
    expect(card.cycle).toBe('每周练 3 天');
    expect(card.days.filter((d) => d.kind === 'train')).toHaveLength(3);
  });
});

describe('answerPlan：训练日与来源', () => {
  it('只列一个循环的训练日，不按 7 天重复', async () => {
    const card = await build({ frequency: '三分化' });
    if (card.kind !== 'plan') throw new Error('应该是计划卡');
    expect(card.days.map((d) => d.day)).toEqual([1, 2, 3]);
    expect(card.days.every((d) => d.kind === 'train')).toBe(true);
    expect(card.days.every((d) => d.exercises.length > 0)).toBe(true);
    // 练三休一由 cycle 文案表达，不占表格行
    expect(card.cycle).toBe('练 3 天休 1 天');
  });

  it('检索有源 → 引用与依据挂上卡', async () => {
    const card = await build({ frequency: '三分化', hasSource: true });
    if (card.kind !== 'plan') throw new Error('应该是计划卡');
    expect(card.has_source).toBe(true);
    expect(card.citations).toEqual([CITATION]);
    expect(card.basis).toHaveLength(1);
    expect(card.no_source_notice).toBeNull();
    expect(card.ai_generated).toBe(true);
  });

  it('检索没源 → 照出计划，但明确标注 AI 编排', async () => {
    const card = await build({ frequency: '三分化', hasSource: false });
    if (card.kind !== 'plan') throw new Error('应该是计划卡');
    expect(card.has_source).toBe(false);
    expect(card.citations).toEqual([]);
    expect(card.no_source_notice).toContain('AI 编排');
  });

  it('模型没给标题 → 照出计划，标题用频率兜底', async () => {
    const base = createFakeClient();
    const llm = {
      ...base,
      structured: (async (req, options) => {
        const out = (await base.structured(req, options)) as Record<string, unknown>;
        if (req.name !== 'plan') return out;
        const rest: Record<string, unknown> = { ...out };
        delete rest.title;
        return rest;
      }) as typeof base.structured,
    };
    const card = await build({ frequency: '三分化', llm });
    if (card.kind !== 'plan') throw new Error('应该是计划卡');
    expect(card.title).toBe('三分化训练计划');
    expect(card.days.filter((d) => d.kind === 'train')).toHaveLength(3);
  });

  it('模型少给了训练日 → 不出残缺周计划，让它重试', async () => {
    const base = createFakeClient();
    const llm = {
      ...base,
      structured: (async (req, options) => {
        const out = (await base.structured(req, options)) as Record<string, unknown>;
        if (req.name !== 'plan') return out;
        return { ...out, training_days: (out.training_days as unknown[]).slice(0, 1) };
      }) as typeof base.structured,
    };
    const card = await build({ frequency: '三分化', llm });
    expect(card.kind).toBe('chat');
    expect(card.kind === 'chat' ? card.reply : '').toContain('没排出完整的训练日');
  });
});