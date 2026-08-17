/**
 * Open gateway lifecycle manager.
 *
 * Owns the single loopback listener, the per-run ticket table and the status the
 * settings section renders. The runtime holds one instance; `applySetting` is
 * idempotent so toggling the switch or editing the port converges without
 * leaking listeners.
 */
import {
  openGatewayBaseUrls,
  type GatewayLogsQuery,
  type GatewayLogsResponse,
  type GatewayRequestLogEntry,
  type OpenGatewaySetting,
  type OpenGatewayStatusResponse,
  type OpenGatewayUpstreamInfo,
} from '@sync-think/protocol';
import {
  GatewayPortInUseError,
  createExternalGatewayToken,
  startOpenGatewayServer,
  type OpenGatewayServer,
} from './server.js';
import {
  GatewayTicketRegistry,
  toGatewayUpstreamProtocol,
  type GatewayRoute,
  type GatewayRunUsage,
  type GatewayUpstreamProtocol,
} from './tickets.js';
import { resolveGatewayModelName, type GatewayCatalogEntry } from './model-resolver.js';

export interface OpenGatewayManagerDeps {
  /** Catalog snapshot for external-client model resolution. */
  listCatalog(): GatewayCatalogEntry[];
  /** Resolve the plaintext secret for a provider (external clients only). */
  resolveProviderSecret(providerId: string): Promise<string | undefined>;
  /** Durable Responses continuation state for resumable external kernels. */
  loadResponseContinuations?(
    scopeId: string,
  ): readonly (readonly [callId: string, responseId: string])[] | undefined;
  saveResponseContinuations?(
    scopeId: string,
    items: readonly (readonly [callId: string, responseId: string])[],
  ): void;
  removeResponseContinuations?(scopeId: string): void;
  onLog?(message: string): void;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

export class OpenGatewayManager {
  /** 审计日志环形缓冲上限（内存驻留，不落 DB）。 */
  static readonly MAX_AUDIT_LOGS = 500;
  readonly tickets: GatewayTicketRegistry;
  private server: OpenGatewayServer | undefined;
  private setting: OpenGatewaySetting = { enabled: false, port: 0 };
  private externalToken = createExternalGatewayToken();
  private failure: OpenGatewayStatusResponse['failure'];
  private failureDetail: string | undefined;
  /** Most recent ticket-based upstream (for the read-only settings line). */
  private lastUpstream: OpenGatewayUpstreamInfo | undefined;
  /** 审计日志：oldest-first 数组，listLogs 按最新在前返回。 */
  private readonly auditLogs: GatewayRequestLogEntry[] = [];
  /**
   * Secrets for external clients are cached per provider for the process
   * lifetime; the keyring lookup is async but routing is synchronous.
   */
  private readonly externalSecrets = new Map<string, string>();

  constructor(private readonly deps: OpenGatewayManagerDeps) {
    this.tickets = new GatewayTicketRegistry({
      load: (scopeId) => this.deps.loadResponseContinuations?.(scopeId),
      save: (scopeId, items) => this.deps.saveResponseContinuations?.(scopeId, items),
      remove: (scopeId) => this.deps.removeResponseContinuations?.(scopeId),
      onError: (operation, scopeId, error) => {
        const detail = error instanceof Error ? error.message : String(error);
        this.deps.onLog?.(
          `open gateway continuation ${operation} failed for ${scopeId}: ${detail}`,
        );
      },
    });
  }

