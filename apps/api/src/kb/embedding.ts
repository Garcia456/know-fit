import { createHash } from 'node:crypto';

/**
 * 向量化 —— 可注入的两档实现（承 `LlmClient` / `Fetcher` 同型）。
 *
 * 真实实现走 `text-embedding-v4`（1024 维）；
 * 替身返回 **1024 维确定性假向量**：维度必须与列定义一致，
 * 否则替身管线会在 pgvector 的列定义上当场炸 —— 那不是「换个函数」能盖住的形态。
 *
 * 🔴 `embedding_model` 必须记版本串：模型换代后要重建索引，不记版本就判断不了何时重建。
 */

export const EMBEDDING_DIMENSIONS = 1024;
export const FAKE_EMBEDDING_MODEL = 'fake-text-embedding-1024';
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-v4';
/** 百炼 / OpenAI 兼容端点的批处理上限取小值，稳妥起见 */
const BATCH_SIZE = 10;

export interface EmbeddingClient {
  /** 版本串，写进 `knowledge_chunk.embedding_model` */
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export type EmbeddingProvider = 'fake' | 'real';

/** 🔴 认不出的一律当 fake —— 本地没配 key 时绝不误打真实端点 */
export function resolveEmbeddingProvider(raw: string | undefined = process.env.EMBEDDING_PROVIDER): EmbeddingProvider {
  if (raw === 'real') return 'real';
  if (raw === undefined || raw === '' || raw === 'fake') return 'fake';
  throw new Error(`EMBEDDING_PROVIDER 只认 fake / real，收到「${raw}」`);
}

/** 把 sha256 展开成 `dimensions` 个 [-1,1) 的浮点数，再归一化 */
function fakeVector(text: string, dimensions: number): number[] {
  const out: number[] = [];
  let block = 0;
  while (out.length < dimensions) {
    const digest = createHash('sha256').update(`${block}\u0000${text}`, 'utf8').digest();
    for (let i = 0; i + 4 <= digest.length && out.length < dimensions; i += 4) {
      out.push(digest.readUInt32BE(i) / 2 ** 31 - 1);
    }
    block++;
  }
  // 单位化：cosine 距离对长度不敏感，但替身也守这个约定，免得测试出现奇怪数值
  const norm = Math.sqrt(out.reduce((a, v) => a + v * v, 0)) || 1;
  return out.map((v) => v / norm);
}

export function createFakeEmbeddingClient(model: string = FAKE_EMBEDDING_MODEL): EmbeddingClient {
  return {
    model,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((t) => fakeVector(t, EMBEDDING_DIMENSIONS));
    },
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 没配 —— 见 .env.example`);
  return value;
}

export interface OpenAiEmbeddingOptions {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

interface EmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

export function createOpenAiEmbeddingClient(options: OpenAiEmbeddingOptions = {}): EmbeddingClient {
  const model = options.model ?? process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  const apiKey = options.apiKey ?? required('OPENAI_API_KEY');
  const baseUrl = (options.baseUrl ?? required('OPENAI_BASE_URL')).replace(/\/+$/, '');
  const endpoint = `${baseUrl}/embeddings`;

  return {
    model,
    async embed(texts: string[]): Promise<number[][]> {
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, input: batch, dimensions: EMBEDDING_DIMENSIONS, encoding_format: 'float' }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`embedding 请求失败 ${res.status}：${body.slice(0, 300)}`);
        }
        const payload = (await res.json()) as EmbeddingResponse;
        const rows = [...payload.data].sort((a, b) => a.index - b.index);
        if (rows.length !== batch.length) {
          throw new Error(`embedding 返回 ${rows.length} 条，发出 ${batch.length} 条`);
        }
        for (const row of rows) {
          if (row.embedding.length !== EMBEDDING_DIMENSIONS) {
            throw new Error(
              `embedding 维度不对：${row.embedding.length}，列定义是 ${EMBEDDING_DIMENSIONS} —— 维度定了不可改`,
            );
          }
          vectors.push(row.embedding);
        }
      }
      return vectors;
    },
  };
}

export function createEmbeddingClient(
  provider: EmbeddingProvider = resolveEmbeddingProvider(),
): EmbeddingClient {
  return provider === 'real' ? createOpenAiEmbeddingClient() : createFakeEmbeddingClient();
}