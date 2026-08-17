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
  codexReasoningText,
  codexToolCallArgsJson,
  codexToolCallName,
  createCodexLineBuffer,
  extractCodexErrorMessage,
  isCodexTransientErrorMessage,
  mapCodexApprovalPolicy,
  mapCodexSandbox,
  parseCodexEvent,
  type CodexItem,
  type CodexJsonEvent,
  type CodexUsage,
} from './codex-protocol.js';
import { probeKernel } from './detect.js';
import { formatKernelExitDiagnostic, sanitizeKernelDiagnostic } from './kernel-diagnostics.js';
import { startKernelProcess, type KernelProcessHandle } from './process.js';
import { buildCodexMcpConfigArgs } from './platform-mcp-config.js';
import {
  createCodexRolloutCompactionWatcher,
  type RolloutCompactionWatcher,
} from './codex-rollout-compaction.js';

export interface CodexAdapterDeps {
  /** Test seam: replace the real spawn (fixture codex processes). */
  spawn?: (args: string[], env: Record<string, string>, cwd: string) => KernelProcessHandle;
  /** Controlled invocation-only global flags, used by isolated real-CLI verification. */
  globalArgs?: readonly string[];
  /** Controlled `codex exec` flags, used by isolated real-CLI verification. */
  execArgs?: readonly string[];
  /** `$CODEX_HOME` override — defaults to `~/.codex`. Test seam. */
  codexHome?: string;
  /** Test seam: replace the rollout compaction watcher factory. */
  createRolloutWatcher?: (
    sessionId: string,
    onCompacted: () => void,
  ) => RolloutCompactionWatcher;
}

