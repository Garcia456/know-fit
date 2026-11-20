import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { WeightPoint } from '../api/types';
import { WeightChart } from './WeightChart';

function axisLabels(points: WeightPoint[]): (string | null)[] {
  const { container } = render(<WeightChart points={points} />);
  return Array.from(container.querySelectorAll('.axis span')).map((el) => el.textContent);
}

afterEach(cleanup);

describe('WeightChart', () => {
  it('两个点时只在两端标日期，不重复中间刻度', () => {
    const labels = axisLabels([
      { date: '2026-11-18', weight_kg: 80 },
      { date: '2026-11-19', weight_kg: 79.6 },
    ]);
    expect(labels).toEqual(['11/18', '11/19']);
  });

  it('三个点及以上保留首 / 中 / 尾三个刻度', () => {
    const labels = axisLabels([
      { date: '2026-11-16', weight_kg: 80.4 },
      { date: '2026-11-17', weight_kg: 80.1 },
      { date: '2026-11-18', weight_kg: 80 },
      { date: '2026-11-19', weight_kg: 79.6 },
    ]);
    expect(labels).toEqual(['11/16', '11/18', '11/19']);
  });
});
