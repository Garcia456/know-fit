import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { REGION_IDS } from '../lib/bodyMap';
import { BodyHeatMap } from './BodyHeatMap';

afterEach(cleanup);

describe('BodyHeatMap', () => {
  it('data-region 覆盖除下背外的 19 区，没有多出来的 id', () => {
    const { container } = render(<BodyHeatMap byMuscle={{}} />);
    const groups = [...container.querySelectorAll('[data-region]')];
    const ids = new Set(groups.map((g) => g.getAttribute('data-region')));
    expect(ids).toEqual(new Set(REGION_IDS.filter((r) => r !== 'lower_back')));
    // 前臂在正面与背面都有解剖区，按面各渲染一个 <g>，但仍是同一块项目肌群
    expect(groups.length).toBeGreaterThanOrEqual(19);
  });

  it('未映射的剪影路径不带上色分组', () => {
    const { container } = render(<BodyHeatMap byMuscle={{}} />);
    const silhouettes = [...container.querySelectorAll('.body-silhouette')];
    expect(silhouettes).toHaveLength(25);
    expect(silhouettes.every((p) => !p.hasAttribute('data-region'))).toBe(true);
  });

  it('股四头去掉内部分割线，臀大肌有量时臀中肌让位', () => {
    const { container } = render(<BodyHeatMap byMuscle={{ quads: 100, glutes: 50 }} />);
    expect(container.querySelector('[data-region="quads"]')?.getAttribute('class')).toContain(
      'body-region--merged',
    );
    expect(container.querySelector('[data-region="abductors"]')).toBeNull();
    expect(container.querySelectorAll('[data-region="glutes"] path')).toHaveLength(2);
  });

  it('按档位挂 heat-N，未练到的肌群不上色', () => {
    const { container } = render(<BodyHeatMap byMuscle={{ chest: 100, lats: 50 }} />);
    expect(container.querySelector('[data-region="chest"]')?.getAttribute('class')).toContain('heat-4');
    expect(container.querySelector('[data-region="lats"]')?.getAttribute('class')).toContain('heat-2');
    expect(container.querySelector('[data-region="biceps"]')?.getAttribute('class')).toContain('heat-0');
  });

  it('不显示图例与肌群清单', () => {
    render(<BodyHeatMap byMuscle={{ chest: 100 }} />);
    expect(screen.queryByLabelText('颜色图例')).toBeNull();
    expect(screen.queryByLabelText('肌群训练量清单')).toBeNull();
    expect(screen.queryByText('没练到')).toBeNull();
    expect(screen.queryByText('胸大肌')).toBeNull();
  });
});