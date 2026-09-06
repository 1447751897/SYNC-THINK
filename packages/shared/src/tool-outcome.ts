import type { Event } from './types/event.js';
import { normalizeToolName } from './tool-name.js';

export function toolEventPhase(type: string): 'requested' | 'completed' | 'failed' | undefined {
  if (type.endsWith('.requested') || type === 'mcp.tool_requested') return 'requested';
  if (type.endsWith('.failed') || type === 'mcp.tool_failed' || type === 'mcp.tool_refused')
    return 'failed';
  if (type.endsWith('.completed') || type === 'mcp.tool_completed' || type === 'mcp.tool_called')
    return 'completed';
  return undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function failureFlags(value: unknown): boolean {
  const object = record(value);
  if (!object) return false;
  return (
    object.ok === false ||
    object.success === false ||
    object.failed === true ||
    object.isError === true ||
    (typeof object.exitCode === 'number' && object.exitCode !== 0) ||
    (typeof object.exit_code === 'number' && object.exit_code !== 0) ||
    (typeof object.status === 'string' &&
      ['failed', 'declined', 'denied', 'cancelled', 'canceled', 'error'].includes(
        object.status.toLowerCase(),
      ))
  );
}

export function isToolResultFailure(
  result: unknown,
  summary: { exitCode?: number } = {},
  payload: Record<string, unknown> = {},
): boolean {
  return (
    (typeof summary.exitCode === 'number' && summary.exitCode !== 0) ||
    payload.failed === true ||
    payload.isError === true ||
    failureFlags(result) ||
    failureFlags(payload.structuredResult)
  );
}

export interface DeniedToolCall {
  error: string;
  occurredAt: string;
  sequence: number;
}

function runScope(event: Event): unknown {
  return event.runId ?? event.payload.runId;
}

function sameScope(left: Event, right: Event): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    runScope(left) === runScope(right) &&
    (left.payload.threadId === undefined ||
      right.payload.threadId === undefined ||
      left.payload.threadId === right.payload.threadId)
  );
}

function callId(event: Event): string | undefined {
  const value =
    event.payload.toolCallId ?? record(event.payload.toolCall)?.id ?? event.payload.callId;
  return typeof value === 'string' && value ? value : undefined;
}

function toolName(event: Event): string {
  const payload = event.payload;
  const value = payload.toolName ?? payload.tool ?? payload.name ?? record(payload.toolCall)?.name;
  return typeof value === 'string' ? normalizeToolName(value).toLowerCase() : '';
}

function argumentsOf(event: Event): Record<string, unknown> | undefined {
  const payload = event.payload;
  const call = record(payload.toolCall);
  return record(
    payload.arguments ??
      payload.args ??
      payload.input ??
      payload.argumentsJson ??
      call?.argumentsJson ??
      call?.arguments,
  );
}

function exactArguments(value: Record<string, unknown> | undefined): string | undefined {
  if (!value) return undefined;
  try {
    if (JSON.stringify(value).length > 262144) return undefined;
    const serialized = JSON.stringify(value, (_key, entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
      return Object.fromEntries(
        Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)),
      );
    });
    return serialized.length <= 262144 ? serialized : undefined;
  } catch {
    return undefined;
  }
}

export function projectDeniedToolCalls(events: readonly Event[]): Map<string, DeniedToolCall> {
  const requests = new Map<string, Event>();
  const calls = new Map<string, Event>();
  const completed = new Map<string, number>();
  let signatures: Map<string, Event[]> | undefined;
  for (const event of events) {
    const phase = toolEventPhase(event.type);
    const id = callId(event);
    if (event.type === 'tool.approval_requested') {
      const approvalId = event.payload.approvalId;
      if (typeof approvalId === 'string') requests.set(approvalId, event);
    } else if (phase === 'requested' && id) {
      calls.set(id, event);
    } else if ((phase === 'completed' || phase === 'failed') && id) {
      completed.set(id, event.sequence);
    }
  }
  const outcomes = new Map<string, DeniedToolCall>();
  const decided = new Set<string>();
  for (const event of events) {
    if (event.type !== 'tool.approval_decided') continue;
    const approvalId = event.payload.approvalId;
    if (typeof approvalId !== 'string' || decided.has(approvalId)) continue;
    const request = requests.get(approvalId);
    if (!request || !sameScope(request, event) || request.sequence > event.sequence) continue;
    if (event.payload.decision !== 'approve' && event.payload.decision !== 'deny') continue;
    decided.add(approvalId);
    if (event.payload.decision !== 'deny') continue;
    const args = argumentsOf(request);
    const claimedId = callId(request);
    const nativeId = typeof args?.itemId === 'string' ? args.itemId : undefined;
    let matched: Event | undefined;
    for (const id of [claimedId, nativeId]) {
      const candidate = id ? calls.get(id) : undefined;
      if (candidate && sameScope(candidate, request) && toolName(candidate) === toolName(request)) {
        matched = candidate;
        break;
      }
    }
    if (!matched) {
      const serialized = exactArguments(args);
      if (serialized !== undefined) {
        if (!signatures) {
          signatures = new Map<string, Event[]>();
          for (const candidate of calls.values()) {
            const candidateArgs = exactArguments(argumentsOf(candidate));
            if (candidateArgs === undefined) continue;
            const signature = JSON.stringify([
              candidate.workspaceId,
              runScope(candidate),
              toolName(candidate),
              candidateArgs,
            ]);
            const matches = signatures.get(signature) ?? [];
            matches.push(candidate);
            signatures.set(signature, matches);
          }
        }
        const signature = JSON.stringify([
          request.workspaceId,
          runScope(request),
          toolName(request),
          serialized,
        ]);
        const candidates = (signatures.get(signature) ?? []).filter(
          (candidate) =>
            sameScope(candidate, request) &&
            candidate.sequence <= request.sequence &&
            (completed.get(callId(candidate)!) ?? Infinity) >= request.sequence,
        );
        if (candidates.length === 1) matched = candidates[0];
      }
    }
    const id = matched && callId(matched);
    if (!id) continue;
    const reason = event.payload.reason;
    outcomes.set(id, {
      error:
        reason === 'stale-approval'
          ? '审批已失效，此工具未获批准'
          : reason === 'run-cancelled' || reason === 'run-aborted'
            ? '运行已取消，此工具未获批准'
            : '用户已拒绝此工具操作',
      occurredAt: event.occurredAt,
      sequence: event.sequence,
    });
  }
  return outcomes;
}
