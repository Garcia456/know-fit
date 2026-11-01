import { describe, expect, it } from 'vitest';
import { RESTRICTED_PLATFORMS, UNRESTRICTED_PLATFORMS, visiblePlatforms } from './platforms.js';

describe('平台可见性', () => {
  it('没有授权 = 空', () => {
    expect(visiblePlatforms([])).toEqual([]);
  });

  it('授权受限平台后可见', () => {
    expect(visiblePlatforms([...RESTRICTED_PLATFORMS])).toEqual([...RESTRICTED_PLATFORMS]);
  });

  it('重复授权去重', () => {
    expect(visiblePlatforms(['douyin', 'douyin'])).toEqual(['douyin']);
  });

  it('非受限平台始终可见', () => {
    // 当前清单为空，只断言函数把两边并起来
    expect(visiblePlatforms(['douyin'])).toEqual([...UNRESTRICTED_PLATFORMS, 'douyin']);
  });
});