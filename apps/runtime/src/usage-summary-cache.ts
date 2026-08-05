import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { openDatabaseAsync, type BetterSQLite3Raw } from '@sync-think/storage';
import type { ProviderUsagePurpose } from '@sync-think/shared';

export const USAGE_SUMMARY_CACHE_VERSION = 2 as const;

export interface UsageSummaryRawResult {
  rows: Array<{
    modelId: string;
    providerId?: string;
    requests: number;
    succeededRequests: number;
    failedRequests: number;
    tokensIn: number;
    tokensOut: number;
    cachedTokensHit?: number;
    cachedTokensCreated?: number;
    reasoningTokens: number;
    totalTokens: number;
    averageLatencyMs?: number;
    lastUsedAt?: string;
  }>;
  requests: Array<{
    requestId: string;
    taskId?: string;
    runId?: string;
    stepId?: string;
    agentContextThreadId?: string;
    contextEpochId?: string;
    occurredAt: string;
    modelId: string;
    providerId?: string;
    providerModelId?: string;
    purpose?: ProviderUsagePurpose;
    tokensIn: number;
    tokensOut: number;
    cachedTokensHit?: number;
    cachedTokensCreated?: number;
    reasoningTokens?: number;
    totalTokens: number;
    status: 'success' | 'failed' | 'unknown';
    latencyMs?: number;
    errorMessage?: string;
  }>;
  tools: Array<{
    toolName: string;
    calls: number;
    successes: number;
    failures: number;
    successRate: number;
    lastUsedAt?: string;
  }>;
  toolModels: Array<{
    modelId: string;
    providerId?: string;
    calls: number;
    successes: number;
    failures: number;
    successRate: number;
  }>;
  toolFailures: Array<{
    occurredAt: string;
    toolName: string;
    modelId?: string;
    conversationTitle?: string;
    errorSummary: string;
  }>;
}

interface UsageFactBase {
  rowid: number;
  eventId: string;
  occurredAt: string;
}

