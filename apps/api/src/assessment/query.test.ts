import { describe, expect, it } from 'vitest';
import { FALLBACK_QUERY, buildQuery, templateQuery } from './query.js';
import { buildVolumeHook } from '../metrics/hook.js';
import type { LlmClient } from '../llm/client.js';

const hook = (current: number, baseline: number | null, split: string | null = '推日') =>
  buildVolumeHook({ current, baseline, split_label: split });

const thrown: LlmClient = {
  model: 'test',
  async structured() {
    throw new Error('不该走到 LLM');
  },
  async generate() {
    return '';
  },
};

describe('query 模板', () => {
  it('下降 / 上涨 / 停滞 各一条，方向与量级进模板词', () => {
    expect(templateQuery(hook(2000, 2500), '增肌')).toBe('增肌 推日 训练容量下降 怎么调整');
    expect(templateQuery(hook(2500, 2000), '增肌')).toBe('增肌 推日 训练容量上涨 要不要加量');
    expect(templateQuery(hook(2010, 2000), '增肌')).toBe('增肌 推日 训练容量停滞 怎么突破');
  });

  it('刚好 ±10% 也算方向变化', () => {
    expect(templateQuery(hook(900, 1000), '增肌')).toContain('下降');
    expect(templateQuery(hook(1100, 1000), '增肌')).toContain('上涨');
  });

  it('没有 split 或没有基线 → 模板不命中', () => {
    expect(templateQuery(hook(2000, 2500, null), '增肌')).toBeNull();
    expect(templateQuery(hook(2000, null), '增肌')).toBeNull();
  });

  it('档案没填目标就用「训练」，不猜', () => {
    expect(templateQuery(hook(2000, 2500), null)).toBe('训练 推日 训练容量下降 怎么调整');
    expect(templateQuery(hook(2000, 2500), '  ')).toBe('训练 推日 训练容量下降 怎么调整');
  });

  it('query 里没有阿拉伯数字', () => {
    for (const t of [
      templateQuery(hook(1800, 2500), '增肌'),
      templateQuery(hook(2600, 2500), '增肌'),
      templateQuery(hook(2010, 2000), '增肌'),
    ]) {
      expect(t).not.toMatch(/\d/);
    }
  });
});

describe('buildQuery 模板优先、LLM 兜底', () => {
  it('模板命中时根本不调 LLM', async () => {
    const out = await buildQuery(hook(2000, 2500), '增肌', thrown);
    expect(out).toEqual({ query: '增肌 推日 训练容量下降 怎么调整', source: 'template' });
  });

  it('模板未命中 → LLM', async () => {
    const llm: LlmClient = {
      model: 'test',
      async structured<T extends Record<string, unknown>>(): Promise<T> {
        return { query: '增肌 全身 容量 怎么排' } as unknown as T;
      },
      async generate() {
        return '';
      },
    };
    const out = await buildQuery(hook(2000, null), '增肌', llm);
    expect(out).toEqual({ query: '增肌 全身 容量 怎么排', source: 'llm' });
  });

  it('LLM 返回带数字 / 空串 → 确定性兜底', async () => {
    for (const query of ['加到 100kg', '   ']) {
      const llm: LlmClient = {
        model: 'test',
        async structured<T extends Record<string, unknown>>(): Promise<T> {
          return { query } as unknown as T;
        },
        async generate() {
          return '';
        },
      };
      expect(await buildQuery(hook(2000, null), '增肌', llm)).toEqual({
        query: FALLBACK_QUERY,
        source: 'fallback',
      });
    }
  });

  it('LLM 抛错 → 确定性兜底，不把评估带崩', async () => {
    const llm: LlmClient = {
      model: 'test',
      async structured() {
        throw new Error('boom');
      },
      async generate() {
        return '';
      },
    };
    expect(await buildQuery(hook(2000, null), '增肌', llm)).toEqual({
      query: FALLBACK_QUERY,
      source: 'fallback',
    });
  });
});
