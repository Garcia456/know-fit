/**
 * 本地真实调用 smoke —— 🔴 需要仓库根 .env 里填好 OPENAI_*，**不进 CI**。
 *
 *   1. 探结构化输出通道（jsonSchema / functionCalling / jsonMode）—— 定下用哪个；
 *   2. 黄金集（定义 §1.7）上跑真实抽取，报解析准确率；
 *   3. 顺带报意图分类准确率。
 *
 * 跑法：pnpm --filter @know-fit/api llm:smoke
 */
import { z } from 'zod';
import {
  ExtractionSchema,
  IntentResultSchema,
  type Exercise,
  type Extraction,
} from '../contracts/extraction.js';
import { createOpenAiClient, type StructuredMethod } from './openai.js';
import { EXTRACTION_FIXTURES, GOLDEN_INTENTS } from './fixtures.js';
import { EXTRACTION_SYSTEM, INTENT_SYSTEM } from './prompts.js';

// 与 openai.ts 的默认值同步 —— 实测若与它不符，这里当场喊出来
const DEFAULT_METHOD: StructuredMethod = 'functionCalling';

const METHODS: StructuredMethod[] = ['jsonSchema', 'functionCalling', 'jsonMode'];

/** 探针只要求一个数字 —— 少受模型能力影响，探的是通道不是智商 */
const ProbeSchema = z.object({ n: z.number() });

async function probeChannels(): Promise<StructuredMethod[]> {
  const passed: StructuredMethod[] = [];
  for (const method of METHODS) {
    try {
      const client = createOpenAiClient({ method });
      const out = await client.structured({
        system: '把用户消息里的数字填进 n，别做别的。',
        input: 'n 是 123',
        schema: ProbeSchema,
        name: 'probe',
      });
      console.log(`✅ ${method} → ${JSON.stringify(out)}`);
      passed.push(method);
    } catch (err) {
      console.log(`❌ ${method} → ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return passed;
}

function setsKey(sets: Exercise['mentioned_sets']): string {
  return [...sets]
    .map((s) => `${s.weight_kg ?? '-'}/${s.weight_unit ?? '-'}/${s.reps ?? '-'}/${s.set_type}`)
    .sort()
    .join(' | ');
}

/** null = 这条过；字符串 = 差在哪。day_hint / split_label 不参与判定，避免过严 */
function diff(expected: Extraction, got: Extraction): string | null {
  if (expected.kind === 'meal') {
    if (got.kind !== 'meal') return `kind 是 ${got.kind}，应为 meal`;
    return expected.items.length === got.items.length
      ? null
      : `饮食项数 ${got.items.length} ≠ ${expected.items.length}`;
  }

  if (got.kind !== 'workout') return `kind 是 ${got.kind}，应为 workout`;
  if (got.exercises.length !== expected.exercises.length) {
    return `动作数 ${got.exercises.length} ≠ ${expected.exercises.length}`;
  }

  const rest = [...got.exercises];
  for (const exp of expected.exercises) {
    const i = rest.findIndex((g) => g.raw_name.includes(exp.raw_name) || exp.raw_name.includes(g.raw_name));
    if (i < 0) return `没抽到「${exp.raw_name}」`;
    const [hit] = rest.splice(i, 1);
    if (!hit) return `没抽到「${exp.raw_name}」`;
    if (setsKey(hit.mentioned_sets) !== setsKey(exp.mentioned_sets)) {
      return `「${exp.raw_name}」的组对不上：${setsKey(hit.mentioned_sets)} ≠ ${setsKey(exp.mentioned_sets)}`;
    }
  }
  return null;
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) {
    console.error('🔴 没读到 OPENAI_API_KEY / OPENAI_MODEL —— 先在仓库根 .env 里填好（见 .env.example）');
    process.exit(1);
  }

  console.log('—— 1/3 探结构化输出通道 ——');
  const passed = await probeChannels();
  const chosen = passed[0];
  if (!chosen) {
    console.error('🔴 三个通道都不通 —— 回 ADR-011 复议模型档位（定义 §3.2）');
    process.exit(1);
  }
  console.log(
    chosen === DEFAULT_METHOD
      ? `→ 用「${chosen}」继续（与 openai.ts 的默认值一致）。\n`
      : `→ 用「${chosen}」继续。⚠️ openai.ts 的默认值是「${DEFAULT_METHOD}」，与实测不符 —— 去改。\n`,
  );

  const client = createOpenAiClient({ method: chosen });

  console.log('—— 2/3 黄金集抽取准确率（真实模型）——');
  const cases = Object.entries(EXTRACTION_FIXTURES);
  let hit = 0;
  for (const [input, expected] of cases) {
    try {
      const got = await client.structured({
        system: EXTRACTION_SYSTEM,
        input,
        schema: ExtractionSchema,
        name: 'extraction',
      });
      const why = diff(expected, got);
      if (why) {
        console.log(`❌ ${input}\n     ${why}`);
      } else {
        hit += 1;
        console.log(`✅ ${input}`);
      }
    } catch (err) {
      console.log(`❌ ${input}\n     ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const rate = Math.round((hit / cases.length) * 100);
  console.log(`\n解析准确率：${hit}/${cases.length} = ${rate}%（目标 ≥90%）\n`);

  console.log('—— 3/3 意图分类准确率（附赠）——');
  const intentCases = Object.entries(GOLDEN_INTENTS);
  let intentHit = 0;
  for (const [input, want] of intentCases) {
    try {
      const res = await client.structured({
        system: INTENT_SYSTEM,
        input,
        schema: IntentResultSchema,
        name: 'intent',
      });
      if (res.intent === want) intentHit += 1;
      else console.log(`❌ ${input} → ${res.intent}（期望 ${want}）`);
    } catch (err) {
      console.log(`❌ ${input} → ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(
    `意图准确率：${intentHit}/${intentCases.length} = ${Math.round((intentHit / intentCases.length) * 100)}%\n`,
  );

  console.log(`结论：通道「${chosen}」可用（exit 0）。准确率低于 90% 也照实报 —— 那是发现，不是失败。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});