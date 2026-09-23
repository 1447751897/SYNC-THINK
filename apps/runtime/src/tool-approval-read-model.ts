import type { Event, RunId, ThreadId } from '@sync-think/shared';
import type { PendingToolApprovalSummary, ToolApprovalScope } from '@sync-think/protocol';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseToolApprovalScope(value: unknown): ToolApprovalScope {
  return value === 'session' || value === 'always-app' ? value : 'once';
}

export function pendingToolApprovalSummaryFromEvent(
  event: Event,
): PendingToolApprovalSummary | undefined {
  const payload = event.payload ?? {};
  const approvalId = typeof payload.approvalId === 'string' ? payload.approvalId : undefined;
  const threadId = typeof payload.threadId === 'string' ? payload.threadId : undefined;
  const runId = (typeof payload.runId === 'string' ? payload.runId : event.runId) ?? undefined;
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : undefined;
  if (!approvalId || !threadId || !runId || !toolName) return undefined;

  const argumentsValue = payload.arguments;
  const argumentsObject = isPlainRecord(argumentsValue) ? argumentsValue : undefined;
  const riskValue = payload.risk;
  const risk = isPlainRecord(riskValue)
    ? {
        level: typeof riskValue.level === 'string' ? riskValue.level : 'unknown',
        reasonCodes: Array.isArray(riskValue.reasonCodes)
          ? riskValue.reasonCodes.filter((item): item is string => typeof item === 'string')
          : [],
        ...(typeof riskValue.humanOnlyAction === 'string'
          ? { humanOnlyAction: riskValue.humanOnlyAction }
          : {}),
      }
    : undefined;
  const allowedScopes: ToolApprovalScope[] = Array.isArray(payload.allowedScopes)
    ? [...new Set(payload.allowedScopes.map(parseToolApprovalScope))]
    : ['once'];

  return {
    approvalId,
    threadId: threadId as PendingToolApprovalSummary['threadId'],
    runId: runId as RunId,
    ...(typeof payload.toolCallId === 'string' ? { toolCallId: payload.toolCallId } : {}),
    toolName,
    ...(argumentsObject ? { arguments: argumentsObject } : {}),
    title: typeof payload.title === 'string' && payload.title ? payload.title : toolName,
    detail: typeof payload.detail === 'string' && payload.detail ? payload.detail : '需要你的批准',
    ...(typeof payload.path === 'string' ? { path: payload.path } : {}),
    ...(typeof payload.command === 'string' ? { command: payload.command } : {}),
    ...(risk ? { risk } : {}),
    allowedScopes,
    status: 'pending',
    createdAt: event.occurredAt,
  };
}

export interface DurableToolApprovalState {
  requested: Event;
  decided?: Event;
}

export function rememberToolApprovalEvent(
  states: Map<string, DurableToolApprovalState>,
  event: Event,
): void {
  if (event.type !== 'tool.approval_requested' && event.type !== 'tool.approval_decided') return;
  const approvalId = event.payload.approvalId;
  if (typeof approvalId !== 'string' || !approvalId) return;
  const current = states.get(approvalId);
  if (event.type === 'tool.approval_requested') {
    states.set(approvalId, {
      requested: event,
      ...(current?.decided ? { decided: current.decided } : {}),
    });
  } else {
    states.set(approvalId, { requested: current?.requested ?? event, decided: event });
  }
}

export function projectToolApprovalStates(
  events: readonly Event[],
): Map<string, DurableToolApprovalState> {
  const states = new Map<string, DurableToolApprovalState>();
  const ordered = [...events].sort(
    (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
  );
  for (const event of ordered) rememberToolApprovalEvent(states, event);
  return states;
}

export function expiredToolApprovalSummary(
  state: DurableToolApprovalState,
): import('@sync-think/protocol').ExpiredToolApprovalSummary | undefined {
  const requested = state.requested;
  const decided = state.decided;
  if (
    requested.type !== 'tool.approval_requested' ||
    !decided ||
    decided.payload.decision !== 'deny' ||
    decided.payload.reason !== 'stale-approval'
  )
    return;
  const payload = requested.payload;
  const approvalId = payload.approvalId;
  const threadId = payload.threadId;
  const runId = requested.runId ?? payload.runId;
  const toolName = payload.toolName;
  if (
    typeof approvalId !== 'string' ||
    typeof threadId !== 'string' ||
    typeof runId !== 'string' ||
    typeof toolName !== 'string' ||
    decided.payload.approvalId !== approvalId ||
    (decided.payload.threadId !== undefined && decided.payload.threadId !== threadId) ||
    (decided.runId !== undefined && decided.runId !== runId)
  )
    return;
  const preview = (value: unknown, fallback: string, limit: number): string => {
    const text = typeof value === 'string' && value ? value : fallback;
    return text.length > limit ? text.slice(0, limit) + '…' : text;
  };
  return {
    approvalId,
    threadId: threadId as ThreadId,
    runId: runId as RunId,
    ...(typeof payload.toolCallId === 'string' ? { toolCallId: payload.toolCallId } : {}),
    toolName: preview(toolName, 'tool', 128),
    title: preview(payload.title, toolName, 160),
    detail: preview(payload.detail, '原运行已不再等待该审批', 512),
    status: 'expired',
    reason: 'stale-approval',
    expiredAt: decided.occurredAt,
  };
}
