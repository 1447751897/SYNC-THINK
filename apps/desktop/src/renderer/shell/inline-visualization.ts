export interface InlineVisualizationMarkdownSegment {
  type: 'markdown';
  start: number;
  content: string;
}

export interface InlineVisualizationSegment {
  type: 'visualization';
  start: number;
  file: string;
}

export type InlineVisualizationParts =
  InlineVisualizationMarkdownSegment | InlineVisualizationSegment;

const DIRECTIVE_RE = /::(?:newmax|codex)-inline-vis\s*\{([^{}]*)\}/gi;
const FILE_RE = /(?:^|\s)file\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/i;
const MAX_FILE_LENGTH = 512;

function normalizeVisualizationFile(value: string): string | null {
  const file = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!file || file.length > MAX_FILE_LENGTH || file.startsWith('/') || /^[A-Za-z]:\//.test(file)) {
    return null;
  }
  const parts = file.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  if (!/\.html?$/i.test(file)) return null;
  return parts.join('/');
}

function directiveFile(attributes: string): string | null {
  const match = FILE_RE.exec(attributes);
  if (!match) return null;
  return normalizeVisualizationFile(match[1] ?? match[2] ?? match[3] ?? '');
}

function fencedRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const lines = text.split(/\n/);
  let offset = 0;
  let fence: { marker: '`' | '~'; length: number; start: number } | undefined;
  for (const line of lines) {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (match) {
      const run = match[1] ?? '';
      const marker = run[0] as '`' | '~';
      if (!fence) {
        fence = { marker, length: run.length, start: offset };
      } else if (
        fence.marker === marker &&
        run.length >= fence.length &&
        /^\s*$/.test(line.slice(match[0].length))
      ) {
        ranges.push({ start: fence.start, end: offset + line.length });
        fence = undefined;
      }
    }
    offset += line.length + 1;
  }
  if (fence) ranges.push({ start: fence.start, end: text.length });
  return ranges;
}

function isInsideRange(offset: number, ranges: readonly { start: number; end: number }[]): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

/**
 * Parse NewMax's file-backed inline visualization directive without allowing
 * directives inside Markdown fences to escape as executable content.
 */
export function parseInlineVisualizationSegments(text: string): InlineVisualizationParts[] {
  const ranges = fencedRanges(text);
  const parts: InlineVisualizationParts[] = [];
  let cursor = 0;
  DIRECTIVE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DIRECTIVE_RE.exec(text))) {
    const start = match.index;
    const end = start + match[0].length;
    if (isInsideRange(start, ranges)) continue;
    const file = directiveFile(match[1] ?? '');
    if (!file) continue;
    if (start > cursor)
      parts.push({ type: 'markdown', start: cursor, content: text.slice(cursor, start) });
    parts.push({ type: 'visualization', start, file });
    cursor = end;
  }
  if (cursor < text.length || parts.length === 0) {
    parts.push({ type: 'markdown', start: cursor, content: text.slice(cursor) });
  }
  return parts;
}

export function hasInlineVisualization(text: string): boolean {
  return parseInlineVisualizationSegments(text).some((part) => part.type === 'visualization');
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function injectHead(source: string, extras: string): string {
  if (/<\/head>/i.test(source)) return source.replace(/<\/head>/i, `${extras}</head>`);
  if (/<body(?:\s|>)/i.test(source)) {
    return source.replace(/<body(?:\s|>)/i, (match) => `${extras}${match}`);
  }
  return `${extras}${source}`;
}

/** Build the isolated guest document used by inline visualizations. */
export function buildVisualizationDocument(
  source: string,
  options: { background?: string; theme?: 'light' | 'dark' } = {},
): string {
  const background = options.background ?? 'Canvas';
  const foreground = options.theme === 'dark' ? 'CanvasText' : 'CanvasText';
  const surface = 'Canvas';
  const border = 'ButtonBorder';
  const extras = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data: https:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>:root{color-scheme:${options.theme === 'dark' ? 'dark' : 'light'};--viz-bg:${escapeAttribute(background)};--viz-text:${escapeAttribute(foreground)};--viz-surface:${escapeAttribute(surface)};--viz-accent:LinkText;--viz-border:${escapeAttribute(border)};font-family:Inter,'Noto Sans SC',ui-sans-serif,system-ui,sans-serif}html,body{margin:0;min-width:0;min-height:0;background:var(--viz-bg);color:var(--viz-text)}body{padding:0}main.viz-root{box-sizing:border-box;width:100%;min-height:0;padding:24px;background:var(--viz-bg);color:var(--viz-text)}main.viz-root *{box-sizing:border-box}main.viz-root a{color:var(--viz-accent)}main.viz-root button,main.viz-root input,main.viz-root select,main.viz-root textarea{font:inherit}</style>`;
  const trimmed = source.trim();
  const rootWrapped = /<main\b[^>]*\bclass\s*=\s*["'][^"']*\bviz-root\b/i.test(trimmed);
  let documentSource: string;
  if (/<html[\s>]/i.test(trimmed)) {
    // Preserve a complete authored document. NewMax keeps the page's own
    // head/body structure and mounts the shared root inside body when needed.
    documentSource = injectHead(trimmed, extras);
    if (!rootWrapped && /<body(?:\s[^>]*)?>/i.test(documentSource)) {
      documentSource = documentSource.replace(/(<body(?:\s[^>]*)?>)/i, '$1<main class="viz-root">');
      documentSource = documentSource.replace(/<\/body>/i, '</main></body>');
    }
  } else {
    const bodyContent = rootWrapped ? trimmed : `<main class="viz-root">${trimmed}</main>`;
    documentSource = `<!doctype html><html><head>${extras}</head><body>${bodyContent}</body></html>`;
  }
  return `data:text/html;charset=utf-8,${encodeURIComponent(documentSource)}`;
}

export function visualizationFileLabel(file: string): string {
  return file.split('/').at(-1) || file;
}