export class CodexKernelAdapter implements KernelAdapter {
  readonly id = 'codex' as const;
  readonly name = 'Codex';
  readonly icon = 'codex';
  readonly capabilities = {
    // Codex only speaks the OpenAI Responses dialect: the Chat Completions wire
    // API was removed upstream in 2026-02. Chat-only upstreams therefore need
    // the gateway (see kernelNeedsGateway).
    protocols: ['openai-responses' as const],
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
  private activeRequestId = '';

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
    this.activeRequestId = `codex-turn-${randomUUID()}`;
    const approval = mapCodexApprovalPolicy(request.permissionMode);
    const sandbox = mapCodexSandbox(request.permissionMode);
    const args = [
      '--ask-for-approval',
      approval,
      ...(this.deps.globalArgs ?? []),
      'exec',
      ...(this.deps.execArgs ?? []),
      '--json',
      '-s',
      sandbox,
      '-C',
      request.workspaceDir,
    ];
    if (request.providerModelId) args.push('--model', request.providerModelId);
    // Override the model context window so codex honors the host-configured
    // budget (verified 0.145.0 accepts `-c model_context_window=<n>`).
    const effectiveWindow =
      request.effectiveContextWindow ?? request.contextWindow ?? 128_000;
    args.push('-c', `model_context_window=${effectiveWindow}`);
    // Surface host reasoning effort so codex requests provider thinking and
    // emits reasoning items (mapped to KernelEvent reasoning → the UI thinking
    // region). Off → explicit no-thinking; otherwise pass the effort level.
    if (request.reasoningEffort) {
      const codexEffort = request.reasoningEffort === 'off' ? 'minimal' : request.reasoningEffort;
      args.push('-c', `model_reasoning_effort=${codexEffort}`);
    }
    // Reasoning effort controls token allocation, not whether `exec --json`
    // publishes readable reasoning items. Request a summary explicitly so the
    // adapter receives displayable text instead of usage-only reasoning tokens.
    args.push('-c', 'model_reasoning_summary=detailed');
    // Enable codex's own auto-compaction so it frees context before hitting the
    // window, instead of overrunning the host budget. We hand codex the same
    // window limit and let its native mechanism pick the compaction point (its
    // internal clamp keeps it below the window); the host only observes the
    // `compacted` event and shows a "compacting" notice — it never re-compacts
    // an autonomous kernel (design §2.3 ②). Verified 0.145.0 accepts the key.
    args.push('-c', `model_auto_compact_token_limit=${effectiveWindow}`);
    // Codex reads ~/.codex/config.toml, where users commonly pin a global
    // `model_provider` (e.g. a CC-Switch relay such as `custom` → KMKAPI). That
    // would hijack every run to the user's relay instead of the provider this
    // run actually selected. The `-c` dotted overrides below pin a per-run
    // provider to the resolved upstream (the gateway inbound URL when the run
    // goes through the gateway, otherwise the provider's own base URL) so the
    // selected provider always wins. Codex's `wire_api` only supports
    // "responses" (Chat was removed upstream in 2026-02), so chat-only upstreams
    // must go through the gateway — that decision lives in
    // resolveKernelCredential / kernelNeedsGateway.
    const env: Record<string, string> = {};
    if (request.credential.reuseLocalLogin !== true && request.credential.apiKey) {
      if (request.credential.baseUrl) {
        const providerId = `st_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
        const envKey = `ST_KERNEL_KEY_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
        const toml = (value: string): string => JSON.stringify(value);
        args.push('-c', `model_provider=${toml(providerId)}`);
        args.push('-c', `model_providers.${providerId}.name=${toml('SYNC-THINK')}`);
        args.push('-c', `model_providers.${providerId}.base_url=${toml(request.credential.baseUrl)}`);
        args.push('-c', `model_providers.${providerId}.wire_api=${toml('responses')}`);
        args.push('-c', `model_providers.${providerId}.requires_openai_auth=false`);
        args.push('-c', `model_providers.${providerId}.env_key=${toml(envKey)}`);
        env[envKey] = request.credential.apiKey;
        env.OPENAI_API_KEY = request.credential.apiKey;
      } else {
        env.OPENAI_API_KEY = request.credential.apiKey;
      }
    }
    args.push('--skip-git-repo-check');
    // Slice 5: codex exec has no --mcp-config; the -c mcp_servers.* overrides
    // register the platform MCP server for this invocation only (verified on
    // 0.145.0). Broker address + token ride in the server env.
    if (request.platformBroker) args.push(...buildCodexMcpConfigArgs(request.platformBroker));
    // The prompt travels over stdin, never argv — user text must not cross a
    // cmd.exe shim command line (shell metacharacters + process-list exposure).
    // codex exec reads the prompt from stdin and starts without waiting for EOF.
    if (request.session?.mode === 'resume' && request.session.id) {
      args.push('resume', request.session.id, '-');
    } else {
      args.push('-');
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
    this.activeContextWindow =
      request.effectiveContextWindow ?? request.contextWindow ?? 128_000;
    const child = handle.child;

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

    const buffer = createCodexLineBuffer((line) => {
      const event = parseCodexEvent(line);
      if (!event) return;
      // Kick off the rollout compaction watcher as soon as the thread/session
      // id is known (exec JSON stdout never carries compaction events).
      if (event.type === 'thread.started') {
        const threadId = (event as { thread_id?: string }).thread_id?.trim();
        if (threadId) startRolloutWatcher(threadId);
      }
      this.processEvent(event, pushEvent);
    });
    // The exec JSON stdout does not surface auto-compaction (the serializer
    // drops ContextCompaction items). Tail codex's own rollout JSONL for the
    // thread to observe `compacted` lines and map them to host events. The
    // watcher is advisory and stops with the run.
    let rolloutWatcher: RolloutCompactionWatcher | undefined;
    const startRolloutWatcher = (sessionId: string): void => {
      rolloutWatcher?.stop();
      rolloutWatcher = this.deps.createRolloutWatcher
        ? this.deps.createRolloutWatcher(sessionId, () => pushEvent({ type: 'compacted' }))
        : createCodexRolloutCompactionWatcher({
            codexHome: this.deps.codexHome,
            sessionId,
            onCompacted: () => pushEvent({ type: 'compacted' }),
          });
    };
    const stopRolloutWatcher = (): void => {
      rolloutWatcher?.stop();
      rolloutWatcher = undefined;
    };
    let stdoutEnded = child.stdout == null;
    const flushStdout = (): void => {
      if (stdoutEnded) return;
      stdoutEnded = true;
      buffer.end();
    };
    child.stdout?.on('data', (chunk: Buffer) => buffer.push(chunk.toString()));
    child.stdout?.once('end', flushStdout);
    child.stdout?.once('close', flushStdout);
    const finalize = (code: number | null, processError?: unknown): void => {
      if (finalized) return;
      finalized = true;
      stopRolloutWatcher();
      flushStdout();
      const stderrTail = sanitizeKernelDiagnostic(handle.stderrTail(), [request.credential.apiKey]);
      if (!terminalSeen) {
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

    // Deliver the prompt over stdin (see start()), then EOF. Verified on
    // codex 0.145.0: spawned via the cmd.exe shim path it waits for EOF after
    // the prompt before starting the turn. Exec is a single turn, so closing
    // stdin is semantically correct. Defensive — a fixture spawn may not wire
    // stdin.
    const stdin = child.stdin;
    if (stdin) {
      const prompt =
        request.session?.mode === 'resume'
          ? // resume → user text, prefixed by the cross-kernel gap catch-up block
            [request.session.catchUp, request.userText].filter(Boolean).join('\n\n')
          : [request.systemContext, request.userText].filter(Boolean).join('\n\n');
      stdin.write(prompt + '\n');
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
      case 'thread.started': {
        const threadId = (event as { thread_id?: string }).thread_id?.trim();
        if (threadId) push({ type: 'session-started', sessionId: threadId });
        return;
      }
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
          error: extractCodexErrorMessage(error) ?? 'codex turn failed',
        });
        return;
      }
      case 'compacted': {
        // Codex compacted its own context (auto-compaction). The host records
        // the boundary and surfaces a "kernel compacted context" notice; it
        // must never re-compact an autonomous kernel (§2.3 ②).
        push({ type: 'compacted' });
        return;
      }
      case 'event_msg': {
        // Some codex builds also emit a `context_compacted` marker inside an
        // event_msg after compaction (observed in rollout JSONL history).
        const payload = (event as { payload?: { type?: string } }).payload;
        if (payload?.type === 'context_compacted') {
          push({ type: 'compacted' });
        }
        return;
      }
      case 'error': {
        const message = extractCodexErrorMessage(
          (event as { message?: unknown }).message ?? (event as { error?: unknown }).error,
        );
        if (message && isCodexTransientErrorMessage(message)) {
          console.warn('[kernel:codex] transient retry', message);
          return;
        }
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
        name: codexToolCallName(item),
        argsJson: codexToolCallArgsJson(item),
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
        push({ type: 'reasoning', text: codexReasoningText(item) });
        return;
      case 'command_execution':
        push({
          type: 'tool-result',
          toolId: item.id ?? `codex-${randomUUID()}`,
          output: item.aggregated_output ?? (typeof item.output === 'string' ? item.output : ''),
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
      case 'mcp_tool_call':
      case 'web_search':
        push({
          type: 'tool-result',
          toolId: item.id ?? `codex-${randomUUID()}`,
          output: extractMcpItemResult(item),
          isError: item.error != null,
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
    // Verified against a real codex 0.145.0 rollout: total_tokens equals
    // input_tokens + output_tokens, so cached/cache-write are subsets of
    // input_tokens and must never be added again.
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    return {
      real: input + output,
      window: this.activeContextWindow,
      input,
      output,
      cached: usage.cached_input_tokens,
      cachedTokensCreated: usage.cache_write_input_tokens,
      reasoningTokens: usage.reasoning_output_tokens,
      requestId: this.activeRequestId,
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

/**
 * Extract the text a codex MCP/web_search item completed with. Real shape
 * (0.145.0): item.result.content = [{type:'text', text}] — flatten to plain
 * text for the tool-result timeline.
 */
function extractMcpItemResult(item: CodexItem): string {
  const result = item.result;
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const parts = content
        .map((entry) => {
          if (entry && typeof entry === 'object' && 'text' in entry) {
            return String((entry as { text: unknown }).text ?? '');
          }
          return '';
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.join('\n');
    }
    const error = (result as { error?: unknown }).error;
    if (error) return String(error);
    return JSON.stringify(result);
  }
  if (typeof item.output === 'string' && item.output) return item.output;
  if (item.error != null) return String(item.error);
  return '';
}
