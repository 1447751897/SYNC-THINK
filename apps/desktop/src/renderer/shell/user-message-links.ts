/** Split user-message text so bare http(s) URLs can render as links. */

export type UserMessagePart =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string };

const BARE_URL_RE = /https?:\/\/[^\s<>"'`\u3400-\u9fff\u3000-\u303f\uff00-\uffef]+/gi;
const TRAILING_PUNCT_RE = /[),.;:!?，。；：！？、]+$/u;

export function splitUserMessageLinks(text: string): UserMessagePart[] {
  if (!text) return [];
  const parts: UserMessagePart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(BARE_URL_RE)) {
    const raw = match[0] ?? '';
    const index = match.index ?? 0;
    if (index > cursor) {
      pushText(parts, text.slice(cursor, index));
    }
    const trimmed = raw.replace(TRAILING_PUNCT_RE, '');
    if (trimmed) parts.push({ type: 'url', value: trimmed });
    pushText(parts, raw.slice(trimmed.length));
    cursor = index + raw.length;
  }
  if (cursor < text.length) {
    pushText(parts, text.slice(cursor));
  }
  return parts.length > 0 ? parts : [{ type: 'text', value: text }];
}

function pushText(parts: UserMessagePart[], value: string): void {
  if (!value) return;
  const last = parts.at(-1);
  if (last?.type === 'text') {
    last.value += value;
    return;
  }
  parts.push({ type: 'text', value });
}

/** Compact label for a bare URL so the raw address does not wrap as a box. */
export function webLinkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments.at(-1);
    if (!last) return host || url;
    const decoded = decodeURIComponent(last.replace(/\/$/, ''));
    if (/^index\.(html?|php|aspx)$/i.test(decoded)) {
      const parent = segments.at(-2);
      return parent ? decodeURIComponent(parent) : host || url;
    }
    return decoded || host || url;
  } catch {
    return url;
  }
}

/** Prefer markdown link text; fall back to a short path label for autolinked URLs. */
export function webLinkVisibleLabel(url: string, label?: string): string {
  const trimmed = label?.trim() ?? '';
  if (!trimmed || trimmed === url || /^https?:\/\//i.test(trimmed)) return webLinkLabel(url);
  return trimmed;
}
