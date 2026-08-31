/**
 * Claude Code kernel adapter, backed by @anthropic-ai/claude-agent-sdk
 * (design doc §5.2).
 *
 * Replaces the hand-rolled `claude --print --output-format stream-json` child
 * process. The SDK owns the transport and framing while SYNC-THINK may point it
 * at an app-private, independently upgraded Claude Code executable. This
 * adapter is therefore limited to event/permission adaptation and mapping
 * `SDKMessage` to `KernelEvent`.
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
 *   - Claude-native permission and planning modes
 *   - host rendering for permission and MCP interaction events
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
import { probeVersion } from './detect.js';
import { resolveManagedKernelExecutable } from './managed-kernel.js';

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

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function toClaudeSdkUsage(value: unknown): ClaudeSdkUsage {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const inputTokens = finiteNumber(raw.input_tokens) ?? finiteNumber(raw.inputTokens);
  const outputTokens = finiteNumber(raw.output_tokens) ?? finiteNumber(raw.outputTokens);
  const cacheCreationInputTokens =
    finiteNumber(raw.cache_creation_input_tokens) ?? finiteNumber(raw.cacheCreationInputTokens);
  const cacheReadInputTokens =
    finiteNumber(raw.cache_read_input_tokens) ?? finiteNumber(raw.cacheReadInputTokens);
  return {
    ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
    ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
    ...(cacheCreationInputTokens !== undefined
      ? { cache_creation_input_tokens: cacheCreationInputTokens }
      : {}),
    ...(cacheReadInputTokens !== undefined
      ? { cache_read_input_tokens: cacheReadInputTokens }
      : {}),
  };
}

function mergeClaudeUsage(current: ClaudeSdkUsage, incoming: ClaudeSdkUsage): ClaudeSdkUsage {
  const normalized = toClaudeSdkUsage(incoming);
  return {
    ...(current.input_tokens !== undefined ? { input_tokens: current.input_tokens } : {}),
    ...(current.output_tokens !== undefined ? { output_tokens: current.output_tokens } : {}),
    ...(current.cache_creation_input_tokens !== undefined
      ? { cache_creation_input_tokens: current.cache_creation_input_tokens }
      : {}),
    ...(current.cache_read_input_tokens !== undefined
      ? { cache_read_input_tokens: current.cache_read_input_tokens }
      : {}),
    ...normalized,
  };
}

function hasClaudeUsage(value: ClaudeSdkUsage | undefined): boolean {
  if (!value) return false;
  return [
    value.input_tokens,
    value.output_tokens,
    value.cache_creation_input_tokens,
    value.cache_read_input_tokens,
  ].some((candidate) => finiteNumber(candidate) !== undefined);
}

export interface ClaudeSdkAdapterDeps {
  /**
   * Test seam: replace the real SDK entry point.
   *
   * The CLI-era adapter injected a fake child process and asserted on argv;
   * with the SDK the equivalent seam is the `query` call itself — tests assert
   * on the resolved `Options` and drive a scripted `SDKMessage` sequence.
   */
  query?: typeof sdkQuery;
  /** Test seam and private-kernel resolver override. */
  resolveExecutable?: () => string | null;
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
  /** Tool blocks currently receiving streamed input_json_delta fragments. */
  private readonly streamedToolUses = new Map<
    number,
    { toolId: string; name: string; partialJson: string }
  >();
  /** Usage starts at message_start and is completed by message_delta. */
  private activeStreamUsage?: {
    id?: string;
    model?: string;
    usage: ClaudeSdkUsage;
  };
  /** Fallback usage from SDK assistant envelopes when partial stream usage is absent. */
  private readonly pendingAssistantUsages = new Map<
    string,
    { id?: string; model?: string; usage: ClaudeSdkUsage }
  >();
  /** Prevents message_stop/result fallbacks from duplicating a completed report. */
  private readonly emittedUsageKeys = new Set<string>();
  private usageSequence = 0;

  /** Prefer the atomically activated private CLI, then report the SDK bundle. */
  async detectVersion(): Promise<string | null> {
    const executable =
      this.deps.resolveExecutable?.() ?? resolveManagedKernelExecutable('claude-code');
    return executable ? probeVersion(executable) : bundledClaudeVersion();
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
        ? // SDK-native planning (NewMax-style): the model receives Claude's own
          // plan-mode system reminders, researches read-only and submits via
          // ExitPlanMode — which flows through canUseTool into the host plan
          // card. Never bypassPermissions here: that would skip canUseTool and
          // trap the run inside Claude's own interactive planning flow.
          'plan'
        : mapPermissionMode(request.permissionMode),
      stderr: (data: string) => {
        this.stderrChunks.push(data);
        // Bound the retained tail; only the last few KB reach diagnostics.
        if (this.stderrChunks.length > 200) this.stderrChunks.splice(0, 100);
      },
    };

    const managedExecutable =
      this.deps.resolveExecutable?.() ?? resolveManagedKernelExecutable('claude-code');
    if (managedExecutable) options.pathToClaudeCodeExecutable = managedExecutable;

    if (options.permissionMode === 'bypassPermissions') {
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
      // In-process SDK MCP servers (design Phase 1/5): the SDK owns an
      // in-process MCP transport, so the platform servers arrive as live
      // `McpSdkServerConfigWithInstance` objects keyed by server name — no
      // stdio subprocess, no broker token, nothing on disk. The SDK exposes
      // their tools as `mcp__<server>__<tool>`.
      if (request.platformBroker.sdkMcpServers) {
        options.mcpServers = request.platformBroker
          .sdkMcpServers as unknown as Options['mcpServers'];
      } else {
        // Legacy fallback: stdio broker path (kept for codex/pi which cannot
        // accept in-process SDK servers).
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
      }
      // Merge the platform servers with Claude's native/user MCP discovery.
      // SYNC-THINK adapts its own tools but does not narrow the vendor surface.
    }

    const env: Record<string, string | undefined> = { ...process.env };
    env.ENABLE_PROMPT_CACHING_1H = '1';
    delete env.FORCE_PROMPT_CACHING_5M;
    if (request.credential.reuseLocalLogin === true) {
      // Prefer the user's local OAuth login — do not inject a key, and leave
      // their settings sources loaded.
    } else if (request.credential.apiKey) {
      // An explicit provider credential is isolated from Claude's user/project
      // settings. Those files may contain SessionStart hooks, apiKeyHelper,
      // or a different endpoint; loading them can block this request before it
      // reaches the provider selected in SYNC-THINK. The host supplies the
      // provider credential and MCP servers explicitly for this run.
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
    this.streamedToolUses.clear();
    this.activeStreamUsage = undefined;
    this.pendingAssistantUsages.clear();
    this.emittedUsageKeys.clear();
    this.usageSequence = 0;
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
        prompt: singleUserMessage(request.userText, request.images),
        options: this.buildOptions(request, canUseTool, abortController),
      });
    } catch (error) {
      // Option intake throws synchronously for invalid combinations; surface it
      // as a terminal failure rather than letting it escape the generator.
      yield {
        type: 'terminal',
        status: 'failed',
        error: redact(
          formatKernelExitDiagnostic(
            this.name,
            null,
            this.stderrTail(),
            [request.credential.apiKey],
            error,
          ),
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
          this.flushPendingUsage(pushEvent);
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
          uuid?: string;
          usage?: unknown;
          modelUsage?: unknown;
        };
        this.flushPendingUsage(push, result);
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
   * of truth. Tool blocks are announced at content_block_start so the UI can
   * render a running row before Claude finishes producing their arguments.
   */
  private processStreamEvent(
    message: { event?: unknown },
    push: (event: KernelEvent) => void,
  ): void {
    const inner = message.event as
      | {
          type?: string;
          message?: { id?: string; model?: string; usage?: ClaudeSdkUsage };
          usage?: ClaudeSdkUsage;
          index?: number;
          content_block?: { type?: string; id?: string; name?: string; input?: unknown };
          delta?: {
            type?: string;
            text?: string;
            thinking?: string;
            partial_json?: string;
          };
        }
      | undefined;
    if (!inner) return;
    if (inner.type === 'message_start') {
      this.flushActiveStreamUsage(push);
      this.activeStreamUsage = {
        ...(inner.message?.id ? { id: inner.message.id } : {}),
        ...(inner.message?.model ? { model: inner.message.model } : {}),
        usage: inner.message?.usage ?? {},
      };
      return;
    }
    if (inner.type === 'message_delta') {
      if (!this.activeStreamUsage) this.activeStreamUsage = { usage: {} };
      this.activeStreamUsage.usage = mergeClaudeUsage(
        this.activeStreamUsage.usage,
        inner.usage ?? {},
      );
      if (hasClaudeUsage(inner.usage)) this.flushActiveStreamUsage(push);
      return;
    }
    if (inner.type === 'message_stop') {
      this.flushActiveStreamUsage(push);
      return;
    }
    if (inner.type === 'content_block_start' && inner.content_block?.type === 'tool_use') {
      const index = inner.index;
      if (!Number.isInteger(index)) return;
      const toolId = inner.content_block.id?.trim() || `tool-${randomUUID()}`;
      const name = inner.content_block.name?.trim() || 'unknown';
      const initialJson = JSON.stringify(inner.content_block.input ?? {});
      this.streamedToolUses.set(index!, { toolId, name, partialJson: '' });
      push({ type: 'tool-call', toolId, name, argsJson: initialJson, partial: true });
      return;
    }
    if (inner.type === 'content_block_stop') {
      const index = inner.index;
      if (!Number.isInteger(index)) return;
      const streamed = this.streamedToolUses.get(index!);
      if (!streamed) return;
      this.streamedToolUses.delete(index!);
      // The SDK may publish the complete assistant envelope before this stop
      // event. In that order the envelope already supplied authoritative input;
      // do not overwrite it with a truncated partial_json capture.
      if (this.seenAssistantToolUses.has(streamed.toolId)) return;
      push({
        type: 'tool-call',
        toolId: streamed.toolId,
        name: streamed.name,
        argsJson: streamed.partialJson.trim() || '{}',
        partial: false,
      });
      return;
    }
    if (inner.type !== 'content_block_delta') return;
    const delta = inner.delta;
    if (delta?.type === 'input_json_delta') {
      const index = inner.index;
      if (!Number.isInteger(index)) return;
      const streamed = this.streamedToolUses.get(index!);
      if (streamed && delta.partial_json) streamed.partialJson += delta.partial_json;
      return;
    }
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
        const replayKey = `${inner.id ?? 'unknown-message'}\u0000${toolId}`;
        if (this.seenAssistantToolUses.has(toolId) || this.seenAssistantToolUses.has(replayKey)) {
          continue;
        }
        this.seenAssistantToolUses.add(toolId);
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
    // The assistant envelope is a fallback only. Its usage is an initial snapshot
    // while the authoritative output/cache totals arrive in message_delta.
    const usage = inner.usage;
    if (!usage || !hasClaudeUsage(usage)) return;
    const usageKey = inner.id?.trim() ?? `assistant-${++this.usageSequence}`;
    const previous = this.pendingAssistantUsages.get(usageKey);
    this.pendingAssistantUsages.set(usageKey, {
      ...(inner.id ? { id: inner.id } : {}),
      ...(inner.model ? { model: inner.model } : {}),
      usage: mergeClaudeUsage(previous?.usage ?? {}, usage),
    });
    if (this.activeStreamUsage?.id && this.activeStreamUsage.id === inner.id) {
      this.activeStreamUsage.usage = mergeClaudeUsage(this.activeStreamUsage.usage, usage);
    }
  }

  private flushActiveStreamUsage(push: (event: KernelEvent) => void): void {
    const active = this.activeStreamUsage;
    if (!active) return;
    this.emitUsage(active.usage, push, {
      requestId: active.id,
      providerResponseId: active.id,
      modelId: active.model,
    });
    this.activeStreamUsage = undefined;
  }

  private flushPendingUsage(
    push: (event: KernelEvent) => void,
    result?: { uuid?: string; usage?: unknown; modelUsage?: unknown },
  ): void {
    this.flushActiveStreamUsage(push);
    if (this.emittedUsageKeys.size === 0 && result) {
      if (this.emitResultModelUsage(result, push)) {
        this.pendingAssistantUsages.clear();
        return;
      }
    }
    for (const [key, pending] of this.pendingAssistantUsages) {
      this.emitUsage(pending.usage, push, {
        requestId: pending.id ?? `claude-assistant-${key}`,
        providerResponseId: pending.id,
        modelId: pending.model,
      });
    }
    this.pendingAssistantUsages.clear();
    if (this.emittedUsageKeys.size === 0 && result) {
      this.emitUsage(toClaudeSdkUsage(result.usage), push, {
        requestId: result.uuid ? `claude-result-${result.uuid}` : undefined,
        providerResponseId: result.uuid,
      });
    }
  }

  private emitResultModelUsage(
    result: { uuid?: string; modelUsage?: unknown },
    push: (event: KernelEvent) => void,
  ): boolean {
    if (!result.modelUsage || typeof result.modelUsage !== 'object') return false;
    let emitted = false;
    for (const [model, rawUsage] of Object.entries(result.modelUsage as Record<string, unknown>)) {
      if (!rawUsage || typeof rawUsage !== 'object') continue;
      const usage = toClaudeSdkUsage(rawUsage);
      if (!hasClaudeUsage(usage)) continue;
      const requestId = `${result.uuid ?? 'claude-result'}:${model}`;
      emitted =
        this.emitUsage(usage, push, {
          requestId,
          providerResponseId: result.uuid,
          modelId: model,
          kernelWindow: finiteNumber((rawUsage as Record<string, unknown>).contextWindow),
        }) || emitted;
    }
    return emitted;
  }

  private emitUsage(
    usage: ClaudeSdkUsage,
    push: (event: KernelEvent) => void,
    identity: {
      requestId?: string;
      providerResponseId?: string;
      modelId?: string;
      kernelWindow?: number;
    },
  ): boolean {
    if (!hasClaudeUsage(usage)) return false;
    const requestId = identity.requestId?.trim() ?? `claude-usage-${++this.usageSequence}`;
    if (this.emittedUsageKeys.has(requestId)) return false;
    this.emittedUsageKeys.add(requestId);
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
      ...(usage.cache_read_input_tokens !== undefined
        ? { cached: usage.cache_read_input_tokens }
        : {}),
      ...(usage.cache_creation_input_tokens !== undefined
        ? { cachedTokensCreated: usage.cache_creation_input_tokens }
        : {}),
      ...(identity.kernelWindow !== undefined ? { kernelWindow: identity.kernelWindow } : {}),
      ...(requestId ? { requestId } : {}),
      ...(identity.providerResponseId ? { providerResponseId: identity.providerResponseId } : {}),
      ...(identity.modelId ? { modelId: identity.modelId } : {}),
    };
    push({ type: 'usage', usage: kernelUsage });
    this.usageCallbacks.forEach((callback) => callback(kernelUsage));
    return true;
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
 *
 * Attached images are forwarded as Anthropic base64 image blocks when the
 * host resolved them to data URLs; invalid URLs are dropped silently (the
 * host already decided these are the images the model should see).
 */
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

async function* singleUserMessage(
  text: string,
  images?: Array<{ name: string; mimeType: string; dataUrl: string }>,
): AsyncIterable<SDKUserMessage> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text }];
  for (const image of images ?? []) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(image.dataUrl);
    if (!match) continue;
    const mimeType = /image\/(png|jpeg|gif|webp)/.test(image.mimeType) ? image.mimeType : match[1];
    if (!SUPPORTED_IMAGE_MEDIA_TYPES.has(mimeType)) continue;
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data: match[2] },
    });
  }
  yield {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  } as unknown as SDKUserMessage;
}
