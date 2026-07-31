import type {
  Worker,
  WorkerEvent,
  WorkerJobInput,
  WorkerJobOutput,
  WorkerToken,
} from '../types.js';
import { isAbsolute, resolve, win32 } from 'node:path';
import { isPathInside } from '../types.js';
import {
  isCommandAllowed,
  isRealPathInside,
  runBoundedProcess,
  startRefusal,
  validateProcessArguments,
} from '../process-runner.js';

export interface TerminalAction {
  command: string;
  args?: string[];
  cwd?: string;
}

export interface TerminalWorkerInput extends WorkerJobInput {
  action: TerminalAction;
}

export interface TerminalWorkerOutput extends WorkerJobOutput {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  truncated?: boolean;
  timedOut?: boolean;
  shell?: false;
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

export class TerminalProcessWorker implements TerminalWorker {
  readonly kind = 'terminal' as const;

  async *exec(input: TerminalWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    const command = String(input.action.command ?? '').trim();
    const args = input.action.args ?? [];
    const relativeCwd = input.action.cwd ?? '.';
    const workingDir = resolve(input.workingDir);
    const cwd = resolve(workingDir, relativeCwd);
    if (
      !command ||
      isAbsolute(relativeCwd) ||
      win32.isAbsolute(relativeCwd) ||
      !isPathInside(workingDir, resolve(token.allowedRoot)) ||
      !isPathInside(cwd, resolve(token.allowedRoot)) ||
      !(await isRealPathInside(workingDir, token.allowedRoot)) ||
      !(await isRealPathInside(cwd, token.allowedRoot))
    ) {
      yield permissionFailure('security.path_traversal', 'Terminal cwd escapes allowedRoot');
      return;
    }
    if (!isCommandAllowed(command, token.allowedCommands)) {
      yield permissionFailure(
        'worker.command-denied',
        'Command is not present in the capability allowlist',
      );
      return;
    }
    if (!validateProcessArguments(args)) {
      yield permissionFailure(
        'worker.arguments-invalid',
        'Command arguments are invalid or too large',
      );
      return;
    }
    const refusal = startRefusal(token);
    if (refusal) {
      yield startFailure(refusal);
      return;
    }

    const queued: WorkerEvent[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    const executionController = new AbortController();
    const forwardAbort = () => executionController.abort();
    token.signal?.addEventListener('abort', forwardAbort, { once: true });
    if (token.signal?.aborted) executionController.abort();
    const enqueue = (event: WorkerEvent) => {
      queued.push(event);
      wake?.();
      wake = undefined;
    };
    const completion = runBoundedProcess(command, args, cwd, {
      ...token,
      signal: executionController.signal,
    }, {
      onStdout: (text) => enqueue({ type: 'stdout', text }),
      onStderr: (text) => enqueue({ type: 'stderr', text }),
    }).finally(() => {
      finished = true;
      wake?.();
      wake = undefined;
    });
    try {
      while (!finished || queued.length > 0) {
        if (queued.length === 0) {
          await new Promise<void>((resolveWake) => {
            wake = resolveWake;
          });
        }
        while (queued.length > 0) {
          yield queued.shift()!;
        }
      }
      const result = await completion;
      if (result.aborted) {
        yield startFailure('aborted');
        return;
      }
      if (result.timedOut) {
        yield {
          type: 'failed',
          failureClass: 'timeout',
          error: { code: 'worker.timeout', message: 'Terminal command timed out' },
        };
        return;
      }
      if (result.spawnError) {
        yield {
          type: 'failed',
          failureClass: 'unknown',
          error: { code: 'worker.spawn-failed', message: result.spawnError },
        };
        return;
      }
      yield {
        type: 'completed',
        output: {
          ok: result.exitCode === 0,
          message:
            result.exitCode === 0
              ? 'Terminal command completed'
              : `Terminal command exited with code ${String(result.exitCode)}`,
          exitCode: result.exitCode ?? undefined,
          stdout: result.stdout,
          stderr: result.stderr,
          truncated: result.truncated,
          timedOut: false,
          shell: false,
        },
      };
    } finally {
      token.signal?.removeEventListener('abort', forwardAbort);
      if (!finished) executionController.abort();
      await completion.catch(() => undefined);
    }
  }
}

function permissionFailure(code: string, message: string): WorkerEvent {
  return { type: 'failed', failureClass: 'permission', error: { code, message } };
}

function startFailure(reason: 'aborted' | 'fence-rejected'): WorkerEvent {
  return {
    type: 'failed',
    failureClass: 'acceptance',
    error: {
      code: reason === 'aborted' ? 'worker.aborted' : 'worker.fence-rejected',
      message: reason === 'aborted' ? 'Terminal command was cancelled' : 'Execution fence rejected',
    },
  };
}
