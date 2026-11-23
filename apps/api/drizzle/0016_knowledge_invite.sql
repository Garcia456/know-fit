-- 邀请码解锁知识库的时间；NULL = 未解锁（新注册账号默认无 RAG）。
-- 回填：已有 knowledge_access 授权的账号视为已解锁，避免老用户被当成未开启。

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "invite_unlocked_at" timestamp with time zone;--> statement-breakpoint
UPDATE "user" SET "invite_unlocked_at" = now()
WHERE "invite_unlocked_at" IS NULL
  AND id IN (SELECT DISTINCT "user_id" FROM "knowledge_access");
