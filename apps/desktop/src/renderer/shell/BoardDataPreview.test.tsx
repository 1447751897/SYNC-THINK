/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { boardDataHtml } from '@sync-think/shared';
import { HtmlSandbox, sanitizeHtmlDocument } from './HtmlSandbox.js';
import { HtmlFilePreview } from './HtmlFilePreview.js';
import {
  hasBoardDataMarkup,
  prepareBoardDataSource,
  isBoardDataPending,
} from '../visualization/data-html.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const data = boardDataHtml({ type: 'bar', title: '销量示例', data: [{ label: '甲', value: 18 }] });
describe('chat data preview integration', () => {
  it('preserves inert JSON and strips executable author scripts and event handlers', () => {
    const html = sanitizeHtmlDocument(
      data +
        '<script>window.authorScriptRan=true</script><button onclick="window.authorClick=true">按钮</button>',
    );
    expect(html).toContain('data-boardui=');
    expect(html).toContain('销量示例');
    expect(html).toContain('sync-think-board-data-runtime');
    expect(html).not.toContain('authorScriptRan');
    expect(html).not.toContain('authorClick');
  });
  it('uses a distinct interactive data preview and keeps plain HTML previews unchanged', async () => {
    const view = render(<HtmlSandbox code={data} />);
    let content = await screen.findByTestId('html-sandbox-content');
    expect(content.getAttribute('data-data-components')).toBe('true');
    expect(content.querySelector('iframe')?.getAttribute('sandbox')).toBe(
      'allow-scripts allow-downloads',
    );
    view.rerender(<HtmlSandbox code="<main>普通网页</main>" />);
    content = screen.getByTestId('html-sandbox-content');
    expect(content.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(content.querySelector('iframe')?.getAttribute('srcdoc')).not.toContain(
      'sync-think-board-data-runtime',
    );
  });
  it('uses the existing sandboxed guest in Electron instead of weakening the host CSP', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome/140 Electron/40');
    window.syncThink = window.syncThink || ({ runtime: {} } as never);
    render(<HtmlSandbox code={data} />);
    const guest = await screen.findByTestId('board-data-webview');
    expect(guest.getAttribute('partition')).toMatch(/^sync-think-visualization-/);
    expect(guest.getAttribute('webpreferences')).toContain('nodeIntegration=no');
    expect(guest.getAttribute('src')).toMatch(/^data:text\/html/);
    expect(screen.queryByTitle('数据预览')).toBeNull();
  });
  it('routes saved data HTML through the same component while retaining local file preview semantics for other HTML', async () => {
    const view = render(<HtmlFilePreview text={data} path="visualizations/sales.html" />);
    expect(await screen.findByTestId('html-sandbox-content')).toBeTruthy();
    view.rerender(<HtmlFilePreview text="<p>普通页面</p>" path="pages/index.html" />);
    expect(screen.getByTitle('网页预览 pages/index.html')).toBeTruthy();
  });
  it('opens portable data HTML with its local renderer and preserves ordinary authored source', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const view = render(<HtmlSandbox code={data} onOpenInBrowser={open} />);
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: '浏览器打开' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '浏览器打开' }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open.mock.calls[0][0]).toContain('sync-think-board-data-runtime');
    expect(open.mock.calls[0][0]).toContain("connect-src 'none'");
    view.rerender(<HtmlSandbox code="<p>自定义网页</p>" onOpenInBrowser={open} />);
    fireEvent.click(screen.getByRole('button', { name: '浏览器打开' }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(open.mock.calls[1][0]).toBe('<p>自定义网页</p>');
  });
  it('waits for complete streamed JSON instead of repeatedly navigating a guest', async () => {
    const partial = '<script type="application/json" data-boardui>{"version":1,"components":[';
    expect(isBoardDataPending(partial)).toBe(true);
    expect(isBoardDataPending(data)).toBe(false);
    expect(isBoardDataPending(partial + '</script>')).toBe(false);
    const view = render(<HtmlSandbox code={partial} />);
    expect(screen.getByTestId('html-data-pending')).toBeTruthy();
    expect(screen.getByRole('button', { name: '下载' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByTestId('board-data-webview')).toBeNull();
    view.rerender(<HtmlSandbox code={data} />);
    expect(screen.queryByTestId('html-data-pending')).toBeNull();
    expect(await screen.findByTestId('html-sandbox-content')).toBeTruthy();
  });
  it('ignores canceled and stale guest loads but surfaces a current document failure', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome/130 Electron/33');
    window.syncThink = window.syncThink || ({ runtime: {} } as never);
    const view = render(<HtmlSandbox code={data} />);
    let guest = await screen.findByTestId('board-data-webview');
    const oldSrc = guest.getAttribute('src');
    fireEvent(
      guest,
      Object.assign(new Event('did-fail-load'), {
        errorCode: -3,
        isMainFrame: true,
        validatedURL: oldSrc,
      }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    view.rerender(
      <HtmlSandbox
        code={boardDataHtml({ type: 'bar', title: '更新数据', data: [{ label: '甲', value: 19 }] })}
      />,
    );
    guest = screen.getByTestId('board-data-webview');
    fireEvent(
      guest,
      Object.assign(new Event('did-fail-load'), {
        errorCode: -2,
        isMainFrame: true,
        validatedURL: oldSrc,
      }),
    );
    fireEvent(
      guest,
      Object.assign(new Event('did-fail-load'), {
        errorCode: -2,
        isMainFrame: false,
        validatedURL: guest.getAttribute('src'),
      }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent(
      guest,
      Object.assign(new Event('did-fail-load'), {
        errorCode: -2,
        isMainFrame: true,
        validatedURL: guest.getAttribute('src'),
      }),
    );
    expect(screen.getByRole('alert').textContent).toContain('数据预览加载失败');
  });
  it('recognizes only real data markers and converts JSON to escaped data attributes', () => {
    expect(hasBoardDataMarkup('<div data-boardui-theme="x"></div>')).toBe(false);
    expect(hasBoardDataMarkup(data)).toBe(true);
    const html = prepareBoardDataSource(data);
    expect(html).not.toContain('type="application/json"');
    expect(
      new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelector('[data-boardui]')
        ?.getAttribute('data-boardui'),
    ).toContain('销量示例');
  });
});

describe('split data chat surfaces', () => {
  const multi = boardDataHtml({
    version: 1,
    title: '概览',
    source: '用户提供的示例',
    components: [
      { type: 'stats', title: '指标', items: [{ label: '浏览', value: 12 }] },
      { type: 'line', title: '趋势', data: [{ label: '一', value: 12 }] },
      {
        type: 'table',
        title: '明细',
        columns: [{ key: 'name', label: '名称' }],
        rows: [{ name: 'A' }],
      },
    ],
  });
  it('shows independent data surfaces with metadata once, retaining source/collapse controls', async () => {
    const view = render(<HtmlSandbox code={multi} />);
    const blocks = await screen.findAllByTestId('board-data-block');
    expect(blocks).toHaveLength(3);
    expect(screen.getAllByText('概览')).toHaveLength(1);
    expect(screen.getAllByText('用户提供的示例')).toHaveLength(1);
    expect(view.container.querySelector('.shell-html--data')).toBeTruthy();
    for (const block of blocks) {
      const html = block.querySelector('iframe')!.getAttribute('srcdoc')!;
      const marker = new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelector('[data-boardui]')!;
      expect(JSON.parse(marker.getAttribute('data-boardui')!).components).toHaveLength(1);
    }
    fireEvent.click(screen.getByRole('button', { name: '源码' }));
    expect(screen.queryByTestId('board-data-block')).toBeNull();
    expect(view.container.querySelector('.shell-html__source')!.textContent).toBe(multi);
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    expect(await screen.findAllByTestId('board-data-block')).toHaveLength(3);
    fireEvent.click(screen.getByTitle('收起 HTML 预览'));
    expect(screen.queryByTestId('board-data-block')).toBeNull();
  });
  it('lets paginated table/disclosure heights grow beyond the old 960px ceiling and shrink again', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome/140 Electron/40');
    window.syncThink = window.syncThink || ({ runtime: {} } as never);
    render(<HtmlSandbox code={multi} />);
    const guests = await screen.findAllByTestId('board-data-webview');
    expect(guests).toHaveLength(3);
    const report = (height: number) =>
      fireEvent(
        guests[2]!,
        Object.assign(new Event('ipc-message'), {
          channel: 'sync-think-visualization:height',
          args: [{ height }],
        }),
      );
    report(1320);
    expect(guests[2]!.parentElement!.style.height).toBe('1320px');
    report(320);
    expect(guests[2]!.parentElement!.style.height).toBe('320px');
    report(999999);
    expect(guests[2]!.parentElement!.style.height).toBe('10000px');
  });
  it('keeps explicit custom page layouts in one bounded guest', async () => {
    render(<HtmlSandbox code={'<main data-boardui-layout="custom">' + multi + '</main>'} />);
    expect(await screen.findByTestId('html-sandbox-content')).toBeTruthy();
    expect(screen.queryByTestId('board-data-block')).toBeNull();
  });
  it('reports excessive data visibly and keeps original source available', async () => {
    render(
      <HtmlSandbox
        code={boardDataHtml({
          components: Array.from({ length: 33 }, () => ({
            type: 'gauge' as const,
            title: '指标',
            value: 10,
            max: 20,
          })),
        })}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toContain('32');
    fireEvent.click(screen.getByRole('button', { name: '源码' }));
    expect(screen.getByRole('button', { name: '预览' })).toBeTruthy();
  });
});

it('defers offscreen data guests and retains them once visible', async () => {
  const callbacks: Array<IntersectionObserverCallback> = [];
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  render(
    <HtmlSandbox
      code={boardDataHtml({
        components: [
          { type: 'gauge', title: '甲', value: 1, max: 2 },
          { type: 'gauge', title: '乙', value: 1, max: 2 },
        ],
      })}
    />,
  );
  expect(await screen.findAllByTestId('board-data-block')).toHaveLength(2);
  expect(screen.queryByTestId('html-sandbox-content')).toBeNull();
  const { act } = await import('@testing-library/react');
  act(() =>
    callbacks[0]!(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  expect(await screen.findAllByTestId('html-sandbox-content')).toHaveLength(1);
  expect(disconnect).toHaveBeenCalled();
  act(() =>
    callbacks[0]!(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  expect(screen.getAllByTestId('html-sandbox-content')).toHaveLength(1);
});
