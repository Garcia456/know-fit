import { describe, expect, it } from 'vitest';
import {
  EMBEDDING_DIMENSIONS,
  FAKE_EMBEDDING_MODEL,
  createEmbeddingClient,
  createFakeEmbeddingClient,
  resolveEmbeddingProvider,
} from './embedding.js';

describe('替身 embedding', () => {
  it('维度必须是 1024 —— 与列定义一致', async () => {
    const [vec] = await createFakeEmbeddingClient().embed(['随便一段']);
    expect(EMBEDDING_DIMENSIONS).toBe(1024);
    expect(vec).toHaveLength(1024);
  });

  it('确定性：同一文本两次结果完全一样', async () => {
    const client = createFakeEmbeddingClient();
    const [a] = await client.embed(['上斜哑铃卧推']);
    const [b] = await client.embed(['上斜哑铃卧推']);
    expect(a).toEqual(b);
  });

  it('不同文本结果不同，且是单位向量', async () => {
    const [a, b] = await createFakeEmbeddingClient().embed(['卧推', '深蹲']);
    expect(a).not.toEqual(b);
    const norm = Math.sqrt(a!.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('每条输入对应一条输出', async () => {
    const out = await createFakeEmbeddingClient().embed(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
  });

  it('模型版本串写进 embedding_model', () => {
    expect(createFakeEmbeddingClient().model).toBe(FAKE_EMBEDDING_MODEL);
  });
});

describe('resolveEmbeddingProvider', () => {
  it('默认 fake；real 才走真实端点', () => {
    expect(resolveEmbeddingProvider(undefined)).toBe('fake');
    expect(resolveEmbeddingProvider('')).toBe('fake');
    expect(resolveEmbeddingProvider('fake')).toBe('fake');
    expect(resolveEmbeddingProvider('real')).toBe('real');
  });

  it('认不出的值当场抛，不静默回退', () => {
    expect(() => resolveEmbeddingProvider('qwen')).toThrow();
  });

  it('createEmbeddingClient 默认走替身', () => {
    expect(createEmbeddingClient('fake').model).toBe(FAKE_EMBEDDING_MODEL);
  });
});