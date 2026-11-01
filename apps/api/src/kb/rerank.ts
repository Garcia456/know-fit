/**
 * 重排 —— 可注入的两档实现。
 *
 * 真实实现走 `qwen3-rerank`（DashScope 原生协议，不是 OpenAI 兼容形状），
 * 因此单独抽一个 `RerankClient`，而不是硬塞进 `LlmClient`。
 * 替身按**词面重叠**排序：确定性、可单测、不联网。
 *
 * 🔴 `gte-rerank-v2` 已下线（ADR-012），不要换回去。
 */

export interface RerankHit {
  index: number;
  score: number;
}

export interface RerankClient {
  /** 版本串，写进 `assessment.pipeline_meta.rerank_model` */
  readonly model: string;
  rerank(input: { query: string; documents: string[]; topN: number }): Promise<RerankHit[]>;
}

export const FAKE_RERANK_MODEL = 'fake-rerank';
export const DEFAULT_RERANK_MODEL = 'qwen3-rerank';
const DEFAULT_RERANK_URL = 'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank';
const TIMEOUT_MS = 8000;

export type RerankProvider = 'fake' | 'real';

/** 🔴 认不出的一律当 fake —— 本地没配 key 时绝不误打真实端点 */
export function resolveRerankProvider(raw: string | undefined = process.env.RERANK_PROVIDER): RerankProvider {
  if (raw === 'real') return 'real';
  if (raw === undefined || raw === '' || raw === 'fake') return 'fake';
  throw new Error(`RERANK_PROVIDER 只认 fake / real，收到「${raw}」`);
}

function bigrams(text: string): Set<string> {
  const chars = [...text.replace(/\s+/g, '')];
  const out = new Set<string>();
  for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i]! + chars[i + 1]!);
  return out;
}

/**
 * 替身：按「查询的二元字组有多少出现在文档里」排序。
 * 它只证明管道通，**证明不了语义相关性** —— 那只能来自真实 rerank。
 */
export function createFakeRerankClient(): RerankClient {
  return {
    model: FAKE_RERANK_MODEL,
    async rerank({ query, documents, topN }) {
      const q = bigrams(query);
      const scored = documents.map((doc, index) => {
        const d = bigrams(doc);
        let hit = 0;
        for (const g of q) if (d.has(g)) hit++;
        return { index, score: q.size === 0 ? 0 : hit / q.size };
      });
      scored.sort((a, b) => b.score - a.score || a.index - b.index);
      return scored.slice(0, Math.max(0, topN));
    },
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 没配 —— 见 .env.example`);
  return value;
}

interface RerankPayload {
  output?: { results?: { index?: number; relevance_score?: number; score?: number }[] };
  results?: { index?: number; relevance_score?: number; score?: number }[];
}

export function createQwenRerankClient(options: {
  model?: string;
  url?: string;
  apiKey?: string;
} = {}): RerankClient {
  // 空串按「没配」处理：.env 里留空的 RERANK_API_KEY 要能回落到 OPENAI_API_KEY
  const model = options.model || process.env.RERANK_MODEL || DEFAULT_RERANK_MODEL;
  const url = options.url || process.env.RERANK_BASE_URL || DEFAULT_RERANK_URL;
  const apiKey = options.apiKey || process.env.RERANK_API_KEY?.trim() || required('OPENAI_API_KEY');

  return {
    model,
    async rerank({ query, documents, topN }) {
      if (documents.length === 0) return [];
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          input: { query, documents },
          parameters: { return_documents: false, top_n: topN },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`rerank 请求失败 ${res.status}：${body.slice(0, 300)}`);
      }
      const payload = (await res.json()) as RerankPayload;
      const rows = payload.output?.results ?? payload.results ?? [];
      return rows.flatMap((r) => {
        const index = r.index;
        const score = r.relevance_score ?? r.score;
        return typeof index === 'number' && typeof score === 'number' ? [{ index, score }] : [];
      });
    },
  };
}

export function createRerankClient(provider: RerankProvider = resolveRerankProvider()): RerankClient {
  return provider === 'real' ? createQwenRerankClient() : createFakeRerankClient();
}