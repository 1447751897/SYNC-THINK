export const MAX_DESIGN_HTML_BYTES = 1024 * 1024;

export type DesignHtmlParseResult =
  | { ok: true; html: string }
  | { ok: false; error: string };

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const NON_VISUAL_ELEMENTS = new Set([
  'base',
  'head',
  'html',
  'link',
  'meta',
  'script',
  'style',
  'title',
]);

function utf8Bytes(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return value.length * 2;
}

/**
 * Removes raw-text bodies before scanning tags. JavaScript and CSS commonly
 * contain angle brackets that are not HTML and must not corrupt the stack.
 * An unterminated raw-text element is deliberately left intact so validation
 * reports it as an unclosed tag instead of previewing a partial generation.
 */
function structuralHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /<(script|style|textarea|title)\b([^<>]*)>[\s\S]*?<\/\1\s*>/gi,
      (_match, tag: string, attributes: string) => `<${tag}${attributes}></${tag}>`,
    );
}

function validateTagStructure(html: string): { ok: true; meaningfulElements: number } | { ok: false } {
  const source = structuralHtml(html);
  const stack: string[] = [];
  let meaningfulElements = 0;
  const tagPattern = /<!doctype\s+html(?:\s[^<>]*)?>|<\/?([a-z][a-z0-9:-]*)\b[^<>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(source))) {
    const token = match[0];
    const tag = match[1]?.toLowerCase();
    if (!tag) continue;
    const closing = /^<\//.test(token);
    const selfClosing = /\/\s*>$/.test(token) || VOID_ELEMENTS.has(tag);

    if (closing && !new RegExp(`^<\\/${tag}\\s*>$`, 'i').test(token)) return { ok: false };

    if (!closing && !NON_VISUAL_ELEMENTS.has(tag)) meaningfulElements += 1;
    if (selfClosing) continue;

    if (closing) {
      if (stack.at(-1) !== tag) return { ok: false };
      stack.pop();
    } else {
      stack.push(tag);
    }
  }

  const unparsed = source.replace(tagPattern, '');
  if (/<(?:\/?[a-z]|!)/i.test(unparsed)) return { ok: false };
  return stack.length === 0 ? { ok: true, meaningfulElements } : { ok: false };
}

/** Validate the payload of an explicit design-html fence or tag. */
export function parseDesignHtml(input: string): DesignHtmlParseResult {
  const html = input.replace(/\r\n?/g, '\n').replace(/\n$/, '').trim();
  if (!html) return { ok: false, error: '设计稿内容为空' };
  if (utf8Bytes(html) > MAX_DESIGN_HTML_BYTES) {
    return { ok: false, error: '设计稿超过 1MB，无法预览或保存' };
  }
  if (/<\/?design-html\b/i.test(html)) {
    return { ok: false, error: '设计稿中不能嵌套 design-html 标记' };
  }
  if (!/<(?:!doctype\s+html(?:\s[^<>]*)?|[a-z][a-z0-9:-]*\b[^<>]*)>/i.test(html)) {
    return { ok: false, error: '设计稿必须包含 HTML 元素' };
  }

  const structure = validateTagStructure(html);
  if (!structure.ok) return { ok: false, error: 'HTML 标签未正确闭合' };
  if (structure.meaningfulElements === 0) {
    return { ok: false, error: '设计稿没有可预览的页面内容' };
  }
  return { ok: true, html };
}

function fenceStart(line: string): { marker: '`' | '~'; length: number } | null {
  const match = /^\s{0,3}(`{3,}|~{3,})(?:[^`~]*)$/.exec(line);
  if (!match?.[1]) return null;
  return { marker: match[1][0] as '`' | '~', length: match[1].length };
}

function closesFence(line: string, fence: { marker: '`' | '~'; length: number }): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== fence.marker) return false;
  const markerRun = new RegExp(`^\\${fence.marker}{${fence.length},}\\s*$`);
  return markerRun.test(trimmed);
}

function safeBacktickFence(lines: string[]): string {
  let longest = 0;
  for (const line of lines) {
    for (const match of line.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * Converts standalone <design-html> blocks into design-html fences before
 * Markdown parsing. Tags inside ordinary code fences are preserved verbatim.
 * Unterminated tags are also left untouched so streaming output stays passive.
 */
export function normalizeTaggedDesignHtmlBlocks(markdown: string): string {
  const lines = markdown.split('\n');
  const output: string[] = [];
  let activeFence: { marker: '`' | '~'; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (activeFence) {
      output.push(line);
      if (closesFence(line, activeFence)) activeFence = null;
      continue;
    }

    const nextFence = fenceStart(line);
    if (nextFence) {
      activeFence = nextFence;
      output.push(line);
      continue;
    }

    if (!/^\s{0,3}<design-html>\s*$/i.test(line)) {
      output.push(line);
      continue;
    }

    let closingIndex = index + 1;
    while (
      closingIndex < lines.length &&
      !/^\s{0,3}<\/design-html>\s*$/i.test(lines[closingIndex] ?? '')
    ) {
      closingIndex += 1;
    }
    if (closingIndex >= lines.length) {
      output.push(line);
      continue;
    }

    const body = lines.slice(index + 1, closingIndex);
    const marker = safeBacktickFence(body);
    output.push(`${marker}design-html`, ...body, marker);
    index = closingIndex;
  }

  return output.join('\n');
}

function titleFromHtml(html: string): string {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1];
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html)?.[1];
  return (title ?? heading ?? 'ai-design').replace(/<[^>]+>/g, ' ').replace(/&[^;\s]+;/g, ' ');
}

/** Stable, project-relative destination used by save and download controls. */
export function deriveDesignDraftPath(html: string): string {
  const slug = titleFromHtml(html)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '');
  return `designs/${slug || 'ai-design'}.html`;
}
