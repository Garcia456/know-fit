/**
 * e2e 公用：注册必须先通过邮箱验证码。
 * fake 邮件客户端把验证码写进 outbox，这里读出来再完成注册。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function json(res) {
  return res.json().catch(() => null);
}

/** 从 outbox 里找发给这个邮箱的最后一封注册验证码邮件 */
export function readRegistrationCode(
  email,
  outboxDir = process.env.MAIL_OUTBOX_DIR ?? '.mail-outbox',
) {
  const file = resolve(outboxDir, 'outbox.jsonl');
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const lines = raw.trim().split('\n').reverse();
  for (const line of lines) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.to !== email) continue;
    const match = /验证码：(\d{6})/.exec(String(message.text ?? ''));
    if (match) return match[1];
  }
  return null;
}

/** 第一步：请求验证码。apiBase 是 `/api` 这一层（e2e-dev013 直接是 API 根）。 */
export async function requestRegistrationCode(apiBase, email) {
  const res = await fetch(`${apiBase}/auth/register/code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return { status: res.status, body: await json(res), headers: res.headers };
}

/**
 * 发码 → 读 outbox → 带验证码注册。
 * 返回结构尽量贴近裸 fetch：status / body / headers，另带 stage 便于报错。
 */
export async function registerWithCode(
  apiBase,
  { email, password, nickname },
  { outboxDir } = {},
) {
  const sent = await requestRegistrationCode(apiBase, email);
  if (sent.status !== 200) {
    return { ...sent, stage: 'code' };
  }
  const code = readRegistrationCode(email, outboxDir);
  if (!code) {
    return { status: 0, body: null, headers: new Headers(), stage: 'outbox' };
  }
  const res = await fetch(`${apiBase}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, nickname, code }),
  });
  return { status: res.status, body: await json(res), headers: res.headers, stage: 'register' };
}
