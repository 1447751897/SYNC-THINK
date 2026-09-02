import { randomUUID } from 'node:crypto';
import type { BrowserAction, BrowserWorker, BrowserWorkerInput } from '@sync-think/workers';
import type { WorkerEvent, WorkerJobOutput, WorkerToken } from '@sync-think/workers';

export interface RendererBrowserCommandRequest {
  requestId: string;
  action: BrowserAction;
  toolName: string;
  runId: string;
  threadId: string;
  toolCallId: string;
  profileId: string;
  ownerId: string;
}

export interface RendererBrowserCommandResult {
  ok: boolean;
  resultJson?: string;
  error?: string;
}

export interface RendererBrowserWorkerOptions {
  toolName: string;
  runId: string;
  threadId: string;
  toolCallId: string;
  onRequest(request: RendererBrowserCommandRequest): Promise<RendererBrowserCommandResult>;
}

/**
 * Browser Worker adapter for the single embedded WebView.
 *
 * Runtime still owns validation, permission grants, idempotency and durable
 * command state. This adapter only translates the already validated action
 * into a renderer request and turns the renderer response back into Worker
 * lifecycle events. Keeping that boundary at Worker keeps the existing
 * controller and production CDP path intact for workflows and recordings.
 */
export class RendererBrowserWorker implements BrowserWorker {
  readonly kind = 'browser' as const;

  constructor(private readonly options: RendererBrowserWorkerOptions) {}

  async *exec(input: BrowserWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    if (token.signal?.aborted) {
      yield {
        type: 'failed',
        failureClass: 'acceptance',
        error: { code: 'worker.aborted', message: 'Browser action was cancelled' },
      };
      return;
    }
    if (token.beforeStart && !token.beforeStart()) {
      yield {
        type: 'failed',
        failureClass: 'acceptance',
        error: { code: 'worker.fence-rejected', message: 'Execution fence rejected' },
      };
      return;
    }

    const request: RendererBrowserCommandRequest = {
      requestId: `brw-${randomUUID()}`,
      action: input.action,
      toolName: this.options.toolName,
      runId: this.options.runId,
      threadId: this.options.threadId,
      toolCallId: this.options.toolCallId,
      profileId: String(input.profileId ?? ''),
      ownerId: String(input.ownerId ?? ''),
    };
    yield { type: 'progress', fraction: 0.1, message: '正在操作当前内置浏览器页面' };

    try {
      const result = await waitForRendererResult(
        this.options.onRequest(request),
        token.signal,
        token.timeoutMs,
      );
      if (!result.ok) {
        yield {
          type: 'failed',
          failureClass: 'acceptance',
          error: {
            code: 'browser.renderer-command-failed',
            message: result.error || '内置浏览器命令执行失败',
          },
        };
        return;
      }
      let output: WorkerJobOutput = { ok: true, message: 'Browser action completed' };
      if (result.resultJson) {
        try {
          const parsed = JSON.parse(result.resultJson) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            output = { ...output, ...(parsed as Record<string, unknown>) };
          }
        } catch {
          output = {
            ...output,
            result: result.resultJson.slice(0, token.maxOutputBytes ?? 64_000),
          };
        }
      }
      yield { type: 'completed', output };
    } catch (error) {
      const aborted = token.signal?.aborted;
      yield {
        type: 'failed',
        failureClass: aborted ? 'acceptance' : 'timeout',
        error: {
          code: aborted ? 'worker.aborted' : 'browser.renderer-timeout',
          message: aborted
            ? 'Browser action was cancelled'
            : error instanceof Error
              ? error.message
              : '内置浏览器命令超时',
        },
      };
    }
  }
}

async function waitForRendererResult(
  promise: Promise<RendererBrowserCommandResult>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<RendererBrowserCommandResult> {
  const timeout = Math.max(1_000, Math.min(timeoutMs || 30_000, 120_000));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    return await new Promise<RendererBrowserCommandResult>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('内置浏览器命令超时')), timeout);
      abortListener = () => reject(new Error('Browser action was cancelled'));
      if (signal) {
        if (signal.aborted) {
          abortListener();
          return;
        }
        signal.addEventListener('abort', abortListener, { once: true });
      }
      void promise.then(resolve, reject);
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
  }
}
