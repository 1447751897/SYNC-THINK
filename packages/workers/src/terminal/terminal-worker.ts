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

    const result = await runBoundedProcess(command, args, cwd, token);
    if (result.stdout) yield { type: 'stdout', text: result.stdout };
    if (result.stderr) yield { type: 'stderr', text: result.stderr };
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
