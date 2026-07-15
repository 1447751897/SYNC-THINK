import { isAbsolute, normalize, resolve, sep } from 'node:path';

export class WorkspacePathError extends Error {
  readonly code = 'security.path_traversal' as const;

  constructor(message: string) {
    super(message);
    this.name = 'WorkspacePathError';
  }
}

/**
 * Canonical absolute workspace folder path for Windows-first local storage.
 * Rejects empty, relative, and traversal-only inputs before any DB write.
 */
export function canonicalizeWorkspacePath(input: string): string {
  if (typeof input !== 'string') {
    throw new WorkspacePathError('Workspace path must be a string');
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new WorkspacePathError('Workspace path must not be empty');
  }
  if (!isAbsolute(trimmed)) {
    throw new WorkspacePathError('Workspace path must be absolute');
  }

  // resolve() collapses `.` / `..` and normalizes separators for the host OS.
  const resolved = resolve(trimmed);
  const normalized = normalize(resolved);

  // Defensive: resolve can still yield non-absolute on pathological input.
  if (!isAbsolute(normalized)) {
    throw new WorkspacePathError('Workspace path must resolve to an absolute path');
  }

  // Strip trailing separators except for root paths like `D:\`.
  if (normalized.length > 3 && (normalized.endsWith(sep) || normalized.endsWith('/') || normalized.endsWith('\\'))) {
    return normalized.replace(/[\\/]+$/, '');
  }
  return normalized;
}

export function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const root = canonicalizeWorkspacePath(rootPath);
  const candidate = canonicalizeWorkspacePath(candidatePath);
  if (pathsEqual(root, candidate)) return true;

  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  const candidateLower = candidate.toLowerCase();
  const rootWithSepLower = rootWithSep.toLowerCase();
  return candidateLower.startsWith(rootWithSepLower);
}

/**
 * When `allowedRoots` is empty, first-folder onboarding may add any absolute path.
 * Once roots exist, new workspace folders must equal or nest under an allowlisted root.
 */
export function assertAllowedWorkspacePath(input: string, allowedRoots: readonly string[]): string {
  const canonical = canonicalizeWorkspacePath(input);
  if (allowedRoots.length === 0) return canonical;

  const roots = allowedRoots.map((root) => canonicalizeWorkspacePath(root));
  const allowed = roots.some((root) => isPathInsideRoot(root, canonical));
  if (!allowed) {
    throw new WorkspacePathError('Workspace path is outside the allowlisted roots');
  }
  return canonical;
}

function pathsEqual(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
