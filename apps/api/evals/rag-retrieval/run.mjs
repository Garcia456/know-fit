#!/usr/bin/env node
/**
 * 跑 promptfoo 检索矩阵 —— 先读根 `.env`，再生成 tests.jsonl，再调本地 promptfoo CLI。
 *
 * 用法：pnpm rag:retrieval:eval [额外 promptfoo 参数]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '../../../../.env');
if (existsSync(envPath)) loadEnvFile(envPath);

await import('./generate-tests.mjs');

const require = createRequire(import.meta.url);
// promptfoo 的 exports 不暴露 package.json —— 从主入口反推同目录的 CLI
const entrypoint = join(dirname(require.resolve('promptfoo')), 'entrypoint.js');
const config = join(here, 'promptfooconfig.yaml');

const result = spawnSync(process.execPath, [entrypoint, 'eval', '-c', config, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);