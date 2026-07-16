import type {
  Worker,
  WorkerEvent,
  WorkerJobInput,
  WorkerJobOutput,
  WorkerToken,
} from '../types.js';
import { isAbsolute, resolve, win32 } from 'node:path';
import { isPathInside } from '../types.js';
import { isRealPathInside, runBoundedProcess, startRefusal } from '../process-runner.js';

export interface GitAction {
  cmd: 'status' | 'diff' | 'log' | 'branch';
  staged?: boolean;
  relative?: string;
}

export interface GitWorkerInput extends WorkerJobInput {
  action: GitAction;
}

export interface GitWorkerOutput extends WorkerJobOutput {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  truncated?: boolean;
  shell?: false;
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

export class GitProcessWorker implements GitWorker {
  readonly kind = 'git' as const;

  async *exec(input: GitWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    const workingDir = resolve(input.workingDir);
    const allowedRoot = resolve(token.allowedRoot);
    if (
      !isPathInside(workingDir, allowedRoot) ||
      !(await isRealPathInside(workingDir, allowedRoot))
    ) {
      yield permissionFailure('Git workingDir escapes allowedRoot');
      return;
    }
    const relative = input.action.relative;
    if (
      relative &&
      (isAbsolute(relative) ||
        win32.isAbsolute(relative) ||
        !isPathInside(resolve(workingDir, relative), allowedRoot) ||
        !(await isRealPathInside(resolve(workingDir, relative), allowedRoot, true)))
    ) {
      yield permissionFailure('Git path escapes allowedRoot');
      return;
    }
    const refusal = startRefusal(token);
    if (refusal) {
      yield {
        type: 'failed',
        failureClass: 'acceptance',
        error: {
          code: refusal === 'aborted' ? 'worker.aborted' : 'worker.fence-rejected',
          message:
            refusal === 'aborted' ? 'Git operation was cancelled' : 'Execution fence rejected',
        },
      };
      return;
    }

    const args = gitArgs(input.action);
    const result = await runBoundedProcess('git', args, workingDir, {
      ...token,
      allowedCommands: ['git', 'git.exe'],
    });
    if (result.stdout) yield { type: 'stdout', text: result.stdout };
    if (result.stderr) yield { type: 'stderr', text: result.stderr };
    if (result.aborted) {
      yield {
        type: 'failed',
        failureClass: 'acceptance',
        error: { code: 'worker.aborted', message: 'Git operation was cancelled' },
      };
      return;
    }
    if (result.timedOut) {
      yield {
        type: 'failed',
        failureClass: 'timeout',
        error: { code: 'worker.timeout', message: 'Git operation timed out' },
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
            ? 'Git operation completed'
            : `Git exited with code ${String(result.exitCode)}`,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode ?? undefined,
        truncated: result.truncated,
        shell: false,
      },
    };
  }
}

function gitArgs(action: GitAction): string[] {
  switch (action.cmd) {
    case 'status':
      return ['--literal-pathspecs', 'status', '--short', '--branch', '--untracked-files=all'];
    case 'diff':
      return [
        '--literal-pathspecs',
        'diff',
        '--no-ext-diff',
        '--no-color',
        ...(action.staged ? ['--cached'] : []),
        ...(action.relative ? ['--', action.relative] : []),
      ];
    case 'log':
      return ['--literal-pathspecs', 'log', '--oneline', '--decorate', '--max-count=50'];
    case 'branch':
      return ['--literal-pathspecs', 'branch', '--show-current'];
  }
}

function permissionFailure(message: string): WorkerEvent {
  return {
    type: 'failed',
    failureClass: 'permission',
    error: { code: 'security.path_traversal', message },
  };
}
