/**
 * promptfoo 自定义 provider —— 只跑检索段（embedding → pgvector → rerank → 同源配额）。
 *
 * 不写库、不调 LLM；输出 JSON 给断言解析。
 * config.maxPerSource 由 promptfooconfig 的两个实例分别给 0 / 1，做 baseline 对比。
 */
import type { ApiProvider, ProviderOptions, ProviderResponse } from 'promptfoo';
import { SINGLE_USER_ID } from '../../src/graph/state.js';
import { retrieveKnowledge } from '../../src/services/assessment.js';
import { closeDb } from '../../src/services/pool.js';

interface RetrievalConfig {
  maxPerSource?: number;
}

// 串行执行：每次结束都会关共享连接池，并发会把别的调用掐断
let tail: Promise<unknown> = Promise.resolve();

export default class RetrievalProvider implements ApiProvider {
  private readonly providerId: string;
  private readonly config: RetrievalConfig;

  constructor(options: ProviderOptions) {
    this.providerId = options.id ?? 'know-fit-retrieval';
    this.config = (options.config ?? {}) as RetrievalConfig;
  }

  id(): string {
    return this.providerId;
  }

  callApi(prompt: string): Promise<ProviderResponse> {
    const run = () => this.retrieve(prompt);
    const result = tail.then(run, run);
    tail = result.catch(() => {});
    return result;
  }

  private async retrieve(prompt: string): Promise<ProviderResponse> {
    const startedAt = Date.now();
    try {
      const result = await retrieveKnowledge({
        user_id: SINGLE_USER_ID,
        query: prompt,
        max_per_source: this.config.maxPerSource,
      });
      if (result.status !== 'ok') return { error: result.message };

      const candidates = result.candidates.map((c) => ({
        source_id: c.source_id,
        title: c.title,
        creator: c.creator,
        rerank_score: c.rerank_score,
        similarity: c.similarity,
      }));
      const payload = {
        candidates,
        distinct_sources: new Set(candidates.map((c) => c.source_id)).size,
        meta: result.meta,
        latency_ms: Date.now() - startedAt,
      };
      return {
        output: JSON.stringify(payload),
        metadata: { latency_ms: payload.latency_ms, distinct_sources: payload.distinct_sources },
      };
    } catch (e) {
      return { error: (e as Error).message };
    } finally {
      await closeDb();
    }
  }
}