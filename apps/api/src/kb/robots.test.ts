import { describe, expect, it } from 'vitest';
import { isDisallowedAll } from './robots.js';

/**
 * robots.txt 的最小判定 —— 纯函数。
 *
 * 它只回答一件事：**是不是全站禁止**。答不了「这条路径禁不禁」——
 * 那需要一个完整的匹配引擎，而完整引擎会给人「合规已经算过了」的错觉（见 robots.ts 头注）。
 */

describe('isDisallowedAll：只认全禁那一种形态', () => {
  it('User-agent: * 段里 Disallow: / → 全禁', () => {
    expect(isDisallowedAll('User-agent: *\nDisallow: /')).toBe(true);
  });

  it('带注释与空行照样认得出来', () => {
    const txt = ['# 站点的 robots', '', 'User-agent: *   # 所有爬虫', 'Disallow: /  # 全禁', ''].join(
      '\n',
    );
    expect(isDisallowedAll(txt)).toBe(true);
  });

  it('显式允许（Disallow 为空）→ 不是全禁', () => {
    expect(isDisallowedAll('User-agent: *\nDisallow:')).toBe(false);
  });

  it('只禁某几条路径 → 不是全禁', () => {
    expect(isDisallowedAll('User-agent: *\nDisallow: /admin\nDisallow: /api')).toBe(false);
  });

  it('只对特定爬虫全禁、不对 * 全禁 → 不算全站禁止（判定只认 *）', () => {
    expect(isDisallowedAll('User-agent: BadBot\nDisallow: /')).toBe(false);
  });

  it('* 段结束后换到别的 UA，后面那条 Disallow 不继承', () => {
    const txt = ['User-agent: *', 'Disallow: /admin', 'User-agent: BadBot', 'Disallow: /'].join('\n');
    expect(isDisallowedAll(txt)).toBe(false);
  });

  it('空文件 / 全是注释 → 不是全禁（没有结论，不是禁止）', () => {
    expect(isDisallowedAll('')).toBe(false);
    expect(isDisallowedAll('# 什么都没有\n')).toBe(false);
  });
});