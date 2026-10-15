#!/usr/bin/env node
/**
 * 采集与转写的命令行入口 —— **CI 与本地同一条代码路径**，区别只在 provider。
 *
 *   KB_PROVIDER=fake（默认）+ ASR_PROVIDER=fake（默认）→ 替身，不联网、不加载模型
 *   KB_PROVIDER=real + ASR_PROVIDER=local            → 真实解析服务 + 本地 ASR（只在作者本机）
 *
 * 白名单取哪个：
 *   fake → 代码里的 FIXTURE_WHITELIST（**CI 不依赖作者填的数据**）
 *   real → seed/knowledge_whitelist.json（作者填）
 *
 * 可选：KB_RETIRE=<platform_video_key> —— 采完把它下架，并把前后行数打出来。
 *
 * 跑法：pnpm kb:ingest      （真实跑法见 kb:smoke）
 */
import { createAsrClient } from '../asr/index.js';
import { retireSource } from '../services/knowledge.js';
import { closeDb } from '../services/pool.js';
import { createFakeFetcher } from './fake.js';
import { createDouyinFetcher } from './douyin.js';
import { ingestAll } from './pipeline.js';
import { FIXTURE_WHITELIST } from './fixtures.js';
import { loadWhitelist, isWhitelistEmpty, WHITELIST_PATH } from './whitelist.js';
import type { AsrClient, Fetcher } from './types.js';

const provider = process.env.KB_PROVIDER ?? 'fake';
if (provider !== 'fake' && provider !== 'real') {
  console.error(`KB_PROVIDER 只认 fake / real，收到「${provider}」`);
  process.exit(1);
}

const whitelist = provider === 'real' ? loadWhitelist() : FIXTURE_WHITELIST;
if (isWhitelistEmpty(whitelist)) {
  console.error(`白名单是空的（${WHITELIST_PATH}）—— 先把你选定的博主主页或视频填进去。`);
  process.exit(1);
}

const fetcher: Fetcher = provider === 'real' ? createDouyinFetcher() : createFakeFetcher();
// ASR 由 ASR_PROVIDER 单独定 —— 「抓真实音频 + 走替身转写」是合法的组合（只验抓的那半）
const asr: AsrClient = createAsrClient();

console.log(`\n=== know-fit 知识库采集（provider = ${provider}）===`);
console.log(
  `白名单：博主 ${whitelist.creators.length} 个（各取近 max_items 条）+ 钉住视频 ${whitelist.videos.length} 条\n`,
);

let failed = false;
try {
  const { robots, sources } = await ingestAll(whitelist, { fetcher, asr });

  console.log(`robots 检查：checked_at = ${robots.checked_at.toISOString()}`);
  console.log(`  结论 allowed = ${robots.allowed === null ? 'null（检查过，结论不适用）' : robots.allowed}`);
  console.log(`\n落了 ${sources.length} 条知识源：`);

  for (const s of sources) {
    console.log(
      `  ✓ ${s.platform_video_key}  「${s.title}」  转写 ${s.segment_count} 段` +
        `  subtitle_source=${s.subtitle_source}  fetched_at=${s.fetched_at}`,
    );
  }

  const retireKey = process.env.KB_RETIRE;
  if (retireKey) {
    const target = sources.find((s) => s.platform_video_key === retireKey);
    if (!target) {
      console.error(`\nKB_RETIRE 指定的「${retireKey}」不在本次采集结果里`);
      failed = true;
    } else {
      const report = await retireSource(target.source_id);
      console.log('\n下架：');
      console.log(
        `  可检索知识源 ${report.sources_before} → ${report.sources_after}；` +
          `该源转写段 ${report.segments_before} → ${report.segments_after}`,
      );
      console.log(`  compliance_status = ${report.compliance_status}，行本身保留（下架要留痕）`);
    }
  }
} catch (e) {
  console.error(`\n✗ ${(e as Error).message}`);
  failed = true;
} finally {
  await closeDb();
}

if (failed) {
  console.error('\n采集未通过。\n');
  process.exit(1);
}
console.log('\n采集通过。\n');