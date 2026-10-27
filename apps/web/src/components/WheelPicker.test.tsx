import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { WheelPicker } from './WheelPicker';

const OPTIONS = Array.from({ length: 8 }, (_, i) => ({
  value: String(i),
  label: `${i} 年`,
}));

function Harness() {
  const [value, setValue] = useState('0');
  return (
    <>
      <WheelPicker
        columns={[{ key: 'n', label: '年', options: OPTIONS }]}
        values={{ n: value }}
        onChange={(_, next) => setValue(next)}
      />
      <output aria-label="当前值">{value}</output>
    </>
  );
}

afterEach(cleanup);

describe('滚轮', () => {
  it('滚到哪一格就选中哪一格', async () => {
    render(<Harness />);
    const col = screen.getByRole('listbox', { name: '年' });

    col.scrollTop = 44 * 3;
    fireEvent.scroll(col);

    await waitFor(() => expect(screen.getByLabelText('当前值').textContent).toBe('3'));
    expect(screen.getByRole('option', { name: '3 年' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('点选仍然有效', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('option', { name: '5 年' }));
    expect(screen.getByLabelText('当前值').textContent).toBe('5');
  });
});