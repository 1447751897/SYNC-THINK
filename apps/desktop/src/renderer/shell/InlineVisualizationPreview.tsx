import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import {
  buildVisualizationDocument,
  type InlineVisualizationSegment,
} from './inline-visualization.js';
import { visualizationReduceMotion, visualizationTheme } from '../visualization/design-system.js';
import {
  VISUALIZATION_WEBVIEW_PREFERENCES,
  useVisualizationGuest,
} from '../visualization/use-visualization-guest.js';
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
}: InlineVisualizationPreviewProps) {
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

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

  const documentUrl = useMemo(
    () =>
      source === null
        ? null
        : buildVisualizationDocument(source, {
            theme: visualizationTheme(),
            reduceMotion: visualizationReduceMotion(),
          }),
    [source],
  );
  const guest = useVisualizationGuest({
    src: documentUrl,
    active: source !== null && !loading && !error,
    initialHeight: DEFAULT_HEIGHT,
    minHeight: MIN_HEIGHT,
    maxHeight: MAX_HEIGHT,
  });
  const failed = !loading && (error !== null || guest.status === 'error');
  const ready = !loading && source !== null && guest.status === 'ready';

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
      </div>
    );
  }

  return (
    <section
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