export interface UsageEventFact extends UsageFactBase {
  kind: 'usage';
  requestId: string;
  taskId?: string;
  runId?: string;
  stepId?: string;
  modelId: string;
  providerId?: string;
  providerModelId?: string;
  agentContextThreadId?: string;
  contextEpochId?: string;
  purpose?: ProviderUsagePurpose;
  tokensIn: number;
  tokensOut: number;
  cachedTokensHit?: number;
  cachedTokensCreated?: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface RunTerminalFact extends UsageFactBase {
  kind: 'run-terminal';
  runId: string;
  terminal: 'completed' | 'failed';
  errorMessage?: string;
}

export interface ToolRequestFact extends UsageFactBase {
  kind: 'tool-request';
  runId?: string;
  toolCallId: string;
  toolName: string;
  modelId?: string;
  providerId?: string;
}

export interface ToolTerminalFact extends UsageFactBase {
  kind: 'tool-terminal';
  runId?: string;
  threadId?: string;
  toolCallId: string;
  failed: boolean;
  errorSummary?: string;
  conversationTitle?: string;
}

export type UsageSummaryFact =
  UsageEventFact | RunTerminalFact | ToolRequestFact | ToolTerminalFact;

export interface UsageSummaryHighWater {
  rowid: number;
  eventId: string;
  sequence: number;
}

export interface UsageSummaryCacheSnapshot {
  version: typeof USAGE_SUMMARY_CACHE_VERSION;
  highWater: UsageSummaryHighWater | null;
  facts: UsageSummaryFact[];
}

interface EventScanRow {
  event_rowid: number;
  id: string;
  task_id: string | null;
  run_id: string | null;
  step_id: string | null;
  type: string;
  occurred_at: string;
  payload_json: string;
}

interface RefreshSnapshotOptions {
  onScanRange?: (afterRowid: number, throughRowid: number) => void;
}

interface UsageSummarySnapshotLoaderInput {
  databasePath: string;
  cachePath: string;
}

export interface UsageSummaryQueryServiceOptions extends UsageSummarySnapshotLoaderInput {
  snapshotLoader?: (input: UsageSummarySnapshotLoaderInput) => Promise<UsageSummaryCacheSnapshot>;
}

interface UsageSummaryWorkerData extends UsageSummarySnapshotLoaderInput {
  kind: 'usage-summary-refresh';
}

interface UsageSummaryWorkerResponse {
  ok: boolean;
  snapshot?: UsageSummaryCacheSnapshot;
  error?: string;
}

const RELEVANT_EVENT_TYPES = [
  'provider.usage',
  'run.completed',
  'run.failed',
  'tool.requested',
  'tool.completed',
  'tool.failed',
] as const;

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberOrZero(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function projectUsageFact(row: EventScanRow): UsageEventFact | undefined {
  const payload = parseJsonObject(row.payload_json) ?? {};
  const run = parseJsonObject(payload.run);
  const modelId = optionalString(payload.modelId);
  if (!modelId) return undefined;
  return {
    kind: 'usage',
    rowid: row.event_rowid,
    eventId: row.id,
    occurredAt: row.occurred_at,
    // A packet spans the whole tool loop, not one provider request. Legacy rows
    // without requestId must remain distinct instead of being merged by packetId.
    requestId: String(payload.requestId ?? row.id),
    taskId: row.task_id ?? undefined,
    runId: row.run_id ?? undefined,
    stepId: row.step_id ?? undefined,
    modelId,
    providerId: optionalString(payload.providerId) ?? optionalString(run?.providerId),
    providerModelId: optionalString(payload.providerModelId),
    agentContextThreadId: optionalString(payload.agentContextThreadId),
    contextEpochId: optionalString(payload.contextEpochId),
    purpose: optionalString(payload.purpose) as ProviderUsagePurpose | undefined,
    tokensIn: numberOrZero(payload.tokensIn),
    tokensOut: numberOrZero(payload.tokensOut),
    cachedTokensHit: optionalNumber(payload.cachedTokensHit),
    cachedTokensCreated: optionalNumber(payload.cachedTokensCreated),
    reasoningTokens: numberOrZero(payload.reasoningTokens),
    totalTokens: numberOrZero(payload.totalTokens),
  };
}

function projectRunTerminalFact(row: EventScanRow): RunTerminalFact | undefined {
  if (!row.run_id) return undefined;
  const payload = parseJsonObject(row.payload_json) ?? {};
  return {
    kind: 'run-terminal',
    rowid: row.event_rowid,
    eventId: row.id,
    occurredAt: row.occurred_at,
    runId: row.run_id,
    terminal: row.type === 'run.failed' ? 'failed' : 'completed',
    errorMessage: row.type === 'run.failed' ? optionalString(payload.errorMessage) : undefined,
  };
}

function projectToolRequestFact(row: EventScanRow): ToolRequestFact | undefined {
  const payload = parseJsonObject(row.payload_json) ?? {};
  const toolCall = parseJsonObject(payload.toolCall);
  const run = parseJsonObject(payload.run);
  const toolCallId = String(payload.toolCallId ?? toolCall?.id ?? '');
  if (!toolCallId) return undefined;
  return {
    kind: 'tool-request',
    rowid: row.event_rowid,
    eventId: row.id,
    occurredAt: row.occurred_at,
    runId: row.run_id ?? undefined,
    toolCallId,
    toolName: String(payload.toolName ?? toolCall?.name ?? 'unknown'),
    modelId: optionalString(run?.modelId),
    providerId: optionalString(run?.providerId),
  };
}

function projectToolTerminalFact(row: EventScanRow): ToolTerminalFact | undefined {
  const payload = parseJsonObject(row.payload_json) ?? {};
  const toolCallId = optionalString(payload.toolCallId);
  if (!toolCallId) return undefined;
  const result = parseJsonObject(payload.result);
  const rawResult = typeof payload.result === 'string' ? payload.result : '';
  const failed =
    row.type === 'tool.failed' ||
    payload.failed === true ||
    result?.ok === false ||
    /<tool_use_error>|tool execution failed/i.test(rawResult);
  const rawError =
    optionalString(payload.errorSummary) ??
    optionalString(result?.error) ??
    (failed ? rawResult : undefined);
  return {
    kind: 'tool-terminal',
    rowid: row.event_rowid,
    eventId: row.id,
    occurredAt: row.occurred_at,
    runId: row.run_id ?? undefined,
    threadId: optionalString(payload.threadId),
    toolCallId,
    failed,
    errorSummary: rawError?.slice(0, 500),
  };
}

function projectFact(row: EventScanRow): UsageSummaryFact | undefined {
  switch (row.type) {
    case 'provider.usage':
      return projectUsageFact(row);
    case 'run.completed':
    case 'run.failed':
      return projectRunTerminalFact(row);
    case 'tool.requested':
      return projectToolRequestFact(row);
    case 'tool.completed':
    case 'tool.failed':
      return projectToolTerminalFact(row);
    default:
      return undefined;
  }
}

function readMaximumRowid(raw: BetterSQLite3Raw): number {
  const row = raw.prepare('SELECT MAX(rowid) AS maximum_rowid FROM event').get() as {
    maximum_rowid: number | null;
  };
  return row.maximum_rowid ?? 0;
}

function readHighWater(raw: BetterSQLite3Raw, rowid: number): UsageSummaryHighWater | null {
  if (rowid <= 0) return null;
  const row = raw.prepare('SELECT rowid, id, sequence FROM event WHERE rowid = ?').get(rowid) as
    { rowid: number; id: string; sequence: number } | undefined;
  return row ? { rowid: row.rowid, eventId: row.id, sequence: row.sequence } : null;
}

function cacheFenceMatches(
  raw: BetterSQLite3Raw,
  snapshot: UsageSummaryCacheSnapshot,
  maximumRowid: number,
): boolean {
  if (!snapshot.highWater) return maximumRowid === 0 && snapshot.facts.length === 0;
  if (snapshot.highWater.rowid > maximumRowid) return false;
  const persisted = readHighWater(raw, snapshot.highWater.rowid);
  return (
    persisted?.eventId === snapshot.highWater.eventId &&
    persisted.sequence === snapshot.highWater.sequence
  );
}

function tableExists(raw: BetterSQLite3Raw, name: string): boolean {
  return Boolean(
    raw.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name),
  );
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function queryPairs(
  raw: BetterSQLite3Raw,
  table: 'run' | 'thread',
  ids: readonly string[],
): Map<string, string> {
  const result = new Map<string, string>();
  if (ids.length === 0 || !tableExists(raw, table)) return result;
  for (const batch of chunks([...new Set(ids)], 500)) {
    const placeholders = batch.map(() => '?').join(',');
    const rows = raw
      .prepare(`SELECT id, task_id FROM ${table} WHERE id IN (${placeholders})`)
      .all(...batch) as Array<{ id: string; task_id: string }>;
    for (const row of rows) result.set(row.id, row.task_id);
  }
  return result;
}

function queryConversationTitles(
  raw: BetterSQLite3Raw,
  taskIds: readonly string[],
): Map<string, string> {
  const result = new Map<string, string>();
  if (taskIds.length === 0 || !tableExists(raw, 'conversation')) return result;
  for (const batch of chunks([...new Set(taskIds)], 500)) {
    const placeholders = batch.map(() => '?').join(',');
    const rows = raw
      .prepare(
        `SELECT task_id, title
         FROM conversation
         WHERE task_id IN (${placeholders})
         ORDER BY rowid`,
      )
      .all(...batch) as Array<{ task_id: string | null; title: string }>;
    for (const row of rows) {
      if (row.task_id && !result.has(row.task_id)) result.set(row.task_id, row.title);
    }
  }
  return result;
}

function refreshConversationTitles(
  raw: BetterSQLite3Raw,
  facts: UsageSummaryFact[],
): UsageSummaryFact[] {
  const terminals = facts.filter((fact): fact is ToolTerminalFact => fact.kind === 'tool-terminal');
  const runTaskIds = queryPairs(
    raw,
    'run',
    terminals.flatMap((fact) => (fact.runId ? [fact.runId] : [])),
  );
  const threadTaskIds = queryPairs(
    raw,
    'thread',
    terminals.flatMap((fact) => (fact.threadId ? [fact.threadId] : [])),
  );
  const taskIds = terminals.flatMap((fact) => {
    const taskId =
      (fact.runId ? runTaskIds.get(fact.runId) : undefined) ??
      (fact.threadId ? threadTaskIds.get(fact.threadId) : undefined);
    return taskId ? [taskId] : [];
  });
  const titles = queryConversationTitles(raw, taskIds);
  return facts.map((fact) => {
    if (fact.kind !== 'tool-terminal') return fact;
    const taskId =
      (fact.runId ? runTaskIds.get(fact.runId) : undefined) ??
      (fact.threadId ? threadTaskIds.get(fact.threadId) : undefined);
    return {
      ...fact,
      conversationTitle: taskId ? titles.get(taskId) : undefined,
    };
  });
}

export function refreshUsageSummarySnapshotFromDatabase(
  raw: BetterSQLite3Raw,
  previous?: UsageSummaryCacheSnapshot,
  options: RefreshSnapshotOptions = {},
): UsageSummaryCacheSnapshot {
  const maximumRowid = readMaximumRowid(raw);
  const reusable =
    previous && cacheFenceMatches(raw, previous, maximumRowid) ? previous : undefined;
  const afterRowid = reusable?.highWater?.rowid ?? 0;
  const facts = reusable ? [...reusable.facts] : [];

  if (maximumRowid > afterRowid) {
    options.onScanRange?.(afterRowid, maximumRowid);
    const placeholders = RELEVANT_EVENT_TYPES.map(() => '?').join(',');
    const rows = raw
      .prepare(
        `SELECT rowid AS event_rowid, id, task_id, run_id, step_id, type, occurred_at, payload_json
         FROM event
         WHERE rowid > ?
           AND rowid <= ?
           AND type IN (${placeholders})
         ORDER BY rowid`,
      )
      .iterate(afterRowid, maximumRowid, ...RELEVANT_EVENT_TYPES) as IterableIterator<EventScanRow>;
    for (const row of rows) {
      const fact = projectFact(row);
      if (fact) facts.push(fact);
    }
  }

  return {
    version: USAGE_SUMMARY_CACHE_VERSION,
    highWater: readHighWater(raw, maximumRowid),
    facts: refreshConversationTitles(raw, facts),
  };
}

function maxOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

export function summarizeUsageSnapshot(
  snapshot: UsageSummaryCacheSnapshot,
  sinceIso?: string,
): UsageSummaryRawResult {
  const included = (fact: UsageSummaryFact) => !sinceIso || fact.occurredAt >= sinceIso;
  const usageGroups = new Map<
    string,
    {
      requestId: string;
      taskId?: string;
      runId?: string;
      stepId?: string;
      modelId: string;
      providerId?: string;
      providerModelId?: string;
      agentContextThreadId?: string;
      contextEpochId?: string;
      purpose?: ProviderUsagePurpose;
      tokensIn: number;
      tokensOut: number;
      cachedTokensHit?: number;
      cachedTokensCreated?: number;
      reasoningTokens: number;
      totalTokens: number;
      startedAt: string;
      usageAt: string;
    }
  >();
  for (const fact of snapshot.facts) {
    if (fact.kind !== 'usage' || !included(fact)) continue;
    const key = JSON.stringify([
      fact.requestId,
      fact.taskId ?? null,
      fact.runId ?? null,
      fact.stepId ?? null,
      fact.modelId,
      fact.providerId ?? null,
      fact.providerModelId ?? null,
      fact.agentContextThreadId ?? null,
      fact.contextEpochId ?? null,
      fact.purpose ?? null,
    ]);
    const current = usageGroups.get(key);
    if (!current) {
      usageGroups.set(key, {
        ...fact,
        startedAt: fact.occurredAt,
        usageAt: fact.occurredAt,
      });
      continue;
    }
    current.tokensIn = Math.max(current.tokensIn, fact.tokensIn);
    current.tokensOut = Math.max(current.tokensOut, fact.tokensOut);
    current.cachedTokensHit = maxOptional(current.cachedTokensHit, fact.cachedTokensHit);
    current.cachedTokensCreated = maxOptional(
      current.cachedTokensCreated,
      fact.cachedTokensCreated,
    );
    current.reasoningTokens = Math.max(current.reasoningTokens, fact.reasoningTokens);
    current.totalTokens = Math.max(current.totalTokens, fact.totalTokens);
    if (fact.occurredAt < current.startedAt) current.startedAt = fact.occurredAt;
    if (fact.occurredAt > current.usageAt) current.usageAt = fact.occurredAt;
  }

  const terminalByRun = new Map<
    string,
    { completedAt?: string; failedAt?: string; errorMessage?: string }
  >();
  for (const fact of snapshot.facts) {
    if (fact.kind !== 'run-terminal' || !included(fact)) continue;
    const current = terminalByRun.get(fact.runId) ?? {};
    if (fact.terminal === 'completed') {
      if (!current.completedAt || fact.occurredAt > current.completedAt) {
        current.completedAt = fact.occurredAt;
      }
    } else {
      if (!current.failedAt || fact.occurredAt > current.failedAt) {
        current.failedAt = fact.occurredAt;
      }
      if (
        fact.errorMessage &&
        (!current.errorMessage || fact.errorMessage > current.errorMessage)
      ) {
        current.errorMessage = fact.errorMessage;
      }
    }
    terminalByRun.set(fact.runId, current);
  }

  const requests: UsageSummaryRawResult['requests'] = Array.from(usageGroups.values())
    .map((usage) => {
      const terminal = usage.runId ? terminalByRun.get(usage.runId) : undefined;
      const terminalAt = terminal?.completedAt ?? terminal?.failedAt;
      const startMs = Date.parse(usage.startedAt);
      const endMs = terminalAt ? Date.parse(terminalAt) : Number.NaN;
      return {
        requestId: usage.requestId,
        taskId: usage.taskId,
        runId: usage.runId,
        stepId: usage.stepId,
        agentContextThreadId: usage.agentContextThreadId,
        contextEpochId: usage.contextEpochId,
        occurredAt: usage.usageAt,
        modelId: usage.modelId,
        providerId: usage.providerId,
        providerModelId: usage.providerModelId,
        purpose: usage.purpose,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        cachedTokensHit: usage.cachedTokensHit,
        cachedTokensCreated: usage.cachedTokensCreated,
        reasoningTokens: usage.reasoningTokens || undefined,
        totalTokens: usage.totalTokens || usage.tokensIn + usage.tokensOut,
        status: terminal?.failedAt
          ? ('failed' as const)
          : terminal?.completedAt
            ? ('success' as const)
            : ('unknown' as const),
        latencyMs:
          Number.isFinite(startMs) && Number.isFinite(endMs)
            ? Math.max(0, endMs - startMs)
            : undefined,
        errorMessage: terminal?.errorMessage,
      };
    })
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

  const byModel = new Map<
    string,
    UsageSummaryRawResult['rows'][number] & {
      latencyTotalMs: number;
      latencySamples: number;
    }
  >();
  for (const request of requests) {
    const key = `${request.providerId ?? ''}|${request.modelId}`;
    const current = byModel.get(key) ?? {
      modelId: request.modelId,
      providerId: request.providerId,
      requests: 0,
      succeededRequests: 0,
      failedRequests: 0,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokensHit: undefined,
      cachedTokensCreated: undefined,
      reasoningTokens: 0,
      totalTokens: 0,
      latencyTotalMs: 0,
      latencySamples: 0,
      lastUsedAt: request.occurredAt,
    };
    current.requests += 1;
    if (request.status === 'success') current.succeededRequests += 1;
    if (request.status === 'failed') current.failedRequests += 1;
    current.tokensIn += request.tokensIn;
    current.tokensOut += request.tokensOut;
    if (request.cachedTokensHit !== undefined) {
      current.cachedTokensHit = (current.cachedTokensHit ?? 0) + request.cachedTokensHit;
    }
    if (request.cachedTokensCreated !== undefined) {
      current.cachedTokensCreated =
        (current.cachedTokensCreated ?? 0) + request.cachedTokensCreated;
    }
    current.reasoningTokens += request.reasoningTokens ?? 0;
    current.totalTokens += request.totalTokens;
    if (typeof request.latencyMs === 'number') {
      current.latencyTotalMs += request.latencyMs;
      current.latencySamples += 1;
      current.averageLatencyMs = current.latencyTotalMs / current.latencySamples;
    }
    if (!current.lastUsedAt || request.occurredAt > current.lastUsedAt) {
      current.lastUsedAt = request.occurredAt;
    }
    byModel.set(key, current);
  }

  const toolRequests = snapshot.facts
    .filter((fact): fact is ToolRequestFact => fact.kind === 'tool-request' && included(fact))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const toolTerminals = snapshot.facts
    .filter((fact): fact is ToolTerminalFact => fact.kind === 'tool-terminal' && included(fact))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const requestByCall = new Map<string, ToolRequestFact>();
  for (const request of toolRequests) {
    requestByCall.set(`${request.runId ?? ''}\0${request.toolCallId}`, request);
  }
  const terminalByCall = new Map<string, ToolTerminalFact>();
  for (const terminal of toolTerminals) {
    terminalByCall.set(`${terminal.runId ?? ''}\0${terminal.toolCallId}`, terminal);
  }

  const toolStats = new Map<string, Omit<UsageSummaryRawResult['tools'][number], 'successRate'>>();
  const toolModelStats = new Map<
    string,
    Omit<UsageSummaryRawResult['toolModels'][number], 'successRate'>
  >();
  const toolFailures: UsageSummaryRawResult['toolFailures'] = [];
  for (const [key, request] of requestByCall) {
    const terminal = terminalByCall.get(key);
    const stats = toolStats.get(request.toolName) ?? {
      toolName: request.toolName,
      calls: 0,
      successes: 0,
      failures: 0,
      lastUsedAt: request.occurredAt,
    };
    stats.calls += 1;
    if (terminal?.failed) stats.failures += 1;
    else if (terminal) stats.successes += 1;
    if (!stats.lastUsedAt || request.occurredAt > stats.lastUsedAt) {
      stats.lastUsedAt = request.occurredAt;
    }
    toolStats.set(request.toolName, stats);

    if (request.modelId) {
      const modelStats = toolModelStats.get(request.modelId) ?? {
        modelId: request.modelId,
        providerId: request.providerId,
        calls: 0,
        successes: 0,
        failures: 0,
      };
      modelStats.calls += 1;
      if (terminal?.failed) modelStats.failures += 1;
      else if (terminal) modelStats.successes += 1;
      toolModelStats.set(request.modelId, modelStats);
    }
    if (terminal?.failed) {
      toolFailures.push({
        occurredAt: terminal.occurredAt,
        toolName: request.toolName,
        modelId: request.modelId,
        conversationTitle: terminal.conversationTitle,
        errorSummary: terminal.errorSummary || '工具调用失败',
      });
    }
  }

  return {
    rows: Array.from(byModel.values())
      .map(({ latencyTotalMs: _latencyTotalMs, latencySamples: _latencySamples, ...row }) => row)
      .sort((left, right) => right.tokensOut - left.tokensOut),
    requests,
    tools: Array.from(toolStats.values())
      .map((row) => ({
        ...row,
        successRate: row.calls > 0 ? (row.successes / row.calls) * 100 : 0,
      }))
      .sort((left, right) => right.calls - left.calls),
    toolModels: Array.from(toolModelStats.values())
      .map((row) => ({
        ...row,
        successRate: row.calls > 0 ? (row.successes / row.calls) * 100 : 0,
      }))
      .sort((left, right) => right.calls - left.calls),
    toolFailures: toolFailures
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 200),
  };
}

function isHighWater(value: unknown): value is UsageSummaryHighWater {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<UsageSummaryHighWater>;
  return (
    Number.isSafeInteger(record.rowid) &&
    (record.rowid ?? 0) > 0 &&
    typeof record.eventId === 'string' &&
    record.eventId.length > 0 &&
    Number.isSafeInteger(record.sequence)
  );
}

function isFact(value: unknown): value is UsageSummaryFact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fact = value as Partial<UsageSummaryFact>;
  if (
    !Number.isSafeInteger(fact.rowid) ||
    (fact.rowid ?? 0) <= 0 ||
    typeof fact.eventId !== 'string' ||
    typeof fact.occurredAt !== 'string'
  ) {
    return false;
  }
  switch (fact.kind) {
    case 'usage':
      return (
        typeof fact.requestId === 'string' &&
        typeof fact.modelId === 'string' &&
        typeof fact.tokensIn === 'number' &&
        typeof fact.tokensOut === 'number' &&
        typeof fact.reasoningTokens === 'number' &&
        typeof fact.totalTokens === 'number'
      );
    case 'run-terminal':
      return (
        typeof fact.runId === 'string' &&
        (fact.terminal === 'completed' || fact.terminal === 'failed')
      );
    case 'tool-request':
      return typeof fact.toolCallId === 'string' && typeof fact.toolName === 'string';
    case 'tool-terminal':
      return typeof fact.toolCallId === 'string' && typeof fact.failed === 'boolean';
    default:
      return false;
  }
}

