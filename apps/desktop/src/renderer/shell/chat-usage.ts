import type { Event } from '@sync-think/shared';
import { isRunTerminalEventType } from './chat-stream.js';

export interface ConversationUsageMetrics {
  durationMs?: number;
  totalTokens: number;
  tokensIn: number;
  tokensOut: number;
  requestCount: number;
  /**
   * Context occupancy of the LAST provider request in the scope (totalInput +
   * output), not the billing cumulative. Tool loops re-send the growing prefix,
   * so tokensIn sums every request; this watermark is the honest occupancy.
   */
  contextWatermarkTokens?: number;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function eventThreadId(event: Event): string | undefined {
  if (typeof event.payload.threadId === 'string') return event.payload.threadId;
  const run =
    event.payload.run && typeof event.payload.run === 'object'
      ? (event.payload.run as Record<string, unknown>)
      : undefined;
  return typeof run?.threadId === 'string' ? run.threadId : undefined;
}

interface UsageScopeIndex {
  runScopes: Map<string, { taskId?: string; threadId?: string }>;
  taskIdByThreadId: Map<string, string>;
}

function buildUsageScopeIndex(events: readonly Event[]): UsageScopeIndex {
  const runScopes = new Map<string, { taskId?: string; threadId?: string }>();
  const taskIdByThreadId = new Map<string, string>();

  for (const event of events) {
    const taskId = event.taskId ? String(event.taskId) : undefined;
    const threadId = eventThreadId(event);
    if (taskId && threadId) taskIdByThreadId.set(threadId, taskId);
    if (!event.runId) continue;
    const runId = String(event.runId);
    const current = runScopes.get(runId) ?? {};
    runScopes.set(runId, {
      taskId: taskId ?? current.taskId,
      threadId: threadId ?? current.threadId,
    });
  }

  for (const [runId, scope] of runScopes) {
    if (!scope.taskId && scope.threadId) {
      const taskId = taskIdByThreadId.get(scope.threadId);
      if (taskId) runScopes.set(runId, { ...scope, taskId });
    }
  }

  return { runScopes, taskIdByThreadId };
}

function belongsToUsageScope(
  event: Event,
  threadId: string | undefined,
  taskId: string | undefined,
  index: UsageScopeIndex,
): boolean {
  if (!threadId && !taskId) return true;

  const runScope = event.runId ? index.runScopes.get(String(event.runId)) : undefined;
  const scopedThreadId = eventThreadId(event) ?? runScope?.threadId;
  const scopedTaskId =
    (event.taskId ? String(event.taskId) : undefined) ??
    runScope?.taskId ??
    (scopedThreadId ? index.taskIdByThreadId.get(scopedThreadId) : undefined);

  if (taskId) {
    if (scopedTaskId && scopedTaskId !== taskId) return false;
    if (!scopedTaskId && scopedThreadId !== threadId) return false;
  }
  if (threadId) {
    if (scopedThreadId && scopedThreadId !== threadId) return false;
    if (!scopedThreadId && scopedTaskId !== taskId) return false;
  }
  return true;
}

export function projectConversationUsageMetrics(input: {
  events: readonly Event[];
  threadId?: string;
  taskId?: string;
}): ConversationUsageMetrics {
  const scopeIndex = buildUsageScopeIndex(input.events);
  const usageByRequest = new Map<
    string,
    { tokensIn: number; tokensOut: number; totalTokens?: number }
  >();
  const usageRequestSequence = new Map<string, number>();
  let firstStart: number | undefined;
  let lastEnd: number | undefined;

  for (const event of input.events) {
    if (!belongsToUsageScope(event, input.threadId, input.taskId, scopeIndex)) continue;

    const occurredAt = Date.parse(event.occurredAt);
    if (event.type === 'run.started' && Number.isFinite(occurredAt)) {
      firstStart = firstStart === undefined ? occurredAt : Math.min(firstStart, occurredAt);
    }
    if (
      (event.type === 'provider.usage' || isRunTerminalEventType(event.type)) &&
      Number.isFinite(occurredAt)
    ) {
      lastEnd = lastEnd === undefined ? occurredAt : Math.max(lastEnd, occurredAt);
    }
    if (event.type !== 'provider.usage') continue;

    const requestId =
      typeof event.payload.requestId === 'string' && event.payload.requestId.length > 0
        ? event.payload.requestId
        : `event:${String(event.id)}`;
    const current = usageByRequest.get(requestId) ?? { tokensIn: 0, tokensOut: 0 };
    const tokensIn =
      nonNegativeNumber(event.payload.tokensIn) ??
      nonNegativeNumber(event.payload.inputTokens) ??
      0;
    const tokensOut =
      nonNegativeNumber(event.payload.tokensOut) ??
      nonNegativeNumber(event.payload.outputTokens) ??
      0;
    const totalTokens = nonNegativeNumber(event.payload.totalTokens);

    current.tokensIn = Math.max(current.tokensIn, tokensIn);
    current.tokensOut = Math.max(current.tokensOut, tokensOut);
    if (totalTokens !== undefined) {
      current.totalTokens =
        current.totalTokens === undefined
          ? totalTokens
          : Math.max(current.totalTokens, totalTokens);
    }
    usageByRequest.set(requestId, current);
    usageRequestSequence.set(
      requestId,
      Math.max(usageRequestSequence.get(requestId) ?? 0, event.sequence),
    );
  }

  // Context watermark: input tokens sent by the LAST request in scope. Keep
  // output separate so a shorter response cannot make context appear smaller.
  let contextWatermarkTokens: number | undefined;
  let lastRequestId: string | undefined;
  let lastRequestSequence = -1;
  for (const [requestId, sequence] of usageRequestSequence) {
    if (sequence > lastRequestSequence) {
      lastRequestSequence = sequence;
      lastRequestId = requestId;
    }
  }
  if (lastRequestId !== undefined) {
    const last = usageByRequest.get(lastRequestId);
    if (last) contextWatermarkTokens = last.tokensIn;
  }

  let tokensIn = 0;
  let tokensOut = 0;
  let totalTokens = 0;
  for (const usage of usageByRequest.values()) {
    tokensIn += usage.tokensIn;
    tokensOut += usage.tokensOut;
    totalTokens += usage.totalTokens ?? usage.tokensIn + usage.tokensOut;
  }

  const durationMs =
    firstStart !== undefined && lastEnd !== undefined && lastEnd >= firstStart
      ? lastEnd - firstStart
      : undefined;
  return {
    ...(durationMs !== undefined ? { durationMs } : {}),
    totalTokens,
    tokensIn,
    tokensOut,
    ...(contextWatermarkTokens !== undefined ? { contextWatermarkTokens } : {}),
    requestCount: usageByRequest.size,
  };
}
