import { FIXTURE_ROBOTS_CHECKED_AT, fixtureFetched } from './fixtures.js';
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

    async checkRobots() {
      return { checked_at: FIXTURE_ROBOTS_CHECKED_AT, allowed: null };
    },

    async discardAudio() {
      // 替身没有真实文件，空转
    },
  };
}