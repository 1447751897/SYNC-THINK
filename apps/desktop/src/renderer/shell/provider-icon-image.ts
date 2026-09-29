/** Normalize uploads to a small local PNG; the picker never loads a remote icon URL. */
export async function prepareProviderIcon(file: File): Promise<string> {
  if (file.size > 4 * 1024 * 1024) throw new Error('请选择 4 MB 以内的图片');
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type))
    throw new Error('支持 PNG、JPG、WebP 和 SVG 图片');
  let source: Blob = file;
  if (file.type === 'image/svg+xml') {
    const { default: DOMPurify } = await import('dompurify');
    const svg = DOMPurify.sanitize(await file.text(), {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['foreignObject', 'script', 'image', 'use', 'style', 'a'],
      FORBID_ATTR: ['href', 'xlink:href'],
    });
    source = new Blob([svg], { type: 'image/svg+xml' });
  }
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('图片读取失败，请换一张图片'));
      image.src = url;
    });
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth > 16384 ||
      image.naturalHeight > 16384
    )
      throw new Error('图片尺寸不合适，请选择较小的图标');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('图片处理失败，请重试');
    const scale = Math.min(96 / image.naturalWidth, 96 / image.naturalHeight);
    const width = image.naturalWidth * scale,
      height = image.naturalHeight * scale;
    context.drawImage(image, (96 - width) / 2, (96 - height) / 2, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
