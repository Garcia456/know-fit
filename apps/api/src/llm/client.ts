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

export interface LlmClient {
  /** 版本串，写进 assessment.model_version / judge_model_version */
  readonly model?: string;
  structured<T extends Record<string, unknown>>(req: StructuredRequest<T>): Promise<T>;
  generate(req: ChatRequest): Promise<string>;
}