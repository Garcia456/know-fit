import type { EditRequest, Extraction, Exercise, Intent } from '../contracts/extraction.js';

/**
 * 黄金集 —— 输入原文 → 期望结构。
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

  // 容量：已知数值 + 带热身 —— 只算正式组（5×100×5 = 2500；两组 40kg×10 热身要滤掉）
  // ⚠️ 「推-e2e」是**标记 split**：e2e 要靠「没有更早的同 split 记录」验无基线那条，
  //    用真实存在过的 split 名会被开发库里的旧记录搅乱（smoke 不看 split_label）。
  '推日：卧推先热身两组 40kg×10，然后 100kg×5 五组': {
    kind: 'workout',
    day_hint: '昨天',
    split_label: '推-e2e',
    note: null,
    exercises: [
      {
        raw_name: '卧推',
        name_confidence: 'high',
        mentioned_sets: [
          { weight_kg: 40, weight_unit: 'kg', reps: 10, set_type: 'warmup', is_inferred: false },
          { weight_kg: 40, weight_unit: 'kg', reps: 10, set_type: 'warmup', is_inferred: false },
          ...working(5, 100, 'kg', 5),
        ],
      },
    ],
  },

  // 同一个标记 split 的又一条 —— 环比基线拿它当「上一次」（2000 对 2500 → −20%）
  '推日：卧推 80kg×5 五组': {
    kind: 'workout',
    day_hint: '今天',
    split_label: '推-e2e',
    note: null,
    exercises: [{ raw_name: '卧推', name_confidence: 'high', mentioned_sets: working(5, 80, 'kg', 5) }],
  },

  // 歧义动作 → exercise_id 落 null（不缺，是不强行归并的正式落点）
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

  // 多意图 → 只落库（评估还没接）
  '卧推 70kg×8 四组，帮我看下够不够': {
    kind: 'workout',
    day_hint: null,
    split_label: null,
    note: null,
    exercises: [{ raw_name: '卧推', name_confidence: 'high', mentioned_sets: working(4, 70, 'kg', 8) }],
  },

  // 标记 split 的混合意图 —— rag:check 用它验「落库后接着评估」这条边
  '推日：卧推 70kg×5 五组，帮我看下够不够': {
    kind: 'workout',
    day_hint: null,
    split_label: 'rag-check',
    note: null,
    exercises: [{ raw_name: '卧推', name_confidence: 'high', mentioned_sets: working(5, 70, 'kg', 5) }],
  },

  // 饮食：只走契约，不落库、不接界面
  '午饭吃了两碗米饭': {
    kind: 'meal',
    meal_type: 'lunch',
    items: [{ raw_desc: '米饭', qty: 2, unit: '碗', qty_confidence: 'high', estimation_basis: null }],
  },

  // 自重动作：没说重量 = 自重，不算缺
  '引体向上四组每组八个': {
    kind: 'workout',
    day_hint: null,
    split_label: '背',
    note: null,
    exercises: [{ raw_name: '引体向上', name_confidence: 'high', mentioned_sets: working(4, null, null, 8) }],
  },

  // 自重 + 负重：weight_kg 只记额外负重
  '引体向上负重 10kg 四组每组六个': {
    kind: 'workout',
    day_hint: null,
    split_label: '背',
    note: null,
    exercises: [{ raw_name: '引体向上', name_confidence: 'high', mentioned_sets: working(4, 10, 'kg', 6) }],
  },

  // 动作名逐字保留：不能被归一成「高位下拉」
  '对握高位下拉 60kg×10 三组': {
    kind: 'workout',
    day_hint: null,
    split_label: '背',
    note: null,
    exercises: [
      { raw_name: '对握高位下拉', name_confidence: 'high', mentioned_sets: working(3, 60, 'kg', 10) },
    ],
  },

  // 力竭组：最后一组带 failure
  '卧推 100kg×8 三组，最后一组力竭': {
    kind: 'workout',
    day_hint: null,
    split_label: '推-e2e',
    note: null,
    exercises: [
      {
        raw_name: '卧推',
        name_confidence: 'high',
        mentioned_sets: [
          ...working(2, 100, 'kg', 8),
          { weight_kg: 100, weight_unit: 'kg', reps: 8, set_type: 'working', is_inferred: false, tags: ['failure'] },
        ],
      },
    ],
  },

  // 递减组：主段写 weight/reps，后续段只进 drops；用户明说「递减」才带 drop 标签
  '侧平举 12kg×10 递减到 8kg×10 再 6kg×12 三组': {
    kind: 'workout',
    day_hint: null,
    split_label: '肩-e2e',
    note: null,
    exercises: [
      {
        raw_name: '侧平举',
        name_confidence: 'high',
        mentioned_sets: working(3, 12, 'kg', 10).map((s) => ({
          ...s,
          tags: ['drop'] as ('failure' | 'drop' | 'rest_pause')[],
          drops: [
            { weight_kg: 8, reps: 10 },
            { weight_kg: 6, reps: 12 },
          ],
        })),
      },
    ],
  },
};

/** 修改已有记录的固定解析 —— 替身用它走通修改链路（不证明模型抽得准） */
export const EDIT_FIXTURES: Record<string, EditRequest> = {
  '今天的器械卧推单边改成器械卧推，重量60kg': {
    target: { day_hint: '今天', exercise_name: '器械卧推单边' },
    changes: { day_hint: null, exercise_name: '器械卧推', weight_kg: 60, reps: null },
  },
  '把最上面的训练改成昨天的': {
    target: { day_hint: null, exercise_name: null },
    changes: { day_hint: '昨天', exercise_name: null, weight_kg: null, reps: null },
  },
};

/** 黄金集里非抽取类的输入（闲聊 / 红线 / 非目标）—— 给真实 smoke 算意图准确率用 */
export const GOLDEN_INTENTS: Record<string, Intent> = {
  '卧推 70kg×8 四组，飞鸟 15kg×12 三组，深蹲 100kg×5 五组': 'record',
  '卧推做了四组，每组 8 个': 'record',
  '今天练了背': 'record',
  '卧推 155 磅 五组五次': 'record',
  '卧推先热身两组 40kg，然后 100kg 五组': 'record',
  '推日：卧推先热身两组 40kg×10，然后 100kg×5 五组': 'record',
  '推日：卧推 80kg×5 五组': 'record',
  '飞鸟 15kg 三组十二次': 'record',
  '昨天练了胸': 'record',
  '午饭吃了两碗米饭': 'record',
  '引体向上四组每组八个': 'record',
  '引体向上负重 10kg 四组每组六个': 'record',
  '对握高位下拉 60kg×10 三组': 'record',
  '卧推 100kg×8 三组，最后一组力竭': 'record',
  '侧平举 12kg×10 递减到 8kg×10 再 6kg×12 三组': 'record',
  '卧推 70kg×8 四组，帮我看下够不够': 'mixed',
  '推日：卧推 70kg×5 五组，帮我看下够不够': 'mixed',
  '今天的器械卧推单边改成器械卧推，重量60kg': 'edit',
  '把最上面的训练改成昨天的': 'edit',
  '我不太想练了': 'chat',
  'hi': 'chat',
  '你是谁': 'chat',
  '练胸有什么推荐动作': 'knowledge',
  '深蹲怎么练才标准': 'knowledge',
  '膝盖疼还能练吗': 'reject',
  '我 14 岁，能练吗': 'boundary',
};