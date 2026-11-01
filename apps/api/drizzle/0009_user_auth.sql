-- 用户系统
-- 1) user 表补账号资料字段；2) 新建 auth_session；3) 现有单用户行迁为 demo 账号。

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "email" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "password_hash" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "nickname" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "birthday" date;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "gender" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "bio" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- 现有固定用户 → demo 账号（密码 knowfit-demo）
UPDATE "user"
   SET "email" = 'demo@knowfit.local',
       "password_hash" = 'scrypt$dc2a124a65d7fea21ab82f22a15ca71e$02ac22e0ccfb624adfcc198f8eff4d03470a6a7d70884a13f1567c79882d4e4f421999a006b0939f4e1992688d639fddf42b4cf668f1756f568ae38e83b37b84',
       "nickname" = 'Garcia'
 WHERE "id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint

-- 兜底：理论上没有别的行；给残留行一个不可登录的占位密码，避免 NOT NULL 迁移卡住
UPDATE "user"
   SET "email" = 'legacy-' || "id" || '@knowfit.local'
 WHERE "email" IS NULL;--> statement-breakpoint
UPDATE "user"
   SET "password_hash" = 'scrypt$locked$locked'
 WHERE "password_hash" IS NULL;--> statement-breakpoint
UPDATE "user"
   SET "nickname" = split_part("email", '@', 1)
 WHERE "nickname" IS NULL;--> statement-breakpoint

ALTER TABLE "user" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "password_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "nickname" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_unique" ON "user" ("email");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "auth_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_session_token_hash_unique" ON "auth_session" ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_session_user_index" ON "auth_session" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_session_expiry_index" ON "auth_session" ("expires_at");--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint