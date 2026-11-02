import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessionUser } from '../services/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** 已登录用户 id；认证钩子之外的路由拿不到。 */
    userId: string;
  }
}

export const SESSION_COOKIE = 'kf_session';
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

/** 公开路径 —— 只认重写后的路径（vite 把 /api 去掉）。 */
const PUBLIC_PATHS = new Set([
  '/health',
  '/ready',
  '/auth/register',
  '/auth/login',
  '/auth/logout',
]);

/** 生产默认 Secure；无域名的临时 HTTP 部署可用 COOKIE_SECURE=0 关掉 */
function secureCookie(): string {
  if (process.env.COOKIE_SECURE === '0') return '';
  return process.env.NODE_ENV === 'production' ? '; Secure' : '';
}

export function readSessionToken(request: FastifyRequest): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  const secure = secureCookie();
  reply.header(
    'set-cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}${secure}`,
  );
}

export function clearSessionCookie(reply: FastifyReply): void {
  const secure = secureCookie();
  reply.header('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

/**
 * 全局认证钩子 —— 必须在注册数据路由之前挂到根作用域。
 * ⚠️ 不能包在 `app.register()` 里：Fastify 插件是封装的，钩子不会作用到兄弟路由。
 */
export async function authOnRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const path = request.url.split('?')[0] ?? '/';
  if (PUBLIC_PATHS.has(path)) return;

  const token = readSessionToken(request);
  const row = token ? await sessionUser(token) : null;
  if (!row) {
    await reply.code(401).send({ error: '请先登录' });
    return;
  }
  request.userId = row.id;
}