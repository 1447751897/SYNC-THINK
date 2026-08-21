import { createHash, randomUUID } from 'node:crypto';
import type {
  KernelAdapter,
  KernelEvent,
  KernelPermissionDecision,
  KernelPermissionRequest,
  KernelRequest,
  KernelUsage,
  PlatformBrokerInfo,
} from '@sync-think/shared';
import { probeKernel } from './detect.js';
import { sanitizeKernelDiagnostic } from './kernel-diagnostics.js';
import { startKernelProcess, type KernelProcessHandle } from './process.js';
import { PLATFORM_MCP_SERVER_NAME } from './platform-mcp-config.js';

type JsonRpcId = string | number;
type JsonRecord = Record<string, unknown>;

interface JsonRpcMessage extends JsonRecord {
  id?: JsonRpcId;
  method?: string;
  params?: JsonRecord;
  result?: unknown;
  error?: unknown;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface PendingApproval {
  id: JsonRpcId;
  kind: 'command' | 'file';
}

interface ActiveTurn {
  threadId: string;
  turnId?: string;
  queue: KernelEvent[];
  waiter?: (event: KernelEvent | null) => void;
  closed: boolean;
  streamedTextItems: Set<string>;
  streamedReasoningItems: Set<string>;
  /**
   * Last reasoning item that streamed into the thinking flow. app-server
   * separates thoughts into items and summary parts (`summaryPartAdded`),
   * but the host thinking row is one concatenated text — without an explicit
   * paragraph break the section headings fuse into `**A****B**`.
   */
  lastReasoningItemId?: string;
  /** Whether any reasoning text has been emitted for this turn yet. */
  reasoningEmitted: boolean;
}

export interface CodexAppServerAdapterDeps {
  spawn?: (args: string[], env: Record<string, string>, cwd: string) => KernelProcessHandle;
  requestTimeoutMs?: number;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' ? (value as JsonRecord) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Flatten one reasoning field into text.
 *
 * app-server has shipped several shapes for the same payload: a plain string,
 * an array of strings, or an array of content parts (`{ type, text }`). Reading
 * only one of them is why completed-but-not-streamed reasoning rendered empty.
 */
function reasoningPart(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    // Blank line between array entries: each entry is a separate thought
    // section (often starting with a `**heading**` line) and a single `\n`
    // is not a paragraph break in Markdown — headings would fuse visually.
    return value
      .map((entry) => reasoningPart(entry))
      .filter((entry) => entry.trim().length > 0)
      .join('\n\n');
  }
  const record = asRecord(value);
  if (!record) return '';
  return reasoningPart(record.text ?? record.content ?? record.summary ?? '');
}

/**
 * Reasoning body for a completed item, richest field first.
 *
 * `summary` is the condensed headline Codex emits under
 * `model_reasoning_summary: 'detailed'`; `text`/`content` carry the full
 * chain when the model exposes it. Prefer the full body and fall back to the
 * summary so the panel never shows an empty thought.
 */
function reasoningText(item: JsonRecord): string {
  for (const field of [item.text, item.content, item.summary]) {
    const value = reasoningPart(field).trim();
    if (value) return value;
  }
  return '';
}

function approvalPolicy(
  mode: KernelRequest['permissionMode'],
): 'never' | 'on-request' | 'untrusted' {
  if (mode === 'full-access') return 'never';
  if (mode === 'workspace') return 'untrusted';
  return 'on-request';
}

function mcpConfig(broker: PlatformBrokerInfo | undefined): JsonRecord | undefined {
  if (!broker) return undefined;
  return {
    [PLATFORM_MCP_SERVER_NAME]: {
      command: broker.command,
      args: broker.args,
      env: {
        ST_BROKER_HOST: broker.host,
        ST_BROKER_PORT: String(broker.port),
        ST_BROKER_TOKEN: broker.token,
        ST_WORKSPACE_DIR: broker.workspaceDir,
      },
    },
  };
}

function processIdentity(request: KernelRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        baseUrl: request.credential.baseUrl ?? null,
        apiKey: request.credential.apiKey ?? null,
        reuseLocalLogin: request.credential.reuseLocalLogin === true,
      }),
    )
    .digest('hex');
}

