import { buildIndex, normalizeKey } from '../extraction/normalize.js';

/**
 * `exercise_tags` —— 从片文本里抽动作术语，**确定性代码，不让 LLM 抽**。
 *
 * 判据与别名归一相同：能锚在自有资产上的，就不让模型自由发挥。
 * 对 `seed/exercises.json` 的 63 条动作做术语匹配，命中记 `name_zh`。
 *
 * ⚠️ 只认表内动作 —— 口语说法（「推」是不是卧推？）盖不全。
 *    匹配率让真跑的数字说话，不在这里假装。
 */

let cached: ReturnType<typeof buildIndex> | null = null;

/** 别名的「撤销条件」窗口：命中词前的字里出现这些限定词就不算这个动作（窗口按最长限定词算） */
const GUARD_BASE_WINDOW = 3;

export function matchExerciseTags(text: string): string[] {
  const key = normalizeKey(text);
  if (!key) return [];

  const index = (cached ??= buildIndex());
  // 命中的字符抹成占位符，避免「上斜哑铃卧推」再被「哑铃卧推」算一遍
  const masked = key.split('');
  const tags: string[] = [];

  for (const entry of index.byLength) {
    if (entry.kind === 'ambiguous' || !entry.text) continue;
    const blockedOn = entry.kind === 'resolvable' || entry.kind === 'alias' ? entry.blockedOn : [];
    const window = Math.max(GUARD_BASE_WINDOW, ...blockedOn.map((b) => b.length));

    let from = 0;
    for (;;) {
      const at = masked.join('').indexOf(entry.text, from);
      if (at === -1) break;
      const before = masked.slice(Math.max(0, at - window), at).join('');
      if (!blockedOn.some((b) => before.includes(b))) {
        tags.push(entry.nameZh);
        for (let i = at; i < at + entry.text.length; i++) masked[i] = '□';
      }
      from = at + entry.text.length;
    }
  }

  return [...new Set(tags)];
}