import { useContext, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { ImageLightbox } from './ImageLightbox.js';
import {
  isGeneratedImageSrc,
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

async function downloadOriginal(src: string): Promise<void> {
  const response = await fetch(src);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = src.split('/').filter(Boolean).at(-1) || 'image.png';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function MarkdownImageGallery({ images }: { images: readonly MarkdownGalleryImage[] }) {
  const models = useContext(GeneratedImageModelsContext);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  if (images.length === 0) return null;
  const first = images[0]!;
  const generationModel =
    models.get(first.src) ?? images.map((image) => models.get(image.src)).find(Boolean);
  const generated = images.some((image) => isGeneratedImageSrc(image.src));

  if (images.length === 1) {
    const image = first;
    const imageElement = (
      <img
        src={image.src}
        alt={image.alt}
        loading="lazy"
        className="shell-md-image"
        style={{ cursor: 'zoom-in' }}
        onClick={() => {
          setActiveIndex(0);
          setOpen(true);
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
            <button
              type="button"
              className="shell-md-image-download"
              title="下载原图"
              aria-label="下载原图"
              onClick={(event) => {
                event.stopPropagation();
                void downloadOriginal(image.src);
              }}
            >
              <Download size={14} />
            </button>
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
      >
        <img src={active.src} alt={active.alt} loading="lazy" />
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
  let images = 0;
  for (const child of arr) {
    if (child == null || child === false) continue;
    if (typeof child === 'string' && !child.trim()) continue;
    if (
      typeof child === 'object' &&
      'props' in child &&
      typeof (child as { props?: { src?: unknown } }).props?.src === 'string'
    ) {
      images += 1;
      continue;
    }
    return false;
  }
  return images > 0;
}
