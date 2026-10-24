#!/usr/bin/env node
/**
 * 评测前的地基检查：**人工标注够不够**。
 *
 * 少于 20 条有效标注 → 退出码非零。没有标注集就没有准确率，
 * 与其跑出一串 0 分，不如先停在这里。
 *
 * 用法： pnpm --filter @know-fit/api kb:eval:check
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, 'dataset.jsonl');
const MIN = 20;
const TYPES = ['陈述', '演示', '寒暄'];

let text = '';
try {
  text = readFileSync(FILE, 'utf8');
} catch {
  console.error(`没有 ${FILE} —— 先跑 kb:eval:export，再逐行填 expected。`);
  process.exit(1);
}

const rows = text
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l, i) => {
    try {
      return { i: i + 1, row: JSON.parse(l) };
    } catch {
      console.error(`第 ${i + 1} 行不是合法 JSON`);
      process.exit(1);
    }
  });

const labeled = rows.filter(({ row }) => TYPES.includes(String(row.vars?.expected ?? '').trim()));
const missing = rows.length - labeled.length;
const dist = Object.fromEntries(TYPES.map((t) => [t, 0]));
for (const { row } of labeled) dist[String(row.vars.expected).trim()]++;

console.log(`\n标注集：${labeled.length} 条有效 / 共 ${rows.length} 行（缺 ${missing} 条）`);
console.log(`  分布：${TYPES.map((t) => `${t} ${dist[t]}`).join(' / ')}`);

if (labeled.length < MIN) {
  console.error(`\n✗ 有效标注 ${labeled.length} 条 < ${MIN} —— 先填够再评测（至少 20 片）。`);
  process.exit(1);
}
console.log(`\n✓ 标注集够跑评测（≥${MIN}）。下一步：pnpm kb:eval\n`);