function providerConfig(request: KernelRequest): {
  modelProvider?: string;
  env: Record<string, string>;
  config: JsonRecord;
} {
  const config: JsonRecord = {
    model_context_window: request.effectiveContextWindow ?? request.contextWindow ?? 128_000,
    model_auto_compact_token_limit:
      request.effectiveContextWindow ?? request.contextWindow ?? 128_000,
    model_reasoning_summary: 'detailed',
  };
  const mcpServers = mcpConfig(request.platformBroker);
  if (mcpServers) config.mcp_servers = mcpServers;
  if (request.credential.reuseLocalLogin === true || !request.credential.apiKey) {
    return { env: {}, config };
  }
  const providerId = `st_${createHash('sha256')
    .update(request.credential.baseUrl ?? 'openai')
    .digest('hex')
    .slice(0, 12)}`;
  const envKey = 'ST_CODEX_APP_SERVER_KEY';
  config.model_providers = {
    [providerId]: {
      name: 'SYNC-THINK',
      ...(request.credential.baseUrl ? { base_url: request.credential.baseUrl } : {}),
      wire_api: 'responses',
      requires_openai_auth: false,
      env_key: envKey,
    },
  };
  return {
    modelProvider: providerId,
    env: { [envKey]: request.credential.apiKey, OPENAI_API_KEY: request.credential.apiKey },
    config,
  };
}

function errorMessage(value: unknown): string {
  const record = asRecord(value);
  const nested = asRecord(record?.error);
  return (
    text(record?.message) ??
    text(nested?.message) ??
    text(nested?.additionalDetails) ??
    text(value) ??
    'Codex app-server request failed'
  );
}

function requestedModel(request: KernelRequest): string | undefined {
  const providerModelId = request.providerModelId?.trim();
  if (providerModelId && providerModelId !== 'codex-default') return providerModelId;
  const model = request.model?.trim();
  return model && model !== 'codex-default' ? model : undefined;
}

export class CodexAppServerKernelAdapter implements KernelAdapter {
  readonly id = 'codex' as const;
  readonly name = 'Codex';
  readonly icon = 'codex';
  readonly capabilities = {
    protocols: ['openai-responses' as const],
    permission: 'own' as const,
    permissionBridge: true,
    pause: 'turn' as const,
    compress: 'own' as const,
    usageReport: true,
  };
  readonly knownGoodVersions: readonly string[] = ['0.145.0'];

  private handle?: KernelProcessHandle;
  private processIdentity?: string;
  private lineBuffer = '';
  private nextRequestId = 1;
  private pending = new Map<JsonRpcId, PendingRequest>();
  private approvals = new Map<string, PendingApproval>();
  private activeTurn?: ActiveTurn;
  private permissionCallback?: (request: KernelPermissionRequest) => void;
  private usageCallback?: (usage: KernelUsage) => void;
  private exitCallback?: (code: number | null, stderrTail: string) => void;
  private activeContextWindow = 128_000;
  private activeUsageRequestId = '';
  private activePlanningMode = false;
  private diagnosticSecrets: string[] = [];
  private stopPromise?: Promise<void>;
  private initialized = false;

  constructor(private readonly deps: CodexAppServerAdapterDeps = {}) {}

  async detectVersion(): Promise<string | null> {
    return probeKernel('codex').version;
  }

  onPermissionRequest(callback: (request: KernelPermissionRequest) => void): void {
    this.permissionCallback = callback;
  }

  respondPermission(requestId: string, decision: KernelPermissionDecision): void {
    const pending = this.approvals.get(requestId);
    if (!pending) return;
    this.approvals.delete(requestId);
    this.write({
      jsonrpc: '2.0',
      id: pending.id,
      result: { decision: decision.allow ? 'accept' : 'decline' },
    });
  }

  onUsage(callback: (usage: KernelUsage) => void): void {
    this.usageCallback = callback;
  }

  onExit(callback: (code: number | null, stderrTail: string) => void): void {
    this.exitCallback = callback;
  }

