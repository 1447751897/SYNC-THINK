import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';
import type { InlineProcessItem } from './conversation-types.js';
import { describeExternalSource } from './ExternalSourceIcon.js';
import { toolInputSummary, toolStatusOf, toolVisualKind } from './process-activity.js';
import { workspaceResourceFromHref } from './markdown-resource.js';

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  title?: string;
  identifier?: string;
  children?: MarkdownNode[];
}
const markdownParser = unified().use(remarkParse).use(remarkGfm);
export type AnswerSourceOrigin = 'citation' | 'link' | 'read';
export type AnswerSource = { origin?: AnswerSourceOrigin } & (
  | { key: string; kind: 'external'; url: string; host: string; label: string }
  | {
      key: string;
      kind: 'file';
      path: string;
      label: string;
      action: 'read' | 'write';
      location?: ProjectTextLocation;
    }
);

function nodeText(node: MarkdownNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  return node.children?.map(nodeText).join('') ?? '';
}
export function isCitationLabel(label: string): boolean {
  return /^(?:[1-9]\d{0,3}|\[[1-9]\d{0,3}\])$/.test(label.trim());
}

/** Canonical targets are shared by the Markdown link and its source row. */
export function answerSourceFromHref(
  href: string,
  projectFolder?: string,
): AnswerSource | undefined {
  if (/^https?:/i.test(href)) {
    try {
      const url = new URL(href);
      if (url.username || url.password) return undefined;
      const value = url.toString();
      const { host } = describeExternalSource(value);
      return { key: 'external:' + value, kind: 'external', url: value, host, label: host };
    } catch {
      return undefined;
    }
  }
  const file = workspaceResourceFromHref(href, projectFolder);
  if (!file || file.kind === 'directory') return undefined;
  const position = file.location
    ? ':' + file.location.line + ':' + (file.location.column ?? 1)
    : '';
  const windows = /^[a-z]:[\\/]/i.test(projectFolder ?? '');
  return {
    key: 'file:' + (windows ? file.path.toLowerCase() : file.path) + position,
    kind: 'file',
    path: file.path,
    label: file.label,
    action: 'read',
    location: file.location,
  };
}

export function collectAnswerSources(
  markdown: string,
  processItems: readonly InlineProcessItem[] = [],
  projectFolder?: string,
): AnswerSource[] {
  const sources = new Map<string, AnswerSource>();
  const root = markdownParser.parse(markdown) as MarkdownNode;
  const definitions = new Map<string, MarkdownNode>();
  const visit = (node: MarkdownNode, fn: (node: MarkdownNode) => void) => {
    fn(node);
    node.children?.forEach((child) => visit(child, fn));
  };
  visit(root, (node) => {
    if (
      node.type === 'definition' &&
      node.identifier &&
      !definitions.has(node.identifier.toLowerCase())
    )
      definitions.set(node.identifier.toLowerCase(), node);
  });
  visit(root, (node) => {
    const target =
      node.type === 'link'
        ? node
        : node.type === 'linkReference'
          ? definitions.get(node.identifier?.toLowerCase() ?? '')
          : undefined;
    if (!target?.url) return;
    const source = answerSourceFromHref(target.url, projectFolder);
    if (!source) return;
    const label = nodeText(node).trim();
    const cited = isCitationLabel(label);
    const previous = sources.get(source.key);
    const origin = cited || previous?.origin === 'citation' ? 'citation' : 'link';
    const title = target.title?.trim() || (!cited ? label : '') || previous?.label || source.label;
    sources.set(source.key, { ...source, label: title, origin });
  });
  const windows = /^[a-z]:[\\/]/i.test(projectFolder ?? '');
  const pathKey = (path: string) => (windows ? path.toLowerCase() : path);
  const linkedPaths = new Set(
    [...sources.values()].filter((s) => s.kind === 'file').map((s) => pathKey(s.path)),
  );
  for (const item of processItems) {
    if (
      item.kind !== 'tool' ||
      toolStatusOf(item) !== 'completed' ||
      toolVisualKind(item.name) !== 'read'
    )
      continue;
    const source = answerSourceFromHref(toolInputSummary(item), projectFolder ?? '.');
    if (!source || source.kind !== 'file' || linkedPaths.has(pathKey(source.path))) continue;
    sources.set(source.key, { ...source, origin: 'read' });
    linkedPaths.add(pathKey(source.path));
  }
  // Citation numbers follow first appearance, independently of recommended links / read traces.
  const all = [...sources.values()];
  return [
    ...all.filter((s) => s.origin === 'citation'),
    ...all.filter((s) => s.origin !== 'citation'),
  ];
}
