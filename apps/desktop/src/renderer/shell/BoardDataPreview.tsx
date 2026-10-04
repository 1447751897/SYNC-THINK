import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toVisualizationDataUrl } from '../visualization/ui-kit.js';
import {
  useVisualizationGuest,
  VISUALIZATION_WEBVIEW_PREFERENCES,
} from '../visualization/use-visualization-guest.js';
import {
  readVisualizationDesignTokens,
  visualizationTheme,
  visualizationReduceMotion,
} from '../visualization/design-system.js';

/** Use the isolated guest in Electron: srcDoc would inherit the host's stricter CSP. */
export function BoardDataPreview({
  html,
  inline = false,
  initialHeight = 420,
}: {
  html: string;
  inline?: boolean;
  initialHeight?: number;
}) {
  // Single data components grow with chat; page-design previews keep their bounded stage.
  const maxHeight = inline ? 10_000 : 960;
  const native = /Electron\//.test(navigator.userAgent) && Boolean(window.syncThink);
  const src = useMemo(() => toVisualizationDataUrl(html), [html]);
  const guest = useVisualizationGuest({
    src: native ? src : null,
    active: native,
    initialHeight,
    minHeight: 120,
    maxHeight,
  });
  const iframe = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(initialHeight);
  const sendTheme = useCallback(
    () =>
      iframe.current?.contentWindow?.postMessage(
        {
          type: 'sync-think-boardui-theme',
          theme: visualizationTheme(),
          tokens: readVisualizationDesignTokens(),
          reduceMotion: visualizationReduceMotion(),
        },
        '*',
      ),
    [],
  );
  useEffect(() => {
    if (native) return;
    setHeight(initialHeight);
    const receive = (event: MessageEvent) => {
      if (
        event.source !== iframe.current?.contentWindow ||
        event.data?.type !== 'sync-think-boardui-height'
      )
        return;
      const next = event.data.height;
      if (typeof next === 'number' && Number.isFinite(next))
        setHeight(Math.max(120, Math.min(maxHeight, Math.ceil(next))));
    };
    window.addEventListener('message', receive);
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-motion'],
    });
    return () => {
      window.removeEventListener('message', receive);
      observer.disconnect();
    };
  }, [native, html, sendTheme, maxHeight, initialHeight]);
  if (native && guest.status === 'error')
    return (
      <div className="shell-html__error" role="alert">
        <span>数据预览加载失败，源码仍保留。</span>
        <button type="button" onClick={guest.reload}>
          重试
        </button>
      </div>
    );
  return (
    <div
      className="shell-html__content"
      data-testid="html-sandbox-content"
      data-data-components="true"
      aria-busy={native && guest.status === 'loading'}
      style={{ height: native ? guest.height : height }}
    >
      {native ? (
        <webview
          ref={guest.webviewRef as never}
          partition={guest.partition}
          webpreferences={VISUALIZATION_WEBVIEW_PREFERENCES}
          data-testid="board-data-webview"
          data-visualization-file="chat-data.html"
          style={{ display: 'flex', width: '100%', height: '100%', border: 0 }}
        />
      ) : (
        <iframe
          ref={iframe}
          srcDoc={html}
          sandbox="allow-scripts allow-downloads"
          onLoad={sendTheme}
          title="数据预览"
        />
      )}
    </div>
  );
}