  async *start(request: KernelRequest): AsyncIterable<KernelEvent> {
    if (this.activeTurn) throw new Error('Codex app-server already has an active turn');
    await this.ensureProcess(request);
    this.activeContextWindow = request.effectiveContextWindow ?? request.contextWindow ?? 128_000;
    this.activeUsageRequestId = `codex-turn-${randomUUID()}`;
    this.activePlanningMode = request.planningMode === true;

    const threadId = await this.ensureThread(request);
    yield { type: 'session-started', sessionId: threadId };

    const turn: ActiveTurn = {
      threadId,
      queue: [],
      closed: false,
      streamedTextItems: new Set(),
      streamedReasoningItems: new Set(),
      reasoningEmitted: false,
    };
    this.activeTurn = turn;
    const prompt =
      request.session?.mode === 'resume'
        ? [request.session.catchUp, request.userText].filter(Boolean).join('\n\n')
        : request.userText;
    try {
      const response = asRecord(
        await this.request('turn/start', {
          threadId,
          input: [{ type: 'text', text: prompt, text_elements: [] }],
          cwd: request.workspaceDir,
          approvalPolicy: approvalPolicy(request.permissionMode),
          model: requestedModel(request),
          ...(request.reasoningEffort
            ? { effort: request.reasoningEffort === 'off' ? 'minimal' : request.reasoningEffort }
            : {}),
          summary: 'detailed',
        }),
      );
      turn.turnId = text(asRecord(response?.turn)?.id) ?? turn.turnId;
      while (true) {
        const event = await this.nextTurnEvent(turn);
        if (!event) break;
        yield event;
        if (event.type === 'terminal') break;
      }
    } finally {
      if (this.activeTurn === turn) this.activeTurn = undefined;
      for (const [requestId, approval] of this.approvals) {
        if (approval) this.approvals.delete(requestId);
      }
    }
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    const handle = this.handle;
    if (!handle) return Promise.resolve();
    this.stopPromise = this.stopHandle(handle, new Error('Codex app-server stopped')).finally(
      () => {
        if (this.handle === handle) {
          this.handle = undefined;
          this.processIdentity = undefined;
          this.initialized = false;
          this.diagnosticSecrets = [];
        }
        this.stopPromise = undefined;
      },
    );
    return this.stopPromise;
  }

  async pause(): Promise<void> {
    await this.cancel();
  }

  async resume(): Promise<void> {
    // A cancelled turn is followed by a new turn on the same thread.
  }

  async cancel(): Promise<void> {
    const turn = this.activeTurn;
    if (!turn?.turnId || turn.closed || !this.handle) return;
    await this.request('turn/interrupt', { threadId: turn.threadId, turnId: turn.turnId }).catch(
      () => undefined,
    );
  }

  private async ensureProcess(request: KernelRequest): Promise<void> {
    const identity = processIdentity(request);
    if (this.handle && this.processIdentity === identity && this.initialized) return;
    if (this.handle) await this.stop();
    const provider = providerConfig(request);
    const args = ['app-server', '--listen', 'stdio://'];
    const handle = this.deps.spawn
      ? this.deps.spawn(args, provider.env, request.workspaceDir)
      : startKernelProcess({
          command: 'codex',
          args,
          cwd: request.workspaceDir,
          env: provider.env,
        });
    this.handle = handle;
    this.processIdentity = identity;
    this.initialized = false;
    this.diagnosticSecrets = [request.credential.apiKey, request.platformBroker?.token].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    this.lineBuffer = '';
    handle.child.stdout?.on('data', (chunk: Buffer) => this.consume(chunk.toString('utf8')));
    handle.child.stdout?.on('end', () => this.flushLines());
    handle.child.once('error', (error) => this.handleExit(handle, null, error));
    handle.child.once('close', (code) => this.handleExit(handle, code));
    try {
      await this.request('initialize', {
        clientInfo: { name: 'sync-think', title: 'SYNC-THINK', version: '0.0.1' },
        capabilities: { experimentalApi: true },
      });
      this.write({ jsonrpc: '2.0', method: 'initialized' });
      this.initialized = true;
    } catch (error) {
      await this.stopHandle(
        handle,
        error instanceof Error ? error : new Error(String(error)),
      ).catch(() => undefined);
      if (this.handle === handle) {
        this.handle = undefined;
        this.processIdentity = undefined;
        this.initialized = false;
        this.diagnosticSecrets = [];
      }
      throw error;
    }
  }

