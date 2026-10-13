CREATE TABLE "conversation_turn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"intent" text,
	"linked_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"raw_name" text NOT NULL,
	"exercise_id" text,
	"name_confidence" text,
	"region_fallback" text
);
--> statement-breakpoint
CREATE TABLE "set_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_entry_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"weight_kg" real,
	"reps" integer,
	"set_type" text NOT NULL,
	"is_inferred" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"goal" text,
	"training_years_band" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"split_label" text,
	"status" text NOT NULL,
	"missing_fields" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_turn" ADD CONSTRAINT "conversation_turn_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_entry" ADD CONSTRAINT "exercise_entry_session_id_workout_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_entry" ADD CONSTRAINT "set_entry_exercise_entry_id_exercise_entry_id_fk" FOREIGN KEY ("exercise_entry_id") REFERENCES "public"."exercise_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session" ADD CONSTRAINT "workout_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 以下为手写追加（drizzle-kit 不会生成）：v1 单用户的固定锚点。
-- 没有 user_profile 行，boundary 判定拿不到 training_years_band。
INSERT INTO "user" ("id") VALUES ('00000000-0000-4000-8000-000000000001');--> statement-breakpoint
INSERT INTO "user_profile" ("user_id", "goal", "training_years_band") VALUES ('00000000-0000-4000-8000-000000000001', '增肌', '3m_2y');