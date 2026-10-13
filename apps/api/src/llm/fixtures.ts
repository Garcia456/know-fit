import type { Extraction, Exercise, Intent } from '../contracts/extraction.js';

/**
 * 黄金集（定义 §1.7）—— 输入原文 → 期望结构。
 *
 * ⚠️ fixture 测的是**管道**（抽取 → 规范化 → 落库 → 卡片走没走通）。
 * **准确率数字只能来自真实模型**（`llm:smoke`）—— 拿 fixture 算准确率是循环论证。
 */

/** 同规格的正式组，fixture 里最常见 */
function working(count: number, weight: number | null, unit: 'kg' | 'lb' | null, reps: number | null): Exercise['mentioned_sets'] {
  return Array.from({ length: count }, () => ({
    weight_kg: weight,
    weight_unit: unit,
    reps,
    set_type: 'working' as const,
    is_inferred: false,
  }));
}

/** 什么都没抽到时落这个 —— 例如「今天练了背」，动作数为 0 是**正确结果**（US-A3） */
export const EMPTY_WORKOUT: Extraction = {
  kind: 'workout',
  day_hint: null,
  split_label: null,
  exercises: [],
  note: null,
};

export const EXTRACTION_FIXTURES: Record<string, Extraction> = {
  // 完整：3 动作 12 组（§一 的一句话验收）
  '卧推 70kg×8 四组，飞鸟 15kg×12 三组，深蹲 100kg×5 五组': {
    kind: 'workout',
    day_hint: null,
    split_label: null,
    note: null,
    exercises: [
      { raw_name: '卧推', name_confidence: 'high', mentioned_sets: working(4, 70, 'kg', 8) },
      { raw_name: '飞鸟', name_confidence: 'high', mentioned_sets: working(3, 15, 'kg', 12) },
      { raw_name: '深蹲', name_confidence: 'high', mentioned_sets: working(5, 100, 'kg', 5) },
    ],
  },

  // 缺重量 → missing_fields 里应出现 weight_kg
  '卧推做了四组，每组 8 个': {
    kind: 'workout',
    day_hint: null,
    split_label: null,
    note: null,
    exercises: [{ raw_name: '卧推', name_confidence: 'high', mentioned_sets: working(4, null, null, 8) }],
  },

  // 只说部位 → 动作数为 0，但 status 是 incomplete 而不是失败
  '今天练了背': {
    kind: 'workout',
    day_hint: '今天',
    split_label: '背',
    note: null,
    exercises: [],
  },

  // 单位：lb 原样记，换算由代码做
  '卧推 155 磅 五组五次': {
    kind: 'workout',
    day_hint: null,
    split_label: null,
    note: null,
    exercises: [{ raw_name: '卧推', name_confidence: 'high', mentioned_sets: working(5, 155, 'lb', 5) }],
  },

  // 组类型：热身 + 正式
  '卧推先热身两组 40kg，然后 100kg 五组': {
    kind: 'workout',
    day_hint: null,
    split_label: null,
    note: null,
    exercises: [
      {
        raw_name: '卧推',
        name_confidence: 'high',
        mentioned_sets: [
          { weight_kg: 40, weight_unit: 'kg', reps: null, set_type: 'warmup', is_inferred: false },
          { weight_kg: 40, weight_unit: 'kg', reps: null, set_type: 'warmup', is_inferred: false },
          ...working(5, 100, 'kg', null),
        ],
      },
    ],
  },

  // 歧义动作 → exercise_id 落 null（不缺，是 PRD §8.1 不强行归并的正式落点）
  '飞鸟 15kg 三组十二次': {
    kind: 'workout',
    day_hint: null,
    split_label: null,
    note: null,
    exercises: [{ raw_name: '飞鸟', name_confidence: 'high', mentioned_sets: working(3, 15, 'kg', 12) }],
  },

  // 时间状语 → day_hint 存原文，date 由代码解析
  '昨天练了胸': {
    kind: 'workout',
    day_hint: '昨天',
    split_label: '胸',
    note: null,
    exercises: [],
  },

  // 多意图 → dev-002 只落库（评估是 dev-005）
  '卧推 70kg×8 四组，帮我看下够不够': {
    kind: 'workout',
    day_hint: null,
    split_label: null,
    note: null,
    exercises: [{ raw_name: '卧推', name_confidence: 'high', mentioned_sets: working(4, 70, 'kg', 8) }],
  },

  // 饮食：只走契约，不落库、不接界面
  '午饭吃了两碗米饭': {
    kind: 'meal',
    meal_type: 'lunch',
    items: [{ raw_desc: '米饭', qty: 2, unit: '碗', qty_confidence: 'high', estimation_basis: null }],
  },
};

/** 黄金集里非抽取类的输入（闲聊 / 红线 / 非目标）—— 给真实 smoke 算意图准确率用 */
export const GOLDEN_INTENTS: Record<string, Intent> = {
  '卧推 70kg×8 四组，飞鸟 15kg×12 三组，深蹲 100kg×5 五组': 'record',
  '卧推做了四组，每组 8 个': 'record',
  '今天练了背': 'record',
  '卧推 155 磅 五组五次': 'record',
  '卧推先热身两组 40kg，然后 100kg 五组': 'record',
  '飞鸟 15kg 三组十二次': 'record',
  '昨天练了胸': 'record',
  '午饭吃了两碗米饭': 'record',
  '卧推 70kg×8 四组，帮我看下够不够': 'mixed',
  '我不太想练了': 'chat',
  '膝盖疼还能练吗': 'reject',
  '我 14 岁，能练吗': 'boundary',
};