import type { FastifyInstance } from 'fastify';
import {
  HistoryQuerySchema,
  PatchSessionRequestSchema,
  SessionListQuerySchema,
  type HistoryResponse,
  type SessionDetail,
  type SessionListResponse,
} from '../contracts/sessions.js';
import {
  appendToSession,
  getSessionDetail,
  listHistory,
  listSessions,
} from '../services/history.js';

/**
 * 数据页的读接口 + F7 的追加式补全。
 * 🔴 本文件在路由层 —— 不许 import `../db/schema.js`，一律经服务层取。
 */
export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sessions', async (request, reply): Promise<SessionListResponse | undefined> => {
    const parsed = SessionListQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      await reply.code(400).send({ error: '查询参数需要 from / to（YYYY-MM-DD）' });
      return undefined;
    }
    const sessions = await listSessions({ user_id: request.userId, ...parsed.data });
    return { sessions };
  });

  app.get('/history', async (request): Promise<HistoryResponse> => {
    const parsed = HistoryQuerySchema.safeParse(request.query ?? {});
    const limit = parsed.success ? parsed.data.limit : 20;
    const items = await listHistory({ user_id: request.userId, limit });
    return { items };
  });

  app.get('/sessions/:id', async (request, reply): Promise<SessionDetail | undefined> => {
    const { id } = request.params as { id: string };
    const detail = await getSessionDetail({ user_id: request.userId, session_id: id });
    if (!detail) {
      await reply.code(404).send({ error: '没有这条训练记录' });
      return undefined;
    }
    return detail;
  });

  app.patch('/sessions/:id', async (request, reply): Promise<SessionDetail | undefined> => {
    const { id } = request.params as { id: string };
    const parsed = PatchSessionRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      await reply.code(400).send({ error: '请求体需要至少一个带组的动作（exercises）' });
      return undefined;
    }

    const result = await appendToSession({
      user_id: request.userId,
      session_id: id,
      patch: parsed.data,
    });
    if (result === 'not_found') {
      await reply.code(404).send({ error: '没有这条训练记录' });
      return undefined;
    }
    if (result === 'complete') {
      await reply.code(409).send({ error: '这条训练已记完，补全只用于缺字段的记录' });
      return undefined;
    }
    return result;
  });
}