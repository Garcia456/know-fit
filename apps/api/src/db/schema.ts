import { boolean, date, integer, jsonb, pgTable, real, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core';

/** 探针表 —— 证明 vector 扩展与 HNSW 索引建得起来。不要删。 */
export const smoke = pgTable('smoke', {
  id: integer('id').primaryKey(),
  note: text('note'),
  embedding: vector('embedding', { dimensions: 1024 }),
});

/** 用户表。v1 单用户，迁移 0002 里种一个固定 id，无鉴权。 */
export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 档案表。training_years_band 是「是否 < 3 个月」那个边界判定的依据。 */
export const userProfile = pgTable('user_profile', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  goal: text('goal'),
  trainingYearsBand: text('training_years_band'), // 'lt_3m' | '3m_2y' | 'gt_2y'
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 对话轮次。intent 留痕；linked_record_id 是「说错了怎么改」的定位锚。 */
export const conversationTurn = pgTable('conversation_turn', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(), // 用户原话 / 卡片文案（不是知识库全文）
  intent: text('intent'), // 六类意图之一
  linkedRecordId: uuid('linked_record_id'), // 指向 workout_session.id；饮食没表，故不设外键
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 一次训练。status / missing_fields 由确定性代码算，是 F7 的数据基础。 */
export const workoutSession = pgTable('workout_session', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  date: date('date').notNull(), // 'YYYY-MM-DD'
  splitLabel: text('split_label'), // 「背日」
  status: text('status').notNull(), // 'complete' | 'incomplete'
  missingFields: text('missing_fields').array().notNull().default([]),
  notes: text('notes'), // 用户顺口说的备注，原文
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 一次训练里的一个动作。raw_name 与 exercise_id 都存：前者才能回溯是谁错了。 */
export const exerciseEntry = pgTable('exercise_entry', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => workoutSession.id, { onDelete: 'cascade' }),
  order: integer('order').notNull(),
  rawName: text('raw_name').notNull(), // 用户原话里的动作名
  exerciseId: text('exercise_id'), // null = 不强行归并，不是错误
  nameConfidence: text('name_confidence'), // 'high' | 'low'
  regionFallback: text('region_fallback'), // 歧义动作的部位兜底，如 'region_back'
});

/** 一组。容量计算的源数据 —— 这里只写，不算。 */
export const setEntry = pgTable('set_entry', {
  id: uuid('id').primaryKey().defaultRandom(),
  exerciseEntryId: uuid('exercise_entry_id')
    .notNull()
    .references(() => exerciseEntry.id, { onDelete: 'cascade' }),
  order: integer('order').notNull(),
  weightKg: real('weight_kg'), // 已换算为 kg
  reps: integer('reps'),
  setType: text('set_type').notNull(), // 'warmup' | 'working'
  isInferred: boolean('is_inferred').notNull().default(false), // 系统推测的值
});

/**
 * 知识源 —— 每一条采集来的视频一行。
 *
 * `transcript_segments` 存的是**转写全文**（分段 + 时间戳）：
 * 🔴 它只进库、供内部检索用；**任何对外契约都不携带它**
 *    （护栏 R-B 拦字段名，运行期那条仍挂 dev-005）。
 * `is_indexable = false` 是下架开关：置 false 时连同转写一起清掉。
 * `content_hash` 是下架时按内容定位的锚，转写清掉后仍保留。
 */
export const knowledgeSource = pgTable('knowledge_source', {
  id: uuid('id').primaryKey().defaultRandom(),
  creator: text('creator').notNull(),
  platform: text('platform').notNull(), // v1 只有 'douyin'
  videoId: text('video_id').notNull(),
  title: text('title').notNull(),
  originalUrl: text('original_url').notNull(),
  durationSec: integer('duration_sec'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  complianceStatus: text('compliance_status').notNull(), // 'ok' | 'retired'

  platformVideoKey: text('platform_video_key').notNull().unique(),
  subtitleSource: text('subtitle_source').notNull(), // v1 只有 'asr'
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  robotsCheckedAt: timestamp('robots_checked_at', { withTimezone: true }).notNull(),
  robotsAllowed: boolean('robots_allowed'), // null = 检查过但结论不适用
  isIndexable: boolean('is_indexable').notNull().default(true),
  topicDomain: text('topic_domain'),

  transcriptSegments: jsonb('transcript_segments'),
  contentHash: text('content_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});