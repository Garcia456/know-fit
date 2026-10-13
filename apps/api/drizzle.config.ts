import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit 配置。
 *
 * ⚠️ `url` 的默认值与 docker-compose.yml / src/db/client.ts 一致 ——
 *    drizzle-kit 在 apps/api 目录下跑，看不到仓库根的 .env，
 *    故这里不依赖 .env 也能工作；要覆盖时导出 DATABASE_URL 即可。
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit',
  },
});