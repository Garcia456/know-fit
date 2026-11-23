import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unlockKnowledgeAccess } from './knowledge-access.js';
import { closeDb, getPool } from './pool.js';
import { consumeTurn, entitlement, entitlementFor, type QuotaRow } from './quota.js';
import { registerForTest } from './register-for-test.js';

/**
 * 免费额度闸门 —— 判定是纯函数，扣减连真库。
 * 新注册的账号建号即已验证；未验证分支通过把账号改回未验证来模拟历史账号。
 * 关键断言：未验证不扣；已验证逐次扣、用尽即拒；受邀不扣且不限次。
 */

const PREFIX = 'test-quota-';
const ids: string[] = [];

async function createUser(): Promise<string> {
  const result = await registerForTest({
    email: `${PREFIX}${randomUUID()}@knowfit.local`,
    password: 'knowfit-test-123',
    nickname: '额度测试',
  });
  ids.push(result.user.id);
  return result.user.id;
}

async function unverifyEmail(userId: string): Promise<void> {
  await getPool().query('UPDATE "user" SET email_verified_at = NULL WHERE id = $1', [userId]);
}

async function usedTurns(userId: string): Promise<number> {
  const row = await getPool().query<{ free_turns_used: number }>(
    'SELECT free_turns_used FROM "user" WHERE id = $1',
    [userId],
  );
  return row.rows[0]?.free_turns_used ?? -1;
}

afterAll(async () => {
  await getPool().query('DELETE FROM registration_verification WHERE email LIKE $1', [`${PREFIX}%`]);
  if (ids.length > 0) {
    await getPool().query('DELETE FROM "user" WHERE id = ANY($1)', [ids]);
  }
  await closeDb();
});

describe('entitlement 判定', () => {
  const verified: QuotaRow = {
    inviteUnlockedAt: null,
    emailVerifiedAt: new Date(),
    freeTurnsUsed: 0,
  };

  it('受邀不限次 —— 额度用光也仍是 invited', () => {
    expect(
      entitlement({ ...verified, inviteUnlockedAt: new Date(), freeTurnsUsed: 999 }, 20),
    ).toBe('invited');
  });

  it('未验证 → email_unverified', () => {
    expect(entitlement({ ...verified, emailVerifiedAt: null }, 20)).toBe('email_unverified');
  });

  it('额度内 → free', () => {
    expect(entitlement({ ...verified, freeTurnsUsed: 19 }, 20)).toBe('free');
  });

  it('用光 → quota_exhausted', () => {
    expect(entitlement({ ...verified, freeTurnsUsed: 20 }, 20)).toBe('quota_exhausted');
  });
});

describe('额度扣减（连真库）', () => {
  let unverifiedId = '';
  let verifiedId = '';
  let invitedId = '';

  beforeAll(async () => {
    unverifiedId = await createUser();
    verifiedId = await createUser();
    invitedId = await createUser();
    await unverifyEmail(unverifiedId);
    await unlockKnowledgeAccess(invitedId);
  });

  it('未验证：不扣次数，判为 email_unverified', async () => {
    expect(await entitlementFor(unverifiedId, 2)).toBe('email_unverified');
    expect(await consumeTurn(unverifiedId, 2)).toBe('email_unverified');
    expect(await usedTurns(unverifiedId)).toBe(0);
  });

  it('受邀：不扣次数，且不限次', async () => {
    expect(await consumeTurn(invitedId, 1)).toBe('invited');
    expect(await consumeTurn(invitedId, 1)).toBe('invited');
    expect(await usedTurns(invitedId)).toBe(0);
  });

  it('已验证：逐次扣到上限，下一次拒绝', async () => {
    expect(await consumeTurn(verifiedId, 2)).toBe('free');
    expect(await consumeTurn(verifiedId, 2)).toBe('free');
    expect(await usedTurns(verifiedId)).toBe(2);

    expect(await consumeTurn(verifiedId, 2)).toBe('quota_exhausted');
    expect(await usedTurns(verifiedId)).toBe(2);
    expect(await entitlementFor(verifiedId, 2)).toBe('quota_exhausted');
  });
});
