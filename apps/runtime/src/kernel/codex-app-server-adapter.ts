import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
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
  /** Last app-server summary section observed for each reasoning item. */
  reasoningSummaryIndexes: Map<string, number>;
  /** Prevent duplicate breaks when both summaryIndex and summaryPartAdded fire. */
  reasoningAtBoundary: boolean;
  /** Stable ordinal for synthetic update_task_plan events from Codex plans. */
  planUpdateIndex: number;
  /** Native plan items are submitted only from their completed canonical text. */
  submittedPlanItems: Set<string>;
  /** Whether app-server has announced a contextCompaction item for this turn. */
  compactionInProgress: boolean;
  /** Avoid duplicate success events from item/completed + legacy thread/compacted. */
  compactionCompleted: boolean;
  /**
   * Zero-output watchdogs for commandExecution items. codex CLI 0.147 on
   * Windows can hang forever after `item/started` (the spawned command never
   * produces output nor completes — reproduced with a bare app-server run,
   * independent of sandbox/approval settings). Without a watchdog the run sits
   * in "长时间无输出" until recovery expiry (~30 min). Any outputDelta re-arms
   * the timer, so long-running commands WITH output are unaffected.
   */
  commandWatchdogs: Map<string, ReturnType<typeof setTimeout>>;
}

/** Zero-output command timeout — generous enough for slow-but-alive commands. */
const COMMAND_SILENCE_TIMEOUT_MS = 120_000;
/** Keep each transient pipe frame small while preserving the newest output. */
const MAX_TOOL_PROGRESS_CHARS = 8_192;

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

function commandOutputText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const text = value.map(commandOutputText).filter(Boolean).join('');
    return text || undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  for (const candidate of [record.delta, record.output, record.text, record.content]) {
    const text = commandOutputText(candidate);
    if (text) return text;
  }
  return undefined;
}

