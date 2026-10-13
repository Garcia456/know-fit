import type { FastifyInstance } from 'fastify';
import type { SessionVolume } from '../contracts/metrics.js';
import { sessionVolume } from '../services/metrics.js';

/**
 * `GET /sessions/:id/volume` —— 一次训练的容量与肌群分摊。
 *
 * 现算不落库；只给数值，不给配色（热力图在展示层）。
 * 🔴 本文件在路由层 —— 不许 import `../db/schema.js`，一律经服务层取。
 */
export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sessions/:id/volume', async (request, reply): Promise<SessionVolume | undefined> => {
    const { id } = request.params as { id: string };
    const volume = await sessionVolume(id);
    if (!volume) {
      await reply.code(404).send({ error: '没有这条训练记录' });
      return undefined;
    }
    return volume;
  });
}