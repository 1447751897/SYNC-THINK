// Interactive HTML sandbox. A ```html (or ```htm) block is rendered inside an
// Electron <webview> loaded from a data: URL with an opaque origin.
//
// Security model:
// - the guest document is a fully separate renderer (webview) with sandbox=true,
//   contextIsolation=true, nodeIntegration=false and no preload bridge, so the
//   embedded HTML can run its own JS/CSS but cannot touch the shell's DOM or
//   Node.js APIs.
// - the main process only allows http(s)/about:blank/data:text/html webview
//   sources (see will-attach-webview in apps/desktop/src/main/index.ts).
//
// Fullness / white-screen handling:
// - the fill style is injected into the document *head* (never appended after
//   </html>, where browsers drop it): `html{background-color:<theme-fallback>}`
//   paints the whole webview canvas with the chat-surface colour so short pages
//   cannot show a white strip, and `body{min-height:100vh}` makes the page's
//   own background fill the viewport instead of stopping at the content height.
// - a `<meta name="viewport">` keeps the guest layout viewport tied to the
//   webview element width, so the preview layout matches a real browser tab.
// - the webview height follows the measured guest content (clamped), so short
//   pages collapse to their real height instead of leaving an empty stage.
// - an IntersectionObserver re-measures when the webview scrolls into view,
//   because the shell uses content-visibility on message items: an off-screen
//   webview loads late and misses its dom-ready/did-finish-load events.
//
// Scale alignment (why the preview can otherwise look bigger/smaller than the
// rendered page):
// - the guest is a separate renderer whose devicePixelRatio can differ from
//   the host on Windows display scaling (125%/150%). When host DPR != guest
//   DPR, 1 CSS px means different physical sizes on screen, so the embedded
//   page renders at a different scale than the host UI around it.
// - on dom-ready we read the guest DPR and call webview.setZoomFactor(hostDpr /
//   guestDpr), which makes guest CSS pixels exactly as big as host CSS pixels.
//   All measurements below then hold in host CSS pixels directly.
// - the measure script uses body.getBoundingClientRect().height (the real
//   rendered height) instead of documentElement rects, which equal the
//   viewport height on short pages and would pin the stage to its current
//   height — the "preview bigger than the page" symptom.
//
// Card chrome: the block is a collapsible card with a header bar that offers
// 预览 (default live view) / 源码 (source view) tabs, 复制 and 浏览器打开.
// "浏览器打开" writes the raw snippet to a temp file via the desktop bridge and
// opens it in the system browser, so external links / relative assets behave
// like a real page instead of a data: URL.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, FileCode2, Eye, RotateCcw } from 'lucide-react';
import { highlightSource } from './highlight.js';

interface HtmlSandboxProps {
  code: string;
}

/**
 * Height policy for the embedded page:
 * - DEFAULT: the initial stage before the first measurement (and the reset
 *   value when the source changes).
 * - MIN/MAX: clamps applied to measured content heights. MIN is deliberately
 *   low so genuinely short pages collapse to their real height.
 */
const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 960;
const HEIGHT_JITTER = 24; // px; below this, a re-measurement is ignored

/** Max source size accepted by the browser-open bridge (8 MiB). */
const MAX_OPEN_HTML = 8 * 1024 * 1024;

type ViewMode = 'preview' | 'source';

/**
 * Theme-aware canvas fallback for the guest document. The chat surface colour
 * is read from the host's design tokens at render time and baked into the
 * data: URL (a webview document cannot inherit host CSS variables).
 * Used only as the `html` background; a page that paints its own backgrounds
 * always wins.
 */
function readChatBackground(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    // Neutral fallback for the static/SSR render only — in a live window the
    // computed token below always wins.
    return '#000';
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-chat')
    .trim();
  return value || '#000';
}

/**
 * Build the data: URL for a guest document. The fill style MUST live inside
 * the document (head or before the first <body>): a style appended after
 * `</html>` is silently dropped by the HTML parser, which was the root cause
 * of the white/unfilled strip for complete documents.
 *
 * A viewport meta is also injected so the guest layout viewport matches the
 * webview element width (like a real browser tab) instead of using whatever
 * default viewport the webview picks.
 */
