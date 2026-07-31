import { randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';

const MAX_READ_BYTES = 512 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;

export interface ProjectFileReadRequest {
  root: string;
  path: string;
}

export interface ProjectFileReadResult {
  path: string;
  content: string | null;
  error: string | null;
  errorCode: 'file_not_found' | 'file_not_regular' | 'file_too_large' | 'file_binary' | 'file_read_failed' | null;
  mtimeMs: number | null;
  size: number | null;
}

export interface ProjectFileWriteRequest extends ProjectFileReadRequest {
  content: string;
  expectedMtimeMs: number | null;
  expectedSize?: number | null;
  force?: boolean;
}

export interface ProjectFileWriteResult {
  path: string;
  ok: boolean;
  conflict: boolean;
  error: string | null;
  errorCode: 'file_conflict' | 'file_too_large' | 'file_write_failed' | null;
  mtimeMs: number | null;
  size: number | null;
}

export interface ProjectFileChange {
  path: string;
  exists: boolean;
  mtimeMs: number | null;
  size: number | null;
}

type WatchFactory = (
  directory: string,
  listener: (eventType: string, filename: string | Buffer | null) => void,
) => FSWatcher;

export interface ProjectFileWatchOptions {
  debounceMs?: number;
  pollIntervalMs?: number;
  watchFactory?: WatchFactory;
}

interface FileMetadata {
  exists: boolean;
  mtimeMs: number | null;
  size: number | null;
}

interface ResolvedProjectTarget {
  normalizedPath: string;
  root: string;
  target: string;
}

function securityError(message: string): Error {
  return new Error(`security.path_traversal: ${message}`);
}

function isSecurityError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('security.path_traversal:');
}

function isPathInside(target: string, root: string): boolean {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot === '' ||
    (pathFromRoot !== '..' &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot) &&
      !win32.isAbsolute(pathFromRoot))
  );
}

function normalizeProjectPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw securityError('file path is required');
  if (isAbsolute(trimmed) || win32.isAbsolute(trimmed)) {
    throw securityError('absolute paths are not accepted');
  }
  return trimmed.replace(/\\/g, '/');
}

async function resolveProjectTarget(
  request: ProjectFileReadRequest,
  allowMissing: boolean,
): Promise<ResolvedProjectTarget> {
  const normalizedPath = normalizeProjectPath(request.path);
  const root = resolve(request.root);
  const target = resolve(root, ...normalizedPath.split('/'));
  if (!isPathInside(target, root)) throw securityError('file path escapes the project root');

  const realRoot = await realpath(root);
  let existing = target;
  while (true) {
    try {
      await access(existing);
      break;
    } catch {
      const parent = dirname(existing);
      if (parent === existing || !isPathInside(parent, root)) {
        if (allowMissing) throw new Error('file_not_found');
        throw new Error('file_not_found');
      }
      existing = parent;
    }
  }

  const realExisting = await realpath(existing);
  if (!isPathInside(realExisting, realRoot)) {
    throw securityError('symbolic link or junction escapes the project root');
  }
  if (!allowMissing && existing !== target) throw new Error('file_not_found');
  return { normalizedPath, root, target };
}

async function fileMetadata(target: string): Promise<FileMetadata> {
  try {
    const info = await stat(target);
    if (!info.isFile()) return { exists: false, mtimeMs: null, size: null };
    return { exists: true, mtimeMs: info.mtimeMs, size: info.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, mtimeMs: null, size: null };
    }
    throw error;
  }
}

function readError(
  path: string,
  error: string,
  errorCode: NonNullable<ProjectFileReadResult['errorCode']>,
  metadata: FileMetadata = { exists: false, mtimeMs: null, size: null },
): ProjectFileReadResult {
  return {
    path,
    content: null,
    error,
    errorCode,
    mtimeMs: metadata.mtimeMs,
    size: metadata.size,
  };
}

export async function readProjectFile(
  request: ProjectFileReadRequest,
): Promise<ProjectFileReadResult> {
  let normalizedPath = request.path.trim().replace(/\\/g, '/');
  try {
    const resolved = await resolveProjectTarget(request, false);
    normalizedPath = resolved.normalizedPath;
    const metadata = await fileMetadata(resolved.target);
    if (!metadata.exists) return readError(normalizedPath, '不是普通文件', 'file_not_regular');
    if ((metadata.size ?? 0) > MAX_READ_BYTES) {
      return readError(
        normalizedPath,
        '文件超过 512KB，暂不支持编辑',
        'file_too_large',
        metadata,
      );
    }
    const content = await readFile(resolved.target, 'utf8');
    if (content.includes('\0')) {
      return readError(normalizedPath, '二进制文件暂不支持编辑', 'file_binary', metadata);
    }
    return {
      path: normalizedPath,
      content,
      error: null,
      errorCode: null,
      mtimeMs: metadata.mtimeMs,
      size: metadata.size,
    };
  } catch (error) {
    if (isSecurityError(error)) throw error;
    const notFound = error instanceof Error && error.message === 'file_not_found';
    return readError(
      normalizedPath,
      notFound ? '文件不存在' : '读取失败',
      notFound ? 'file_not_found' : 'file_read_failed',
    );
  }
}

