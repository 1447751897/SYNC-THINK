import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const instances = vi.hoisted(
  () =>
    [] as {
      options: Record<string, unknown>;
      emit(event: string): boolean;
      show: ReturnType<typeof vi.fn>;
    }[],
);
const supported = vi.hoisted(() => vi.fn(() => true));
vi.mock('electron', () => ({
  Notification: class extends EventEmitter {
    static isSupported = supported;
    show = vi.fn();
    constructor(public options: Record<string, unknown>) {
      super();
      instances.push(this);
    }
  },
}));
import { createConversationNotificationDriver } from './electron-conversation-notification-driver.js';
beforeEach(() => {
  instances.length = 0;
  supported.mockReturnValue(true);
});
describe('Electron notification click-to-conversation driver', () => {
  it('does not reveal or navigate the window until the notification is clicked', () => {
    const host = { openConversation: vi.fn(), flashFrame: vi.fn(), onFailed: vi.fn() };
    createConversationNotificationDriver(host)(
      { id: 'one', conversationId: 'a', title: '迁移', kind: 'answer' },
      true,
    );
    expect(instances[0].options).toMatchObject({ title: '等你回答 · 迁移', silent: true });
    expect(instances[0].show).toHaveBeenCalledOnce();
    expect(host.flashFrame).toHaveBeenCalledOnce();
    expect(host.openConversation).not.toHaveBeenCalled();
    instances[0].emit('click');
    expect(host.openConversation).toHaveBeenCalledWith('a');
  });
  it('handles delivery failure without navigating away or dropping the in-app wait', () => {
    const host = { openConversation: vi.fn(), flashFrame: vi.fn(), onFailed: vi.fn() };
    createConversationNotificationDriver(host)(
      { id: 'one', conversationId: 'a', title: '迁移', kind: 'answer' },
      true,
    );
    instances[0].emit('failed');
    expect(host.onFailed).toHaveBeenCalledOnce();
    expect(host.openConversation).not.toHaveBeenCalled();
  });
  it('gracefully skips native delivery when the platform does not support it', () => {
    supported.mockReturnValue(false);
    const host = { openConversation: vi.fn(), flashFrame: vi.fn(), onFailed: vi.fn() };
    createConversationNotificationDriver(host)(
      { id: 'one', conversationId: 'a', title: '迁移', kind: 'completed' },
      false,
    );
    expect(instances).toHaveLength(0);
    expect(host.flashFrame).not.toHaveBeenCalled();
  });
});
