import { integer, pgTable, text, vector } from 'drizzle-orm/pg-core';

/**
 * smoke 表 —— dev-001 §二 第 4 条。
 *
 * 只建这一张，**不建 PRD 的 14 张业务表**（那些是 dev-002 / dev-003 的产物）。
 * 它的用途只有一个：证明「迁移能真的跑、`vector(1024)` 列能真的建、HNSW 索引能真的建」。
 *
 * 1024 维 = 技术方案 §6.2 定的 text-embedding-v4 的输出维度。
 */
export const smoke = pgTable('smoke', {
  id: integer('id').primaryKey(),
  note: text('note'),
  embedding: vector('embedding', { dimensions: 1024 }),
});