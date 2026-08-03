import type {
  Worker,
  WorkerEvent,
  WorkerJobInput,
  WorkerJobOutput,
  WorkerToken,
} from '../types.js';
import type { DesktopAction, DesktopActionResult } from './desktop-contract.js';
import {
  DesktopHostClient,
  DesktopHostError,
  type DesktopFailureClass,
  type DesktopHostExecutor,
} from './desktop-host-client.js';

export type { DesktopAction } from './desktop-contract.js';

export interface DesktopWorkerInput extends WorkerJobInput {
  action: DesktopAction;
}

export interface DesktopWorkerOutput extends WorkerJobOutput {
  result?: DesktopActionResult;
}

export interface DesktopWorker extends Worker<DesktopWorkerInput> {
  readonly kind: 'desktop';
}

export class IsolatedDesktopWorker implements DesktopWorker {
  readonly kind = 'desktop' as const;

  constructor(private readonly host: DesktopHostExecutor = new DesktopHostClient()) {}

  async *exec(input: DesktopWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    yield {
      type: 'progress',
      fraction: 0,
      message: 'Starting isolated Windows UI Automation host',
    };
    try {
      const result = await this.host.execute(input.action, input.workingDir, token);
      yield {
        type: 'completed',
        output: {
          ok: true,
          message: `Desktop action ${input.action.kind} completed`,
          result,
        } satisfies DesktopWorkerOutput,
      };
    } catch (error) {
      const failure = normalizeDesktopFailure(error);
      yield {
        type: 'failed',
        failureClass: failure.failureClass,
        error: { code: failure.code, message: failure.message },
      };
    }
  }
}

export class FakeDesktopWorker implements DesktopWorker {
  readonly kind = 'desktop' as const;
  async *exec(input: DesktopWorkerInput, _token: WorkerToken): AsyncIterable<WorkerEvent> {
    yield {
      type: 'stderr',
      text: `[fake-desktop] ${input.action.kind} requested - manual step needed`,
    };
    yield {
      type: 'completed',
      output: {
        ok: false,
        message: 'desktop action deferred to manual until the UIA worker is enabled',
      },
    };
  }
}

function normalizeDesktopFailure(error: unknown): {
  code: string;
  message: string;
  failureClass: DesktopFailureClass;
} {
  if (error instanceof DesktopHostError) return error;
  if (
    error instanceof Error &&
    'code' in error &&
    'failureClass' in error &&
    typeof error.code === 'string' &&
    isDesktopFailureClass(error.failureClass)
  ) {
    return { code: error.code, message: error.message, failureClass: error.failureClass };
  }
  return {
    code: 'desktop.crashed',
    message: 'Desktop host failed unexpectedly',
    failureClass: 'crashed',
  };
}

function isDesktopFailureClass(value: unknown): value is DesktopFailureClass {
  return ['timeout', 'crashed', 'permission', 'acceptance', 'unknown'].includes(String(value));
}
