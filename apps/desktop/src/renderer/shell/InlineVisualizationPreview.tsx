import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import {
  buildVisualizationDocument,
  type InlineVisualizationSegment,
} from './inline-visualization.js';
import { hasBoardDataMarkup } from '../visualization/data-html.js';
import { loadBoardDataFont } from '../visualization/board-data-font-loader.js';
import { visualizationReduceMotion, visualizationTheme } from '../visualization/design-system.js';
import {
  VISUALIZATION_WEBVIEW_PREFERENCES,
  useVisualizationGuest,
} from '../visualization/use-visualization-guest.js';
import { HtmlSandbox } from './HtmlSandbox.js';
import type { OpenHtmlInBrowser } from './html-browser.js';

const MAX_VISUALIZATION_BYTES = 2 * 1024 * 1024;
const DEFAULT_HEIGHT = 240;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 10_000;
const SHADOW_GUTTER = 8;

interface InlineVisualizationPreviewProps {
  file: InlineVisualizationSegment['file'];
  projectFolder?: string;
  conversationId?: string;
  onOpenInBrowser?: OpenHtmlInBrowser;
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
  const requestRef = useRef(0);
  const stageRef = useRef<HTMLElement>(null);
  const reportedHeightRef = useRef(DEFAULT_HEIGHT);
  const [stageWidth, setStageWidth] = useState(0);
  const hasVideoPlayer = useMemo(() => {
    if (!source || typeof DOMParser === 'undefined' || !/<video\b/i.test(source)) return false;
    return Boolean(new DOMParser().parseFromString(source, 'text/html').querySelector('video[controls]:not([hidden])'));
  }, [source]);
  const videoHeightFloor = hasVideoPlayer ? Math.ceil(stageWidth * 9 / 16) : 0;
  const resolveReportedHeight = useCallback((reported: number) => {
    reportedHeightRef.current = reported;
    return Math.max(MIN_HEIGHT, Math.min(Math.max(Math.ceil(reported), videoHeightFloor), MAX_HEIGHT));
  }, [videoHeightFloor]);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    setSource(null);
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
      if (hasBoardDataMarkup(result.content) || /<table(?:\s|>)/i.test(result.content))
        await loadBoardDataFont();
      if (requestId !== requestRef.current) return;
      setSource(result.content);
    } catch (readError) {
      if (requestId === requestRef.current)
        setError(readError instanceof Error ? readError.message : '可视化文件读取失败');
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

  const handleOpenInBrowser = useMemo<OpenHtmlInBrowser | undefined>(() => {
    // Data documents need the portable renderer injected by HtmlSandbox; opening
    // their inert JSON source directly would lose the interactive data components.
    if (!onOpenInBrowser || (source !== null && hasBoardDataMarkup(source))) {
      return onOpenInBrowser;
    }
    return (html) => onOpenInBrowser(html, { relativePath: file, persist: false });
  }, [file, onOpenInBrowser, source]);

  const dataOnly =
    source !== null &&
    hasBoardDataMarkup(source) &&
    !new DOMParser()
      .parseFromString(source, 'text/html')
      .querySelector('[data-boardui-layout="custom"]');
  const documentUrl = useMemo(
    () =>
      source === null || dataOnly
        ? null
        : buildVisualizationDocument(source, {
            theme: visualizationTheme(),
            reduceMotion: visualizationReduceMotion(),
          }),
    [source, dataOnly],
  );
  const guest = useVisualizationGuest({
    src: documentUrl,
    active: source !== null && !dataOnly && !loading && !error,
    initialHeight: DEFAULT_HEIGHT,
    minHeight: MIN_HEIGHT,
    maxHeight: MAX_HEIGHT,
    readyTimeoutMs: 15_000,
    resolveReportedHeight,
  });
  const failed = !loading && (error !== null || guest.status === 'error');
  const ready = !loading && source !== null && guest.status === 'ready';

  // A media guest can report its minimum height before metadata/layout settles.
  // Keep a width-based floor without resetting the guest handshake on resize.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !hasVideoPlayer || dataOnly || failed) return;
    const resize = () => {
      const width = stage.clientWidth - SHADOW_GUTTER * 2;
      if (width > 0) setStageWidth(width);
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(stage);
    window.addEventListener('resize', resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [hasVideoPlayer, dataOnly, failed]);

  const setGuestHeight = guest.setHeight;
  useLayoutEffect(() => {
    if (hasVideoPlayer && !dataOnly && !failed) {
      setGuestHeight(resolveReportedHeight(reportedHeightRef.current));
    }
  }, [hasVideoPlayer, dataOnly, failed, resolveReportedHeight, setGuestHeight]);

  if (dataOnly && source !== null && !loading && !error)
    return <HtmlSandbox code={source} onOpenInBrowser={handleOpenInBrowser} />;

  if (failed) {
    return (
      <div className="shell-inline-vis" data-testid="inline-visualization-error" data-file={file}>
        <div className="shell-inline-vis__error" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <div>
            <span>可视化加载失败</span>
            {(error ?? guest.errorDetail) ? (
              <div className="shell-inline-vis__error-detail">{error ?? guest.errorDetail}</div>
            ) : null}
          </div>
          <button type="button" onClick={() => void load()}>
            <RefreshCw size={14} aria-hidden="true" />
            重试
          </button>
        </div>
        {source !== null && <details className="shell-inline-vis__fallback">
          <summary>查看静态预览与源码</summary>
          <p className="shell-inline-vis__fallback-note">静态预览保留页面内容；交互功能请用“浏览器打开”。</p>
          <HtmlSandbox code={source} onOpenInBrowser={handleOpenInBrowser} />
        </details>}
      </div>
    );
  }

  return (
    <section
      ref={stageRef}
      className="shell-inline-vis"
      data-testid="inline-visualization"
      data-file={file}
      aria-busy={!ready}
      style={{
        minHeight: ready ? guest.height : DEFAULT_HEIGHT,
        width: `calc(100% + ${SHADOW_GUTTER * 2}px)`,
        marginInline: -SHADOW_GUTTER,
        paddingInline: SHADOW_GUTTER,
      }}
    >
      {!ready ? (
        <div
          className="shell-inline-vis__skeleton"
          data-testid="inline-visualization-skeleton"
          aria-label="正在加载可视化"
        />
      ) : null}
      {documentUrl !== null && !loading ? (
        <div className="shell-inline-vis__viewport">
          <webview
            ref={guest.webviewRef as never}
            partition={guest.partition}
            webpreferences={VISUALIZATION_WEBVIEW_PREFERENCES}
            data-testid="inline-visualization-webview"
            data-visualization-file={file}
            data-visualization-conversation-id={conversationId}
            className="shell-inline-vis__webview"
            style={{
              height: guest.height,
              opacity: ready ? 1 : 0,
              width: `calc(100% + ${SHADOW_GUTTER * 2}px)`,
              marginInline: -SHADOW_GUTTER,
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
