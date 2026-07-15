import type { Worker, WorkerEvent, WorkerJobInput, WorkerJobOutput, WorkerToken } from '../types.js';
import { isPathInside } from '../types.js';

export interface FileAction {
  kind: 'read' | 'write' | 'list' | 'delete';
  relative?: string;
  content?: string;
}

export interface FileWorkerInput extends WorkerJobInput {
  action: FileAction;
}

export interface FileWorkerOutput extends WorkerJobOutput {
  content?: string;
  entries?: string[];
}

export interface FileWorker extends Worker<FileWorkerInput> {
  readonly kind: 'file';
}

export class FakeFileWorker implements FileWorker {
  readonly kind = 'file' as const;
  async *exec(input: FileWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    if (input.action.relative && !isPathInside(`${input.workingDir}/${input.action.relative}`, token.allowedRoot)) {
      yield { type: 'failed', failureClass: 'permission', error: { code: 'security.path_traversal', message: 'relative path escapes allowedRoot' } };
      return;
    }
    yield { type: 'stderr', text: `[fake-file] ${input.action.kind} ignored in Phase 0` };
    yield { type: 'completed', output: { ok: false, message: 'file worker fake' } };
  }
}