export function readUsageSummaryCache(path: string): UsageSummaryCacheSnapshot | undefined {
  const absolute = resolve(path);
  if (!existsSync(absolute)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const snapshot = parsed as Partial<UsageSummaryCacheSnapshot>;
    if (
      snapshot.version !== USAGE_SUMMARY_CACHE_VERSION ||
      (snapshot.highWater !== null && !isHighWater(snapshot.highWater)) ||
      !Array.isArray(snapshot.facts) ||
      !snapshot.facts.every(isFact)
    ) {
      return undefined;
    }
    return snapshot as UsageSummaryCacheSnapshot;
  } catch {
    return undefined;
  }
}

export function writeUsageSummaryCache(path: string, snapshot: UsageSummaryCacheSnapshot): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(snapshot)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  try {
    try {
      renameSync(temporary, absolute);
    } catch (error) {
      if (!existsSync(absolute)) throw error;
      unlinkSync(absolute);
      renameSync(temporary, absolute);
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

async function refreshUsageSummarySnapshotFromFiles(
  input: UsageSummarySnapshotLoaderInput,
): Promise<UsageSummaryCacheSnapshot> {
  const connection = await openDatabaseAsync({
    path: input.databasePath,
    readonly: true,
    fileMustExist: true,
  });
  try {
    const queryOnly = connection.raw.pragma('query_only', { simple: true });
    if (Number(queryOnly) !== 1) {
      throw new Error('Usage summary worker database must be query-only');
    }
    const snapshot = refreshUsageSummarySnapshotFromDatabase(
      connection.raw,
      readUsageSummaryCache(input.cachePath),
    );
    writeUsageSummaryCache(input.cachePath, snapshot);
    return snapshot;
  } finally {
    connection.raw.close();
  }
}

function isWorkerRequest(value: unknown): value is UsageSummaryWorkerData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Partial<UsageSummaryWorkerData>;
  return (
    request.kind === 'usage-summary-refresh' &&
    typeof request.databasePath === 'string' &&
    typeof request.cachePath === 'string'
  );
}

export function loadUsageSummarySnapshotInWorker(
  input: UsageSummarySnapshotLoaderInput,
): Promise<UsageSummaryCacheSnapshot> {
  return new Promise((resolveSnapshot, rejectSnapshot) => {
    const moduleUrl = new URL(import.meta.url);
    const tsxApiUrl = moduleUrl.pathname.endsWith('.ts')
      ? pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm/api')).href
      : undefined;
    const workerUrl = moduleUrl.pathname.endsWith('.ts')
      ? new URL(
          `data:text/javascript,${encodeURIComponent(
            `import api from ${JSON.stringify(
              tsxApiUrl,
            )}; await api.tsImport(${JSON.stringify(moduleUrl.href)}, import.meta.url);`,
          )}`,
        )
      : moduleUrl;
    const worker = new Worker(workerUrl, {
      workerData: { kind: 'usage-summary-refresh', ...input } satisfies UsageSummaryWorkerData,
    });
    let settled = false;
    const settleError = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectSnapshot(error);
    };
    worker.once('message', (message: UsageSummaryWorkerResponse) => {
      if (settled) return;
      if (!message.ok || !message.snapshot) {
        settleError(new Error(message.error ?? 'Usage summary worker failed'));
        return;
      }
      settled = true;
      resolveSnapshot(message.snapshot);
    });
    worker.once('error', settleError);
    worker.once('exit', (code) => {
      if (!settled) {
        settleError(
          new Error(`Usage summary worker exited with code ${code} before returning a snapshot`),
        );
      }
    });
  });
}

export class UsageSummaryQueryService {
  private readonly snapshotLoader: (
    input: UsageSummarySnapshotLoaderInput,
  ) => Promise<UsageSummaryCacheSnapshot>;
  private refreshPromise: Promise<UsageSummaryCacheSnapshot> | undefined;

  constructor(private readonly options: UsageSummaryQueryServiceOptions) {
    this.snapshotLoader = options.snapshotLoader ?? loadUsageSummarySnapshotInWorker;
  }

  async query(sinceIso?: string): Promise<UsageSummaryRawResult> {
    const snapshot = await this.refresh();
    return summarizeUsageSnapshot(snapshot, sinceIso);
  }

  private refresh(): Promise<UsageSummaryCacheSnapshot> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.snapshotLoader({
        databasePath: this.options.databasePath,
        cachePath: this.options.cachePath,
      }).finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return this.refreshPromise;
  }
}

if (!isMainThread && isWorkerRequest(workerData)) {
  void refreshUsageSummarySnapshotFromFiles(workerData)
    .then((snapshot) => {
      parentPort?.postMessage({ ok: true, snapshot } satisfies UsageSummaryWorkerResponse);
    })
    .catch((error: unknown) => {
      parentPort?.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies UsageSummaryWorkerResponse);
    });
}
