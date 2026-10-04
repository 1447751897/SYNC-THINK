import { workspaceResourceFromHref } from './markdown-resource.js';

/** Options shared by generated HTML previews and the embedded browser handoff. */
export interface HtmlBrowserOpenOptions {
  /** Prose reference to reuse only after matching the full source or a deferred preview prefix. */
  sourcePath?: string;
  /** Project-relative HTML path to reuse for the browser document. */
  relativePath?: string;
  /** Persist the generated document before opening it. Defaults to true. */
  persist?: boolean;
}

export type OpenHtmlInBrowser = (
  html: string,
  options?: HtmlBrowserOpenOptions,
) => void | Promise<void>;

export const INCOMPLETE_HTML_OPEN_ERROR =
  'HTML 仍是截短预览，请等待完整内容读取完成后重试，或直接打开原文件。';

// Runtime history projections append this marker; it is never a complete HTML source.
const DEFERRED_HTML_TAIL = /(?:^|\n)\[预览；完整内容按需读取\]\s*$/;
const normalizeHtml = (value: string) => value.replace(/\r\n/g, '\n').trim();

export function isDeferredHtmlPreview(html: string): boolean {
  return DEFERRED_HTML_TAIL.test(normalizeHtml(html));
}

/** A truncated excerpt may identify a source file, but must never replace that file. */
export function htmlBrowserSourceMatches(html: string, source: string): boolean {
  const document = normalizeHtml(source);
  if (isDeferredHtmlPreview(document)) return false;
  const preview = normalizeHtml(html);
  const tail = DEFERRED_HTML_TAIL.exec(preview);
  if (!tail) return document === preview;
  const prefix = preview.slice(0, tail.index).trimEnd();
  return Boolean(prefix) && document.startsWith(prefix);
}

/** Only an unambiguous project HTML reference can identify a fenced preview's source. */
export function htmlSourcePathFromMarkdown(
  markdown: string,
  projectFolder?: string,
): string | undefined {
  // References inside previous code blocks are content, not source-file metadata.
  const prose = markdown.replace(
    /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2[ \t]*(?=\n|$)|$)/g,
    '',
  );
  const candidates = new Map<string, string>();
  for (const match of prose.matchAll(/`([^`\r\n]+)`|\[[^\]\r\n]*\]\(([^)\r\n]+)\)/g)) {
    const href = (match[1] ?? match[2]).replace(/^<(.+)>$/, '$1');
    const resource = workspaceResourceFromHref(href, projectFolder);
    if (!resource || !/\.html?$/i.test(resource.path)) continue;
    const key = /^[a-z]:[\\/]/i.test(projectFolder ?? '')
      ? resource.path.toLowerCase()
      : resource.path;
    candidates.set(key, resource.path);
  }
  return candidates.size === 1 ? candidates.values().next().value : undefined;
}
