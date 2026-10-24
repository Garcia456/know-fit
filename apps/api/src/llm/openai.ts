import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LlmClient, StructuredRequest } from './client.js';

export type StructuredMethod = 'jsonSchema' | 'functionCalling' | 'jsonMode';

export interface OpenAiClientOptions {
  /** 结构化输出通道；默认值是 2026-10-13 llm:smoke 实测定的 */
  method?: StructuredMethod;
  model?: string;
  temperature?: number;
}

/**
 * 🔴 实测结论（2026-10-13，`pnpm llm:smoke` 打的就是当前端点）：
 *    jsonSchema       → 400 This response_format type is unavailable now
 *    functionCalling  → ✅ 通
 *    jsonMode         → 400 要求 messages 里含 json 字样
 *    故默认取 functionCalling —— 它是唯一能用的那条。
 */

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
  const model = new ChatOpenAI({
    model: modelName,
    temperature: options.temperature ?? 0,
  });

  return {
    model: modelName,
    async structured<T extends Record<string, unknown>>(req: StructuredRequest<T>): Promise<T> {
      const runnable = model.withStructuredOutput<T>(req.schema, {
        name: req.name,
        method: options.method ?? 'functionCalling',
      });
      const out = await runnable.invoke([new SystemMessage(req.system), new HumanMessage(req.input)]);
      if (out === undefined || out === null) {
        throw new Error(`结构化输出为空（method=${options.method ?? 'functionCalling'}）—— 模型没走工具调用`);
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