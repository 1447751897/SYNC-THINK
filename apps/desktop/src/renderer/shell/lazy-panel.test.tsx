/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazyPanel } from './lazy-panel.js';
import { KeepAliveLayer } from './KeepAliveLayer.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('deferred shell panels', () => {
  it('offers an app reload for a stale module without discarding drafts automatically', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Panel = lazyPanel(async () => {
      throw new TypeError('Failed to fetch dynamically imported module: file:///old-chunk.js');
    }, '浏览器');
    render(
      <>
        <input aria-label="主窗口草稿" defaultValue="保留" />
        <Panel />
      </>,
    );
    expect(await screen.findByRole('button', { name: '重新加载应用' })).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('保留');
    expect(screen.queryByText(/old-chunk/)).toBeNull();
  });

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


it('keeps sidebar loading and retry visible without replacing the active right panel', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let reject!: (error: Error) => void;
  const load = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }))
    .mockResolvedValueOnce({ default: () => <div>联系人已加载</div> });
  render(<div data-testid="sidebar-placeholder-host" />);
  const host = screen.getByTestId('sidebar-placeholder-host');
  const Panel = lazyPanel(load, '智能体工作区', undefined, (_props: { sidebarHost: HTMLElement }) => host);
  render(<><input aria-label="右侧草稿" defaultValue="保持当前会话" /><div hidden><Panel sidebarHost={host} /></div></>);
  expect(host.contains(screen.getByRole('status'))).toBe(true);
  await act(async () => reject(new Error('load failed')));
  expect(host.contains(await screen.findByRole('alert'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
  await screen.findByText('联系人已加载');
  expect((screen.getByRole('textbox', { name: '右侧草稿' }) as HTMLInputElement).value).toBe('保持当前会话');
  expect(host.childElementCount).toBe(0);
});


it.each(['loading', 'failed'] as const)('clears a %s sidebar placeholder when its parent is inactive', async (phase) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let fail!: (error: Error) => void;
  const host = document.createElement('div');
  document.body.append(host);
  const load = vi.fn(() => new Promise<{ default: () => JSX.Element }>((_resolve, reject) => { fail = reject; }));
  const Panel = lazyPanel(load, '智能体工作区', undefined, (_props: { sidebarHost: HTMLElement }) => host);
  const tree = (active: boolean) => <KeepAliveLayer active={active}><Panel sidebarHost={host} /></KeepAliveLayer>;
  const view = render(tree(true));
  try {
    expect(host.childElementCount).toBe(1);
    if (phase === 'failed') await act(async () => fail(new Error('module failed')));
    view.rerender(tree(false));
    expect(host.childElementCount).toBe(0);
    view.rerender(tree(true));
    expect(host.childElementCount).toBe(1);
    expect(load).toHaveBeenCalledOnce();
  } finally { view.unmount(); host.remove(); }
});
