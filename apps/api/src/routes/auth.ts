import type { FastifyInstance } from 'fastify';
import {
  LoginSchema,
  RegisterSchema,
  type UserResponse,
} from '../contracts/auth.js';
import { clearSessionCookie, readSessionToken, setSessionCookie } from '../plugins/auth.js';
import { checkRegistration } from '../security/registration.js';
import {
  AuthError,
  deleteSession,
  getUser,
  login,
  publicUser,
  register,
} from '../services/auth.js';

/** `/auth/*` —— 注册 / 登录 / 退出 / 当前用户。 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (request, reply): Promise<UserResponse | undefined> => {
    const parsed = RegisterSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      await reply.code(400).send({ error: '需要昵称（1–20 字）、合法邮箱、至少 8 位密码' });
      return undefined;
    }

    const gate = checkRegistration(parsed.data.invite_code);
    if (!gate.ok) {
      await reply.code(403).send({ error: gate.error });
      return undefined;
    }

    try {
      const result = await register(parsed.data);
      setSessionCookie(reply, result.token);
      return { user: publicUser(result.user) };
    } catch (e) {
      if (e instanceof AuthError && e.code === 'email_taken') {
        await reply.code(409).send({ error: '这个邮箱已经注册过了' });
        return undefined;
      }
      throw e;
    }
  });

  app.post('/auth/login', async (request, reply): Promise<UserResponse | undefined> => {
    const parsed = LoginSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      await reply.code(400).send({ error: '需要邮箱与密码' });
      return undefined;
    }
    try {
      const result = await login(parsed.data);
      setSessionCookie(reply, result.token);
      return { user: publicUser(result.user) };
    } catch (e) {
      if (e instanceof AuthError && e.code === 'bad_credentials') {
        await reply.code(401).send({ error: '邮箱或密码不对' });
        return undefined;
      }
      throw e;
    }
  });

  // 重复退出也返回 200 —— 前端不必区分「本来就没登录」
  app.post('/auth/logout', async (request, reply): Promise<{ ok: true }> => {
    const token = readSessionToken(request);
    if (token) await deleteSession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/auth/me', async (request, reply): Promise<UserResponse | undefined> => {
    const row = await getUser(request.userId);
    if (!row) {
      await reply.code(401).send({ error: '请先登录' });
      return undefined;
    }
    return { user: publicUser(row) };
  });
}