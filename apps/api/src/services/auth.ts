import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { AccountInput, LoginInput, RegisterInput, User } from '../contracts/auth.js';
import { authSession, user } from '../db/schema.js';
import { getDb } from './pool.js';
import { FREE_TURNS_LIMIT } from './quota.js';
import { consumeRegistrationCode } from './registration-code.js';

/**
 * 注册 / 登录 / 会话 / 账号资料。
 * 密码用 Node 内置 scrypt，不引第三方哈希库。
 */

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;
const SESSION_DAYS = 30;

export type AuthErrorCode =
  | 'email_taken'
  | 'bad_credentials'
  | 'not_found'
  | 'code_invalid'
  | 'code_attempts';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  if (salt.length === 0 || expected.length !== KEY_LEN) return false;
  const actual = await scrypt(password, salt, KEY_LEN, SCRYPT);
  return timingSafeEqual(actual, expected);
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 新会话返回明文 token（只在这里出现一次），库里只存哈希。 */
export async function createSession(userId: string, now: Date = new Date()): Promise<string> {
  const db = getDb();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  // 顺手清掉过期会话 —— v1 不跑定时任务
  await db.delete(authSession).where(lt(authSession.expiresAt, now));
  await db.insert(authSession).values({ userId, tokenHash: tokenHash(token), expiresAt });
  return token;
}

export async function sessionUser(
  token: string,
  now: Date = new Date(),
): Promise<typeof user.$inferSelect | null> {
  const rows = await getDb()
    .select({ user })
    .from(authSession)
    .innerJoin(user, eq(authSession.userId, user.id))
    .where(and(eq(authSession.tokenHash, tokenHash(token)), gt(authSession.expiresAt, now)))
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await getDb().delete(authSession).where(eq(authSession.tokenHash, tokenHash(token)));
}

export async function emailTaken(email: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return rows.length > 0;
}

/**
 * 注册前必须先完成邮箱验证：验证码由 `/auth/register/code` 发到邮箱，
 * 这里兑换成功才创建账号，并直接标记 email_verified_at ——
 * 新账号不存在「注册了但没验证」的中间态。
 */
export async function register(
  input: RegisterInput,
  now: Date = new Date(),
): Promise<{ user: typeof user.$inferSelect; token: string }> {
  const db = getDb();
  // 先挡重复邮箱，免得白白消耗一个验证码（并发下仍由唯一索引兜底）
  if (await emailTaken(input.email)) throw new AuthError('email_taken');

  const passwordHash = await hashPassword(input.password);
  const verdict = await consumeRegistrationCode(input.email, input.code, now);
  if (verdict === 'attempts_exceeded') throw new AuthError('code_attempts');
  if (verdict !== 'ok') throw new AuthError('code_invalid');

  let row: typeof user.$inferSelect | undefined;
  try {
    [row] = await db
      .insert(user)
      .values({
        email: input.email,
        passwordHash,
        nickname: input.nickname,
        emailVerifiedAt: now,
      })
      .returning();
  } catch (e) {
    // Drizzle 把 pg 错误包了一层，真正的位置在 cause 上
    const code =
      (e as { code?: string }).code ??
      (e as { cause?: { code?: string } }).cause?.code;
    if (code === '23505') throw new AuthError('email_taken');
    throw e;
  }
  if (!row) throw new Error('注册失败：没有返回用户行');
  return { user: row, token: await createSession(row.id) };
}

export async function login(
  input: LoginInput,
): Promise<{ user: typeof user.$inferSelect; token: string }> {
  const rows = await getDb().select().from(user).where(eq(user.email, input.email)).limit(1);
  const row = rows[0];
  if (!row || !(await verifyPassword(input.password, row.passwordHash))) {
    throw new AuthError('bad_credentials');
  }
  return { user: row, token: await createSession(row.id) };
}

export async function getUser(userId: string): Promise<typeof user.$inferSelect | null> {
  const rows = await getDb().select().from(user).where(eq(user.id, userId)).limit(1);
  return rows[0] ?? null;
}

export async function updateAccount(
  userId: string,
  input: AccountInput,
  now: Date = new Date(),
): Promise<typeof user.$inferSelect> {
  const [row] = await getDb()
    .update(user)
    .set({
      nickname: input.nickname,
      birthday: input.birthday,
      gender: input.gender,
      bio: input.bio,
      // 不传即不改；传 null 才是清除头像
      ...(input.avatar === undefined ? {} : { avatar: input.avatar }),
      updatedAt: now,
    })
    .where(eq(user.id, userId))
    .returning();
  if (!row) throw new AuthError('not_found');
  return row;
}

/** 注销：user 行删除后，所有带 user_id 外键的表级联清空。 */
export async function deleteAccount(userId: string): Promise<void> {
  await getDb().delete(user).where(eq(user.id, userId));
}

/** 生日 → 周岁；没填返回 null。 */
export function ageFromBirthday(birthday: string | null, now: Date = new Date()): number | null {
  if (!birthday) return null;
  const [year, month, day] = birthday.split('-').map(Number);
  if (!year || !month || !day) return null;
  let age = now.getFullYear() - year;
  const currentMonth = now.getMonth() + 1;
  if (currentMonth < month || (currentMonth === month && now.getDate() < day)) age -= 1;
  return Math.max(0, age);
}

/** 对外只给契约里的字段 —— password_hash 不出服务层。 */
export function publicUser(row: typeof user.$inferSelect, now: Date = new Date()): User {
  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    birthday: row.birthday,
    gender: row.gender === '男' || row.gender === '女' || row.gender === '其他' ? row.gender : null,
    bio: row.bio,
    avatar: row.avatar,
    age: ageFromBirthday(row.birthday, now),
    invite_unlocked: row.inviteUnlockedAt !== null,
    email_verified: row.emailVerifiedAt !== null,
    free_turns_used: row.freeTurnsUsed,
    free_turns_limit: FREE_TURNS_LIMIT,
    created_at: row.createdAt.toISOString(),
  };
}