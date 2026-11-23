import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { user } from '../db/schema.js';
import { getDb } from './pool.js';

/**
 * 免费对话额度 —— 确定性判定，不经过模型。
 *
 * 资格优先级：
 *   受邀（邀请码解锁过知识库）→ 不限次，不扣额度
 *   已验证 → 免费额度内可用，每轮入口扣 1
 *   未验证 → 拒绝（403），验证后才有额度
 *
 * 🔴 扣减是一条原子 UPDATE，不做「先读再写」——并发两轮不能都拿到最后一格。
 */

export type Entitlement = 'invited' | 'free' | 'email_unverified' | 'quota_exhausted';

/** 判定只看这三列，纯函数便于单测 */
export interface QuotaRow {
  inviteUnlockedAt: Date | null;
  emailVerifiedAt: Date | null;
  freeTurnsUsed: number;
}

/** 已验证账号的免费次数上限；用尽后必须自带 Key（或邀请码）。 */
export const FREE_TURNS_LIMIT = (() => {
  const configured = Number(process.env.FREE_TURNS_LIMIT);
  return Number.isInteger(configured) && configured > 0 ? configured : 20;
})();

export function entitlement(row: QuotaRow, limit: number = FREE_TURNS_LIMIT): Entitlement {
  if (row.inviteUnlockedAt !== null) return 'invited';
  if (row.emailVerifiedAt === null) return 'email_unverified';
  return row.freeTurnsUsed < limit ? 'free' : 'quota_exhausted';
}

/** 只查资格、不扣额度 —— /assessments 每次对话后会跟着调一次，不能重复扣。 */
export async function entitlementFor(
  userId: string,
  limit: number = FREE_TURNS_LIMIT,
): Promise<Entitlement> {
  return entitlement(await readQuotaRow(userId), limit);
}

/**
 * `/turns` 入口扣 1 次。
 * 扣到了 → 'free'；扣不到再读标志位区分「受邀不限」「未验证」「用尽」。
 */
export async function consumeTurn(
  userId: string,
  limit: number = FREE_TURNS_LIMIT,
): Promise<Entitlement> {
  const consumed = await getDb()
    .update(user)
    .set({ freeTurnsUsed: sql`${user.freeTurnsUsed} + 1` })
    .where(
      and(
        eq(user.id, userId),
        isNull(user.inviteUnlockedAt),
        isNotNull(user.emailVerifiedAt),
        sql`${user.freeTurnsUsed} < ${limit}`,
      ),
    )
    .returning({ id: user.id });

  if (consumed.length > 0) return 'free';
  return entitlement(await readQuotaRow(userId), limit);
}

async function readQuotaRow(userId: string): Promise<QuotaRow> {
  const rows = await getDb()
    .select({
      inviteUnlockedAt: user.inviteUnlockedAt,
      emailVerifiedAt: user.emailVerifiedAt,
      freeTurnsUsed: user.freeTurnsUsed,
    })
    .from(user)
    .where(eq(user.id, userId));
  const row = rows[0];
  if (!row) throw new Error('用户不存在');
  return row;
}
