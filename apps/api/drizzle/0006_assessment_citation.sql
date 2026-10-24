CREATE TABLE "assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"related_record_id" uuid,
	"verdict_json" jsonb NOT NULL,
	"advice_text" text NOT NULL,
	"advice_claims" jsonb NOT NULL,
	"has_source" boolean NOT NULL,
	"model_version" text NOT NULL,
	"judge_model_version" text NOT NULL,
	"pipeline_meta" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_related_record_id_workout_session_id_fk" FOREIGN KEY ("related_record_id") REFERENCES "public"."workout_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_user_created_index" ON "assessment" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE TABLE "citation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"chunk_id" uuid,
	"url_with_ts" text NOT NULL,
	"display_order" integer NOT NULL,
	"usability_status" text NOT NULL,
	"quote_start" integer,
	"quote_end" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "citation" ADD CONSTRAINT "citation_assessment_id_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation" ADD CONSTRAINT "citation_chunk_id_knowledge_chunk_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunk"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "citation_assessment_index" ON "citation" USING btree ("assessment_id");