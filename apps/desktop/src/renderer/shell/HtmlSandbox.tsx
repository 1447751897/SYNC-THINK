// NewMax HtmlPreview: a ```html (or ```htm) fence renders as a sanitized
// iframe srcDoc with a fixed 420px stage. No JSON UI-kit schema, no tag-stack
// validator, and no "format invalid" card — DOMPurify + the browser parse the
// markup the same way NewMax does.
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import createDOMPurify from 'dompurify';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Eye,
} from 'lucide-react';
import { highlightSource } from './highlight.js';
import type { OpenHtmlInBrowser } from './html-browser.js';

interface HtmlSandboxProps {
  code: string;
  actions?: ReactNode;
  /** Open the document in the embedded browser tab when the shell provides one. */
  onOpenInBrowser?: OpenHtmlInBrowser;
}

/** Max source size accepted by the browser-open bridge (8 MiB). */
const MAX_OPEN_HTML = 8 * 1024 * 1024;

type ViewMode = 'preview' | 'source';

function sanitizeHtmlDocument(source: string): string {
  const purifier = typeof window === 'undefined' ? null : createDOMPurify(window);
  const sanitized =
    purifier?.sanitize(source.replace(/\n$/, ''), {
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
  return `${doctype}${document.documentElement.outerHTML}`;
}

export function HtmlSandbox({ code, actions, onOpenInBrowser }: HtmlSandboxProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<ViewMode>('preview');
  const [copied, setCopied] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const source = code.replace(/\n$/, '');
  const previewHtml = useMemo(() => sanitizeHtmlDocument(source), [source]);

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
      if (onOpenInBrowser) {
        await onOpenInBrowser(source);
        return;
      }
      const blob = new Blob([source], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      setOpenError('打开失败');
    }
  }, [onOpenInBrowser, source]);

  const handleDownload = useCallback(() => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/html;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `preview-${Date.now()}.html`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }, [source]);

  return (
    <div className="shell-html shell-html--fenced">
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
          <span className="shell-md-code__lang">HTML</span>
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
            title="在浏览器中打开"
          >
            <ExternalLink size={12} />
            <span>浏览器打开</span>
          </button>
          <button
            type="button"
            className="shell-md-code__action"
            onClick={handleDownload}
            title="下载 HTML"
          >
            <Download size={12} />
            <span>下载</span>
          </button>
          {actions}
        </div>
      </div>
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
        ) : (
          <div className="shell-html__content" data-testid="html-sandbox-content">
            <iframe srcDoc={previewHtml} sandbox="allow-scripts" title="HTML 预览" />
          </div>
        )
      ) : null}
    </div>
  );
}
