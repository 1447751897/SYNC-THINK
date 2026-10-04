import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type HtmlPreviewSizing,
  HTML_PREVIEW_SIZE_MESSAGE,
  HTML_PREVIEW_VIEWPORT_MESSAGE,
  INITIAL_HTML_PREVIEW_HEIGHT,
  MAX_HTML_PREVIEW_REPORT,
  htmlPreviewAvailableHeight,
  htmlPreviewLayout,
  measuredHtmlPreviewDocument,
} from './html-preview-sizing.js';

/** Keep authored HTML in an opaque-origin iframe; accept size reports only. */
export function AdaptiveHtmlPreview({ html, sizing }: { html: string; sizing: HtmlPreviewSizing }) {
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const preview = useMemo(() => {
    const id = crypto.randomUUID();
    return { id, srcDoc: measuredHtmlPreviewDocument(html, id) };
  }, [html]);
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === 'undefined' ? 800 : window.innerHeight,
  );
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 800 : window.innerWidth,
  );
  const [measurement, setMeasurement] = useState<{
    id: string;
    width: number;
    height: number;
    containerWidth: number;
  } | null>(null);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const resize = () => {
      const width = element.clientWidth - 8; // horizontal stage padding
      if (width > 0) setViewportWidth(width);
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(element);
    window.addEventListener('resize', resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);

  useEffect(() => {
    const resize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!frame.current?.contentWindow || event.source !== frame.current.contentWindow) return;
      const report: unknown = event.data;
      if (!report || typeof report !== 'object') return;
      const data = report as Record<string, unknown>;
      if (
        data.type !== HTML_PREVIEW_SIZE_MESSAGE ||
        data.documentId !== preview.id ||
        typeof data.height !== 'number' ||
        !Number.isFinite(data.height) ||
        data.height <= 0 ||
        data.height > MAX_HTML_PREVIEW_REPORT ||
        typeof data.width !== 'number' ||
        !Number.isFinite(data.width) ||
        data.width <= 0 ||
        data.width > MAX_HTML_PREVIEW_REPORT
      ) return;
      setMeasurement({ id: preview.id, width: data.width, height: data.height, containerWidth: viewportWidth });
    };
    window.addEventListener('message', receive);
    return () => {
      window.removeEventListener('message', receive);
    };
  }, [preview.id, viewportWidth]);

  const sendViewport = useCallback(() => {
    frame.current?.contentWindow?.postMessage({
      type: HTML_PREVIEW_VIEWPORT_MESSAGE,
      documentId: preview.id,
      height: htmlPreviewAvailableHeight(viewportHeight),
    }, '*');
  }, [preview.id, viewportHeight]);
  useEffect(sendViewport, [sendViewport]);

  // Re-measure at the new panel width instead of retaining a previously wider
  // iframe viewport. This also lets responsive pages shrink and grow naturally.
  const current = measurement?.id === preview.id && measurement.containerWidth === viewportWidth
    ? measurement : null;
  const layout = htmlPreviewLayout(
    current?.height ?? INITIAL_HTML_PREVIEW_HEIGHT,
    viewportHeight,
    sizing === 'fit',
    current?.width ?? viewportWidth,
    viewportWidth,
    sizing === 'content',
  );

  return (
    <div
      ref={stage}
      className="shell-html__content shell-html__content--adaptive"
      data-testid="html-sandbox-content"
      data-preview-sizing={sizing}
      style={{ height: layout.height + 4 }}
    >
      <iframe
        ref={frame}
        srcDoc={preview.srcDoc}
        sandbox="allow-scripts"
        title="HTML 预览"
        onLoad={sendViewport}
        style={{
          width: layout.frameWidth,
          height: layout.frameHeight,
          marginLeft: -layout.frameWidth / 2,
          transform: `scale(${layout.scale})`,
        }}
      />
    </div>
  );
}
