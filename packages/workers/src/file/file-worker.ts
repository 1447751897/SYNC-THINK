import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path';
import type {
  Worker,
  WorkerEvent,
  WorkerJobInput,
  WorkerJobOutput,
  WorkerToken,
} from '../types.js';
import { isPathInside } from '../types.js';
import { DEFAULT_MAX_OUTPUT_BYTES, startRefusal } from '../process-runner.js';

export interface FileAction {
  kind: 'read' | 'write' | 'list' | 'delete';
  relative?: string;
  content?: string;
  maxEntries?: number;
}

export interface FileWorkerInput extends WorkerJobInput {
  action: FileAction;
}

export interface FileWorkerOutput extends WorkerJobOutput {
  content?: string;
  entries?: string[];
  bytes?: number;
}

export interface FileWorker extends Worker<FileWorkerInput> {
  readonly kind: 'file';
}

export class FakeFileWorker implements FileWorker {
  readonly kind = 'file' as const;
  async *exec(input: FileWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    if (
      input.action.relative &&
      !isPathInside(`${input.workingDir}/${input.action.relative}`, token.allowedRoot)
    ) {
      yield {
        type: 'failed',
        failureClass: 'permission',
        error: { code: 'security.path_traversal', message: 'relative path escapes allowedRoot' },
      };
      return;
    }
    yield { type: 'stderr', text: `[fake-file] ${input.action.kind} ignored in Phase 0` };
    yield { type: 'completed', output: { ok: false, message: 'file worker fake' } };
  }
}

const MAX_WRITE_BYTES = 1024 * 1024;

export class FileSystemWorker implements FileWorker {
  readonly kind = 'file' as const;

  async *exec(input: FileWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    try {
      const target = await resolveFileTarget(input, token, input.action.kind === 'write');
      const refusal = startRefusal(token);
      if (refusal) {
        yield failedStart(refusal);
        return;
      }

      if (input.action.kind === 'delete') {
        yield {
          type: 'failed',
          failureClass: 'permission',
          error: {
            code: 'worker.delete-disabled',
            message: 'Irreversible file deletion is not exposed by the built-in file worker',
          },
        };
        return;
      }

      const maxOutputBytes = Math.max(
        1,
        Math.min(token.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, 1024 * 1024),
      );
      if (input.action.kind === 'read') {
        const info = await stat(target);
        if (!info.isFile()) throw new Error('worker.file-not-regular');
        if (info.size > maxOutputBytes) {
          yield outputLimitFailure();
          return;
        }
        const content = await readFile(target, 'utf8');
        const bytes = Buffer.byteLength(content, 'utf8');
        if (bytes > maxOutputBytes) {
          yield outputLimitFailure();
          return;
        }
        yield { type: 'stdout', text: content };
        yield {
          type: 'completed',
          output: { ok: true, message: 'File read completed', content, bytes },
        };
        return;
      }

      if (input.action.kind === 'list') {
        const maxEntries = Math.max(1, Math.min(input.action.maxEntries ?? 500, 2_000));
        const entries = (await readdir(target, { withFileTypes: true }))
          .sort((left, right) => left.name.localeCompare(right.name))
          .slice(0, maxEntries)
          .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
        if (Buffer.byteLength(JSON.stringify(entries), 'utf8') > maxOutputBytes) {
          yield outputLimitFailure();
          return;
        }
        yield {
          type: 'completed',
          output: { ok: true, message: 'Directory listing completed', entries },
        };
        return;
      }

      const content = input.action.content;
      if (typeof content !== 'string') throw new Error('worker.file-content-required');
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > MAX_WRITE_BYTES) throw new Error('worker.file-write-too-large');
      await mkdir(dirname(target), { recursive: true });
      const temporary = join(dirname(target), `.${randomUUID()}.sync-think.tmp`);
      try {
        await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', signal: token.signal });
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
      yield {
        type: 'completed',
        output: { ok: true, message: 'File write completed', bytes },
      };
    } catch (error) {
      const aborted =
        token.signal?.aborted || (error instanceof Error && error.name === 'AbortError');
      const message = error instanceof Error ? error.message : 'File worker failed';
      const permission = message.startsWith('security.path_traversal');
      yield {
        type: 'failed',
        failureClass: permission ? 'permission' : 'unknown',
        error: {
          code: aborted ? 'worker.aborted' : permission ? 'security.path_traversal' : message,
          message: aborted ? 'File operation was cancelled' : message,
        },
      };
    }
  }
}

async function resolveFileTarget(
  input: FileWorkerInput,
  token: WorkerToken,
  allowMissing: boolean,
): Promise<string> {
  const relative = input.action.relative ?? '.';
  if (isAbsolute(relative) || win32.isAbsolute(relative)) {
    throw new Error('security.path_traversal: absolute paths are not accepted');
  }
  const workingDir = resolve(input.workingDir);
  const allowedRoot = resolve(token.allowedRoot);
  if (!isPathInside(workingDir, allowedRoot)) {
    throw new Error('security.path_traversal: workingDir escapes allowedRoot');
  }
  const target = resolve(workingDir, relative);
  if (!isPathInside(target, allowedRoot)) {
    throw new Error('security.path_traversal: relative path escapes allowedRoot');
  }

  const realRoot = await realpath(allowedRoot);
  let existing = target;
  while (true) {
    try {
      await access(existing);
      break;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) {
        if (allowMissing) break;
        throw new Error('worker.file-not-found');
      }
      existing = parent;
    }
  }
  const realExisting = await realpath(existing);
  if (!isPathInside(realExisting, realRoot)) {
    throw new Error('security.path_traversal: symlink escapes allowedRoot');
  }
  if (!allowMissing && existing !== target) throw new Error('worker.file-not-found');
  return target;
}

function failedStart(reason: 'aborted' | 'fence-rejected'): WorkerEvent {
  return {
    type: 'failed',
    failureClass: 'acceptance',
    error: {
      code: reason === 'aborted' ? 'worker.aborted' : 'worker.fence-rejected',
      message:
        reason === 'aborted' ? 'File operation was cancelled' : 'File execution fence rejected',
    },
  };
}

function outputLimitFailure(): WorkerEvent {
  return {
    type: 'failed',
    failureClass: 'acceptance',
    error: { code: 'worker.output-limit', message: 'File output exceeds the configured limit' },
  };
}
