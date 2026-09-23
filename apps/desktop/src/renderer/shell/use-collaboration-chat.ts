import { useCallback, useEffect, useRef, useState } from 'react';
import type { CollaborationCommand, CollaborationResponse, CollaborationSnapshot } from '@sync-think/shared';

export function collaborationRequest(command: CollaborationCommand): Promise<CollaborationResponse> {
  const api = window.syncThink?.runtime;
  if (!api?.collaboration) return Promise.reject(new Error('协作服务尚未连接，请重新连接运行时'));
  return api.collaboration(command);
}

/** One authoritative snapshot; older responses never overwrite a newer pushed revision. */
export function useCollaborationChat(conversationId: string, active = true) {
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot>();
  const [error, setError] = useState('');
  const currentId = useRef(conversationId);
  currentId.current = conversationId;
  const revisionRef = useRef(-1);
  const accept = useCallback((next?: CollaborationSnapshot) => {
    if (!next || next.conversation.id !== currentId.current) return;
    setSnapshot((previous) => {
      if (next.revision < revisionRef.current) return previous;
      revisionRef.current = next.revision;
      return !previous || previous.conversation.id !== next.conversation.id || next.revision >= previous.revision ? next : previous;
    });
    setError('');
  }, []);

  useEffect(() => {
    let disposed = false;
    let loading = false;
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    revisionRef.current = -1;
    const refresh = async () => {
      if (disposed) return;
      if (loading) { dirty = true; return; }
      loading = true;
      try {
        const response = await collaborationRequest({ action: 'get', conversationId });
        if (!disposed) accept(response.snapshot);
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
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
  }, [accept, active, conversationId]);

  const command = useCallback(async (request: CollaborationCommand) => {
    try {
      const response = await collaborationRequest(request);
      accept(response.snapshot);
      return response;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }, [accept]);

  return { snapshot: snapshot?.conversation.id === conversationId ? snapshot : undefined, error, command };
}
