-- dev-001 §1.3：向量库本体（技术方案 §6.2 —— 不引入独立向量库，HNSW / vector_cosine_ops
-- / vector(1024) 全部压在 PostgreSQL + pgvector 上）。
--
-- ⚠️ 顺序要紧：本迁移必须排在 0001_smoke_table 之前 ——
--    后者的 embedding 列类型 vector(1024) 依赖这个扩展。
CREATE EXTENSION IF NOT EXISTS vector;