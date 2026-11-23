import nodemailer, { type Transporter } from 'nodemailer';
import type { MailClient } from './fake.js';

/**
 * 真实投递：SMTP 走 nodemailer。
 * 缺 SMTP_HOST / MAIL_FROM 时在创建期就报错，别等第一封邮件才发现没配。
 */
export function createSmtpMailClient(env: NodeJS.ProcessEnv = process.env): MailClient {
  const host = env.SMTP_HOST?.trim();
  const from = env.MAIL_FROM?.trim();
  if (!host || !from) {
    throw new Error('MAIL_PROVIDER=smtp 需要 SMTP_HOST 与 MAIL_FROM');
  }
  const port = Number(env.SMTP_PORT) || 587;
  const secure = env.SMTP_SECURE === '1' || env.SMTP_SECURE === 'true';
  const authUser = env.SMTP_USER?.trim();

  let transporter: Transporter | null = null;
  return {
    async send(message) {
      transporter ??= nodemailer.createTransport({
        host,
        port,
        secure,
        ...(authUser ? { auth: { user: authUser, pass: env.SMTP_PASS ?? '' } } : {}),
      });
      await transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}
