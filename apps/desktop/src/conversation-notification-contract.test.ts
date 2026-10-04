import { describe, expect, it } from 'vitest';
import {
  isConversationNotice,
  parseConversationNotificationPreferences,
} from './conversation-notification-contract.js';
describe('conversation notification IPC contract', () => {
  it('accepts only known notice kinds and string identities', () => {
    expect(
      isConversationNotice({ id: 'one', conversationId: 'a', title: '迁移', kind: 'answer' }),
    ).toBe(true);
    expect(
      isConversationNotice({ id: 'one', conversationId: 2, title: '迁移', kind: 'answer' }),
    ).toBe(false);
    expect(
      isConversationNotice({ id: 'one', conversationId: 'a', title: '迁移', kind: 'unexpected' }),
    ).toBe(false);
  });
  it('requires explicit boolean preferences and discards unrelated properties', () => {
    expect(
      parseConversationNotificationPreferences({ completed: true, sound: false, path: 'ignored' }),
    ).toEqual({ completed: true, sound: false });
    expect(() =>
      parseConversationNotificationPreferences({ completed: 'false', sound: false }),
    ).toThrow();
    expect(() => parseConversationNotificationPreferences(null)).toThrow();
  });
});
