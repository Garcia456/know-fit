/**
 * `context_prefix` —— 片内指代在片外的补偿。
 *
 * 它不是博主说的话：模板里全是采集时拿到的元数据，尾句是上一片的原话。
 * 🔴 所以它**参与 embedding、绝不参与对外呈现** —— 对外引用只能来自 `text`。
 */

export interface PrefixInput {
  creator: string;
  title: string;
  topicDomain: string | null;
  start_ts: number;
  end_ts: number;
  /** 上一片的 `text`；第一片没有 */
  previousText?: string | undefined;
}

/** 秒 → `mm:ss`（超过一小时才带小时位） */
export function formatTimestamp(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 上一片的尾句 —— 没有句末标点就取末尾 30 字，保证前缀里有一段真语境 */
export function tailSentence(text: string, maxChars = 30): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const sentences = trimmed.match(/[^。！？!?；;…]+[。！？!?；;…]?/g) ?? [];
  const last = (sentences[sentences.length - 1] ?? trimmed).trim();
  if (last.length <= maxChars) return last;
  return last.slice(-maxChars);
}

export function buildContextPrefix(input: PrefixInput, maxTailChars = 30): string {
  const topic = input.topicDomain?.trim() || '未分类';
  const head = `[${input.creator} · ${input.title} · ${formatTimestamp(input.start_ts)}–${formatTimestamp(
    input.end_ts,
  )} · ${topic}]`;
  const tail = input.previousText ? tailSentence(input.previousText, maxTailChars) : '';
  return tail ? `${head} 前文：${tail}` : head;
}