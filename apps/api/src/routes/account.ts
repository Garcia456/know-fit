import type { FastifyInstance } from 'fastify';
import {
  AccountInputSchema,
  AiKeyInputSchema,
  KnowledgeAccessInputSchema,
  type AiKeySummary,
  type UserResponse,
} from '../contracts/auth.js';
import { LlmConfigError, llmConfigErrorResponse } from '../llm/errors.js';
import { clearSessionCookie } from '../plugins/auth.js';
import { checkInviteCode } from '../security/invite-code.js';
import { clearTrainingRecords } from '../services/account.js';
import { AuthError, deleteAccount, publicUser, updateAccount } from '../services/auth.js';
import { unlockKnowledgeAccess } from '../services/knowledge-access.js';
import {
  KeyProbeError,
  type AccountAiView,
  deleteUserLlmKey,
  readAccountAi,
  saveUserLlmKey,
} from '../services/llm-config.js';

/** `/account` —— 改账号资料 / 解锁知识库 / 自带 Key / 清空训练记录 / 注销账号。 */
export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/account/knowledge-access',
    async (request, reply): Promise<{ ok: true; invite_unlocked: true } | undefined> => {
      const parsed = KnowledgeAccessInputSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        await reply.code(400).send({ error: '需要邀请码' });
        return undefined;
      }

      const verdict = checkInviteCode(parsed.data.invite_code);
      if (!verdict.ok) {
        await reply.code(verdict.code === 'not_configured' ? 503 : 403).send({ error: verdict.error });
        return undefined;
      }

      await unlockKnowledgeAccess(request.userId);
      return { ok: true, invite_unlocked: true };
    },
  );
  app.get('/account/ai', async (request): Promise<AccountAiView> => {
    return readAccountAi(request.userId);
  });

  app.put(
    '/account/ai/key',
    async (request, reply): Promise<{ ok: true; key: AiKeySummary } | undefined> => {
      const parsed = AiKeyInputSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        await reply.code(400).send({ error: '需要 { api_key, model }' });
        return undefined;
      }

      try {
        const key = await saveUserLlmKey(request.userId, parsed.data);
        return { ok: true, key };
      } catch (e) {
        if (e instanceof LlmConfigError) {
          const mapped = llmConfigErrorResponse(e);
          await reply.code(mapped.status).send(mapped.body);
          return undefined;
        }
        if (e instanceof KeyProbeError) {
          // 探测没打通：Key 没有保存，用户可以稍后重试
          await reply.code(502).send({
            error: '模型服务暂时连不上，Key 没有保存',
            code: 'llm_probe_failed',
          });
          return undefined;
        }
        throw e;
      }
    },
  );

  app.delete('/account/ai/key', async (request): Promise<{ ok: true }> => {
    await deleteUserLlmKey(request.userId);
    return { ok: true };
  });

  app.patch('/account', async (request, reply): Promise<UserResponse | undefined> => {
    const parsed = AccountInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      await reply.code(400).send({
        error: '昵称 1–20 字、生日 YYYY-MM-DD 或留空、性别取男/女/其他、个性签名 ≤80 字',
      });
      return undefined;
    }
    try {
      const row = await updateAccount(request.userId, parsed.data);
      return { user: publicUser(row) };
    } catch (e) {
      if (e instanceof AuthError && e.code === 'not_found') {
        await reply.code(404).send({ error: '账号不存在' });
        return undefined;
      }
      throw e;
    }
  });

  app.delete('/account/training-records', async (request): Promise<{ ok: true; cleared: unknown }> => {
    const cleared = await clearTrainingRecords(request.userId);
    return { ok: true, cleared };
  });

  app.delete('/account', async (request, reply): Promise<{ ok: true }> => {
    await deleteAccount(request.userId);
    clearSessionCookie(reply);
    return { ok: true };
  });
}