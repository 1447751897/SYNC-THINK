import { useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Copy, Download, Maximize2 } from 'lucide-react';
import { ImageLightbox } from './ImageLightbox.js';
import {
  copyImageSrcToClipboard,
  downloadImageSrcOriginal,
  isGeneratedImageSrc,
  resolveGalleryGeneratedImageModel,
  type MarkdownGalleryImage,
} from './markdown-image-gallery.js';
import { GeneratedImageModelsContext } from './generated-image-models-context.js';

function GeneratedImageModelLabel({ model }: { model?: string }) {
  if (!model) return null;
  return (
    <div className="shell-md-image-model" data-testid="generated-image-model">
      生图模型 · {model}
    </div>
  );
}

export function MarkdownImageGallery({ images }: { images: readonly MarkdownGalleryImage[] }) {
  const models = useContext(GeneratedImageModelsContext);
  const imageRef = useRef<HTMLImageElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  if (images.length === 0) return null;
  const first = images[0]!;
  const generationModel = resolveGalleryGeneratedImageModel(images, models);
  const generated = images.some((image) => isGeneratedImageSrc(image.src));

  const copyActive = useCallback(async (src: string) => {
    setContextMenu(null);
    if (await copyImageSrcToClipboard(src, imageRef.current)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  const downloadActive = useCallback(async (src: string, alt: string) => {
    setContextMenu(null);
    await downloadImageSrcOriginal(src, alt || 'image', imageRef.current);
  }, []);

  const imageMenu = (src: string, alt: string, includeViewLarger: boolean) => (
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
          {includeViewLarger ? (
            <DropdownMenu.Item
              className="shell-image-lightbox__menu-item"
              onSelect={() => {
                setContextMenu(null);
                setOpen(true);
              }}
            >
              <Maximize2 size={16} />
              放大查看
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Item
            className="shell-image-lightbox__menu-item"
            onSelect={() => void copyActive(src)}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? '已复制' : '复制图片'}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="shell-image-lightbox__menu-item"
            onSelect={() => void downloadActive(src, alt)}
          >
            <Download size={16} />
            下载原图
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  if (images.length === 1) {
    const image = first;
    const imageElement = (
      <img
        ref={imageRef}
        src={image.src}
        alt={image.alt}
        loading="lazy"
        className="shell-md-image"
        style={{ cursor: 'zoom-in' }}
        onClick={() => {
          setActiveIndex(0);
          setOpen(true);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setActiveIndex(0);
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
      />
    );
    return (
      <>
        {generated || generationModel ? (
          <div
            data-testid="generated-image-frame"
            data-generated-image-card="true"
            className="shell-md-image-frame"
          >
            {imageElement}
            <div className="shell-md-image-tools">
              <button
                type="button"
                title="放大查看"
                aria-label="放大查看"
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveIndex(0);
                  setOpen(true);
                }}
              >
                <Maximize2 size={16} />
              </button>
              <button
                type="button"
                title={copied ? '已复制' : '复制图片'}
                aria-label={copied ? '已复制' : '复制图片'}
                onClick={(event) => {
                  event.stopPropagation();
                  void copyActive(image.src);
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
              <button
                type="button"
                title="下载原图"
                aria-label="下载原图"
                onClick={(event) => {
                  event.stopPropagation();
                  void downloadActive(image.src, image.alt);
                }}
              >
                <Download size={16} />
              </button>
            </div>
            <GeneratedImageModelLabel model={generationModel} />
          </div>
        ) : (
          imageElement
        )}
        <ImageLightbox
          open={open}
          images={images}
          activeIndex={0}
          onClose={() => setOpen(false)}
        />
        {imageMenu(image.src, image.alt, true)}
      </>
    );
  }

  const active = images[Math.min(activeIndex, images.length - 1)]!;
  return (
    <div className="shell-md-image-gallery" data-testid="markdown-image-gallery">
      <button
        type="button"
        className="shell-md-image-gallery__main"
        style={{ cursor: 'zoom-in' }}
        onClick={() => setOpen(true)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <img ref={imageRef} src={active.src} alt={active.alt} loading="lazy" />
      </button>
      <div className="shell-md-image-gallery__thumbs">
        {images.map((image, index) => (
          <button
            key={`${image.src}:${index}`}
            type="button"
            className={`shell-md-image-gallery__thumb${index === activeIndex ? ' is-active' : ''}`}
            onClick={() => setActiveIndex(index)}
            onDoubleClick={() => {
              setActiveIndex(index);
              setOpen(true);
            }}
          >
            <img src={image.src} alt={image.alt || `第 ${index + 1} 张`} />
          </button>
        ))}
      </div>
      {generationModel ? <GeneratedImageModelLabel model={generationModel} /> : null}
      <ImageLightbox
        open={open}
        images={images}
        activeIndex={activeIndex}
        onClose={() => setOpen(false)}
        onChangeIndex={setActiveIndex}
      />
      {imageMenu(active.src, active.alt, true)}
    </div>
  );
}

export function extractMarkdownImages(children: ReactNode): MarkdownGalleryImage[] {
  const arr = Array.isArray(children) ? children : [children];
  const out: MarkdownGalleryImage[] = [];
  for (const child of arr) {
    if (!child || typeof child !== 'object' || !('props' in child)) continue;
    const props = (child as { props?: { src?: string; alt?: string } }).props;
    const src = typeof props?.src === 'string' ? props.src : '';
    if (!src) continue;
    out.push({ src, alt: typeof props?.alt === 'string' ? props.alt : '' });
  }
  return out;
}

export function isImageOnlyChildren(children: ReactNode): boolean {
  const arr = Array.isArray(children) ? children : [children];
  let imageCount = 0;
  for (const child of arr) {
    if (child == null || child === false) continue;
    if (typeof child === 'string' && !child.trim()) continue;
    if (
      typeof child === 'object' &&
      'props' in child &&
      typeof (child as { props?: { src?: unknown } }).props?.src === 'string'
    ) {
      imageCount += 1;
      continue;
    }
    return false;
  }
  return imageCount > 0;
}
