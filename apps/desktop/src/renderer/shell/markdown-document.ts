import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

interface MdNode {
  type: string;
  children?: MdNode[];
  value?: string;
  depth?: number;
  ordered?: boolean;
  url?: string;
  alt?: string;
  lang?: string;
  title?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderChildren(nodes: MdNode[] | undefined): string {
  return (nodes ?? []).map(renderNode).join('');
}

function renderNode(node: MdNode): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value ?? '');
    case 'paragraph':
      return `<p>${renderChildren(node.children)}</p>`;
    case 'heading': {
      const level = Math.min(3, Math.max(1, node.depth ?? 1));
      return `<h${level}>${renderChildren(node.children)}</h${level}>`;
    }
    case 'emphasis':
      return `<em>${renderChildren(node.children)}</em>`;
    case 'strong':
      return `<strong>${renderChildren(node.children)}</strong>`;
    case 'inlineCode':
      return `<code>${escapeHtml(node.value ?? '')}</code>`;
    case 'code': {
      const lang = node.lang ? ` class="language-${escapeHtml(node.lang)}"` : '';
      return `<pre><code${lang}>${escapeHtml(node.value ?? '')}</code></pre>`;
    }
    case 'link':
      return `<a href="${escapeHtml(node.url ?? '')}">${renderChildren(node.children)}</a>`;
    case 'image':
      return `<img src="${escapeHtml(node.url ?? '')}" alt="${escapeHtml(node.alt ?? '')}">`;
    case 'blockquote':
      return `<blockquote>${renderChildren(node.children)}</blockquote>`;
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      return `<${tag}>${renderChildren(node.children)}</${tag}>`;
    }
    case 'listItem':
      return `<li>${renderChildren(node.children)}</li>`;
    case 'thematicBreak':
      return '<hr>';
    case 'break':
      return '<br>';
    case 'table':
      return `<table>${renderChildren(node.children)}</table>`;
    case 'tableRow':
      return `<tr>${renderChildren(node.children)}</tr>`;
    case 'tableCell':
      return `<td>${renderChildren(node.children)}</td>`;
    case 'delete':
      return `<del>${renderChildren(node.children)}</del>`;
    default:
      return renderChildren(node.children);
  }
}

export function markdownToHtml(markdown: string): string {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MdNode;
  const html = renderChildren(tree.children);
  return html.trim() ? html : '<p><br></p>';
}

function textOf(node: Node): string {
  return node.textContent ?? '';
}

function serializeInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const inner = Array.from(el.childNodes).map(serializeInline).join('');
  switch (tag) {
    case 'strong':
    case 'b':
      return inner ? `**${inner}**` : '';
    case 'em':
    case 'i':
      return inner ? `*${inner}*` : '';
    case 'code':
      return inner ? `\`${inner}\`` : '';
    case 'a': {
      const href = el.getAttribute('href') ?? '';
      return inner ? `[${inner}](${href})` : '';
    }
    case 'del':
    case 's':
      return inner ? `~~${inner}~~` : '';
    case 'br':
      return '\n';
    default:
      return inner;
  }
}

function serializeBlocks(nodes: Iterable<Node>): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.textContent ?? '').trim();
      if (value) parts.push(value);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const inline = () => Array.from(el.childNodes).map(serializeInline).join('');
    if (tag === 'h1') parts.push(`# ${inline()}`);
    else if (tag === 'h2') parts.push(`## ${inline()}`);
    else if (tag === 'h3') parts.push(`### ${inline()}`);
    else if (tag === 'p') parts.push(inline());
    else if (tag === 'blockquote') parts.push(`> ${serializeBlocks(el.childNodes).replace(/\n/g, '\n> ')}`);
    else if (tag === 'pre') parts.push(`\`\`\`\n${textOf(el).replace(/\n$/, '')}\n\`\`\``);
    else if (tag === 'ul') {
      for (const item of el.querySelectorAll(':scope > li')) {
        parts.push(`- ${Array.from(item.childNodes).map(serializeInline).join('').trim() || serializeBlocks(item.childNodes)}`);
      }
    } else if (tag === 'ol') {
      let index = 1;
      for (const item of el.querySelectorAll(':scope > li')) {
        parts.push(`${index}. ${Array.from(item.childNodes).map(serializeInline).join('').trim() || serializeBlocks(item.childNodes)}`);
        index += 1;
      }
    } else if (tag === 'table') {
      const rows = Array.from(el.querySelectorAll('tr')).map((row) =>
        Array.from(row.querySelectorAll('th, td')).map((cell) => textOf(cell).trim()),
      );
      if (rows[0]) {
        parts.push(`| ${rows[0].join(' | ')} |`);
        parts.push(`| ${rows[0].map(() => '---').join(' | ')} |`);
        for (const row of rows.slice(1)) parts.push(`| ${row.join(' | ')} |`);
      }
    } else if (tag === 'hr') {
      parts.push('---');
    } else {
      const nested = serializeBlocks(el.childNodes);
      if (nested) parts.push(nested);
    }
  }
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function htmlToMarkdown(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild ?? doc.body;
  return serializeBlocks(root.childNodes);
}
