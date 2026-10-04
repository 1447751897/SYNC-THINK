/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { sanitizeHtmlDocument } from './HtmlSandbox.js';
import { HTML_PREVIEW_VIEWPORT_MESSAGE, htmlPreviewLayout, measuredHtmlPreviewDocument } from './html-preview-sizing.js';

describe('HTML preview sizing', () => {
  it('shows short content at its natural size instead of a permanent 420px stage', () => {
    expect(htmlPreviewLayout(180, 800, true, 800, 800))
      .toEqual({ height: 180, frameHeight: 180, frameWidth: 800, scale: 1 });
  });

  it('fits the whole document without falling back to scrolling for long pages or small windows', () => {
    expect(htmlPreviewLayout(850, 800, true, 800, 800))
      .toEqual({ height: 600, frameHeight: 850, frameWidth: 800, scale: 600 / 850 });
    expect(htmlPreviewLayout(850, 1100, true, 800, 800))
      .toEqual({ height: 850, frameHeight: 850, frameWidth: 800, scale: 1 });
    expect(htmlPreviewLayout(5000, 800, true, 800, 800))
      .toEqual({ height: 600, frameHeight: 5000, frameWidth: 800, scale: 600 / 5000 });
    expect(htmlPreviewLayout(1200, 450, true, 800, 800))
      .toEqual({ height: 250, frameHeight: 1200, frameWidth: 800, scale: 250 / 1200 });
  });

  it('uses the tighter width or height limit and keeps fixed-width scenes complete', () => {
    expect(htmlPreviewLayout(400, 800, true, 1800, 600))
      .toEqual({ height: 134, frameHeight: 400, frameWidth: 1800, scale: 1 / 3 });
    expect(htmlPreviewLayout(1800, 800, true, 1800, 600))
      .toEqual({ height: 600, frameHeight: 1800, frameWidth: 1800, scale: 1 / 3 });
    expect(htmlPreviewLayout(1000, 600, true, 1800, 900))
      .toEqual({ height: 400, frameHeight: 1000, frameWidth: 1800, scale: 0.4 });
  });

  it('does not add an extra pixel when floating-point multiplication overshoots the height budget', () => {
    expect(htmlPreviewLayout(766, 700, true, 800, 800).height).toBe(500);
  });

  it('lets complete-document mode grow to the full height and only scales for width', () => {
    expect(htmlPreviewLayout(5000, 800, false, 800, 800, true))
      .toEqual({ height: 5000, frameHeight: 5000, frameWidth: 800, scale: 1 });
    expect(htmlPreviewLayout(1800, 450, false, 1800, 600, true))
      .toEqual({ height: 600, frameHeight: 1800, frameWidth: 1800, scale: 1 / 3 });
  });

  it('reserves scrolling for the explicit original-size mode', () => {
    expect(htmlPreviewLayout(850, 800, false, 1800, 800))
      .toEqual({ height: 850, frameHeight: 850, frameWidth: 800, scale: 1 });
    expect(htmlPreviewLayout(5000, 800, false, 1800, 800))
      .toEqual({ height: 1200, frameHeight: 1200, frameWidth: 800, scale: 1 });
  });

  it('keeps viewport CSS stable while expanding the frame and updates the reference on host resize', () => {
    const html = '<style>html{height:100%}body{min-height:calc(100svh - 20px)}</style><main style="height:150dvh">scene</main>';
    const source = measuredHtmlPreviewDocument(html, 'viewport-test');
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    const script = parsed.querySelector('script')!.textContent!;
    const originalHead = document.head.innerHTML;
    const originalBody = document.body.innerHTML;
    const queue: FrameRequestCallback[] = [];
    const listeners = new Map<string, (event: MessageEvent) => void>();
    const host = { postMessage: vi.fn() };
    try {
      document.head.innerHTML = parsed.head.innerHTML;
      document.body.innerHTML = parsed.body.innerHTML;
      const execute = new Function(
        'document', 'innerHeight', 'scrollX', 'scrollY', 'getComputedStyle', 'parent',
        'ResizeObserver', 'MutationObserver', 'addEventListener', 'requestAnimationFrame', script,
      );
      execute(document, 800, 0, 0, window.getComputedStyle.bind(window), host, undefined,
        class { observe() {} },
        (type: string, listener: (event: MessageEvent) => void) => listeners.set(type, listener),
        (callback: FrameRequestCallback) => queue.push(callback),
      );
      queue.shift()!(0);
      const rules = document.styleSheets[0]!.cssRules;
      expect((rules[0] as CSSStyleRule).style.height).toBe('800px');
      expect((rules[1] as CSSStyleRule).style.getPropertyValue('min-height')).toBe('calc(800px - 20px)');
      expect(document.querySelector<HTMLElement>('main')!.style.height).toBe('1200px');
      // Re-measuring must use the original CSS values, not grow with the frame.
      listeners.get('resize')!({} as MessageEvent);
      queue.shift()!(0);
      expect(document.querySelector<HTMLElement>('main')!.style.height).toBe('1200px');
      listeners.get('message')!({
        source: host,
        data: { type: HTML_PREVIEW_VIEWPORT_MESSAGE, documentId: 'viewport-test', height: 300 },
      } as unknown as MessageEvent);
      queue.shift()!(0);
      expect((rules[0] as CSSStyleRule).style.height).toBe('300px');
      expect((rules[1] as CSSStyleRule).style.getPropertyValue('min-height')).toBe('calc(300px - 20px)');
      expect(document.querySelector<HTMLElement>('main')!.style.height).toBe('450px');
      listeners.get('message')!({
        source: {},
        data: { type: HTML_PREVIEW_VIEWPORT_MESSAGE, documentId: 'viewport-test', height: 999 },
      } as unknown as MessageEvent);
      expect(queue).toHaveLength(0);
      expect(html).toContain('height:150dvh'); // exported source stays untouched
    } finally {
      document.head.innerHTML = originalHead;
      document.body.innerHTML = originalBody;
    }
  });

  it('adds only the host measurement script after sanitization and keeps exports separate', () => {
    const html = sanitizeHtmlDocument('<main onclick="alert(1)">scene<script>fetch("evil")</script></main>');
    expect(html).not.toContain('<script');
    const preview = measuredHtmlPreviewDocument(html, 'preview-id');
    const doc = new DOMParser().parseFromString(preview, 'text/html');
    expect(doc.querySelectorAll('script')).toHaveLength(1);
    expect(doc.querySelector('script')?.dataset.htmlPreviewSizing).toBe('preview-id');
    expect(preview).not.toContain('fetch("evil")');
    expect(preview).not.toContain('onclick=');
    expect(preview).toContain('ResizeObserver');
    expect(preview).toContain('document.fonts?.ready');
    expect(preview).toContain('parent.postMessage');
    expect(preview).toContain('stabilizeViewport');
    expect(preview).toContain('sync-think:html-preview-viewport');
    expect(preview).toContain('root.scrollWidth');
    // The trusted bridge must remain valid JS, including its embedded regexes.
    expect(() => new Function(doc.querySelector('script')!.textContent!)).not.toThrow();
  });
});
