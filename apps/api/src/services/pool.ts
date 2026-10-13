import type { Pool } from 'pg';
import { createDb, createPool } from '../db/client.js';

/**
 * 共享连接池 —— 服务层与 server.ts 的探活共用同一个，避免开两个池。
 */

let pool: Pool | null = null;
let db: ReturnType<typeof createDb> | null = null;

export function getPool(): Pool {
  pool ??= createPool();
  return pool;
}

export function getDb(): ReturnType<typeof createDb> {
  db ??= createDb(getPool());
  return db;
}

export async function closeDb(): Promise<void> {
  if (!pool) return;
  await pool.end().catch(() => {});
  pool = null;
  db = null;
}