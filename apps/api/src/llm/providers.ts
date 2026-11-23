/**
 * 用户自带 Key 的 DeepSeek 档位 —— 端点锁死、模型白名单。
 *
 * 🔴 用户只能选白名单里的模型；请求一律发到服务端配置的固定 baseURL，
 *    不接受客户端提供的任意端点（哪怕它长得像 OpenAI）。
 */

export const DEEPSEEK_BASE_URL = (
  process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com/v1'
).replace(/\/+$/, '');

/** 上线前用真实 Key 核实模型名；可用 DEEPSEEK_MODELS 覆盖（逗号分隔） */
const DEFAULT_MODELS = 'deepseek-flash,deepseek-v4-pro';

export const DEEPSEEK_MODELS: readonly string[] = (() => {
  const list = (process.env.DEEPSEEK_MODELS ?? DEFAULT_MODELS)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length > 0 ? list : ['deepseek-chat'];
})();

export function isDeepSeekModel(model: string): boolean {
  return DEEPSEEK_MODELS.includes(model);
}
