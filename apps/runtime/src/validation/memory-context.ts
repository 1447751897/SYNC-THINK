// memory-context command payload parsers (extracted from command-validation.ts).
import type { ListMemoryPayload, ProposeMemoryPayload, DecideMemoryPayload, RollbackMemoryPayload, ListDiagnosticsPayload, PeekContextPacketPayload, AmendContextPacketPayload } from '@sync-think/protocol';
import { isRecord, MEMORY_SCOPES, MEMORY_STATES, parseMemoryEntries } from './shared.js';

export function parseListMemoryPayload(value: unknown): ListMemoryPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (
    value.workspaceId !== undefined &&
    (typeof value.workspaceId !== 'string' || value.workspaceId.length > 128)
  ) {
    return undefined;
  }
  if (
    value.taskId !== undefined &&
    (typeof value.taskId !== 'string' || value.taskId.length > 128)
  ) {
    return undefined;
  }
  if (value.approvalState !== undefined && !MEMORY_STATES.has(String(value.approvalState))) {
    return undefined;
  }
  if (
    value.limit !== undefined &&
    (typeof value.limit !== 'number' || !Number.isFinite(value.limit))
  ) {
    return undefined;
  }
  return value as ListMemoryPayload;
}

export function parseProposeMemoryPayload(value: unknown): ProposeMemoryPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.taskId !== 'string' ||
    value.taskId.trim().length === 0 ||
    value.taskId.length > 128
  ) {
    return undefined;
  }
  if (
    value.workspaceId !== undefined &&
    (typeof value.workspaceId !== 'string' || value.workspaceId.length > 128)
  ) {
    return undefined;
  }
  if (value.targetScope !== undefined && !MEMORY_SCOPES.has(String(value.targetScope)))
    return undefined;
  if (!parseMemoryEntries(value.additions) || !parseMemoryEntries(value.modifications))
    return undefined;
  if (value.deprecations !== undefined) {
    if (!Array.isArray(value.deprecations) || value.deprecations.length > 64) return undefined;
    if (!value.deprecations.every((d) => typeof d === 'string' && d.length > 0 && d.length <= 128))
      return undefined;
  }
  if (value.evidenceRefs !== undefined) {
    if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length > 32) return undefined;
    if (!value.evidenceRefs.every((d) => typeof d === 'string')) return undefined;
  }
  if (
    value.confidence !== undefined &&
    (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence))
  ) {
    return undefined;
  }
  if (value.unresolvedAmbiguity !== undefined && typeof value.unresolvedAmbiguity !== 'string')
    return undefined;
  if (value.proposedByRunId !== undefined && typeof value.proposedByRunId !== 'string')
    return undefined;
  if (value.autoApprove !== undefined && typeof value.autoApprove !== 'boolean') return undefined;
  return value as unknown as ProposeMemoryPayload;
}

export function parseDecideMemoryPayload(value: unknown): DecideMemoryPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.changeId !== 'string' ||
    value.changeId.trim().length === 0 ||
    value.changeId.length > 128
  ) {
    return undefined;
  }
  if (value.decision !== 'approved' && value.decision !== 'rejected') return undefined;
  return value as unknown as DecideMemoryPayload;
}

export function parseRollbackMemoryPayload(value: unknown): RollbackMemoryPayload | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const changeId = (value as { changeId?: unknown }).changeId;
  if (typeof changeId !== 'string' || changeId.trim().length === 0) return undefined;
  return { changeId: changeId.trim() as RollbackMemoryPayload['changeId'] };
}

export function parseListDiagnosticsPayload(value: unknown): ListDiagnosticsPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (
    value.workspaceId !== undefined &&
    (typeof value.workspaceId !== 'string' || value.workspaceId.length > 128)
  ) {
    return undefined;
  }
  if (
    value.taskId !== undefined &&
    (typeof value.taskId !== 'string' || value.taskId.length > 128)
  ) {
    return undefined;
  }
  if (value.runId !== undefined && (typeof value.runId !== 'string' || value.runId.length > 128)) {
    return undefined;
  }
  if (
    value.limit !== undefined &&
    (typeof value.limit !== 'number' || !Number.isFinite(value.limit))
  ) {
    return undefined;
  }
  return value as ListDiagnosticsPayload;
}

export function parsePeekContextPacketPayload(
  value: unknown,
): PeekContextPacketPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.threadId !== 'string' ||
    value.threadId.length === 0 ||
    value.threadId.length > 256
  ) {
    return undefined;
  }
  for (const field of ['modelId', 'credentialRefId', 'agentVersionId', 'userText'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return undefined;
  }
  if (typeof value.userText === 'string' && value.userText.length > 100_000) return undefined;
  return value as unknown as PeekContextPacketPayload;
}

export function parseAmendContextPacketPayload(
  value: unknown,
): AmendContextPacketPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.threadId !== 'string' ||
    value.threadId.length === 0 ||
    value.threadId.length > 256
  ) {
    return undefined;
  }
  if (value.clearAll !== undefined && typeof value.clearAll !== 'boolean') return undefined;
  if (value.excludeSourceIds !== undefined) {
    if (!Array.isArray(value.excludeSourceIds)) return undefined;
    if (value.excludeSourceIds.length > 256) return undefined;
    for (const id of value.excludeSourceIds) {
      if (typeof id !== 'string' || id.length === 0 || id.length > 256) return undefined;
    }
  }
  return {
    threadId: value.threadId as AmendContextPacketPayload['threadId'],
    excludeSourceIds: Array.isArray(value.excludeSourceIds)
      ? (value.excludeSourceIds as string[])
      : undefined,
    clearAll: typeof value.clearAll === 'boolean' ? value.clearAll : undefined,
  };
}
