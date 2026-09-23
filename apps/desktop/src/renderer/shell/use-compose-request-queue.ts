import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readQueuedComposeRequests,
  removeQueuedComposeRequest,
  updateQueuedComposeRequest,
  writeQueuedComposeRequests,
  type QueuedComposeRequest,
} from './compose-request-queue.js';
import { buildMessageWithAttachments, messageImagesFromAttachments } from './compose-mention.js';
import type { SendComposeText } from './compose-send-request.js';

interface QueueDispatchAttempt {
  requestId: string;
  token: symbol;
}

interface QueueBlockedRequest {
  requestId: string;
  error: string;
}

interface QueueDispatchState {
  dispatching?: QueueDispatchAttempt;
  blocked?: QueueBlockedRequest;
}

/** Owns persisted composer drafts and conversation-scoped dispatch attempts. */
export function useComposeRequestQueue(input: {
  conversationId: string;
  modelOverride: string;
  runIsActive: boolean;
  waitingForThread: boolean;
  sendUserText: SendComposeText;
}) {
  const { conversationId, modelOverride, runIsActive, waitingForThread, sendUserText } = input;
  const activeConversationIdRef = useRef(conversationId);
  activeConversationIdRef.current = conversationId;
  /** Composer-only drafts. They do not become messages or Provider context until dispatched. */
  const [queuedComposeRequests, setQueuedComposeRequests] = useState<QueuedComposeRequest[]>(() =>
    readQueuedComposeRequests(conversationId),
  );
  const [dispatchingQueuedRequestId, setDispatchingQueuedRequestId] = useState<
    string | undefined
  >();
  const [blockedQueuedRequestId, setBlockedQueuedRequestId] = useState<string | undefined>();
  const [queuedRequestDispatchError, setQueuedRequestDispatchError] = useState<
    string | undefined
  >();
  /**
   * Queue dispatch ownership is conversation-scoped. A single boolean lock is
   * insufficient because this ChatView instance survives conversation switches:
   * clearing that lock on navigation lets the same persisted draft dispatch twice
   * when the user returns before appendMessage settles.
   */
  const queuedDispatchByConversationRef = useRef(new Map<string, QueueDispatchState>());
  const commitQueuedComposeRequests = useCallback(
    (update: (current: readonly QueuedComposeRequest[]) => QueuedComposeRequest[]): void => {
      setQueuedComposeRequests((current) => {
        const next = update(current);
        writeQueuedComposeRequests(conversationId, next);
        return next;
      });
    },
    [conversationId],
  );
  useEffect(() => {
    const queuedDispatchState = queuedDispatchByConversationRef.current.get(conversationId);
    setQueuedComposeRequests(readQueuedComposeRequests(conversationId));
    setDispatchingQueuedRequestId(queuedDispatchState?.dispatching?.requestId);
    setBlockedQueuedRequestId(queuedDispatchState?.blocked?.requestId);
    setQueuedRequestDispatchError(queuedDispatchState?.blocked?.error);
  }, [conversationId]);

  const dispatchQueuedComposeRequest = useCallback(
    async (request: QueuedComposeRequest, mode: 'auto' | 'interject') => {
      if (request.conversationId !== conversationId) return;
      if (mode === 'auto' && activeConversationIdRef.current !== conversationId) return;

      const currentDispatchState =
        queuedDispatchByConversationRef.current.get(conversationId) ?? {};
      if (currentDispatchState.dispatching) return;

      const token = Symbol(`queued-compose:${conversationId}:${request.id}`);
      const nextDispatchState: QueueDispatchState = {
        ...currentDispatchState,
        dispatching: { requestId: request.id, token },
        blocked:
          currentDispatchState.blocked?.requestId === request.id
            ? undefined
            : currentDispatchState.blocked,
      };
      queuedDispatchByConversationRef.current.set(conversationId, nextDispatchState);
      if (activeConversationIdRef.current === conversationId) {
        setDispatchingQueuedRequestId(request.id);
      }
      if (
        activeConversationIdRef.current === conversationId &&
        currentDispatchState.blocked?.requestId === request.id
      ) {
        setBlockedQueuedRequestId(undefined);
        setQueuedRequestDispatchError(undefined);
      }

      const outbound = buildMessageWithAttachments(request.text, request.attachments);
      const images = messageImagesFromAttachments(request.attachments);
      try {
        const sent = await sendUserText(outbound, images, {
          modelOverride,
          reasoningEffort: request.reasoningEffort,
          networkEnabled: request.networkEnabled,
          skillVersionIds: request.skillVersionIds,
          kernelOverride: request.kernelOverride,
        });
        if (!sent) throw new Error('发送接口未返回成功结果');

        const latestDispatchState = queuedDispatchByConversationRef.current.get(conversationId);
        if (latestDispatchState?.dispatching?.token !== token) return;
        const settledDispatchState: QueueDispatchState = {
          ...latestDispatchState,
          dispatching: undefined,
        };
        if (settledDispatchState.blocked) {
          queuedDispatchByConversationRef.current.set(conversationId, settledDispatchState);
        } else {
          queuedDispatchByConversationRef.current.delete(conversationId);
        }

        if (activeConversationIdRef.current === conversationId) {
          commitQueuedComposeRequests((current) => removeQueuedComposeRequest(current, request.id));
          setDispatchingQueuedRequestId(undefined);
          setBlockedQueuedRequestId(settledDispatchState.blocked?.requestId);
          setQueuedRequestDispatchError(settledDispatchState.blocked?.error);
        } else {
          const stored = readQueuedComposeRequests(conversationId);
          writeQueuedComposeRequests(
            conversationId,
            removeQueuedComposeRequest(stored, request.id),
          );
        }
      } catch (error) {
        const latestDispatchState = queuedDispatchByConversationRef.current.get(conversationId);
        if (latestDispatchState?.dispatching?.token !== token) return;
        const dispatchError =
          mode === 'auto'
            ? '自动执行失败，需求已保留，可点击重试'
            : `插话发送失败，需求已保留：${error instanceof Error ? error.message : String(error)}`;
        const failedDispatchState: QueueDispatchState = {
          ...latestDispatchState,
          dispatching: undefined,
          blocked: { requestId: request.id, error: dispatchError },
        };
        queuedDispatchByConversationRef.current.set(conversationId, failedDispatchState);
        if (activeConversationIdRef.current === conversationId) {
          setDispatchingQueuedRequestId(undefined);
          setBlockedQueuedRequestId(request.id);
          setQueuedRequestDispatchError(dispatchError);
        }
      }
    },
    [commitQueuedComposeRequests, conversationId, modelOverride, sendUserText],
  );

  const handleEditQueuedComposeRequest = useCallback(
    (requestId: string, text: string) => {
      const request = queuedComposeRequests.find((item) => item.id === requestId);
      if (!request || (!text.trim() && request.attachments.length === 0)) return;
      commitQueuedComposeRequests((current) =>
        updateQueuedComposeRequest(current, requestId, { text }),
      );
    },
    [commitQueuedComposeRequests, queuedComposeRequests],
  );

  const handleDeleteQueuedComposeRequest = useCallback(
    (requestId: string) => {
      if (dispatchingQueuedRequestId === requestId) return;
      commitQueuedComposeRequests((current) => removeQueuedComposeRequest(current, requestId));
      if (blockedQueuedRequestId === requestId) {
        const dispatchState = queuedDispatchByConversationRef.current.get(conversationId);
        if (dispatchState?.blocked?.requestId === requestId) {
          if (dispatchState.dispatching) {
            queuedDispatchByConversationRef.current.set(conversationId, {
              dispatching: dispatchState.dispatching,
            });
          } else {
            queuedDispatchByConversationRef.current.delete(conversationId);
          }
        }
        setBlockedQueuedRequestId(undefined);
        setQueuedRequestDispatchError(undefined);
      }
    },
    [
      blockedQueuedRequestId,
      commitQueuedComposeRequests,
      conversationId,
      dispatchingQueuedRequestId,
    ],
  );

  const handleInterjectQueuedComposeRequest = useCallback(
    (requestId: string) => {
      const request = queuedComposeRequests.find((item) => item.id === requestId);
      if (!request) return;
      void dispatchQueuedComposeRequest(request, 'interject');
    },
    [dispatchQueuedComposeRequest, queuedComposeRequests],
  );

  useEffect(() => {
    const next = queuedComposeRequests[0];
    const dispatchState = queuedDispatchByConversationRef.current.get(conversationId);
    // Only dispatch after the current Run is actually inactive. A delayed
    // "ghost run" timer used to fire while a long Run was still live and
    // cancelled it as soon as the user queued a follow-up.
    if (
      !next ||
      next.conversationId !== conversationId ||
      runIsActive ||
      Boolean(dispatchState?.dispatching) ||
      dispatchState?.blocked?.requestId === next.id ||
      waitingForThread
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void dispatchQueuedComposeRequest(next, 'auto');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    blockedQueuedRequestId,
    conversationId,
    waitingForThread,
    dispatchQueuedComposeRequest,
    queuedComposeRequests,
    runIsActive,
  ]);

  return {
    queuedComposeRequests,
    dispatchingQueuedRequestId,
    blockedQueuedRequestId,
    queuedRequestDispatchError,
    commitQueuedComposeRequests,
    handleEditQueuedComposeRequest,
    handleDeleteQueuedComposeRequest,
    handleInterjectQueuedComposeRequest,
  };
}
