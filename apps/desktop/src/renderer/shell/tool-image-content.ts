export interface ToolPreviewImage { src?: string; path?: string; alt: string }
const MAX_DATA_URL_LENGTH = 17 * 1024 * 1024;
const IMAGE_PATH = /\.(?:png|jpe?g|webp|gif)$/i;

export function toolImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const src = value.trim();
  if (src.length > MAX_DATA_URL_LENGTH) return undefined;
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z\d+/]+={0,2}$/i.test(src)) return src;
  try {
    const url = new URL(src);
    if (url.username || url.password) return undefined;
    if (url.protocol === 'sync-think-image:' &&
      ['screenshot', 'generated', 'media', 'artifact'].includes(url.hostname) && url.pathname.length > 1) return src;
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname) return src;
  } catch { /* Local paths are resolved by the scoped main-process image reader. */ }
  return undefined;
}

/** Explicit image fields/blocks and raw local tool-input paths; page URLs stay excluded. */
export function parseToolImages(result: string | undefined, argumentsJson?: string, alt = '图片输入'): ToolPreviewImage[] {
  const images: ToolPreviewImage[] = [];
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown, label = alt) => {
    const src = toolImageUrl(value);
    if (src && !seen.has(src) && images.length < 16) {
      seen.add(src); images.push({ src, alt: label });
    }
  };
  const addPath = (value: unknown) => {
    if (typeof value !== 'string') return;
    const path = value.trim();
    if (IMAGE_PATH.test(path) && !/^[a-z]+:\/\//i.test(path) && paths.length < 16) paths.push(path);
  };
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || images.length >= 16) return;
    if (typeof value === 'string') {
      try { visit(JSON.parse(value), depth + 1); return; } catch { /* Markdown tool envelopes. */ }
      for (const match of value.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) add(match[2], match[1] || alt);
      return;
    }
    if (Array.isArray(value)) { value.slice(0, 64).forEach(v => visit(v, depth + 1)); return; }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    if (row.ok === false || row.isError === true) return;
    const type = row.type;
    if (type === 'image' && typeof row.data === 'string' && typeof row.mimeType === 'string') add('data:' + row.mimeType + ';base64,' + row.data);
    if (type === 'image' || type === 'input_image' || type === 'image_url') {
      add(row.url); add(row.src); add(row.dataUrl);
      const imageUrl = row.image_url;
      add(typeof imageUrl === 'object' && imageUrl ? (imageUrl as Record<string, unknown>).url : imageUrl);
      const source = row.source as Record<string, unknown> | undefined;
      if (source?.type === 'base64') add('data:' + source.media_type + ';base64,' + source.data);
    }
    for (const key of ['embedUrl', 'screenshotEmbedUrl', 'imageUrl', 'imageDataUrl', 'dataUrl', 'previewUrl']) add(row[key]);
    for (const key of ['absolutePath', 'relativePath', 'path', 'file_path', 'filePath', 'image_path']) {
      if (typeof row[key] === 'string' && IMAGE_PATH.test((row[key] as string).trim())) { addPath(row[key]); break; }
    }
    for (const key of ['content', 'text', 'images', 'image', 'result', 'screenshot', 'output']) visit(row[key], depth + 1);
  };
  visit(result, 0);
  // A read-image tool often returns only a receipt; its input still identifies the image.
  if (!images.length && !paths.length) {
    visit(argumentsJson, 0);
    // Execution-process image_input records carry a raw path, not JSON arguments.
    if (!images.length && !paths.length && typeof argumentsJson === 'string' && !/^\s*[\[{]/.test(argumentsJson)) addPath(argumentsJson);
  }
  if (!images.length) for (const path of [...new Set(paths)].slice(0, 16)) images.push({ path, alt });
  return images;
}
