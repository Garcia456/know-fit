-- 头像：压缩后的图片 data URL；NULL = 用昵称首字
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "avatar" text;