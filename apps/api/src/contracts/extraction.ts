import { z } from 'zod';

/**
 * 抽取契约 —— LLM 结构化输出的形状，也就是「自然语言 → 结构化」的落点。
 *
 * 这一层是 T-S 类型层的第一道闸：契约长什么样，决定后面所有节点能拿到什么。
 * 🔴 不含 exercise_id —— 归一化由确定性别名匹配负责（LLM 只出 raw_name）。
 * 🔴 可空字段一律 nullable()：LangChain 的 jsonSchema 通道对 optional() 支持不好。
 */

/** 组标签：力竭 / 递减 / 休息暂停 */
export const SetTagSchema = z.enum(['failure', 'drop', 'rest_pause']);

/** 一组内后续的一小段；weight_kg 为 null = 沿用主段重量 */
export const SetDropSchema = z.object({
  weight_kg: z.number().nullable(),
  reps: z.number().int().nullable(),
});

/** 一组 */
export const SetSchema = z.object({
  weight_kg: z.number().nullable(), // 用户说的那个数字；换算成 kg 由代码做
  weight_unit: z.enum(['kg', 'lb']).nullable(), // 原文单位；null = 没提，按 kg 记
  reps: z.number().int().nullable(),
  set_type: z.enum(['warmup', 'working']),
  is_inferred: z.boolean().default(false), // 系统补出来的值；用户说出的数字（含没带单位）为 false
  /** 缺省 = 无标签（模型没提） */
  tags: z.array(SetTagSchema).optional(),
  /** 主段之后的后续段；weight_kg 为 null = 沿用主段重量 */
  drops: z.array(SetDropSchema).nullable().optional(),
});

/** 一个动作 */
export const ExerciseSchema = z.object({
  raw_name: z.string(), // 原文，必存
  name_confidence: z.enum(['high', 'low']),
  mentioned_sets: z.array(SetSchema),
});

/** 训练侧 */
export const WorkoutSchema = z.object({
  kind: z.literal('workout'),
  day_hint: z.string().nullable(), // 时间状语原文；→ date 由代码解析
  split_label: z.string().nullable(), // 「背日」
  exercises: z.array(ExerciseSchema),
  note: z.string().nullable(),
});

/** 一条饮食项 */
export const MealItemSchema = z.object({
  raw_desc: z.string(), // 「一碗米饭」
  qty: z.number().nullable(),
  unit: z.string().nullable(),
  qty_confidence: z.enum(['high', 'low']),
  estimation_basis: z.string().nullable(), // 估算依据，要能说出口
});

/** 饮食侧 —— 只留契约，不落库、不接界面 */
export const MealSchema = z.object({
  kind: z.literal('meal'),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).nullable(),
  items: z.array(MealItemSchema),
});

export const ExtractionSchema = z.discriminatedUnion('kind', [WorkoutSchema, MealSchema]);

/** 九类意图 */
export const IntentSchema = z.enum([
  'record',
  'edit',
  'assess',
  'mixed',
  'knowledge',
  'chat',
  'reject',
  'boundary',
  'weight',
]);

/** 记体重工具的入参 —— 数值与时间状语都由模型抽，日期由代码解析 */
export const WeightResultSchema = z.object({
  weight_kg: z.number().nullable(),
  day_hint: z.string().nullable(),
});

/**
 * 对话内修改已有记录的入参 —— 模型只负责说「改哪条、改什么」，
 * 定位与写入都由确定性代码做（同 record_weight）。
 */
export const EditRequestSchema = z.object({
  /** 要改的那条记录怎么找 */
  target: z.object({
    day_hint: z.string().nullable(), // 时间状语原文；指「最上面 / 最近一次」填 null
    exercise_name: z.string().nullable(), // 动作名原文；整条训练填 null
  }),
  /** 要改成什么；没有提到的字段填 null */
  changes: z.object({
    day_hint: z.string().nullable(), // 日期改成哪天的时间状语原文
    exercise_name: z.string().nullable(), // 动作名改成什么
    weight_kg: z.number().nullable(),
    reps: z.number().int().nullable(),
  }),
});

/** 缺什么 —— 由代码算，不由 LLM 输出 */
export const MissingFieldSchema = z.enum(['exercises', 'reps', 'weight_kg']);

/** 一条记录的完整度 —— 记录级，不是字段级 */
export const RecordStatusSchema = z.enum(['complete', 'incomplete']);

/** 意图分类的结果形状（结构化输出要一个对象，不要裸字面量） */
export const IntentResultSchema = z.object({ intent: IntentSchema });

export type Set = z.infer<typeof SetSchema>;
export type SetTag = z.infer<typeof SetTagSchema>;
export type SetDrop = z.infer<typeof SetDropSchema>;
export type Exercise = z.infer<typeof ExerciseSchema>;
export type Workout = z.infer<typeof WorkoutSchema>;
export type MealItem = z.infer<typeof MealItemSchema>;
export type Meal = z.infer<typeof MealSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;
export type WeightResult = z.infer<typeof WeightResultSchema>;
export type EditRequest = z.infer<typeof EditRequestSchema>;
export type Intent = z.infer<typeof IntentSchema>;
export type IntentResult = z.infer<typeof IntentResultSchema>;
export type MissingField = z.infer<typeof MissingFieldSchema>;
export type RecordStatus = z.infer<typeof RecordStatusSchema>;