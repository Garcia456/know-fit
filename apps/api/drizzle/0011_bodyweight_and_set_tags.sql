-- 自重动作：weight_kg 只记「额外负重」，bodyweight_kg 记计算容量时的自重部分
ALTER TABLE "exercise_entry" ADD COLUMN IF NOT EXISTS "is_bodyweight" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "set_entry" ADD COLUMN IF NOT EXISTS "bodyweight_kg" real;--> statement-breakpoint
-- 组标签：failure = 力竭组；drop = 递减组（drops 里存每一段）
ALTER TABLE "set_entry" ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "set_entry" ADD COLUMN IF NOT EXISTS "drops" jsonb;--> statement-breakpoint
-- 旧记录回填：seed 里 equipment 含「自重」的动作
UPDATE "exercise_entry"
   SET "is_bodyweight" = true
 WHERE "exercise_id" IN (
   'push_up','dip','pull_up','chin_up','lunge','bulgarian_split_squat',
   'glute_bridge','back_extension','calf_raise','plank','crunch',
   'hanging_leg_raise','russian_twist'
 );