import type { FastifyInstance } from 'fastify';
import {
  LoginSchema,
  RegisterCodeSchema,
  RegisterSchema,
  VerifyEmailSchema,
  type UserResponse,
} from '../contracts/auth.js';
import { clearSessionCookie, readSessionToken, setSessionCookie } from '../plugins/auth.js';
import {
  AuthError,
  deleteSession,
  emailTaken,
  getUser,
  login,
  publicUser,
  register,
} from '../services/auth.js';
import { consumeEmailVerification, sendVerificationEmail } from '../services/email-verification.js';
import {
  REGISTRATION_CODE_RESEND_SECONDS,
  RegistrationCodeError,
  sendRegistrationCode,
} from '../services/registration-code.js';

/** `/auth/*` —— 注册 / 登录 / 退出 / 当前用户。 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  // 注册第一步：把验证码发到邮箱。没有它就无法完成注册。
  app.post(
    '/auth/register/code',
    async (request, reply): Promise<{ ok: true; sent: true; expires_in: number } | undefined> => {
      const parsed = RegisterCodeSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        await reply.code(400).send({ error: '需要一个合法邮箱' });
        return undefined;
      }
      if (await emailTaken(parsed.data.email)) {
        await reply.code(409).send({ error: '这个邮箱已经注册过了' });
        return undefined;
      }

      try {
        const { expiresInSec } = await sendRegistrationCode(parsed.data.email);
        return { ok: true, sent: true, expires_in: expiresInSec };
      } catch (e) {
        if (e instanceof RegistrationCodeError) {
          reply.header('retry-after', String(REGISTRATION_CODE_RESEND_SECONDS));
          await reply.code(429).send({ error: '验证码发得太频繁了，请稍后再试' });
          return undefined;
        }
        request.log.error({ err: e }, '注册验证码发送失败');
        await reply.code(502).send({ error: '验证码发送失败，请稍后再试' });
        return undefined;
      }
    },
  );

  app.post('/auth/register', async (request, reply): Promise<UserResponse | undefined> => {
    const parsed = RegisterSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      await reply
        .code(400)
        .send({ error: '需要昵称（1–20 字）、合法邮箱、至少 8 位密码和邮箱验证码' });
      return undefined;
    }

    try {
      const result = await register(parsed.data);
      setSessionCookie(reply, result.token);
      return { user: publicUser(result.user) };
    } catch (e) {
      if (e instanceof AuthError) {
        if (e.code === 'email_taken') {
          await reply.code(409).send({ error: '这个邮箱已经注册过了' });
          return undefined;
        }
        if (e.code === 'code_attempts') {
          await reply.code(400).send({
            error: '验证码错误次数过多，请重新获取',
            code: 'register_code_attempts',
          });
          return undefined;
        }
        if (e.code === 'code_invalid') {
          await reply.code(400).send({
            error: '验证码不对或已过期，请重新获取',
            code: 'register_code_invalid',
          });
          return undefined;
        }
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

  // 公开：点邮件里的链接后，前端把 token 交回来兑换验证状态
  app.post('/auth/verify-email', async (request, reply): Promise<{ ok: true; email_verified: true } | undefined> => {
    const parsed = VerifyEmailSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      await reply.code(400).send({ error: '验证链接无效或已过期' });
      return undefined;
    }
    const ok = await consumeEmailVerification(parsed.data.token);
    if (!ok) {
      await reply.code(400).send({ error: '验证链接无效或已过期' });
      return undefined;
    }
    return { ok: true, email_verified: true };
  });

  app.post(
    '/auth/verify-email/resend',
    async (
      request,
      reply,
    ): Promise<{ ok: true; email_verified: boolean; sent: boolean } | undefined> => {
      const row = await getUser(request.userId);
      if (!row) {
        await reply.code(401).send({ error: '请先登录' });
        return undefined;
      }
      if (row.emailVerifiedAt) return { ok: true, email_verified: true, sent: false };

      try {
        await sendVerificationEmail(row);
      } catch (e) {
        request.log.error({ err: e }, '验证邮件发送失败');
        await reply.code(502).send({ error: '验证邮件发送失败，请稍后再试' });
        return undefined;
      }
      return { ok: true, email_verified: false, sent: true };
    },
  );

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