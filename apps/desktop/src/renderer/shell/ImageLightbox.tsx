import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  Maximize2,
  Minus,
  Plus,
  X,
} from 'lucide-react';
import { downloadFileNameForImageSrc } from './markdown-image-gallery.js';

export type ImageLightboxItem = {
  src: string;
  alt?: string;
};

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.15;

async function downloadOriginal(src: string, alt?: string): Promise<void> {
  const response = await fetch(src);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = downloadFileNameForImageSrc(src, alt?.trim() ? `${alt.trim()}.png` : 'image.png');
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

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
  const [scale, setScale] = useState(1);
  const [fitMode, setFitMode] = useState<'screen' | 'width' | 'manual'>('screen');
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const active = images[Math.min(Math.max(activeIndex, 0), Math.max(images.length - 1, 0))];

  const fitZoom = useCallback((mode: 'screen' | 'width') => {
    const container = containerRef.current;
    const image = imageRef.current;
    if (!container || !image) return;
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) return;
    const next =
      mode === 'width'
        ? container.clientWidth / width
        : Math.min(container.clientWidth / width, container.clientHeight / height, 1);
    setScale(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)));
  }, []);

  useEffect(() => {
    if (!open) return;
    setFitMode('screen');
    setScale(1);
    setNatural({ width: 0, height: 0 });
  }, [open, active?.src]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowLeft' && images.length > 1) {
        onChangeIndex?.((activeIndex - 1 + images.length) % images.length);
      }
      if (event.key === 'ArrowRight' && images.length > 1) {
        onChangeIndex?.((activeIndex + 1) % images.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, images.length, activeIndex, onClose, onChangeIndex]);

  if (!open || !active || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="shell-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      data-testid="image-gallery-lightbox"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        className="shell-image-lightbox__canvas"
        data-testid="image-gallery-scroll-area"
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          const direction = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
          setFitMode('manual');
          setScale((prev) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev + direction)));
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
            if (fitMode !== 'manual') fitZoom(fitMode === 'width' ? 'width' : 'screen');
          }}
          style={{
            width: natural.width ? natural.width * scale : 'auto',
            height: 'auto',
            maxWidth: 'none',
          }}
        />
      </div>
      {images.length > 1 ? (
        <>
          <button
            type="button"
            className="shell-image-lightbox__nav is-prev"
            data-testid="image-gallery-lightbox-prev-surface"
            title="上一张"
            aria-label="上一张"
            onClick={(event) => {
              event.stopPropagation();
              onChangeIndex?.((activeIndex - 1 + images.length) % images.length);
            }}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="shell-image-lightbox__nav is-next"
            data-testid="image-gallery-lightbox-next-surface"
            title="下一张"
            aria-label="下一张"
            onClick={(event) => {
              event.stopPropagation();
              onChangeIndex?.((activeIndex + 1) % images.length);
            }}
          >
            <ChevronRight size={18} />
          </button>
        </>
      ) : null}
      <div className="shell-image-lightbox__controls" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          title="缩小"
          aria-label="缩小"
          disabled={scale <= ZOOM_MIN}
          onClick={() => {
            setFitMode('manual');
            setScale((prev) => Math.max(ZOOM_MIN, prev - ZOOM_STEP));
          }}
        >
          <Minus size={16} />
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button
          type="button"
          title="放大"
          aria-label="放大"
          disabled={scale >= ZOOM_MAX}
          onClick={() => {
            setFitMode('manual');
            setScale((prev) => Math.min(ZOOM_MAX, prev + ZOOM_STEP));
          }}
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          title="适应窗口"
          aria-label="适应窗口"
          aria-pressed={fitMode === 'screen'}
          onClick={() => {
            setFitMode('screen');
            fitZoom('screen');
          }}
        >
          <Maximize2 size={16} />
        </button>
        <button
          type="button"
          title="适应宽度"
          aria-label="适应宽度"
          aria-pressed={fitMode === 'width'}
          onClick={() => {
            setFitMode('width');
            fitZoom('width');
          }}
        >
          <Columns2 size={16} />
        </button>
        <button
          type="button"
          title="下载原图"
          aria-label="下载原图"
          onClick={() => void downloadOriginal(active.src, active.alt)}
        >
          <Download size={16} />
        </button>
      </div>
      <button
        type="button"
        className="shell-image-lightbox__close"
        title="关闭"
        aria-label="关闭"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <X size={16} />
      </button>
    </div>,
    document.body,
  );
}
