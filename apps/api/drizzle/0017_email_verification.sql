-- 邮箱验证：user 记验证时间，email_verification 存一次性令牌（只存 SHA-256）。
-- 回填：升级前已有的账号一律视为已验证，避免老用户被额度闸门挡在外面。

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_verification_token_hash_unique" ON "email_verification" ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_verification_user_index" ON "email_verification" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_verification_expiry_index" ON "email_verification" ("expires_at");--> statement-breakpoint
ALTER TABLE "email_verification" ADD CONSTRAINT "email_verification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- 受邀用户按解锁时间回填，其余按注册时间
UPDATE "user" SET "email_verified_at" = COALESCE("invite_unlocked_at", "created_at")
WHERE "email_verified_at" IS NULL;
