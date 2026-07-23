// Compress chat images in the renderer before IPC so vision turns stay practical.

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_QUALITY = 0.82;
const DEFAULT_MAX_BYTES = 900_000;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });
}

/**
 * Downscale + re-encode as JPEG/WebP data URL when the source is large.
 * Falls back to the original data URL if canvas is unavailable.
 */
export async function compressImageDataUrl(
  dataUrl: string,
  options: {
    maxEdge?: number;
    quality?: number;
    maxBytes?: number;
    mimeType?: string;
  } = {},
): Promise<{ dataUrl: string; mimeType: string }> {
  if (typeof document === 'undefined' || !dataUrl.startsWith('data:image/')) {
    return { dataUrl, mimeType: options.mimeType || 'image/png' };
  }
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = options.quality ?? DEFAULT_QUALITY;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  // Already small enough — keep original (preserves transparency/gif when tiny).
  const approxBytes = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
  if (approxBytes > 0 && approxBytes <= maxBytes / 2) {
    return { dataUrl, mimeType: options.mimeType || 'image/png' };
  }

  try {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, maxEdge / Math.max(img.width || 1, img.height || 1));
    const width = Math.max(1, Math.round((img.width || 1) * scale));
    const height = Math.max(1, Math.round((img.height || 1) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { dataUrl, mimeType: options.mimeType || 'image/png' };
    ctx.drawImage(img, 0, 0, width, height);

    // Prefer jpeg for photos/screenshots; smaller than png for typical UI shots.
    let out = canvas.toDataURL('image/jpeg', quality);
    let q = quality;
    while (out.length > maxBytes && q > 0.45) {
      q -= 0.1;
      out = canvas.toDataURL('image/jpeg', q);
    }
    return { dataUrl: out, mimeType: 'image/jpeg' };
  } catch {
    return { dataUrl, mimeType: options.mimeType || 'image/png' };
  }
}
