/**
 * Claude Code kernel adapter, backed by @anthropic-ai/claude-agent-sdk
 * (design doc §5.2).
 *
 * Replaces the hand-rolled `claude --print --output-format stream-json` child
 * process. The SDK owns the transport, the framing and the CLI binary itself
 * (it ships one — see `detectVersion`), so this adapter is reduced to what it
 * always should have been: host policy plus a mapping from `SDKMessage` to
 * `KernelEvent`.
 *
 * What the migration deletes:
 *   - JSON-lines buffering + parsing of kernel stdout
 *   - stdin frame construction (initialize / user / control_response / interrupt)
 *   - the 50ms sleep between initialize and the first user message
 *   - the temp `--mcp-config` file that carried the broker token through disk
 *   - the 1200ms interrupt-then-kill race
 *
 * What the migration keeps (host-specific, transport-independent):
 *   - provider base-URL normalization (stripAnthropicV1Suffix)
 *   - host-denied built-ins that cannot be satisfied over the bridge
 *   - the planning-mode double fence (permission mode + tool allow/deny lists)
 *   - assistant replay de-duplication and per-request usage semantics
 *   - credential redaction on every diagnostic that leaves the adapter
 *
 * Permission bridge: the SDK invokes `canUseTool` instead of emitting a
 * `control_request`; the adapter surfaces a host approval card and resolves the
 * callback with the host's decision.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type {
  CanUseTool,
  Options,
  PermissionMode,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  KernelAdapter,
  KernelEvent,
  KernelPermissionDecision,
  KernelPermissionRequest,
  KernelRequest,
  KernelUsage,
} from '@sync-think/shared';
import {
  extractSdkErrorMessage,
  extractSdkToolResults,
  stripAnthropicV1Suffix,
  toSdkPermissionRequest,
  type ClaudeSdkContentBlock,
  type ClaudeSdkUsage,
} from './claude-sdk-protocol.js';
import { formatKernelExitDiagnostic, sanitizeKernelDiagnostic } from './kernel-diagnostics.js';
import { PLATFORM_MCP_SERVER_NAME } from './platform-mcp-config.js';

export { stripAnthropicV1Suffix };

/**
 * Host permission-mode → SDK PermissionMode mapping (design doc §6.1).
 *
 * The SDK accepts default | acceptEdits | bypassPermissions | plan | dontAsk |
 * auto. There is no `manual`: the host's "ask each time" maps to `default`,
 * which routes every tool through `canUseTool`.
 */
