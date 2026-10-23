#!/usr/bin/env node
/**
 * 从库里导出一批片，做成 promptfoo 的测试集初稿 —— **标注要作者亲手填**。
 *
 * 输出到同目录 `dataset.jsonl`，每行：
 *   {"vars":{"input":"<前缀 + 正文>","expected":""},"metadata":{"chunk_id":"…","source":"…"}}
 *
 * 用法： pnpm --filter @know-fit/api kb:eval:export
 * 可选： EVAL_EXPORT_LIMIT（默认 30）/ EVAL_EXPORT_KEY（只看一条源）
 *
 * 🔴 脚本不填 expected —— 标注是人的判断，编不出来。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'dataset.jsonl');
const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';
const limit = Number(process.env.EVAL_EXPORT_LIMIT ?? '30');
const key = process.env.EVAL_EXPORT_KEY?.trim();

if (!Number.isInteger(limit) || limit < 1) {
  console.error(`EVAL_EXPORT_LIMIT 得是 ≥1 的整数（现在「${process.env.EVAL_EXPORT_LIMIT}」）`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
} catch (e) {
  console.error(`连不上数据库：${e.message}\n起库：pnpm db:up && pnpm db:migrate`);
  process.exit(1);
}

try {
  const params = [];
  let where = '';
  if (key) {
    params.push(key);
    where = 'WHERE s.platform_video_key = $1';
  }
  params.push(limit);
  const rows = await client.query(
    `SELECT c.id, c.context_prefix, c.text, s.platform_video_key, s.title
       FROM knowledge_chunk c JOIN knowledge_source s ON s.id = c.source_id
       ${where}
      ORDER BY s.platform_video_key, c.chunk_index
      LIMIT $${params.length}`,
    params,
  );

  const lines = rows.rows.map((r) =>
    JSON.stringify({
      vars: { input: `${r.context_prefix}\n${r.text}`, expected: '' },
      metadata: { chunk_id: r.id, source: r.platform_video_key, title: r.title },
    }),
  );
  writeFileSync(OUT, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');

  console.log(`\n导出 ${lines.length} 片 → ${OUT}`);
  if (lines.length === 0) {
    console.log('⚠️ 库里没有片 —— 先跑 pnpm kb:index。');
  } else {
    console.log('下一步：逐行把 vars.expected 填成「观点 / 事实 / 演示 / 寒暄」之一，');
    console.log('        至少 20 行，然后跑 pnpm kb:eval:check 与 pnpm kb:eval。');
    console.log('⚠️ 不填标注 = 没有准确率可言，别拿「跑了没报错」顶替。');
  }
} finally {
  await client.end();
}