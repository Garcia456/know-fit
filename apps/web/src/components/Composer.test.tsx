import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';

afterEach(cleanup);

function Harness({ sending = false }: { sending?: boolean }) {
  const [value, setValue] = useState('');
  return <Composer value={value} onChange={setValue} onSend={vi.fn()} sending={sending} />;
}

describe('Composer', () => {
  it('多行换成小圆角矩形，单行仍是胶囊', () => {
    render(<Harness />);
    const input = screen.getByLabelText('训练、饮食或提问') as HTMLTextAreaElement;
    const pill = input.parentElement!;
    expect(pill.className).toBe('pill');

    // jsdom 量不到真实高度：直接给 scrollHeight 塞一个两行的高度
    Object.defineProperty(input, 'scrollHeight', { value: 44, configurable: true });
    fireEvent.change(input, { target: { value: '第一行\n第二行' } });
    expect(pill.className).toBe('pill pill--multi');
  });

  it('等待回复时发送键禁用且不转圈', () => {
    const { rerender } = render(
      <Composer value="今天练背" onChange={vi.fn()} onSend={vi.fn()} />,
    );
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    rerender(<Composer value="今天练背" onChange={vi.fn()} onSend={vi.fn()} sending />);
    const waiting = screen.getByRole('button', { name: '发送' }) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);
    expect(waiting.querySelector('.spin')).toBeNull();
  });

  it('空内容不能发', () => {
    render(<Composer value="   " onChange={vi.fn()} onSend={vi.fn()} />);
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
