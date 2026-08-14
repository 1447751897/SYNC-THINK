/**
 * Codex kernel adapter (design doc §5.3).
 *
 * Spawns `codex --ask-for-approval <policy> exec --json` (verified against
 * codex-cli 0.145.0 on 2026-08-14). Exec JSONL emits items atomically; the
 * adapter maps agent_message → delta, command_execution → tool timeline,
 * turn.completed → usage + terminal. Approval is a static policy mapping
 * (exec JSON auto-executes); platform tools get host-side approval (Slice 5).
 *
 * pause semantics: 'session' — pausing closes the session (Ctrl+C); there is
 * no executor-level resume, so cancel() terminates the process tree.
 */
import { randomUUID } from 'node:crypto';
import type {
  KernelAdapter,
  KernelEvent,
  KernelPermissionDecision,
  KernelPermissionRequest,
  KernelRequest,
  KernelUsage,
} from '@sync-think/shared';
import {
  createCodexLineBuffer,
  extractCodexErrorMessage,
  mapCodexApprovalPolicy,
  mapCodexSandbox,
  parseCodexEvent,
  type CodexItem,
  type CodexJsonEvent,
  type CodexUsage,
} from './codex-protocol.js';
import { probeKernel } from './detect.js';
import { startKernelProcess, type KernelProcessHandle } from './process.js';

export interface CodexAdapterDeps {
  /** Test seam: replace the real spawn (fixture codex processes). */
  spawn?: (
    args: string[],
    env: Record<string, string>,
    cwd: string,
  ) => KernelProcessHandle;
}

export class CodexKernelAdapter implements KernelAdapter {
  readonly id = 'codex' as const;
  readonly name = 'Codex';
  readonly icon = 'codex';
  readonly capabilities = {
    protocols: ['openai-chat' as const, 'openai-responses' as const],
    permission: 'own' as const,
    permissionBridge: false,
    pause: 'session' as const,
    compress: 'own' as const,
    usageReport: true,
  };
  readonly knownGoodVersions: readonly string[] = ['0.145.0'];

  constructor(private readonly deps: CodexAdapterDeps = {}) {}

  private handle?: KernelProcessHandle;
  private exitCallbacks: Array<(code: number | null, stderrTail: string) => void> = [];
  private usageCallbacks: Array<(usage: KernelUsage) => void> = [];
  private activeContextWindow = 128_000;

  async detectVersion(): Promise<string | null> {
    return probeKernel('codex').version;
  }

  onPermissionRequest(_callback: (request: KernelPermissionRequest) => void): void {
    // No event-level permission bridge in exec JSON mode (verified 0.145.0).
  }

  respondPermission(_requestId: string, _decision: KernelPermissionDecision): void {
    // No-op — approval is handled by the static policy mapping + host platform
    // tool approval; the kernel never blocks on a bridged decision.
  }

  onUsage(callback: (usage: KernelUsage) => void): void {
    this.usageCallbacks.push(callback);
  }

  onExit(callback: (code: number | null, stderrTail: string) => void): void {
    this.exitCallbacks.push(callback);
  }

