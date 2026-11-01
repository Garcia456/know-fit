import { boolean, date, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid, vector } from 'drizzle-orm/pg-core';

/** 探针表 —— 证明 vector 扩展与 HNSW 索引建得起来。不要删。 */
export const smoke = pgTable('smoke', {
  id: integer('id').primaryKey(),
  note: text('note'),
  embedding: vector('embedding', { dimensions: 1024 }),
});

/** 用户表。邮箱密码登录；邮箱统一存小写。 */
export const user = pgTable(
  'user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    nickname: text('nickname').notNull(),
    birthday: date('birthday'),
    gender: text('gender'), // '男' | '女' | '其他'
    bio: text('bio'),
    /** 头像：压缩后的 data URL，只存一份；null = 用昵称首字 */
    avatar: text('avatar'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('user_email_unique').on(t.email)],
);

/** 会话表。只存 token 的 SHA-256 哈希，注销 / 过期即删。 */
export const authSession = pgTable(
  'auth_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('auth_session_token_hash_unique').on(t.tokenHash),
    index('auth_session_user_index').on(t.userId),
    index('auth_session_expiry_index').on(t.expiresAt),
  ],
);

/** 知识授权表：一行 = 某用户可检索某受限平台。无行 = 不可见。 */
export const knowledgeAccess = pgTable(
  'knowledge_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('knowledge_access_user_platform_unique').on(t.userId, t.platform)],
);

/** 档案表。training_started_on 是「是否 < 3 个月」那个边界判定的依据。 */
export const userProfile = pgTable('user_profile', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  heightCm: real('height_cm'),
  goal: text('goal'), // '增肌' | '减脂' | '维持' | '增肌+减脂'
  /** 开始训练的月份（当月 1 日）；读时按月折算年 / 月 */
  trainingStartedOn: date('training_started_on'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 体重历史 —— 同一天覆盖，跨天保留。 */
export const bodyMetric = pgTable(
  'body_metric',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    weightKg: real('weight_kg').notNull(),
    bodyFatPct: real('body_fat_pct'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('body_metric_user_date_unique').on(t.userId, t.date)],
);

/** F7 提示留痕 —— 同一断点只出现一次。 */
export const recoveryNudge = pgTable(
  'recovery_nudge',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => workoutSession.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // '补全' | '断流'
    shownAt: timestamp('shown_at', { withTimezone: true }).notNull().defaultNow(),
    action: text('action'), // '补全' | '忽略' | '未响应'
  },
  (t) => [
    index('recovery_nudge_user_shown_index').on(t.userId, t.shownAt),
    uniqueIndex('recovery_nudge_user_type_session_unique').on(t.userId, t.type, t.sessionId),
  ],
);

/** 会话。首次发送才创建，不产生空会话。 */
export const conversation = pgTable(
  'conversation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(), // 首条用户消息截断 20 字；可重命名
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** 置顶时间；null = 未置顶 */
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
  },
  (t) => [index('conversation_user_updated_index').on(t.userId, t.updatedAt)],
);

/** 对话轮次。intent 留痕；linked_record_id 是「说错了怎么改」的定位锚。 */
export const conversationTurn = pgTable(
  'conversation_turn',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 旧数据迁移时回填；新写入必填 */
    conversationId: uuid('conversation_id').references(() => conversation.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user' | 'assistant'
    content: text('content').notNull(), // 用户原话 / 卡片文案（不是知识库全文）
    intent: text('intent'), // 七类意图之一
    /** 助手轮存整份响应 —— 恢复会话时重建卡片 */
    replyJson: jsonb('reply_json'),
    linkedRecordId: uuid('linked_record_id'), // 指向 workout_session.id；饮食没表，故不设外键
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('conversation_turn_conversation_index').on(t.conversationId, t.createdAt)],
);

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
  isBodyweight: boolean('is_bodyweight').notNull().default(false), // seed equipment 含「自重」
});

