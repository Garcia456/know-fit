/**
 * 闸② 的窗口 —— 把片段切成带编号的连续小段，模型只指起点、不抄原文。
 *
 * 转写稿没有标点，让模型「数 40–60 字」它数不准：实测抄 135–304 字，
 * 或者用省略号把两段拼起来（那就不是连续子串了）。
 * 让模型选「起点 + 终点」也不行：它会一路选到片段末尾（实测 to 几乎总是最后一窗）。
 * 所以终点不收：模型只给 from_window，长度由服务端固定为最多 3 个窗口。
 */

/**
 * 窗口做小（30–40 字），从起点起取 3 个 —— 3 × 40 刚好不超过 GATE_QUOTE_MAX（120）。
 */
export const GATE_WINDOW_TARGET = 30;
export const GATE_WINDOW_MAX = 40;
export const GATE_MAX_WINDOWS = 3;

/** 太短的尾窗并进前一个 —— 否则单独选中也过不了闸（12 字下限） */
const MIN_WINDOW = 12;

export interface GateWindow {
  index: number;
  /** 在 `chunk_text` 里的起止偏移 */
  start: number;
  end: number;
  text: string;
}

interface SegmentLike {
  start_ts: number;
  end_ts: number;
  text: string;
}

/** 按 ASR 段边界切；段拼不回原文就退回按字切 */
export function buildGateWindows(input: {
  chunk_text: string;
  start_ts: number;
  end_ts: number;
  segments?: SegmentLike[] | null;
}): GateWindow[] {
  const { chunk_text: text, start_ts, end_ts, segments } = input;
  if (text.length === 0) return [];

  if (segments && segments.length > 0) {
    const picked = segments.filter((s) => s.start_ts >= start_ts - 0.001 && s.end_ts <= end_ts + 0.001);
    if (picked.length > 0 && picked.map((s) => s.text.trim()).join('') === text) {
      return toWindows(text, fromSegments(picked));
    }
  }
  return toWindows(text, fromChars(text.length));
}

function fromSegments(segments: SegmentLike[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let cursor = 0;
  let start = 0;
  for (const seg of segments) {
    const len = seg.text.trim().length;
    if (len === 0) continue;
    if (cursor > start && cursor - start + len > GATE_WINDOW_MAX) {
      close(out, start, cursor);
      start = cursor;
    }
    cursor += len;
    if (cursor - start >= GATE_WINDOW_TARGET) {
      close(out, start, cursor);
      start = cursor;
    }
  }
  if (cursor > start) close(out, start, cursor);
  return out;
}

function fromChars(length: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let start = 0; start < length; start += GATE_WINDOW_TARGET) {
    close(out, start, Math.min(start + GATE_WINDOW_TARGET, length));
  }
  return out;
}

function close(out: { start: number; end: number }[], start: number, end: number): void {
  const last = out[out.length - 1];
  if (last && end - start < MIN_WINDOW) {
    last.end = end;
    return;
  }
  out.push({ start, end });
}

function toWindows(text: string, ranges: { start: number; end: number }[]): GateWindow[] {
  return ranges.map((r, index) => ({
    index,
    start: r.start,
    end: r.end,
    text: text.slice(r.start, r.end),
  }));
}

/** 从 from 起取最多 3 个窗口（到片段末尾就少取）；编号不合法返回 null */
export function windowSpan(
  windows: GateWindow[],
  from: number,
): { from_index: number; to_index: number; start: number; end: number; text: string } | null {
  if (!Number.isInteger(from) || from < 0 || from >= windows.length) return null;
  const to = Math.min(from + GATE_MAX_WINDOWS - 1, windows.length - 1);
  const picked = windows.slice(from, to + 1);
  return {
    from_index: from,
    to_index: to,
    start: picked[0]!.start,
    end: picked[picked.length - 1]!.end,
    text: picked.map((w) => w.text).join(''),
  };
}