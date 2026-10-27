import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, like } from 'drizzle-orm';
import { conversation, conversationTurn, workoutSession } from '../db/schema.js';
import { SINGLE_USER_ID } from '../graph/state.js';
import {
  ConversationNotFoundError,
  HISTORY_ROUNDS,
  deleteConversation,
  getConversation,
  listConversations,
  loadRecentHistory,
  normalizeTitle,
  renameConversation,
  resolveConversation,
  TITLE_MAX,
} from './conversation.js';
import { closeDb, getDb, getPool } from './pool.js';
import { persistWorkout } from './record.js';

/**
 * 会话与消息 —— 连真库。
 * 用标题前缀 `e2e-conv-` 隔离，自清理。
 */

const MARK = 'e2e-conv-';
const created: string[] = [];

async function newConversation(first = `${MARK}今天练了背`) {
  const id = await resolveConversation({ user_id: SINGLE_USER_ID, first_message: first });
  created.push(id);
  return id;
}

beforeAll(async () => {
  try {
    await getPool().query('SELECT 1');
  } catch (e) {
    throw new Error(`连不上数据库 —— 本测试要真库：pnpm db:up && pnpm db:migrate。原始错误：${(e as Error).message}`, {
      cause: e,
    });
  }
});

afterAll(async () => {
  const db = getDb();
  if (created.length > 0) {
    await db.delete(conversation).where(inArray(conversation.id, created));
  }
  await db.delete(workoutSession).where(like(workoutSession.splitLabel, `${MARK}%`));
  await closeDb();
});

describe('resolveConversation', () => {
  it('不带 id → 新建，标题取首条消息前 20 字', async () => {
    const id = await newConversation(`${MARK}今天练了胸和背，感觉还行，明天继续`);
    const detail = await getConversation(SINGLE_USER_ID, id);

    expect(detail.title).toBe(`${MARK}今天练了胸和背，感觉还`);
    expect(detail.title.length).toBeLessThanOrEqual(20);
    expect(detail.messages).toEqual([]);
  });

  it('空白首条 → 标题「新对话」', async () => {
    const id = await newConversation('   ');
    expect((await getConversation(SINGLE_USER_ID, id)).title).toBe('新对话');
  });

  it('带别人的 id → 404，不落到别人会话里', async () => {
    await expect(
      resolveConversation({
        user_id: '00000000-0000-4000-8000-000000009999',
        conversation_id: await newConversation(),
        first_message: 'x',
      }),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});

describe('消息往返与上下文', () => {
  it('用户 + 助手两条都能读回，助手轮带完整响应', async () => {
    const id = await newConversation(`${MARK}往返`);
    const response = {
      turn_id: 't-1',
      conversation_id: id,
      intent: 'chat',
      card: { kind: 'chat', reply: '收到。' },
      assessment: null,
      assessment_lookup: null,
      notices: [],
    };
    await getDb()
      .insert(conversationTurn)
      .values([
        {
          userId: SINGLE_USER_ID,
          conversationId: id,
          role: 'user',
          content: '你好',
          intent: 'chat',
          linkedRecordId: null,
        },
        {
          userId: SINGLE_USER_ID,
          conversationId: id,
          role: 'assistant',
          content: '收到。',
          intent: 'chat',
          replyJson: response,
          linkedRecordId: null,
        },
      ]);

    const detail = await getConversation(SINGLE_USER_ID, id);
    expect(detail.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(detail.messages[1]?.response).toEqual(response);
    expect(detail.last_message).toBe('收到。');
  });

  it(`只读最近 ${HISTORY_ROUNDS} 轮，且按时间正序`, async () => {
    const id = await newConversation(`${MARK}上下文`);
    const base = Date.now() - 60_000;
    const rows = Array.from({ length: 8 }).flatMap((_, i) => [
      {
        userId: SINGLE_USER_ID,
        conversationId: id,
        role: 'user',
        content: `问 ${i}`,
        intent: 'chat' as const,
        linkedRecordId: null,
        createdAt: new Date(base + i * 2000),
      },
      {
        userId: SINGLE_USER_ID,
        conversationId: id,
        role: 'assistant',
        content: `答 ${i}`,
        intent: 'chat' as const,
        linkedRecordId: null,
        createdAt: new Date(base + i * 2000 + 1000),
      },
    ]);
    await getDb().insert(conversationTurn).values(rows);

    const history = await loadRecentHistory(id);

    expect(history).toHaveLength(HISTORY_ROUNDS * 2);
    expect(history[0]?.content).toBe('问 2');
    expect(history[history.length - 1]?.content).toBe('答 7');
  });
});

describe('重命名', () => {
  it('去首尾空白后写回，列表与详情都变', async () => {
    const id = await newConversation();
    const out = await renameConversation({
      user_id: SINGLE_USER_ID,
      conversation_id: id,
      title: `  ${MARK}推日  `,
    });

    expect(out.title).toBe(`${MARK}推日`);
    expect((await getConversation(SINGLE_USER_ID, id)).title).toBe(`${MARK}推日`);
  });

  it('空标题 / 超长 → 拒绝', async () => {
    const id = await newConversation();
    expect(normalizeTitle('   ')).toBeNull();
    expect(normalizeTitle('字'.repeat(TITLE_MAX + 1))).toBeNull();
    await expect(
      renameConversation({ user_id: SINGLE_USER_ID, conversation_id: id, title: '' }),
    ).rejects.toThrow('1–40');
  });
});

describe('列表与删除', () => {
  it('列表按 updatedAt 倒序，带最后一条摘要', async () => {
    const older = await newConversation(`${MARK}旧的`);
    const newer = await newConversation(`${MARK}新的`);
    await getDb()
      .update(conversation)
      .set({ updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(conversation.id, older));
    await getDb()
      .insert(conversationTurn)
      .values({
        userId: SINGLE_USER_ID,
        conversationId: newer,
        role: 'user',
        content: '最后一句',
        intent: 'chat',
        linkedRecordId: null,
      });

    const list = await listConversations(SINGLE_USER_ID);
    const ids = list.map((c) => c.id);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
    expect(list.find((c) => c.id === newer)?.last_message).toBe('最后一句');
  });

  it('删除会话连带删消息，训练记录不动', async () => {
    const id = await newConversation(`${MARK}要删的`);
    const { session_id } = await persistWorkout({
      user_id: SINGLE_USER_ID,
      date: '2031-04-01',
      split_label: `${MARK}背日`,
      status: 'complete',
      missing_fields: [],
      notes: null,
      exercises: [
        {
          order: 0,
          raw_name: '引体向上',
          exercise_id: null,
          name_confidence: 'low',
          region_fallback: 'region_back',
          sets: [],
        },
      ],
    });
    await getDb()
      .insert(conversationTurn)
      .values({
        userId: SINGLE_USER_ID,
        conversationId: id,
        role: 'user',
        content: '删我',
        intent: 'chat',
        linkedRecordId: session_id,
      });

    await deleteConversation(SINGLE_USER_ID, id);

    await expect(getConversation(SINGLE_USER_ID, id)).rejects.toBeInstanceOf(
      ConversationNotFoundError,
    );
    const turns = await getDb()
      .select()
      .from(conversationTurn)
      .where(eq(conversationTurn.conversationId, id));
    expect(turns).toHaveLength(0);
    const sessions = await getDb()
      .select()
      .from(workoutSession)
      .where(eq(workoutSession.id, session_id));
    expect(sessions).toHaveLength(1);
  });

  it('删不存在的会话 → 404', async () => {
    await expect(
      deleteConversation(SINGLE_USER_ID, '00000000-0000-4000-8000-000000008888'),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});