/** 一组。容量计算的源数据 —— 这里只写，不算。 */
export const setEntry = pgTable('set_entry', {
  id: uuid('id').primaryKey().defaultRandom(),
  exerciseEntryId: uuid('exercise_entry_id')
    .notNull()
    .references(() => exerciseEntry.id, { onDelete: 'cascade' }),
  order: integer('order').notNull(),
  weightKg: real('weight_kg'), // 已换算为 kg；自重动作里是「额外负重」
  reps: integer('reps'),
  setType: text('set_type').notNull(), // 'warmup' | 'working'
  isInferred: boolean('is_inferred').notNull().default(false), // 系统推测的值
  /** 自重动作算容量时叠加的体重；非自重动作为 null */
  bodyweightKg: real('bodyweight_kg'),
  /** 'failure' 力竭 | 'drop' 递减 */
  tags: text('tags').array().notNull().default([]),
  /** 递减段的每一小段；非递减组为 null */
  drops: jsonb('drops').$type<{ weight_kg: number | null; reps: number | null }[]>(),
});

/**
 * 知识源 —— 每一条采集来的视频一行。
 *
 * `transcript_segments` 存的是**转写全文**（分段 + 时间戳）：
 * 🔴 它只进库、供内部检索用；**任何对外契约都不携带它**
 *    （静态护栏拦字段名；运行期还要遍历响应体断言）。
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

/**
 * 知识片 —— 检索的最小单位，由 `knowledge_source` 的转写切出来。
 *
 * 🔴 `text` 是切片全文：**只进库、绝不出接口**。
 *    `context_prefix` 与它分开存、分开参与 embedding，不参与对外呈现。
 * `content_hash` 是片级幂等键：同一条源重跑不新增片。
 * 下架源时片随行删除。
 */
export const knowledgeChunk = pgTable(
  'knowledge_chunk',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => knowledgeSource.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    /** 引用回溯的定位键 —— 抖音没有分 P，统一记 `p1-<start_ts>` */
    segmentKey: text('segment_key').notNull(),
    text: text('text').notNull(),
    contextPrefix: text('context_prefix').notNull(),
    startTs: real('start_ts').notNull(),
    endTs: real('end_ts').notNull(),
    topicTags: text('topic_tags').array().notNull().default([]),
    exerciseTags: text('exercise_tags').array().notNull().default([]),
    claimType: text('claim_type').notNull(), // '陈述' | '演示' | '寒暄'
    isCitable: boolean('is_citable').notNull(),
    asrConfidence: real('asr_confidence'),
    contentHash: text('content_hash').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
  },
  (t) => [
    uniqueIndex('knowledge_chunk_source_hash_unique').on(t.sourceId, t.contentHash),
    index('knowledge_chunk_source_index').on(t.sourceId, t.chunkIndex),
    index('knowledge_chunk_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

/**
 * 一次评估 —— 不是日志：`has_source` 是无源率的分母。
 *
 * `verdict_json` 是算好的判定（不含措辞）；`advice_text` 是渲染后的建议。
 * `advice_claims` 存结构化 claims —— 钩子幂等要原样返回同一张卡，不重新生成。
 * `pipeline_meta` 只放标识与枚举（模型串 / 降级标记 / 无源原因），**不放原文**。
 */
export const assessment = pgTable(
  'assessment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    trigger: text('trigger').notNull(), // 'explicit' | 'hook'
    relatedRecordId: uuid('related_record_id').references(() => workoutSession.id, {
      onDelete: 'set null',
    }),
    verdictJson: jsonb('verdict_json').notNull(),
    adviceText: text('advice_text').notNull(),
    adviceClaims: jsonb('advice_claims').notNull(),
    hasSource: boolean('has_source').notNull(),
    modelVersion: text('model_version').notNull(),
    judgeModelVersion: text('judge_model_version').notNull(),
    pipelineMeta: jsonb('pipeline_meta').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('assessment_user_created_index').on(t.userId, t.createdAt)],
);

/**
 * 一条引用 —— 一条建议挂一个知识片。
 *
 * 🔴 `quote_start` / `quote_end` 是支撑句在 `knowledge_chunk.text` 里的字符偏移，
 *    **不存引用文本**：读时从 chunk 还原并断言逐字。
 * 片被删时 `chunk_id` 置空、偏移清空，行保留为历史并标 `usability_status = '失效'`。
 */
export const citation = pgTable(
  'citation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessment.id, { onDelete: 'cascade' }),
    chunkId: uuid('chunk_id').references(() => knowledgeChunk.id, { onDelete: 'set null' }),
    urlWithTs: text('url_with_ts').notNull(),
    displayOrder: integer('display_order').notNull(),
    usabilityStatus: text('usability_status').notNull(), // '可用' | '失效'
    quoteStart: integer('quote_start'),
    quoteEnd: integer('quote_end'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('citation_assessment_index').on(t.assessmentId)],
);