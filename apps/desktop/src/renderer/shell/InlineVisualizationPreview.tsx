import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Code2,
  ExternalLink,
  FileBarChart2,
  LoaderCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { highlightSource } from './highlight.js';
import {
  buildVisualizationDocument,
  visualizationFileLabel,
  type InlineVisualizationSegment,
} from './inline-visualization.js';
import type { OpenHtmlInBrowser } from './html-browser.js';

const MAX_VISUALIZATION_BYTES = 2 * 1024 * 1024;
const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 96;
const MAX_HEIGHT = 1_200;

interface InlineVisualizationPreviewProps {
  file: InlineVisualizationSegment['file'];
  projectFolder?: string;
  conversationId?: string;
  onOpenInBrowser?: OpenHtmlInBrowser;
}

interface VisualizationWebview extends HTMLElement {
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
  reload?: () => void;
}

const MEASURE_SCRIPT = `(() => {
  const root = document.querySelector('main.viz-root') || document.body;
  if (!root) return 0;
  const rect = root.getBoundingClientRect();
  const childBottom = Array.from(root.children).reduce((max, child) => {
    const childRect = child.getBoundingClientRect();
    return Math.max(max, childRect.bottom - rect.top);
  }, 0);
  return Math.ceil(Math.max(childBottom, root.scrollHeight, root.offsetHeight, 0));
})()`;

function visualizationTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function visualizationBackground(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-chat')
    .trim();
  return value || 'Canvas';
}

function formatReadError(error: string | null | undefined): string {
  return error?.trim() || '可视化文件读取失败';
}

