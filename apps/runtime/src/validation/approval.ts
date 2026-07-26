// approval command payload parsers (extracted from command-validation.ts).
import type { ListApprovalsPayload, EvaluateApprovalPayload, EnqueueApprovalPayload, DecideApprovalPayload, ConversationDecideToolApprovalPayload } from '@sync-think/protocol';
import { hasOnlyKeys, isRecord, boundedAgentText, APPROVAL_STATES, APPROVAL_KINDS } from './shared.js';

export function parseConversationDecideToolApprovalPayload(
  value: unknown,
): ConversationDecideToolApprovalPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['approvalId', 'decision']) ||
    !boundedAgentText(value.approvalId, 128) ||
    (value.decision !== 'approve' && value.decision !== 'deny')
  ) {
    return undefined;
  }
  return {
    approvalId: value.approvalId,
    decision: value.decision,
  };
}

export function parseListApprovalsPayload(value: unknown): ListApprovalsPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.workspaceId !== undefined) {
    if (
      typeof value.workspaceId !== 'string' ||
      value.workspaceId.trim().length === 0 ||
      value.workspaceId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.taskId !== undefined) {
    if (
      typeof value.taskId !== 'string' ||
      value.taskId.trim().length === 0 ||
      value.taskId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.state !== undefined) {
    if (typeof value.state !== 'string' || !APPROVAL_STATES.has(value.state)) return undefined;
  }
  if (value.humanOnly !== undefined && typeof value.humanOnly !== 'boolean') return undefined;
  if (value.limit !== undefined) {
    if (
      typeof value.limit !== 'number' ||
      !Number.isFinite(value.limit) ||
      value.limit < 1 ||
      value.limit > 500
    ) {
      return undefined;
    }
  }
  return {
    workspaceId:
      typeof value.workspaceId === 'string'
        ? (value.workspaceId as ListApprovalsPayload['workspaceId'])
        : undefined,
    taskId:
      typeof value.taskId === 'string'
        ? (value.taskId as ListApprovalsPayload['taskId'])
        : undefined,
    state: value.state as ListApprovalsPayload['state'],
    humanOnly: typeof value.humanOnly === 'boolean' ? value.humanOnly : undefined,
    limit: typeof value.limit === 'number' ? value.limit : undefined,
  };
}

export function parseEvaluateApprovalPayload(value: unknown): EvaluateApprovalPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !hasOnlyKeys(value, [
      'workspaceId',
      'taskId',
      'runId',
      'stepId',
      'agentVersionId',
      'mode',
      'action',
      'kind',
      'insideExplicitPolicy',
      'delegateAvailable',
    ])
  ) {
    return undefined;
  }
  if (
    typeof value.action !== 'string' ||
    value.action.trim().length === 0 ||
    value.action.length > 256
  ) {
    return undefined;
  }
  if (value.mode !== undefined && (typeof value.mode !== 'string' || value.mode.length > 32))
    return undefined;
  if (value.kind !== undefined) {
    if (typeof value.kind !== 'string' || value.kind.length > 64) return undefined;
    // allow unknown kinds through for forward-compat; known set is documented
    void APPROVAL_KINDS;
  }
  if (value.insideExplicitPolicy !== undefined && typeof value.insideExplicitPolicy !== 'boolean')
    return undefined;
  if (value.delegateAvailable !== undefined && typeof value.delegateAvailable !== 'boolean')
    return undefined;
  for (const key of ['workspaceId', 'taskId', 'runId', 'stepId', 'agentVersionId'] as const) {
    const candidate = value[key];
    if (
      candidate !== undefined &&
      (typeof candidate !== 'string' || candidate.trim().length === 0 || candidate.length > 128)
    ) {
      return undefined;
    }
  }
  return {
    action: value.action.trim(),
    workspaceId:
      typeof value.workspaceId === 'string'
        ? (value.workspaceId.trim() as EvaluateApprovalPayload['workspaceId'])
        : undefined,
    taskId:
      typeof value.taskId === 'string'
        ? (value.taskId.trim() as EvaluateApprovalPayload['taskId'])
        : undefined,
    runId:
      typeof value.runId === 'string'
        ? (value.runId.trim() as EvaluateApprovalPayload['runId'])
        : undefined,
    stepId:
      typeof value.stepId === 'string'
        ? (value.stepId.trim() as EvaluateApprovalPayload['stepId'])
        : undefined,
    agentVersionId:
      typeof value.agentVersionId === 'string'
        ? (value.agentVersionId.trim() as EvaluateApprovalPayload['agentVersionId'])
        : undefined,
    mode: typeof value.mode === 'string' ? value.mode : undefined,
    kind: typeof value.kind === 'string' ? value.kind : undefined,
    insideExplicitPolicy:
      typeof value.insideExplicitPolicy === 'boolean' ? value.insideExplicitPolicy : undefined,
    delegateAvailable:
      typeof value.delegateAvailable === 'boolean' ? value.delegateAvailable : undefined,
  };
}

