import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  NudgeActionSchema,
  type NudgeNextResponse,
} from '../contracts/sessions.js';
import { SINGLE_USER_ID } from '../graph/state.js';
import { nextNudge, recordNudgeAction } from '../services/nudges.js';

/**
 * F7 提示面。
 * `next` 用 POST 是因为它有副作用（写 shown_at）。
 */
export async function nudgeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/nudges/next', async (): Promise<NudgeNextResponse> => {
    const nudge = await nextNudge({ user_id: SINGLE_USER_ID });
    return { nudge };
  });

  app.post('/nudges/:id/action', async (request, reply): Promise<{ ok: true } | undefined> => {
    const id = z.string().uuid().safeParse((request.params as { id: string }).id);
    const parsed = NudgeActionSchema.safeParse(request.body ?? {});
    if (!id.success || !parsed.success) {
      await reply.code(400).send({ error: '需要合法 id 与 action（补全 / 忽略 / 未响应）' });
      return undefined;
    }

    const ok = await recordNudgeAction({
      user_id: SINGLE_USER_ID,
      nudge_id: id.data,
      action: parsed.data.action,
    });
    if (!ok) {
      await reply.code(404).send({ error: '没有这条提示' });
      return undefined;
    }
    return { ok: true };
  });
}