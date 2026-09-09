import { Shield } from 'lucide-react';
import type { ToolApprovalScope } from '@sync-think/protocol';
import { persistentComputerUseAppOf } from './tool-approval.js';

export interface PendingToolApproval {
  approvalId: string;
  runId?: string;
  toolCallId?: string;
  toolName: string;
  title: string;
  detail: string;
  path?: string;
  command?: string;
  arguments?: Record<string, unknown>;
  allowedScopes?: ToolApprovalScope[];
  decided?: 'approve' | 'deny';
}

export function ToolApprovalCard({
  approval,
  busy,
  onApprove,
  onDeny,
}: {
  approval: PendingToolApproval;
  busy?: boolean;
  onApprove(scope: ToolApprovalScope): void;
  onDeny(): void;
}) {
  const persistentApp = persistentComputerUseAppOf(approval.toolName, approval.arguments);
  const scopes = approval.allowedScopes;
  const canAlwaysAllowApp = Boolean(persistentApp && (!scopes || scopes.includes('always-app')));
  const canAllowSession = Boolean(!persistentApp && (!scopes || scopes.includes('session')));
  const secondaryScope: ToolApprovalScope | undefined = canAlwaysAllowApp
    ? 'always-app'
    : canAllowSession
      ? 'session'
      : undefined;
  const secondaryLabel = canAlwaysAllowApp ? '始终允许此应用' : '本会话允许';
  const detail = approval.detail || approval.path || approval.command || approval.toolName;

  return (
    <div
      className="shell-composer-tool-approval"
      data-testid={`tool-approval-${approval.approvalId}`}
      data-tool={approval.toolName}
      data-persistent-app={persistentApp ? persistentApp.value : undefined}
    >
      <div className="shell-composer-tool-approval__main">
        <span className="shell-composer-tool-approval__icon" aria-hidden="true">
          <Shield size={16} />
        </span>
        <div className="shell-composer-tool-approval__copy">
          <div className="shell-composer-tool-approval__title">{approval.title}</div>
          <div className="shell-composer-tool-approval__detail">
            <span>需要批准</span>
            {detail ? <span aria-hidden="true"> · </span> : null}
            {detail ? (
              <span className="shell-composer-tool-approval__detail-text">{detail}</span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="shell-composer-tool-approval__actions">
        <button
          type="button"
          className="shell-composer-tool-approval__button is-approve"
          disabled={busy}
          onClick={() => onApprove('once')}
        >
          {busy ? '处理中…' : '批准'}
        </button>
        {secondaryScope ? (
          <button
            type="button"
            className="shell-composer-tool-approval__button is-secondary"
            disabled={busy}
            onClick={() => onApprove(secondaryScope)}
          >
            {secondaryLabel}
          </button>
        ) : null}
        <button
          type="button"
          className="shell-composer-tool-approval__button is-deny"
          disabled={busy}
          onClick={onDeny}
        >
          拒绝
        </button>
      </div>
    </div>
  );
}
