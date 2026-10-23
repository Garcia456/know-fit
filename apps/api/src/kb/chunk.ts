import type { TranscriptSegment } from './types.js';

/**
 * 转写段 → 知识片。**纯函数**：不碰库、不调模型，可单独测。
 *
 * 源数据不是段落，是 whisper 的句级碎段（实测一条 836s 视频：526 段 / 8.0 字一段）。
 * 所以「观点边界」只能由规则造出来：
 *   ① 切点永远落在**段边界**（不切开一段 —— 切开会让时间戳失去意义）；
 *   ② 攒到下限后，优先在**句末**收片（次级边界）；到上限还没句末，就在段边界硬切；
 *   ③ 末尾低于下限的片并进上一片（避免「半句话」片）；
 *   ④ 相邻片之间留 10–15% 的重叠（防观点被切断在两片之间）。
 *
 * ⚠️ 默认值是经验推断，**没有实验支撑**，由检索命中率反向调参。
 */

export interface ChunkOptions {
  /** 下限（字）。低于它的片并进相邻片 */
  minChars: number;
  /** 上限（字）。到它还没遇到句末就在段边界切 */
  maxChars: number;
  /** 相邻片的重叠比例（按上一片字数算） */
  overlapRatio: number;
}

/** 默认参数，重叠取区间中值 */
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  minChars: 300,
  maxChars: 600,
  overlapRatio: 0.125,
};

export interface Chunk {
  /** 拼起来的段文本 */
  text: string;
  start_ts: number;
  end_ts: number;
  /** 起止段下标（含）—— 复核切点用，不落库 */
  first_segment: number;
  last_segment: number;
  /** 与上一片重叠的字数（第一片为 0） */
  overlap_chars: number;
  /** 切这一片时做过的调整，真跑时贴出来 */
  notes: string[];
}

interface Range {
  start: number;
  end: number;
  notes: string[];
}

const textOf = (s: TranscriptSegment): string => s.text.trim();

/** 句末标点 —— 次级边界只认这些，不认逗号（逗号处切等于把句子拦腰截断） */
export function endsSentence(text: string): boolean {
  return /[。！？!?；;…]$/.test(text.trim());
}

const charCount = (segs: TranscriptSegment[], start: number, end: number): number => {
  let n = 0;
  for (let i = start; i < end; i++) n += textOf(segs[i]!).length;
  return n;
};

/**
 * 从 `start` 往后收一片，返回**不含**的终点。
 * 停在三处之一：句末且已够下限 / 再收一段就超上限 / 到尾。
 */
function findEnd(segs: TranscriptSegment[], start: number, opts: ChunkOptions): { end: number; overLimit: boolean } {
  let chars = 0;
  for (let i = start; i < segs.length; i++) {
    const len = textOf(segs[i]!).length;
    // i > start：单段自身超上限时不能切它，只能让它独占一片（下面会记 note）
    if (i > start && chars + len > opts.maxChars) {
      return { end: i, overLimit: false };
    }
    chars += len;
    if (chars >= opts.minChars && endsSentence(textOf(segs[i]!))) return { end: i + 1, overLimit: false };
    if (chars >= opts.maxChars) return { end: i + 1, overLimit: chars > opts.maxChars };
  }
  return { end: segs.length, overLimit: false };
}

/** 下一片从哪里续上 —— 往回取整段凑够重叠，**不切开段** */
function nextStart(segs: TranscriptSegment[], start: number, end: number, opts: ChunkOptions): number {
  const target = charCount(segs, start, end) * opts.overlapRatio;
  let from = end;
  let acc = 0;
  while (from > start + 1) {
    const len = textOf(segs[from - 1]!).length;
    if (acc + len > target) break;
    acc += len;
    from--;
  }
  // 最后一段比重叠目标还长：取它一段作重叠（否则短段永远凑不出重叠）
  if (opts.overlapRatio > 0 && from === end && end - start > 1) from = end - 1;
  const next = Math.max(from, start + 1);
  return next >= end ? end : next;
}

export function chunkTranscript(
  segments: TranscriptSegment[],
  opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): Chunk[] {
  const segs = segments
    .map((s) => ({ ...s, text: textOf(s) }))
    .filter((s) => s.text.length > 0);
  if (segs.length === 0) return [];

  const ranges: Range[] = [];
  let start = 0;

  while (start < segs.length) {
    const { end, overLimit } = findEnd(segs, start, opts);
    if (end <= start) break; // 防呆：不允许零长度前进
    const notes: string[] = [];
    if (overLimit) notes.push('单段超长，独占一片（不切开一段）');
    ranges.push({ start, end, notes });
    start = nextStart(segs, start, end, opts);
  }

  // 末尾（或对半）低于下限的片并进相邻片 —— 在**段区间**上合并，不拼字符串，
  // 否则重叠段会被算两遍。
  for (let i = 0; i < ranges.length; ) {
    const r = ranges[i]!;
    if (charCount(segs, r.start, r.end) >= opts.minChars || ranges.length === 1) {
      i++;
      continue;
    }
    if (i > 0) {
      const prev = ranges[i - 1]!;
      prev.end = r.end;
      prev.notes.push('并入前一片（低于下限）');
      ranges.splice(i, 1);
      continue;
    }
    // 第一片太小 → 并进后一片
    const nextRange = ranges[1]!;
    nextRange.start = r.start;
    nextRange.notes.push('并入后一片（低于下限）');
    ranges.splice(0, 1);
  }

  return ranges.map((r, i) => {
    const text = segs
      .slice(r.start, r.end)
      .map((s) => s.text)
      .join('');
    const prev = i > 0 ? ranges[i - 1] : null;
    // 重叠 = 本片起点之前、上一片已经覆盖过的那一段
    const overlapTo = prev ? Math.min(prev.end, r.end) : 0;
    const overlap = prev && r.start < overlapTo ? charCount(segs, r.start, overlapTo) : 0;
    return {
      text,
      start_ts: segs[r.start]!.start_ts,
      end_ts: segs[r.end - 1]!.end_ts,
      first_segment: r.start,
      last_segment: r.end - 1,
      overlap_chars: overlap,
      notes: r.notes,
    };
  });
}