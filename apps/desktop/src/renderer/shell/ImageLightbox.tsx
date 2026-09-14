import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  Maximize2,
  Minus,
  Plus,
  X,
} from 'lucide-react';
import { DsTabBar } from './DsTabBar.js';
import {
  computeImageLightboxFitScale,
  copyImageSrcToClipboard,
  downloadImageSrcOriginal,
} from './markdown-image-gallery.js';

export type ImageLightboxItem = {
  src: string;
  alt?: string;
};

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.25;

export function ImageLightbox({
  open,
  images,
  activeIndex,
  onClose,
  onChangeIndex,
}: {
  open: boolean;
  images: readonly ImageLightboxItem[];
  activeIndex: number;
  onClose: () => void;
  onChangeIndex?: (index: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pendingAnchorRef = useRef<{
    clientX: number;
    clientY: number;
    rx: number;
    ry: number;
  } | null>(null);
  const [scale, setScale] = useState(1);
  const [fitMode, setFitMode] = useState<'screen' | 'width' | 'manual'>('screen');
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const total = images.length;
  const active = images[Math.min(Math.max(activeIndex, 0), Math.max(total - 1, 0))];

  const computeFitScale = useCallback(
    (mode: 'screen' | 'width') => {
      const container = containerRef.current;
      if (!container || !natural) return 1;
      return computeImageLightboxFitScale(mode, natural, {
        width: container.clientWidth,
        height: container.clientHeight,
      });
    },
    [natural],
  );

  useEffect(() => {
    if (!open) return;
    setScale(1);
    setFitMode('screen');
    setNatural(null);
    setContextMenu(null);
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open || fitMode === 'manual' || !natural) return;
    setScale(Math.max(ZOOM_MIN, computeFitScale(fitMode)));
  }, [open, fitMode, computeFitScale, natural]);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (fitMode === 'manual') return;
      setScale(Math.max(ZOOM_MIN, computeFitScale(fitMode)));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [open, fitMode, computeFitScale]);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const image = imageRef.current;
      if (image) {
        const rect = image.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          pendingAnchorRef.current = {
            clientX: event.clientX,
            clientY: event.clientY,
            rx: (event.clientX - rect.left) / rect.width,
            ry: (event.clientY - rect.top) / rect.height,
          };
        }
      }
      setFitMode('manual');
      setScale((previous) => {
        const factor = Math.exp(-event.deltaY * 0.01);
        return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, previous * factor));
      });
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [open]);

  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    const container = containerRef.current;
    const image = imageRef.current;
    if (!anchor || !container || !image) return;
    const rect = image.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    container.scrollLeft += rect.left - (anchor.clientX - anchor.rx * rect.width);
    container.scrollTop += rect.top - (anchor.clientY - anchor.ry * rect.height);
  }, [scale]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (event.key === 'ArrowLeft' && total > 1) {
        onChangeIndex?.((activeIndex - 1 + total) % total);
      }
      if (event.key === 'ArrowRight' && total > 1) {
        onChangeIndex?.((activeIndex + 1) % total);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, total, activeIndex, onClose, onChangeIndex]);

  const handleCopy = useCallback(async () => {
    setContextMenu(null);
    if (!active) return;
    if (await copyImageSrcToClipboard(active.src, imageRef.current)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [active]);

  const handleDownload = useCallback(async () => {
    setContextMenu(null);
    if (!active) return;
    await downloadImageSrcOriginal(active.src, active.alt || 'image', imageRef.current);
  }, [active]);

  const fitTabs = useMemo(
    () => [
      { value: 'screen' as const, icon: <Maximize2 size={16} />, tooltip: '适应窗口' },
      { value: 'width' as const, icon: <Columns2 size={16} />, tooltip: '适应宽度' },
    ],
    [],
  );

  if (!open || !active || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="shell-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      data-testid="image-gallery-lightbox"
    >
      <div
        ref={containerRef}
        className="shell-image-lightbox__canvas"
        data-testid="image-gallery-scroll-area"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          className="shell-image-lightbox__stage"
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <img
            ref={imageRef}
            className="shell-image-lightbox__img"
            src={active.src}
            alt={active.alt || '预览'}
            draggable={false}
            onLoad={() => {
              const image = imageRef.current;
              if (!image) return;
              setNatural({ width: image.naturalWidth, height: image.naturalHeight });
            }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({ x: event.clientX, y: event.clientY });
            }}
            style={
              natural
                ? {
                    width: natural.width * scale,
                    height: 'auto',
                    maxWidth: 'none',
                  }
                : {
                    maxWidth: '92vw',
                    maxHeight: '88vh',
                  }
            }
          />
        </div>
      </div>
      {total > 1 ? (
        <>
          <button
            type="button"
            className="shell-image-lightbox__nav is-prev"
            data-testid="image-gallery-lightbox-prev-surface"
            title="上一张"
            aria-label="上一张"
            onClick={() => onChangeIndex?.((activeIndex - 1 + total) % total)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="shell-image-lightbox__nav is-next"
            data-testid="image-gallery-lightbox-next-surface"
            title="下一张"
            aria-label="下一张"
            onClick={() => onChangeIndex?.((activeIndex + 1) % total)}
          >
            <ChevronRight size={18} />
          </button>
        </>
      ) : null}
      <div className="shell-image-lightbox__controls">
        <button
          type="button"
          title="缩小"
          aria-label="缩小"
          disabled={scale <= ZOOM_MIN}
          onClick={() => {
            setFitMode('manual');
            setScale((previous) => Math.max(ZOOM_MIN, previous - ZOOM_STEP));
          }}
        >
          <Minus size={16} />
        </button>
        <span className="shell-image-lightbox__percent">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          title="放大"
          aria-label="放大"
          disabled={scale >= ZOOM_MAX}
          onClick={() => {
            setFitMode('manual');
            setScale((previous) => Math.min(ZOOM_MAX, previous + ZOOM_STEP));
          }}
        >
          <Plus size={16} />
        </button>
        {total > 1 ? (
          <span className="shell-image-lightbox__index">
            {activeIndex + 1} / {total}
          </span>
        ) : null}
        <DsTabBar
          items={fitTabs}
          value={fitMode === 'width' ? 'width' : 'screen'}
          onChange={(next) => setFitMode(next)}
          aria-label="适应方式"
        />
      </div>
      <button
        type="button"
        className="shell-image-lightbox__close"
        title="关闭"
        aria-label="关闭"
        onClick={onClose}
      >
        <X size={16} />
      </button>
      <DropdownMenu.Root
        open={contextMenu !== null}
        onOpenChange={(next) => {
          if (!next) setContextMenu(null);
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
            className="shell-image-lightbox__menu"
            side="bottom"
            align="start"
            sideOffset={2}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <DropdownMenu.Item className="shell-image-lightbox__menu-item" onSelect={() => void handleCopy()}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? '已复制' : '复制图片'}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="shell-image-lightbox__menu-item"
              onSelect={() => void handleDownload()}
            >
              <Download size={16} />
              下载原图
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>,
    document.body,
  );
}
