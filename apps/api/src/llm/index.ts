import { createFakeClient } from './fake.js';
import { createOpenAiClient, type OpenAiClientOptions } from './openai.js';
import type { LlmClient } from './client.js';

export type LlmProvider = 'fake' | 'openai';

/** 🔴 认不出的一律当 fake —— 本地没配 key 时绝不会误打真实端点 */
export function resolveProvider(raw: string | undefined = process.env.LLM_PROVIDER): LlmProvider {
  if (raw === 'openai') return 'openai';
  if (raw === undefined || raw === '' || raw === 'fake') return 'fake';
  throw new Error(`LLM_PROVIDER 只认 fake / openai，收到「${raw}」`);
}

export function createLlmClient(
  provider: LlmProvider = resolveProvider(),
  options: OpenAiClientOptions = {},
): LlmClient {
  return provider === 'openai' ? createOpenAiClient(options) : createFakeClient();
}

export type { ChatRequest, LlmClient, StructuredRequest } from './client.js';
export { createFakeClient } from './fake.js';
export { createOpenAiClient } from './openai.js';
export type { OpenAiClientOptions, StructuredMethod } from './openai.js';