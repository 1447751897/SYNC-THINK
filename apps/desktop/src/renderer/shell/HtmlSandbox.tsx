// NewMax HtmlPreview: a ```html (or ```htm) fence renders as a sanitized
// iframe srcDoc with a measured, window-adaptive stage. Data-only documents opt into the local
// interactive data kit as independent auto-height isolated guests; ordinary authored HTML
// keeps the existing DOMPurify preview path.
import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';
const BoardDataBlocks = lazy(() => import('./BoardDataBlocks.js'));
import createDOMPurify from 'dompurify';
import {
  hasBoardDataMarkup,
  prepareBoardDataSource,
  isBoardDataPending,
} from '../visualization/data-html.js';
import { useBoardDataFont } from '../visualization/use-board-data-font.js';
import { buildVisualizationDocumentHtml } from '../visualization/ui-kit.js';
import {
  readVisualizationDesignTokens,
  visualizationTheme,
  visualizationReduceMotion,
} from '../visualization/design-system.js';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Eye,
  Scan,
} from 'lucide-react';
import { highlightSource } from './highlight.js';
import { INCOMPLETE_HTML_OPEN_ERROR, isDeferredHtmlPreview, type OpenHtmlInBrowser } from './html-browser.js';
import { AdaptiveHtmlPreview } from './AdaptiveHtmlPreview.js';
import type { HtmlPreviewSizing } from './html-preview-sizing.js';

interface HtmlSandboxProps {
  code: string;
  actions?: ReactNode;
  /** Open the document in the embedded browser tab when the shell provides one. */
  onOpenInBrowser?: OpenHtmlInBrowser;
}

/** Max source size accepted by the browser-open bridge (8 MiB). */
const MAX_OPEN_HTML = 8 * 1024 * 1024;

type ViewMode = 'preview' | 'source';