  /** Converge to the requested setting (start / stop / rebind as needed). */
  async applySetting(setting: OpenGatewaySetting): Promise<void> {
    const portChanged = this.setting.port !== setting.port;
    this.setting = setting;
    if (!setting.enabled) {
      await this.stop();
      this.failure = 'disabled';
      this.failureDetail = undefined;
      return;
    }
    if (this.server && !portChanged) return;
    await this.stop();
    try {
      this.server = await startOpenGatewayServer({
        port: setting.port,
        externalToken: this.externalToken,
        resolveTicket: (key) => this.tickets.resolveWithRun(key),
        recordRunUsage: (runId, usage) => this.tickets.recordRunUsage(runId, usage),
        resolveContinuationItem: (scopeId, callId) =>
          this.tickets.resolveContinuationItem(scopeId, callId),
        recordContinuationItem: (scopeId, callId, itemId) =>
          this.tickets.recordContinuationItem(scopeId, callId, itemId),
        resolveModelName: (model) => this.resolveExternalModel(model),
        listModels: () => this.listCatalogModels(),
        onRequest: (entry) => this.recordAuditLog(entry),
        ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
        ...(this.deps.onLog ? { onLog: this.deps.onLog } : {}),
      });
      this.failure = undefined;
      this.failureDetail = undefined;
      this.deps.onLog?.(`open gateway listening on 127.0.0.1:${this.server.port}`);
    } catch (error) {
      this.server = undefined;
      if (error instanceof GatewayPortInUseError) {
        this.failure = 'port-in-use';
        this.failureDetail = `端口 ${setting.port} 已被占用，请在设置中改用其他端口。`;
      } else {
        this.failure = 'bind-failed';
        this.failureDetail = error instanceof Error ? error.message : '网关启动失败';
      }
      this.deps.onLog?.(`open gateway failed to start: ${this.failureDetail}`);
    }
  }

  /** true when a run with this upstream/kernel combination can use the gateway. */
  get running(): boolean {
    return this.server !== undefined;
  }

  /** Issue a per-run ticket; returns undefined when the gateway is not serving. */
  issueTicket(runId: string, route: GatewayRoute, kernelId?: string): string | undefined {
    if (!this.server) return undefined;
    const providerId = route.providerId ?? 'unknown';
    const providerName =
      this.deps.listCatalog().find((entry) => entry.providerId === providerId)?.providerName ??
      providerId;
    this.lastUpstream = {
      providerId,
      providerName,
      protocol: route.protocol,
      model: route.providerModelId,
    };
    return this.tickets.issue(runId, route, kernelId).id;
  }

  /**
   * Inbound base URL for a kernel that speaks `kernelProtocol`, regardless of
   * what the upstream speaks. This is the value injected as ANTHROPIC_BASE_URL
   * / OPENAI_BASE_URL.
   */
  inboundBaseUrl(kernelProtocol: GatewayUpstreamProtocol): string | undefined {
    if (!this.server) return undefined;
    const urls = openGatewayBaseUrls(this.server.host, this.server.port);
    return kernelProtocol === 'anthropic-messages' ? urls.anthropicBaseUrl : urls.openaiBaseUrl;
  }

  revokeRun(runId: string): void {
    this.tickets.revokeRun(runId);
  }

  consumeRunUsage(runId: string): GatewayRunUsage[] {
    return this.tickets.consumeRunUsage(runId);
  }

  clearResponseContinuationScope(scopeId: string): void {
    this.tickets.clearResponseFunctionItems(scopeId);
  }

  status(): OpenGatewayStatusResponse {
    const port = this.server?.port ?? this.setting.port;
    const base: OpenGatewayStatusResponse = {
      enabled: this.setting.enabled,
      running: this.server !== undefined,
      port,
      host: '127.0.0.1',
    };
    if (this.server) {
      const urls = openGatewayBaseUrls(this.server.host, this.server.port);
      base.anthropicBaseUrl = urls.anthropicBaseUrl;
      base.openaiBaseUrl = urls.openaiBaseUrl;
      base.modelsBaseUrl = `http://${this.server.host}:${this.server.port}/v1/models`;
      base.externalToken = this.externalToken;
    }
    if (this.lastUpstream) base.lastUpstream = this.lastUpstream;
    if (this.failure && this.failure !== 'disabled') {
      base.failure = this.failure;
      if (this.failureDetail) base.failureDetail = this.failureDetail;
    }
    return base;
  }

