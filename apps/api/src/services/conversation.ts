import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Intent } from '../contracts/extraction.js';
import type { TurnResponse } from '../contracts/turn.js';
import type { TurnHistoryItem } from '../graph/state.js';
import { conversation, conversationTurn } from '../db/schema.js';
import { getDb } from './pool.js';

/**
 * 会话与消息的读写。
 * 🔴 删的是聊天记录，不动 workout_session / assessment / citation。
 */

export const TITLE_MIN = 1;
export const TITLE_MAX = 40;
/** 首条消息截断 —— 不调 LLM */
const AUTO_TITLE_LEN = 20;
export const HISTORY_ROUNDS = 6;

export class ConversationNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super('会话不存在');
    this.name = 'ConversationNotFoundError';
  }
}

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** 置顶时间；null = 未置顶 */
  pinned_at: string | null;
  last_message: string | null;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  intent: Intent | null;
  /** 助手轮才有 —— 恢复会话时重建卡片 */
  response: TurnResponse | null;
  created_at: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
}

function autoTitle(message: string): string {
  const flat = message.trim().replace(/\s+/g, ' ');
  const chars = [...flat];
  return chars.length === 0 ? '新对话' : chars.slice(0, AUTO_TITLE_LEN).join('');
}

export function normalizeTitle(raw: string): string | null {
  const title = raw.trim();
  const length = [...title].length;
  if (length < TITLE_MIN || length > TITLE_MAX) return null;
  return title;
}

/** 有 id 就校验归属；没有就在首次发送时建会话 */
export async function resolveConversation(input: {
  user_id: string;
  conversation_id?: string | null;
  first_message: string;
}): Promise<string> {
  const db = getDb();

  if (input.conversation_id) {
    const rows = await db
      .select({ id: conversation.id })
      .from(conversation)
      .where(
        and(
          eq(conversation.id, input.conversation_id),
          eq(conversation.userId, input.user_id),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new ConversationNotFoundError();
    return rows[0].id;
  }

  const [row] = await db
    .insert(conversation)
    .values({ userId: input.user_id, title: autoTitle(input.first_message) })
    .returning({ id: conversation.id });
  if (!row) throw new Error('conversation 插入没有返回 id');
  return row.id;
}

/** 最近 6 轮 —— 读 12 条消息再正序交给图 */
export async function loadRecentHistory(conversationId: string): Promise<TurnHistoryItem[]> {
  const rows = await getDb()
    .select({ role: conversationTurn.role, content: conversationTurn.content })
    .from(conversationTurn)
    .where(eq(conversationTurn.conversationId, conversationId))
    .orderBy(desc(conversationTurn.createdAt))
    .limit(HISTORY_ROUNDS * 2);

  return rows
    .reverse()
    .flatMap((r) =>
      r.role === 'user' || r.role === 'assistant'
        ? [{ role: r.role, content: r.content } as TurnHistoryItem]
        : [],
    );
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      pinnedAt: conversation.pinnedAt,
    })
    .from(conversation)
    .where(eq(conversation.userId, userId))
    // 置顶在前；DESC 默认 NULLS FIRST，必须显式压到后面
    .orderBy(sql`${conversation.pinnedAt} desc nulls last`, desc(conversation.updatedAt))
    .limit(50);

  if (rows.length === 0) return [];

  const turns = await db
    .select({
      conversationId: conversationTurn.conversationId,
      content: conversationTurn.content,
      createdAt: conversationTurn.createdAt,
    })
    .from(conversationTurn)
    .where(
      inArray(
        conversationTurn.conversationId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(desc(conversationTurn.createdAt));

  const last = new Map<string, string>();
  for (const turn of turns) {
    if (turn.conversationId && !last.has(turn.conversationId)) {
      last.set(turn.conversationId, turn.content);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
    pinned_at: r.pinnedAt?.toISOString() ?? null,
    last_message: last.get(r.id) ?? null,
  }));
}

export async function getConversation(
  userId: string,
  conversationId: string,
): Promise<ConversationDetail> {
  const db = getDb();
  const rows = await db
    .select({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      pinnedAt: conversation.pinnedAt,
    })
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), eq(conversation.userId, userId)))
    .limit(1);

  const head = rows[0];
  if (!head) throw new ConversationNotFoundError();

  const turns = await db
    .select({
      id: conversationTurn.id,
      role: conversationTurn.role,
      content: conversationTurn.content,
      intent: conversationTurn.intent,
      replyJson: conversationTurn.replyJson,
      createdAt: conversationTurn.createdAt,
    })
    .from(conversationTurn)
    .where(eq(conversationTurn.conversationId, conversationId))
    .orderBy(conversationTurn.createdAt);

  const messages: ConversationMessage[] = turns.flatMap((t) => {
    if (t.role !== 'user' && t.role !== 'assistant') return [];
    return [
      {
        id: t.id,
        role: t.role,
        content: t.content,
        intent: (t.intent as Intent | null) ?? null,
        response: (t.replyJson as TurnResponse | null) ?? null,
        created_at: t.createdAt.toISOString(),
      },
    ];
  });

  const last = messages[messages.length - 1];
  return {
    id: head.id,
    title: head.title,
    created_at: head.createdAt.toISOString(),
    updated_at: head.updatedAt.toISOString(),
    pinned_at: head.pinnedAt?.toISOString() ?? null,
    last_message: last?.content ?? null,
    messages,
  };
}

