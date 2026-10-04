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
  const roomErrors: Record<string, string> = {
    'task_room.resume_required': '本群工作已暂停或已验收。请先核对检查点并继续，或更新任务书。',
    'task_room.still_stopping': '执行器仍在停止中，确认停止后再继续。',
    'task_room.goal_revision_conflict': '任务书已被更新，请重新打开编辑并核对最新内容。',
    'task_room.pause_before_goal_change': '修改任务书前请先暂停本群工作。',
    'task_room.work_already_active': '本群已有工作正在执行，可查看进度或 @分配局部工作。',
    'task_room.unfinished_work': '仍有未完成、失败或中断的工作，请先检查并处理后再验收。',
    'task_room.task_replaced': '这项失败工作已被新的任务替代，请查看替代任务；原记录仍保留在历史中。',
    'task_room.invalid_replacement': '仅可替代本群当前目标下的失败或中断工作，请核对任务与交付类型。',
    'task_room.replacement_has_dependents': '旧任务仍有待处理的后续依赖，请先重规划这条依赖链。',
    'task_room.goal_changed': '这项工作属于旧版目标，历史已保留。请在当前目标下安排工作。',
    'task_room.no_work_to_accept': '先确认任务目标并完成工作，再进行验收。',
  };
  for (const [code, text] of Object.entries(roomErrors)) if (message.includes(code)) return text;
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
      if (['send', 'policy', 'members', 'start-workflow', 'dispatch', 'room-pause', 'room-resume', 'room-complete', 'room-brief'].includes(request.action) && scope.executionVersion !== COLLABORATION_EXECUTION_VERSION) throw new Error('当前后台尚未支持新版群内通信，请先结束执行并重启守护进程。');
      const response = await collaborationRequest(request);
      accept(scope, response.snapshot, response.executionVersion);
      return response;
    } catch (cause) {
      // A timeout is not proof of rejection. Read the durable receipt, never resend blindly.
      const ambiguous = /timed out|timeout|disconnected|ECONN|pipe.*closed/i.test(cause instanceof Error ? cause.message : String(cause));
      if (ambiguous && 'clientRequestId' in request && 'conversationId' in request) {
        try {
          const recovered = await collaborationRequest({ action: 'get', conversationId: request.conversationId });
          accept(scope, recovered.snapshot, recovered.executionVersion);
          const receiptKeys = request.action === 'start-workflow'
            ? ['dispatch:room-start:' + request.clientRequestId, 'dispatch:workflow:' + request.clientRequestId]
            : [request.action + ':' + request.clientRequestId];
          if (recovered.snapshot && receiptKeys.some(key => recovered.snapshot!.receipts[key])) return recovered;
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
