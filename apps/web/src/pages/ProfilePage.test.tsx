import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../api/types';
import { ProfilePage } from './ProfilePage';

const emptyProfile: Profile = {
  height_cm: null,
  weight_kg: null,
  weight_date: null,
  goal: null,
  training_frequency: null,
  training_years: null,
  training_months: null,
  updated_at: '2026-10-26T00:00:00.000Z',
};

function stubFetch(put: { ok: boolean; body: unknown }) {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      return Promise.resolve({ ok: put.ok, status: put.ok ? 200 : 500, json: async () => put.body });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => emptyProfile });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('个人信息页', () => {
  it('改完自动保存，并以回读值为准', async () => {
    const fetchMock = stubFetch({
      ok: true,
      body: { ...emptyProfile, height_cm: 180, weight_kg: 75, goal: '增肌' },
    });
    render(<ProfilePage />);

    const height = (await screen.findByLabelText('身高（cm）')) as HTMLInputElement;
    fireEvent.change(height, { target: { value: '180' } });
    fireEvent.change(screen.getByLabelText('体重（kg）'), { target: { value: '75' } });
    fireEvent.click(screen.getByLabelText('目标'));
    fireEvent.click(await screen.findByRole('option', { name: '增肌' }));

    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/profile',
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({
              height_cm: 180,
              weight_kg: 75,
              goal: '增肌',
              training_frequency: null,
              training_years: null,
              training_months: null,
            }),
          }),
        ),
      { timeout: 3000 },
    );
    expect(await screen.findByText('已自动保存')).toBeDefined();
    expect(height.value).toBe('180');
  });

  it('自动保存失败时不清空输入、不显示已保存', async () => {
    stubFetch({ ok: false, body: { error: '写库失败' } });
    render(<ProfilePage />);

    const weight = (await screen.findByLabelText('体重（kg）')) as HTMLInputElement;
    fireEvent.change(weight, { target: { value: '75' } });

    expect(await screen.findByText('写库失败', {}, { timeout: 3000 })).toBeDefined();
    expect(weight.value).toBe('75');
    expect(screen.queryByText('已自动保存')).toBeNull();
  });

  it('越界值本地拦下，不发请求', async () => {
    const fetchMock = stubFetch({ ok: true, body: emptyProfile });
    render(<ProfilePage />);

    const height = await screen.findByLabelText('身高（cm）');
    fireEvent.change(height, { target: { value: '99' } });
    fireEvent.blur(height);

    expect(await screen.findByText(/身高需在 100–250 之间/)).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/profile',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('未实现的项画行、标未开放、不可点', async () => {
    stubFetch({ ok: true, body: emptyProfile });
    render(<ProfilePage />);

    for (const name of [
      '自动换算磅（未开放）',
      '导出我的数据（未开放）',
      '删除我的数据（未开放）',
    ]) {
      const row = (await screen.findByRole('button', { name })) as HTMLButtonElement;
      expect(row.disabled).toBe(true);
      expect(row.textContent).toContain('未开放');
    }
  });

  it('体重保存后显示日期', async () => {
    stubFetch({
      ok: true,
      body: { ...emptyProfile, weight_kg: 75, weight_date: '2026-10-26' },
    });
    render(<ProfilePage />);

    fireEvent.change(await screen.findByLabelText('体重（kg）'), { target: { value: '75' } });

    expect(await screen.findByText('已自动保存', {}, { timeout: 3000 })).toBeDefined();
    expect(screen.getByText('· 10/26')).toBeDefined();
  });

  it('目标有「增肌+减脂」；选项显示在居中卡片，卡片外背景加模糊类', async () => {
    stubFetch({ ok: true, body: emptyProfile });
    render(<ProfilePage />);

    fireEvent.click(await screen.findByLabelText('目标'));
    expect(await screen.findByRole('option', { name: '增肌+减脂' })).toBeDefined();
    const layer = document.querySelector('.sheet-layer');
    expect(layer?.parentElement).toBe(document.body);
    expect(document.body.classList.contains('sheet-open')).toBe(true);
    expect(document.querySelector('.sheet-mask')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(document.body.classList.contains('sheet-open')).toBe(false));
  });

  it('训练年限用年 + 月滚轮，选完自动提交年月', async () => {
    const fetchMock = stubFetch({ ok: true, body: { ...emptyProfile, training_years: 2, training_months: 3 } });
    render(<ProfilePage />);

    fireEvent.click(await screen.findByLabelText('训练年限'));
    fireEvent.click(await screen.findByRole('option', { name: '2 年' }));
    fireEvent.click(screen.getByRole('option', { name: '3 个月' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(screen.getByText('2 年 3 个月')).toBeDefined();

    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/profile',
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({
              height_cm: null,
              weight_kg: null,
              goal: null,
              training_frequency: null,
              training_years: 2,
              training_months: 3,
            }),
          }),
        ),
      { timeout: 3000 },
    );
  });

  it('训练频率可编辑，选完自动保存', async () => {
    const fetchMock = stubFetch({
      ok: true,
      body: { ...emptyProfile, training_frequency: '五分化' },
    });
    render(<ProfilePage />);

    fireEvent.click(await screen.findByLabelText('训练频率'));
    fireEvent.click(await screen.findByRole('option', { name: '五分化' }));

    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/profile',
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({
              height_cm: null,
              weight_kg: null,
              goal: null,
              training_frequency: '五分化',
              training_years: null,
              training_months: null,
            }),
          }),
        ),
      { timeout: 3000 },
    );
    expect(await screen.findByText('五分化')).toBeDefined();
  });

  it('选「不足 3 个月」不再出现边界说明', async () => {
    stubFetch({ ok: true, body: emptyProfile });
    render(<ProfilePage />);

    fireEvent.click(await screen.findByLabelText('训练年限'));
    fireEvent.click(await screen.findByRole('option', { name: '2 个月' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(screen.queryByText(/只给通用建议，不出基于训练数据的评估/)).toBeNull();
  });

  it('打开训练年限不调用 scrollIntoView（不把整页带跑）', async () => {
    stubFetch({ ok: true, body: emptyProfile });
    render(<ProfilePage />);

    const spy = vi.spyOn(Element.prototype, 'scrollIntoView');
    fireEvent.click(await screen.findByLabelText('训练年限'));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('档案读失败时表单还在，给重试且不自动写库', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<ProfilePage />);

    expect((await screen.findAllByText(/档案没读出来/)).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('身高（cm）')).toBeDefined();
    expect(screen.getByLabelText('目标')).toBeDefined();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/profile',
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});