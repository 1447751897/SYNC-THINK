import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
interface PlainNode { type: string; value?: string; alt?: string; ordered?: boolean; start?: number; checked?: boolean | null; children?: PlainNode[] }
/** Parse the complete original Markdown, rather than copying a clipped DOM preview. */
export function markdownPlainText(markdown: string): string {
  const root = unified().use(remarkParse).use(remarkGfm).parse(markdown) as PlainNode;
  const text = (node: PlainNode): string => {
    const children = node.children ?? [];
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') return node.value ?? '';
    if (node.type === 'image') return node.alt ?? '';
    if (node.type === 'html') return new DOMParser().parseFromString(node.value ?? '', 'text/html').body.textContent ?? '';
    if (node.type === 'break') return '\n';
    if (node.type === 'thematicBreak') return '—';
    if (node.type === 'definition') return '';
    if (node.type === 'list') return children.map((child, index) => (node.ordered ? String((node.start ?? 1) + index) + '. ' : '• ') + (child.checked == null ? '' : child.checked ? '[x] ' : '[ ] ') + text(child)).join('\n');
    const separator = node.type === 'tableRow' ? '\t' : ['root', 'blockquote', 'listItem'].includes(node.type) ? '\n\n' : node.type === 'table' ? '\n' : '';
    return children.map(text).filter(Boolean).join(separator);
  };
  return text(root).trim();
}
