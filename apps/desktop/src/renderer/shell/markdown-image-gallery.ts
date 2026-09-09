export type MarkdownGalleryImage = {
  src: string;
  alt: string;
};

export function isGeneratedImageSrc(src: string): boolean {
  return src.startsWith('sync-think-image://generated/');
}

export function parseGeneratedImageModels(markdown: string): Map<string, string> {
  const map = new Map<string, string>();
  let pendingModel: string | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const model = /^(?:模型|Model)\s*[：:]\s*(.+)$/i.exec(line.trim());
    if (model?.[1]) {
      pendingModel = model[1].trim();
    }
    const used = /^已用\s+.+?\s*\/\s*(.+?)\s+生成/.exec(line.trim());
    if (used?.[1]) pendingModel = used[1].trim();
    if (!pendingModel) continue;
    const matches = line.matchAll(/!\[[^\]]*]\(([^)\s]+)\)/g);
    for (const match of matches) {
      const src = match[1];
      if (src) map.set(src, pendingModel);
    }
  }
  return map;
}

export function imagesFromHastParagraph(
  node: { children?: readonly unknown[] } | undefined,
): MarkdownGalleryImage[] | null {
  if (!node?.children) return null;
  const images: MarkdownGalleryImage[] = [];
  for (const child of node.children) {
    if (!child || typeof child !== 'object') continue;
    const record = child as {
      type?: string;
      tagName?: string;
      value?: string;
      properties?: { src?: unknown; alt?: unknown };
    };
    if (record.type === 'text' && !String(record.value ?? '').trim()) continue;
    if (record.type === 'element' && record.tagName === 'img') {
      const src = typeof record.properties?.src === 'string' ? record.properties.src : '';
      if (src) {
        images.push({
          src,
          alt: typeof record.properties?.alt === 'string' ? record.properties.alt : '',
        });
      }
      continue;
    }
    return null;
  }
  return images.length > 0 ? images : null;
}

export function downloadFileNameForImageSrc(src: string, fallback = 'image.png'): string {
  try {
    const decoded = decodeURIComponent(src);
    const base = decoded.split(/[/\\]/).filter(Boolean).at(-1);
    if (base && !base.includes('://')) return base;
  } catch {
    // Keep the fallback name when the URL is not a path.
  }
  return fallback;
}
