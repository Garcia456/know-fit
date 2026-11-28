import { describe, expect, it } from 'vitest';
import { decideSwipe, isSubpage, pageIndexOf, swipeVelocity } from './swipe';

describe('decideSwipe', () => {
  it('短距离慢滑不换页', () => {
    expect(decideSwipe({ dx: 40, dy: 2, vx: 100 })).toBe(0);
  });

  it('长距离左滑到下一页，右滑到上一页', () => {
    expect(decideSwipe({ dx: -100, dy: 8, vx: 0 })).toBe(1);
    expect(decideSwipe({ dx: 100, dy: 8, vx: 0 })).toBe(-1);
  });

  it('纵向为主时不换页', () => {
    expect(decideSwipe({ dx: -90, dy: 120, vx: -400 })).toBe(0);
  });

  it('短距离快速甩也算', () => {
    expect(decideSwipe({ dx: -60, dy: 4, vx: -500 })).toBe(1);
  });

  it('很短的轻甩也能翻页 —— 不再要求拖满半个屏幕', () => {
    expect(decideSwipe({ dx: -30, dy: 3, vx: -600 })).toBe(1);
  });

  it('松手前往回拉，不按原来的方向翻页', () => {
    expect(decideSwipe({ dx: -70, dy: 2, vx: 450 })).toBe(0);
  });

  it('太短的距离即使快也不翻页', () => {
    expect(decideSwipe({ dx: -12, dy: 1, vx: -900 })).toBe(0);
  });

  it('拖到位置后停住再松手，不算轻甩', () => {
    expect(decideSwipe({ dx: -30, dy: 2, vx: 0 })).toBe(0);
  });
});

describe('swipeVelocity', () => {
  it('只认最近 120ms 的移动', () => {
    // 这两次移动发生在 400–500ms 前，松手时已经过期
    expect(swipeVelocity([{ x: 100, t: 0 }, { x: 60, t: 100 }], 500)).toBe(0);
    expect(swipeVelocity([{ x: 100, t: 400 }, { x: 60, t: 480 }], 500)).toBe(-500);
  });

  it('停住再松手速度为 0', () => {
    expect(swipeVelocity([{ x: 100, t: 0 }, { x: 20, t: 20 }], 500)).toBe(0);
  });

  it('单点采样没有速度', () => {
    expect(swipeVelocity([{ x: 100, t: 490 }], 500)).toBe(0);
  });
});

describe('pageIndexOf', () => {
  it('主路由按下标返回', () => {
    expect(pageIndexOf('/')).toBe(0);
    expect(pageIndexOf('/stats')).toBe(1);
    expect(pageIndexOf('/data')).toBe(2);
    expect(pageIndexOf('/profile')).toBe(3);
  });

  it('二级页归到所属主页，不返回 -1', () => {
    expect(pageIndexOf('/stats/hard-sets')).toBe(pageIndexOf('/stats'));
  });

  it('未知路由仍是 -1', () => {
    expect(pageIndexOf('/nowhere')).toBe(-1);
  });

  it('只有二级页禁用滑动手势', () => {
    expect(isSubpage('/stats/hard-sets')).toBe(true);
    expect(isSubpage('/stats')).toBe(false);
  });
});