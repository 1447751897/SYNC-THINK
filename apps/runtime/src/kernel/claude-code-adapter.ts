/**
 * Claude Code kernel adapter (design doc §5.2).
 *
 * Spawns `claude` with the stream-json bidirectional protocol (verified against
 * 2.1.222 on 2026-08-14), sends the initialize control request, then streams
 * the user message. The kernel is fully autonomous — its own tool loop,
 * compression and session handling run inside claude; the host only translates
 * events, bridges permissions and reports usage.
 *
 * Permission bridge: claude emits `control_request` with subtype
 * `can_use_tool`; the host answers with a `control_response` carrying
 * `{behavior:"allow"|"deny", updatedInput?, message?}`. The host-side approval
 * card is wired through onPermissionRequest / respondPermission.
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
  buildClaudeInitializeRequest,
  buildClaudeInterruptRequest,
  buildClaudePermissionResponse,
  buildClaudeUserMessage,
  createClaudeLineBuffer,
  extractClaudeToolResults,
  parseClaudeStreamEvent,
  toKernelPermissionRequest,
  type ClaudeAssistantEvent,
  type ClaudeControlRequestEvent,
  type ClaudeStreamEvent,
  type ClaudeStreamEventEnvelope,
  type ClaudeUserEvent,
} from './claude-code-protocol.js';
import { probeKernel } from './detect.js';
import { startKernelProcess, type KernelProcessHandle } from './process.js';
import { removePlatformMcpConfig, writePlatformMcpConfig } from './platform-mcp-config.js';

/** Host permission-mode → claude --permission-mode mapping (design doc §6.1). */
function mapPermissionMode(mode: KernelRequest['permissionMode']): string {
  switch (mode) {
    case 'full-access':
      return 'bypassPermissions';
    case 'ask':
      return 'manual';
    case 'workspace':
      return 'dontAsk';
  }
}

export interface ClaudeCodeAdapterDeps {
  /** Test seam: replace the real spawn (fixture claude processes). */
  spawn?: (args: string[], env: Record<string, string>, cwd: string) => KernelProcessHandle;
}

export class ClaudeCodeKernelAdapter implements KernelAdapter {
  readonly id = 'claude-code' as const;
  readonly name = 'Claude Code';
  readonly icon = 'claude-code';
  readonly capabilities = {
    protocols: ['anthropic-messages' as const],
    permission: 'own' as const,
    permissionBridge: true,
    pause: 'turn' as const,
    compress: 'own' as const,
    usageReport: true,
  };
  readonly knownGoodVersions: readonly string[] = ['2.1.222'];

  constructor(private readonly deps: ClaudeCodeAdapterDeps = {}) {}

  private handle?: KernelProcessHandle;
  private permissionCallbacks: Array<(request: KernelPermissionRequest) => void> = [];
  private exitCallbacks: Array<(code: number | null, stderrTail: string) => void> = [];
  private usageCallbacks: Array<(usage: KernelUsage) => void> = [];
  private pendingPermissionDecisions = new Map<
    string,
    (decision: KernelPermissionDecision) => void
  >();
  private sessionId?: string;
  private stderrLogged = false;
  private activeContextWindow = 128_000;
  private cancelled = false;
  /** True once stream_event text deltas arrived (suppresses the whole-message echo). */
  private streamedText = false;
  /** Temp --mcp-config file to delete after the run (holds broker token). */
  private mcpConfigPath?: string;

  async detectVersion(): Promise<string | null> {
    return probeKernel('claude').version;
  }

  onPermissionRequest(callback: (request: KernelPermissionRequest) => void): void {
    this.permissionCallbacks.push(callback);
  }

  respondPermission(requestId: string, decision: KernelPermissionDecision): void {
    const resolve = this.pendingPermissionDecisions.get(requestId);
    if (resolve) {
      this.pendingPermissionDecisions.delete(requestId);
      resolve(decision);
    }
  }

  onUsage(callback: (usage: KernelUsage) => void): void {
    this.usageCallbacks.push(callback);
  }

  onExit(callback: (code: number | null, stderrTail: string) => void): void {
    this.exitCallbacks.push(callback);
  }

