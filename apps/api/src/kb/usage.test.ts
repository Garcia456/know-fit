import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMENSIONS, createOpenAiEmbeddingClient } from './embedding.js';
import { createQwenRerankClient } from './rerank.js';
import { createUsageRecorder } from '../llm/usage.js';

/**
 * 真实客户端把 provider 回的 usage 交给记录器 —— 只测「搬数」，不联网。
 * provider 不回 usage 时记 null（不伪装成 0）。
 */

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubJson(body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('embedding 用量', () => {
  it('回 usage.prompt_tokens → 记成 input_tokens，output 为 null', async () => {
    stubJson({
      data: [{ index: 0, embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0) }],
      usage: { prompt_tokens: 8, total_tokens: 8 },
    });
    const usage = createUsageRecorder();
    const client = createOpenAiEmbeddingClient({ model: 'text-embedding-v4', baseUrl: 'https://x', apiKey: 'k', usage });

    await client.embed(['深蹲怎么练才标准']);

    expect(usage.snapshot()).toEqual([
      { stage: 'embedding', label: 'query', model: 'text-embedding-v4', input_tokens: 8, output_tokens: null },
    ]);
  });

  it('不回 usage → 记 null', async () => {
    stubJson({ data: [{ index: 0, embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0) }] });
    const usage = createUsageRecorder();
    const client = createOpenAiEmbeddingClient({ model: 'm', baseUrl: 'https://x', apiKey: 'k', usage });

    await client.embed(['x']);

    expect(usage.snapshot()[0]!.input_tokens).toBeNull();
  });

  it('不传记录器 → 不炸、无副作用', async () => {
    stubJson({ data: [{ index: 0, embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0) }] });
    const client = createOpenAiEmbeddingClient({ model: 'm', baseUrl: 'https://x', apiKey: 'k' });
    await expect(client.embed(['x'])).resolves.toHaveLength(1);
  });
});

describe('rerank 用量', () => {
  const results = { output: { results: [{ index: 0, relevance_score: 0.9 }] } };

  it('顶层 usage → 记 input_tokens', async () => {
    stubJson({ ...results, usage: { total_tokens: 2100 } });
    const usage = createUsageRecorder();
    const client = createQwenRerankClient({ model: 'qwen3-rerank', url: 'https://x', apiKey: 'k', usage });

    await client.rerank({ query: 'q', documents: ['a'], topN: 1 });

    expect(usage.snapshot()).toEqual([
      { stage: 'rerank', label: 'query', model: 'qwen3-rerank', input_tokens: 2100, output_tokens: null },
    ]);
  });

  it('usage 在 output 里也认（版本差异）', async () => {
    stubJson({ output: { ...results.output, usage: { total_tokens: 700 } } });
    const usage = createUsageRecorder();
    const client = createQwenRerankClient({ model: 'm', url: 'https://x', apiKey: 'k', usage });

    await client.rerank({ query: 'q', documents: ['a'], topN: 1 });

    expect(usage.snapshot()[0]!.input_tokens).toBe(700);
  });

  it('不回 usage → 记 null', async () => {
    stubJson(results);
    const usage = createUsageRecorder();
    const client = createQwenRerankClient({ model: 'm', url: 'https://x', apiKey: 'k', usage });

    await client.rerank({ query: 'q', documents: ['a'], topN: 1 });

    expect(usage.snapshot()[0]!.input_tokens).toBeNull();
  });
});