export function sanitizeHtmlDocument(source: string): string {
  const dataComponents = hasBoardDataMarkup(source);
  const nativeTables = /<table(?:\s|>)/i.test(source);
  const prepared = prepareBoardDataSource(source);
  const purifier = typeof window === 'undefined' ? null : createDOMPurify(window);
  const sanitized =
    purifier?.sanitize(prepared.replace(/\n$/, ''), {
      WHOLE_DOCUMENT: true,
      FORBID_TAGS: ['script'],
      FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur'],
      ADD_TAGS: ['style', 'link'],
      ADD_ATTR: ['target', 'rel'],
    }) ?? source.replace(/\n$/, '');
  if (!purifier || typeof DOMParser === 'undefined') return sanitized;
  const parser = new DOMParser();
  const document = parser.parseFromString(sanitized, 'text/html');
  document.querySelectorAll('a[href]').forEach((anchor) => {
    const href = (anchor.getAttribute('href') ?? '').trim();
    if (!href || href === '#') anchor.removeAttribute('href');
    else {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
  });
  const doctype = document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : '';
  const html = `${doctype}${document.documentElement.outerHTML}`;
  return dataComponents || nativeTables
    ? buildVisualizationDocumentHtml(html, {
        theme: visualizationTheme(),
        tokens: readVisualizationDesignTokens(),
        reduceMotion: visualizationReduceMotion(),
      })
    : html;
}

export function HtmlSandbox({ code, actions, onOpenInBrowser }: HtmlSandboxProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<ViewMode>('preview');
  const [previewSizing, setPreviewSizing] = useState<HtmlPreviewSizing>('content');
  const [copied, setCopied] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const source = code.replace(/\n$/, '');
  const dataComponents = hasBoardDataMarkup(source);
  const inspectionData =
    dataComponents &&
    (typeof DOMParser === 'undefined' ||
      !new DOMParser()
        .parseFromString(source, 'text/html')
        .querySelector('[data-boardui-layout="custom"]'));
  const dataPending = dataComponents && isBoardDataPending(source);
  const dataFont = useBoardDataFont(
    (dataComponents || /<table(?:\s|>)/i.test(source)) && !dataPending,
  );
  const previewHtml = useMemo(
    () => (dataPending || !dataFont.ready ? '' : sanitizeHtmlDocument(source)),
    [source, dataPending, dataFont.ready],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* Clipboard is best effort in restricted renderer contexts. */
    }
  }, [source]);

  const handleOpenInBrowser = useCallback(async () => {
    setOpenError(null);
    if (source.length > MAX_OPEN_HTML) {
      setOpenError('HTML 源码过大，无法在浏览器中打开');
      return;
    }
    try {
      const incomplete = isDeferredHtmlPreview(source);
      if (onOpenInBrowser) {
        // Preserve the marker/prefix so the shell can verify and reopen the full file.
        await onOpenInBrowser(dataComponents && !incomplete ? sanitizeHtmlDocument(source) : source);
        return;
      }
      if (incomplete) throw new Error(INCOMPLETE_HTML_OPEN_ERROR);
      const blob = new Blob([dataComponents ? sanitizeHtmlDocument(source) : source], {
        type: 'text/html;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : '打开失败');
    }
  }, [onOpenInBrowser, source, dataComponents]);

  const handleDownload = useCallback(() => {
    if (isDeferredHtmlPreview(source)) {
      setOpenError(INCOMPLETE_HTML_OPEN_ERROR);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([dataComponents ? sanitizeHtmlDocument(source) : source], {
        type: 'text/html;charset=utf-8',
      }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `preview-${Date.now()}.html`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }, [source, dataComponents]);

  const toolbar = (
    <div className="shell-html__bar">
      <div className="shell-html__bar-left">
        <button
          type="button"
          className="shell-html__collapse"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? '展开 HTML 预览' : '收起 HTML 预览'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        <span className="shell-md-code__lang">{dataComponents ? '数据' : 'HTML'}</span>
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
        {!dataComponents ? (['content', 'fit', 'actual'] as const).map((sizing) => (
          <button
            key={sizing}
            type="button"
            className={`shell-html__view-tab${previewSizing === sizing ? ' is-active' : ''}`}
            onClick={() => setPreviewSizing(sizing)}
            aria-pressed={previewSizing === sizing}
            title={sizing === 'content' ? '适应宽度并随内容撑高，与智能体预览一致'
              : sizing === 'fit' ? '按宽高等比缩放，完整显示页面' : '以 100% 大小查看页面'}
          >
            <Scan size={12} />
            <span>{sizing === 'content' ? '完整显示' : sizing === 'fit' ? '适应窗口' : '原始大小'}</span>
          </button>
        )) : null}
      </div>
      <div className="shell-md-code__actions">
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
          disabled={dataPending || !dataFont.ready}
          onClick={() => void handleOpenInBrowser()}
          title="在浏览器中打开"
        >
          <ExternalLink size={12} />
          <span>浏览器打开</span>
        </button>
        <button
          type="button"
          className="shell-md-code__action"
          disabled={dataPending || !dataFont.ready}
          onClick={handleDownload}
          title="下载 HTML"
        >
          <Download size={12} />
          <span>下载</span>
        </button>
        {actions}
      </div>
    </div>
  );

  return (
    <div className={`shell-html shell-html--fenced${dataComponents ? ' shell-html--data' : ''}`}>
      {inspectionData ? (
        <details className="shell-data-actions">
          <summary aria-label="数据操作" title="数据操作">
            ⋯
          </summary>
          {toolbar}
        </details>
      ) : (
        toolbar
      )}
      {openError ? (
        <div className="shell-html__error" role="alert">
          {openError}
        </div>
      ) : null}
      {!collapsed ? (
        view === 'source' ? (
          <div className="shell-html__source shell-html__source--fenced">
            <pre className="shell-html__source-pre">
              <code
                className="hljs"
                dangerouslySetInnerHTML={{ __html: highlightSource(source, 'html') }}
              />
            </pre>
          </div>
        ) : dataFont.error ? (
          <div role="alert" className="shell-html__error">
            {dataFont.error}{' '}
            <button type="button" onClick={dataFont.retry}>
              重试
            </button>
          </div>
        ) : !dataFont.ready ? (
          <div
            role="status"
            aria-busy="true"
            className="shell-html__content"
            style={{ height: 96, padding: 16 }}
          >
            正在加载数据组件…
          </div>
        ) : dataPending ? (
          <div
            className="shell-html__content"
            data-testid="html-data-pending"
            role="status"
            aria-busy="true"
            style={{ height: 96, padding: 16 }}
          >
            数据尚未完整，完整后会显示预览；可切换源码检查。
          </div>
        ) : dataComponents ? (
          <Suspense
            fallback={
              <div role="status" className="shell-html__notice">
                正在加载数据组件…
              </div>
            }
          >
            <BoardDataBlocks source={source} fallbackHtml={previewHtml} />
          </Suspense>
        ) : (
          <AdaptiveHtmlPreview html={previewHtml} sizing={previewSizing} />
        )
      ) : null}
    </div>
  );
}
