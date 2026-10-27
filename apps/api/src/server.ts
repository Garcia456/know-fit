import Fastify, { type FastifyInstance } from 'fastify';
import { pathToFileURL } from 'node:url';
import { databaseUrl } from './db/client.js';
import { responseGuard } from './guardrails/rc.js';
import { authOnRequest } from './plugins/auth.js';
import { accountRoutes } from './routes/account.js';
import { assessmentRoutes } from './routes/assessments.js';
import { authRoutes } from './routes/auth.js';
import { conversationRoutes } from './routes/conversations.js';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { nudgeRoutes } from './routes/nudges.js';
import { profileRoutes } from './routes/profile.js';
import { sessionRoutes } from './routes/sessions.js';
import { turnRoutes } from './routes/turns.js';
import { loadAllChunkTexts } from './services/chunks.js';
import { closeDb, getPool } from './services/pool.js';

const PORT = Number(process.env.PORT ?? 3000);
/** R-C 窗口集刷新间隔 —— 新入库的片最多晚 60 秒被纳入 */
const RC_REFRESH_MS = 60_000;

async function refreshGuardWindows(app: FastifyInstance): Promise<void> {
  try {
    responseGuard.setTexts(await loadAllChunkTexts());
  } catch (e) {
    app.log.warn(`R-C 窗口集刷新失败：${(e as Error).message}`);
  }
}

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  // 🔴 认证钩子必须在注册路由之前挂到**根作用域**（包在 register 里不会作用于兄弟路由）
  app.decorateRequest('userId', '');
  app.addHook('onRequest', authOnRequest);

  // 🔴 R-C：钩子必须在注册路由之前挂 —— onSend 只作用于之后注册的路由
  await refreshGuardWindows(app);
  const timer = setInterval(() => void refreshGuardWindows(app), RC_REFRESH_MS);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));

  app.addHook('onSend', async (request, reply, payload) => {
    const contentType = reply.getHeader('content-type');
    if (typeof contentType !== 'string' || !contentType.includes('application/json')) return payload;
    if (typeof payload !== 'string') return payload;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return payload;
    }

    const verdict = responseGuard.inspect(parsed);
    if (!verdict.blocked) return payload;

    // 只记路由与哈希前缀，不记原文
    app.log.error({ route: request.url, rc_prefix: verdict.prefix }, 'R-C 拦截：响应疑似含知识片全文');
    await reply.code(500).type('application/json');
    return JSON.stringify({ error: 'response_guard' });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(turnRoutes);
  await app.register(conversationRoutes);
  await app.register(metricsRoutes);
  await app.register(assessmentRoutes);
  await app.register(sessionRoutes);
  await app.register(profileRoutes);
  await app.register(nudgeRoutes);
  return app;
}

async function main(): Promise<void> {
  const app = await buildServer();

  // 数据库可达性检查 —— 连不上要给人看得懂的报错，不是一串栈。
  // ⚠️ 连不上不退出：/health 不依赖库，而库的问题由 pnpm db:check 单独报。
  const pool = getPool();
  try {
    await pool.query('SELECT 1');
    app.log.info('数据库已连接');
  } catch (e) {
    app.log.warn(`⚠️  数据库连不上：${(e as Error).message}`);
    app.log.warn(`    连接串：${databaseUrl().replace(/:[^:@]*@/, ':***@')}`);
    app.log.warn('    /health 仍可用，但任何读库的路由都会失败。起库：pnpm db:up');
  }

  await app.listen({ port: PORT, host: '0.0.0.0' });

  const shutdown = async () => {
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// 仅在被直接执行时启动（被测试 import 时不启动）。
// ⚠️ 必须用 pathToFileURL 而不是裸拼 `file://${argv[1]}` ——
//    后者在 Windows 上会得到 file://D:/... （两个斜杠）而 import.meta.url 是三个斜杠，
//    结果是「server 永远不启动」，且不报任何错。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}