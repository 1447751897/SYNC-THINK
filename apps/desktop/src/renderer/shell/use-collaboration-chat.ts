import { COLLABORATION_EXECUTION_VERSION } from '@sync-think/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CollaborationCommand, CollaborationResponse, CollaborationSnapshot } from '@sync-think/shared';

export function collaborationRequest(command: CollaborationCommand): Promise<CollaborationResponse> {
  const api = window.syncThink?.runtime;
  if (!api?.collaboration) return Promise.reject(new Error('协作服务尚未连接，请重新连接运行时'));
  return api.collaboration(command);
}

export function collaborationErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/timed out|timeout/i.test(message)) return '运行时响应超时，正在核对消息是否已收到。草稿已保留，请先重新连接。';
  if (/disconnected|ECONN|pipe.*closed/i.test(message)) return '运行时连接已断开。草稿已保留，重新连接后可继续。';
  return message;
}

interface ConversationScope {
  conversationId: string;
  revision: number;
  executionVersion?: number;
}

/** Snapshots and errors belong to one visit to one conversation, never another tab. */
export function useCollaborationChat(conversationId: string, active = true) {
  const scope = useMemo<ConversationScope>(() => ({ conversationId, revision: -1 }), [conversationId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [snapshot, setSnapshot] = useState<{ scope: ConversationScope; value: CollaborationSnapshot }>();
  const [error, setError] = useState<{ scope: ConversationScope; message: string }>();
  const accept = useCallback((owner: ConversationScope, next?: CollaborationSnapshot, executionVersion?: number) => {
    if (owner !== currentScope.current || !next || next.conversation.id !== owner.conversationId || next.revision < owner.revision) return;
    // Update the high-water mark before React batches state updates. Visibility changes do not reset it.
    owner.revision = next.revision;
    owner.executionVersion = executionVersion;
    setSnapshot({ scope: owner, value: next });
    setError({ scope: owner, message: executionVersion === COLLABORATION_EXECUTION_VERSION ? '' : '后台仍在使用旧版协作引擎。结束执行后，请到「设置 → 任务 → 守护进程」停止并启动服务。刷新或只关闭窗口不会更新后台。' });
  }, []);
  const reportError = useCallback((owner: ConversationScope, cause: unknown) => {
    if (owner === currentScope.current) setError({ scope: owner, message: collaborationErrorMessage(cause) });
  }, []);

  useEffect(() => {
    let disposed = false;
    let loading = false;
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (disposed) return;
      if (loading) { dirty = true; return; }
      loading = true;
      const startedRevision = scope.revision;
      try {
        const response = await collaborationRequest({ action: 'get', conversationId });
        if (!disposed) accept(scope, response.snapshot, response.executionVersion);
      } catch (cause) {
        if (!disposed && scope.revision === startedRevision) reportError(scope, cause);
      } finally {
        loading = false;
        if (dirty && !disposed) { dirty = false; void refresh(); }
      }
    };
    const schedule = () => {
      if (timer || disposed) return;
      timer = setTimeout(() => { timer = undefined; void refresh(); }, 80);
    };
    const unsubscribe = window.syncThink?.runtime.onEvent((event) => {
      if (event.type === 'collaboration.updated' && event.payload?.conversationId === conversationId) schedule();
    });
    void refresh();
    // Durable event pushes are primary. Periodic reconciliation also recovers a missed frame.
    const interval = active ? setInterval(() => void refresh(), 10_000) : undefined;
    return () => { disposed = true; unsubscribe?.(); clearTimeout(timer); clearInterval(interval); };
  }, [accept, active, conversationId, reportError, scope]);

  const command = useCallback(async (request: CollaborationCommand) => {
    try {
      if (['members', 'start-workflow', 'dispatch'].includes(request.action) && scope.executionVersion !== COLLABORATION_EXECUTION_VERSION) throw new Error('当前后台版本尚未支持成员拓扑与小队工作链，请先结束执行并重启守护进程。');
      const response = await collaborationRequest(request);
      accept(scope, response.snapshot, response.executionVersion);
      return response;
    } catch (cause) {
      // A timeout is not proof of rejection. Read the durable receipt, never resend blindly.
      if (request.action === 'send') {
        try {
          const recovered = await collaborationRequest({ action: 'get', conversationId: request.conversationId });
          accept(scope, recovered.snapshot, recovered.executionVersion);
          if (recovered.snapshot?.receipts['send:' + request.clientRequestId]) return recovered;
        } catch { /* Keep draft + idempotency receipt for a deliberate retry. */ }
      }
      reportError(scope, cause);
      throw cause;
    }
  }, [accept, reportError, scope]);

  return {
    snapshot: snapshot?.scope === scope ? snapshot.value : undefined,
    error: error?.scope === scope ? error.message : '',
    command,
  };
}
