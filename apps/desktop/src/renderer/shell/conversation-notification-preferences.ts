import {
  DEFAULT_CONVERSATION_NOTIFICATION_PREFERENCES,
  parseConversationNotificationPreferences,
  type ConversationNotificationPreferences,
} from '../../conversation-notification-contract.js';
const KEY = 'sync-think.conversation-notifications';
export function readConversationNotificationPreferences(): ConversationNotificationPreferences {
  try {
    return parseConversationNotificationPreferences(
      JSON.parse(localStorage.getItem(KEY) ?? 'null'),
    );
  } catch {
    return { ...DEFAULT_CONVERSATION_NOTIFICATION_PREFERENCES };
  }
}
export function writeConversationNotificationPreferences(
  value: ConversationNotificationPreferences,
): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* Storage is best effort. */
  }
}
