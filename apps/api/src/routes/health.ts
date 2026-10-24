import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '../contracts/health.js';
import { rcStats } from '../guardrails/rc.js';

/**
 * `/health` —— 供 scripts/check-dev.sh 探活与 CI 使用。
 *
 * ⚠️ 它**不读数据库** —— 这是刻意的：探活该回答「进程活着吗」，
 *    而「数据库通不通」由 `pnpm db:check` 单独回答（区分两种故障）。
 *
 * `rc` 是 R-C 钩子的计数：scanned 涨了才证明运行期扫描真的在跑。
 *
 * 🔴 本文件在路由层 —— **不许 import `../db/schema.js`**，取数一律走服务层。
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'know-fit-api',
    rc: { scanned: rcStats.scanned, blocked: rcStats.blocked },
  }));
}