function buildSandboxSource(code: string, fallbackBg: string): string {
  const fill =
    '<style>html,body{margin:0}html{background-color:' +
    fallbackBg +
    '}body{min-height:100vh}</style>';
  const viewport =
    '<meta name="viewport" content="width=device-width, initial-scale=1">';
  const headExtras = `${viewport}${fill}`;
  const source = code.replace(/\n$/, '');

  const intoHead = (doc: string) => doc.replace(/<\/head>/i, `${headExtras}</head>`);
  const intoBody = (doc: string) =>
    doc.replace(/<body[^>]*>/i, (match) => `${headExtras}${match}`);

  if (/<\/html>\s*$/i.test(source)) {
    const withHead = intoHead(source);
    if (withHead !== source) return toDataUrl(withHead);
    const withBody = intoBody(source);
    if (withBody !== source) return toDataUrl(withBody);
    return toDataUrl(source.replace(/<\/html>/i, `${headExtras}</html>`));
  }
  if (/<html[\s>]/i.test(source) || /<!doctype/i.test(source)) {
    const withHead = intoHead(source);
    if (withHead !== source) return toDataUrl(withHead);
    const withBody = intoBody(source);
    if (withBody !== source) return toDataUrl(withBody);
    return toDataUrl(`${source}\n${headExtras}`);
  }
  // Bare fragment — wrap it in a full document with the viewport + fill in the head.
  return toDataUrl(
    `<!DOCTYPE html><html><head><meta charset="utf-8">${headExtras}</head><body>${source}</body></html>`,
  );
}

function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

interface HtmlSandboxWebview {
  reload?: () => void;
  executeJavaScript?: (code: string) => Promise<unknown>;
  setZoomFactor?: (factor: number) => Promise<void> | void;
  addEventListener?: (
    event: 'dom-ready' | 'did-finish-load',
    listener: () => void,
  ) => void;
  removeEventListener?: (
    event: 'dom-ready' | 'did-finish-load',
    listener: () => void,
  ) => void;
}

/** Read the guest document's devicePixelRatio (CSS-px per physical px). */
const READ_DPR_SCRIPT = `(() => window.devicePixelRatio || 1)()`;

/**
 * Height-measuring script run inside the guest document.
 *
 * body.getBoundingClientRect().height is the *rendered* height of the content
 * box, which is exactly what the preview frame should occupy — documentElement
 * scroll/offset/client heights all fall back to the *viewport* height on short
 * pages, which would pin the frame to its current height and make the preview
 * area bigger than the actual page.
 */
const MEASURE_SCRIPT = `(() => {
  const b = document.body;
  const h = b ? b.getBoundingClientRect().height : 0;
  return Math.max(h, b ? b.scrollHeight : 0);
})()`;