  private async ensureThread(request: KernelRequest): Promise<string> {
    const provider = providerConfig(request);
    const common = {
      model: requestedModel(request),
      ...(provider.modelProvider ? { modelProvider: provider.modelProvider } : {}),
      cwd: request.workspaceDir,
      approvalPolicy: request.planningMode ? 'on-request' : approvalPolicy(request.permissionMode),
      sandboxPolicy: request.planningMode
        ? { type: 'readOnly' }
        : request.permissionMode === 'full-access'
          ? { type: 'dangerFullAccess' }
          : {
              type: 'workspaceWrite',
              writableRoots: [request.workspaceDir],
              networkAccess: false,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            },
      config: provider.config,
    };
    const result = asRecord(
      request.session?.mode === 'resume' && request.session.id
        ? await this.request('thread/resume', { threadId: request.session.id, ...common })
        : await this.request('thread/start', {
            ...common,
            baseInstructions: request.systemContext,
            ephemeral: false,
          }),
    );
    const threadId = text(asRecord(result?.thread)?.id);
    if (!threadId) throw new Error('Codex app-server thread response missing thread.id');
    return threadId;
  }

  private request(method: string, params: JsonRecord): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server ${method} timed out`));
      }, this.deps.requestTimeoutMs ?? 30_000);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private write(message: JsonRpcMessage): void {
    const stdin = this.handle?.child.stdin;
    if (!stdin || stdin.destroyed) throw new Error('Codex app-server stdin is unavailable');
    stdin.write(`${JSON.stringify(message)}\n`);
  }

  private consume(chunk: string): void {
    this.lineBuffer += chunk;
    let index = this.lineBuffer.indexOf('\n');
    while (index >= 0) {
      const line = this.lineBuffer.slice(0, index);
      this.lineBuffer = this.lineBuffer.slice(index + 1);
      this.processLine(line);
      index = this.lineBuffer.indexOf('\n');
    }
  }

  private flushLines(): void {
    if (this.lineBuffer.trim()) this.processLine(this.lineBuffer);
    this.lineBuffer = '';
  }

  private processLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(
          new Error(sanitizeKernelDiagnostic(errorMessage(message.error), this.diagnosticSecrets)),
        );
      } else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }
    if (message.method) this.handleNotification(message.method, message.params ?? {});
  }

  private handleServerRequest(message: JsonRpcMessage): void {
    const method = message.method ?? '';
    const params = message.params ?? {};
    if (
      method === 'item/commandExecution/requestApproval' ||
      method === 'item/fileChange/requestApproval'
    ) {
      if (this.activePlanningMode) {
        this.write({
          jsonrpc: '2.0',
          id: message.id,
          result: { decision: 'decline' },
        });
        return;
      }
      const requestId = String(message.id);
      this.approvals.set(requestId, {
        id: message.id!,
        kind: method.includes('commandExecution') ? 'command' : 'file',
      });
      const request: KernelPermissionRequest = {
        requestId,
        toolName: method.includes('commandExecution') ? 'command_execution' : 'file_change',
        toolInput: params,
        ...(text(params.reason) ? { reason: text(params.reason) } : {}),
      };
      this.permissionCallback?.(request);
      this.pushTurnEvent({ type: 'permission-request', ...request });
      return;
    }
    this.write({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Unsupported app-server request: ${method}` },
    });
  }

  private handleNotification(method: string, params: JsonRecord): void {
    const turn = this.activeTurn;
    if (!turn || text(params.threadId) !== turn.threadId) return;
    const notificationTurnId = text(params.turnId) ?? text(asRecord(params.turn)?.id);
    if (notificationTurnId && turn.turnId && notificationTurnId !== turn.turnId) return;
    if (notificationTurnId && !turn.turnId) turn.turnId = notificationTurnId;

    if (method === 'item/agentMessage/delta') {
      const delta = text(params.delta);
      const itemId = text(params.itemId);
      if (itemId) turn.streamedTextItems.add(itemId);
      // agentMessage IS the user-facing reply (codex working prose rides the
      // reasoning channel instead) — declare it final so the host streams it
      // into the answer area live instead of parking it in the process panel
      // until the terminal reclassifies it.
      if (delta) this.pushTurnEvent({ type: 'delta', text: delta, final: true });
      return;
    }
    if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
      const delta = text(params.delta);
      const itemId = text(params.itemId);
      if (delta) this.pushReasoningText(turn, delta, itemId);
      if (itemId) {
        turn.streamedReasoningItems.add(itemId);
        turn.lastReasoningItemId = itemId;
      }
      return;
    }
    if (method === 'item/reasoning/summaryPartAdded') {
      // A new summary section begins inside the same reasoning item. Emit a
      // paragraph break so its `**heading**` doesn't fuse with the previous
      // section's tail (`**A****B**`). Skip when nothing streamed yet — the
      // first part may announce itself before any delta.
      const itemId = text(params.itemId);
      if (turn.reasoningEmitted && (!itemId || turn.streamedReasoningItems.has(itemId))) {
        this.pushTurnEvent({ type: 'reasoning', text: '\n\n' });
      }
      return;
    }
    if (method === 'item/started') {
      this.mapItemStarted(asRecord(params.item));
      return;
    }
    if (method === 'item/completed') {
      this.mapItemCompleted(asRecord(params.item), turn);
      return;
    }
    if (method === 'thread/tokenUsage/updated') {
      const usage = asRecord(asRecord(params.tokenUsage)?.last);
      if (!usage) return;
      const mapped: KernelUsage = {
        real:
          numberValue(usage.totalTokens) ??
          (numberValue(usage.inputTokens) ?? 0) + (numberValue(usage.outputTokens) ?? 0),
        window:
          numberValue(asRecord(params.tokenUsage)?.modelContextWindow) ?? this.activeContextWindow,
        input: numberValue(usage.inputTokens),
        output: numberValue(usage.outputTokens),
        cached: numberValue(usage.cachedInputTokens),
        cachedTokensCreated: numberValue(usage.cacheWriteInputTokens),
        reasoningTokens: numberValue(usage.reasoningOutputTokens),
        requestId: this.activeUsageRequestId,
      };
      this.pushTurnEvent({ type: 'usage', usage: mapped });
      this.usageCallback?.(mapped);
      return;
    }
    if (method === 'thread/compacted') {
      this.pushTurnEvent({ type: 'compacted' });
      return;
    }
    if (method === 'turn/completed') {
      const completed = asRecord(params.turn);
      const status = text(completed?.status);
      const failure = asRecord(completed?.error);
      this.pushTurnEvent(
        status === 'failed'
          ? { type: 'terminal', status: 'failed', error: errorMessage(failure) }
          : status === 'interrupted'
            ? { type: 'terminal', status: 'failed', error: 'Codex turn interrupted' }
            : { type: 'terminal', status: 'completed' },
      );
      this.closeTurn(turn);
      return;
    }
    if (method === 'error') {
      if (params.willRetry === true) return;
      const message = sanitizeKernelDiagnostic(errorMessage(params), this.diagnosticSecrets);
      this.pushTurnEvent({ type: 'terminal', status: 'failed', error: message });
      this.closeTurn(turn);
    }
  }

  private mapItemStarted(item: JsonRecord | undefined): void {
    if (!item) return;
    const type = text(item.type);
    const id = text(item.id) ?? `codex-${randomUUID()}`;
    if (type === 'commandExecution') {
      this.pushTurnEvent({
        type: 'tool-call',
        toolId: id,
        name: 'command_execution',
        argsJson: JSON.stringify({ command: text(item.command) ?? '' }),
        partial: false,
      });
    } else if (type === 'mcpToolCall') {
      const server = text(item.server) ?? 'mcp';
      const tool = text(item.tool) ?? 'tool';
      this.pushTurnEvent({
        type: 'tool-call',
        toolId: id,
        name: `mcp__${server}__${tool}`,
        argsJson: JSON.stringify(item.arguments ?? {}),
        partial: false,
      });
    }
  }

  private mapItemCompleted(item: JsonRecord | undefined, turn: ActiveTurn): void {
    if (!item) return;
    const type = text(item.type);
    const id = text(item.id) ?? `codex-${randomUUID()}`;
    if (type === 'agentMessage' && !turn.streamedTextItems.has(id)) {
      const value = text(item.text);
      if (value) this.pushTurnEvent({ type: 'delta', text: value, final: true });
    } else if (type === 'reasoning' && !turn.streamedReasoningItems.has(id)) {
      const value = reasoningText(item);
      if (value) {
        this.pushReasoningText(turn, value, id);
        turn.lastReasoningItemId = id;
      }
    } else if (type === 'commandExecution') {
      this.pushTurnEvent({
        type: 'tool-result',
        toolId: id,
        output: text(item.aggregatedOutput) ?? '',
        isError: (numberValue(item.exitCode) ?? 0) !== 0,
      });
    } else if (type === 'mcpToolCall') {
      this.pushTurnEvent({
        type: 'tool-result',
        toolId: id,
        output: JSON.stringify(item.result ?? item.error ?? {}),
        isError: item.error != null,
      });
    } else if (type === 'fileChange') {
      this.pushTurnEvent({
        type: 'tool-result',
        toolId: id,
        output: 'file changed',
        isError: false,
      });
    }
  }

  /**
   * Emit reasoning text with a paragraph break when the thought moves to a
   * different reasoning item — distinct items are distinct thoughts, but the
   * host renders one concatenated thinking flow (§图二: sections must read as
   * separate paragraphs, not fused `**A****B**`).
   */
  private pushReasoningText(turn: ActiveTurn, delta: string, itemId: string | undefined): void {
    if (
      turn.reasoningEmitted &&
      itemId &&
      turn.lastReasoningItemId &&
      itemId !== turn.lastReasoningItemId
    ) {
      this.pushTurnEvent({ type: 'reasoning', text: '\n\n' });
    }
    turn.reasoningEmitted = true;
    this.pushTurnEvent({ type: 'reasoning', text: delta });
  }

  private pushTurnEvent(event: KernelEvent): void {
    const turn = this.activeTurn;
    if (!turn || turn.closed) return;
    if (turn.waiter) {
      const resolve = turn.waiter;
      turn.waiter = undefined;
      resolve(event);
    } else {
      turn.queue.push(event);
    }
  }

  private nextTurnEvent(turn: ActiveTurn): Promise<KernelEvent | null> {
    if (turn.queue.length > 0) return Promise.resolve(turn.queue.shift()!);
    if (turn.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      turn.waiter = resolve;
    });
  }

  private closeTurn(turn: ActiveTurn): void {
    turn.closed = true;
    if (turn.waiter && turn.queue.length === 0) {
      const resolve = turn.waiter;
      turn.waiter = undefined;
      resolve(null);
    }
  }

  private async stopHandle(handle: KernelProcessHandle, reason: Error): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
    this.approvals.clear();
    const turn = this.activeTurn;
    if (turn && !turn.closed) {
      this.pushTurnEvent({ type: 'terminal', status: 'failed', error: reason.message });
      this.closeTurn(turn);
    }

    const child = handle.child;
    if (
      child.exitCode === null &&
      child.signalCode === null &&
      child.stdin &&
      !child.stdin.destroyed
    ) {
      child.stdin.end();
      await Promise.race([
        new Promise<void>((resolve) => child.once('close', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 250)),
      ]);
    }
    if (child.exitCode === null && child.signalCode === null) await handle.killTree();
    handle.job?.close();
  }

  private handleExit(
    expectedHandle: KernelProcessHandle,
    code: number | null,
    processError?: unknown,
  ): void {
    if (this.handle !== expectedHandle) return;
    const stderrTail = sanitizeKernelDiagnostic(
      expectedHandle.stderrTail(),
      this.diagnosticSecrets,
    );
    this.handle = undefined;
    this.processIdentity = undefined;
    this.initialized = false;
    const error = new Error(
      processError instanceof Error
        ? processError.message
        : `Codex app-server exited with code ${code ?? 'unknown'}`,
    );
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (this.activeTurn && !this.activeTurn.closed) {
      this.pushTurnEvent({
        type: 'terminal',
        status: 'failed',
        error: stderrTail || sanitizeKernelDiagnostic(error.message, this.diagnosticSecrets),
      });
      this.closeTurn(this.activeTurn);
    }
    this.diagnosticSecrets = [];
    this.exitCallback?.(code, stderrTail);
  }
}
