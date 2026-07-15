import type {
  DecideMemoryPayload,
  ListDiagnosticsPayload,
  ListMemoryPayload,
  RollbackMemoryPayload,
} from '@sync-think/protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('Invalid string field');
  return value;
}

function optionalLimit(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 500) {
    throw new Error('Invalid limit');
  }
  return Math.floor(value);
}

export function parseListMemoryPayload(value: unknown): ListMemoryPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('Invalid list-memory payload');
  const approvalState = value.approvalState;
  if (
    approvalState !== undefined &&
    approvalState !== 'pending' &&
    approvalState !== 'approved' &&
    approvalState !== 'rejected' &&
    approvalState !== 'rolled_back'
  ) {
    throw new Error('Invalid list-memory payload');
  }
  return {
    workspaceId: optionalString(value.workspaceId) as ListMemoryPayload['workspaceId'],
    taskId: optionalString(value.taskId) as ListMemoryPayload['taskId'],
    approvalState: approvalState as ListMemoryPayload['approvalState'],
    limit: optionalLimit(value.limit),
  };
}

export function parseDecideMemoryPayload(value: unknown): DecideMemoryPayload {
  if (!isRecord(value)) throw new Error('Invalid decide-memory payload');
  if (typeof value.changeId !== 'string' || value.changeId.trim().length === 0) {
    throw new Error('Invalid decide-memory payload');
  }
  if (value.decision !== 'approved' && value.decision !== 'rejected') {
    throw new Error('Invalid decide-memory payload');
  }
  return {
    changeId: value.changeId.trim() as DecideMemoryPayload['changeId'],
    decision: value.decision,
  };
}

export function parseListDiagnosticsPayload(value: unknown): ListDiagnosticsPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('Invalid list-diagnostics payload');
  return {
    workspaceId: optionalString(value.workspaceId) as ListDiagnosticsPayload['workspaceId'],
    taskId: optionalString(value.taskId) as ListDiagnosticsPayload['taskId'],
    runId: optionalString(value.runId) as ListDiagnosticsPayload['runId'],
    limit: optionalLimit(value.limit),
  };
}

export function parseRollbackMemoryPayload(value: unknown): RollbackMemoryPayload {
  if (!isRecord(value)) throw new Error('Invalid rollback-memory payload');
  if (typeof value.changeId !== 'string' || value.changeId.trim().length === 0) {
    throw new Error('Invalid rollback-memory payload');
  }
  return {
    changeId: value.changeId.trim() as RollbackMemoryPayload['changeId'],
  };
}
