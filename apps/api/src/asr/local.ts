import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTranscript, parseAsrOutput } from './parse.js';
import type { AsrClient } from '../kb/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 转写脚本 —— 薄薄一层 faster-whisper 包装，见 apps/api/tools/asr_transcribe.py */
export const ASR_SCRIPT_PATH = join(HERE, '..', '..', 'tools', 'asr_transcribe.py');

export interface LocalAsrOptions {
  python?: string;
  script?: string;
  model?: string;
  language?: string;
}

/**
 * 真实的本地 ASR —— 🔴 **只在作者本机跑，永不进 CI**。
 *
 * 形式是「spawn 一个 Python 进程」而不是「加载一个 Node 版模型」：
 * 中文可用的本地 ASR 生态在 Python 侧，本项目不为此重造。
 * 代价是这条链路**依赖作者机器上装好 faster-whisper** —— 这正是它不进 CI 的原因，
 * CI 里跑的是同接口的替身（asr/fake.ts）。
 */
export function createLocalAsrClient(opts: LocalAsrOptions = {}): AsrClient {
  const python = opts.python ?? process.env.ASR_PYTHON ?? 'python';
  const script = opts.script ?? process.env.ASR_SCRIPT ?? ASR_SCRIPT_PATH;
  const model = opts.model ?? process.env.ASR_MODEL ?? 'small';
  const language = opts.language ?? process.env.ASR_LANGUAGE ?? 'zh';

  return {
    async transcribe(audioPath: string) {
      const args = [script, audioPath, '--model', model, '--language', language];

      const { stdout, stderr, code } = await new Promise<{
        stdout: string;
        stderr: string;
        code: number | null;
      }>((resolve, reject) => {
        const child = spawn(python, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        child.stdout.on('data', (c: Buffer) => (out += c.toString()));
        child.stderr.on('data', (c: Buffer) => (err += c.toString()));
        child.on('error', (e) =>
          reject(
            new Error(
              `起不了 ASR 进程（${python}）：${e.message} —— 本机装好 Python 与 faster-whisper 了吗？`,
              { cause: e },
            ),
          ),
        );
        child.on('close', (c) => resolve({ stdout: out, stderr: err, code: c }));
      });

      if (code !== 0) {
        throw new Error(`ASR 进程退出码 ${code}：${stderr.trim().slice(0, 500) || '（无 stderr）'}`);
      }
      // 模型会把进度写到 stderr —— 别让它混进 stdout 的 JSON
      return normalizeTranscript(parseAsrOutput(stdout));
    },
  };
}