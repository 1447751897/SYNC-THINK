/**
 * Claude Code kernel adapter (design doc §5.2).
 *
 * Spawns `claude` with the stream-json bidirectional protocol (verified against
 * 2.1.178 and 2.1.222 on 2026-08-14), sends the initialize control request,
 * then streams the user message. The kernel is fully autonomous — its own tool loop,
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
  extractClaudeErrorMessage,
  extractClaudeToolResults,
  parseClaudeStreamEvent,
  toKernelPermissionRequest,
  type ClaudeAssistantEvent,
  type ClaudeControlRequestEvent,
  type ClaudeStreamEvent,
  type ClaudeStreamEventEnvelope,
  type ClaudeSystemEvent,
  type ClaudeUserEvent,
} from './claude-code-protocol.js';

/**
 * Resolve the base URL handed to the Claude CLI as `ANTHROPIC_BASE_URL`.
 *
 * The CLI composes `{ANTHROPIC_BASE_URL}/v1/messages` itself, so a provider
 * base URL that already ends in `/v1` (OpenAI-style roots, e.g.
 * `https://api.deepseek.com/v1`) must be stripped first, or the request
 * doubles the path and the endpoint answers 404/410, which the CLI then
 * reports as a broken model selection.
 *
 * DeepSeek additionally serves its Anthropic-compatible API under the
 * `/anthropic` prefix (verified with a real key: `…/anthropic/v1/messages`
 * answers, `…/v1/messages` does not), so its stripped root gets that suffix.
 */
export function stripCliAnthropicV1Suffix(baseUrl: string): string {
  const stripped = baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');
  if (/^https?:\/\/api\.deepseek\.com$/i.test(stripped)) return `${stripped}/anthropic`;
  return stripped;
}
import { probeKernel } from './detect.js';
import { formatKernelExitDiagnostic, sanitizeKernelDiagnostic } from './kernel-diagnostics.js';
import { startKernelProcess, type KernelProcessHandle } from './process.js';
import { removePlatformMcpConfig, writePlatformMcpConfig } from './platform-mcp-config.js';

/**
 * Host permission-mode → claude --permission-mode mapping (design doc §6.1).
 *
 * Verified against claude 2.1.178: the CLI accepts only
 * acceptEdits | auto | bypassPermissions | default | dontAsk | plan. There is
 * no `manual` — the host's "ask each time" maps to `default` (Claude's standard
 * permission-prompt behavior, which surfaces every tool through the stdio
 * bridge).
 */
function mapPermissionMode(mode: KernelRequest['permissionMode']): string {
  switch (mode) {
    case 'full-access':
      return 'bypassPermissions';
    case 'ask':
      return 'default';
    case 'workspace':
      return 'dontAsk';
  }
}

/**
 * Claude Code built-in tools the host does not support. AskUserQuestion cannot
 * be approved over the stdio bridge (an allow response requires an
 * `updatedInput` answer the host does not hold, which makes Claude loop on a
 * ZodError); EnterPlanMode/ExitPlanMode belong to Claude's native planning
 * flow, which the host does not use (planning runs ask via the host's
 * `ask_user_question` platform tool instead).
 * These are denied in the adapter so the model never hangs on an approval that
 * cannot succeed.
 */
const CLAUDE_HOST_DENIED_TOOLS: ReadonlySet<string> = new Set([
  'EnterPlanMode',
  'ExitPlanMode',
  'AskUserQuestion',
]);

