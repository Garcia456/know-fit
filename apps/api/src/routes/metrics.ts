import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SessionVolume, StatsRange, WeeklyVolume, WeightHistory } from '../contracts/metrics.js';
import { sessionVolume, statsRange, weeklyVolume, weightHistory } from '../services/metrics.js';

/**
 * 训练量读接口：单次容量 / 近 N 周容量 / 近 N 周体重。
 *
 * 现算不落库；只给数值，不给配色（热力图在展示层）。
 * 🔴 本文件在路由层 —— 不许 import `../db/schema.js`，一律经服务层取。
 */

const WeeksQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(26).default(4),
});

const StatsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SPAN_DAYS = 365;

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sessions/:id/volume', async (request, reply): Promise<SessionVolume | undefined> => {
    const { id } = request.params as { id: string };
    const volume = await sessionVolume({ user_id: request.userId, session_id: id });
    if (!volume) {
      await reply.code(404).send({ error: '没有这条训练记录' });
      return undefined;
    }
    return volume;
  });

  app.get('/metrics/weekly', async (request): Promise<WeeklyVolume> => {
    const parsed = WeeksQuerySchema.safeParse(request.query ?? {});
    const weeks = parsed.success ? parsed.data.weeks : 4;
    return weeklyVolume({ user_id: request.userId, weeks });
  });

  app.get('/metrics/weight', async (request): Promise<WeightHistory> => {
    const parsed = WeeksQuerySchema.safeParse(request.query ?? {});
    const weeks = parsed.success ? parsed.data.weeks : 8;
    return weightHistory({ user_id: request.userId, weeks });
  });

  app.get('/stats', async (request, reply): Promise<StatsRange | undefined> => {
    const parsed = StatsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      await reply.code(400).send({ error: 'from / to 需要 YYYY-MM-DD' });
      return undefined;
    }
    const { from, to } = parsed.data;
    const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
    if (!Number.isFinite(span) || span < 0) {
      await reply.code(400).send({ error: '开始日期不能晚于结束日期' });
      return undefined;
    }
    if (span > MAX_SPAN_DAYS) {
      await reply.code(400).send({ error: '范围最长 366 天' });
      return undefined;
    }
    return statsRange({ user_id: request.userId, from, to });
  });
}