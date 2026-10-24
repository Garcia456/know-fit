-- 闸① 分类由四类收敛为三类（ADR-035）：观点 / 事实 → 陈述
UPDATE "knowledge_chunk" SET "claim_type" = '陈述' WHERE "claim_type" IN ('观点', '事实');