export function parseEnqueueApprovalPayload(value: unknown): EnqueueApprovalPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !hasOnlyKeys(value, [
      'workspaceId',
      'taskId',
      'runId',
      'stepId',
      'agentVersionId',
      'kind',
      'action',
      'summary',
      'mode',
      'insideExplicitPolicy',
      'delegateAvailable',
      'forceEnqueue',
      'metadata',
    ])
  ) {
    return undefined;
  }
  if (
    typeof value.action !== 'string' ||
    value.action.trim().length === 0 ||
    value.action.length > 256
  ) {
    return undefined;
  }
  if (value.workspaceId !== undefined) {
    if (
      typeof value.workspaceId !== 'string' ||
      value.workspaceId.trim().length === 0 ||
      value.workspaceId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.taskId !== undefined) {
    if (typeof value.taskId !== 'string' || value.taskId.length > 128) return undefined;
  }
  if (value.runId !== undefined) {
    if (typeof value.runId !== 'string' || value.runId.length > 128) return undefined;
  }
  if (value.stepId !== undefined) {
    if (typeof value.stepId !== 'string' || value.stepId.length > 128) return undefined;
  }
  if (value.agentVersionId !== undefined) {
    if (
      typeof value.agentVersionId !== 'string' ||
      value.agentVersionId.trim().length === 0 ||
      value.agentVersionId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.kind !== undefined && (typeof value.kind !== 'string' || value.kind.length > 64))
    return undefined;
  if (
    value.summary !== undefined &&
    (typeof value.summary !== 'string' || value.summary.length > 1000)
  )
    return undefined;
  if (value.mode !== undefined && (typeof value.mode !== 'string' || value.mode.length > 32))
    return undefined;
  if (value.insideExplicitPolicy !== undefined && typeof value.insideExplicitPolicy !== 'boolean')
    return undefined;
  if (value.delegateAvailable !== undefined && typeof value.delegateAvailable !== 'boolean')
    return undefined;
  if (value.forceEnqueue !== undefined && typeof value.forceEnqueue !== 'boolean') return undefined;
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) return undefined;
  }
  return {
    action: value.action.trim(),
    workspaceId:
      typeof value.workspaceId === 'string'
        ? (value.workspaceId as EnqueueApprovalPayload['workspaceId'])
        : undefined,
    taskId:
      typeof value.taskId === 'string'
        ? (value.taskId as EnqueueApprovalPayload['taskId'])
        : undefined,
    runId:
      typeof value.runId === 'string'
        ? (value.runId as EnqueueApprovalPayload['runId'])
        : undefined,
    stepId:
      typeof value.stepId === 'string'
        ? (value.stepId as EnqueueApprovalPayload['stepId'])
        : undefined,
    agentVersionId:
      typeof value.agentVersionId === 'string'
        ? (value.agentVersionId.trim() as EnqueueApprovalPayload['agentVersionId'])
        : undefined,
    kind: typeof value.kind === 'string' ? value.kind : undefined,
    summary: typeof value.summary === 'string' ? value.summary : undefined,
    mode: typeof value.mode === 'string' ? value.mode : undefined,
    insideExplicitPolicy:
      typeof value.insideExplicitPolicy === 'boolean' ? value.insideExplicitPolicy : undefined,
    delegateAvailable:
      typeof value.delegateAvailable === 'boolean' ? value.delegateAvailable : undefined,
    forceEnqueue: typeof value.forceEnqueue === 'boolean' ? value.forceEnqueue : undefined,
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
  };
}

export function parseDecideApprovalPayload(value: unknown): DecideApprovalPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['id', 'decision', 'decidedBy', 'delegateAgentVersionId', 'decisionNote'])
  )
    return undefined;
  if (typeof value.id !== 'string' || value.id.trim().length === 0 || value.id.length > 128)
    return undefined;
  if (value.decision !== 'approved' && value.decision !== 'rejected') return undefined;
  if (
    value.decisionNote !== undefined &&
    (typeof value.decisionNote !== 'string' || value.decisionNote.length > 1000)
  ) {
    return undefined;
  }
  if (
    value.decidedBy !== undefined &&
    value.decidedBy !== 'human' &&
    value.decidedBy !== 'delegate'
  ) {
    return undefined;
  }
  if (
    value.decidedBy === 'delegate' &&
    (typeof value.delegateAgentVersionId !== 'string' ||
      value.delegateAgentVersionId.trim().length === 0 ||
      value.delegateAgentVersionId.length > 128)
  )
    return undefined;
  if (value.decidedBy !== 'delegate' && value.delegateAgentVersionId !== undefined) {
    return undefined;
  }
  return {
    id: value.id.trim() as DecideApprovalPayload['id'],
    decision: value.decision,
    decidedBy: value.decidedBy,
    delegateAgentVersionId:
      typeof value.delegateAgentVersionId === 'string'
        ? (value.delegateAgentVersionId.trim() as DecideApprovalPayload['delegateAgentVersionId'])
        : undefined,
    decisionNote: typeof value.decisionNote === 'string' ? value.decisionNote : undefined,
  };
}
