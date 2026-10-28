import { z } from 'zod';

/**
 * 抽取契约 —— LLM 结构化输出的形状，也就是「自然语言 → 结构化」的落点。
 *
 * 这一层是 T-S 类型层的第一道闸：契约长什么样，决定后面所有节点能拿到什么。
 * 🔴 不含 exercise_id —— 归一化由确定性别名匹配负责（LLM 只出 raw_name）。
 * 🔴 可空字段一律 nullable()：LangChain 的 jsonSchema 通道对 optional() 支持不好。
 */

/** 组标签：力竭 / 递减 */
export const SetTagSchema = z.enum(['failure', 'drop']);

/** 递减组的一小段 */
export const SetDropSchema = z.object({
  weight_kg: z.number().nullable(),
  reps: z.number().int().nullable(),
});

/** 一组 */
export const SetSchema = z.object({
  weight_kg: z.number().nullable(), // 用户说的那个数字；换算成 kg 由代码做
  weight_unit: z.enum(['kg', 'lb']).nullable(), // 原文单位；null = 没提，按 kg 记并标记推测
  reps: z.number().int().nullable(),
  set_type: z.enum(['warmup', 'working']),
  is_inferred: z.boolean().default(false), // 系统推测出来的值；模型漏填按「用户原话」处理
  /** 缺省 = 无标签（模型没提） */
  tags: z.array(SetTagSchema).optional(),
  /** 递减组的每段重量×次数；非递减组为空 */
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

/** 七类意图 */
export const IntentSchema = z.enum([
  'record',
  'assess',
  'mixed',
  'knowledge',
  'chat',
  'reject',
  'boundary',
]);

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
export type Intent = z.infer<typeof IntentSchema>;
export type IntentResult = z.infer<typeof IntentResultSchema>;
export type MissingField = z.infer<typeof MissingFieldSchema>;
export type RecordStatus = z.infer<typeof RecordStatusSchema>;