import { eq, sql } from 'drizzle-orm';
import { knowledgeAccess, user } from '../db/schema.js';
import { RESTRICTED_PLATFORMS, visiblePlatforms } from '../kb/platforms.js';
import { getDb } from './pool.js';

/** 该用户实际可检索的平台。无授权行 = 空数组。 */
export async function visiblePlatformsFor(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ platform: knowledgeAccess.platform })
    .from(knowledgeAccess)
    .where(eq(knowledgeAccess.userId, userId));
  return visiblePlatforms(rows.map((r) => r.platform));
}

/**
 * 邀请码通过后解锁：补齐受限平台授权，并记下解锁时间。
 * 幂等 —— 重复解锁不重复插行、不覆盖首次时间。
 */
export async function unlockKnowledgeAccess(userId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx
      .insert(knowledgeAccess)
      .values(RESTRICTED_PLATFORMS.map((platform) => ({ userId, platform })))
      .onConflictDoNothing({
        target: [knowledgeAccess.userId, knowledgeAccess.platform],
      });

    await tx
      .update(user)
      .set({
        inviteUnlockedAt: sql`COALESCE(${user.inviteUnlockedAt}, now())`,
        // 受邀即视为已验证：额度闸门不该把人挡在邀请码后面
        emailVerifiedAt: sql`COALESCE(${user.emailVerifiedAt}, now())`,
      })
      .where(eq(user.id, userId));
  });
}
