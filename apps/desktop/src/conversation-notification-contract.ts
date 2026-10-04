export interface ConversationNotice {
  id: string;
  conversationId: string;
  title: string;
  kind: 'answer' | 'approval' | 'desktop' | 'completed' | 'failed';
  requestKey?: string;
  foreground?: boolean;
}
export interface ConversationNotificationPreferences {
  completed: boolean;
  sound: boolean;
}
export const DEFAULT_CONVERSATION_NOTIFICATION_PREFERENCES: ConversationNotificationPreferences = {
  completed: true,
  sound: false,
};
export function parseConversationNotificationPreferences(
  value: unknown,
): ConversationNotificationPreferences {
  if (!value || typeof value !== 'object') throw new Error('Invalid notification preferences');
  const p = value as Record<string, unknown>;
  if (typeof p.completed !== 'boolean' || typeof p.sound !== 'boolean')
    throw new Error('Invalid notification preferences');
  return { completed: p.completed, sound: p.sound };
}
export function conversationNoticeLabel(kind: ConversationNotice['kind']): string {
  return {
    answer: '等你回答',
    approval: '等你审批',
    desktop: '等你处理',
    completed: '任务已完成',
    failed: '执行失败',
  }[kind];
}
export function isConversationNotice(value: unknown): value is ConversationNotice {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.conversationId === 'string' &&
    typeof p.title === 'string' &&
    ['answer', 'approval', 'desktop', 'completed', 'failed'].includes(String(p.kind)) &&
    (p.requestKey === undefined || typeof p.requestKey === 'string') &&
    (p.foreground === undefined || typeof p.foreground === 'boolean')
  );
}
