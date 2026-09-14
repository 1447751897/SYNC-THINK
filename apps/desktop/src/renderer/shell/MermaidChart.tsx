// Mermaid block renderer, rebuilt to match NewMax's `MermaidPreview`.
//
// Differences from the previous implementation, all taken from NewMax:
// - no card header / 预览·源码 tabs; the toolbar is a floating pill that only
//   appears on hover (放大 / 复制图片 / 下载 PNG)
// - the whole diagram area is click-to-zoom (cursor: zoom-in)
// - the rendered SVG lives in an open shadow root, styled by
//   getMermaidShadowCSS, and goes through NewMax's post-process pipeline
// - source is sanitized (style/classDef colour lines dropped) and, for
//   flowcharts, repaired (labels containing brackets get quoted) before parse
// - a theme MutationObserver re-initializes and re-renders on light/dark switch
// - renders are debounced 300ms and skipped while the block is off-screen
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Check,
  Copy,
  Download,
  Columns2,
  LoaderCircle,
  Maximize2,
  Minus,
  Plus,
  X,
} from 'lucide-react';
import { loadMermaidVendor, type MermaidVendor } from './mermaid-vendor-loader.js';
import { getMermaidConfig, getMermaidThemeVars, isDarkTheme } from '../mermaid/mermaid-theme.js';
import { repairMermaidLabels, sanitizeMermaidSource } from '../mermaid/mermaid-source.js';
import {
  getExportSvg,
  renderSvgInShadowHost,
  svgToPngBlob,
  type MermaidExport,
} from '../mermaid/mermaid-render.js';

interface MermaidChartProps {
  code: string;
}

const RENDER_DEBOUNCE_MS = 300;
const RENDER_ERROR_DELAY_MS = 800;
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
const mermaidSvgCache = new Map<string, string>();

