export const DURABLE_TRUNCATION_MARKER = '\n[... content truncated for durable storage ...]';
export const DURABLE_EMBEDDED_IMAGE_MARKER =
  '[embedded image omitted from durable process details]';

export function sanitizeDurableText(text: string): string {
  return text
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/_=-]+/gi, DURABLE_EMBEDDED_IMAGE_MARKER)
    .replace(/data:image\//gi, 'data-image/');
}
