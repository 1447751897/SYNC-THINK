import type { ConversationDecideToolApprovalResponse } from '@sync-think/protocol';
import type { RunId } from '@sync-think/shared';
import {
  expiredToolApprovalSummary,
  parseToolApprovalScope,
  pendingToolApprovalSummaryFromEvent,
  type DurableToolApprovalState,
} from './tool-approval-read-model.js';

export interface ExpireToolApprovalRequest {
  approvalId: string;
  threadId: string;
  runId: RunId;
  decision: 'deny';
  reason: 'stale-approval';
  toolCallId?: string;
  toolName?: string;
}

/** Resolve replay/orphan requests only. Active approvals remain in the waiting tool loop. */
export function resolveInactiveToolApproval(
  approvalId: string,
  ports: {
    read(id: string): DurableToolApprovalState | undefined;
    expire(request: ExpireToolApprovalRequest): boolean;
  },
): ConversationDecideToolApprovalResponse | undefined {
  const state = ports.read(approvalId);
  if (!state) return undefined;
  if (state.decided) {
    const decision = state.decided.payload?.decision;
    return {
      approvalId,
      decision: decision === 'approve' || decision === 'deny' ? decision : 'deny',
      scope: parseToolApprovalScope(state.decided.payload?.scope),
      ...(expiredToolApprovalSummary(state)
        ? {
            outcome: 'expired' as const,
            reason: 'stale-approval' as const,
            runId: (state.requested.runId ?? state.requested.payload.runId) as RunId,
          }
        : {}),
    };
  }
  const requested = pendingToolApprovalSummaryFromEvent(state.requested);
  if (!requested) return undefined;
  const persisted = ports.expire({
    approvalId,
    threadId: requested.threadId,
    runId: requested.runId,
    decision: 'deny',
    reason: 'stale-approval',
    ...(requested.toolCallId ? { toolCallId: requested.toolCallId } : {}),
    toolName: requested.toolName,
  });
  if (!persisted) throw new Error('Tool approval expiry persistence failed');
  return {
    approvalId,
    decision: 'deny',
    scope: 'once',
    outcome: 'expired',
    reason: 'stale-approval',
    runId: requested.runId,
  };
}