function boundToolProgress(textValue: string): string {
  if (textValue.length <= MAX_TOOL_PROGRESS_CHARS) return textValue;
  return textValue.slice(-MAX_TOOL_PROGRESS_CHARS);
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

function codexPolicies(request: KernelRequest): {
  approvalPolicy: 'never' | 'on-request' | 'untrusted';
  sandboxPolicy: JsonRecord;
} {
  if (request.planningMode) {
    return {
      approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'readOnly' },
    };
  }
  return {
    approvalPolicy: approvalPolicy(request.permissionMode),
    sandboxPolicy:
      request.permissionMode === 'full-access'
        ? { type: 'dangerFullAccess' }
        : {
            type: 'workspaceWrite',
            writableRoots: [request.workspaceDir],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
  };
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
      // Codex treats MCP servers as untrusted by default: every tool call then
      // needs an approval round-trip that no host UI answers, so calls resolve
      // to "user rejected MCP tool call" before they ever reach the broker.
      // The HOST still runs its own approval cards inside the executor — this
      // only tells codex to stop double-approving at its layer.
      enabled: true,
      default_tools_approval_mode: 'auto',
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
    // Keep the Codex-style Think row on the provider's user-visible summary.
    // The raw reasoning chain is an internal diagnostic stream and can turn a
    // single turn into dozens of Markdown headings in the chat UI.
    show_raw_agent_reasoning: false,
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

function requestedReasoningEffort(request: KernelRequest): string | undefined {
  const effort = request.reasoningEffort;
  if (!effort || effort === 'auto') return undefined;
  return effort === 'off' ? 'none' : effort;
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
  /** Set when the zero-output command watchdog interrupted the current turn. */
  private commandWatchdogFired = false;
  private permissionCallback?: (request: KernelPermissionRequest) => void;
  private usageCallback?: (usage: KernelUsage) => void;
  private exitCallback?: (code: number | null, stderrTail: string) => void;
  private activeContextWindow = 128_000;
  private activeUsageRequestId = '';
  private activePlanningMode = false;
  private activeThreadModel = '';
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
      reasoningSummaryIndexes: new Map(),
      reasoningAtBoundary: false,
      planUpdateIndex: 0,
      submittedPlanItems: new Set(),
      compactionInProgress: false,
      compactionCompleted: false,
      commandWatchdogs: new Map(),
    };
    this.activeTurn = turn;
    this.commandWatchdogFired = false;
    const prompt =
      request.session?.mode === 'resume'
        ? [request.session.catchUp, request.userText].filter(Boolean).join('\n\n')
        : request.userText;
    // Prefer app-server's native localImage input for the host-validated staged
    // file. Inline image URLs remain useful for callers that have no local path.
    const input: Array<Record<string, unknown>> = [
      { type: 'text', text: prompt, text_elements: [] },
    ];
    for (const image of request.images ?? []) {
      const filePath = image.filePath?.trim();
      if (filePath && isAbsolute(filePath) && existsSync(filePath)) {
        input.push({ type: 'localImage', path: filePath });
        continue;
      }
      if (!/^data:image\/(png|jpeg|gif|webp);base64,.+$/.test(image.dataUrl)) continue;
      input.push({ type: 'image', url: image.dataUrl });
    }
    try {
      const policies = codexPolicies(request);
      const effort = requestedReasoningEffort(request);
      const collaborationMode = {
        mode: request.planningMode === true ? 'plan' : 'default',
        settings: {
          model:
            requestedModel(request) ||
            this.activeThreadModel ||
            request.providerModelId ||
            request.model,
          reasoning_effort: effort ?? null,
          // null deliberately selects Codex's built-in instructions for the mode.
          developer_instructions: null,
        },
      };
      const response = asRecord(
        await this.request('turn/start', {
          threadId,
          input,
          cwd: request.workspaceDir,
          ...policies,
          model: requestedModel(request),
          ...(effort ? { effort } : {}),
          summary: 'detailed',
          collaborationMode,
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
          this.activeThreadModel = '';
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
    const policies = codexPolicies(request);
    const common = {
      model: requestedModel(request),
      ...(provider.modelProvider ? { modelProvider: provider.modelProvider } : {}),
      cwd: request.workspaceDir,
      ...policies,
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
    this.activeThreadModel =
      text(result?.model) ?? requestedModel(request) ?? this.activeThreadModel;
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
    // MCP tool-call elicitations (codex asks the host whether an MCP tool may
    // run): without a handler codex auto-declines and surfaces
    // "user rejected MCP tool call" *before* the call ever reaches our broker.
    // The HOST already enforces its own approval semantics inside the tool
    // executors (host approval cards, ask-mode fences), so accept here and let
    // the host-side gate decide. Same for generic tool requestUserInput.
    if (/\bMcpServer\/elicitation\/request$|\belicitation\/request$/i.test(method)) {
      this.write({
        jsonrpc: '2.0',
        id: message.id,
        result: { action: 'accept', content: null },
      });
      return;
    }
    if (/requestUserInput/i.test(method)) {
      this.write({ jsonrpc: '2.0', id: message.id, result: { answers: {} } });
      return;
    }
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
      // Do NOT mark agentMessage deltas final: models emit working prose as
      // agentMessage between tool calls too (e.g. "收到，我调用视觉模型读取…").
      // `final` would commit that prose as the durable answer before a later
      // tool boundary can reclassify it as commentary. Leave the delta
      // unclassified so Runtime buffers it; the host still streams the tokens
      // as a provisional answer and only classifies at a tool or terminal.
      if (delta) this.pushTurnEvent({ type: 'delta', text: delta });
      return;
    }
    if (method === 'item/plan/delta') {
      // The completed plan item is canonical; app-server explicitly warns that
      // concatenated deltas are not guaranteed to equal its final content.
      return;
    }
    if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
      const delta = text(params.delta);
      const itemId = text(params.itemId);
      const summaryIndex = numberValue(params.summaryIndex);
      if (method === 'item/reasoning/summaryTextDelta' && itemId && summaryIndex !== undefined) {
        const previousIndex = turn.reasoningSummaryIndexes.get(itemId);
        if (previousIndex !== undefined && previousIndex !== summaryIndex) {
          this.pushReasoningBoundary(turn);
        }
        turn.reasoningSummaryIndexes.set(itemId, summaryIndex);
      }
      if (delta) this.pushReasoningText(turn, delta, itemId);
      if (itemId) {
        turn.streamedReasoningItems.add(itemId);
      }
      return;
    }
    if (method === 'item/reasoning/summaryPartAdded') {
      // A new summary section begins inside the same reasoning item. Emit a
      // paragraph break so its `**heading**` doesn't fuse with the previous
      // section's tail (`**A****B**`). Skip when nothing streamed yet — the
      // first part may announce itself before any delta.
      this.pushReasoningBoundary(turn);
      return;
    }
    if (method === 'turn/plan/updated') {
      const rawPlan = Array.isArray(params.plan) ? params.plan : [];
      const items = rawPlan.flatMap((entry) => {
        const planEntry = asRecord(entry);
        const title = text(planEntry?.step)?.trim();
        if (!title) return [];
        const rawStatus = text(planEntry?.status);
        const status =
          rawStatus === 'completed'
            ? 'completed'
            : rawStatus === 'inProgress' || rawStatus === 'in_progress'
              ? 'in_progress'
              : 'pending';
        return [{ title, status }];
      });
      if (items.length === 0) return;
      const toolId = `codex-plan-${turn.turnId ?? 'turn'}-${turn.planUpdateIndex++}`;
      const argsJson = JSON.stringify({ items });
      this.pushTurnEvent({
        type: 'tool-call',
        toolId,
        name: 'update_task_plan',
        argsJson,
        partial: false,
      });
      this.pushTurnEvent({
        type: 'tool-result',
        toolId,
        output: JSON.stringify({
          ok: true,
          plan: {
            items,
            completed: items.filter((item) => item.status === 'completed').length,
            total: items.length,
          },
        }),
        isError: false,
      });
      return;
    }
    if (method === 'item/commandExecution/outputDelta') {
      // The command is alive and producing output — re-arm its watchdog.
      const itemId = text(params.itemId) ?? text(asRecord(params.item)?.id);
      if (itemId && turn.commandWatchdogs.has(itemId)) {
        clearTimeout(turn.commandWatchdogs.get(itemId)!);
        this.armCommandWatchdog(turn, itemId);
      }
      const output = commandOutputText(
        params.delta ?? params.output ?? params.text ?? asRecord(params.item)?.output,
      );
      if (itemId && output) {
        this.pushTurnEvent({
          type: 'tool-progress',
          toolId: itemId,
          output: boundToolProgress(output),
        });
      }
      return;
    }
    if (method === 'item/started') {
      this.mapItemStarted(asRecord(params.item), turn);
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
      if (!turn.compactionCompleted) {
        turn.compactionInProgress = false;
        turn.compactionCompleted = true;
        this.pushTurnEvent({ type: 'compacted' });
      }
      return;
    }
    if (method === 'turn/completed') {
      const completed = asRecord(params.turn);
      const status = text(completed?.status);
      const failure = asRecord(completed?.error);
      if ((status === 'failed' || status === 'interrupted') && turn.compactionInProgress) {
        turn.compactionInProgress = false;
        this.pushTurnEvent({
          type: 'compaction-failed',
          error: errorMessage(failure),
        });
      }
      this.pushTurnEvent(
        status === 'failed'
          ? { type: 'terminal', status: 'failed', error: errorMessage(failure) }
          : status === 'interrupted'
            ? {
                type: 'terminal',
                status: 'failed',
                error: this.commandWatchdogFired
                  ? '命令执行无输出超时，已中断（codex CLI 0.147 Windows 已知挂起问题，建议降级 codex 或改用其他内核执行命令）'
                  : 'Codex turn interrupted',
              }
            : { type: 'terminal', status: 'completed' },
      );
      this.closeTurn(turn);
      return;
    }
    if (method === 'error') {
      if (params.willRetry === true) return;
      const message = sanitizeKernelDiagnostic(errorMessage(params), this.diagnosticSecrets);
      if (turn.compactionInProgress) {
        turn.compactionInProgress = false;
        this.pushTurnEvent({ type: 'compaction-failed', error: message });
      }
      this.pushTurnEvent({ type: 'terminal', status: 'failed', error: message });
      this.closeTurn(turn);
    }
  }

  private mapItemStarted(item: JsonRecord | undefined, turn?: ActiveTurn): void {
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
      if (turn) this.armCommandWatchdog(turn, id);
    } else if (type === 'contextCompaction') {
      if (turn && !turn.compactionInProgress && !turn.compactionCompleted) {
        turn.compactionInProgress = true;
        this.pushTurnEvent({ type: 'compaction-started' });
      }
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
    if (type === 'plan') {
      const value = text(item.text)?.trim();
      if (value && !turn.submittedPlanItems.has(id)) {
        turn.submittedPlanItems.add(id);
        this.pushTurnEvent({ type: 'plan-submitted', text: value });
      }
    } else if (type === 'contextCompaction') {
      turn.compactionInProgress = false;
      if (!turn.compactionCompleted) {
        turn.compactionCompleted = true;
        this.pushTurnEvent({ type: 'compacted' });
      }
    } else if (type === 'agentMessage' && !turn.streamedTextItems.has(id)) {
      const value = text(item.text);
      // Unclassified (no `final`) for the same reason as the streaming path:
      // mid-turn agentMessages are classified at a tool or terminal boundary.
      if (value) this.pushTurnEvent({ type: 'delta', text: value });
    } else if (type === 'reasoning' && !turn.streamedReasoningItems.has(id)) {
      const value = reasoningText(item);
      if (value) {
        this.pushReasoningText(turn, value, id);
        turn.lastReasoningItemId = id;
      }
    } else if (type === 'commandExecution') {
      const watchdog = turn.commandWatchdogs.get(id);
      if (watchdog) {
        clearTimeout(watchdog);
        turn.commandWatchdogs.delete(id);
      }
      this.pushTurnEvent({
        type: 'tool-result',
        toolId: id,
        output:
          commandOutputText(item.aggregatedOutput ?? item.aggregated_output ?? item.output) ?? '',
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
      this.pushReasoningBoundary(turn);
    }
    turn.reasoningEmitted = true;
    turn.reasoningAtBoundary = false;
    if (itemId) turn.lastReasoningItemId = itemId;
    this.pushTurnEvent({ type: 'reasoning', text: delta });
  }

  private pushReasoningBoundary(turn: ActiveTurn): void {
    if (!turn.reasoningEmitted || turn.reasoningAtBoundary) return;
    this.pushTurnEvent({ type: 'reasoning', text: '\n\n', boundary: true });
    turn.reasoningAtBoundary = true;
  }

  /**
   * Arm (or re-arm) the zero-output watchdog for one commandExecution item.
   * On expiry: surface a failed tool-result with a actionable diagnosis and
   * interrupt the turn — codex 0.147 on Windows never completes the item, so
   * without this the run hangs in "长时间无输出" until recovery expiry.
   */
  private armCommandWatchdog(turn: ActiveTurn, itemId: string): void {
    const existing = turn.commandWatchdogs.get(itemId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      turn.commandWatchdogs.delete(itemId);
      if (turn.closed || this.activeTurn !== turn) return;
      this.commandWatchdogFired = true;
      this.pushTurnEvent({
        type: 'tool-result',
        toolId: itemId,
        output:
          `命令执行超过 ${Math.round(COMMAND_SILENCE_TIMEOUT_MS / 1000)} 秒无任何输出，已中断本轮。` +
          '已知问题：codex CLI 0.147 在 Windows 上执行命令可能永久挂起（与沙箱/审批设置无关）。' +
          '建议：降级 codex 到 0.145（npm i -g @openai/codex@0.145.0 或官方安装器旧版），或改用 claude-code / 原生内核执行命令。',
        isError: true,
      });
      void this.request('turn/interrupt', {
        threadId: turn.threadId,
        ...(turn.turnId ? { turnId: turn.turnId } : {}),
      }).catch(() => undefined);
    }, COMMAND_SILENCE_TIMEOUT_MS);
    // Do not keep the process alive solely for a watchdog.
    timer.unref?.();
    turn.commandWatchdogs.set(itemId, timer);
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
    for (const timer of turn.commandWatchdogs.values()) clearTimeout(timer);
    turn.commandWatchdogs.clear();
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
