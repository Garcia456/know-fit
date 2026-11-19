/**
 * 用量打点 —— 把 provider 已经回了的 token 数搬到一处。
 *
 * 🔴 它不是计费器：单价随模型换代 / 折扣变化，费用只由调用方自己带单价算
 *    （见 `evals/turn-cost/prices.ts`）。这里只回答「调了几次、各烧了多少 token」。
 *
 * 没传记录器时一切是 no-op —— 线上链路不打点，开销为零。
 * provider 没回的数字记 null，**不当 0**：0 会把「不知道」伪装成「免费」。
 */

export type UsageStage = 'llm' | 'embedding' | 'rerank';

export interface UsageEntry {
  stage: UsageStage;
  /** 结构化调用的 name（intent / draft_knowledge / verify_citation …）；generate 一律记 generate */
  label: string;
  model: string;
  /** null = provider 没回这个数 */
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface UsageRecorder {
  record(entry: UsageEntry): void;
  /** 取一份快照 —— 返回副本，调用方改不动记录 */
  snapshot(): UsageEntry[];
}

export function createUsageRecorder(): UsageRecorder {
  const list: UsageEntry[] = [];
  return {
    record(entry) {
      list.push(entry);
    },
    snapshot() {
      return list.map((e) => ({ ...e }));
    },
  };
}

/** 给 OpenAI 兼容的 chat 响应拼一条 llm 记录 —— 纯函数，可单测 */
export function llmEntry(input: {
  label: string;
  model: string;
  usage_metadata?: { input_tokens?: number; output_tokens?: number } | null;
}): UsageEntry {
  return {
    stage: 'llm',
    label: input.label,
    model: input.model,
    input_tokens: input.usage_metadata?.input_tokens ?? null,
    output_tokens: input.usage_metadata?.output_tokens ?? null,
  };
}

export interface UsageSummary {
  /** 每个 stage 各调了几次 */
  calls: Record<UsageStage, number>;
  /** 已知部分的合计；一次都没回数就是 null */
  input_tokens: number | null;
  output_tokens: number | null;
  /** 有任何一条缺 token 数就是 true —— 此时合计只是下限，不是全量 */
  incomplete: boolean;
}

/** 按 stage 汇总。缺数的条目跳过求和，但把 incomplete 标出来 —— 合计因此是下限 */
export function summarizeUsage(entries: UsageEntry[]): UsageSummary {
  const calls: Record<UsageStage, number> = { llm: 0, embedding: 0, rerank: 0 };
  let input = 0;
  let output = 0;
  let knownInput = false;
  let knownOutput = false;
  let incomplete = false;
  for (const e of entries) {
    calls[e.stage]++;
    if (e.input_tokens === null) incomplete = true;
    else {
      input += e.input_tokens;
      knownInput = true;
    }
    if (e.output_tokens === null) incomplete = true;
    else {
      output += e.output_tokens;
      knownOutput = true;
    }
  }
  return {
    calls,
    input_tokens: knownInput ? input : null,
    output_tokens: knownOutput ? output : null,
    incomplete,
  };
}
