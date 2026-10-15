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
  device?: string;
  computeType?: string;
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
  // 用 `||` 而不是 `??`：.env 里留空的可选值读出来是**空串**（不是 undefined），
  // `??` 会把它当成有效值传下去（`--compute-type ''` 是个真的故障，不是回落到默认）。
  const python = opts.python || process.env.ASR_PYTHON || 'python';
  const script = opts.script || process.env.ASR_SCRIPT || ASR_SCRIPT_PATH;
  const model = opts.model || process.env.ASR_MODEL || 'small';
  const language = opts.language || process.env.ASR_LANGUAGE || 'zh';
  // 默认仍是不折腾显卡的档；本机有卡就设 ASR_DEVICE=cuda（快一个量级，见 tools 里的注释）
  const device = opts.device || process.env.ASR_DEVICE || 'cpu';
  const computeType =
    opts.computeType ||
    process.env.ASR_COMPUTE_TYPE ||
    (device === 'cuda' ? 'float16' : 'int8');

  return {
    async transcribe(audioPath: string) {
      const args = [
        script,
        audioPath,
        '--model',
        model,
        '--language',
        language,
        '--device',
        device,
        '--compute-type',
        computeType,
      ];

      const { stdout, stderr, code } = await new Promise<{
        stdout: string;
        stderr: string;
        code: number | null;
      }>((resolve, reject) => {
        const child = spawn(python, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        // 攒 Buffer、最后一次性解码 —— 逐块 toString 会在块边界切开多字节汉字（长音频必踩）
        const outChunks: Buffer[] = [];
        const errChunks: Buffer[] = [];
        child.stdout.on('data', (c: Buffer) => outChunks.push(c));
        child.stderr.on('data', (c: Buffer) => errChunks.push(c));
        child.on('error', (e) =>
          reject(
            new Error(
              `起不了 ASR 进程（${python}）：${e.message} —— 本机装好 Python 与 faster-whisper 了吗？`,
              { cause: e },
            ),
          ),
        );
        child.on('close', (c) =>
          resolve({
            stdout: Buffer.concat(outChunks).toString('utf8'),
            stderr: Buffer.concat(errChunks).toString('utf8'),
            code: c,
          }),
        );
      });

      if (code !== 0) {
        throw new Error(`ASR 进程退出码 ${code}：${stderr.trim().slice(0, 500) || '（无 stderr）'}`);
      }
      // 模型会把进度写到 stderr —— 别让它混进 stdout 的 JSON
      return normalizeTranscript(parseAsrOutput(stdout));
    },
  };
}