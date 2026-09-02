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
// - the fallback canvas colour and viewport meta are injected into the document
//   head (never after </html>, where browsers may discard them).
// - the guest body is deliberately not forced to 100vh: its natural content
//   height drives the webview height, so short pages do not leave a large blank
//   stage below their content.
// - Electron owns guest DPI/zoom. Applying a second host/guest DPR correction
//   makes the guest surface and host element disagree on Windows scaling, which
//   can paint only the top strip of the page.
// - load events, bounded delayed retries and IntersectionObserver measurements
//   cover fast data: URLs, async layout and content-visibility delayed mounts.
//
// Card chrome: the block is a collapsible card with a header bar that offers
// 预览 (default live view) / 源码 (source view) tabs, 复制 and 浏览器打开.
// The shell callback persists the snippet and opens a tokenized local page in
// the NewMax-style embedded browser; standalone consumers retain the desktop
// bridge fallback for opening it externally.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileCode2,
  Eye,
  PanelsTopLeft,
  RotateCcw,
} from 'lucide-react';
import { highlightSource } from './highlight.js';
import type { OpenHtmlInBrowser } from './html-browser.js';

interface HtmlSandboxProps {
  code: string;
  appearance?: 'code' | 'design';
  actions?: ReactNode;
  /** Open the document in the embedded browser tab when the shell provides one. */
  onOpenInBrowser?: OpenHtmlInBrowser;
  notice?: {
    tone: 'error' | 'warning' | 'success';
    message: string;
  } | null;
}

/**
 * Height policy for the embedded page:
 * - DEFAULT: the initial stage before the first measurement (and the reset
 *   value when the source changes).
 * - MIN/MAX: clamps applied to measured content heights. MIN is deliberately
 *   low so genuinely short pages collapse to their real height.
 */
const DEFAULT_HEIGHT = 240;
const MIN_HEIGHT = 72;
const MAX_HEIGHT = 960;
const HEIGHT_JITTER = 8; // px; below this, a re-measurement is ignored

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
    '<style>html,body{margin:0;min-height:0!important;height:auto!important}html{background-color:' +
    fallbackBg +
    '}</style>';
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
  addEventListener?: (
    event: 'dom-ready' | 'did-finish-load',
    listener: () => void,
  ) => void;
  removeEventListener?: (
    event: 'dom-ready' | 'did-finish-load',
    listener: () => void,
  ) => void;
}

/**
 * Measure the guest's natural body content rather than documentElement, whose
 * height is at least the current viewport and therefore cannot shrink a short
 * preview. Child bottoms cover absolutely-positioned content that may sit
 * outside the body's own border box.
 */
const MEASURE_SCRIPT = `(() => {
  const body = document.body;
  if (!body) return 0;
  const top = body.getBoundingClientRect().top;
  const childBottom = Array.from(body.children).reduce((bottom, child) => {
    const rect = child.getBoundingClientRect();
    return Math.max(bottom, rect.bottom - top);
  }, 0);
  if (childBottom > 0) return Math.ceil(childBottom);
  return Math.ceil(Math.max(body.scrollHeight, body.offsetHeight, 0));
})()`;

export function HtmlSandbox({
  code,
  appearance = 'code',
  actions,
  onOpenInBrowser,
  notice = null,
}: HtmlSandboxProps) {
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

    // Electron throws synchronously when executeJavaScript is called before the
    // guest has emitted dom-ready. This can happen during React's first effect
    // pass and must not escape into the shell root (which would blank the whole
    // window). Later bounded retries/load events will measure once it is ready.
    let measurement: Promise<unknown>;
    try {
      measurement = el.executeJavaScript(MEASURE_SCRIPT);
    } catch {
      return;
    }

    void measurement
      .then((value) => {
        const raw = Number(value);
        if (!Number.isFinite(raw)) return;
        const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(raw)));
        // Small jitter guard: ignore sub-threshold re-measurements so the
        // stage does not pulse while the guest page settles.
        setHeight((prev) => (Math.abs(next - prev) >= HEIGHT_JITTER ? next : prev));
      })
      .catch(() => {
        /* guest page threw while measuring; keep current height */
      });
  }, []);

  // data: URLs can finish loading before React attaches the Electron events.
  // Measure immediately and retry a few bounded times after every mount/view
  // change so the first visible frame converges without a permanent poller.
  useEffect(() => {
    if (collapsed || view !== 'preview') return;
    measure();
    const timers = [50, 250, 800].map((delay) => window.setTimeout(measure, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [collapsed, measure, src, view]);

  // Re-measure at Electron's meaningful load milestones, then once more after
  // likely image/font layout shifts.
  useEffect(() => {
    if (collapsed || view !== 'preview') return;
    const el = webviewRef.current as HtmlSandboxWebview | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    const timers = new Set<number>();
    const listener = () => {
      measure();
      for (const delay of [100, 500]) {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          measure();
        }, delay);
        timers.add(timer);
      }
    };
    el.addEventListener('dom-ready', listener);
    el.addEventListener('did-finish-load', listener);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      el.removeEventListener?.('dom-ready', listener);
      el.removeEventListener?.('did-finish-load', listener);
    };
  }, [collapsed, measure, src, view]);

  // Message rows use content-visibility, so an off-screen webview may only
  // become drawable after it enters the viewport.
  useEffect(() => {
    if (collapsed || view !== 'preview') return;
    const el = webviewRef.current as HtmlSandboxWebview | null;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let timer: number | undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        measure();
        if (timer !== undefined) window.clearTimeout(timer);
        timer = window.setTimeout(measure, 250);
      }
    });
    observer.observe(el as unknown as Element);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [collapsed, measure, src, view]);

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
      if (onOpenInBrowser) {
        await onOpenInBrowser(html);
        return;
      }
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
  }, [code, onOpenInBrowser]);

  return (
    <div className={`shell-html${appearance === 'design' ? ' shell-html--design' : ''}`}>
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
          {appearance === 'design' ? (
            <span className="shell-html__identity">
              <PanelsTopLeft size={13} aria-hidden="true" />
              <span>设计稿</span>
            </span>
          ) : (
            <span className="shell-md-code__lang">html</span>
          )}
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
          {actions}
        </div>
      </div>
      {openError ? (
        <div className="shell-html__error" role="alert">
          {openError}
        </div>
      ) : null}
      {notice ? (
        <div
          className={`shell-html__notice shell-html__notice--${notice.tone}`}
          role={notice.tone === 'error' || notice.tone === 'warning' ? 'alert' : 'status'}
        >
          {notice.message}
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
