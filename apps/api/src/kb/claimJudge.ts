import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { LlmClient } from '../llm/client.js';
import type { TranscriptSegment } from './types.js';

/**
 * 闸①（入库闸）的判据之一：`claim_type` → `is_citable`。
 *
 * 这是本项目第一个 **LLM 判据**：判错的片会一直躺在库里，
 * 被检索到、被引用给用户 —— 所以它必须带评测（promptfoo 在 `evals/`）。
 *
 * ⚠️ `asr_confidence` 是**音频质量门**，不是内容正确性门：
 *    术语错时 ASR 置信度照样很高（「保加利亚敦」≈0.93），它兜不住。
 */

export const CLAIM_TYPES = ['陈述', '演示', '寒暄'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const ClaimJudgementSchema = z.object({ claim_type: z.enum(CLAIM_TYPES) });

const HERE = dirname(fileURLToPath(import.meta.url));
/** 提示词与 promptfoo 评测共用同一份文件 —— 评测的才是线上跑的 */
export const CLAIM_PROMPT_PATH = join(HERE, '..', '..', 'evals', 'claim-type', 'prompt.txt');

/** 与 promptfoo 共用同一份；占位符只给评测填，线上输入走 user 消息 */
let cachedPrompt: string | null = null;
export function claimPrompt(): string {
  cachedPrompt ??= readFileSync(CLAIM_PROMPT_PATH, 'utf8').replace('{{input}}', '').trim();
  return cachedPrompt;
}

export interface ClaimJudge {
  judge(input: string): Promise<ClaimType>;
}

export function createLlmClaimJudge(llm: LlmClient): ClaimJudge {
  return {
    async judge(input: string): Promise<ClaimType> {
      const out = await llm.structured({
        system: claimPrompt(),
        input,
        schema: ClaimJudgementSchema,
        name: 'claim_type',
      });
      return out.claim_type;
    },
  };
}

/** 可引用池只收「陈述」；「演示」归跟练，「寒暄」无内容价值 */
export const CITABLE_CLAIM_TYPES: readonly ClaimType[] = ['陈述'];

/** ASR 置信度门限 —— 先设低门限，真跑时把砍掉什么贴出来，再反向调参 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;

/**
 * claim_type + asr_confidence → is_citable。**纯函数**，派生规则可单独测。
 * 置信度拿不到（null）时不因此排除 —— 不拿未知当不合格。
 */
export function deriveIsCitable(
  claimType: ClaimType,
  asrConfidence: number | null,
  threshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): boolean {
  if (!CITABLE_CLAIM_TYPES.includes(claimType)) return false;
  if (asrConfidence === null) return true;
  return asrConfidence >= threshold;
}

/** 片级置信度 = 片内各段非空置信度的均值；一段都没有就 null（不编数） */
export function meanConfidence(segments: TranscriptSegment[]): number | null {
  const values = segments.map((s) => s.confidence).filter((c): c is number => c !== null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const GREETING_HINTS = ['大家好', '哈喽', ' hello', '谢谢', '拜拜', '下期见', '关注我', '点赞', '评论区', '我们下期'];
const DEMO_HINTS = ['跟我做', '跟我练', '看我的动作', '我们一起', '第一个动作', '照着做', '你现在'];

/**
 * 确定性替身 —— CI 与 check-dev 只用它，**不联网、不需要 key**。
 * 它证明「闸① 接上了、字段落对了」，证明不了「判得准」；准确率只能来自 promptfoo + 人工标注。
 */
/** 确定性分类 —— 替身判官与 LLM 替身共用同一套规则 */
export function classifyClaimType(input: string): ClaimType {
  const text = input.trim();
  if (text.length < 200 && GREETING_HINTS.some((h) => text.includes(h))) return '寒暄';
  if (DEMO_HINTS.some((h) => text.includes(h))) return '演示';
  return '陈述';
}

export function createFakeClaimJudge(): ClaimJudge {
  return {
    async judge(input: string): Promise<ClaimType> {
      return classifyClaimType(input);
    },
  };
}