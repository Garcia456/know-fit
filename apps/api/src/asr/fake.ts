import { FIXTURE_TRANSCRIPT } from '../kb/fixtures.js';
import { normalizeTranscript } from './parse.js';
import type { AsrClient } from '../kb/types.js';

/**
 * 确定性 ASR 替身 —— CI 与测试只用它，因此**永不加载模型**。
 *
 * 与 `createFakeClient` 同型：替身走的是与真实实现**同一条代码路径**，
 * 只是把「模型」换成了写死的样本。
 */
export function createFakeAsr(): AsrClient {
  return {
    async transcribe() {
      return normalizeTranscript(FIXTURE_TRANSCRIPT);
    },
  };
}