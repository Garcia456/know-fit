/**
 * promptfoo provider —— 跑一次「训练动作类问询」的完整链路，回报花费。
 *
 * 为什么不用 `handleTurn`：它要落库（conversation / turn 表）。评测只要成本，
 * 不要副作用，所以这里照同一条路径拼一遍：
 *
 *   classify_intent（1 次）→ answerKnowledge（retrieve: embedding + rerank）→ draft → 闸②
 *
 * 🔴 这是**副本**，不是第二套实现：每一步都调 `src/` 里的真函数，
 *    只有「图怎么路由」这一步在这里重写。图本身改了这里要跟着改。
 *
 * 输出 JSON；cost / tokenUsage 交给 promptfoo 汇总，分阶段数在 metadata。
 * 不进 CI / check-dev.sh —— 它要真实模型与真库。
 */
import type { ApiProvider, ProviderOptions, ProviderResponse } from 'promptfoo';
import { IntentResultSchema } from '../../src/contracts/extraction.js';
import { SINGLE_USER_ID } from '../../src/graph/state.js';
import { buildKnowledgeQuery } from '../../src/graph/turn.js';
import { createLlmClient } from '../../src/llm/index.js';
import { INTENT_SYSTEM } from '../../src/llm/prompts.js';
import { createUsageRecorder, summarizeUsage, type UsageRecorder } from '../../src/llm/usage.js';
import { answerKnowledge } from '../../src/knowledge/service.js';
import { closeDb } from '../../src/services/pool.js';
import { totalCost } from './prices.js';

interface TurnCostConfig {
  /** 用户 id；默认真库里的 demo 账号（要有可检索平台授权） */
  userId?: string;
}

// 串行执行：answerKnowledge 结束会关共享连接池，并发会把别的调用掐断
let tail: Promise<unknown> = Promise.resolve();

export default class TurnCostProvider implements ApiProvider {
  private readonly providerId: string;
  private readonly opts: TurnCostConfig;

  constructor(options: ProviderOptions) {
    this.providerId = options.id ?? 'know-fit-turn-cost';
    this.opts = (options.config ?? {}) as TurnCostConfig;
  }

  id(): string {
    return this.providerId;
  }

  callApi(prompt: string): Promise<ProviderResponse> {
    const run = () => this.measure(prompt);
    const result = tail.then(run, run);
    tail = result.catch(() => {});
    return result;
  }

  private async measure(prompt: string): Promise<ProviderResponse> {
    const startedAt = Date.now();
    const usage = createUsageRecorder();
    try {
      // ① 意图分类 —— 与图里同一个提示词、同一个 schema
      const llm = createLlmClient(undefined, { usage });
      const intent = await llm.structured({
        system: INTENT_SYSTEM,
        input: prompt,
        schema: IntentResultSchema,
        name: 'intent',
      });

      // ② 知识回答 —— 检索 + 起草 + 闸②，全部走真函数
      const card = await answerKnowledge({
        user_id: this.opts.userId ?? SINGLE_USER_ID,
        // 单轮评测：history 为空，buildKnowledgeQuery 原样返回这句话
        query: buildKnowledgeQuery(prompt, []),
        usage,
      });

      const summary = summarize(usage);
      return {
        output: JSON.stringify({
          intent: intent.intent,
          has_source: card.has_source,
          claims: card.claims.length,
          citations: card.citations.length,
          usage: summary,
        }),
        // 🔴 单位是元（人民币），不是美元
        cost: summary.cost.total ?? undefined,
        latencyMs: Date.now() - startedAt,
        tokenUsage: {
          prompt: summary.input_tokens ?? undefined,
          completion: summary.output_tokens ?? undefined,
          total: (summary.input_tokens ?? 0) + (summary.output_tokens ?? 0),
          numRequests: summary.calls.total,
        },
        metadata: {
          latency_ms: Date.now() - startedAt,
          calls: summary.calls,
          cost_llm: summary.cost.llm,
          cost_embedding: summary.cost.embedding,
          cost_rerank: summary.cost.rerank,
          cost_total: summary.cost.total,
          cost_incomplete: summary.cost.incomplete,
          unknown_models: summary.unknownModels,
          has_source: card.has_source,
          claims: card.claims.length,
          citations: card.citations.length,
        },
      };
    } catch (e) {
      return { error: (e as Error).message };
    } finally {
      await closeDb();
    }
  }
}

interface MeasureSummary {
  input_tokens: number | null;
  output_tokens: number | null;
  calls: { llm: number; embedding: number; rerank: number; total: number };
  cost: ReturnType<typeof totalCost>;
  unknownModels: string[];
}

function summarize(usage: UsageRecorder): MeasureSummary {
  const entries = usage.snapshot();
  const byStage = summarizeUsage(entries);
  const cost = totalCost(entries);
  return {
    input_tokens: byStage.input_tokens,
    output_tokens: byStage.output_tokens,
    calls: { ...byStage.calls, total: entries.length },
    cost,
    unknownModels: [
      ...new Set([...cost.llm.unknown_models, ...cost.embedding.unknown_models, ...cost.rerank.unknown_models]),
    ],
  };
}