export function HtmlSandbox({ code }: HtmlSandboxProps) {
  const src = useMemo(
    () => buildSandboxSource(code, readChatBackground()),
    [code],
  );
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<ViewMode>('preview');
  const [copied, setCopied] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const webviewRef = useRef<never>(null);

  // A new document is loaded whenever the source changes — start from the
  // default stage height again, then measurements below take over.
  useEffect(() => {
    setHeight(DEFAULT_HEIGHT);
  }, [src]);

  const measure = useCallback(() => {
    const el = webviewRef.current as HtmlSandboxWebview | null;
    if (!el || typeof el.executeJavaScript !== 'function') return;
    el.executeJavaScript(MEASURE_SCRIPT)
      .then((value) => {
        const raw = Number(value);
        if (!Number.isFinite(raw)) return;
        const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(raw)));
        // Small jitter guard: ignore sub-threshold re-measurements so the
        // stage does not pulse while the guest page settles.
        setHeight((prev) => (Math.abs(next - prev) >= HEIGHT_JITTER ? next : prev));
      })
      .catch(() => {
        /* guest page threw while measuring — keep current height */
      });
  }, []);

  /**
   * Align the guest's CSS-pixel scale with the host's. The webview is a
   * separate renderer whose devicePixelRatio can differ from the host on
   * Windows display scaling (125%/150%): with host DPR != guest DPR, the
   * embedded page renders at a different physical scale than the UI around
   * it — the "preview size does not match the rendered page" symptom.
   * setZoomFactor(hostDpr / guestDpr) makes one guest CSS px exactly one host
   * CSS px, so the preview frame, page layout and measured heights all agree.
   */
  const alignScale = useCallback(() => {
    const el = webviewRef.current as HtmlSandboxWebview | null;
    if (
      !el ||
      typeof el.executeJavaScript !== 'function' ||
      typeof el.setZoomFactor !== 'function'
    ) {
      return;
    }
    const hostDpr =
      typeof window !== 'undefined' && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1;
    el.executeJavaScript(READ_DPR_SCRIPT)
      .then((guestDpr) => {
        const ratio = Number(guestDpr);
        if (!Number.isFinite(ratio) || ratio <= 0) return;
        return el.setZoomFactor?.(hostDpr / ratio);
      })
      .catch(() => {
        /* guest page unavailable — scale stays as-is */
      });
  }, []);

  // Measure at every meaningful load milestone, and once more shortly after
  // dom-ready for async content (images, fonts, layout shifts). Scale is
  // aligned on dom-ready, before the first measurement, so measured heights
  // are already in host CSS pixels.
  useEffect(() => {
    const el = webviewRef.current as HtmlSandboxWebview | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    const listener = () => {
      alignScale();
      measure();
      window.setTimeout(measure, 400);
    };
    el.addEventListener('dom-ready', listener);
    el.addEventListener('did-finish-load', listener);
    return () => {
      el.removeEventListener?.('dom-ready', listener);
      el.removeEventListener?.('did-finish-load', listener);
    };
  }, [alignScale, measure]);

  // The shell uses content-visibility on message items: an off-screen webview
  // only starts loading when scrolled into view, by which time dom-ready may
  // have fired and been missed. Re-align scale and re-measure whenever the
  // webview becomes visible so late-loaded pages still get their real height
  // and scale.
  useEffect(() => {
    const el = webviewRef.current as HtmlSandboxWebview | null;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        alignScale();
        measure();
        window.setTimeout(measure, 300);
      }
    });
    observer.observe(el as unknown as Element);
    return () => observer.disconnect();
  }, [alignScale, measure]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code.replace(/\n$/, ''));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore clipboard failures */
    }
  }, [code]);

  const handleReload = useCallback(() => {
    const el = webviewRef.current as HtmlSandboxWebview | null;
    el?.reload?.();
  }, []);

  const handleOpenInBrowser = useCallback(async () => {
    setOpenError(null);
    const html = code.replace(/\n$/, '');
    if (html.length > MAX_OPEN_HTML) {
      setOpenError('HTML 源码过大，无法在浏览器中打开');
      return;
    }
    try {
      const bridge = window.syncThink?.runtime;
      if (!bridge || typeof bridge.openHtmlInBrowser !== 'function') {
        setOpenError('当前环境不支持在浏览器中打开');
        return;
      }
      const result = await bridge.openHtmlInBrowser(html);
      if (!result.ok) setOpenError(result.error ?? '打开失败');
    } catch {
      setOpenError('打开失败');
    }
  }, [code]);

  return (
    <div className="shell-html">
      <div className="shell-html__bar">
        <div className="shell-html__bar-left">
          <button
            type="button"
            className="shell-html__collapse"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? '展开 HTML 预览' : '收起 HTML 预览'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
          <span className="shell-md-code__lang">html</span>
        </div>
        <div className="shell-html__view-tabs">
          <button
            type="button"
            className={`shell-html__view-tab${view === 'preview' ? ' is-active' : ''}`}
            onClick={() => setView('preview')}
            aria-pressed={view === 'preview'}
          >
            <Eye size={12} />
            <span>预览</span>
          </button>
          <button
            type="button"
            className={`shell-html__view-tab${view === 'source' ? ' is-active' : ''}`}
            onClick={() => setView('source')}
            aria-pressed={view === 'source'}
          >
            <FileCode2 size={12} />
            <span>源码</span>
          </button>
        </div>
        <div className="shell-md-code__actions">
          <button
            type="button"
            className="shell-md-code__action"
            onClick={handleReload}
            title="重新加载页面"
            disabled={view !== 'preview' || collapsed}
          >
            <RotateCcw size={12} />
            <span>刷新</span>
          </button>
          <button
            type="button"
            className="shell-md-code__action"
            onClick={() => void handleCopy()}
            title="复制 HTML 源码"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
          <button
            type="button"
            className="shell-md-code__action"
            onClick={() => void handleOpenInBrowser()}
            title="在系统浏览器中打开"
          >
            <ExternalLink size={12} />
            <span>浏览器打开</span>
          </button>
        </div>
      </div>
      {openError ? (
        <div className="shell-html__error" role="alert">
          {openError}
        </div>
      ) : null}
      {!collapsed ? (
        view === 'source' ? (
          <div className="shell-html__source">
            <pre className="shell-html__source-pre">
              <code
                className="hljs"
                dangerouslySetInnerHTML={{ __html: highlightSource(code.replace(/\n$/, ''), 'html') }}
              />
            </pre>
          </div>
        ) : (
          <webview
            ref={webviewRef}
            src={src}
            className="shell-html__webview"
            data-testid="html-sandbox"
            style={{ height }}
          />
        )
      ) : null}
    </div>
  );
}
