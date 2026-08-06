// Shared syntax highlighting for hand-rendered source views (html / mermaid
// sandbox cards). Markdown code blocks get their highlight.js tokens from the
// rehype-highlight pipeline; these cards render their source outside that
// pipeline, so they call hljs directly.
import hljs from 'highlight.js';

/** Escape HTML so untrusted source is never interpreted as markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Highlight source code with highlight.js and return the HTML to inject into
 * a `<code class="hljs">` element. Falls back to escaped plain text when the
 * language is unknown or the highlighter throws (mermaid, for instance, has
 * no hljs grammar and is auto-detected; if that misbehaves we still produce
 * safe output).
 */
export function highlightSource(code: string, language?: string): string {
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}
