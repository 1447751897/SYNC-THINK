/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MermaidChart } from './MermaidChart.js';

const vendor = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(async (_text: string) => true),
  render: vi.fn(async (_id: string, _text: string, _container?: Element) => ({
    svg: '<svg data-testid="rendered-mermaid" viewBox="0 0 100 60"><text>chart</text></svg>',
  })),
}));

vi.mock('./mermaid-vendor-loader.js', () => ({
  loadMermaidVendor: vi.fn(async () => vendor),
}));

/** jsdom lays nothing out, so the render pipeline needs a measurable canvas. */
function makeMeasurable(element: HTMLElement, width = 640): void {
  element.getBoundingClientRect = () =>
    ({
      width: element.style.display === 'none' ? 0 : width,
      height: 320,
      top: 0,
      left: 0,
      right: width,
      bottom: 320,
      x: 0,
      y: 0,
    }) as DOMRect;
}

beforeEach(() => {
  // jsdom reports no layout at all; the component's visibility gate needs a
  // non-zero box before it will schedule a render.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 640,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 320,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get: () => document.body,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 640,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 320,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.classList.remove('dark');
});

describe('MermaidChart', () => {
  it('renders into a shadow root and opens the rendered chart in a dialog', async () => {
    render(<MermaidChart code={'flowchart LR\nA --> B'} />);
    const canvas = screen.getByTestId('mermaid-canvas');
    makeMeasurable(canvas);

    await waitFor(() => expect(vendor.render).toHaveBeenCalled());
    await waitFor(() => expect(canvas.shadowRoot?.querySelector('svg')).not.toBeNull());

    const enlarge = await screen.findByRole('button', { name: '放大查看' });
    fireEvent.click(enlarge);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('img')?.getAttribute('src')).toContain('data:image/svg+xml');
    expect(screen.getByText('Mermaid 图表')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('repairs flowchart labels whose brackets break the parser', async () => {
    vendor.parse.mockRejectedValueOnce(new Error('parse failed'));
    render(<MermaidChart code={'flowchart LR\nA[foo (bar)] --> B'} />);
    const canvas = screen.getByTestId('mermaid-canvas');
    makeMeasurable(canvas);

    await waitFor(() => expect(vendor.render).toHaveBeenCalled());
    expect(vendor.parse).toHaveBeenCalledTimes(2);
    expect(vendor.render.mock.calls.at(-1)?.[1]).toContain('A["foo (bar)"]');
  });

  it('recovers from a parse error when the source is corrected', async () => {
    vendor.parse.mockRejectedValueOnce(new Error('invalid source'));
    const view = render(<MermaidChart code="invalid source" />);
    const canvas = screen.getByTestId('mermaid-canvas');
    makeMeasurable(canvas);
    await screen.findByRole('alert', {}, { timeout: 2000 });

    view.rerender(<MermaidChart code={'flowchart LR\nA --> B'} />);

    await waitFor(() => expect(canvas.shadowRoot?.querySelector('svg')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the newest diagram when an older render completes later', async () => {
    let finishOldRender!: (result: { svg: string }) => void;
    vendor.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOldRender = resolve;
        }),
    );
    const view = render(<MermaidChart code={'flowchart LR\nOld --> Diagram'} />);
    const canvas = screen.getByTestId('mermaid-canvas');
    makeMeasurable(canvas);
    await waitFor(() => expect(vendor.render).toHaveBeenCalledTimes(1));

    view.rerender(<MermaidChart code={'flowchart LR\nNew --> Diagram'} />);
    await waitFor(() =>
      expect(canvas.shadowRoot?.querySelector('text')?.textContent).toBe('chart'),
    );
    await act(async () => {
      finishOldRender({ svg: '<svg viewBox="0 0 100 60"><text>obsolete</text></svg>' });
    });

    expect(canvas.shadowRoot?.querySelector('text')?.textContent).toBe('chart');
  });

  it('fits a large diagram to the viewport and supports width and manual wheel zoom', async () => {
    vendor.render.mockResolvedValueOnce({
      svg: '<svg viewBox="0 0 2000 1000"><text>large chart</text></svg>',
    });
    render(<MermaidChart code={'flowchart LR\nLarge --> Diagram'} />);
    makeMeasurable(screen.getByTestId('mermaid-canvas'));
    fireEvent.click(await screen.findByRole('button', { name: '放大查看' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.querySelector('img')?.style.width).toBe('448px'));
    expect(screen.getByRole('button', { name: '适应窗口' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: '适应宽度' }));
    expect(dialog.querySelector('img')?.style.width).toBe('544px');
    fireEvent.wheel(dialog.querySelector('.shell-mermaid-lightbox__canvas')!, {
      ctrlKey: true,
      deltaY: -50,
    });
    expect(parseFloat(dialog.querySelector('img')!.style.width)).toBeGreaterThan(544);
    expect(screen.getByRole('button', { name: '适应宽度' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('offers the same image actions from the inline context menu', async () => {
    render(<MermaidChart code={'flowchart LR\nMenu --> Actions'} />);
    const canvas = screen.getByTestId('mermaid-canvas');
    makeMeasurable(canvas);
    await screen.findByRole('button', { name: '放大查看' });
    fireEvent.contextMenu(canvas, { clientX: 200, clientY: 120 });
    expect(await screen.findByRole('menuitem', { name: '复制图片' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '下载 PNG' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '放大查看' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});
