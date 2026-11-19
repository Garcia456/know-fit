/**
 * 单价表 —— 费用只在这里算，provider 只负责搬 token 数。
 *
 * 🔴 单价会变（促销、reseller 加价、模型换代）。这张表是**本地快照**，
 *    来源与日期写在下面；对不上账单时先改这里，不要去改 provider。
 *
 * 单位：元 / 百万 token。元不是美元 —— promptfoo 的表格按 `$` 显示，
 * 这里算出来的数**单位是人民币**，看数的时候别被符号带跑。
 *
 * 来源：platform.qianwenai.com 模型价格页（2026-11 抓取，与 .env 的 OPENAI_BASE_URL 同属千问平台）。
 */

export interface Price {
  /** 输入单价（元/百万 token） */
  input: number;
  /** 输出单价（元/百万 token）；不按输出计费的模型填 null */
  output: number | null;
}

export const PRICES: Record<string, Price> = {
  'qwen3.8-flash': { input: 0.8, output: 2.7 },
  'text-embedding-v4': { input: 0.5, output: null },
  'qwen3-rerank': { input: 0.5, output: null },
};

/**
 * 算一次调用的费用（元）。单价表里没有的模型返回 null —— 不猜。
 * provider 没回 token 数的那一侧按 0 算，同时由调用方标 `incomplete`。
 */
export function costOf(model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const input = ((inputTokens ?? 0) / 1_000_000) * price.input;
  const output = price.output === null ? 0 : ((outputTokens ?? 0) / 1_000_000) * price.output;
  return input + output;
}

// ── 下面是 eval 侧用的薄封装：provider 与断言共用同一套口径 ──

export interface StageUsage {
  /** 已知部分的合计（元）；全部缺数时 null */
  cost: number | null;
  /** 有任一条缺 token 数 → 这个费用只是下限，不是全量 */
  incomplete: boolean;
  /** 单价表里认不出的模型 */
  unknown_models: string[];
}

/** 按 stage 汇总费用。entry 的形状与 `src/llm/usage.ts` 的 UsageEntry 一致 */
export function summarizeCost(
  entries: { stage: string; model: string; input_tokens: number | null; output_tokens: number | null }[],
  stage: 'llm' | 'embedding' | 'rerank',
): StageUsage {
  let cost = 0;
  let known = false;
  let incomplete = false;
  const unknown = new Set<string>();
  for (const e of entries) {
    if (e.stage !== stage) continue;
    if (e.input_tokens === null) incomplete = true;
    const c = costOf(e.model, e.input_tokens, e.output_tokens);
    if (c === null) {
      unknown.add(e.model);
      continue;
    }
    cost += c;
    known = true;
  }
  return { cost: known ? cost : null, incomplete, unknown_models: [...unknown] };
}

/** 分阶段总计：llm / embedding / rerank + 总计 */
export function totalCost(entries: Parameters<typeof summarizeCost>[0]): {
  llm: StageUsage;
  embedding: StageUsage;
  rerank: StageUsage;
  total: number | null;
  incomplete: boolean;
} {
  const llm = summarizeCost(entries, 'llm');
  const embedding = summarizeCost(entries, 'embedding');
  const rerank = summarizeCost(entries, 'rerank');
  const parts = [llm.cost, embedding.cost, rerank.cost].filter((c): c is number => c !== null);
  return {
    llm,
    embedding,
    rerank,
    total: parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null,
    incomplete: llm.incomplete || embedding.incomplete || rerank.incomplete,
  };
}
