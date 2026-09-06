import { highlightCode } from './code-highlight.js';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function highlightSource(code: string, language?: string): string {
  return highlightCode(code, language) ?? escapeHtml(code);
}
