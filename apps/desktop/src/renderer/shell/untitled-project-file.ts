export const UNTITLED_DOCUMENT_CONTENT = '';

export function allocateUntitledDocumentPath(openPaths: readonly string[] = []): string {
  return allocateUntitledPath(openPaths, 'notes', '未命名文档', 'md');
}

export function allocateUntitledCanvasPath(openPaths: readonly string[] = []): string {
  return allocateUntitledPath(openPaths, 'designs', '未命名绘图', 'excalidraw');
}

function allocateUntitledPath(
  openPaths: readonly string[],
  directory: string,
  stem: string,
  extension: string,
): string {
  const taken = new Set(openPaths.map((path) => path.replace(/\\/g, '/')));
  const first = `${directory}/${stem}.${extension}`;
  if (!taken.has(first)) return first;
  for (let index = 2; index < 1000; index += 1) {
    const next = `${directory}/${stem}-${index}.${extension}`;
    if (!taken.has(next)) return next;
  }
  return `${directory}/${stem}-${Date.now()}.${extension}`;
}

export interface UntitledFileWriteResult {
  ok: boolean;
  conflict: boolean;
  error: string | null;
  path: string;
}

export async function createUntitledProjectFile(input: {
  kind: 'document' | 'canvas';
  openPaths: readonly string[];
  canvasContent: string;
  write: (path: string, content: string) => Promise<UntitledFileWriteResult>;
}): Promise<{ path: string } | { error: string }> {
  const taken = [...input.openPaths];
  const failed = input.kind === 'canvas' ? '新建绘图失败' : '新建文档失败';
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const path =
      input.kind === 'canvas'
        ? allocateUntitledCanvasPath(taken)
        : allocateUntitledDocumentPath(taken);
    const content = input.kind === 'canvas' ? input.canvasContent : UNTITLED_DOCUMENT_CONTENT;
    const saved = await input.write(path, content);
    if (saved.ok) return { path: saved.path || path };
    if (saved.conflict) {
      taken.push(path);
      continue;
    }
    return { error: saved.error ?? failed };
  }
  return { error: failed };
}

export function collectOpenFilePaths(input: {
  panes?: Iterable<{ tabs: readonly { type: string; path?: string }[] }>;
  workbenchTabs?: Iterable<{ type: string; path?: string }>;
}): string[] {
  const paths: string[] = [];
  for (const pane of input.panes ?? []) {
    for (const tab of pane.tabs) {
      if (tab.type === 'file' && tab.path) paths.push(tab.path);
    }
  }
  for (const tab of input.workbenchTabs ?? []) {
    if (tab.type === 'file' && tab.path) paths.push(tab.path);
  }
  return paths;
}
