#!/usr/bin/env node
/**
 * 跑「单次问询成本」评测 —— 先读根 `.env`，再调本地 promptfoo CLI。
 *
 * 用法：
 *   pnpm turn:cost:eval            跑一遍（结果进 promptfoo 本地库）
 *   pnpm turn:cost:eval view       跑完直接用浏览器打开 view
 *   pnpm turn:cost:eval --no-cache 强制重跑（默认 promptfoo 会对同 (prompt, provider) 复用缓存）
 *
 * 🔴 不进 CI / check-dev.sh：它要真实模型、真库、真 key。
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

const require = createRequire(import.meta.url);
// promptfoo 的 exports 不暴露 package.json —— 从主入口反推同目录的 CLI
const entrypoint = join(dirname(require.resolve('promptfoo')), 'entrypoint.js');
const config = join(here, 'promptfooconfig.yaml');

const args = process.argv.slice(2);
const wantView = args[0] === 'view';
const passthrough = wantView ? args.slice(1) : args;

const run = (argv) =>
  spawnSync(process.execPath, [entrypoint, ...argv], { stdio: 'inherit', env: process.env });

const result = run(['eval', '-c', config, ...passthrough]);
if (!wantView) process.exit(result.status ?? 1);

// 断言失败时也要能看 —— 失败恰恰是最需要 view 的时候；退出码仍按 eval 的算
// `view` 不收 `-c`（它按目录找本地结果库），只认端口等少量参数 —— 别把 config 传进去
run(['view', '-y']);
process.exit(result.status ?? 1);
