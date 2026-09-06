import { useState } from 'react';
import type { ExpiredToolApprovalSummary } from '@sync-think/protocol';
import { ShieldAlert } from 'lucide-react';

export function ExpiredToolApprovalNotice({
  approvals,
  total,
  busy,
  onRecover,
}: {
  approvals: readonly ExpiredToolApprovalSummary[];
  total?: number;
  busy?: boolean;
  onRecover(approval: ExpiredToolApprovalSummary): void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const approval = approvals.find((item) => item.approvalId === selectedId) ?? approvals[0];
  if (!approval) return null;
  return (
    <section
      className="shell-composer-tool-approval shell-composer-expired-approval"
      aria-label="失效审批"
      data-testid="expired-tool-approval"
    >
      <div className="shell-composer-tool-approval__main">
        <span className="shell-composer-tool-approval__icon" aria-hidden="true">
          <ShieldAlert size={16} />
        </span>
        <div className="shell-composer-tool-approval__copy">
          <div className="shell-composer-tool-approval__title">
            <span>审批已失效</span> · {approval.title}
          </div>
          <p className="shell-composer-expired-approval__explanation">
            原运行已不再等待该审批，旧批准不会继续生效。部分操作可能已执行；重新编辑后请核对，再作为新请求发送。
          </p>
          {approvals.length > 1 && (
            <select
              aria-label="选择失效审批"
              value={approval.approvalId}
              disabled={busy}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {approvals.map((item) => (
                <option key={item.approvalId} value={item.approvalId}>
                  {item.title} · {item.expiredAt}
                </option>
              ))}
            </select>
          )}
          {total && total > approvals.length ? (
            <p>
              显示最近 {approvals.length} 条，共 {total} 条失效记录。
            </p>
          ) : null}
          {!approval.requestMessageId && (
            <p className="shell-composer-expired-approval__explanation">
              原请求未找到，请在当前会话重新描述需求。
            </p>
          )}
        </div>
      </div>
      <div className="shell-composer-tool-approval__actions">
        <button
          type="button"
          className="shell-composer-tool-approval__button is-secondary"
          disabled={busy || !approval.requestMessageId}
          onClick={() => onRecover(approval)}
        >
          {busy ? '正在读取…' : '重新编辑原请求'}
        </button>
      </div>
    </section>
  );
}
