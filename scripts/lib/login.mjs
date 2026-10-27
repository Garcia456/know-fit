/**
 * e2e 公用：从响应里取会话 cookie，并用 demo 账号登录取一份。
 * 迁移 0009 把旧数据都挂在这个账号上，所以 e2e 看到的还是原来那批记录。
 */
export const DEMO_EMAIL = process.env.E2E_EMAIL ?? 'demo@knowfit.local';
export const DEMO_PASSWORD = process.env.E2E_PASSWORD ?? 'knowfit-demo';

export function sessionCookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  const cookie = raw
    .map((line) => line.split(';')[0])
    .filter(Boolean)
    .join('; ');
  if (!cookie) throw new Error('响应里没有会话 cookie');
  return cookie;
}

export async function loginDemo(base) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`demo 登录失败：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return sessionCookieFrom(res);
}