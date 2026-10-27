ALTER TABLE "user_profile" ADD COLUMN IF NOT EXISTS "training_started_on" date;--> statement-breakpoint
-- 旧档位只有区间，回填取不越过边界的保守值
UPDATE "user_profile"
   SET "training_started_on" = (date_trunc('month', CURRENT_DATE) - interval '2 months')::date
 WHERE "training_years_band" = 'lt_3m';--> statement-breakpoint
UPDATE "user_profile"
   SET "training_started_on" = (date_trunc('month', CURRENT_DATE) - interval '12 months')::date
 WHERE "training_years_band" = '3m_2y';--> statement-breakpoint
UPDATE "user_profile"
   SET "training_started_on" = (date_trunc('month', CURRENT_DATE) - interval '25 months')::date
 WHERE "training_years_band" = 'gt_2y';--> statement-breakpoint
ALTER TABLE "user_profile" DROP COLUMN IF EXISTS "training_years_band";