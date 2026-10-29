-- 会话置顶：pinned_at 非空即在列表最前；置顶不改 updated_at（不影响按更新时间分组）
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "pinned_at" timestamp with time zone;