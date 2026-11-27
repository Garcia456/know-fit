-- 日状态：只存用户明确说过的「休息 / 练了没记」。
-- trained 由 workout_session 推导，unknown 不落行。
CREATE TABLE IF NOT EXISTS "day_status" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "status" text NOT NULL,
  "reason" text,
  "source" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "day_status_user_date_unique"
  ON "day_status" ("user_id", "date");

-- 待补记录槽：用户提到「昨天练了胸」但没给组数，或记录后发现的空白日。
-- 一天最多一条；补出训练 / 标休息 / 用户忽略都会把它收敛。
CREATE TABLE IF NOT EXISTS "pending_record" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "target_date" date NOT NULL,
  "split_label" text,
  "source" text NOT NULL,
  "status" text NOT NULL,
  "session_id" uuid REFERENCES "workout_session"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "pending_record_user_date_unique"
  ON "pending_record" ("user_id", "target_date");

CREATE INDEX IF NOT EXISTS "pending_record_user_status_index"
  ON "pending_record" ("user_id", "status", "target_date");

-- F7 提示留痕：补记没有 session，用 target_date 去重。
ALTER TABLE "recovery_nudge" ADD COLUMN IF NOT EXISTS "target_date" date;

DROP INDEX IF EXISTS "recovery_nudge_user_type_session_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "recovery_nudge_user_type_session_unique"
  ON "recovery_nudge" ("user_id", "type", "session_id")
  WHERE "session_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "recovery_nudge_user_type_target_unique"
  ON "recovery_nudge" ("user_id", "type", "target_date")
  WHERE "target_date" IS NOT NULL;
