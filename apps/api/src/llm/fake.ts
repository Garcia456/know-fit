import { EMPTY_WORKOUT, EXTRACTION_FIXTURES, GOLDEN_INTENTS } from './fixtures.js';
import type { ChatRequest, LlmClient } from './client.js';
import type { Intent } from '../contracts/extraction.js';

/**
 * 确定性替身 —— CI 与测试只用它，因此**永不联网、永不需要 key**。
 *
 * 它按 fixture 返回固定结构，**并且用调用方传进来的 schema 校验**
 * —— 于是「契约被动过」这种事在替身档就会暴露，不用等到真实调用。
 */

// 顺序有讲究：先判闲聊 —— 「我不太想练了」同时含「练」，但不该被当记录
// ⚠️ 关键词只能是**子串**：「不想」匹配不到「不太想」（中间隔了个「太」）
const CHAT_HINTS = ['不太想', '懒得', '没动力', '心情', '烦', '累', '放弃', 'emo', '休息'];
const ASSESS_HINTS = ['够不够', '怎么样', '行不行', '够吗', '看下', '看看', '帮我看', '评估', '建议'];
const RECORD_HINTS = [
  '卧推', '深蹲', '硬拉', '飞鸟', '划船', '推', '拉', '蹲', '练', '组', '次',
  'kg', 'KG', '磅', '吃', '喝', '米饭', '鸡蛋',
];

const has = (input: string, hints: string[]) => hints.some((h) => input.includes(h));

function classifyIntent(input: string): Intent {
  // 黄金集里的原句以它为准 —— 免得关键词表与 fixtures 各说各话
  const golden = GOLDEN_INTENTS[input];
  if (golden) return golden;

  if (has(input, CHAT_HINTS)) return 'chat';
  const assess = has(input, ASSESS_HINTS);
  const record = has(input, RECORD_HINTS);
  if (assess && record) return 'mixed';
  if (assess) return 'assess';
  if (record) return 'record';
  return 'chat';
}

export function createFakeClient(): LlmClient {
  return {
    async structured(req) {
      const input = req.input.trim();
      let raw: unknown;

      if (req.name === 'intent') {
        raw = { intent: classifyIntent(input) };
      } else if (req.name === 'extraction') {
        raw = EXTRACTION_FIXTURES[input] ?? EMPTY_WORKOUT;
      } else {
        throw new Error(`替身没有「${req.name}」这条 fixture —— 要在 fixtures.ts 里补`);
      }

      // 用调用方的 schema 校验：替身也必须守契约
      return req.schema.parse(raw);
    },

    async generate(req: ChatRequest): Promise<string> {
      if (req.input.includes('不太想')) return '不想练就歇一天，明天状态回来了再上 —— 少练一次不影响结果。';
      return '收到。想聊就聊，想练了我帮你记。';
    },
  };
}