function hasWriteConflict(
  metadata: FileMetadata,
  expectedMtimeMs: number | null,
  expectedSize?: number | null,
): boolean {
  if (expectedMtimeMs === null) return metadata.exists;
  if (!metadata.exists || metadata.mtimeMs !== expectedMtimeMs) return true;
  return expectedSize !== undefined && expectedSize !== null && metadata.size !== expectedSize;
}

function writeResult(
  path: string,
  values: Pick<ProjectFileWriteResult, 'ok' | 'conflict' | 'error' | 'errorCode'>,
  metadata: FileMetadata = { exists: false, mtimeMs: null, size: null },
): ProjectFileWriteResult {
  return {
    path,
    ...values,
    mtimeMs: metadata.mtimeMs,
    size: metadata.size,
  };
}

export async function writeProjectFile(
  request: ProjectFileWriteRequest,
): Promise<ProjectFileWriteResult> {
  let normalizedPath = request.path.trim().replace(/\\/g, '/');
  try {
    const bytes = Buffer.byteLength(request.content, 'utf8');
    if (bytes > MAX_WRITE_BYTES) {
      return writeResult(normalizedPath, {
        ok: false,
        conflict: false,
        error: '文件超过 1MB，暂不支持保存',
        errorCode: 'file_too_large',
      });
    }

    const resolved = await resolveProjectTarget(request, true);
    normalizedPath = resolved.normalizedPath;
    let current = await fileMetadata(resolved.target);
    if (
      !request.force &&
      hasWriteConflict(current, request.expectedMtimeMs, request.expectedSize)
    ) {
      return writeResult(
        normalizedPath,
        {
          ok: false,
          conflict: true,
          error: '文件已在磁盘上发生变化',
          errorCode: 'file_conflict',
        },
        current,
      );
    }

    await mkdir(dirname(resolved.target), { recursive: true });
    const temporary = resolve(
      dirname(resolved.target),
      `.${basename(resolved.target)}.${randomUUID()}.sync-think.tmp`,
    );
    try {
      await writeFile(temporary, request.content, { encoding: 'utf8', flag: 'wx' });
      current = await fileMetadata(resolved.target);
      if (
        !request.force &&
        hasWriteConflict(current, request.expectedMtimeMs, request.expectedSize)
      ) {
        return writeResult(
          normalizedPath,
          {
            ok: false,
            conflict: true,
            error: '文件已在磁盘上发生变化',
            errorCode: 'file_conflict',
          },
          current,
        );
      }
      await rename(temporary, resolved.target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }

    const saved = await fileMetadata(resolved.target);
    return writeResult(
      normalizedPath,
      { ok: true, conflict: false, error: null, errorCode: null },
      saved,
    );
  } catch (error) {
    if (isSecurityError(error)) throw error;
    return writeResult(normalizedPath, {
      ok: false,
      conflict: false,
      error: '保存失败',
      errorCode: 'file_write_failed',
    });
  }
}

function metadataKey(metadata: FileMetadata): string {
  return `${metadata.exists ? '1' : '0'}:${metadata.mtimeMs ?? ''}:${metadata.size ?? ''}`;
}

async function watchedMetadata(request: ProjectFileReadRequest): Promise<FileMetadata> {
  try {
    const resolved = await resolveProjectTarget(request, true);
    return fileMetadata(resolved.target);
  } catch {
    return { exists: false, mtimeMs: null, size: null };
  }
}

export async function watchProjectFile(
  request: ProjectFileReadRequest,
  listener: (change: ProjectFileChange) => void,
  options: ProjectFileWatchOptions = {},
): Promise<() => void> {
  const resolved = await resolveProjectTarget(request, true);
  const debounceMs = Math.max(0, options.debounceMs ?? 100);
  const pollIntervalMs = Math.max(10, options.pollIntervalMs ?? 5_000);
  const watchFactory =
    options.watchFactory ??
    ((directory, onChange) => watch(directory, { persistent: false }, onChange));
  let disposed = false;
  let debounceTimer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher | undefined;
  let current = await watchedMetadata(request);

  const probe = async () => {
    if (disposed) return;
    const next = await watchedMetadata(request);
    if (metadataKey(next) === metadataKey(current)) return;
    current = next;
    listener({
      path: resolved.normalizedPath,
      exists: next.exists,
      mtimeMs: next.mtimeMs,
      size: next.size,
    });
  };
  const scheduleProbe = () => {
    if (disposed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void probe(), debounceMs);
    debounceTimer.unref?.();
  };

  try {
    watcher = watchFactory(dirname(resolved.target), (_eventType, filename) => {
      const changedName = filename === null ? null : filename.toString();
      if (changedName === null || changedName === basename(resolved.target)) scheduleProbe();
    });
    watcher.on('error', () => {
      watcher?.close();
      watcher = undefined;
    });
  } catch {
    watcher = undefined;
  }

  const pollTimer = setInterval(scheduleProbe, pollIntervalMs);
  pollTimer.unref?.();
  return () => {
    if (disposed) return;
    disposed = true;
    watcher?.close();
    clearInterval(pollTimer);
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}
