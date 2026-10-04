import { useEffect, useMemo, useState } from 'react';
import { ImageLightbox } from './ImageLightbox.js';
import { DeferredToolContent } from './DeferredToolContent.js';
import type { InlineProcessItem } from './conversation-types.js';
import { parseToolImages, toolImageUrl, type ToolPreviewImage } from './tool-image-content.js';

type ImageTool = Extract<InlineProcessItem, { kind: 'tool' }>;

function PreviewImage({ image, root, onOpen }: { image: ToolPreviewImage; root?: string; onOpen: (src: string) => void }) {
  const [src, setSrc] = useState(image.src);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setFailed(false); setSrc(image.src); setBusy(false);
    if (image.src) return;
    if (!image.path || !root || !window.syncThink?.runtime?.readProjectImage) { setFailed(true); return; }
    setBusy(true);
    void window.syncThink.runtime.readProjectImage({ root, path: image.path }).then(value => {
      if (!current) return;
      const url = toolImageUrl(value.dataUrl);
      setSrc(url); setFailed(!url);
    }).catch(() => { if (current) setFailed(true); }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [image.src, image.path, root, retry]);
  return <div className="shell-tool-image__item" data-testid="tool-image-preview">
    {busy ? <p className="shell-tool-image__notice" role="status">正在读取图片…</p> : failed ?
      <div className="shell-tool-image__notice" role="status">
        <span>图片预览暂不可用，请检查文件是否仍存在。技术详情中保留了原始结果。</span>
        <button type="button" onClick={() => setRetry(value => value + 1)}>重试预览</button>
      </div> : src ? <button type="button" className="shell-tool-image__open" aria-label={'放大查看' + image.alt} onClick={() => onOpen(src)}>
        <img key={retry + ':' + src} src={src} alt={image.alt} loading="lazy" onError={() => setFailed(true)} />
      </button> : null}
  </div>;
}

function ImageContent({ text, item, root }: { text?: string; item: ImageTool; root?: string }) {
  const alt = /browser_screenshot$/i.test(item.name) ? '浏览器截图' : '图片输入';
  const images = useMemo(() => parseToolImages(text, item.argumentsJson, alt), [text, item.argumentsJson, alt]);
  const [selected, setSelected] = useState<{ src: string; alt: string }>();
  if (!images.length) return <p className="shell-tool-image__notice" role="status">{item.status === 'running' ? '正在读取图片…' : '图片预览暂不可用。技术详情中保留了原始结果。'}</p>;
  return <>
    <div className="shell-tool-image__gallery">
      {images.map(image => <PreviewImage key={image.src ?? image.path} image={image} root={root} onOpen={src => setSelected({ src, alt: image.alt })} />)}
    </div>
    <ImageLightbox open={Boolean(selected)} images={selected ? [selected] : []} activeIndex={0} onClose={() => setSelected(undefined)} />
  </>;
}

export default function ToolImagePreview({ item, root }: { item: ImageTool; root?: string }) {
  const renderWithInput = (argumentsJson: string) => {
    const render = (text?: string) => <ImageContent text={text} item={{ ...item, argumentsJson }} root={root} />;
    return item.resultRef && item.status !== 'running' ? <DeferredToolContent deferred={item.resultRef} preview={item.result ?? ''} label="图片" renderContent={render} /> : render(item.result);
  };
  return <div className="shell-tool-image" data-testid="tool-image-output">
    {item.argumentsRef && !parseToolImages(item.result).length ? <DeferredToolContent deferred={item.argumentsRef} preview={item.argumentsJson} label="图片输入" renderContent={renderWithInput} /> : renderWithInput(item.argumentsJson)}
  </div>;
}
