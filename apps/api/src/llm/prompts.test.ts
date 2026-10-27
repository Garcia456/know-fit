import { describe, expect, it } from 'vitest';
import {
  ExerciseSchema,
  MealItemSchema,
  MealSchema,
  SetSchema,
  WorkoutSchema,
} from '../contracts/extraction.js';
import { EXTRACTION_SYSTEM, INTENT_SYSTEM } from './prompts.js';

/**
 * 提示词覆盖率 —— 契约里要 LLM 填的字段，提示词必须**点名**。
 *
 * 为什么单独立一个测试：契约加字段、提示词忘了跟上，是**静默**的 ——
 * 模型照契约别扭地猜，schema 校验照样过，只有真跑起来才发现值是空的
 * （split_label / note 就这么漏过一次）。
 *
 * 字段名从契约的 shape 取，不手抄 —— 契约改了，这里自动跟上。
 */

/** 只匹配独立的字段名：`unit` 不算被 `weight_unit` 点名，`qty` 不算被 `qty_confidence` 点名 */
function named(prompt: string, field: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_])${field}(?![A-Za-z0-9_])`).test(prompt);
}

const FIELD_GROUPS: Array<{ what: string; schema: { shape: Record<string, unknown> } }> = [
  { what: '训练', schema: WorkoutSchema },
  { what: '动作', schema: ExerciseSchema },
  { what: '组', schema: SetSchema },
  { what: '饮食', schema: MealSchema },
  { what: '饮食项', schema: MealItemSchema },
];

describe('EXTRACTION_SYSTEM 点名了每一个要模型填的字段', () => {
  for (const { what, schema } of FIELD_GROUPS) {
    for (const field of Object.keys(schema.shape)) {
      it(`${what}.${field}`, () => {
        expect(named(EXTRACTION_SYSTEM, field), `提示词里没提「${field}」`).toBe(true);
      });
    }
  }

  it('split_label 说了「用几个字」和「同分化写同一个词」', () => {
    expect(EXTRACTION_SYSTEM).toMatch(/split_label/);
    expect(EXTRACTION_SYSTEM).toMatch(/1–4 个字/);
    expect(EXTRACTION_SYSTEM).toMatch(/同一个(分化|词)/);
  });

  it('note 只装用户原话，明说不许写抽取过程', () => {
    expect(EXTRACTION_SYSTEM).toMatch(/note 只装用户/);
    expect(EXTRACTION_SYSTEM).toMatch(/不要把你的抽取过程/);
  });
});

describe('INTENT_SYSTEM 点名了 intent', () => {
  it('intent', () => {
    expect(named(INTENT_SYSTEM, 'intent')).toBe(true);
  });

  it('带 JSON 字样 —— jsonMode 的硬要求', () => {
    expect(INTENT_SYSTEM).toMatch(/JSON/);
  });
});