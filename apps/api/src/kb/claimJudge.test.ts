import { describe, expect, it } from 'vitest';
import type { LlmClient, StructuredRequest } from '../llm/client.js';
import {
  CLAIM_PROMPT_PATH,
  DEFAULT_CONFIDENCE_THRESHOLD,
  claimPrompt,
  createFakeClaimJudge,
  createLlmClaimJudge,
  deriveIsCitable,
  meanConfidence,
} from './claimJudge.js';
import type { TranscriptSegment } from './types.js';

describe('deriveIsCitable：claim_type + 置信度 → 是否可引用', () => {
  it('只有陈述可引用', () => {
    expect(deriveIsCitable('陈述', 0.9)).toBe(true);
    expect(deriveIsCitable('演示', 0.99)).toBe(false);
    expect(deriveIsCitable('寒暄', 0.99)).toBe(false);
  });

  it('门限是 0.75，恰好等于也放行', () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.75);
    expect(deriveIsCitable('陈述', 0.75)).toBe(true);
    expect(deriveIsCitable('陈述', 0.7499)).toBe(false);
  });

  it('置信度未知（null）不因此排除', () => {
    expect(deriveIsCitable('陈述', null)).toBe(true);
    expect(deriveIsCitable('寒暄', null)).toBe(false);
  });

  it('门限可注入', () => {
    expect(deriveIsCitable('陈述', 0.6, 0.5)).toBe(true);
    expect(deriveIsCitable('陈述', 0.6, 0.9)).toBe(false);
  });
});

const seg = (confidence: number | null): TranscriptSegment => ({
  start_ts: 0,
  end_ts: 1,
  text: '话',
  confidence,
});

describe('meanConfidence', () => {
  it('只平均非空置信度', () => {
    expect(meanConfidence([seg(0.8), seg(0.6), seg(null)])).toBeCloseTo(0.7);
  });

  it('全是 null 就返回 null，不编数', () => {
    expect(meanConfidence([seg(null), seg(null)])).toBeNull();
    expect(meanConfidence([])).toBeNull();
  });
});

describe('替身判官（CI 用）', () => {
  it('短的问候语 → 寒暄', async () => {
    const judge = createFakeClaimJudge();
    expect(await judge.judge('大家好，今天聊聊卧推')).toBe('寒暄');
  });

  it('跟练口令 → 演示', async () => {
    const judge = createFakeClaimJudge();
    expect(await judge.judge('来，跟我做第一个动作')).toBe('演示');
  });

  it('主张 / 要领 / 描述 → 陈述', async () => {
    const judge = createFakeClaimJudge();
    expect(await judge.judge('我觉得握距应该比肩宽一点')).toBe('陈述');
    expect(await judge.judge('杠铃卧推主要练胸大肌')).toBe('陈述');
  });
});

describe('LLM 判官', () => {
  it('提示词文件在，且线上读的就是这一份', () => {
    expect(CLAIM_PROMPT_PATH).toContain('claim-type');
    expect(CLAIM_PROMPT_PATH.endsWith('prompt.txt')).toBe(true);
    expect(claimPrompt()).toContain('claim_type');
    // 占位符只给 promptfoo 填；线上 system 提示里不许漏出去
    expect(claimPrompt()).not.toContain('{{input}}');
  });

  it('把模型输出原样交回（结构化字段校验由 schema 兜）', async () => {
    let seen: StructuredRequest<{ claim_type: string }> | null = null;
    const llm: LlmClient = {
      async structured<T extends Record<string, unknown>>(req: StructuredRequest<T>): Promise<T> {
        seen = req as unknown as StructuredRequest<{ claim_type: string }>;
        return { claim_type: '陈述' } as unknown as T;
      },
      async generate(): Promise<string> {
        return '';
      },
    };
    const judge = createLlmClaimJudge(llm);
    expect(await judge.judge('随便一段')).toBe('陈述');
    expect(seen!.name).toBe('claim_type');
    expect(seen!.system).toBe(claimPrompt());
  });
});