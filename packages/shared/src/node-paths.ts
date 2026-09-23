import { posix, win32, type PlatformPath } from 'node:path';

function isFullyQualifiedWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(value);
}

function absolutePathApi(rootPath: string, candidatePath: string): PlatformPath | undefined {
  if (isFullyQualifiedWindowsPath(rootPath) && isFullyQualifiedWindowsPath(candidatePath)) {
    return win32;
  }
  if (posix.isAbsolute(rootPath) && posix.isAbsolute(candidatePath)) return posix;
  return undefined;
}

/**
 * Pure lexical containment for absolute paths. Filesystem owners must perform
 * their own realpath check when symbolic links or junctions are in scope.
 */
export function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  if (!rootPath || !candidatePath) return false;
  const pathApi = absolutePathApi(rootPath, candidatePath);
  if (!pathApi) return false;
  const scoped = pathApi.relative(pathApi.resolve(rootPath), pathApi.resolve(candidatePath));
  return (
    scoped === '' ||
    (scoped !== '..' &&
      !scoped.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(scoped))
  );
}
