/**
 * robots.txt 的最小判定 —— 只回答一个问题：**是不是全站禁止**。
 *
 * 为什么不做完整的 robots 匹配引擎：留痕的价值在于「**检查过**」，
 * 而不是把一次站点评级判定当成合规结论。完整引擎会给人一种「合规已经算过了」的错觉，
 * 而真正的问题（抓取动作本身）它并不能解决。
 */

/** 命中 `User-agent: *` 那一段、且该段里有 `Disallow: /` 的全禁形态 */
export function isDisallowedAll(robotsTxt: string): boolean {
  let appliesToAll = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;

    const [rawKey, ...rest] = line.split(':');
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      appliesToAll = value === '*';
      continue;
    }
    if (appliesToAll && key === 'disallow' && value === '/') return true;
  }
  return false;
}