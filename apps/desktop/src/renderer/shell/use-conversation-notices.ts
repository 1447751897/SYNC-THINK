import { useEffect, useRef } from 'react';
import type { ConversationAttention } from '../../conversation-attention.js';
import {
  conversationNoticeLabel,
  type ConversationNotice,
  type ConversationNotificationPreferences,
} from '../../conversation-notification-contract.js';
import { toastApi } from './Toast.js';
export interface ConversationNoticeBridge {
  onConversationNotice?(listener: (notice: ConversationNotice) => void): () => void;
  setConversationNotificationPreferences?(
    preferences: ConversationNotificationPreferences,
  ): Promise<void>;
}
export function useConversationNotices(options: {
  api: ConversationNoticeBridge | undefined;
  visibleIds: ReadonlySet<string>;
  attention: ReadonlyMap<string, readonly ConversationAttention[]>;
  preferences: ConversationNotificationPreferences;
  onOpenConversation(id: string): void;
}): void {
  const current = useRef(options);
  current.current = options;
  const waitingToasts = useRef(new Map<string, { conversationId: string; key: string }>());
  useEffect(
    () =>
      options.api?.onConversationNotice?.((notice) => {
        const state = current.current;
        // Native notifications cover the background. In-app toasts cover other
        // chats, never the question the user already has in front of them.
        if (
          !(notice.foreground ?? document.hasFocus()) ||
          state.visibleIds.has(notice.conversationId)
        )
          return;
        if (notice.kind === 'completed' && !state.preferences.completed) return;
        const id = `conversation-notice:${notice.id}`;
        if (notice.requestKey)
          waitingToasts.current.set(id, {
            conversationId: notice.conversationId,
            key: notice.requestKey,
          });
        toastApi.toast({
          id,
          type:
            notice.kind === 'completed'
              ? 'success'
              : notice.kind === 'failed'
                ? 'error'
                : 'warning',
          title: `「${notice.title}」${conversationNoticeLabel(notice.kind)}`,
          description: notice.requestKey ? '任务正在等待你处理，不是继续运行中。' : undefined,
          duration: notice.requestKey ? 12_000 : 5_000,
          action: {
            label: notice.kind === 'answer' ? '去回答' : notice.requestKey ? '去处理' : '查看',
            onClick: () => current.current.onOpenConversation(notice.conversationId),
          },
        });
      }),
    [options.api],
  );
  useEffect(() => {
    void options.api
      ?.setConversationNotificationPreferences?.(options.preferences)
      .catch(() => undefined);
  }, [options.api, options.preferences]);
  useEffect(() => {
    for (const [id, request] of waitingToasts.current) {
      if (
        options.visibleIds.has(request.conversationId) ||
        !options.attention.get(request.conversationId)?.some((item) => item.key === request.key)
      ) {
        toastApi.dismiss(id);
        waitingToasts.current.delete(id);
      }
    }
  }, [options.attention, options.visibleIds]);
  useEffect(
    () => () => {
      for (const id of waitingToasts.current.keys()) toastApi.dismiss(id);
      waitingToasts.current.clear();
    },
    [],
  );
}