export function InlineVisualizationPreview({
  file,
  projectFolder,
  conversationId,
  onOpenInBrowser,
}: InlineVisualizationPreviewProps) {
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [copied, setCopied] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const webviewRef = useRef<VisualizationWebview | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    setOpenError(null);
    setSource(null);
    setHeight(DEFAULT_HEIGHT);
    if (!projectFolder) {
      setError('当前对话没有绑定项目，无法读取可视化文件');
      setLoading(false);
      return;
    }
    const bridge = window.syncThink?.runtime;
    if (!bridge?.readProjectFile) {
      setError('当前环境不支持读取可视化文件');
      setLoading(false);
      return;
    }
    try {
      const result = await bridge.readProjectFile({ root: projectFolder, path: file });
      if (requestId !== requestRef.current) return;
      if (result.error || result.content === null) {
        setError(formatReadError(result.error));
        return;
      }
      if (new TextEncoder().encode(result.content).byteLength > MAX_VISUALIZATION_BYTES) {
        setError('可视化文件超过 2MB 限制');
        return;
      }
      setSource(result.content);
    } catch (readError) {
      if (requestId === requestRef.current) {
        setError(readError instanceof Error ? readError.message : '可视化文件读取失败');
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [file, projectFolder]);

  useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load, conversationId]);

  const documentUrl = useMemo(
    () =>
      source
        ? buildVisualizationDocument(source, {
            theme: visualizationTheme(),
            background: visualizationBackground(),
          })
        : '',
    [source],
  );

  const measure = useCallback(() => {
    const viewElement = webviewRef.current;
    if (!viewElement || typeof viewElement.executeJavaScript !== 'function') return;
    let pending: Promise<unknown>;
    try {
      pending = viewElement.executeJavaScript(MEASURE_SCRIPT);
    } catch {
      return;
    }
    void pending
      .then((value) => {
        const next = Number(value);
        if (!Number.isFinite(next) || next <= 0) return;
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(next))));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!source || view !== 'preview') return;
    measure();
    const timers = [80, 280, 800].map((delay) => window.setTimeout(measure, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [measure, source, view, documentUrl]);

  useEffect(() => {
    const viewElement = webviewRef.current;
    if (!viewElement || typeof viewElement.addEventListener !== 'function') return;
    const onReady = () => {
      measure();
      window.setTimeout(measure, 220);
    };
    viewElement.addEventListener('dom-ready', onReady);
    viewElement.addEventListener('did-finish-load', onReady);
    return () => {
      viewElement.removeEventListener('dom-ready', onReady);
      viewElement.removeEventListener('did-finish-load', onReady);
    };
  }, [measure, documentUrl, view]);

  const handleCopy = useCallback(async () => {
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_400);
    } catch {
      setCopied(false);
    }
  }, [source]);

  const handleOpenInBrowser = useCallback(async () => {
    if (!source) return;
    setOpenError(null);
    try {
      if (onOpenInBrowser) {
        // The source already lives in the project. Reuse that file so relative
        // assets resolve exactly as they do in NewMax's file-backed viewer.
        await onOpenInBrowser(source, { relativePath: file, persist: false });
        return;
      }
      const bridge = window.syncThink?.runtime;
      if (!bridge?.openHtmlInBrowser) throw new Error('当前环境不支持在浏览器中打开');
      const result = await bridge.openHtmlInBrowser(source);
      if (!result.ok) throw new Error(result.error ?? '打开失败');
    } catch (openFailure) {
      setOpenError(openFailure instanceof Error ? openFailure.message : '打开失败');
    }
  }, [file, onOpenInBrowser, source]);

  const title = visualizationFileLabel(file);
  return (
    <section className="shell-inline-vis" data-testid="inline-visualization" data-file={file}>
      <header className="shell-inline-vis__bar">
        <div className="shell-inline-vis__identity">
          <FileBarChart2 size={14} aria-hidden="true" />
          <span className="shell-inline-vis__title" title={file}>
            {title}
          </span>
          {conversationId ? <span className="shell-inline-vis__badge">可视化</span> : null}
        </div>
        <div className="shell-inline-vis__actions">
          <button
            type="button"
            className={`shell-inline-vis__tab${view === 'preview' ? ' is-active' : ''}`}
            aria-pressed={view === 'preview'}
            onClick={() => setView('preview')}
          >
            预览
          </button>
          <button
            type="button"
            className={`shell-inline-vis__tab${view === 'source' ? ' is-active' : ''}`}
            aria-pressed={view === 'source'}
            onClick={() => setView('source')}
          >
            <Code2 size={12} aria-hidden="true" />
            源码
          </button>
          <button
            type="button"
            className="shell-inline-vis__icon-action"
            title="重新加载可视化"
            aria-label="重新加载可视化"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? <LoaderCircle className="shell-inline-vis__spin" size={13} /> : <RefreshCw size={13} />}
          </button>
          <button
            type="button"
            className="shell-inline-vis__icon-action"
            title={copied ? '已复制' : '复制源码'}
            aria-label={copied ? '已复制' : '复制源码'}
            onClick={() => void handleCopy()}
            disabled={!source}
          >
            {copied ? <Check size={13} /> : <Code2 size={13} />}
          </button>
          <button
            type="button"
            className="shell-inline-vis__icon-action"
            title="在浏览器中打开"
            aria-label="在浏览器中打开"
            onClick={() => void handleOpenInBrowser()}
            disabled={!source}
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </header>
      {openError ? (
        <div className="shell-inline-vis__notice shell-inline-vis__notice--error" role="alert">
          <X size={13} aria-hidden="true" />
          <span>{openError}</span>
        </div>
      ) : null}
      {loading ? (
        <div className="shell-inline-vis__skeleton" data-testid="inline-visualization-skeleton" aria-label="正在加载可视化">
          <div className="shell-inline-vis__skeleton-line shell-inline-vis__skeleton-line--wide" />
          <div className="shell-inline-vis__skeleton-line" />
          <div className="shell-inline-vis__skeleton-grid">
            <div />
            <div />
            <div />
          </div>
        </div>
      ) : error ? (
        <div className="shell-inline-vis__error" role="alert">
          <FileBarChart2 size={20} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : view === 'source' && source ? (
        <pre className="shell-inline-vis__source">
          <code dangerouslySetInnerHTML={{ __html: highlightSource(source, 'html') }} />
        </pre>
      ) : source ? (
        <div className="shell-inline-vis__viewport">
          <webview
            ref={webviewRef as never}
            src={documentUrl}
            data-testid="inline-visualization-webview"
            data-visualization-file={file}
            data-visualization-conversation-id={conversationId}
            className="shell-inline-vis__webview"
            style={{ height }}
          />
        </div>
      ) : null}
    </section>
  );
}
