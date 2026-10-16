import { TranscriptSchema, EmptyTranscriptError, type Transcript, type TranscriptSegment } from '../kb/types.js';
import { correctTranscript } from './termMap.js';

/**
 * ASR 产出的解析与归一。
 *
 * 归一四件事，每一件都对应一种真实会遇到的脏数据：
 *   1. **丢掉空段** —— 模型常在停顿处吐 `text: ''` 的段，留着它会把
 *      「转写分了几段」这个数字撑大，也会让 dev-004b 切出空切片；
 *   2. **按起点排序** —— 有些实现的分段不是有序的，切片前必须有序；
 *   3. **起点不能晚于终点** —— 这种段是坏的，直接抛，**别往下游传**；
 *   4. **同音纠错** —— 模型听错的健身术语按确定性表改回（见 `termMap.ts`）。
 *
 * 🔴 另外一条硬判据：归一后**一段不剩就是失败**。
 *    「听不出任何内容」最常见的两个原因是取错音轨（转成了背景音乐）和模型没加载起来 ——
 *    两者都会安静地产出一条空知识源，而那正是最坏的结果。
 *
 * 🔴 纠错放在这里而不是各实现里：**替身与真实实现共用这一段**，
 *    谁都不会漏过它（两条转写路径都最终走到 `normalizeTranscript`）。
 */

/** ASR 工具吐出来的一段 —— 字段名按 whisper 的习惯来 */
interface RawSegment {
  start?: unknown;
  end?: unknown;
  text?: unknown;
  confidence?: unknown;
}

interface RawOutput {
  language?: unknown;
  segments?: unknown;
}

function toSegment(raw: RawSegment, index: number): TranscriptSegment {
  const start = raw.start;
  const end = raw.end;
  if (typeof start !== 'number' || typeof end !== 'number') {
    throw new Error(`第 ${index + 1} 段没有可用的时间戳：start=${String(start)} end=${String(end)}`);
  }
  if (start > end) {
    throw new Error(`第 ${index + 1} 段的时间戳是反的：start=${start} > end=${end}`);
  }
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : null;
  return {
    start_ts: start,
    end_ts: end,
    text: typeof raw.text === 'string' ? raw.text : '',
    // 越界的把握度是模型的锅，如实记下来但截到合法区间 —— 别让它把整条记录带崩
    confidence: confidence === null ? null : Math.min(1, Math.max(0, confidence)),
  };
}

export function normalizeTranscript(input: Transcript): Transcript {
  const segments = input.segments
    .filter((s) => s.text.trim().length > 0)
    .sort((a, b) => a.start_ts - b.start_ts);

  if (segments.length === 0) {
    throw new EmptyTranscriptError(
      '转写归一后一段不剩 —— 要么取错了音轨（转成了背景音乐），要么模型没正常工作。' +
        '这条不能入库：空知识源比没有更糟。',
    );
  }
  return correctTranscript({ language: input.language, segments });
}

/** 解析 ASR 工具的 stdout。失败信息里带上原文开头 —— 否则这类错无法从现场定位 */
export function parseAsrOutput(stdout: string): Transcript {
  let raw: RawOutput;
  try {
    raw = JSON.parse(stdout) as RawOutput;
  } catch (e) {
    const head = stdout.trim().slice(0, 200);
    throw new Error(`ASR 输出不是 JSON（${(e as Error).message}）。原文开头：${head || '（空）'}`, {
      cause: e,
    });
  }

  if (!Array.isArray(raw.segments)) {
    throw new Error('ASR 输出里没有 segments 数组 —— 与 tools/asr_transcribe.py 的约定不符');
  }

  const transcript = TranscriptSchema.parse({
    language: typeof raw.language === 'string' ? raw.language : null,
    segments: (raw.segments as RawSegment[]).map(toSegment),
  });
  return normalizeTranscript(transcript);
}