function mapPermissionMode(mode: KernelRequest['permissionMode']): PermissionMode {
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
 * Claude built-in tools the host does not support.
 *
 * AskUserQuestion cannot be approved over the bridge (an allow response
 * requires an `updatedInput` answer the host does not hold, which makes Claude
 * loop on a ZodError); EnterPlanMode/ExitPlanMode belong to Claude's native
 * planning flow, which the host does not use — planning runs ask through the
 * host's `ask_user_question` platform tool instead.
 *
 * These are denied inside `canUseTool` so the model never blocks on an
 * approval that cannot succeed.
 */
const CLAUDE_HOST_DENIED_TOOLS: ReadonlySet<string> = new Set([
  'EnterPlanMode',
  'ExitPlanMode',
  'AskUserQuestion',
]);

const CLAUDE_HOST_DENIED_TOOLS_MESSAGE =
  '宿主不支持该工具。规划模式请用宿主提供的 plan_submit 提交方案，中途需要决策时用 ask_user_question；执行模式直接完成任务；不要进入 Claude 原生规划流程。';

/** Read-only tools a planning run may use. */
const PLANNING_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'];

/** Mutating + native-planning tools a planning run must never reach. */
const PLANNING_DISALLOWED_TOOLS = [
  'Bash',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Task',
  'Agent',
  'EnterPlanMode',
  'ExitPlanMode',
  'AskUserQuestion',
];

export interface ClaudeSdkAdapterDeps {
  /**
   * Test seam: replace the real SDK entry point.
   *
   * The CLI-era adapter injected a fake child process and asserted on argv;
   * with the SDK the equivalent seam is the `query` call itself — tests assert
   * on the resolved `Options` and drive a scripted `SDKMessage` sequence.
   */
  query?: typeof sdkQuery;
}

/**
 * Version of the CLI binary bundled with the installed SDK.
 *
 * `manifest.json` is not listed in the package's `exports`, so requiring it by
 * subpath throws ERR_PACKAGE_PATH_NOT_EXPORTED (verified on 0.3.238). Resolve
 * the package entry point instead and read the manifest that sits beside it.
 */
function bundledClaudeVersion(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve('@anthropic-ai/claude-agent-sdk');
    const manifestPath = join(dirname(entry), 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

export class ClaudeSdkKernelAdapter implements KernelAdapter {
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
    // Mirrors the registry entry: no option overrides the window, and Claude
    // auto-compacts against its own 200k budget.
    contextWindow: { nativeLimit: 200_000, overridable: false },
  };
  readonly knownGoodVersions: readonly string[] = ['2.1.222', '2.1.238'];

  constructor(private readonly deps: ClaudeSdkAdapterDeps = {}) {}

  private permissionCallbacks: Array<(request: KernelPermissionRequest) => void> = [];
  private exitCallbacks: Array<(code: number | null, stderrTail: string) => void> = [];
  private usageCallbacks: Array<(usage: KernelUsage) => void> = [];
  private pendingPermissionDecisions = new Map<
    string,
    (decision: KernelPermissionDecision) => void
  >();
  private activeQuery?: Query;
  private abortController?: AbortController;
  private stderrChunks: string[] = [];
  private activeContextWindow = 128_000;
  private cancelled = false;
  /** True once stream_event text deltas arrived (suppresses the whole-message echo). */
  private streamedText = false;
  /** Claude may replay a complete assistant message while resuming a tool loop. */
  private readonly seenAssistantToolUses = new Set<string>();

  /**
   * The SDK bundles its own CLI binary, so the kernel is always available once
   * the dependency is installed — no PATH probe, no "not installed" state. A
   * missing manifest means a broken install rather than a missing kernel.
   */
  async detectVersion(): Promise<string | null> {
    return bundledClaudeVersion();
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

  /** Compose the SDK options for one run (pure w.r.t. adapter state except the window). */
  private buildOptions(
    request: KernelRequest,
    canUseTool: CanUseTool,
    abortController: AbortController,
  ): Options {
    const options: Options = {
      abortController,
      cwd: request.workspaceDir,
      canUseTool,
      // The host renders every partial itself; without this only whole
      // assistant messages arrive and the UI cannot stream text.
      includePartialMessages: true,
      permissionMode: request.planningMode
        ? // Planning runs must never bypass permissions: with bypassPermissions
          // Claude executes built-ins (EnterPlanMode / AskUserQuestion) without
          // consulting canUseTool, so the host could not deny them and the run
          // would trap in Claude's native planning flow. `default` keeps every
          // tool flowing through the bridge (allowedTools still auto-allows the
          // read-only set).
          'default'
        : mapPermissionMode(request.permissionMode),
      stderr: (data: string) => {
        this.stderrChunks.push(data);
        // Bound the retained tail; only the last few KB reach diagnostics.
        if (this.stderrChunks.length > 200) this.stderrChunks.splice(0, 100);
      },
    };

    if (request.planningMode) {
      // Planning mode: read-only analysis only. The host MCP catalog is already
      // filtered to read-only tools; this fence restricts Claude's native ones.
      options.allowedTools = [...PLANNING_ALLOWED_TOOLS];
      options.disallowedTools = [...PLANNING_DISALLOWED_TOOLS];
    } else if (options.permissionMode === 'bypassPermissions') {
      // The SDK refuses bypassPermissions without this explicit acknowledgement.
      options.allowDangerouslySkipPermissions = true;
    }

    // Session continuity: `create` pins the host-chosen id, `resume` continues
    // Claude's own session (which already holds the shared history).
    if (request.session?.mode === 'create' && request.session.id) {
      options.sessionId = request.session.id;
    } else if (request.session?.mode === 'resume' && request.session.id) {
      options.resume = request.session.id;
    }

    // create → full system context; resume → only the cross-kernel gap
    // catch-up block. `append` preserves Claude's own preset prompt, which is
    // what the CLI's --append-system-prompt did.
    const append =
      !request.session || request.session.mode === 'create'
        ? request.systemContext || undefined
        : request.session.catchUp || undefined;
    if (append) {
      options.systemPrompt = { type: 'preset', preset: 'claude_code', append };
    }

    if (request.providerModelId) options.model = request.providerModelId;

    if (request.platformBroker) {
      // The broker address + token ride in the server env. Unlike the CLI path
      // this never touches disk, so there is no temp file holding a live token
      // and nothing to clean up on cancel.
      const broker = request.platformBroker;
      options.mcpServers = {
        [PLATFORM_MCP_SERVER_NAME]: {
          type: 'stdio',
          command: broker.command,
          args: [...broker.args],
          env: {
            ST_BROKER_HOST: broker.host,
            ST_BROKER_PORT: String(broker.port),
            ST_BROKER_TOKEN: broker.token,
            ST_WORKSPACE_DIR: broker.workspaceDir,
          },
        },
      };
      // Keep only this server visible; ignore the user's own MCP config.
      options.strictMcpConfig = true;
    }

    const env: Record<string, string | undefined> = { ...process.env };
    if (request.credential.reuseLocalLogin === true) {
      // Prefer the user's local OAuth login — do not inject a key, and leave
      // their settings sources loaded.
    } else if (request.credential.apiKey) {
      // A host-supplied credential must not be silently overridden by a stale
      // token in the user's Claude settings, so filesystem settings are
      // disabled for this run (the CLI equivalent was `--setting-sources=`).
      options.settingSources = [];
      if (request.credential.baseUrl) {
        env.ANTHROPIC_BASE_URL = stripAnthropicV1Suffix(request.credential.baseUrl);
      }
      env.ANTHROPIC_API_KEY = request.credential.apiKey;
      // Override both variables: ANTHROPIC_AUTH_TOKEN takes precedence in some
      // configurations and would otherwise carry a stale login.
      env.ANTHROPIC_AUTH_TOKEN = request.credential.apiKey;
    }
    // `env` REPLACES the subprocess environment rather than merging, so the
    // spread of process.env above is required for PATH/HOME to survive.
    options.env = env;

    return options;
  }

  async *start(request: KernelRequest): AsyncIterable<KernelEvent> {
    this.cancelled = false;
    this.streamedText = false;
    this.seenAssistantToolUses.clear();
    this.stderrChunks = [];
    this.pendingPermissionDecisions.clear();
    this.activeContextWindow = request.effectiveContextWindow ?? request.contextWindow ?? 128_000;

    const redact = (value: string): string =>
      sanitizeKernelDiagnostic(value, [request.credential.apiKey]);

    const abortController = new AbortController();
    this.abortController = abortController;

    // Permission requests are produced by the SDK's canUseTool callback, which
    // runs concurrently with message consumption. They are funnelled into the
    // same ordered queue as messages so the host sees one coherent stream.
    const queue: KernelEvent[] = [];
    let waiter: ((event: KernelEvent | null) => void) | undefined;
    let closed = false;
    let terminalSeen = false;
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
          ...(event.error ? { error: redact(event.error) } : {}),
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

    const canUseTool: CanUseTool = async (toolName, input, options) => {
      // Host-unsupported built-ins are denied immediately and never surface an
      // approval card the user could not act on.
      if (CLAUDE_HOST_DENIED_TOOLS.has(toolName)) {
        return { behavior: 'deny', message: CLAUDE_HOST_DENIED_TOOLS_MESSAGE };
      }
      if (this.cancelled) {
        return { behavior: 'deny', message: 'run cancelled' };
      }
      const requestId = options.requestId || options.toolUseID || `perm-${randomUUID()}`;
      const permission = toSdkPermissionRequest({
        requestId,
        toolName,
        input,
        decisionReason: options.decisionReason,
      });
      pushEvent({ type: 'permission-request', ...permission });
      this.permissionCallbacks.forEach((callback) => callback(permission));
      const decision = await this.waitForPermissionDecision(requestId, options.signal);
      return toPermissionResult(decision);
    };

    const runQuery = this.deps.query ?? sdkQuery;
    let queryHandle: Query;
    try {
      queryHandle = runQuery({
        prompt: singleUserMessage(request.userText),
        options: this.buildOptions(request, canUseTool, abortController),
      });
    } catch (error) {
      // Option intake throws synchronously for invalid combinations; surface it
      // as a terminal failure rather than letting it escape the generator.
      yield {
        type: 'terminal',
        status: 'failed',
        error: redact(
          formatKernelExitDiagnostic(this.name, null, this.stderrTail(), [
            request.credential.apiKey,
          ], error),
        ),
      };
      return;
    }
    this.activeQuery = queryHandle;

    // Pump SDK messages into the queue in the background so permission requests
    // raised from canUseTool interleave correctly with message events.
    const pump = (async () => {
      try {
        for await (const message of queryHandle) {
          this.processMessage(message, pushEvent);
        }
        if (!terminalSeen && !this.cancelled) {
          // The stream ended without a result message — treat as a clean end
          // only if we were not cancelled; otherwise the run loop owns it.
          pushEvent({ type: 'terminal', status: 'completed' });
        }
        this.exitCallbacks.forEach((callback) => callback(0, redact(this.stderrTail())));
      } catch (error) {
        if (this.cancelled) {
          // Abort surfaces as a rejection; the cancel path already decided the
          // outcome, so do not synthesize a failure over it.
          this.exitCallbacks.forEach((callback) => callback(null, redact(this.stderrTail())));
        } else {
          pushEvent({
            type: 'terminal',
            status: 'failed',
            error: formatKernelExitDiagnostic(
              this.name,
              null,
              this.stderrTail(),
              [request.credential.apiKey],
              error,
            ),
          });
          this.exitCallbacks.forEach((callback) => callback(1, redact(this.stderrTail())));
        }
      } finally {
        push(null);
      }
    })();

    try {
      while (true) {
        const event = await next();
        if (!event) break;
        yield event;
        if (event.type === 'terminal') break;
      }
    } finally {
      // The run loop owns explicit cancel/stop; make sure the pump cannot keep
      // the process alive if the consumer walked away early.
      void pump.catch(() => undefined);
    }
  }

  private stderrTail(): string {
    return this.stderrChunks.join('').slice(-4000);
  }

  private waitForPermissionDecision(
    requestId: string,
    signal: AbortSignal,
  ): Promise<KernelPermissionDecision> {
    return new Promise((resolve) => {
      if (this.cancelled || signal.aborted) {
        resolve({ allow: false, message: 'run cancelled' });
        return;
      }
      const settle = (decision: KernelPermissionDecision): void => {
        this.pendingPermissionDecisions.delete(requestId);
        signal.removeEventListener('abort', onAbort);
        resolve(decision);
      };
      const onAbort = (): void => settle({ allow: false, message: 'run cancelled' });
      signal.addEventListener('abort', onAbort, { once: true });
      this.pendingPermissionDecisions.set(requestId, settle);
    });
  }

  /** Translate one SDKMessage into KernelEvents (unknown types ignored + logged). */
  private processMessage(message: SDKMessage, push: (event: KernelEvent) => void): void {
    switch (message.type) {
      case 'assistant':
        this.processAssistant(message, push);
        return;
      case 'stream_event':
        this.processStreamEvent(message, push);
        return;
      case 'user': {
        // Tool results arrive as tool_result blocks on echoed user messages;
        // without this the timeline only ever shows tool.requested.
        for (const result of extractSdkToolResults(
          (message as { message?: { content?: unknown } }).message ?? {},
        )) {
          push({
            type: 'tool-result',
            toolId: result.toolId,
            output: result.output,
            isError: result.isError,
          });
        }
        return;
      }
      case 'result': {
        const result = message as {
          subtype?: string;
          is_error?: boolean;
          result?: unknown;
          errors?: unknown;
        };
        const failed = result.subtype !== 'success' || result.is_error === true;
        if (!failed) {
          push({ type: 'terminal', status: 'completed' });
          return;
        }
        const error =
          extractSdkErrorMessage(result.errors) ??
          extractSdkErrorMessage(result.result) ??
          'Claude Code reported a failed result.';
        push({ type: 'terminal', status: 'failed', error });
        return;
      }
      case 'system': {
        const system = message as {
          subtype?: string;
          session_id?: string;
          error_status?: number | null;
          error?: string;
        };
        if (system.subtype === 'init') {
          const sessionId = system.session_id?.trim();
          if (sessionId) push({ type: 'session-started', sessionId });
          return;
        }
        if (system.subtype === 'compact_boundary') {
          push({ type: 'compacted' });
          return;
        }
        if (system.subtype === 'api_retry') {
          // Structured on the SDK (unlike the CLI's string matching): a 401/403
          // or an explicit authentication_failed will never succeed on retry,
          // so fail the run now instead of burning the retry budget.
          const status = system.error_status;
          if (status === 401 || status === 403 || system.error === 'authentication_failed') {
            push({
              type: 'terminal',
              status: 'failed',
              error:
                status == null
                  ? 'Claude Code authentication failed.'
                  : `Claude Code authentication failed (HTTP ${status}).`,
            });
          }
        }
        return;
      }
      default:
        // Unknown message types are ignored + logged (mapping principle §4.1).
        // The SDKMessage union grows over time by design.
        return;
    }
  }

  /**
   * Incremental assistant stream. Text/thinking deltas are the streaming source
   * of truth; tool_use and usage come from the following complete `assistant`
   * message so tool arguments never come from partial JSON.
   */
  private processStreamEvent(
    message: { event?: unknown },
    push: (event: KernelEvent) => void,
  ): void {
    const inner = message.event as
      | { type?: string; delta?: { type?: string; text?: string; thinking?: string } }
      | undefined;
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

  private processAssistant(
    message: { message?: unknown },
    push: (event: KernelEvent) => void,
  ): void {
    const inner = message.message as
      | {
          id?: string;
          model?: string;
          content?: ClaudeSdkContentBlock[];
          usage?: ClaudeSdkUsage;
        }
      | undefined;
    if (!inner) return;
    for (const block of inner.content ?? []) {
      if (block.type === 'text' && block.text) {
        // Already streamed as stream_event text deltas — do not double-emit.
        if (!this.streamedText) push({ type: 'delta', text: block.text });
      } else if (block.type === 'tool_use') {
        const toolId = block.id ?? `tool-${randomUUID()}`;
        const replayKey = `${inner.id ?? 'unknown-message'} ${toolId}`;
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
    // (mostly cache reads). Per-message reports keep distinct requestIds: the
    // host sums them for the billing total (every request is billed) while the
    // projector's context watermark takes the LAST request's occupancy — a tool
    // loop must not inflate "context used" with repeated prefixes.
    const usage = inner.usage;
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
        requestId: inner.id,
        providerResponseId: inner.id,
        modelId: inner.model,
      };
      push({ type: 'usage', usage: kernelUsage });
      this.usageCallbacks.forEach((callback) => callback(kernelUsage));
    }
  }

  async stop(): Promise<void> {
    await this.teardown();
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
    const active = this.activeQuery;
    if (active) {
      // Ask Claude to stop the turn cleanly first; the abort below is the
      // backstop. Unlike the CLI path this needs no timed race — the SDK owns
      // the process and `close()` is synchronous and idempotent.
      await active.interrupt().catch(() => undefined);
    }
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    const active = this.activeQuery;
    this.activeQuery = undefined;
    const controller = this.abortController;
    this.abortController = undefined;
    controller?.abort();
    try {
      active?.close();
    } catch {
      // close() is best-effort; a already-finished query throws nothing useful.
    }
  }
}

/** Map a host decision onto the SDK's PermissionResult shape. */
function toPermissionResult(decision: KernelPermissionDecision): PermissionResult {
  if (decision.allow) {
    return {
      behavior: 'allow',
      ...(decision.updatedInput !== undefined
        ? { updatedInput: decision.updatedInput as Record<string, unknown> }
        : {}),
    };
  }
  // The deny branch requires a message; the model reads it as the refusal.
  return { behavior: 'deny', message: decision.message ?? 'denied by host' };
}

/**
 * One-shot prompt as a stream.
 *
 * Streaming-input mode (an AsyncIterable rather than a bare string) is what
 * unlocks `Query.interrupt()` and the other control methods, which the cancel
 * path depends on. The iterable closes immediately after the single message:
 * the turn still runs to completion, and closing tells the SDK no further user
 * input is coming.
 */
async function* singleUserMessage(text: string): AsyncIterable<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
  } as SDKUserMessage;
}