export async function renameConversation(input: {
  user_id: string;
  conversation_id: string;
  title: string;
}): Promise<ConversationSummary> {
  const title = normalizeTitle(input.title);
  if (!title) throw new Error('标题需要 1–40 字');

  const db = getDb();
  const [row] = await db
    .update(conversation)
    .set({ title, updatedAt: new Date() })
    .where(
      and(
        eq(conversation.id, input.conversation_id),
        eq(conversation.userId, input.user_id),
      ),
    )
    .returning({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      pinnedAt: conversation.pinnedAt,
    });

  if (!row) throw new ConversationNotFoundError();
  return {
    id: row.id,
    title: row.title,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    pinned_at: row.pinnedAt?.toISOString() ?? null,
    last_message: null,
  };
}

/** 置顶 / 取消置顶。只动 pinned_at，不碰 updated_at —— 分组仍按最后说话时间 */
export async function setConversationPinned(input: {
  user_id: string;
  conversation_id: string;
  pinned: boolean;
}): Promise<ConversationSummary> {
  const [row] = await getDb()
    .update(conversation)
    .set({ pinnedAt: input.pinned ? new Date() : null })
    .where(
      and(
        eq(conversation.id, input.conversation_id),
        eq(conversation.userId, input.user_id),
      ),
    )
    .returning({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      pinnedAt: conversation.pinnedAt,
    });

  if (!row) throw new ConversationNotFoundError();
  return {
    id: row.id,
    title: row.title,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    pinned_at: row.pinnedAt?.toISOString() ?? null,
    last_message: null,
  };
}

/** 硬删除会话及其消息；训练 / 评估数据不动 */
export async function deleteConversation(userId: string, conversationId: string): Promise<void> {
  const rows = await getDb()
    .delete(conversation)
    .where(and(eq(conversation.id, conversationId), eq(conversation.userId, userId)))
    .returning({ id: conversation.id });
  if (!rows[0]) throw new ConversationNotFoundError();
}

export async function touchConversation(conversationId: string): Promise<void> {
  await getDb()
    .update(conversation)
    .set({ updatedAt: new Date() })
    .where(eq(conversation.id, conversationId));
}

/** 助手轮的摘要 —— 存进 content，供会话列表与上下文使用 */
export function assistantSummary(response: TurnResponse): string {
  const card = response.card;
  if (card) {
    if (card.kind === 'chat') return card.reply;
    if (card.kind === 'knowledge') return card.answer;
    if (card.kind === 'refusal' || card.kind === 'boundary') return card.reply;
    if (card.kind === 'workout') {
      return `训练已记录：${card.exercises.map((e) => e.raw_name).join('、') || '无动作'}`;
    }
    if (card.kind === 'meal') {
      return `饮食已记下：${card.items.map((i) => i.raw_desc).join('、')}`;
    }
    if (card.kind === 'correction') {
      return `已把重量改成 ${card.new_weight_kg}kg`;
    }
    if (card.kind === 'plan') {
      return `训练计划：${card.title}（${card.split}）`;
    }
  }
  if (response.assessment) return response.assessment.advice;
  return '（本轮没有文字回复）';
}