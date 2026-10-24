#!/usr/bin/env node
/**
 * 个人数据状态 → 检索 query（20 条 pilot 的第一步）。
 *
 * 输入：evals/rag/states.jsonl（从 states.template.jsonl 复制后按自己的训练改）
 * 输出：evals/rag/queries.jsonl（带空标注位）
 *
 * ⚠️ queries.jsonl 一旦有了标注就不该被覆盖 —— 默认拒绝，`--force` 才重写。
 *
 * 用法：pnpm rag:eval:queries [--force]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildVolumeHook } from '../../src/metrics/hook.js';
import { buildQuery } from '../../src/assessment/query.js';
import { createLlmClient } from '../../src/llm/index.js';

interface State {
  id: string;
  goal: string | null;
  split: string | null;
  current: number;
  baseline: number | null;
  note?: string;
}

const dir = new URL('.', import.meta.url);
const statesPath = new URL('states.jsonl', dir);
const outPath = new URL('queries.jsonl', dir);
const force = process.argv.includes('--force');

if (!existsSync(statesPath)) {
  console.error('缺 evals/rag/states.jsonl —— 先复制模板：');
  console.error('  cp evals/rag/states.template.jsonl evals/rag/states.jsonl');
  process.exit(1);
}
if (existsSync(outPath) && !force) {
  console.error('queries.jsonl 已存在（可能已有你的标注）。确要重写请加 --force。');
  process.exit(1);
}

const lines = readFileSync(statesPath, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);
if (lines.length !== 20) {
  console.error(`states.jsonl 应是 20 行，现在是 ${lines.length} 行。`);
  process.exit(1);
}

const llm = createLlmClient();
const out: string[] = [];

for (const [i, line] of lines.entries()) {
  let state: State;
  try {
    state = JSON.parse(line) as State;
  } catch {
    console.error(`第 ${i + 1} 行不是合法 JSON。`);
    process.exit(1);
  }

  const verdict = buildVolumeHook({
    current: state.current,
    baseline: state.baseline,
    split_label: state.split,
  });
  const built = await buildQuery(verdict, state.goal, llm);
  out.push(
    JSON.stringify({
      id: state.id,
      state,
      query: built.query,
      query_source: built.source,
      expected_source_ids: [],
      author_reviewed: false,
    }),
  );
}

writeFileSync(outPath, `${out.join('\n')}\n`, 'utf8');
const templated = out.filter((l) => JSON.parse(l).query_source === 'template').length;
console.log(`写出 queries.jsonl：${out.length} 条（模板 ${templated} 条 / LLM 或兜底 ${out.length - templated} 条）`);
console.log('下一步：在 queries.jsonl 里填 expected_source_ids，并把 author_reviewed 改成 true。');
