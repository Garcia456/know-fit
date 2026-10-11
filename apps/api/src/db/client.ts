import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

/**
 * 数据库连接（dev-001 最小实现）。
 *
 * ⚠️ 默认连接串与 docker-compose.yml 一致 —— 这样「克隆即跑」不必先配 .env。
 *    要覆盖时设 DATABASE_URL（.env.example 里有说明）。
 */
export const DEFAULT_DATABASE_URL = 'postgres://knowfit:knowfit@localhost:5432/knowfit';

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function createPool(connectionString = databaseUrl()): Pool {
  return new Pool({ connectionString, connectionTimeoutMillis: 3000 });
}

export function createDb(pool: Pool) {
  return drizzle(pool);
}