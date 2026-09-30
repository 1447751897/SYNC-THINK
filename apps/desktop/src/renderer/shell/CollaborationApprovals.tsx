import { useEffect, useState } from 'react';
import type { CollaborationSnapshot, ThreadId } from '@sync-think/shared';
import { ToolApprovalCard, type PendingToolApproval } from './ToolApprovalCard.js';

/** Restore pending approvals for the actual child threads; never another conversation. */
export function CollaborationApprovals({
  snapshot,
  active,
}: {
  snapshot?: CollaborationSnapshot;
  active: boolean;
}) {
  const [cards, setCards] = useState<PendingToolApproval[]>([]);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string>();
  const [revision, setRevision] = useState(0);
  const scope = snapshot?.conversation.id;
  const threads = JSON.stringify([
    ...new Set(
      snapshot?.attempts
        .filter((a) => ['queued', 'running', 'waiting_input', 'stopping'].includes(a.status))
        .flatMap((a) => (a.threadId ? [a.threadId] : [])) ?? [],
    ),
  ]);
  useEffect(() => {
    setError('');
  }, [scope]);
  useEffect(() => {
    setCards([]);
    setLoadError('');
    if (!active) return;
    const api = window.syncThink?.runtime;
    if (!api?.listPendingToolApprovals) return;
    let disposed = false;
    let loading = false;
    const ids = JSON.parse(threads) as string[];
    const refresh = async () => {
      if (loading || disposed) return;
      loading = true;
      try {
        const results = await Promise.all(
          ids.map((threadId) => api.listPendingToolApprovals({ threadId: threadId as ThreadId })),
        );
        if (!disposed) {
          setCards(
            results
              .flatMap((result, index) =>
                result.approvals
                  .filter((a) => String(a.threadId) === ids[index])
                  .map((a) => ({ ...a, allowedScopes: ['once'] as const })),
              )
              .map((a) => ({ ...a, allowedScopes: [...a.allowedScopes] })),
          );
          setLoadError('');
        }
      } catch {
        if (!disposed) setLoadError('读取审批请求失败，请检查运行时连接。');
      } finally {
        loading = false;
      }
    };
    void refresh();
    const unsubscribe = api.onEvent?.((event) => {
      if (event.type.startsWith('tool.approval_')) void refresh();
    });
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
      unsubscribe?.();
    };
  }, [scope, threads, active, revision]);
  const decide = async (approvalId: string, decision: 'approve' | 'deny') => {
    const api = window.syncThink?.runtime;
    if (!api?.decideToolApproval || busy) return;
    setBusy(approvalId);
    setError('');
    try {
      const result = await api.decideToolApproval({ approvalId, decision, scope: 'once' });
      if (result.approvalId !== approvalId) throw new Error('审批回执不匹配');
      setCards((current) => current.filter((card) => card.approvalId !== approvalId));
      if (result.outcome === 'expired') setError('原审批已失效，本次点击未授予权限。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '审批提交失败');
    } finally {
      setBusy(undefined);
      setRevision((value) => value + 1);
    }
  };
  return (
    <>
      {(error || loadError) && (
        <p role="alert" className="collab-notice">
          {error || loadError}
        </p>
      )}
      {cards.map((approval) => (
        <ToolApprovalCard
          key={approval.approvalId}
          approval={approval}
          busy={Boolean(busy)}
          onApprove={() => void decide(approval.approvalId, 'approve')}
          onDeny={() => void decide(approval.approvalId, 'deny')}
        />
      ))}
    </>
  );
}
