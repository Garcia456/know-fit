#!/usr/bin/env node
/**
 * 从 evals/rag/queries.jsonl 生成 promptfoo 测试集 —— 不手抄，标注只有一份。
 *
 * 输出 tests.jsonl：vars 带 query / split / expected_source_ids / generic_source_ids。
 * generic_source_ids = 三分化①（“万能源”），推日专属命中要把它们去掉再算。
 * 数组一律 JSON 字符串 —— promptfoo 会把数组 var 展开成一条条测试，断言里也只剩字符串。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const src = new URL('../rag/queries.jsonl', dir);
const out = new URL('tests.jsonl', dir);

/** 凯圣王-谭成义三分化①：覆盖推/拉/腿的通用计划，不是任何一天的专属源 */
const GENERIC_SOURCE_IDS = ['7c468db9-0e51-41c2-9bb6-62393aa65f5e'];

const rows = readFileSync(src, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const lines = rows.map((row) =>
  JSON.stringify({
    description: `${row.id} · ${row.query}`,
    vars: {
      id: row.id,
      query: row.query,
      split: row.state?.split ?? '',
      expected_source_ids: JSON.stringify(row.expected_source_ids ?? []),
      generic_source_ids: JSON.stringify(GENERIC_SOURCE_IDS),
    },
  }),
);

writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`✓ ${out.pathname}（${lines.length} 条）`);