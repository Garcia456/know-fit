-- 免费对话额度：已验证账号每走一轮 /turns 记一次；受邀账号不扣。
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "free_turns_used" integer DEFAULT 0 NOT NULL;
