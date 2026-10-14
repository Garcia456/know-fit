#!/usr/bin/env node
/**
 * know-fit 采集转写管线检查
 *
 * 一句话：**把管线真跑一遍，看它有没有把知识落进库、有没有把正文漏出去。**
 *
 *   KB_PROVIDER=fake 跑一次 kb:ingest（替身解析 + 替身转写：不联网、不加载模型）
 *     → 断言 stdout 里只有元数据与计数、**没有转写正文**
 *     → 裸 SQL 断言库里真有这两条知识源（留痕齐全、转写段落真的落了库）
 *   KB_RETIRE 再跑一次 → 断言下架真的清了产物、留了行
 *     → 收尾：把本次落下的行全删（检查不该在开发库里留痕）
 *
 * 为什么必须跑真命令行而不是直接调 ingestAll：
 *   直接调函数只能证明「函数对」，证明不了「入口脚本挂上了、provider 认得对、
 *   报告里没夹带正文」—— 那几样恰恰是「本地跑得起来」最容易断的地方。
 *
 * 用法： node scripts/kb-check.mjs        （先 pnpm db:up && pnpm db:migrate）
 * 退出码：0 = 通过；1 = 失败
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL ?? 'postgres://knowfit:knowfit@localhost:5432/knowfit';

/** 替身清单里的两条，与 src/kb/fixtures.ts 对齐 */
const KEYS = ['fixture-0001', 'fixture-0002'];
/** 替身转写里的正文片段 —— 它**不该出现**在任何对外输出里 */
const BODY_FRAGMENT = '肩胛要收紧';

let failed = false;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  console.error(`  \x1b[31m✗\x1b[0m ${m}`);
  failed = true;
};

console.log('\n=== know-fit 采集转写管线检查 ===\n');

/** 跑命令行入口 —— 🔴 显式写死替身 provider：本检查绝不联网、绝不加载模型 */
function runIngest(extraEnv = {}) {
  return spawnSync('pnpm', ['kb:ingest'], {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, KB_PROVIDER: 'fake', ASR_PROVIDER: 'fake', ...extraEnv },
  });
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
} catch (e) {
  bad(`连不上数据库：${e.message}`);
  console.error('     起库：pnpm db:up && pnpm db:migrate');
  process.exit(1);
}

try {
  // ── 1. 采一遍 ──────────────────────────────────────────────────────
  const run = runIngest();
  const stdout = run.stdout ?? '';

  if (run.status !== 0) {
    bad(`pnpm kb:ingest 退出码 ${run.status}`);
    console.error((run.stderr ?? '').slice(0, 800));
  } else {
    ok('kb:ingest 跑通（替身解析 + 替身转写）');

    if (KEYS.every((k) => stdout.includes(k))) {
      ok('报告里两条源都在（按 platform_video_key 列了）');
    } else {
      bad('报告里没把两条源都列出来');
    }

    // 🔴 这条是本次检查的核心：对外只报元数据与计数，正文一步都不许出去
    if (stdout.includes(BODY_FRAGMENT)) {
      bad(`报告里漏出了转写正文（含「${BODY_FRAGMENT}」）`);
    } else {
      ok('报告里没有转写正文 —— 只有元数据与计数');
    }
  }

  // ── 2. 库里真有吗（读回用裸 SQL，不借 ORM） ────────────────────────
  const rows = await client.query(
    `SELECT platform_video_key, platform, subtitle_source, is_indexable, compliance_status,
            robots_checked_at IS NOT NULL AS has_robots_ts,
            jsonb_array_length(transcript_segments) AS seg_count,
            content_hash
       FROM knowledge_source WHERE platform_video_key = ANY($1) ORDER BY platform_video_key`,
    [KEYS],
  );

  if (rows.rowCount !== 2) {
    bad(`库里应有 2 条知识源，实为 ${rows.rowCount} 条`);
  } else {
    ok('库里查到了 2 条知识源（裸 SQL 读回）');
    const blank = rows.rows.filter(
      (r) =>
        r.platform !== 'douyin' ||
        r.subtitle_source !== 'asr' ||
        r.is_indexable !== true ||
        r.compliance_status !== 'ok' ||
        r.has_robots_ts !== true ||
        Number(r.seg_count) !== 2 ||
        !/^[0-9a-f]{64}$/.test(r.content_hash ?? ''),
    );
    if (blank.length === 0) {
      ok('元数据 / 留痕 / 转写段落 / 内容锚都齐（各 2 段，空段已归一掉）');
    } else {
      bad(`有 ${blank.length} 条的字段不对：${JSON.stringify(blank.map((r) => r.platform_video_key))}`);
    }
  }

  // ── 3. 下架通道：再跑一次，把它下架 ────────────────────────────────
  const retire = runIngest({ KB_RETIRE: KEYS[1] });
  if (retire.status !== 0) {
    bad(`带 KB_RETIRE 跑 kb:ingest 退出码 ${retire.status}`);
    console.error((retire.stderr ?? '').slice(0, 800));
  } else {
    const after = await client.query(
      'SELECT is_indexable, compliance_status, transcript_segments FROM knowledge_source WHERE platform_video_key = $1',
      [KEYS[1]],
    );
    const r = after.rows[0];
    if (
      after.rowCount === 1 &&
      r.is_indexable === false &&
      r.compliance_status === 'retired' &&
      r.transcript_segments === null
    ) {
      ok('下架：转写产物已清空、is_indexable 转 false，行本身留着（留痕）');
    } else {
      bad(`下架结果不对：${JSON.stringify(r)}`);
    }
  }
} finally {
  // 收尾：本次落下的行全删 —— 检查不该在开发库里留痕
  await client
    .query('DELETE FROM knowledge_source WHERE platform_video_key = ANY($1)', [KEYS])
    .catch((e) => bad(`清理失败：${e.message}`));
  await client.end();
}

if (failed) {
  console.error('\n采集转写管线检查未通过。\n');
  process.exit(1);
}
console.log('\n采集转写管线检查通过。\n');