  /** Record one audited gateway request (newest kept at the tail, capped). */
  private recordAuditLog(entry: GatewayRequestLogEntry): void {
    this.auditLogs.push(entry);
    if (this.auditLogs.length > OpenGatewayManager.MAX_AUDIT_LOGS) {
      this.auditLogs.splice(0, this.auditLogs.length - OpenGatewayManager.MAX_AUDIT_LOGS);
    }
  }

  /** Page of audited requests, newest first (filtered when a filter is given). */
  listLogs(query: GatewayLogsQuery = {}): GatewayLogsResponse {
    const limit = Math.min(
      Math.max(Number.isInteger(query.limit) ? (query.limit as number) : 50, 1),
      200,
    );
    const offset = Math.max(Number.isInteger(query.offset) ? (query.offset as number) : 0, 0);
    const filter = query.filter;
    const filtered =
      filter && (filter.kernelId !== undefined || filter.status !== undefined || filter.converted !== undefined)
        ? this.auditLogs.filter((entry) => {
            if (filter.kernelId !== undefined && entry.kernelId !== filter.kernelId) return false;
            if (filter.status !== undefined && entry.status !== filter.status) return false;
            if (filter.converted !== undefined && entry.converted !== filter.converted) return false;
            return true;
          })
        : this.auditLogs;
    const total = filtered.length;
    const start = Math.max(total - offset - limit, 0);
    const entries = filtered.slice(start, start + limit).reverse();
    return { entries, total, hasMore: offset + limit < total };
  }

  /** Drop all audited requests. */
  clearLogs(): void {
    this.auditLogs.length = 0;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) await server.close();
  }

  /** Full teardown (runtime shutdown): stop listening and drop all tickets. */
  async dispose(): Promise<void> {
    await this.stop();
    this.tickets.clear();
    this.externalSecrets.clear();
  }

  /**
   * Warm the secret cache for every provider that can serve external clients.
   * Called after the setting is applied so synchronous routing has keys ready.
   */
  async warmExternalSecrets(): Promise<void> {
    const providerIds = new Set(this.deps.listCatalog().map((entry) => entry.providerId));
    for (const providerId of providerIds) {
      if (this.externalSecrets.has(providerId)) continue;
      try {
        const secret = await this.deps.resolveProviderSecret(providerId);
        if (secret) this.externalSecrets.set(providerId, secret);
      } catch {
        // A provider without a stored key simply cannot serve external clients.
      }
    }
  }

  private resolveExternalModel(model: string): GatewayRoute | undefined {
    const match = resolveGatewayModelName(model, this.deps.listCatalog());
    if (!match?.route.providerId) return undefined;
    const apiKey = this.externalSecrets.get(match.route.providerId);
    if (!apiKey) return undefined;
    if (match.shadowedBy.length > 0) {
      this.deps.onLog?.(
        `open gateway resolved "${model}" to provider ${match.route.providerId}; also present on ` +
          match.shadowedBy.map((entry) => entry.providerId).join(', '),
      );
    }
    return { ...match.route, apiKey };
  }

  /** Enabled, routable catalog models served by `GET /v1/models`. */
  private listCatalogModels(): Array<{ id: string; providerId?: string; providerName?: string }> {
    const seen = new Set<string>();
    const models: Array<{ id: string; providerId?: string; providerName?: string }> = [];
    for (const entry of this.deps.listCatalog()) {
      if (
        !entry.enabled ||
        toGatewayUpstreamProtocol(entry.protocol) === undefined ||
        entry.baseUrl.trim() === '' ||
        entry.providerModelId.trim() === ''
      ) {
        continue;
      }
      const id = entry.providerModelId;
      if (seen.has(id)) continue;
      seen.add(id);
      models.push({ id, providerId: entry.providerId, providerName: entry.providerName });
    }
    return models;
  }
}
