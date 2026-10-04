/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationAttention } from '../../conversation-attention.js';
import type { ConversationNotice } from '../../conversation-notification-contract.js';
import { useConversationNotices } from './use-conversation-notices.js';
import { resetToastStoreForTests, ToastProvider } from './Toast.js';
const notice: ConversationNotice = {
  id: 'ask:one',
  conversationId: 'a',
  title: '数据库迁移',
  kind: 'answer',
  requestKey: 'ask:one',
};
const attention = new Map([['a', [{ key: 'ask:one' } as ConversationAttention]]]);
function fixture(visible = new Set<string>()) {
  let receive!: (notice: ConversationNotice) => void;
  const unsubscribe = vi.fn();
  const api = {
    onConversationNotice: vi.fn((listener: (notice: ConversationNotice) => void) => {
      receive = listener;
      return unsubscribe;
    }),
    setConversationNotificationPreferences: vi.fn(async () => undefined),
  };
  const onOpenConversation = vi.fn();
  const options = {
    api,
    visibleIds: visible,
    attention,
    preferences: { completed: true, sound: false },
    onOpenConversation,
  };
  function Host({ state }: { state: typeof options }) {
    useConversationNotices(state);
    return (
      <ToastProvider>
        <div />
      </ToastProvider>
    );
  }
  const result = render(<Host state={options} />);
  return {
    ...result,
    api,
    unsubscribe,
    onOpenConversation,
    emit: (value = notice) => act(() => receive(value)),
    update: (changes: Partial<typeof options>) =>
      result.rerender(<Host state={{ ...options, ...changes }} />),
  };
}
beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  resetToastStoreForTests();
  vi.restoreAllMocks();
});
describe('foreground cross-conversation notices', () => {
  it('offers a click-to-answer toast without navigating until clicked', () => {
    const view = fixture();
    view.emit();
    expect(screen.getByText('「数据库迁移」等你回答')).toBeTruthy();
    expect(view.onOpenConversation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '去回答' }));
    expect(view.onOpenConversation).toHaveBeenCalledWith('a');
  });
  it('suppresses extra toasts for active split-pane conversations', () => {
    const view = fixture(new Set(['a', 'b']));
    view.emit();
    expect(screen.queryByTestId('shell-toast')).toBeNull();
  });
  it('lets the main process handle background notifications', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const view = fixture();
    view.emit();
    expect(screen.queryByTestId('shell-toast')).toBeNull();
  });
  it('still alerts while the application is foreground but an embedded browser owns DOM focus', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const view = fixture();
    view.emit({ ...notice, foreground: true });
    expect(screen.getByTestId('shell-toast')).toBeTruthy();
  });
  it('does not settle a request when its toast is dismissed', () => {
    const view = fixture();
    view.emit();
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(attention.get('a')).toHaveLength(1);
    expect(view.onOpenConversation).not.toHaveBeenCalled();
  });
  it('removes obsolete toasts when a request is answered', () => {
    const view = fixture();
    view.emit();
    view.update({ attention: new Map() });
    expect(screen.queryByTestId('shell-toast')).toBeNull();
  });
  it('clears the toast when navigating to its conversation without clearing the question', () => {
    const view = fixture();
    view.emit();
    view.update({ visibleIds: new Set(['a']) });
    expect(screen.queryByTestId('shell-toast')).toBeNull();
    expect(attention.get('a')).toHaveLength(1);
  });
  it('sends preference changes to the host and mutes only completion toasts', () => {
    const view = fixture();
    view.update({ preferences: { completed: false, sound: true } });
    expect(view.api.setConversationNotificationPreferences).toHaveBeenLastCalledWith({
      completed: false,
      sound: true,
    });
    view.emit({ ...notice, kind: 'completed', requestKey: undefined });
    expect(screen.queryByTestId('shell-toast')).toBeNull();
    view.emit();
    expect(screen.getByTestId('shell-toast')).toBeTruthy();
  });
  it('unsubscribes and removes request toasts on unmount', () => {
    const view = fixture();
    view.emit();
    view.unmount();
    expect(view.unsubscribe).toHaveBeenCalledOnce();
  });
});
