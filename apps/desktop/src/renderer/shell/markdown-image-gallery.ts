export type MarkdownGalleryImage = {
  src: string;
  alt: string;
};

const GENERATED_IMAGE_PREFIX = 'sync-think-image://generated/';

export function isGeneratedImageSrc(src: string): boolean {
  return src.startsWith(GENERATED_IMAGE_PREFIX);
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** NewMax `srcToLocalPath` for `sync-think-image://generated/<path>`. */
export function generatedImagePathFromSrc(src: string): string | undefined {
  if (!src.startsWith(GENERATED_IMAGE_PREFIX)) return undefined;
  return safeDecodeUri(src.slice(GENERATED_IMAGE_PREFIX.length));
}

export function assignGeneratedImageModel(
  map: Map<string, string>,
  src: string,
  model: string,
): void {
  if (!src || !model) return;
  map.set(src, model);
  const decoded = safeDecodeUri(src);
  if (decoded !== src) map.set(decoded, model);
  const path = generatedImagePathFromSrc(src);
  if (!path) return;
  map.set(path, model);
  map.set(`${GENERATED_IMAGE_PREFIX}${encodeURIComponent(path)}`, model);
  map.set(`${GENERATED_IMAGE_PREFIX}${path}`, model);
}

/** NewMax `normalizeImageGenerationToolResult`. */
export function normalizeImageGenerationToolResult(result: string): string {
  const trimmed = result.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return result;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const blocks = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as { content?: unknown }).content)
        ? (parsed as { content: unknown[] }).content
        : [];
    const text = blocks
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
          return (block as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    return text || result;
  } catch {
    return result;
  }
}

export function extractGeneratedImageModelLine(text: string): string | undefined {
  const model = /^(?:模型|Model)\s*[：:]\s*(.+?)\s*$/im.exec(text);
  return model?.[1]?.trim() || undefined;
}

/** NewMax `resolveGenerationModel`. */
export function resolveGeneratedImageModel(
  src: string,
  models: ReadonlyMap<string, string>,
): string | undefined {
  const direct = models.get(src);
  if (direct) return direct;
  const decoded = safeDecodeUri(src);
  if (decoded !== src) {
    const decodedModel = models.get(decoded);
    if (decodedModel) return decodedModel;
  }
  const path = generatedImagePathFromSrc(src);
  if (!path) return undefined;
  const pathModel = models.get(path);
  if (pathModel) return pathModel;
  const encoded = models.get(`${GENERATED_IMAGE_PREFIX}${encodeURIComponent(path)}`);
  if (encoded) return encoded;
  for (const [mappedSrc, model] of models) {
    if (model && generatedImagePathFromSrc(mappedSrc) === path) return model;
  }
  return undefined;
}

/** NewMax `resolveGalleryGenerationModel`. */
export function resolveGalleryGeneratedImageModel(
  images: readonly { src: string }[],
  models: ReadonlyMap<string, string>,
): string | undefined {
  for (const image of images) {
    const model = resolveGeneratedImageModel(image.src, models);
    if (model) return model;
  }
  const unique = [...new Set([...models.values()].filter(Boolean))];
  return unique.length === 1 ? unique[0] : undefined;
}

export function mergeGeneratedImageModels(
  ...maps: Array<ReadonlyMap<string, string> | undefined>
): Map<string, string> {
  const merged = new Map<string, string>();
  for (const map of maps) {
    if (!map) continue;
    for (const [src, model] of map) assignGeneratedImageModel(merged, src, model);
  }
  return merged;
}

/** NewMax `buildGeneratedImageModelBySrc(toolCalls)`. */
export function buildGeneratedImageModelBySrc(toolResults: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of toolResults) {
    const resultText = normalizeImageGenerationToolResult(raw);
    const model = extractGeneratedImageModelLine(resultText);
    if (!model) continue;
    for (const match of resultText.matchAll(/!\[[^\]]*]\(([^)\s]+)\)/g)) {
      const src = match[1];
      if (src) assignGeneratedImageModel(map, src, model);
    }
  }
  return map;
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
      if (src) assignGeneratedImageModel(map, src, pendingModel);
    }
  }
  return map;
}

function knownGeneratedImageSrcs(
  known?: ReadonlyMap<string, string> | readonly string[],
): string[] {
  if (!known) return [];
  const values = Array.isArray(known) ? known : [...known.keys()];
  return values.filter((src) => src.startsWith(GENERATED_IMAGE_PREFIX));
}

function completeGeneratedImageSrc(partial: string, known: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const src of known) {
    if (src.startsWith(partial) && src.length > partial.length) {
      if (!best || src.length > best.length) best = src;
    }
  }
  return best;
}

/**
 * Stream interruptions often cut `![...](sync-think-image://generated/…)` in
 * the middle of an encoded Windows path. Complete it from the tool-result map
 * when possible; otherwise hide the dangling protocol text.
 */
export function repairGeneratedImageMarkdown(
  text: string,
  known?: ReadonlyMap<string, string> | readonly string[],
  streaming = false,
): string {
  const srcs = knownGeneratedImageSrcs(known);
  return text.replace(
    /!\[([^\]]*)\]\((sync-think-image:\/\/generated\/[^)\s]*)\)?/g,
    (match, alt: string, src: string) => {
      if (match.endsWith(')')) return match;
      if (streaming) return '';
      const completed = completeGeneratedImageSrc(src, srcs);
      return completed ? `![${alt}](${completed})` : '';
    },
  );
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

/** NewMax ImageLightbox `computeFitScale`: viewport minus 48px padding each side, never above 1. */
export function computeImageLightboxFitScale(
  mode: 'screen' | 'width',
  natural: { width: number; height: number },
  container: { width: number; height: number },
  padding = 96,
): number {
  const availableWidth = container.width - padding;
  const availableHeight = container.height - padding;
  if (availableWidth <= 0 || availableHeight <= 0 || !natural.width || !natural.height) return 1;
  if (mode === 'width') return Math.min(availableWidth / natural.width, 1);
  return Math.min(availableWidth / natural.width, availableHeight / natural.height, 1);
}

async function blobToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) return blob;
  context.drawImage(bitmap, 0, 0);
  return await new Promise((resolve) => {
    canvas.toBlob((converted) => resolve(converted ?? blob), 'image/png');
  });
}

export async function getImageBlob(
  src: string,
  image?: HTMLImageElement | null,
): Promise<Blob | null> {
  if (src) {
    try {
      const response = await fetch(src);
      if (response.ok) return await response.blob();
    } catch {
      // Fall back to the displayed image, matching NewMax getImageBlob.
    }
  }
  if (!image) return null;
  return await new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(null);
        return;
      }
      context.drawImage(image, 0, 0);
      canvas.toBlob(resolve, 'image/png');
    } catch {
      resolve(null);
    }
  });
}

export async function copyImageSrcToClipboard(
  src: string,
  image?: HTMLImageElement | null,
): Promise<boolean> {
  try {
    const blob = await getImageBlob(src, image);
    if (!blob) return false;
    const pngBlob = blob.type === 'image/png' ? blob : await blobToPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
    return true;
  } catch {
    return false;
  }
}

export async function downloadImageSrcOriginal(
  src: string,
  filename?: string,
  image?: HTMLImageElement | null,
): Promise<boolean> {
  try {
    const blob = await getImageBlob(src, image);
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadFileNameForImageSrc(src, filename?.trim() ? filename.trim() : 'image.png');
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
