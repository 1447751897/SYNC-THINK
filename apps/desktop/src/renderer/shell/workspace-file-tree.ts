import type { CSSProperties } from 'react';
import type { FileChangeItem } from '@sync-think/protocol';

export const WORKSPACE_FILE_ICON_SIZE = 14;
export const WORKSPACE_FOLDER_ICON_SIZE = 15;
export const WORKSPACE_TREE_CHEVRON_SIZE = 13;
export const WORKSPACE_TREE_PAD = 8;
export const WORKSPACE_TREE_STEP = 16;
export const WORKSPACE_TREE_FILE_GUTTER = 20;

export type ConversationFileAction = FileChangeItem['action'];

export interface ConversationFileNode {
  kind: 'file';
  name: string;
  path: string;
  action: ConversationFileAction;
}

export interface ConversationDirNode {
  kind: 'dir';
  name: string;
  path: string;
  children: ConversationTreeNode[];
}

export type ConversationTreeNode = ConversationDirNode | ConversationFileNode;

export function workspaceTreeOffset(depth: number, extra = 0): CSSProperties {
  return {
    paddingLeft: WORKSPACE_TREE_PAD + depth * WORKSPACE_TREE_STEP + extra,
    '--shell-tree-guide-left': `${13 + Math.max(0, depth - 1) * WORKSPACE_TREE_STEP}px`,
  } as CSSProperties;
}

export function projectRelativePath(path: string, projectFolder?: string): string {
  const file = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const root = projectFolder?.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!file) return '';
  if (!root) return file;
  const fileLower = file.toLowerCase();
  const rootLower = root.toLowerCase();
  if (fileLower === rootLower) return file.split('/').pop() || file;
  if (fileLower.startsWith(`${rootLower}/`)) return file.slice(root.length + 1);
  return file;
}

export function conversationFileStatus(action: ConversationFileAction): 'A' | 'M' | 'D' {
  if (action === 'created') return 'A';
  if (action === 'deleted') return 'D';
  return 'M';
}

export function collectConversationDirPaths(nodes: ConversationTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== 'dir') continue;
    paths.push(node.path, ...collectConversationDirPaths(node.children));
  }
  return paths;
}

function compareTreeNodes(left: ConversationTreeNode, right: ConversationTreeNode): number {
  if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
}

function sortTree(nodes: ConversationTreeNode[]): ConversationTreeNode[] {
  return [...nodes]
    .map((node) =>
      node.kind === 'dir' ? { ...node, children: sortTree(node.children) } : node,
    )
    .sort(compareTreeNodes);
}

export function buildConversationFileTree(
  changes: Array<Pick<FileChangeItem, 'path' | 'action'>>,
  projectFolder?: string,
): ConversationTreeNode[] {
  const files = new Map<string, ConversationFileNode>();
  for (const change of changes) {
    const relative = projectRelativePath(change.path, projectFolder);
    if (!relative || relative === '.' || relative.split('/').includes('..')) continue;
    files.set(relative, {
      kind: 'file',
      name: relative.split('/').at(-1) || relative,
      path: relative,
      action: change.action,
    });
  }

  const dirs = new Map<string, ConversationDirNode>();
  const ensureDir = (dirPath: string): ConversationDirNode => {
    const existing = dirs.get(dirPath);
    if (existing) return existing;
    const node: ConversationDirNode = {
      kind: 'dir',
      name: dirPath.split('/').at(-1) || dirPath,
      path: dirPath,
      children: [],
    };
    dirs.set(dirPath, node);
    const parent = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : '';
    if (parent) ensureDir(parent).children.push(node);
    return node;
  };

  const roots: ConversationTreeNode[] = [];
  for (const file of files.values()) {
    const parent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
    if (parent) ensureDir(parent).children.push(file);
    else roots.push(file);
  }
  for (const [dirPath, node] of dirs) {
    if (!dirPath.includes('/')) roots.push(node);
  }
  return sortTree(roots);
}
