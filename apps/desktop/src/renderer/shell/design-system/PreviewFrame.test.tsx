/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PreviewFrame, PreviewTheme } from './PreviewFrame.js';
let observeVisibility: (entries: { isIntersecting: boolean }[]) => void;
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
);
vi.stubGlobal(
  'IntersectionObserver',
  class {
    constructor(callback: typeof observeVisibility) {
      observeVisibility = callback;
    }
    observe() {}
    disconnect() {}
  },
);
afterEach(cleanup);
describe('isolated component previews', () => {
  it('does not mount off-screen thumbnails', () => {
    const view = render(<PreviewFrame name="ComposerEditor" thumbnail />);
    expect(view.container.querySelector('iframe')).toBeNull();
    act(() => observeVisibility([{ isIntersecting: true }]));
    expect(view.container.querySelector('iframe')).not.toBeNull();
    act(() => observeVisibility([{ isIntersecting: false }]));
    expect(view.container.querySelector('iframe')).toBeNull();
  });
  it('keeps theme changes within the child and preserves its document', () => {
    const original = document.documentElement.style.cssText;
    const light = { mode: 'light', values: { '--color-accent': '#445566' } };
    const view = render(
      <PreviewTheme.Provider value={light}>
        <PreviewFrame name="ComposerEditor" />
      </PreviewTheme.Provider>,
    );
    const frame = screen.getByTitle('ComposerEditor 设计预览') as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.load(frame);
    expect(post).toHaveBeenCalledWith({ type: 'sync-design-theme', ...light }, location.origin);
    const src = frame.src;
    view.rerender(
      <PreviewTheme.Provider value={{ mode: 'dark', values: { '--color-accent': '#abcdef' } }}>
        <PreviewFrame name="ComposerEditor" />
      </PreviewTheme.Provider>,
    );
    expect(frame.src).toBe(src);
    expect(document.documentElement.style.cssText).toBe(original);
    expect(post).toHaveBeenLastCalledWith(
      { type: 'sync-design-theme', mode: 'dark', values: { '--color-accent': '#abcdef' } },
      location.origin,
    );
  });
  it('ignores readiness messages from other windows', () => {
    const view = render(<PreviewFrame name="Avatar" />);
    fireEvent(
      window,
      new MessageEvent('message', {
        data: { type: 'sync-design-preview', status: 'error' },
        source: window,
      }),
    );
    expect(view.container.firstElementChild?.getAttribute('data-preview-state')).toBe('loading');
    const frame = screen.getByTitle('Avatar 设计预览') as HTMLIFrameElement;
    fireEvent(
      window,
      new MessageEvent('message', {
        data: { type: 'sync-design-preview', status: 'ready' },
        source: frame.contentWindow,
      }),
    );
    expect(view.container.firstElementChild?.getAttribute('data-preview-state')).toBe('ready');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
  });
});
