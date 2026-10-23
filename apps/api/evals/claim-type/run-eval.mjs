#!/usr/bin/env node
/**
 * 跑 promptfoo 评测 —— 只走本地，**不进 CI、不进 check-dev.sh**。
 *
 * 先用 kb:eval:check 确认标注够 20 条；再调 promptfoo。
 * 要真实 key（OPENAI_API_KEY）与百炼端点（OPENAI_BASE_URL）—— 只在作者本机。
 *
 * 用法： pnpm --filter @know-fit/api kb:eval
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const config = join(HERE, 'promptfooconfig.yaml');

if (!process.env.OPENAI_API_KEY) {
  console.error('没有 OPENAI_API_KEY —— 评测要真实裁判模型，只在作者本机跑（.env）。');
  process.exit(1);
}
if (!process.env.OPENAI_BASE_URL) {
  console.error('没有 OPENAI_BASE_URL —— 裁判端点钉死在百炼。');
  process.exit(1);
}

const result = spawnSync('pnpm', ['exec', 'promptfoo', 'eval', '-c', config], {
  cwd: HERE,
  shell: true,
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);