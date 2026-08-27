export interface OpenExternalUrlResult {
  opened: boolean;
  error: string | null;
}

const MAX_EXTERNAL_URL_LENGTH = 8_192;

export function normalizeExternalUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const input = value.trim();
  if (input.length === 0 || input.length > MAX_EXTERNAL_URL_LENGTH) return undefined;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
