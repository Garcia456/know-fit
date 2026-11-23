import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import { registrationVerification } from '../db/schema.js';
import { createMailClient, type MailClient } from '../mail/index.js';
import { getDb } from './pool.js';

/**
 * 注册邮箱验证码。
 *
 * 注册必须先验证邮箱，所以验证码不挂在 user 上 —— 账号还不存在。
 * 库里只存「邮箱 + 验证码」的 SHA-256；10 分钟有效、单次使用；
 * 同一邮箱 60 秒内只能发一次，连续输错 5 次作废。
 */

export const REGISTRATION_CODE_TTL_SECONDS = 10 * 60;
export const REGISTRATION_CODE_MAX_ATTEMPTS = 5;
export const REGISTRATION_CODE_RESEND_SECONDS = 60;

/** 发码太频繁是正常业务拒绝，不当异常上报 */
export class RegistrationCodeError extends Error {
  constructor(readonly code: 'too_soon') {
    super(code);
    this.name = 'RegistrationCodeError';
  }
}

function hashCode(email: string, code: string): string {
  return createHash('sha256').update(`${email}\n${code}`).digest('hex');
}

export function registrationCodeMailText(code: string): { subject: string; text: string } {
  return {
    subject: 'know-fit 注册验证码',
    text: `你正在注册 know-fit。验证码：${code}\n\n${REGISTRATION_CODE_TTL_SECONDS / 60} 分钟内有效，连续输错 ${REGISTRATION_CODE_MAX_ATTEMPTS} 次要重新获取。\n如果不是你本人操作，忽略这封邮件即可。`,
  };
}

/**
 * 生成并发送验证码。新码会作废该邮箱此前未使用的旧码。
 * 邮件发不出去时删掉刚写的行，允许用户马上重试。
 */
export async function sendRegistrationCode(
  email: string,
  options: { mail?: MailClient; env?: NodeJS.ProcessEnv; now?: Date } = {},
): Promise<{ expiresInSec: number }> {
  const now = options.now ?? new Date();
  const db = getDb();

  const [recent] = await db
    .select({ createdAt: registrationVerification.createdAt })
    .from(registrationVerification)
    .where(
      and(
        eq(registrationVerification.email, email),
        gt(registrationVerification.createdAt, new Date(now.getTime() - REGISTRATION_CODE_RESEND_SECONDS * 1000)),
      ),
    )
    .orderBy(desc(registrationVerification.createdAt))
    .limit(1);
  if (recent) throw new RegistrationCodeError('too_soon');

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const [row] = await db.transaction(async (tx) => {
    // 顺手清过期行 —— v1 不跑定时任务
    await tx
      .delete(registrationVerification)
      .where(lt(registrationVerification.expiresAt, now));
    // 旧码一律作废：邮箱里可能还躺着上一封
    await tx
      .update(registrationVerification)
      .set({ consumedAt: now })
      .where(
        and(
          eq(registrationVerification.email, email),
          isNull(registrationVerification.consumedAt),
        ),
      );
    return tx
      .insert(registrationVerification)
      .values({
        email,
        codeHash: hashCode(email, code),
        // 显式写入注入的 now：冷却与过期判断都按它算，测试才能控时
        createdAt: now,
        expiresAt: new Date(now.getTime() + REGISTRATION_CODE_TTL_SECONDS * 1000),
      })
      .returning({ id: registrationVerification.id });
  });

  try {
    await (options.mail ?? createMailClient(options.env)).send({
      to: email,
      ...registrationCodeMailText(code),
    });
  } catch (e) {
    if (row) {
      await db
        .delete(registrationVerification)
        .where(eq(registrationVerification.id, row.id))
        .catch(() => {});
    }
    throw e;
  }

  return { expiresInSec: REGISTRATION_CODE_TTL_SECONDS };
}

export type ConsumeRegistrationCodeResult =
  | 'ok'
  | 'missing'
  | 'mismatch'
  | 'attempts_exceeded';

/**
 * 兑换验证码。成功则原子标记已消费；输错只累加 attempts 并返回原因，
 * 让调用方在事务外决定要不要创建账号。
 */
export async function consumeRegistrationCode(
  email: string,
  code: string,
  now: Date = new Date(),
): Promise<ConsumeRegistrationCodeResult> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(registrationVerification)
      .where(
        and(
          eq(registrationVerification.email, email),
          isNull(registrationVerification.consumedAt),
          gt(registrationVerification.expiresAt, now),
        ),
      )
      .orderBy(desc(registrationVerification.createdAt))
      .limit(1)
      .for('update');
    if (!row) return 'missing';
    if (row.attempts >= REGISTRATION_CODE_MAX_ATTEMPTS) return 'attempts_exceeded';

    const expected = Buffer.from(row.codeHash, 'hex');
    const actual = Buffer.from(hashCode(email, code), 'hex');
    const matches =
      expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!matches) {
      const attempts = row.attempts + 1;
      await tx
        .update(registrationVerification)
        .set({ attempts })
        .where(eq(registrationVerification.id, row.id));
      return attempts >= REGISTRATION_CODE_MAX_ATTEMPTS ? 'attempts_exceeded' : 'mismatch';
    }

    const [consumed] = await tx
      .update(registrationVerification)
      .set({ consumedAt: now })
      .where(
        and(
          eq(registrationVerification.id, row.id),
          isNull(registrationVerification.consumedAt),
        ),
      )
      .returning({ id: registrationVerification.id });
    return consumed ? 'ok' : 'missing';
  });
}
