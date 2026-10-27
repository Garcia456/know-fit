import { describe, expect, it } from 'vitest';
import { decideSwipe } from './swipe';

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
});