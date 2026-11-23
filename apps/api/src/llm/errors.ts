/**
 * 用户自带 Key 的配置错误 —— 与「模型这次生成失败」区分开：
 * 前者要明确告诉用户去改设置，绝不能被降级文案吞掉。
 */

export type LlmConfigErrorCode =
  | 'key_missing'
  | 'key_unreadable'
  | 'key_invalid'
  | 'model_unknown'
  | 'rate_limited';

export class LlmConfigError extends Error {
  constructor(readonly code: LlmConfigErrorCode) {
    super(code);
    this.name = 'LlmConfigError';
  }
}

/** 窄 catch（知识降级 / 评估降级 / 计划降级）里先放它过去，别吞成友好文案。 */
export function rethrowIfLlmConfig(error: unknown): void {
  if (error instanceof LlmConfigError) throw error;
}

export interface LlmConfigErrorResponse {
  status: number;
  body: { error: string; code: string };
}

/** 对外只给安全文案 —— 上游 body、端点、Key 一律不出现。 */
export function llmConfigErrorResponse(error: LlmConfigError): LlmConfigErrorResponse {
  switch (error.code) {
    case 'key_invalid':
      return {
        status: 400,
        body: { error: 'API Key 无效或已过期 —— 请在设置里重新填写', code: 'llm_key_invalid' },
      };
    case 'key_unreadable':
      return {
        status: 400,
        body: { error: '保存的 API Key 解不开 —— 请在设置里重新填写', code: 'llm_key_unreadable' },
      };
    case 'model_unknown':
      return {
        status: 400,
        body: { error: '所选模型不在白名单里 —— 请在设置里重新选择', code: 'llm_model_unknown' },
      };
    case 'rate_limited':
      return {
        status: 429,
        body: { error: '模型服务限流了，请稍后再试', code: 'llm_rate_limited' },
      };
    case 'key_missing':
      return {
        status: 503,
        body: { error: '服务端还没配置 Key 加密密钥，暂时无法使用自带 Key', code: 'llm_key_unavailable' },
      };
  }
}
