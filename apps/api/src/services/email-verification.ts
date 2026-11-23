import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { emailVerification, user } from '../db/schema.js';
import { createMailClient, type MailClient } from '../mail/index.js';
import { getDb } from './pool.js';

/**
 * 邮箱验证 —— 令牌只存 SHA-256，24 小时有效，单次使用。
 * 验证通过才发免费额度（额度逻辑在 PR5 的 quota 层）。
 */

const TTL_HOURS = 24;

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 生成新令牌并作废该用户未消费的旧令牌；明文只在这里出现一次。 */
export async function issueEmailVerification(
  userId: string,
  now: Date = new Date(),
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await getDb().transaction(async (tx) => {
    await tx
      .delete(emailVerification)
      .where(
        and(eq(emailVerification.userId, userId), isNull(emailVerification.consumedAt)),
      );
    // 顺手清过期行 —— v1 不跑定时任务
    await tx.delete(emailVerification).where(lt(emailVerification.expiresAt, now));
    await tx.insert(emailVerification).values({
      userId,
      tokenHash: tokenHash(token),
      expiresAt: new Date(now.getTime() + TTL_HOURS * 60 * 60 * 1000),
    });
  });
  return token;
}

/**
 * 消费令牌并把用户标成已验证。
 * 单次使用靠 `UPDATE ... WHERE consumed_at IS NULL` 的原子性，并发点两次只有一次生效。
 */
export async function consumeEmailVerification(
  token: string,
  now: Date = new Date(),
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(emailVerification)
      .set({ consumedAt: now })
      .where(
        and(
          eq(emailVerification.tokenHash, tokenHash(token)),
          isNull(emailVerification.consumedAt),
          gt(emailVerification.expiresAt, now),
        ),
      )
      .returning({ userId: emailVerification.userId });
    if (!row) return false;

    await tx
      .update(user)
      .set({ emailVerifiedAt: sql`COALESCE(${user.emailVerifiedAt}, now())` })
      .where(eq(user.id, row.userId));
    return true;
  });
}

/** 前端路由：`/verify-email?token=...` */
export function verificationUrl(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.PUBLIC_APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  return `${base}/verify-email?token=${encodeURIComponent(token)}`;
}

export function verificationMailText(
  nickname: string,
  url: string,
): { subject: string; text: string } {
  return {
    subject: '验证你的 know-fit 邮箱',
    text: `你好 ${nickname}：\n\n点开下面的链接验证邮箱（${TTL_HOURS} 小时内有效，只能用一次）：\n${url}\n\n如果不是你本人注册，忽略这封邮件即可。`,
  };
}

/** 发一封验证邮件；失败由调用方决定是否影响主流程。 */
export async function sendVerificationEmail(
  account: { id: string; email: string; nickname: string },
  options: { mail?: MailClient; env?: NodeJS.ProcessEnv; now?: Date } = {},
): Promise<void> {
  const token = await issueEmailVerification(account.id, options.now);
  const url = verificationUrl(token, options.env);
  await (options.mail ?? createMailClient(options.env)).send({
    to: account.email,
    ...verificationMailText(account.nickname, url),
  });
}