const CLAUDE_HOST_DENIED_TOOLS_MESSAGE =
  '宿主不支持该工具。规划模式请用宿主提供的 plan_submit 提交方案，中途需要决策时用 ask_user_question；执行模式直接完成任务；不要进入 Claude 原生规划流程。';

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
  readonly knownGoodVersions: readonly string[] = ['2.1.178', '2.1.222'];

  constructor(private readonly deps: ClaudeCodeAdapterDeps = {}) {}

  private handle?: KernelProcessHandle;
  private permissionCallbacks: Array<(request: KernelPermissionRequest) => void> = [];
  private exitCallbacks: Array<(code: number | null, stderrTail: string) => void> = [];
  private usageCallbacks: Array<(usage: KernelUsage) => void> = [];
  private pendingPermissionDecisions = new Map<
    string,
    (decision: KernelPermissionDecision) => void
  >();
  private stderrLogged = false;
  private activeContextWindow = 128_000;
  private cancelled = false;
  /** True once stream_event text deltas arrived (suppresses the whole-message echo). */
  private streamedText = false;
  /** Claude may replay a complete assistant message while resuming a tool loop. */
  private readonly seenAssistantToolUses = new Set<string>();
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
    this.cancelled = false;
    this.streamedText = false;
    this.seenAssistantToolUses.clear();
    this.stderrLogged = false;
    this.pendingPermissionDecisions.clear();
    const args = [
      '--print',
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
      request.planningMode
        ? // Planning runs must never bypass permissions: with bypassPermissions
          // Claude executes its built-in tools (EnterPlanMode / AskUserQuestion)
          // without a can_use_tool request, so the host could not deny them and
          // the run would hang in Claude's native planning flow. Forcing
          // `default` keeps built-ins flowing through the host bridge
          // (allowedTools below still auto-allow the read-only tools).
          'default'
        : mapPermissionMode(request.permissionMode),
    ];
    if (request.planningMode) {
      // Planning mode: read-only analysis only. The host MCP catalog is already
      // filtered to read-only tools; this fence restricts Claude's native tools.
      // EnterPlanMode/AskUserQuestion are host-denied regardless (bridge), but
      // also listed here defensively.
      args.push(
        '--allowedTools',
        'Read,Glob,Grep,WebFetch,WebSearch',
        '--disallowedTools',
        'Bash,Write,Edit,MultiEdit,NotebookEdit,Task,Agent,EnterPlanMode,ExitPlanMode,AskUserQuestion',
      );
    }
    if (request.session?.mode === 'create' && request.session.id) {
      args.push('--session-id', request.session.id);
    } else if (request.session?.mode === 'resume' && request.session.id) {
      args.push('--resume', request.session.id);
    }
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
      args.push('--setting-sources=');
      if (request.credential.baseUrl) {
        // The Claude CLI composes `{ANTHROPIC_BASE_URL}/v1/messages` itself.
        // Provider base URLs that already end in `/v1` (OpenAI-style roots,
        // e.g. https://api.deepseek.com/v1) must be stripped first, or the
        // request doubles the path and the endpoint answers 404/410, which
        // the CLI then reports as a broken model selection.
        env.ANTHROPIC_BASE_URL = stripCliAnthropicV1Suffix(request.credential.baseUrl);
      }
      env.ANTHROPIC_API_KEY = request.credential.apiKey;
      // Override a stale token from the user's Claude settings as well as the
      // standard API key when SYNC-THINK supplies a per-run credential.
      env.ANTHROPIC_AUTH_TOKEN = request.credential.apiKey;
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
    this.activeContextWindow =
      request.effectiveContextWindow ?? request.contextWindow ?? 128_000;
    const child = handle.child;

    // Event queue + pull generator (ordered processing; permission requests
    // pause the stream until the host decision resolves).
    const queue: KernelEvent[] = [];
    let waiter: ((event: KernelEvent | null) => void) | undefined;
    let closed = false;
    let terminalSeen = false;
    let finalized = false;
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
    const pushEvent = (event: KernelEvent): void => {
      if (event.type === 'terminal') {
        if (terminalSeen) return;
        terminalSeen = true;
        push({
          ...event,
          ...(event.error
            ? {
                error: sanitizeKernelDiagnostic(event.error, [request.credential.apiKey]),
              }
            : {}),
        });
        return;
      }
      push(event);
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
      if (event) this.processEvent(event, pushEvent);
    });
    let stdoutEnded = child.stdout == null;
    const flushStdout = (): void => {
      if (stdoutEnded) return;
      stdoutEnded = true;
      buffer.end();
    };
    child.stdout?.on('data', (chunk: Buffer) => buffer.push(chunk.toString()));
    child.stdout?.once('end', flushStdout);
    child.stdout?.once('close', flushStdout);
    if (!this.stderrLogged) {
      this.stderrLogged = true;
      child.stderr?.on('data', () => {
        // stderr tail is retained by startKernelProcess for exit diagnostics.
      });
    }
    const finalize = (code: number | null, processError?: unknown): void => {
      if (finalized) return;
      finalized = true;
      flushStdout();
      const stderrTail = sanitizeKernelDiagnostic(handle.stderrTail(), [request.credential.apiKey]);
      if (!terminalSeen && !this.cancelled) {
        pushEvent({
          type: 'terminal',
          status: 'failed',
          error: formatKernelExitDiagnostic(
            this.name,
            code,
            stderrTail,
            [request.credential.apiKey],
            processError,
          ),
        });
      }
      this.exitCallbacks.forEach((callback) => callback(code, stderrTail));
      push(null);
    };
    child.once('close', (code) => finalize(code));
    child.once('error', (error) => finalize(null, error));

    // initialize the session, then stream the user message.
    const initId = `init-${randomUUID()}`;
    child.stdin?.write(
      buildClaudeInitializeRequest(initId, {
        // create → full system context; resume → only the cross-kernel gap
        // catch-up block (the native session already holds the shared history).
        appendSystemPrompt:
          !request.session || request.session.mode === 'create'
            ? request.systemContext || undefined
            : request.session.catchUp || undefined,
      }) + '\n',
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    child.stdin?.write(buildClaudeUserMessage(request.userText, request.session?.id) + '\n');

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
          error?: unknown;
          errors?: unknown;
          message?: unknown;
          result?: unknown;
        };
        const error = extractClaudeErrorMessage(result);
        const failed =
          result.subtype !== 'success' ||
          result.is_error === true ||
          result.error !== undefined ||
          result.errors !== undefined;
        push({
          type: 'terminal',
          status: failed ? 'failed' : 'completed',
          ...(failed ? { error: error ?? 'Claude Code reported a failed result.' } : {}),
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
      case 'system': {
        const systemEvent = event as ClaudeSystemEvent;
        const sessionId = systemEvent.session_id?.trim();
        if (systemEvent.subtype === 'init' && sessionId) {
          push({ type: 'session-started', sessionId });
        }
        const status = systemEvent.error_status;
        const authenticationFailed =
          systemEvent.subtype === 'api_retry' &&
          (status === 401 || status === 403 || systemEvent.error === 'authentication_failed');
        if (authenticationFailed) {
          push({
            type: 'terminal',
            status: 'failed',
            error:
              status === undefined
                ? 'Claude Code authentication failed.'
                : `Claude Code authentication failed (HTTP ${status}).`,
          });
        }
        return;
      }
      case 'keep_alive':
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
        const toolId = block.id ?? `tool-${randomUUID()}`;
        const replayKey = `${event.message.id ?? 'unknown-message'}\u0000${toolId}`;
        if (this.seenAssistantToolUses.has(replayKey)) continue;
        this.seenAssistantToolUses.add(replayKey);
        push({
          type: 'tool-call',
          toolId,
          name: block.name ?? 'unknown',
          argsJson: JSON.stringify(block.input ?? {}),
          partial: false,
        });
      }
    }
    // Usage rides on assistant messages (input/output/cache split). Claude sends
    // one assistant message per tool round; each reports the full growing prefix
    // (mostly cache reads). We keep per-message reports with distinct requestIds:
    // the host sums them for the billing total (every request is billed) and the
    // projector's context watermark takes the LAST request's occupancy — a tool
    // loop must not inflate "context used" with repeated prefixes.
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
        cachedTokensCreated: usage.cache_creation_input_tokens,
        requestId: event.message.id,
        providerResponseId: event.message.id,
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
      // Host-unsupported built-ins are denied immediately (never surface an
      // approval card): AskUserQuestion would loop on a ZodError without an
      // updatedInput answer, and EnterPlanMode/ExitPlanMode would trap the run
      // in Claude's native planning flow the host does not use.
      if (CLAUDE_HOST_DENIED_TOOLS.has(permission.toolName)) {
        this.handle?.child.stdin?.write(
          buildClaudePermissionResponse(permission.requestId, {
            allow: false,
            message: CLAUDE_HOST_DENIED_TOOLS_MESSAGE,
          }) + '\n',
        );
        return;
      }
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
