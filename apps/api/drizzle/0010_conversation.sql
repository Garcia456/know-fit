CREATE TABLE IF NOT EXISTS "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_user_updated_index" ON "conversation" USING btree ("user_id","updated_at");--> statement-breakpoint
ALTER TABLE "conversation_turn" ADD COLUMN IF NOT EXISTS "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_turn" ADD COLUMN IF NOT EXISTS "reply_json" jsonb;--> statement-breakpoint
ALTER TABLE "conversation_turn" ADD CONSTRAINT "conversation_turn_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_turn_conversation_index" ON "conversation_turn" USING btree ("conversation_id","created_at");--> statement-breakpoint
-- 旧轮次没有会话 id：每个用户收进一条「迁移前的对话」，历史不丢
INSERT INTO "conversation" ("user_id", "title", "created_at", "updated_at")
SELECT "user_id", '迁移前的对话', MIN("created_at"), MAX("created_at")
  FROM "conversation_turn"
 WHERE "conversation_id" IS NULL
 GROUP BY "user_id";--> statement-breakpoint
UPDATE "conversation_turn" AS t
   SET "conversation_id" = c."id"
  FROM "conversation" AS c
 WHERE t."conversation_id" IS NULL
   AND c."user_id" = t."user_id"
   AND c."title" = '迁移前的对话';