import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KNOWLEDGE_DISABLED_ANSWER, KNOWLEDGE_DISABLED_NOTICE, answerKnowledge } from '../knowledge/service.js';
import type { LlmClient } from '../llm/client.js';
import { unlockKnowledgeAccess, visiblePlatformsFor } from './knowledge-access.js';
import { closeDb, getPool } from './pool.js';
import { registerForTest } from './register-for-test.js';

/**
 * 邀请码解锁知识库 —— 连真库。
 * 关键断言：新账号无授权；解锁后可见 douyin 且幂等；
 * 未解锁时知识卡显式降级，且不消耗任何模型调用。
 */

const PREFIX = 'test-invite-';
let lockedId = '';
let unlockedId = '';

/** 计数替身：任何一次模型调用都算失败（未解锁分支不该走到这里） */
function countingLlm(): LlmClient & { calls: number } {
  const client: LlmClient & { calls: number } = {
    calls: 0,
    model: 'counting',
    async structured() {
      client.calls += 1;
      throw new Error('未解锁时不应调用结构化抽取');
    },
    async generate() {
      client.calls += 1;
      return '通用回答';
    },
  };
  return client;
}

async function createUser(): Promise<string> {
  const result = await registerForTest({
    email: `${PREFIX}${randomUUID()}@knowfit.local`,
    password: 'knowfit-test-123',
    nickname: '邀请码测试',
  });
  return result.user.id;
}

async function unlockedAt(userId: string): Promise<Date | null> {
  const row = await getPool().query<{ invite_unlocked_at: Date | null }>(
    'SELECT invite_unlocked_at FROM "user" WHERE id = $1',
    [userId],
  );
  return row.rows[0]?.invite_unlocked_at ?? null;
}

beforeAll(async () => {
  lockedId = await createUser();
  unlockedId = await createUser();
});

afterAll(async () => {
  await getPool().query('DELETE FROM registration_verification WHERE email LIKE $1', [`${PREFIX}%`]);
  const ids = [lockedId, unlockedId].filter(Boolean);
  if (ids.length > 0) {
    await getPool().query('DELETE FROM "user" WHERE id = ANY($1)', [ids]);
  }
  await closeDb();
});

describe('邀请码解锁', () => {
  it('新账号没有任何平台授权', async () => {
    expect(await visiblePlatformsFor(lockedId)).toEqual([]);
    expect(await unlockedAt(lockedId)).toBeNull();
  });

  it('未解锁时知识卡显式降级，且不消耗模型调用', async () => {
    const llm = countingLlm();
    const card = await answerKnowledge({ user_id: lockedId, query: '卧推怎么加重量？', llm });

    expect(card.has_source).toBe(false);
    expect(card.knowledge_disabled).toBe(true);
    expect(card.no_source_notice).toBe(KNOWLEDGE_DISABLED_NOTICE);
    expect(card.answer).toBe(KNOWLEDGE_DISABLED_ANSWER);
    expect(card.claims).toEqual([]);
    expect(card.citations).toEqual([]);
    expect(llm.calls).toBe(0);
  });

  it('解锁后可见 douyin，并记录解锁时间', async () => {
    await unlockKnowledgeAccess(unlockedId);

    expect(await visiblePlatformsFor(unlockedId)).toEqual(['douyin']);
    expect(await unlockedAt(unlockedId)).not.toBeNull();

    // 受邀即视为邮箱已验证 —— 额度闸门不该把人挡在邀请码后面
    const row = await getPool().query<{ email_verified_at: Date | null }>(
      'SELECT email_verified_at FROM "user" WHERE id = $1',
      [unlockedId],
    );
    expect(row.rows[0]?.email_verified_at).not.toBeNull();
  });

  it('重复解锁幂等：不覆盖首次解锁时间', async () => {
    const first = await unlockedAt(unlockedId);
    expect(first).not.toBeNull();

    await unlockKnowledgeAccess(unlockedId);

    expect(await visiblePlatformsFor(unlockedId)).toEqual(['douyin']);
    expect((await unlockedAt(unlockedId))?.getTime()).toBe(first!.getTime());
  });
});
