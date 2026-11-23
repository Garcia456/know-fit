import type { MailMessage } from '../mail/index.js';
import { register } from './auth.js';
import { sendRegistrationCode } from './registration-code.js';

/**
 * 测试辅助：走真实的「发码 → 读 outbox（内存替身）→ 注册」路径。
 * 只允许测试 import；运行时不要用它绕过邮箱验证。
 */
export async function registerForTest(input: {
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
  if (!code) throw new Error('测试：注册验证码没有发出来');
  return register({ ...input, code });
}
