import { resolve } from 'node:path';
import { isRealPathInside, startRefusal } from '../process-runner.js';
import type { Worker, WorkerEvent, WorkerJobInput, WorkerJobOutput, WorkerToken } from '../types.js';
import { isPathInside } from '../types.js';
import {
  BrowserHostError,
  type BrowserAction,
  type BrowserCommandResult,
  type BrowserHostLike,
} from './browser-host.js';

export type { BrowserAction } from './browser-host.js';

// BrowserWorker interface. Real Playwright worker ships in M3; Phase 0 ships a
// FakeBrowserWorker that emits failure if the action targets an out-of-allowlist
// site. Site allowlist is the §13.1 minimum.

export interface BrowserWorkerInput extends WorkerJobInput {
  action: BrowserAction;
  allowedSites?: string[];
  profileId?: string;
  ownerId?: string;
}

export type BrowserWorkerOutput = WorkerJobOutput & Partial<BrowserCommandResult>;

export interface BrowserWorker extends Worker<BrowserWorkerInput> {
  readonly kind: 'browser';
}

export class FakeBrowserWorker implements BrowserWorker {
  readonly kind = 'browser' as const;
  async *exec(input: BrowserWorkerInput, _token: WorkerToken): AsyncIterable<WorkerEvent> {
    if (
      input.allowedSites &&
      input.action.kind === 'navigate' &&
      !input.allowedSites.includes(input.action.url)
    ) {
      yield { type: 'failed', failureClass: 'permission', error: { code: 'security.unauthorized_tool', message: 'site not in allowlist' } };
      return;
    }
    yield { type: 'stderr', text: '[fake-browser] deferred until Playwright ships in M3' };
    yield { type: 'completed', output: { ok: false, message: 'browser fake returning early' } };
  }
}

export class PersistentBrowserWorker implements BrowserWorker {
  readonly kind = 'browser' as const;

  constructor(private readonly host: BrowserHostLike) {}

  async *exec(input: BrowserWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    const workingDir = resolve(input.workingDir);
    const allowedRoot = resolve(token.allowedRoot);
    if (!isPathInside(workingDir, allowedRoot)) {
      yield failure(
        'security.path_traversal',
        'Browser workingDir escapes allowedRoot',
        'permission',
      );
      return;
    }
    if (
      input.action.kind === 'screenshot' &&
      !(await isRealPathInside(workingDir, allowedRoot))
    ) {
      yield failure(
        'security.path_traversal',
        'Browser screenshot project root resolves outside allowedRoot',
        'permission',
      );
      return;
    }
    const refusal = startRefusal(token);
    if (refusal) {
      yield failure(
        refusal === 'aborted' ? 'worker.aborted' : 'worker.fence-rejected',
        refusal === 'aborted' ? 'Browser action was cancelled' : 'Execution fence rejected',
        'acceptance',
      );
      return;
    }
    const profileId = String(input.profileId ?? '').trim();
    const ownerId = String(input.ownerId ?? '').trim();
    if (!profileId || !ownerId) {
      yield failure(
        'browser.lease-identity-required',
        'Browser profileId and ownerId are required',
        'permission',
      );
      return;
    }

    try {
      const lease = await this.host.acquireLease({ profileId, ownerId });
      yield { type: 'progress', fraction: 0.1, message: 'Browser Page lease acquired' };
      const output = await this.host.execute({
        leaseId: lease.leaseId,
        action: input.action,
        allowedSites: input.allowedSites ?? [],
        timeoutMs: token.timeoutMs,
        maxOutputBytes: token.maxOutputBytes,
        projectRoot: workingDir,
        signal: token.signal,
      });
      yield { type: 'completed', output };
    } catch (error) {
      const normalized = normalizeWorkerError(error, token.signal);
      yield failure(normalized.code, normalized.message, normalized.failureClass);
    }
  }
}

function normalizeWorkerError(error: unknown, signal?: AbortSignal): BrowserHostError {
  if (error instanceof BrowserHostError) return error;
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    failureClass?: unknown;
  };
  if (signal?.aborted) {
    return new BrowserHostError('worker.aborted', 'Browser action was cancelled', 'acceptance');
  }
  const failureClass = isFailureClass(candidate?.failureClass)
    ? candidate.failureClass
    : 'unknown';
  return new BrowserHostError(
    typeof candidate?.code === 'string' ? candidate.code : 'browser.operation-failed',
    typeof candidate?.message === 'string' ? candidate.message : 'Browser operation failed',
    failureClass,
    { cause: error },
  );
}

function isFailureClass(
  value: unknown,
): value is 'timeout' | 'crashed' | 'permission' | 'acceptance' | 'unknown' {
  return (
    value === 'timeout' ||
    value === 'crashed' ||
    value === 'permission' ||
    value === 'acceptance' ||
    value === 'unknown'
  );
}

function failure(
  code: string,
  message: string,
  failureClass: 'timeout' | 'crashed' | 'permission' | 'acceptance' | 'unknown',
): WorkerEvent {
  return { type: 'failed', failureClass, error: { code, message } };
}
