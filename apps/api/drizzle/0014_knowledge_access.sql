-- 知识授权表：一行 = 某用户可检索某受限平台；无行 = 不可见。

CREATE TABLE IF NOT EXISTS "knowledge_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_access_user_platform_unique" ON "knowledge_access" ("user_id","platform");--> statement-breakpoint
ALTER TABLE "knowledge_access" ADD CONSTRAINT "knowledge_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- demo 账号种一条抖音授权；新注册账号默认没有
INSERT INTO "knowledge_access" ("user_id", "platform")
SELECT '00000000-0000-4000-8000-000000000001', 'douyin'
WHERE EXISTS (SELECT 1 FROM "user" WHERE "id" = '00000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;