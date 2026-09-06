/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazyPanel } from './lazy-panel.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('deferred shell panels', () => {
  it('loads only on mount, forwards props, and preserves the mounted page on rerender', async () => {
    let finish!: (value: { default: (props: { name: string }) => JSX.Element }) => void;
    const load = vi.fn(
      () =>
        new Promise<{ default: (props: { name: string }) => JSX.Element }>((resolve) => {
          finish = resolve;
        }),
    );
    const Panel = lazyPanel(load, '设置');
    expect(load).not.toHaveBeenCalled();
    const view = render(<Panel name="初始" />);
    expect(screen.getByRole('status').textContent).toContain('正在加载设置');
    await act(async () =>
      finish({
        default: ({ name }) => (
          <label>
            {name}
            <input />
          </label>
        ),
      }),
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '未保存草稿' } });
    view.rerender(<Panel name="更新" />);
    expect(screen.getByText('更新')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('未保存草稿');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('contains a failed load and retries without reloading the surrounding shell', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('private file path'))
      .mockResolvedValueOnce({ default: () => <div>设置已加载</div> });
    const Panel = lazyPanel(load, '设置');
    render(
      <>
        <input aria-label="主窗口草稿" defaultValue="保留" />
        <Panel />
      </>,
    );
    expect((await screen.findByRole('alert')).textContent).toContain('设置加载失败');
    expect(screen.queryByText('private file path')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
    expect(await screen.findByText('设置已加载')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('保留');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
