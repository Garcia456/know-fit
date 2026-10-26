import { FIXTURE_ROBOTS_CHECKED_AT, fixtureCandidates, fixtureFetched } from './fixtures.js';
import type { Fetcher } from './types.js';

/**
 * 确定性采集替身 —— CI 与测试只用它，**永不联网**。
 *
 * 它不查白名单：**准入判定是管线的职责**（whitelist.ts），替身只管「拿到了什么」。
 * 这样「不在白名单的视频被拒」那条用例验的是真规则，不是替身的心情。
 */
export function createFakeFetcher(): Fetcher {
  return {
    async fetch(video) {
      return fixtureFetched(video);
    },

    async listCreatorVideos(creator) {
      // 替身只有一页，也没有下一页 —— 翻页逻辑由管线的用例单独喂
      return { candidates: fixtureCandidates(creator), cursor: null };
    },

    async downloadAudio(audioUrl) {
      // 不下载：路径由 URL 派生，保证确定性
      const name = audioUrl.slice(audioUrl.lastIndexOf('/') + 1) || 'audio';
      return `/tmp/knowfit-${name}`;
    },

    async checkRobots() {
      return { checked_at: FIXTURE_ROBOTS_CHECKED_AT, allowed: null };
    },

    async discardAudio() {
      // 替身没有真实文件，空转
    },
  };
}