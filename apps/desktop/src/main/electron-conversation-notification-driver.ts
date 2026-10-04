import { Notification } from 'electron';
import {
  conversationNoticeLabel,
  type ConversationNotice,
} from '../conversation-notification-contract.js';
export function createConversationNotificationDriver(host: {
  openConversation(id: string): void;
  flashFrame(): void;
  onFailed(): void;
}): (notice: ConversationNotice, silent: boolean) => void {
  const active = new Set<Notification>();
  return (notice, silent) => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: `${conversationNoticeLabel(notice.kind)} · ${notice.title}`,
      body:
        notice.kind === 'completed'
          ? '点击查看结果。'
          : notice.kind === 'failed'
            ? '点击查看详情。'
            : '需要你处理，点击返回对应会话。',
      silent,
    });
    active.add(notification);
    notification.on('close', () => active.delete(notification));
    notification.on('click', () => {
      active.delete(notification);
      host.openConversation(notice.conversationId);
    });
    notification.on('failed', () => {
      active.delete(notification);
      host.onFailed();
    });
    notification.show();
    // One-shot taskbar hint, without revealing or focusing the current window.
    host.flashFrame();
  };
}
