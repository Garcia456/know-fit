import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { consumeEmailVerification, issueEmailVerification } from './email-verification.js';
import { closeDb, getPool } from './pool.js';
import { registerForTest } from './register-for-test.js';

/**
 * 邮箱验证令牌 —— 连真库。
 * 新注册的账号建号即已验证；这里把账号改回未验证，模拟历史上发过链接的账号，
 * 断言：验证前为空；验证后打标；单次使用；过期与重发作废。
 */

const PREFIX = 'test-verify-';
const created: string[] = [];

async function makeUser(): Promise<string> {
  const result = await registerForTest({
    email: `${PREFIX}${randomUUID()}@knowfit.local`,
    password: 'knowfit-test-123',
    nickname: '验证测试',
  });
  created.push(result.user.id);
  // 注册即验证；回退成「等待验证链接」的历史账号状态
  await getPool().query('UPDATE "user" SET email_verified_at = NULL WHERE id = $1', [
    result.user.id,
  ]);
  return result.user.id;
}

async function verifiedAt(userId: string): Promise<Date | null> {
  const row = await getPool().query<{ email_verified_at: Date | null }>(
    'SELECT email_verified_at FROM "user" WHERE id = $1',
    [userId],
  );
  return row.rows[0]?.email_verified_at ?? null;
}

afterAll(async () => {
  await getPool().query('DELETE FROM registration_verification WHERE email LIKE $1', [`${PREFIX}%`]);
  if (created.length > 0) {
    await getPool().query('DELETE FROM "user" WHERE id = ANY($1)', [created]);
  }
  await closeDb();
});

describe('邮箱验证令牌', () => {
  it('验证前未打标；消费成功后标记已验证，且只能用一次', async () => {
    const userId = await makeUser();
    expect(await verifiedAt(userId)).toBeNull();

    const token = await issueEmailVerification(userId);
    expect(await consumeEmailVerification(token)).toBe(true);
    expect(await verifiedAt(userId)).not.toBeNull();

    expect(await consumeEmailVerification(token)).toBe(false);
  });

  it('过期令牌不生效', async () => {
    const userId = await makeUser();
    const dayMs = 24 * 60 * 60 * 1000;
    const token = await issueEmailVerification(userId, new Date(Date.now() - 2 * dayMs));

    expect(await consumeEmailVerification(token)).toBe(false);
    expect(await verifiedAt(userId)).toBeNull();
  });

  it('重新签发会作废旧令牌', async () => {
    const userId = await makeUser();
    const first = await issueEmailVerification(userId);
    const second = await issueEmailVerification(userId);

    expect(await consumeEmailVerification(first)).toBe(false);
    expect(await consumeEmailVerification(second)).toBe(true);
  });

  it('库里只存令牌哈希，不存明文', async () => {
    const userId = await makeUser();
    const token = await issueEmailVerification(userId);

    const row = await getPool().query<{ token_hash: string }>(
      'SELECT token_hash FROM email_verification WHERE user_id = $1',
      [userId],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]!.token_hash).not.toBe(token);
    expect(row.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
