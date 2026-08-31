import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { InlineProcessItem } from './ChatView.js';
import { describeExternalSource } from './ExternalSourceIcon.js';
import { toolInputSummary, toolStatusOf, toolVisualKind } from './process-activity.js';

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

const markdownParser = unified().use(remarkParse).use(remarkGfm);

export type AnswerSource =
  | {
      key: string;
      kind: 'external';
      url: string;
      host: string;
      label: string;
    }
  | {
      key: string;
      kind: 'file';
      path: string;
      label: string;
      action: 'read' | 'write';
    };

function nodeText(node: MarkdownNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  return node.children?.map(nodeText).join('') ?? '';
}

function normalizedExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function markdownExternalSources(markdown: string): AnswerSource[] {
  if (!markdown.trim()) return [];
  const root = markdownParser.parse(markdown) as MarkdownNode;
  const sources: AnswerSource[] = [];
  const seen = new Set<string>();

  const visit = (node: MarkdownNode) => {
    if (node.type === 'link' && node.url) {
      const url = normalizedExternalUrl(node.url);
      if (url && !seen.has(url)) {
        seen.add(url);
        const { host } = describeExternalSource(url);
        sources.push({
          key: `external:${url}`,
          kind: 'external',
          url,
          host,
          label: nodeText(node).trim() || host,
        });
      }
    }
    node.children?.forEach(visit);
  };
  visit(root);
  return sources;
}

export function collectAnswerSources(
  markdown: string,
  processItems: readonly InlineProcessItem[] = [],
  projectFolder?: string,
): AnswerSource[] {
  const sources = markdownExternalSources(markdown);
  const seen = new Set(sources.map((source) => source.key));

  for (const item of processItems) {
    if (item.kind !== 'tool' || toolStatusOf(item) !== 'completed') continue;
    const action = toolVisualKind(item.name);
    if (action !== 'read' && action !== 'write') continue;
    const path = normalizeWorkspaceSourcePath(toolInputSummary(item), projectFolder);
    const key = `file:${path}`;
    if (!path || seen.has(key) || !/[\\/]|\.\w{1,8}$/.test(path)) continue;
    seen.add(key);
    sources.push({
      key,
      kind: 'file',
      path,
      label: path.split(/[\\/]/).at(-1) ?? path,
      action,
    });
  }

  return sources.slice(0, 12);
}

function normalizeWorkspaceSourcePath(path: string, projectFolder?: string): string {
  const normalizedPath = path.replace(/\\/g, '/');
  const normalizedRoot = projectFolder?.trim().replace(/\\/g, '/').replace(/\/$/, '');
  if (!normalizedRoot) return normalizedPath;
  const pathLower = normalizedPath.toLocaleLowerCase();
  const rootLower = normalizedRoot.toLocaleLowerCase();
  if (pathLower.startsWith(`${rootLower}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return normalizedPath;
}
