import type { ToolApprovalScope } from '@sync-think/protocol';

export interface PendingToolApproval {
  approvalId: string;
  runId?: string;
  toolCallId?: string;
  toolName: string;
  title: string;
  detail: string;
  reason?: string;
  path?: string;
  command?: string;
  arguments?: Record<string, unknown>;
  allowedScopes?: ToolApprovalScope[];
  decided?: 'approve' | 'deny';
}
