#!/usr/bin/env node
/**
 * 本地真实采集转写 —— 🔴 **作者本机跑，永不进 CI**。
 *
 *   pnpm kb:smoke
 *
 * 需要三样东西都在本机备好：
 *   1. 自建解析服务起着（KB_PARSER_BASE_URL，默认 http://127.0.0.1:8000，还要 KB_PARSER_API_KEY）；
 *   2. 本机装了 Python + faster-whisper（见 apps/api/tools/asr_transcribe.py）；
 *   3. seed/knowledge_whitelist.json 里填了博主主页（或钉住的视频）。
 *
 * ⚠️ 本脚本会把**转写正文**打到终端 —— 那是它的用途：**肉眼看它是不是博主口播**。
 *    转出来若是背景音乐、或术语错到不能引用，这条视频就不能算进知识库（dev-004 §3.2）。
 */
import { createLocalAsrClient } from '../asr/local.js';
import { loadTranscript } from '../services/knowledge.js';
import { closeDb } from '../services/pool.js';
import { createDouyinFetcher } from './douyin.js';
import { ingestAll } from './pipeline.js';
import { loadWhitelist, isWhitelistEmpty, WHITELIST_PATH } from './whitelist.js';

const whitelist = loadWhitelist();
if (isWhitelistEmpty(whitelist)) {
  console.error(`白名单是空的（${WHITELIST_PATH}）—— 先把你选定的博主主页或视频填进去。`);
  process.exit(1);
}

/**
 * `KB_SMOKE_LIMIT=N` —— **只跑钉住的前 N 条**，用来快速验「管道通 + 是口播」。
 * 它**不走遍历**（遍历是慢的那一半），所以 N 要跟 `videos` 对着看。
 */
const limitRaw = process.env.KB_SMOKE_LIMIT;
const limit = limitRaw === undefined ? null : Number(limitRaw);
if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
  console.error(`KB_SMOKE_LIMIT 得是 ≥1 的整数（现在填的是「${limitRaw}」）。`);
  process.exit(1);
}
const scoped =
  limit === null
    ? whitelist
    : { ...whitelist, creators: [], videos: whitelist.videos.slice(0, limit) };
if (limit !== null) {
  if (scoped.videos.length === 0) {
    console.error(
      `KB_SMOKE_LIMIT=${limit} 只作用于**钉住的视频**，但 videos 是空的 —— 要么填一条，要么去掉这个变量。`,
    );
    process.exit(1);
  }
  console.log(`⚠️ KB_SMOKE_LIMIT=${limit}：只跑钉住的 ${scoped.videos.length} 条，**不走遍历**。`);
}

console.log('\n=== know-fit 本地真实采集转写 ===');
console.log(
  `白名单：博主 ${scoped.creators.length} 个 + 钉住视频 ${scoped.videos.length} 条；` +
    `先确认解析服务起着、本机装好了 faster-whisper。\n`,
);

let failed = false;
try {
  const fetcher = createDouyinFetcher();
  const asr = createLocalAsrClient();

  // 不加这个的话，采集 + 转写整段**一个字都不打** —— 长视频（CPU 上几十分钟一条）
  // 看起来就和卡死一样。打字是给「它在动」提供证据。
  const startedAt = new Map<string, number>();
  const { robots, sources } = await ingestAll(scoped, {
    fetcher,
    asr,
    onProgress: (e) => {
      if (e.stage === 'listed') {
        console.log(`—— 博主「${e.creator}」：候选 ${e.candidates} 条 → 采 ${e.picked} 条`);
        // 定义 §3.1 第 5 条：真跑时要能肉眼看出排除词挡了谁、有没有误杀
        for (const t of e.excluded) console.log(`   ⛔ 排除词挡下：「${t}」`);
      }
      if (e.stage === 'transcribe') {
        startedAt.set(e.platform_video_key, Date.now());
        const dur = e.duration_sec === null ? '时长未知' : `${e.duration_sec}s`;
        console.log(`   ⏳ 下载 + 转写 ${e.platform_video_key}「${e.title}」（${dur}）…`);
      }
      if (e.stage === 'done') {
        const t0 = startedAt.get(e.platform_video_key);
        const sec = t0 === undefined ? '—' : `${Math.round((Date.now() - t0) / 1000)}s`;
        console.log(`   ✓ 落库 ${e.platform_video_key}：${e.segments} 段（这条用了 ${sec}）`);
      }
    },
  });

  console.log(`robots：checked_at = ${robots.checked_at.toISOString()}，allowed = ${robots.allowed}`);

  for (const s of sources) {
    console.log(`\n—— ${s.platform_video_key}「${s.title}」（${s.creator}）——`);
    console.log(`   duration_sec=${s.duration_sec}  published_at=${s.published_at}`);
    console.log(`   fetched_at=${s.fetched_at}  segment_count=${s.segment_count}`);
    console.log('   转写（肉眼确认是口播、不是背景音乐）：');
    console.log('   ⚠️ 正文不入任何对外接口，下面只为你复核而打。');
    for (const seg of await loadTranscript(s.source_id)) {
      console.log(`   [${seg.start_ts.toFixed(1)}–${seg.end_ts.toFixed(1)}] ${seg.text}`);
    }
  }

  console.log('\n⚠️ 复核点：上面若看着像歌词 / 与健身无关，说明取错了音轨 —— 这条不算数。');
} catch (e) {
  console.error(`\n✗ ${(e as Error).message}`);
  failed = true;
} finally {
  await closeDb();
}

if (failed) {
  console.error('\n本地真实采集转写未通过。\n');
  process.exit(1);
}
console.log('\n本地真实采集转写完成。\n');