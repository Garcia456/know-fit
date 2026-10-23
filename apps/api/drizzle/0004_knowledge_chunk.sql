CREATE TABLE "knowledge_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"segment_key" text NOT NULL,
	"text" text NOT NULL,
	"context_prefix" text NOT NULL,
	"start_ts" real NOT NULL,
	"end_ts" real NOT NULL,
	"topic_tags" text[] DEFAULT '{}' NOT NULL,
	"exercise_tags" text[] DEFAULT '{}' NOT NULL,
	"claim_type" text NOT NULL,
	"is_citable" boolean NOT NULL,
	"asr_confidence" real,
	"content_hash" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding" vector(1024) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunk_source_hash_unique" ON "knowledge_chunk" USING btree ("source_id","content_hash");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_source_index" ON "knowledge_chunk" USING btree ("source_id","chunk_index");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_embedding_hnsw" ON "knowledge_chunk" USING hnsw ("embedding" vector_cosine_ops);