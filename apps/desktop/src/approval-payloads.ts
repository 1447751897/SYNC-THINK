import type {
  DecideApprovalPayload,
  EnqueueApprovalPayload,
  EvaluateApprovalPayload,
  ListApprovalsPayload,
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

export function parseListApprovalsPayload(value: unknown): ListApprovalsPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('Invalid list-approvals payload');
  const state = value.state;
  if (state !== undefined && state !== 'pending' && state !== 'approved' && state !== 'rejected') {
    throw new Error('Invalid list-approvals payload');
  }
  if (value.humanOnly !== undefined && typeof value.humanOnly !== 'boolean') {
    throw new Error('Invalid list-approvals payload');
  }
  return {
    workspaceId: optionalString(value.workspaceId) as ListApprovalsPayload['workspaceId'],
    taskId: optionalString(value.taskId) as ListApprovalsPayload['taskId'],
    state: state as ListApprovalsPayload['state'],
    humanOnly: typeof value.humanOnly === 'boolean' ? value.humanOnly : undefined,
    limit: optionalLimit(value.limit),
  };
}

export function parseEvaluateApprovalPayload(value: unknown): EvaluateApprovalPayload {
  if (!isRecord(value)) throw new Error('Invalid evaluate-approval payload');
  if (typeof value.action !== 'string' || value.action.trim().length === 0) {
    throw new Error('Invalid evaluate-approval payload');
  }
  return {
    action: value.action.trim(),
    mode: optionalString(value.mode),
    kind: optionalString(value.kind),
    insideExplicitPolicy:
      typeof value.insideExplicitPolicy === 'boolean' ? value.insideExplicitPolicy : undefined,
    delegateAvailable:
      typeof value.delegateAvailable === 'boolean' ? value.delegateAvailable : undefined,
  };
}

export function parseEnqueueApprovalPayload(value: unknown): EnqueueApprovalPayload {
  if (!isRecord(value)) throw new Error('Invalid enqueue-approval payload');
  if (typeof value.action !== 'string' || value.action.trim().length === 0) {
    throw new Error('Invalid enqueue-approval payload');
  }
  return {
    action: value.action.trim(),
    workspaceId: optionalString(value.workspaceId) as EnqueueApprovalPayload['workspaceId'],
    taskId: optionalString(value.taskId) as EnqueueApprovalPayload['taskId'],
    runId: optionalString(value.runId) as EnqueueApprovalPayload['runId'],
    stepId: optionalString(value.stepId) as EnqueueApprovalPayload['stepId'],
    kind: optionalString(value.kind),
    summary: optionalString(value.summary),
    mode: optionalString(value.mode),
    insideExplicitPolicy:
      typeof value.insideExplicitPolicy === 'boolean' ? value.insideExplicitPolicy : undefined,
    delegateAvailable:
      typeof value.delegateAvailable === 'boolean' ? value.delegateAvailable : undefined,
    forceEnqueue: typeof value.forceEnqueue === 'boolean' ? value.forceEnqueue : undefined,
    metadata:
      value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
        ? (value.metadata as Record<string, unknown>)
        : undefined,
  };
}

export function parseDecideApprovalPayload(value: unknown): DecideApprovalPayload {
  if (!isRecord(value)) throw new Error('Invalid decide-approval payload');
  if (
    !Object.keys(value).every((key) =>
      ['id', 'decision', 'decidedBy', 'delegateAgentVersionId', 'decisionNote'].includes(key),
    )
  ) {
    throw new Error('Invalid decide-approval payload');
  }
  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    throw new Error('Invalid decide-approval payload');
  }
  if (value.decision !== 'approved' && value.decision !== 'rejected') {
    throw new Error('Invalid decide-approval payload');
  }
  if (
    value.decidedBy !== undefined &&
    value.decidedBy !== 'human' &&
    value.decidedBy !== 'delegate'
  ) {
    throw new Error('Invalid decide-approval payload');
  }
  const decidedBy = value.decidedBy as 'human' | 'delegate' | undefined;
  const delegateAgentVersionId = value.delegateAgentVersionId;
  let validatedDelegateAgentVersionId: string | undefined;
  if (decidedBy === 'delegate') {
    if (
      typeof delegateAgentVersionId !== 'string' ||
      delegateAgentVersionId.trim().length === 0 ||
      delegateAgentVersionId.length > 256
    ) {
      throw new Error('Invalid decide-approval payload');
    }
    validatedDelegateAgentVersionId = delegateAgentVersionId.trim();
  } else if (delegateAgentVersionId !== undefined) {
    throw new Error('Invalid decide-approval payload');
  }
  if (
    value.decisionNote !== undefined &&
    (typeof value.decisionNote !== 'string' || value.decisionNote.length > 2000)
  ) {
    throw new Error('Invalid decide-approval payload');
  }
  return {
    id: value.id.trim() as DecideApprovalPayload['id'],
    decision: value.decision,
    decidedBy,
    ...(validatedDelegateAgentVersionId
      ? { delegateAgentVersionId: validatedDelegateAgentVersionId as DecideApprovalPayload['delegateAgentVersionId'] }
      : {}),
    decisionNote: optionalString(value.decisionNote),
  };
}
