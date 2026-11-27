import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { user } from '../db/schema.js';
import { createFakeClient } from '../llm/fake.js';
import { toLocalDate } from '../extraction/dates.js';
import { getDb } from './pool.js';
import { handleTurn } from './turn.js';

/** 记录后补昨天的端到端：fake LLM + 真库，不联网。 */

async function newUser(): Promise<string> {
  const [row] = await getDb()
    .insert(user)
    .values({
      email: `turn-${randomUUID()}@test.local`,
      passwordHash: 'x',
      nickname: 'turn-test',
    })
    .returning({ id: user.id });
  if (!row) throw new Error('测试用户没建出来');
  return row.id;
}

async function dropUser(id: string): Promise<void> {
  // user 级联删会话 / 训练 / 待补槽 / 提示
  await getDb().delete(user).where(eq(user.id, id));
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toLocalDate(d);
}

describe('handleTurn：待补记录', () => {
  it('空抽取保留日期 / 部位；下一句无日期补细节落到昨天', async () => {
    const userId = await newUser();
    try {
      const first = await handleTurn(
        { message: '昨天练了胸', user_id: userId },
        { llm: createFakeClient() },
      );
      expect(first.card?.kind).toBe('chat');

      const second = await handleTurn(
        { message: '卧推做了四组，每组 8 个', user_id: userId },
        { llm: createFakeClient() },
      );
      const card = second.card;
      if (card?.kind !== 'workout') throw new Error('第二句没有落成训练卡');
      expect(card.date).toBe(yesterday());
      expect(card.split_label).toBe('胸');
    } finally {
      await dropUser(userId);
    }
  });

  it('记录今天后给昨天空白一个补记提示', async () => {
    const userId = await newUser();
    try {
      const res = await handleTurn(
        {
          message: '卧推 70kg×8 四组，飞鸟 15kg×12 三组，深蹲 100kg×5 五组',
          user_id: userId,
        },
        { llm: createFakeClient() },
      );
      expect(res.card?.kind).toBe('workout');
      expect(res.backfill).toMatchObject({
        target_date: yesterday(),
        source: 'gap',
        message_code: 'gap',
      });
    } finally {
      await dropUser(userId);
    }
  });
});
