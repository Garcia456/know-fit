import type { FastifyInstance } from 'fastify';
import { TurnRequestSchema, type TurnResponse } from '../contracts/turn.js';
import { handleTurn } from '../services/turn.js';

/**
 * `POST /turns` —— 一轮对话录入。
 *
 * ⚠️ 对外路径是 `/api/turns`：vite dev server 把 `/api` 前缀重写掉后才到 API
 *    （与 `/api/health` → `/health` 同一个约定）。
 *
 * 🔴 本文件在路由层 —— **不许 import `../db/schema.js`**，一律经服务层取裁剪过的字段。
 */
export async function turnRoutes(app: FastifyInstance): Promise<void> {
  app.post('/turns', async (request, reply): Promise<TurnResponse | undefined> => {
    const parsed = TurnRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: '请求体需要 { message: string }' });
      return undefined;
    }
    return handleTurn({ message: parsed.data.message });
  });
}