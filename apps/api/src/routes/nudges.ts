import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  NudgeActionSchema,
  type NudgeNextResponse,
} from '../contracts/sessions.js';
import { applyBackfillAction } from '../services/backfill.js';
import { nextNudge, recordNudgeAction } from '../services/nudges.js';

/**
 * F7 提示面。
 * `next` 用 POST 是因为它有副作用（写 shown_at）。
 */
export async function nudgeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/nudges/next', async (request): Promise<NudgeNextResponse> => {
    const nudge = await nextNudge({ user_id: request.userId });
    return { nudge };
  });

  app.post(
    '/nudges/:id/action',
    async (request, reply): Promise<{ ok: true; prefill?: { target_date: string; split_label: string | null } } | undefined> => {
      const id = z.string().uuid().safeParse((request.params as { id: string }).id);
      const parsed = NudgeActionSchema.safeParse(request.body ?? {});
      if (!id.success || !parsed.success) {
        await reply.code(400).send({ error: '需要合法 id 与 action（补全 / 补记 / 休息 / 忽略 / 未响应）' });
        return undefined;
      }

      const action = parsed.data.action;

      // 补记 / 休息必须落在一条“补记”提示上；忽略两者都兼容
      if (action === '补记' || action === '休息' || action === '忽略') {
        const result = await applyBackfillAction({
          user_id: request.userId,
          nudge_id: id.data,
          action,
        });
        if (result) return result;
        if (action !== '忽略') {
          await reply.code(404).send({ error: '这条提示不是补记提示' });
          return undefined;
        }
      }

      const ok = await recordNudgeAction({
        user_id: request.userId,
        nudge_id: id.data,
        action,
      });
      if (!ok) {
        await reply.code(404).send({ error: '没有这条提示' });
        return undefined;
      }
      return { ok: true };
    },
  );
}