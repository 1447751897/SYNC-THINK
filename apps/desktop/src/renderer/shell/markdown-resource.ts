import type { ProjectTextLocation } from '../../workspace-tools-contract.js';

export interface WorkspaceResource {
  path: string;
  label: string;
  location?: ProjectTextLocation;
  kind: 'code' | 'image' | 'directory';
}

export function normalizeMarkdownPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/[/]+/g, '/').replace(/[/]$/, '');
}

/** Resolve only paths inside the current workspace and preserve the cited location. */
export function workspaceResourceFromHref(
  href: string,
  projectFolder?: string,
): WorkspaceResource | null {
  if (!projectFolder) return null;
  let decoded = href.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* Keep invalid escapes literal. */
  }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(decoded) && !/^[a-z]:[\\/]/i.test(decoded)) return null;
  const lineMatch =
    /(?:#L([1-9]\d*)(?:C([1-9]\d*))?(?:-L[1-9]\d*)?|:([1-9]\d*)(?::([1-9]\d*))?)$/.exec(decoded);
  const rawPath = lineMatch ? decoded.slice(0, lineMatch.index) : decoded;
  if (/[#?\u0000-\u001f]/.test(rawPath)) return null;
  const normalizedRoot = normalizeMarkdownPath(projectFolder);
  let path = normalizeMarkdownPath(rawPath);
  const windows = /^[a-z]:\//i.test(normalizedRoot);
  const comparableRoot = windows ? normalizedRoot.toLowerCase() : normalizedRoot;
  const comparablePath = windows ? path.toLowerCase() : path;
  if (comparablePath === comparableRoot) return null;
  if (comparablePath.startsWith(comparableRoot + '/')) path = path.slice(normalizedRoot.length + 1);
  else if (!path.startsWith('/') && !/^[a-z]:\//i.test(path)) path = path.replace(/^\.\//, '');
  else return null;
  if (!path || path.split('/').some((segment) => segment === '..')) return null;
  const label = path.split('/').at(-1) || path;
  const extension = label.includes('.') ? label.split('.').at(-1)?.toLowerCase() : '';
  const kind =
    extension && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(extension)
      ? 'image'
      : extension
        ? 'code'
        : 'directory';
  const line = lineMatch ? Number(lineMatch[1] ?? lineMatch[3]) : undefined;
  const column = lineMatch ? Number(lineMatch[2] ?? lineMatch[4] ?? 1) : undefined;
  if (line !== undefined && (!Number.isSafeInteger(line) || !Number.isSafeInteger(column)))
    return null;
  return {
    path,
    label,
    kind,
    ...(line === undefined ? {} : { location: { line, column: column! } }),
  };
}
