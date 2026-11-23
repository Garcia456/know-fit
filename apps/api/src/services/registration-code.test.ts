import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { MailMessage } from '../mail/index.js';
import { closeDb, getPool } from './pool.js';
import {
  consumeRegistrationCode,
  sendRegistrationCode,
} from './registration-code.js';

/** 注册验证码 —— 连真库；邮件用内存 recorder 接住，不联网。
 *
 * 时间基准取真实当下：sendRegistrationCode 会顺手清理过期行，
 * 若这里写死过去的日期，并行跑的其它测试会把本用例的行当成过期数据删掉。
 */

const PREFIX = 'test-reg-code-';

function recorder(): { mail: { send(m: MailMessage): Promise<void> }; messages: MailMessage[] } {
  const messages: MailMessage[] = [];
  return {
    messages,
    mail: {
      async send(message) {
        messages.push(message);
      },
    },
  };
}

function codeFrom(messages: MailMessage[]): string {
  const match = /验证码：(\d{6})/.exec(messages.at(-1)?.text ?? '');
  if (!match) throw new Error('邮件里没有 6 位验证码');
  return match[1]!;
}

afterAll(async () => {
  await getPool().query('DELETE FROM registration_verification WHERE email LIKE $1', [
    `${PREFIX}%`,
  ]);
  await closeDb();
});

describe('注册验证码', () => {
  it('发码 → 兑换成功；验证码单次使用', async () => {
    const email = `${PREFIX}${randomUUID()}@knowfit.local`;
    const { mail, messages } = recorder();
    await sendRegistrationCode(email, { mail });

    expect(messages).toHaveLength(1);
    expect(messages[0]!.to).toBe(email);
    expect(messages[0]!.subject).toContain('注册验证码');
    const code = codeFrom(messages);

    expect(await consumeRegistrationCode(email, code)).toBe('ok');
    // 用第二次：最新一码已消费，查不到可用行
    expect(await consumeRegistrationCode(email, code)).toBe('missing');
  });

  it('同一邮箱 60 秒内重发 → too_soon；过了窗口可以重发', async () => {
    const email = `${PREFIX}${randomUUID()}@knowfit.local`;
    const { mail } = recorder();
    const t0 = new Date();

    await sendRegistrationCode(email, { mail, now: t0 });
    await expect(
      sendRegistrationCode(email, { mail, now: new Date(t0.getTime() + 30_000) }),
    ).rejects.toMatchObject({ code: 'too_soon' });
    await expect(
      sendRegistrationCode(email, { mail, now: new Date(t0.getTime() + 61_000) }),
    ).resolves.toMatchObject({ expiresInSec: 600 });
  });

  it('输错 5 次后作废；正确码也不再生效', async () => {
    const email = `${PREFIX}${randomUUID()}@knowfit.local`;
    const { mail, messages } = recorder();
    const now = new Date();
    await sendRegistrationCode(email, { mail, now });
    const code = codeFrom(messages);

    for (let i = 0; i < 4; i += 1) {
      expect(await consumeRegistrationCode(email, '000000', now)).toBe('mismatch');
    }
    expect(await consumeRegistrationCode(email, '000000', now)).toBe('attempts_exceeded');
    expect(await consumeRegistrationCode(email, code, now)).toBe('attempts_exceeded');
  });

  it('过期的验证码不能用', async () => {
    const email = `${PREFIX}${randomUUID()}@knowfit.local`;
    const { mail, messages } = recorder();
    const now = new Date();
    await sendRegistrationCode(email, { mail, now });
    const code = codeFrom(messages);

    expect(
      await consumeRegistrationCode(email, code, new Date(now.getTime() + 11 * 60 * 1000)),
    ).toBe('missing');
  });

  it('新码作废旧码，旧码不会误通过', async () => {
    const email = `${PREFIX}${randomUUID()}@knowfit.local`;
    const { mail, messages } = recorder();
    const t0 = new Date();
    await sendRegistrationCode(email, { mail, now: t0 });
    const first = codeFrom(messages);

    const t1 = new Date(t0.getTime() + 61_000);
    await sendRegistrationCode(email, { mail, now: t1 });
    const second = codeFrom(messages);
    expect(second).not.toBe(first);

    expect(await consumeRegistrationCode(email, first, t1)).toBe('mismatch');
    expect(await consumeRegistrationCode(email, second, t1)).toBe('ok');
  });
});
