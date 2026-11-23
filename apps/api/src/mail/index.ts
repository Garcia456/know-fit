import { createFakeMailClient, type MailClient } from './fake.js';
import { createSmtpMailClient } from './smtp.js';

export type { MailClient, MailMessage } from './fake.js';

/**
 * 按 MAIL_PROVIDER 选投递方式：fake（默认，写 outbox 文件）｜smtp。
 * 生产用 fake 会启动告警，见 server.ts。
 */
export function createMailClient(env: NodeJS.ProcessEnv = process.env): MailClient {
  return env.MAIL_PROVIDER === 'smtp' ? createSmtpMailClient(env) : createFakeMailClient(env);
}
