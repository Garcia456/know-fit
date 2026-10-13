import Fastify from 'fastify';
import { pathToFileURL } from 'node:url';
import { databaseUrl } from './db/client.js';
import { healthRoutes } from './routes/health.js';
import { turnRoutes } from './routes/turns.js';
import { closeDb, getPool } from './services/pool.js';

const PORT = Number(process.env.PORT ?? 3000);

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  await app.register(healthRoutes);
  await app.register(turnRoutes);
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