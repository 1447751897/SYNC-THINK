/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Conversation, Message } from '@sync-think/shared';
import { ChatView } from './ChatView.js';

const runtime = {
  listConversationMessages: vi.fn(),
  openTask: vi.fn(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function conversation(id: string): Conversation {
  return {
    id,
    workspaceId: 'workspace-navigation',
    taskId: `task-${id}`,
    track: 'model',
    targetRef: 'model-a',
    title: `Conversation ${id}`,
    executionMode: 'full-access',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as unknown as Conversation;
}

function userMessage(id: string, text: string): Message {
  return {
    id,
    threadId: `thread-${id}`,
    role: 'user',
    blocks: [{ type: 'text', text }],
    createdAt: '2026-09-01T00:00:01.000Z',
    sequence: 1,
  } as Message;
}

function chat(conversationId: string) {
  return (
    <ChatView
      conversation={conversation(conversationId)}
      modelName="Model A"
      models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
      eventHistory={[]}
      onTitleUpdated={vi.fn()}
    />
  );
}

beforeEach(() => {
  runtime.listConversationMessages.mockReset();
  runtime.openTask.mockReset().mockImplementation(({ taskId }: { taskId: string }) =>
    Promise.resolve({ task: { threadId: `thread-${taskId}` } }),
  );
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ChatView conversation navigation loading', () => {
  it('shows a message-shaped skeleton while the first durable page is loading', () => {
    runtime.listConversationMessages.mockImplementation(() => new Promise(() => {}));

    render(chat('skeleton-fixture'));

    expect(screen.getByRole('status', { name: '正在加载对话' })).toBeTruthy();
    expect(screen.queryByText('加载中…')).toBeNull();
  });

  it('restores a recent conversation immediately while refreshing it in the background', async () => {
    const pendingB = deferred<{ messages: Message[]; hasMore: boolean }>();
    const refreshingA = deferred<{ messages: Message[]; hasMore: boolean }>();
    runtime.listConversationMessages
      .mockResolvedValueOnce({
        messages: [userMessage('cached-a', '最近会话缓存内容')],
        hasMore: false,
      })
      .mockReturnValueOnce(pendingB.promise)
      .mockReturnValueOnce(refreshingA.promise);

    const view = render(chat('cache-a'));
    expect(await screen.findByText('最近会话缓存内容')).toBeTruthy();

    view.rerender(chat('cache-b'));
    expect(screen.getByRole('status', { name: '正在加载对话' })).toBeTruthy();

    view.rerender(chat('cache-a'));
    expect(screen.getByText('最近会话缓存内容')).toBeTruthy();
    expect(screen.queryByRole('status', { name: '正在加载对话' })).toBeNull();
    await waitFor(() => expect(runtime.listConversationMessages).toHaveBeenCalledTimes(3));
  });
});
