import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LlmClient, StructuredRequest } from './client.js';

export type StructuredMethod = 'jsonSchema' | 'functionCalling' | 'jsonMode';

export interface OpenAiClientOptions {
  /** 结构化输出通道；默认值是 2026-10-25 实测定的 */
  method?: StructuredMethod;
  model?: string;
  temperature?: number;
  /** 思考模式；不传则读 LLM_ENABLE_THINKING（默认关） */
  enableThinking?: boolean;
}

/**
 * 🔴 实测结论（2026-10-25，`pnpm rag:smoke` 打的就是当前端点）：
 *    jsonSchema       → 400 This response_format type is unavailable now
 *    functionCalling  → 对闸② / 起草**间歇性空返回**（两次复现），不能用
 *    jsonMode         → ✅ 通（system 里必须有 json 字样）
 *    故默认取 jsonMode —— 每条结构化提示词都要声明输出 JSON。
 *
 * 思考模式：默认关。开着时单次调用 33–107s，关掉 2.3–5.2s（同输入实测）。
 */
function thinkingEnabled(raw: string | undefined = process.env.LLM_ENABLE_THINKING): boolean {
  if (raw === 'on' || raw === 'true' || raw === '1') return true;
  return false;
}

function requiredModel(): string {
  const model = process.env.OPENAI_MODEL;
  if (!model) throw new Error('OPENAI_MODEL 没配 —— 见 .env.example（键名通用，值自行填）');
  return model;
}

/**
 * 真实实现 —— 只走通用 OpenAI 协议。
 *
 * 🔴 `apiKey` / `baseURL` 都不显式传：SDK 默认读 `OPENAI_API_KEY` / `OPENAI_BASE_URL`，
 *    于是换端点只改 .env，不改这里。
 */
export function createOpenAiClient(options: OpenAiClientOptions = {}): LlmClient {
  const modelName = options.model ?? requiredModel();
  const method = options.method ?? 'jsonMode';
  const model = new ChatOpenAI({
    model: modelName,
    temperature: options.temperature ?? 0,
    modelKwargs: { enable_thinking: options.enableThinking ?? thinkingEnabled() },
  });

  return {
    model: modelName,
    async structured<T extends Record<string, unknown>>(req: StructuredRequest<T>): Promise<T> {
      const runnable = model.withStructuredOutput<T>(req.schema, { name: req.name, method });
      const out = await runnable.invoke([new SystemMessage(req.system), new HumanMessage(req.input)]);
      if (out === undefined || out === null) {
        throw new Error(`结构化输出为空（method=${method}）—— 模型没回可解析的 JSON`);
      }
      return out;
    },

    async generate(req): Promise<string> {
      const res = await model.invoke([new SystemMessage(req.system), new HumanMessage(req.input)]);
      if (typeof res.content === 'string') return res.content;
      return res.content
        .map((part) => (typeof part === 'string' ? part : 'text' in part ? part.text : ''))
        .join('');
    },
  };
}