import { appendFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** 一封纯文本邮件 —— 模板由调用方拼好，这里只负责投递。 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailClient {
  send(message: MailMessage): Promise<void>;
}

/**
 * 替身投递：把邮件逐行写进 `${MAIL_OUTBOX_DIR}/outbox.jsonl`。
 * 本地开发与 CI 用它读验证链接，不联网、不依赖 SMTP。
 */
export function createFakeMailClient(env: NodeJS.ProcessEnv = process.env): MailClient {
  return {
    async send(message) {
      const dir = resolve(env.MAIL_OUTBOX_DIR ?? '.mail-outbox');
      await mkdir(dir, { recursive: true });
      const line = JSON.stringify({ ...message, created_at: new Date().toISOString() });
      await appendFile(join(dir, 'outbox.jsonl'), `${line}\n`, 'utf8');
    },
  };
}
