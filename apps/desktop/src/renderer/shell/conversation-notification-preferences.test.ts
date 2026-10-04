/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import {
  readConversationNotificationPreferences,
  writeConversationNotificationPreferences,
} from './conversation-notification-preferences.js';
afterEach(() => localStorage.clear());
describe('device-local conversation notification preferences', () => {
  it('defaults to completion notifications enabled and sound off', () => {
    expect(readConversationNotificationPreferences()).toEqual({ completed: true, sound: false });
  });
  it('persists preferences across reloads', () => {
    writeConversationNotificationPreferences({ completed: false, sound: true });
    expect(readConversationNotificationPreferences()).toEqual({ completed: false, sound: true });
  });
});
