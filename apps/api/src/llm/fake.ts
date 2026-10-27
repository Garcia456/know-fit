import { EMPTY_WORKOUT, EXTRACTION_FIXTURES, GOLDEN_INTENTS } from './fixtures.js';
import { classifyClaimType } from '../kb/claimJudge.js';
import { NO_SOURCE_SYSTEM } from '../assessment/prompts.js';
import { KNOWLEDGE_NO_SOURCE_SYSTEM } from '../knowledge/prompts.js';
import type { ChatRequest, LlmClient } from './client.js';
import type { Intent } from '../contracts/extraction.js';

/** 闸② 替身看到这段就判不支撑 —— check-dev 靠它造「有候选但核验不过」 */
export const FAKE_UNSUPPORTED_MARK = '【不支撑】';

/**
 * 确定性替身 —— CI 与测试只用它，因此**永不联网、永不需要 key**。
 *
 * 它按 fixture 返回固定结构，**并且用调用方传进来的 schema 校验**
 * —— 于是「契约被动过」这种事在替身档就会暴露，不用等到真实调用。
 */

// 顺序有讲究：先判闲聊 —— 「我不太想练了」同时含「练」，但不该被当记录
// ⚠️ 关键词只能是**子串**：「不想」匹配不到「不太想」（中间隔了个「太」）
const CHAT_HINTS = ['不太想', '懒得', '没动力', '心情', '烦', '累', '放弃', 'emo', '休息', 'hi', 'hello', '你好', '嗨', '在吗', '你是谁', '你能干嘛', '你能做什么'];
const KNOWLEDGE_HINTS = ['推荐动作', '有什么动作', '怎么练', '练法', '动作要领', '训练计划', '新手', '组间休息', '做标准', '替代动作'];
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
  if (has(input, KNOWLEDGE_HINTS)) return 'knowledge';
  const assess = has(input, ASSESS_HINTS);
  const record = has(input, RECORD_HINTS);
  if (assess && record) return 'mixed';
  if (assess) return 'assess';
  if (record) return 'record';
  return 'chat';
}

/** 评估提示里第一行的判定 JSON —— 替身照着它编 claim，不猜 */
function verdictFromInput(input: string): { current: number; baseline: number | null; delta_pct: number | null } | null {
  const line = input.match(/^判定：(.+)$/m)?.[1];
  if (!line) return null;
  try {
    const v = JSON.parse(line) as Record<string, unknown>;
    if (typeof v.current !== 'number') return null;
    return {
      current: v.current,
      baseline: typeof v.baseline === 'number' ? v.baseline : null,
      delta_pct: typeof v.delta_pct === 'number' ? v.delta_pct : null,
    };
  } catch {
    return null;
  }
}

/** 闸② 的替身结果：候选里有标记就判不支撑，否则从第一个窗口起 */
function gateFixture(input: string): { results: unknown[] } {
  const pair = /<建议 id="(C\d+)">([\s\S]*?)<\/建议>\n<候选 id="(K\d+)">([\s\S]*?)<\/候选>/g;
  const results = [...input.matchAll(pair)].map((m) => {
    const [, claimId, , candidateId, block] = m;
    const no = { claim_id: claimId, candidate_id: candidateId, supported: false, from_window: 0 };
    if (block!.includes(FAKE_UNSUPPORTED_MARK)) {
      return { ...no, reason: '替身标记：不支撑' };
    }
    if (!/<窗口 i="\d+">/.test(block!)) return { ...no, reason: '替身：没有窗口' };
    return { claim_id: claimId, candidate_id: candidateId, supported: true, from_window: 0, reason: '替身：片段直接支撑' };
  });
  return { results };
}

export function createFakeClient(): LlmClient {
  return {
    model: 'fake-llm',
    async structured(req) {
      const input = req.input.trim();
      let raw: unknown;

      if (req.name === 'intent') {
        raw = { intent: classifyIntent(input) };
      } else if (req.name === 'extraction') {
        raw = EXTRACTION_FIXTURES[input] ?? EMPTY_WORKOUT;
      } else if (req.name === 'claim_type') {
        raw = { claim_type: classifyClaimType(input) };
      } else if (req.name === 'build_query') {
        raw = { query: '训练 容量 调整' };
      } else if (req.name === 'draft_advice') {
        const v = verdictFromInput(input);
        if (!v) throw new Error('替身 draft_advice 找不到判定 JSON');
        const hasCandidate = /<候选 id="K0">/.test(input);
        const personal = {
          claim:
            `本次训练容量 ${v.current}kg` +
            (v.baseline === null ? '' : `，上次同 split 是 ${v.baseline}kg`) +
            (v.delta_pct === null ? '' : `，变化 ${Math.abs(v.delta_pct)}%`),
          basis: 'personal_data',
          source_index: null,
        };
        raw = hasCandidate
          ? {
              claims: [
                personal,
                { claim: '先把训练节奏稳住，再考虑加重量', basis: 'source', source_index: 0 },
              ],
            }
          : { claims: [personal] };
      } else if (req.name === 'draft_knowledge') {
        raw = { claims: [{ claim: '先把动作做标准，再逐步加重量', source_index: 0 }] };
      } else if (req.name === 'verify_citation') {
        raw = gateFixture(input);
      } else {
        throw new Error(`替身没有「${req.name}」这条 fixture —— 要在 fixtures.ts 里补`);
      }

      // 用调用方的 schema 校验：替身也必须守契约
      return req.schema.parse(raw);
    },

    async generate(req: ChatRequest): Promise<string> {
      if (req.system === NO_SOURCE_SYSTEM) {
        return '这次训练容量比上次同 split 低，先把动作质量和组数稳住，下一轮再考虑加重量。';
      }
      if (req.system === KNOWLEDGE_NO_SOURCE_SYSTEM) {
        return '练胸可以先从卧推、上斜哑铃卧推和飞鸟入手，先把动作轨迹做稳，再逐步加重量。';
      }
      if (/你是谁|你能干嘛|你能做什么|介绍一下你/.test(req.input)) {
        return '我是枝链，你的健身/训练助手。我可以帮你记录训练和饮食、评估训练量，也能回答动作和练法。';
      }
      if (/^(hi|hello|你好|嗨|哈喽|在吗)/i.test(req.input.trim())) {
        return '你好，我是枝链。想记训练、看看练得够不够，或者问动作怎么练，都可以直接说。';
      }
      if (req.input.includes('不太想')) return '不想练就歇一天，明天状态回来了再上 —— 少练一次不影响结果。';
      return '我在。想记训练、看评估，或者问动作怎么练，都可以直接说。';
    },
  };
}