function uniqueId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `sync-mermaid-${rand}`;
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function MermaidChart({ code }: MermaidChartProps) {
  const [vendor, setVendor] = useState<MermaidVendor | null>(null);
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [forceRenderKey, setForceRenderKey] = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [hasRendered, setHasRendered] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [copied, setCopied] = useState(false);
  const [zoomData, setZoomData] = useState<MermaidExport | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [fitMode, setFitMode] = useState<'screen' | 'width' | 'manual'>('screen');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; zoom: boolean } | null>(
    null,
  );
  const [containerWidth, setContainerWidth] = useState(0);

  const diagramId = useRef(uniqueId()).current;
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTimerRef = useRef<number | undefined>(undefined);
  const [zoomContainer, setZoomContainer] = useState<HTMLDivElement | null>(null);
  const zoomImageRef = useRef<HTMLImageElement>(null);
  const pendingZoomAnchorRef = useRef<{
    clientX: number;
    clientY: number;
    rx: number;
    ry: number;
  } | null>(null);
  const copyTimerRef = useRef<number | undefined>(undefined);

  // ── vendor load + theme observer (NewMax `useMermaid`) ────────────────────
  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      try {
        const loaded = await loadMermaidVendor();
        if (!mounted) return;
        setForceRenderKey((prev) => prev + 1);
        setVendorError(null);
        setVendor(loaded);
      } catch (error) {
        if (!mounted) return;
        setVendorError(error instanceof Error ? error.message : 'Failed to initialize Mermaid');
      }
    };
    void initialize();
    let dark = isDarkTheme();
    const observer = new MutationObserver(() => {
      if (dark === isDarkTheme()) return;
      dark = isDarkTheme();
      setForceRenderKey((prev) => prev + 1);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      mounted = false;
      observer.disconnect();
      window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  // ── visibility: content-visibility rows only render once on screen ────────
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const check = () => {
      const el = containerRef.current?.parentElement;
      if (!el) return;
      setIsVisible(el.offsetParent !== null && el.offsetWidth > 0 && el.offsetHeight > 0);
      setContainerWidth(el.clientWidth);
    };
    check();
    const observer = new MutationObserver(check);
    let target: HTMLElement | null = element.parentElement;
    while (target) {
      observer.observe(target, { attributes: true, attributeFilter: ['class', 'style'] });
      if (target.className?.includes('fold')) break;
      target = target.parentElement;
    }
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    resizeObserver?.observe(element.parentElement || element);
    return () => {
      observer.disconnect();
      resizeObserver?.disconnect();
    };
  }, []);

  // ── render pipeline (NewMax `renderMermaid`) ──────────────────────────────
  const renderMermaid = useCallback(
    async (content: string, container: HTMLElement): Promise<string | null> => {
      if (!vendor) return null;
      const { width } = container.getBoundingClientRect();
      if (width === 0) return null;
      vendor.initialize(getMermaidConfig(getMermaidThemeVars(isDarkTheme()), isDarkTheme()));
      const sanitized = sanitizeMermaidSource(content);
      let rendered = sanitized;
      try {
        await vendor.parse(sanitized);
      } catch (parseError) {
        const repaired = repairMermaidLabels(sanitized);
        if (repaired !== sanitized) {
          await vendor.parse(repaired).catch(() => {
            throw parseError;
          });
          rendered = repaired;
        } else {
          throw parseError;
        }
      }
      const measureEl = document.createElement('div');
      measureEl.style.position = 'absolute';
      measureEl.style.left = '-9999px';
      measureEl.style.top = '-9999px';
      measureEl.style.width = `${width}px`;
      document.body.appendChild(measureEl);
      try {
        const { svg } = await vendor.render(`${diagramId}-${uniqueId()}`, rendered, measureEl);
        const fixedSvg = svg.replace(/translate\(undefined,\s*NaN\)/g, 'translate(0, 0)');
        return fixedSvg;
      } finally {
        if (measureEl.parentNode) measureEl.parentNode.removeChild(measureEl);
      }
    },
    [diagramId, vendor],
  );

  useEffect(() => {
    if (renderTimerRef.current !== undefined) window.clearTimeout(renderTimerRef.current);
    if (!vendor || !isVisible) return;
    let active = true;
    let errorTimer: number | undefined;
    const cacheKey = `${isDarkTheme() ? 'dark' : 'light'}:${code}`;
    setRenderError(null);
    const cached = mermaidSvgCache.get(cacheKey);
    if (cached && containerRef.current) {
      renderSvgInShadowHost(cached, containerRef.current);
      setHasRendered(true);
      setIsRendering(false);
      return;
    }
    setIsRendering(true);
    renderTimerRef.current = window.setTimeout(() => {
      renderTimerRef.current = undefined;
      const container = containerRef.current;
      if (!container) return;
      void renderMermaid(code, container)
        .then((svg) => {
          if (!active || !svg || !container.isConnected) return;
          renderSvgInShadowHost(svg, container);
          mermaidSvgCache.set(cacheKey, svg);
          if (mermaidSvgCache.size > 64)
            mermaidSvgCache.delete(mermaidSvgCache.keys().next().value!);
          setRenderError(null);
          setHasRendered(true);
        })
        .catch((error) => {
          if (!active) return;
          errorTimer = window.setTimeout(() => {
            if (active)
              setRenderError(error instanceof Error ? error.message : 'Unknown rendering error');
          }, RENDER_ERROR_DELAY_MS);
        })
        .finally(() => {
          if (active) setIsRendering(false);
        });
    }, RENDER_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(errorTimer);
      if (renderTimerRef.current !== undefined) window.clearTimeout(renderTimerRef.current);
    };
  }, [code, vendor, isVisible, forceRenderKey, renderMermaid, containerWidth]);

  const error = vendorError || renderError;
  const isLoading = !vendor || isRendering;
  const showInitialLoader = isLoading && !hasRendered && !error;
  const showToolbar = hasRendered && !error;

  const handleCopyImage = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    const data = getExportSvg(container);
    if (!data) return;
    const blob = await svgToPngBlob(data.svg, data.width, data.height);
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  const handleDownload = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    const data = getExportSvg(container);
    if (!data) return;
    const blob = await svgToPngBlob(data.svg, data.width, data.height);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `diagram-${Date.now()}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, []);

  const handleZoom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const data = getExportSvg(container);
    if (!data) return;
    setScale(1);
    setFitMode('screen');
    setZoomData(data);
    setZoomOpen(true);
  }, []);

  const zoomSrc = useMemo(() => (zoomData ? svgToDataUrl(zoomData.svg) : ''), [zoomData]);

  const fitZoom = useCallback(
    (mode: 'screen' | 'width') => {
      const container = zoomContainer;
      if (!container || !zoomData) return;
      const width = container.clientWidth - 96;
      const height = container.clientHeight - 96;
      if (width <= 0 || height <= 0) return;
      const fitted =
        mode === 'width'
          ? width / zoomData.width
          : Math.min(width / zoomData.width, height / zoomData.height);
      setScale(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitted)));
    },
    [zoomData, zoomContainer],
  );

  useEffect(() => {
    if (!zoomOpen) return;
    const container = zoomContainer;
    if (!container) return;
    const fit = () => {
      if (fitMode !== 'manual') fitZoom(fitMode);
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(container);
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = zoomImageRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        pendingZoomAnchorRef.current = {
          clientX: event.clientX,
          clientY: event.clientY,
          rx: (event.clientX - rect.left) / rect.width,
          ry: (event.clientY - rect.top) / rect.height,
        };
      }
      setFitMode('manual');
      setScale((previous) =>
        Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, previous * Math.exp(-event.deltaY * 0.01))),
      );
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      observer?.disconnect();
      container.removeEventListener('wheel', handleWheel);
    };
  }, [zoomOpen, fitMode, fitZoom, zoomContainer]);

  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    pendingZoomAnchorRef.current = null;
    const container = zoomContainer;
    const rect = zoomImageRef.current?.getBoundingClientRect();
    if (!anchor || !container || !rect) return;
    container.scrollLeft += rect.left - (anchor.clientX - anchor.rx * rect.width);
    container.scrollTop += rect.top - (anchor.clientY - anchor.ry * rect.height);
  }, [scale, zoomContainer]);

  const openContextMenu = (event: React.MouseEvent, zoom = false) => {
    if (!showToolbar) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, zoom });
  };

  return (
    <div className="shell-mermaid">
      {showInitialLoader ? (
        <div className="shell-mermaid__loader" role="status" aria-label="正在渲染图表">
          <LoaderCircle size={20} className="shell-mermaid__spinner" aria-hidden="true" />
        </div>
      ) : null}
      {error ? (
        <div className="shell-mermaid--error" role="alert">
          <span className="shell-mermaid__error-title">Mermaid 图表渲染失败</span>
          <span className="shell-mermaid__error-msg">{error}</span>
        </div>
      ) : null}
      {showToolbar ? (
        <div className="shell-mermaid__toolbar">
          <button
            type="button"
            className="shell-mermaid__tool"
            onClick={handleZoom}
            title="放大查看"
            aria-label="放大查看"
          >
            <Maximize2 size={16} />
          </button>
          <button
            type="button"
            className="shell-mermaid__tool"
            onClick={() => void handleCopyImage()}
            title={copied ? '已复制' : '复制图片'}
            aria-label={copied ? '已复制' : '复制图片'}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <button
            type="button"
            className="shell-mermaid__tool"
            onClick={() => void handleDownload()}
            title="下载 PNG"
            aria-label="下载 PNG"
          >
            <Download size={16} />
          </button>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="shell-mermaid__canvas"
        data-testid="mermaid-canvas"
        style={{
          ...(error ? { display: 'none' } : {}),
          ...(!hasRendered ? { minHeight: 160 } : {}),
          ...(showToolbar ? { cursor: 'zoom-in' } : {}),
        }}
        onClick={showToolbar ? handleZoom : undefined}
        onContextMenu={(event) => openContextMenu(event)}
      />

      <Dialog.Root
        open={zoomOpen}
        onOpenChange={(open) => {
          setZoomOpen(open);
          setContextMenu(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="shell-mermaid-lightbox__overlay" />
          <Dialog.Content
            className="shell-mermaid-lightbox__content"
            aria-describedby={undefined}
            onContextMenu={(event) => openContextMenu(event, true)}
          >
            <Dialog.Title className="shell-mermaid-lightbox__title">Mermaid 图表</Dialog.Title>
            <div
              ref={setZoomContainer}
              className="shell-mermaid-lightbox__canvas"
              onClick={(event) => {
                if (event.target === event.currentTarget) setZoomOpen(false);
              }}
            >
              <div
                className="shell-mermaid-lightbox__image-wrap"
                onClick={(event) => {
                  if (event.target === event.currentTarget) setZoomOpen(false);
                }}
              >
                {zoomData ? (
                  <img
                    ref={zoomImageRef}
                    src={zoomSrc}
                    alt="Mermaid 图表"
                    draggable={false}
                    onClick={(event) => event.stopPropagation()}
                    onLoad={() => {
                      if (fitMode !== 'manual') fitZoom(fitMode);
                    }}
                    style={{
                      width: zoomData.width * scale,
                      height: 'auto',
                      maxWidth: 'none',
                      display: 'block',
                    }}
                  />
                ) : null}
              </div>
            </div>
            <div className="shell-mermaid-lightbox__controls">
              <button
                type="button"
                className="shell-mermaid__tool"
                onClick={() => {
                  setFitMode('manual');
                  setScale((prev) => Math.max(ZOOM_MIN, prev - ZOOM_STEP));
                }}
                disabled={scale <= ZOOM_MIN}
                title="缩小"
                aria-label="缩小"
              >
                <Minus size={16} />
              </button>
              <span className="shell-mermaid-lightbox__percent">{Math.round(scale * 100)}%</span>
              <button
                type="button"
                className="shell-mermaid__tool"
                onClick={() => {
                  setFitMode('manual');
                  setScale((prev) => Math.min(ZOOM_MAX, prev + ZOOM_STEP));
                }}
                disabled={scale >= ZOOM_MAX}
                title="放大"
                aria-label="放大"
              >
                <Plus size={16} />
              </button>
              <button
                type="button"
                className="shell-mermaid__tool"
                onClick={() => {
                  setFitMode('screen');
                  fitZoom('screen');
                }}
                aria-pressed={fitMode === 'screen'}
                aria-label="适应窗口"
                title="适应窗口"
              >
                <Maximize2 size={16} />
              </button>
              <button
                type="button"
                className="shell-mermaid__tool"
                onClick={() => {
                  setFitMode('width');
                  fitZoom('width');
                }}
                aria-pressed={fitMode === 'width'}
                aria-label="适应宽度"
                title="适应宽度"
              >
                <Columns2 size={16} />
              </button>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="shell-mermaid-lightbox__close"
                title="关闭"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <DropdownMenu.Root
        open={contextMenu !== null}
        onOpenChange={(open) => {
          if (!open) setContextMenu(null);
        }}
        modal={false}
      >
        <DropdownMenu.Trigger asChild>
          <span
            style={{
              position: 'fixed',
              left: contextMenu?.x ?? 0,
              top: contextMenu?.y ?? 0,
              width: 1,
              height: 1,
              pointerEvents: 'none',
            }}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="shell-mermaid__context-menu"
            side="bottom"
            align="start"
            sideOffset={2}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <DropdownMenu.Item
              className="shell-mermaid__context-item"
              onSelect={() => {
                void handleCopyImage();
              }}
            >
              <Copy size={16} />
              复制图片
            </DropdownMenu.Item>
            {!contextMenu?.zoom ? (
              <DropdownMenu.Item className="shell-mermaid__context-item" onSelect={handleZoom}>
                <Maximize2 size={16} />
                放大查看
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item
              className="shell-mermaid__context-item"
              onSelect={() => {
                void handleDownload();
              }}
            >
              <Download size={16} />
              下载 PNG
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
