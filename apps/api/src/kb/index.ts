#!/usr/bin/env node
/**
 * 切片与索引的命令行入口 —— **CI 与本地同一条代码路径**，区别只在 provider。
 *
 *   LLM_PROVIDER=fake（默认）+ EMBEDDING_PROVIDER=fake（默认）→ 替身，不联网、不需要 key
 *   LLM_PROVIDER=openai + EMBEDDING_PROVIDER=real              → 真实闸① + 真实向量（作者本机）
 *
 * 前置：库里已有 `knowledge_source`（先 `pnpm kb:ingest`）。
 *
 * 可选：
 *   KB_INDEX_LIMIT=N        只索引前 N 条源（「先 1 条真跑」用）
 *   KB_INDEX_KEY=<key>      只索引指定的一条源
 *   KB_INDEX_CONCURRENCY=N 闸① 并发数（默认 4）
 *   KB_INDEX_SHOW_TEXT=1    把某一片的正文与前缀打出来（肉眼看「像不像一个完整观点」）
 *
 * 🔴 正文只在**本机**为复核而打；替身档默认不打，免得日志里夹带 fixture 原文。
 */
import { createLlmClient, resolveProvider } from '../llm/index.js';
import { loadIndexableSources } from '../services/chunks.js';
import { closeDb } from '../services/pool.js';
import { createLlmClaimJudge } from './claimJudge.js';
import { createEmbeddingClient, resolveEmbeddingProvider } from './embedding.js';
import { indexSources } from './indexer.js';

const llmProvider = resolveProvider();
const embeddingProvider = resolveEmbeddingProvider();

const keyFilter = process.env.KB_INDEX_KEY?.trim();
const concurrencyRaw = process.env.KB_INDEX_CONCURRENCY?.trim();
if (concurrencyRaw !== undefined && concurrencyRaw !== '') {
  const n = Number(concurrencyRaw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`KB_INDEX_CONCURRENCY 得是 ≥1 的整数（现在填的是「${concurrencyRaw}」）。`);
    process.exit(1);
  }
}
const limitRaw = process.env.KB_INDEX_LIMIT?.trim();
if (limitRaw !== undefined && limitRaw !== '') {
  const n = Number(limitRaw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`KB_INDEX_LIMIT 得是 ≥1 的整数（现在填的是「${limitRaw}」）。`);
    process.exit(1);
  }
}

let failed = false;
try {
  const all = await loadIndexableSources();
  let sources = keyFilter ? all.filter((s) => s.platformVideoKey === keyFilter) : all;
  if (limitRaw) sources = sources.slice(0, Number(limitRaw));

  console.log('\n=== know-fit 知识库切片与索引 ===');
  console.log(`闸① provider = ${llmProvider}；embedding provider = ${embeddingProvider}`);
  console.log(`可索引源 ${all.length} 条；本次处理 ${sources.length} 条\n`);

  if (keyFilter && sources.length === 0) {
    console.error(`KB_INDEX_KEY=「${keyFilter}」在可索引源里找不到。`);
    process.exit(1);
  }
  if (sources.length === 0) {
    console.error('没有可索引的源 —— 先 pnpm kb:ingest 采一批，或检查 is_indexable / 转写是否为空。');
    process.exit(1);
  }

  const embedder = createEmbeddingClient(embeddingProvider);
  const report = await indexSources(sources, {
    judge: createLlmClaimJudge(createLlmClient(llmProvider, { method: 'jsonMode' })),
    embedder,
    judgeConcurrency: concurrencyRaw ? Number(concurrencyRaw) : undefined,
    onProgress: (e) => {
      if (e.stage === 'start') console.log(`—— ${e.platform_video_key}：${e.segments} 段待切`);
      if (e.stage === 'chunked') console.log(`   切成 ${e.chunks} 片`);
      if (e.stage === 'embedded') console.log(`   向量化 ${e.vectors} 条（${embedder.model}）`);
      if (e.stage === 'stored') {
        console.log(`   落库：${e.before} → ${e.after} 片；删掉旧片 ${e.deleted} 条`);
      }
    },
  });

  for (const s of report.sources) {
    console.log(`\n—— ${s.platform_video_key}「${s.title}」——`);
    console.log(
      `   片数 ${s.chunks}；字数 min/avg/max = ${s.chars.min}/${s.chars.avg}/${s.chars.max}；` +
        `重叠 min/avg = ${(s.overlap_ratio.min * 100).toFixed(1)}% / ${(s.overlap_ratio.avg * 100).toFixed(1)}%`,
    );
    console.log(`   调整：低于下限并片 ${s.notes.merged_low} 片；单段超长 ${s.notes.over_limit} 片`);
    console.log(
      `   闸①：观点 ${s.claim_distribution.观点} / 事实 ${s.claim_distribution.事实} / ` +
        `演示 ${s.claim_distribution.演示} / 寒暄 ${s.claim_distribution.寒暄}；` +
        `可引用 ${s.citable} 片，被置信度门限挡下 ${s.excluded_by_confidence} 片`,
    );
    console.log(
      `   exercise_tags 命中 ${s.exercise_tagged_chunks}/${s.chunks} 片；` +
        `embedding_model = ${report.embedding_model}（${report.dimensions} 维）`,
    );
  }

  console.log('\n合计：');
  console.log(
    `  源 ${report.totals.sources} 条 → 片 ${report.totals.chunks} 条；可引用 ${report.totals.citable} 条；` +
      `被置信度门限挡下 ${report.totals.excluded_by_confidence} 条`,
  );
  console.log(
    `  类别分布：观点 ${report.totals.claim_distribution.观点} / 事实 ${report.totals.claim_distribution.事实} / ` +
      `演示 ${report.totals.claim_distribution.演示} / 寒暄 ${report.totals.claim_distribution.寒暄}`,
  );

  const showText = embeddingProvider === 'real' || process.env.KB_INDEX_SHOW_TEXT === '1';
  const sample = report.sources[0]?.sample;
  if (showText && sample) {
    console.log('\n复核样本（正文只在本机打，不入任何接口）：');
    console.log(`  context_prefix：${sample.contextPrefix}`);
    console.log(`  text：${sample.text}`);
    console.log(`  短引用（逐字摘）：${sample.shortQuote}`);
    console.log('  ⚠️ 肉眼看：这片是不是一个完整观点？切点有没有把两件事焊在一起？');
  }
} catch (e) {
  console.error(`\n✗ ${(e as Error).message}`);
  failed = true;
} finally {
  await closeDb();
}

if (failed) {
  console.error('\n切片与索引未通过。\n');
  process.exit(1);
}
console.log('\n切片与索引完成。\n');