  async *start(request: KernelRequest): AsyncIterable<KernelEvent> {
    const approval = mapCodexApprovalPolicy(request.permissionMode);
    const sandbox = mapCodexSandbox(request.permissionMode);
    const args = [
      '--ask-for-approval',
      approval,
      'exec',
      '--json',
      '-s',
      sandbox,
      '-C',
      request.workspaceDir,
    ];
    if (request.providerModelId) args.push('--model', request.providerModelId);
    args.push('--skip-git-repo-check');
    // The prompt travels over stdin, never argv — user text must not cross a
    // cmd.exe shim command line (shell metacharacters + process-list exposure).
    // codex exec reads the prompt from stdin and starts without waiting for EOF.

    const env: Record<string, string> = {};
    if (request.credential.reuseLocalLogin !== true && request.credential.apiKey) {
      if (request.credential.baseUrl) env.OPENAI_BASE_URL = request.credential.baseUrl;
      env.OPENAI_API_KEY = request.credential.apiKey;
    }

    const handle = this.deps.spawn
      ? this.deps.spawn(args, env, request.workspaceDir)
      : startKernelProcess({
          command: 'codex',
          args,
          cwd: request.workspaceDir,
          env,
        });
    this.handle = handle;
    this.activeContextWindow = request.contextWindow || 128_000;
    const child = handle.child;

    const queue: KernelEvent[] = [];
    let waiter: ((event: KernelEvent | null) => void) | undefined;
    let closed = false;
    const push = (event: KernelEvent | null): void => {
      if (event === null) {
        closed = true;
        const resolve = waiter;
        waiter = undefined;
        if (resolve) resolve(null);
        return;
      }
      if (waiter) {
        const resolve = waiter;
        waiter = undefined;
        resolve(event);
      } else {
        queue.push(event);
      }
    };
    const next = (): Promise<KernelEvent | null> => {
      if (queue.length > 0) return Promise.resolve(queue.shift()!);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        waiter = (event) => resolve(event);
      });
    };

    const buffer = createCodexLineBuffer((line) => {
      const event = parseCodexEvent(line);
      if (event) this.processEvent(event, push);
    });
    child.stdout?.on('data', (chunk: Buffer) => buffer.push(chunk.toString()));
    child.on('exit', (code) => {
      closed = true;
      if (waiter) {
        const resolve = waiter;
        waiter = undefined;
        resolve(null);
      }
      this.exitCallbacks.forEach((callback) => callback(code, handle.stderrTail()));
    });
    child.on('error', () => {
      closed = true;
      if (waiter) {
        const resolve = waiter;
        waiter = undefined;
        resolve(null);
      }
      this.exitCallbacks.forEach((callback) => callback(null, handle.stderrTail()));
    });

    // Deliver the prompt over stdin (see start()), then EOF. Verified on
    // codex 0.145.0: spawned via the cmd.exe shim path it waits for EOF after
    // the prompt before starting the turn. Exec is a single turn, so closing
    // stdin is semantically correct. Defensive — a fixture spawn may not wire
    // stdin.
    const stdin = child.stdin;
    if (stdin) {
      stdin.write(request.userText + '\n');
      stdin.end();
    }

    try {
      while (true) {
        const event = await next();
        if (!event) break;
        yield event;
        if (event.type === 'terminal') break;
      }
    } finally {
      // The run loop owns explicit cancel; nothing to tear down here.
    }
  }

  /** Translate a codex JSONL event into KernelEvents (unknown types ignored). */
  private processEvent(event: CodexJsonEvent, push: (event: KernelEvent) => void): void {
    switch (event.type) {
      case 'thread.started':
      case 'turn.started':
        return;
      case 'item.started':
        this.processItemStart((event as { item?: CodexItem }).item, push);
        return;
      case 'item.completed':
        this.processItemCompleted((event as { item?: CodexItem }).item, push);
        return;
      case 'turn.completed': {
        const usage = (event as { usage?: CodexUsage }).usage;
        if (usage) {
          const mapped = this.mapUsage(usage);
          push({ type: 'usage', usage: mapped });
          this.usageCallbacks.forEach((callback) => callback(mapped));
        }
        push({ type: 'terminal', status: 'completed' });
        return;
      }
      case 'turn.failed': {
        const error = (event as { error?: unknown }).error;
        push({
          type: 'terminal',
          status: 'failed',
          error:
            extractCodexErrorMessage(error) ??
            'codex turn failed',
        });
        return;
      }
      case 'error': {
        const message = extractCodexErrorMessage(
          (event as { message?: unknown }).message ?? (event as { error?: unknown }).error,
        );
        push({
          type: 'terminal',
          status: 'failed',
          error: message ?? 'codex error',
        });
        return;
      }
      default:
        console.debug('[kernel:codex] unhandled event type', (event as { type: string }).type);
    }
  }

  private processItemStart(item: CodexItem | undefined, push: (event: KernelEvent) => void): void {
    if (!item?.type) return;
    if (item.type === 'command_execution' && item.command) {
      push({
        type: 'tool-call',
        toolId: item.id ?? `codex-${randomUUID()}`,
        name: 'command_execution',
        argsJson: JSON.stringify({ command: item.command }),
        partial: false,
      });
    } else if (item.type === 'mcp_tool_call' || item.type === 'web_search') {
      push({
        type: 'tool-call',
        toolId: item.id ?? `codex-${randomUUID()}`,
        name: item.type,
        argsJson: JSON.stringify({}),
        partial: false,
      });
    }
    // Other item types (file_change etc.) surface on completion only.
  }

  private processItemCompleted(
    item: CodexItem | undefined,
    push: (event: KernelEvent) => void,
  ): void {
    if (!item?.type) return;
    switch (item.type) {
      case 'agent_message':
        if (item.text) push({ type: 'delta', text: item.text });
        return;
      case 'reasoning':
      case 'agent_reasoning':
        if (item.text) push({ type: 'reasoning', text: item.text });
        return;
      case 'command_execution':
        push({
          type: 'tool-result',
          toolId: item.id ?? `codex-${randomUUID()}`,
          output:
            item.aggregated_output ??
            (typeof item.output === 'string' ? item.output : ''),
          isError: item.exit_code !== null && item.exit_code !== undefined && item.exit_code !== 0,
        });
        return;
      case 'file_change':
        push({
          type: 'tool-result',
          toolId: item.id ?? `codex-${randomUUID()}`,
          output: 'file changed',
          isError: false,
        });
        return;
      case 'error':
        // Metadata/diagnostic error item — the authoritative `error` event or
        // `turn.failed` follows for real failures, so surface as a warning only.
        console.warn('[kernel:codex] error item', extractCodexErrorMessage(item.message));
        return;
      default:
        console.debug('[kernel:codex] unhandled item type', item.type);
    }
  }

  private mapUsage(usage: CodexUsage): KernelUsage {
    const input =
      (usage.input_tokens ?? 0) +
      (usage.cached_input_tokens ?? 0) +
      (usage.cache_write_input_tokens ?? 0);
    const output = usage.output_tokens ?? 0;
    return {
      real: input + output,
      window: this.activeContextWindow,
      input,
      output,
      cached: usage.cached_input_tokens,
    };
  }

  async stop(): Promise<void> {
    await this.kill();
  }

  async pause(): Promise<void> {
    // 'session' semantics: pause closes the session — the host shows "提示可续会话".
  }

  async resume(): Promise<void> {
    // No executor-level resume for codex sessions.
  }

  async cancel(): Promise<void> {
    await this.kill();
  }

  private async kill(): Promise<void> {
    const handle = this.handle;
    this.handle = undefined;
    if (handle) {
      await handle.killTree();
      handle.job?.close();
    }
  }
}
