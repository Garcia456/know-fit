import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { MailMessage } from '../mail/index.js';
import {
  ageFromBirthday,
  createSession,
  deleteSession,
  getUser,
  hashPassword,
  login,
  publicUser,
  register,
  sessionUser,
  updateAccount,
  verifyPassword,
} from './auth.js';
import { closeDb, getPool } from './pool.js';
import { sendRegistrationCode } from './registration-code.js';

/** 认证与账号资料 —— 连真库；邮箱用随机前缀，收尾统一清掉测试账号。 */

const PREFIX = 'test-auth-';
const email = `${PREFIX}${randomUUID()}@knowfit.local`;
const password = 'knowfit-test-123';

/** 走真实发码路径，从内存邮箱里取码 —— 注册不允许绕过邮箱验证。 */
async function registerWithCode(input: {
  email: string;
  password: string;
  nickname: string;
}) {
  const messages: MailMessage[] = [];
  await sendRegistrationCode(input.email, {
    mail: {
      async send(message) {
        messages.push(message);
      },
    },
  });
  const code = /验证码：(\d{6})/.exec(messages.at(-1)?.text ?? '')?.[1];
  if (!code) throw new Error('验证码没有发出来');
  return register({ ...input, code });
}

afterAll(async () => {
  await getPool().query('DELETE FROM "user" WHERE email LIKE $1', [`${PREFIX}%`]);
  await getPool().query('DELETE FROM registration_verification WHERE email LIKE $1', [
    `${PREFIX}%`,
  ]);
  await closeDb();
});

describe('密码哈希', () => {
  it('scrypt 往返：正确密码通过，错误密码不通过', async () => {
    const stored = await hashPassword(password);
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword(password, stored)).toBe(true);
    expect(await verifyPassword('wrong-password', stored)).toBe(false);
  });

  it('坏格式不抛错，直接判 false', async () => {
    expect(await verifyPassword(password, 'plain-text')).toBe(false);
    expect(await verifyPassword(password, 'scrypt$locked$locked')).toBe(false);
  });
});

describe('注册 / 登录 / 会话', () => {
  it('注册后能登录，会话能换回用户；退出后会话失效', async () => {
    const { user, token } = await registerWithCode({
      email,
      password,
      nickname: '测试用户',
    });
    expect(user.email).toBe(email);
    expect(user.passwordHash).not.toBe(password);
    expect(user.emailVerifiedAt).not.toBeNull();

    const fromSession = await sessionUser(token);
    expect(fromSession?.id).toBe(user.id);

    const logged = await login({ email, password });
    expect(logged.user.id).toBe(user.id);

    await expect(login({ email, password: 'wrong-password' })).rejects.toMatchObject({
      code: 'bad_credentials',
    });
    await expect(
      register({ email, password, nickname: '重复', code: '000000' }),
    ).rejects.toMatchObject({
      code: 'email_taken',
    });

    await deleteSession(token);
    expect(await sessionUser(token)).toBeNull();
  });

  it('没有邮箱验证码 / 验证码不对 → 不创建账号', async () => {
    const fresh = `${PREFIX}${randomUUID()}@knowfit.local`;
    await expect(
      register({ email: fresh, password, nickname: '未验证', code: '123456' }),
    ).rejects.toMatchObject({ code: 'code_invalid' });

    const rows = await getPool().query('SELECT 1 FROM "user" WHERE email = $1', [fresh]);
    expect(rows.rowCount).toBe(0);
  });

  it('会话过期后查不到用户', async () => {
    const row = await getUser((await login({ email, password })).user.id);
    expect(row).not.toBeNull();
    const token = await createSession(row!.id, new Date('2020-01-01T00:00:00Z'));
    expect(await sessionUser(token, new Date('2020-02-15T00:00:00Z'))).toBeNull();
    await deleteSession(token);
  });

  it('改账号资料回读一致，年龄按生日计算', async () => {
    const { user } = await login({ email, password });
    const avatar = 'data:image/jpeg;base64,AAAA';
    const updated = await updateAccount(user.id, {
      nickname: '新昵称',
      birthday: '2000-01-15',
      gender: '男',
      bio: '练了三年，还在学。',
      avatar,
    });
    expect(updated.nickname).toBe('新昵称');
    expect(publicUser(updated, new Date('2026-01-14T00:00:00Z')).age).toBe(25);
    expect(publicUser(updated, new Date('2026-01-15T00:00:00Z')).age).toBe(26);
    expect(publicUser(updated).avatar).toBe(avatar);

    // 不传 avatar 表示「不改」，不是清空
    const kept = await updateAccount(user.id, {
      nickname: '新昵称',
      birthday: null,
      gender: null,
      bio: null,
    });
    expect(publicUser(kept).avatar).toBe(avatar);
  });
});

describe('年龄计算', () => {
  it('没填生日返回 null；生日当天才长一岁', () => {
    expect(ageFromBirthday(null)).toBeNull();
    expect(ageFromBirthday('2000-10-27', new Date('2026-10-26T12:00:00Z'))).toBe(25);
    expect(ageFromBirthday('2000-10-27', new Date('2026-10-27T12:00:00Z'))).toBe(26);
  });
});