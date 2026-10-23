import { describe, expect, it } from 'vitest';
import { matchExerciseTags } from './exerciseTags.js';

describe('matchExerciseTags', () => {
  it('长名优先：上斜哑铃卧推不会被拆成哑铃卧推', () => {
    const tags = matchExerciseTags('今天重点讲上斜哑铃卧推的手肘角度。');
    expect(tags).toContain('上斜哑铃推胸');
    expect(tags).not.toContain('哑铃卧推');
    expect(tags).not.toContain('杠铃卧推');
  });

  it('一句话里多个动作都抽得到', () => {
    const tags = matchExerciseTags('先做杠铃卧推，再做罗马尼亚硬拉。');
    expect(tags).toContain('杠铃卧推');
    expect(tags).toContain('罗马尼亚硬拉');
  });

  it('guard 生效：罗马尼亚硬拉不额外算成硬拉', () => {
    const tags = matchExerciseTags('罗马尼亚硬拉');
    expect(tags).toEqual(['罗马尼亚硬拉']);
  });

  it('guard 生效：前蹲不额外算成深蹲', () => {
    const tags = matchExerciseTags('先做前蹲激活一下');
    expect(tags).not.toContain('杠铃深蹲');
  });

  it('别名能命中（RDL → 罗马尼亚硬拉）', () => {
    expect(matchExerciseTags('RDL 是练后链的好动作')).toEqual(['罗马尼亚硬拉']);
  });

  it('表外动作不硬凑', () => {
    expect(matchExerciseTags('今天天气不错，随便聊聊')).toEqual([]);
    expect(matchExerciseTags('   ')).toEqual([]);
  });

  it('同一动作重复出现只记一次', () => {
    expect(matchExerciseTags('卧推，卧推，还是卧推')).toEqual(['杠铃卧推']);
  });
});