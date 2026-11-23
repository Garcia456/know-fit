-- 注册验证码：注册时必须先通过邮箱验证，账号才会创建。
-- 只存验证码的 SHA-256（与邮箱绑定），10 分钟有效、单次使用；
-- 连续输错 5 次作废，必须重新获取。过期行在下次发码时顺手清掉。
CREATE TABLE IF NOT EXISTS "registration_verification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL,
  "code_hash" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "registration_verification_email_index"
  ON "registration_verification" ("email", "created_at");

CREATE INDEX IF NOT EXISTS "registration_verification_expiry_index"
  ON "registration_verification" ("expires_at");
