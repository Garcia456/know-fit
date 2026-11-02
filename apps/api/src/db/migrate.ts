import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from '../services/pool.js';

/**
 * 生产迁移入口：用运行时依赖 drizzle-orm 自带 migrator，不依赖 drizzle-kit。
 * 迁移文件在包根的 drizzle/ 目录（镜像里随包一起走）。
 */
const HERE = dirname(fileURLToPath(import.meta.url));

try {
  await migrate(getDb(), { migrationsFolder: join(HERE, '..', '..', 'drizzle') });
  console.log('migrations applied successfully');
} finally {
  await closeDb();
}