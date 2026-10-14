import { createFakeAsr } from './fake.js';
import { createLocalAsrClient } from './local.js';
import type { AsrClient } from '../kb/types.js';

export type AsrProvider = 'fake' | 'local';

/** 🔴 认不出的一律当 fake —— 本地没装模型时绝不会误加载真实模型 */
export function resolveAsrProvider(raw: string | undefined = process.env.ASR_PROVIDER): AsrProvider {
  if (raw === 'local') return 'local';
  if (raw === undefined || raw === '' || raw === 'fake') return 'fake';
  throw new Error(`ASR_PROVIDER 只认 fake / local，收到「${raw}」`);
}

export function createAsrClient(provider: AsrProvider = resolveAsrProvider()): AsrClient {
  return provider === 'local' ? createLocalAsrClient() : createFakeAsr();
}

export type { AsrClient } from '../kb/types.js';
export { createFakeAsr } from './fake.js';
export { createLocalAsrClient } from './local.js';
export { normalizeTranscript, parseAsrOutput } from './parse.js';