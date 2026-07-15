import type { Worker, WorkerEvent, WorkerJobInput, WorkerJobOutput, WorkerToken } from '../types.js';

export interface TerminalAction {
  cmd: string;
  cwd?: string;
}

export interface TerminalWorkerInput extends WorkerJobInput {
  action: TerminalAction;
}

export interface TerminalWorkerOutput extends WorkerJobOutput {
  exitCode?: number;
}

export interface TerminalWorker extends Worker<TerminalWorkerInput> {
  readonly kind: 'terminal';
}

export class FakeTerminalWorker implements TerminalWorker {
  readonly kind = 'terminal' as const;
  async *exec(_input: TerminalWorkerInput, _token: WorkerToken): AsyncIterable<WorkerEvent> {
    yield { type: 'stderr', text: '[fake-terminal] commands deferred to Phase 3 real worker' };
    yield { type: 'completed', output: { ok: false, message: 'terminal fake' } };
  }
}
