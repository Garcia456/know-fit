import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { toDateKey } from '../lib/calendar';
import { BackfillPromptView } from './BackfillPrompt';

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateKey(d);
}

describe('BackfillPromptView', () => {
  it('gap：问休息还是练了没记，三个动作', () => {
    const onAction = vi.fn();
    render(
      <BackfillPromptView
        prompt={{
          nudge_id: 'n1',
          pending_id: 'p1',
          target_date: '2026-10-20',
          split_label: null,
          source: 'gap',
          message_code: 'gap',
        }}
        onAction={onAction}
      />,
    );

    expect(screen.getByText('10 月 20 日没有训练记录。是休息，还是练了没记？')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '练了没记' }));
    expect(onAction).toHaveBeenCalledWith('补记');
  });

  it('mentioned：带部位与日期；补记按钮用相对日期', () => {
    const onAction = vi.fn();
    render(
      <BackfillPromptView
        prompt={{
          nudge_id: 'n2',
          pending_id: 'p2',
          target_date: yesterdayKey(),
          split_label: '胸',
          source: 'mentioned',
          message_code: 'mentioned',
        }}
        onAction={onAction}
      />,
    );

    expect(screen.getByText('你昨天提到练了胸，但昨天没有记录。要补上吗？')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '补记昨天' }));
    expect(onAction).toHaveBeenCalledWith('补记');
    fireEvent.click(screen.getByRole('button', { name: '这天休息' }));
    expect(onAction).toHaveBeenCalledWith('休息');
  });
});
