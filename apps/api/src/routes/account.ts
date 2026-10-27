import type { FastifyInstance } from 'fastify';
import { AccountInputSchema, type UserResponse } from '../contracts/auth.js';
import { clearSessionCookie } from '../plugins/auth.js';
import { clearTrainingRecords } from '../services/account.js';
import { AuthError, deleteAccount, publicUser, updateAccount } from '../services/auth.js';

/** `/account` —— 改账号资料 / 清空训练记录 / 注销账号。 */
export async function accountRoutes(app: FastifyInstance): Promise<void> {
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