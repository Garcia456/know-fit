-- 用户自带的模型配置：Key 只落密文（AES-256-GCM），末 4 位另存用于回显。
CREATE TABLE IF NOT EXISTS "user_llm_config" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'deepseek' NOT NULL,
	"model" text NOT NULL,
	"key_ciphertext" text NOT NULL,
	"key_hint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "user_llm_config" ADD CONSTRAINT "user_llm_config_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
