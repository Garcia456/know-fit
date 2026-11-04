import { z } from 'zod';
import type { TrainingFrequency } from '../contracts/sessions.js';
import type { KnowledgeCard, PlanCard, PlanExercise, TurnCard } from '../contracts/turn.js';
import { createLlmClient } from '../llm/index.js';
import type { LlmClient } from '../llm/client.js';
import { PLAN_DRAFT_SYSTEM } from '../llm/prompts.js';
import { answerKnowledge } from '../knowledge/service.js';
import {
  cycleSlots,
  frequencyIn,
  splitDayCount,
  weeklyDaysIn,
} from '../plan/rules.js';
import type { TurnHistoryItem } from '../graph/state.js';
import { saveTrainingFrequency } from './profile.js';

/** 计划生成 —— 档案与用户原话决定频率；LLM 只排训练日模板，循环顺序由代码展开。 */

export const PLAN_FREQUENCY_ASK =
  '你现在的训练频率是？二分化 / 三分化 / 四分化 / 五分化 / 不规律 —— 选一个，我按它排训练计划。';
export const PLAN_DAYS_ASK = '每周能练几天？比如「每周 3 天」。';

const PlanDraftSchema = z.object({
  // 标题可缺省：模型偶尔只回 training_days，别因此整份计划失败
  title: z.string().optional(),
  training_days: z
    .array(
      z.object({
        focus: z.string(),
        exercises: z.array(
          z.object({
            name: z.string(),
            sets: z.number().int().positive().nullable(),
            reps: z.string(),
            note: z.string().nullable(),
          }),
        ),
      }),
    )
    .min(1)
    .max(7),
});

interface PlanInput {
  user_id: string;
  message: string;
  history: TurnHistoryItem[];
  frequency: TrainingFrequency | null;
  goal: string | null;
  band: 'lt_3m' | '3m_2y' | 'gt_2y';
}

interface PlanDeps {
  llm?: LlmClient;
  knowledge?: typeof answerKnowledge;
  saveFrequency?: typeof saveTrainingFrequency;
}

function chat(reply: string): TurnCard {
  return { kind: 'chat', reply };
}

function draftInput(input: {
  frequency: TrainingFrequency;
  splitCount: number;
  goal: string | null;
  band: PlanInput['band'];
}): string {
  return [
    `训练频率：${input.frequency}`,
    `训练日数量：${input.splitCount}`,
    `目标：${input.goal ?? '增肌（档案未填，按增肌默认）'}`,
    `训练年限：${input.band}`,
    '可用器械：健身房',
  ].join('\n');
}

/** 同一轮里用户报的频率写回档案；失败不挡计划。 */
async function persistFrequency(
  save: typeof saveTrainingFrequency,
  user_id: string,
  frequency: TrainingFrequency,
): Promise<boolean> {
  try {
    await save(user_id, frequency);
    return true;
  } catch {
    return false;
  }
}

export async function answerPlan(input: PlanInput, deps: PlanDeps = {}): Promise<TurnCard> {
  const messageFrequency = frequencyIn(input.message);
  const frequency = messageFrequency ?? input.frequency;

  if (!frequency) return chat(PLAN_FREQUENCY_ASK);

  // 用户这轮报了频率就写回档案 —— 不规律还要接着问天数，也必须先记住
  const notes: string[] = [];
  if (messageFrequency && messageFrequency !== input.frequency) {
    const saved = await persistFrequency(
      deps.saveFrequency ?? saveTrainingFrequency,
      input.user_id,
      messageFrequency,
    );
    if (!saved) notes.push('训练频率这次没写进档案，稍后可在「我的」里直接选。');
  }

  let splitCount = splitDayCount(frequency);
  let irregular = false;
  let cycle: string;

  if (frequency === '不规律') {
    const days = weeklyDaysIn(input.message);
    if (days === null) return chat(PLAN_DAYS_ASK);
    splitCount = days;
    irregular = true;
    cycle = `每周练 ${days} 天`;
  } else {
    cycle = `练 ${splitCount} 天休 1 天`;
  }

  if (!splitCount) return chat(PLAN_FREQUENCY_ASK);

  const llm = deps.llm ?? createLlmClient();
  let draft: z.infer<typeof PlanDraftSchema>;
  try {
    draft = await llm.structured({
      system: PLAN_DRAFT_SYSTEM,
      input: draftInput({ frequency, splitCount, goal: input.goal, band: input.band }),
      schema: PlanDraftSchema,
      name: 'plan',
    });
  } catch {
    return chat('这次计划没排出来，再说一次「帮我出个训练计划」试试。');
  }

  if (draft.training_days.length < splitCount) {
    return chat('这次没排出完整的训练日，再试一次。');
  }
  const templates = draft.training_days.slice(0, splitCount);

  const days = cycleSlots(splitCount).map((slot) => {
    if (slot.trainIndex === null) {
      return { day: slot.day, kind: 'rest' as const, focus: null, exercises: [] };
    }
    const template = templates[slot.trainIndex]!;
    const exercises: PlanExercise[] = template.exercises.map((ex) => ({
      name: ex.name,
      sets: ex.sets,
      reps: ex.reps,
      note: ex.note,
    }));
    return {
      day: slot.day,
      kind: 'train' as const,
      focus: template.focus,
      exercises,
    };
  });

  notes.unshift(
    irregular
      ? `${frequency}：${cycle}，表内按训练日排列，间隔按自己的时间安排。`
      : `${frequency}：${cycle}，表内是 1 个循环，做完从第 1 天重新开始。`,
    '可用器械按「健身房」默认；需要在家练可以在「我的」里补充。',
    '训练日编排与组次由 AI 生成；动作与原则尽量引用博主原片。',
  );
  if (input.goal === null) notes.push('目标未填，按增肌编排；可在「我的」里改目标。');
  if (input.band === 'lt_3m') notes.push('新手阶段：重量以能标准完成为准，先把动作模式练稳。');

  let knowledge: KnowledgeCard | null = null;
  try {
    knowledge = await (deps.knowledge ?? answerKnowledge)({
      user_id: input.user_id,
      query: `${frequency}训练计划 动作安排`,
    });
  } catch {
    // 检索失败按无源处理，计划照出
  }

  const hasSource = knowledge?.has_source === true;
  const card: PlanCard = {
    kind: 'plan',
    title: draft.title?.trim() || `${frequency}训练计划`,
    split: frequency,
    cycle,
    days,
    notes,
    ai_generated: true,
    citations: hasSource ? knowledge!.citations : [],
    basis: hasSource ? knowledge!.claims : [],
    has_source: hasSource,
    no_source_notice: hasSource
      ? null
      : '这次没找到能直接引用的博主原片；动作与组次由 AI 编排。',
  };
  return card;
}