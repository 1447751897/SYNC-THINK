import type { Worker, WorkerEvent, WorkerJobInput, WorkerJobOutput, WorkerToken } from '../types.js';

export interface GitAction {
  cmd: 'status' | 'diff' | 'log' | 'branch';
}

export interface GitWorkerInput extends WorkerJobInput {
  action: GitAction;
}

export interface GitWorkerOutput extends WorkerJobOutput {
  stdout?: string;
}

export interface GitWorker extends Worker<GitWorkerInput> {
  readonly kind: 'git';
}

export class FakeGitWorker implements GitWorker {
  readonly kind = 'git' as const;
  async *exec(input: GitWorkerInput, _token: WorkerToken): AsyncIterable<WorkerEvent> {
    yield { type: 'stderr', text: `[fake-git] ${input.action.cmd} deferred to Phase 3` };
    yield { type: 'completed', output: { ok: false, message: 'git fake returning early' } };
  }
}
