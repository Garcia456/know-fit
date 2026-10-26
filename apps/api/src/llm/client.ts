import type { z } from 'zod';

/**
 * LLM 客户端接口 —— 可注入。
 *
 * 这是本模块最重要的可测性设计：图只依赖这个接口，
 * 于是 CI 用替身跑、本地用真实端点跑，两边走的是同一条代码路径。
 */
export interface StructuredRequest<T extends Record<string, unknown>> {
  /** system 单独放 —— 它是可缓存前缀，别和变量拼在一起 */
  system: string;
  input: string;
  schema: z.ZodType<T>;
  /** 结构化输出的名字（jsonSchema 的 title / tool 名） */
  name: string;
}

export interface ChatRequest {
  system: string;
  input: string;
}

/** 每次调用的中断信号 —— 全链路超时靠它把在途请求掐掉 */
export interface LlmCallOptions {
  signal?: AbortSignal;
}

export interface LlmClient {
  /** 版本串，写进 assessment.model_version / judge_model_version */
  readonly model?: string;
  structured<T extends Record<string, unknown>>(req: StructuredRequest<T>, options?: LlmCallOptions): Promise<T>;
  generate(req: ChatRequest, options?: LlmCallOptions): Promise<string>;
}

/** 把同一个 signal 绑到客户端的每次调用上；调用方不用逐层传 */
export function bindSignal(client: LlmClient, signal: AbortSignal): LlmClient {
  return {
    model: client.model,
    structured: (req) => client.structured(req, { signal }),
    generate: (req) => client.generate(req, { signal }),
  };
}