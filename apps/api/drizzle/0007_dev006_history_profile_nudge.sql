ALTER TABLE "user_profile" ADD COLUMN IF NOT EXISTS "height_cm" real;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "body_metric" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"weight_kg" real NOT NULL,
	"body_fat_pct" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "body_metric" ADD CONSTRAINT "body_metric_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "body_metric_user_date_unique" ON "body_metric" USING btree ("user_id","date");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recovery_nudge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"type" text NOT NULL,
	"shown_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text
);--> statement-breakpoint
ALTER TABLE "recovery_nudge" ADD CONSTRAINT "recovery_nudge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_nudge" ADD CONSTRAINT "recovery_nudge_session_id_workout_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_nudge_user_shown_index" ON "recovery_nudge" USING btree ("user_id","shown_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recovery_nudge_user_type_session_unique" ON "recovery_nudge" USING btree ("user_id","type","session_id");