import type { VolumeHook } from '../api/types';
import { formatDeltaPct, formatKg, formatSignedKg } from './format';

/** 判定句由展示层拼 —— 后端只给数，不让模型改写措辞 */
export function verdictSentence(hook: VolumeHook): string {
  const scope = hook.scope.split_label ?? '这次';
  const current = `${scope}容量 ${formatKg(hook.current)}`;
  if (hook.baseline === null || hook.delta_pct === null) {
    return `${current}，第一次记录这个部位，暂无对比`;
  }
  if (hook.delta_pct === 0) return `${current}，与上次持平`;
  return `${current}，比上次${hook.delta_pct > 0 ? '高' : '低'} ${formatDeltaPct(Math.abs(hook.delta_pct)).replace('+', '')}`;
}

/** 体重差值的短句 */
export function weightDeltaSentence(deltaKg: number): string {
  return `较首点 ${formatSignedKg(deltaKg)}`;
}