import type { ApprovalMode, HumanOnlyAction } from './enums.js';
import type { ApprovalRequestId, TaskId, WorkspaceId, RunId, StepId } from './ids.js';

export type ApprovalRequestState = 'pending' | 'approved' | 'rejected';
export type ApprovalRequestKind =
  | 'plan'
  | 'tool'
  | 'memory'
  | 'export'
  | 'skill-permission'
  | 'mcp-permission'
  | 'human-only'
  | 'other';

export type ApprovalDecidedBy = 'human' | 'delegate' | 'auto' | 'system';

export interface ApprovalRequestRecord {
  id: ApprovalRequestId;
  workspaceId: WorkspaceId;
  taskId?: TaskId;
  runId?: RunId;
  stepId?: StepId;
  kind: ApprovalRequestKind;
  action: string;
  summary: string;
  humanOnly: boolean;
  humanOnlyAction?: HumanOnlyAction;
  mode: ApprovalMode;
  gate: string;
  state: ApprovalRequestState;
  decidedBy?: ApprovalDecidedBy;
  decisionNote?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  decidedAt?: string;
}

export interface EnqueueApprovalInput {
  workspaceId: WorkspaceId;
  taskId?: TaskId;
  runId?: RunId;
  stepId?: StepId;
  kind?: ApprovalRequestKind | string;
  action: string;
  summary?: string;
  humanOnly?: boolean;
  humanOnlyAction?: HumanOnlyAction | string;
  mode?: ApprovalMode | string;
  gate?: string;
  metadata?: Record<string, unknown>;
  id?: ApprovalRequestId;
  now?: string;
}

export interface DecideApprovalInput {
  id: ApprovalRequestId;
  decision: 'approved' | 'rejected';
  decidedBy?: ApprovalDecidedBy;
  decisionNote?: string;
  now?: string;
}

export interface ListApprovalsFilter {
  workspaceId?: WorkspaceId;
  taskId?: TaskId;
  state?: ApprovalRequestState;
  humanOnly?: boolean;
  limit?: number;
}
