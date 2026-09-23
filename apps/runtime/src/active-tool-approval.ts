import type {
  PendingToolApprovalSummary,
  ToolApprovalRiskSummary,
  ToolApprovalScope,
} from '@sync-think/protocol';
import type { Event, RunId } from '@sync-think/shared';

export type ToolApprovalDecision = 'approve' | 'deny';

export interface ActiveToolApprovalCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface ActiveToolApprovalSummary {
  title: string;
  detail: string;
  path?: string;
  command?: string;
}

export interface ActiveToolApproval {
  approvalId: string;
  runId: RunId;
  threadId: string;
  toolCall: ActiveToolApprovalCall;
  summary: ActiveToolApprovalSummary;
  arguments: Record<string, unknown>;
  risk?: ToolApprovalRiskSummary;
  allowedScopes: ToolApprovalScope[];
  resolve: (decision: ToolApprovalDecision) => void;
  createdAt: string;
}

export interface ActiveToolApprovalFilter {
  threadId: string;
  runId?: RunId;
}

/** Owns the in-memory waiter lifecycle while Runtime owns persistence and transport. */
export class ActiveToolApprovalLifecycle {
  private readonly pendingById = new Map<string, ActiveToolApproval>();

  get size(): number {
    return this.pendingById.size;
  }

  register(approval: ActiveToolApproval): void {
    this.pendingById.set(approval.approvalId, approval);
  }

  get(approvalId: string): ActiveToolApproval | undefined {
    return this.pendingById.get(approvalId);
  }

  has(approvalId: string): boolean {
    return this.pendingById.has(approvalId);
  }

  firstId(): string | undefined {
    return this.pendingById.keys().next().value;
  }

  matchingRunIds(runIds: ReadonlySet<string>): ActiveToolApproval[] {
    return [...this.pendingById.values()].filter((approval) => runIds.has(approval.runId));
  }

  matchingRun(runId: string): ActiveToolApproval[] {
    return [...this.pendingById.values()].filter((approval) => approval.runId === runId);
  }

  list(filter: ActiveToolApprovalFilter): PendingToolApprovalSummary[] {
    return [...this.pendingById.values()]
      .filter(
        (approval) =>
          approval.threadId === filter.threadId &&
          (!filter.runId || approval.runId === filter.runId),
      )
      .map((approval) => ({
        approvalId: approval.approvalId,
        threadId: approval.threadId as PendingToolApprovalSummary['threadId'],
        runId: approval.runId,
        toolCallId: approval.toolCall.id,
        toolName: approval.toolCall.name,
        arguments: approval.arguments,
        title: approval.summary.title,
        detail: approval.summary.detail,
        ...(approval.summary.path ? { path: approval.summary.path } : {}),
        ...(approval.summary.command ? { command: approval.summary.command } : {}),
        ...(approval.risk ? { risk: approval.risk } : {}),
        allowedScopes: approval.allowedScopes,
        status: 'pending' as const,
        createdAt: approval.createdAt,
      }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  settle(
    approvalId: string,
    decision: ToolApprovalDecision,
    beforeResolve?: (approval: ActiveToolApproval) => void,
  ): ActiveToolApproval | undefined {
    const approval = this.pendingById.get(approvalId);
    if (!approval) return undefined;
    this.pendingById.delete(approvalId);
    beforeResolve?.(approval);
    approval.resolve(decision);
    return approval;
  }

  settleAll(decision: ToolApprovalDecision): void {
    for (const approvalId of [...this.pendingById.keys()]) this.settle(approvalId, decision);
  }
}

export type DecideActiveToolApprovalResult =
  | { status: 'inactive' }
  | { status: 'unsupported-scope'; humanOnly: boolean }
  | {
      status: 'decided';
      approval: ActiveToolApproval;
      event: Event;
      scope: ToolApprovalScope;
    };

export function decideActiveToolApproval(input: {
  lifecycle: ActiveToolApprovalLifecycle;
  approvalId: string;
  decision: ToolApprovalDecision;
  scope: ToolApprovalScope;
  commit(approval: ActiveToolApproval): Event;
  record(event: Event): void;
  publish(event: Event): void;
}): DecideActiveToolApprovalResult {
  const approval = input.lifecycle.get(input.approvalId);
  if (!approval) return { status: 'inactive' };
  if (input.decision === 'approve' && !approval.allowedScopes.includes(input.scope)) {
    return {
      status: 'unsupported-scope',
      humanOnly: approval.risk?.level === 'human-only',
    };
  }

  const event = input.commit(approval);
  input.record(event);
  input.lifecycle.settle(input.approvalId, input.decision);
  input.publish(event);
  return { status: 'decided', approval, event, scope: input.scope };
}