  async *start(request: KernelRequest): AsyncIterable<KernelEvent> {
    const args = [
      '--output-format',
      'stream-json',
      '--verbose',
      '--input-format',
      'stream-json',
      // Verified on 2.1.222: with this flag our stdin stream-json mode emits
      // stream_event content_block deltas; without it only whole assistant
      // messages arrive and the UI cannot stream text.
      '--include-partial-messages',
      '--permission-prompt-tool',
      'stdio',
      '--permission-mode',
      mapPermissionMode(request.permissionMode),
    ];
    if (request.providerModelId) args.push('--model', request.providerModelId);
    if (request.platformBroker) {
      // Slice 5: register the platform MCP server (broker address + token ride
      // in the server env). --strict-mcp-config keeps only this server visible.
      const configPath = await writePlatformMcpConfig(request.platformBroker);
      args.push('--mcp-config', configPath, '--strict-mcp-config');
      this.mcpConfigPath = configPath;
    }

    const env: Record<string, string> = {};
    if (request.credential.reuseLocalLogin === true) {
      // Prefer the user's local OAuth login — do not inject a key.
    } else if (request.credential.apiKey) {
      if (request.credential.baseUrl) env.ANTHROPIC_BASE_URL = request.credential.baseUrl;
      env.ANTHROPIC_API_KEY = request.credential.apiKey;
    }

    const handle = this.deps.spawn
      ? this.deps.spawn(args, env, request.workspaceDir)
      : startKernelProcess({
          command: 'claude',
          args,
          cwd: request.workspaceDir,
          env,
        });
    this.handle = handle;
    this.activeContextWindow = request.contextWindow || 128_000;
    const child = handle.child;

    // Event queue + pull generator (ordered processing; permission requests
    // pause the stream until the host decision resolves).
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

    const buffer = createClaudeLineBuffer((line) => {
      const event = parseClaudeStreamEvent(line);
      if (event) this.processEvent(event, push);
    });
    child.stdout?.on('data', (chunk: Buffer) => buffer.push(chunk.toString()));
    if (!this.stderrLogged) {
      this.stderrLogged = true;
      child.stderr?.on('data', () => {
        // stderr tail is retained by startKernelProcess for exit diagnostics.
      });
    }
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

    // initialize the session, then stream the user message.
    const initId = `init-${randomUUID()}`;
    child.stdin?.write(
      buildClaudeInitializeRequest(initId, {
        appendSystemPrompt: request.systemContext || undefined,
      }) + '\n',
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    child.stdin?.write(buildClaudeUserMessage(request.userText, this.sessionId) + '\n');

    try {
      while (true) {
        const event = await next();
        if (!event) break;
        if (event.type === 'permission-request') {
          yield event;
          const decision = await this.waitForPermissionDecision(event.requestId);
          if (this.handle) {
            this.handle.child.stdin?.write(
              buildClaudePermissionResponse(event.requestId, decision) + '\n',
            );
          }
        } else {
          yield event;
          if (event.type === 'terminal') break;
        }
      }
    } finally {
      // Best-effort cleanup — the run loop owns explicit cancel/stop.
    }
  }

  private waitForPermissionDecision(requestId: string): Promise<KernelPermissionDecision> {
    return new Promise((resolve) => {
      if (this.cancelled) {
        resolve({ allow: false, message: 'run cancelled' });
        return;
      }
      this.pendingPermissionDecisions.set(requestId, resolve);
    });
  }

  /** Translate a claude stream event into KernelEvents (unknown events ignored). */
  private processEvent(event: ClaudeStreamEvent, push: (event: KernelEvent) => void): void {
    switch (event.type) {
      case 'assistant':
        this.processAssistant(event as ClaudeAssistantEvent, push);
        return;
      case 'control_request':
        this.processControlRequest(event as ClaudeControlRequestEvent, push);
        return;
      case 'result': {
        const result = event as {
          subtype?: string;
          is_error?: boolean;
          error?: string;
        };
        const failed =
          result.subtype !== 'success' || result.is_error === true || Boolean(result.error);
        push({
          type: 'terminal',
          status: failed ? 'failed' : 'completed',
          ...(result.error ? { error: String(result.error) } : {}),
        });
        return;
      }
      case 'control_response': {
        const response = event as {
          response?: { subtype?: string; error?: string; request_id?: string };
        };
        if (response.response?.subtype === 'error') {
          push({
            type: 'terminal',
            status: 'failed',
            error: response.response.error ?? 'claude control error',
          });
        }
        return;
      }
      case 'stream_event':
        this.processStreamEvent(event as ClaudeStreamEventEnvelope, push);
        return;
      case 'keep_alive':
      case 'system':
        return;
      case 'user':
        // Tool results are echoed here (real 2.1.222 shape verified): without
        // this the timeline only ever shows tool.requested, never completed.
        for (const result of extractClaudeToolResults(event as ClaudeUserEvent)) {
          push({
            type: 'tool-result',
            toolId: result.toolId,
            output: result.output,
            isError: result.isError,
          });
        }
        return;
      default:
        // Unknown event types are ignored + logged (mapping principle §4.1).
        console.debug(
          '[kernel:claude-code] unhandled stream event type',
          (event as { type: string }).type,
        );
    }
  }

  /**
   * Incremental assistant stream. Text/thinking deltas are the streaming source
   * of truth; tool_use and usage are taken from the following complete
   * `assistant` message so tool arguments never come from partial JSON.
   */
  private processStreamEvent(
    envelope: ClaudeStreamEventEnvelope,
    push: (event: KernelEvent) => void,
  ): void {
    const inner = envelope.event;
    if (inner?.type !== 'content_block_delta') return;
    const delta = inner.delta;
    if (delta?.type === 'text_delta' && delta.text) {
      this.streamedText = true;
      push({ type: 'delta', text: delta.text });
      return;
    }
    if (delta?.type === 'thinking_delta' && delta.thinking) {
      push({ type: 'reasoning', text: delta.thinking });
    }
  }

  private processAssistant(event: ClaudeAssistantEvent, push: (event: KernelEvent) => void): void {
    for (const block of event.message.content ?? []) {
      if (block.type === 'text' && block.text) {
        // Already streamed as stream_event text deltas — do not double-emit.
        if (!this.streamedText) push({ type: 'delta', text: block.text });
      } else if (block.type === 'tool_use') {
        push({
          type: 'tool-call',
          toolId: block.id ?? `tool-${randomUUID()}`,
          name: block.name ?? 'unknown',
          argsJson: JSON.stringify(block.input ?? {}),
          partial: false,
        });
      }
    }
    // Usage rides on assistant messages (input/output/cache split).
    const usage = event.message.usage;
    if (usage) {
      const input =
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0);
      const output = usage.output_tokens ?? 0;
      const kernelUsage: KernelUsage = {
        real: input + output,
        window: this.activeContextWindow,
        input,
        output,
        cached: usage.cache_read_input_tokens,
        modelId: event.message.model,
      };
      push({ type: 'usage', usage: kernelUsage });
      this.usageCallbacks.forEach((callback) => callback(kernelUsage));
    }
  }

