import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
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

/** 认证与账号资料 —— 连真库；邮箱用随机前缀，收尾统一清掉测试账号。 */

const PREFIX = 'test-auth-';
const email = `${PREFIX}${randomUUID()}@knowfit.local`;
const password = 'knowfit-test-123';

afterAll(async () => {
  await getPool().query('DELETE FROM "user" WHERE email LIKE $1', [`${PREFIX}%`]);
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
    const { user, token } = await register({ email, password, nickname: '测试用户' });
    expect(user.email).toBe(email);
    expect(user.passwordHash).not.toBe(password);

    const fromSession = await sessionUser(token);
    expect(fromSession?.id).toBe(user.id);

    const logged = await login({ email, password });
    expect(logged.user.id).toBe(user.id);

    await expect(login({ email, password: 'wrong-password' })).rejects.toMatchObject({
      code: 'bad_credentials',
    });
    await expect(register({ email, password, nickname: '重复' })).rejects.toMatchObject({
      code: 'email_taken',
    });

    await deleteSession(token);
    expect(await sessionUser(token)).toBeNull();
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