import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Tip } from './Tip';

afterEach(cleanup);

function mount(props: { align?: 'start' | 'end'; hidden?: boolean } = {}) {
  return render(
    <Tip text="删除动作" {...props}>
      <button type="button">×</button>
    </Tip>,
  );
}

/** 包住按钮的那一层 */
function wrap() {
  return screen.getByRole('button').parentElement as HTMLElement;
}

describe('Tip', () => {
  it('鼠标悬停浮出白底提示，移开就收起', () => {
    mount();
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.pointerEnter(wrap(), { pointerType: 'mouse' });
    expect(screen.getByRole('tooltip').textContent).toBe('删除动作');

    fireEvent.pointerLeave(wrap());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('触屏悬停不弹提示', () => {
    mount();
    fireEvent.pointerEnter(wrap(), { pointerType: 'touch' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('键盘聚焦也能看到，贴着右边缘时改成右对齐', () => {
    mount({ align: 'end' });
    fireEvent.focusIn(screen.getByRole('button'));
    expect(screen.getByRole('tooltip').className).toBe('tip tip--end');
  });

  it('外部要求收起时不显示（菜单已经盖住）', () => {
    mount({ hidden: true });
    fireEvent.pointerEnter(wrap(), { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
