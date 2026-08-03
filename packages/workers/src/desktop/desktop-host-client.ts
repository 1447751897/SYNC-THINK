import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createDesktopHostRequest,
  parseDesktopHostReady,
  parseDesktopHostResponse,
  type DesktopAction,
  type DesktopActionResult,
} from './desktop-contract.js';
import { isRealPathInside, runBoundedProcess, startRefusal } from '../process-runner.js';
import type { WorkerToken } from '../types.js';

export type DesktopFailureClass = 'timeout' | 'crashed' | 'permission' | 'acceptance' | 'unknown';

export class DesktopHostError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly failureClass: DesktopFailureClass,
  ) {
    super(message);
    this.name = 'DesktopHostError';
  }
}

export interface DesktopHostExecutor {
  execute(
    action: DesktopAction,
    workingDir: string,
    token: WorkerToken,
  ): Promise<DesktopActionResult>;
}

export interface DesktopHostClientOptions {
  hostEntryPath?: string;
  nodeExecutable?: string;
}

export class DesktopHostClient implements DesktopHostExecutor {
  private readonly hostEntryPath: string;
  private readonly nodeExecutable: string;

  constructor(options: DesktopHostClientOptions = {}) {
    this.hostEntryPath =
      options.hostEntryPath ?? fileURLToPath(new URL('./desktop-host-process.js', import.meta.url));
    this.nodeExecutable = options.nodeExecutable ?? process.execPath;
  }

  async execute(
    action: DesktopAction,
    workingDir: string,
    token: WorkerToken,
  ): Promise<DesktopActionResult> {
    const refusal = startRefusal(token);
    if (refusal) {
      throw new DesktopHostError(
        'desktop.permission-denied',
        refusal === 'aborted'
          ? 'Desktop automation was cancelled before start'
          : 'Desktop automation start fence was rejected',
        'permission',
      );
    }
    if (!(await isRealPathInside(workingDir, token.allowedRoot))) {
      throw new DesktopHostError(
        'desktop.permission-denied',
        'Desktop automation working directory is outside the allowed root',
        'permission',
      );
    }

    const requestId = randomUUID();
    const request = createDesktopHostRequest(requestId, action);
    const result = await runBoundedProcess(
      this.nodeExecutable,
      [this.hostEntryPath, '--parent-pid', String(process.pid)],
      workingDir,
      token,
      undefined,
      { stdin: `${JSON.stringify(request)}\n` },
    );

    if (result.timedOut) {
      throw new DesktopHostError('desktop.timeout', 'Desktop host timed out', 'timeout');
    }
    if (result.aborted) {
      throw new DesktopHostError('desktop.cancelled', 'Desktop host was cancelled', 'permission');
    }
    if (result.spawnError || result.exitCode !== 0 || result.truncated) {
      throw new DesktopHostError(
        'desktop.crashed',
        result.truncated
          ? 'Desktop host output exceeded the configured limit'
          : 'Desktop host exited unexpectedly',
        'crashed',
      );
    }

    const messages = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (messages.length !== 2) {
      throw new DesktopHostError(
        'desktop.host-handshake-failed',
        'Desktop host returned an invalid message sequence',
        'crashed',
      );
    }

    try {
      parseDesktopHostReady(JSON.parse(messages[0]!));
      const response = parseDesktopHostResponse(JSON.parse(messages[1]!), requestId);
      if (!response.ok) {
        throw new DesktopHostError(
          response.error.code,
          response.error.message,
          response.error.failureClass,
        );
      }
      return response.result;
    } catch (error) {
      if (error instanceof DesktopHostError) throw error;
      throw new DesktopHostError(
        'desktop.host-handshake-failed',
        'Desktop host returned malformed JSON or an incompatible protocol response',
        'crashed',
      );
    }
  }
}
