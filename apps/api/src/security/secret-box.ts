import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * 用户自带 Key 的静态加密 —— AES-256-GCM。
 *
 * 密文格式：`v1:<iv_b64>:<tag_b64>:<ct_b64>`（base64 里没有 `:`，可直接切）。
 * KEK 来自 `KEY_ENCRYPTION_SECRET`（32 字节 base64，`openssl rand -base64 32`）。
 *
 * 🔴 它防的是备份 / 库文件泄漏；防不了主机被拿下（KEK 与库同机）。
 */

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

function kek(): Buffer {
  const raw = process.env.KEY_ENCRYPTION_SECRET?.trim();
  if (!raw) throw new SecretBoxError('KEY_ENCRYPTION_SECRET 没配');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new SecretBoxError('KEY_ENCRYPTION_SECRET 需要 32 字节 base64（openssl rand -base64 32）');
  }
  return key;
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, kek(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function openSecret(sealed: string): string {
  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretBoxError('密文格式不对');
  }
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0) {
    throw new SecretBoxError('密文格式不对');
  }

  try {
    const decipher = createDecipheriv(ALGO, kek(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // 不把底层错误暴露出去 —— 它可能带路径 / 参数
    throw new SecretBoxError('Key 解密失败，请重新保存');
  }
}
