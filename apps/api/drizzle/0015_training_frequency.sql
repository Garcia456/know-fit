-- 档案新增训练频率：二分化 / 三分化 / 四分化 / 五分化 / 不规律；NULL = 未填。

ALTER TABLE "user_profile" ADD COLUMN IF NOT EXISTS "training_frequency" text;