  private processControlRequest(
    event: ClaudeControlRequestEvent,
    push: (event: KernelEvent) => void,
  ): void {
    const permission = toKernelPermissionRequest(event);
    if (permission) {
      push({ type: 'permission-request', ...permission });
      this.permissionCallbacks.forEach((callback) => callback(permission));
    } else {
      console.debug(
        '[kernel:claude-code] unhandled control_request subtype',
        event.request.subtype,
      );
    }
  }

  async stop(): Promise<void> {
    await this.kill();
    await removePlatformMcpConfig(this.mcpConfigPath);
  }

  async pause(): Promise<void> {
    // 'turn' semantics: stop the current turn (Esc). Nothing to hold.
  }

  async resume(): Promise<void> {
    // 'turn' semantics: no executor-level resume; UI shows "发新指令".
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    // Abort any in-flight permission waits so the generator can terminate.
    for (const [requestId, resolve] of this.pendingPermissionDecisions) {
      this.pendingPermissionDecisions.delete(requestId);
      resolve({ allow: false, message: 'run cancelled' });
    }
    if (!this.handle) return;
    const interruptId = `interrupt-${randomUUID()}`;
    try {
      this.handle.child.stdin?.write(buildClaudeInterruptRequest(interruptId) + '\n');
      // Give claude a moment to honor the interrupt, then force-kill the tree.
      await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    } finally {
      await this.kill();
    }
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
