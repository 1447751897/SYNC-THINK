/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Conversation, Message, MessageNavigationEntry } from '@sync-think/shared';
import type {
  ConversationListMessagesPayload,
  ConversationListMessagesResponse,
  ConversationListNavigationPayload,
} from '@sync-think/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatView } from './ChatView.js';

let fixtureIndex = 0;
const runtime = {
  openTask: vi.fn(),
  listConversationMessages: vi.fn(),
  listConversationNavigation: vi.fn(),
};
const messages: Message[] = Array.from({ length: 150 }, (_, sequence) => ({
  id: `history-message-${sequence}` as Message['id'],
  threadId: 'history-thread' as Message['threadId'],
  role: sequence % 2 ? 'assistant' : 'user',
  sequence,
  createdAt: new Date(Date.UTC(2026, 8, 5, 0, 0, sequence)).toISOString(),
  blocks: [
    {
      type: 'text',
      text:
        sequence === 149
          ? '```ts\n' +
            Array.from({ length: 20 }, (_, index) => `const value${index} = ${index};`).join('\n') +
            '\n```'
          : `历史正文 ${sequence}`,
    },
  ],
}));
const entries: MessageNavigationEntry[] = messages.map((message) => ({
  id: message.id,
  sequence: message.sequence,
  role: message.role as MessageNavigationEntry['role'],
  text: `目录摘要 ${message.sequence}`,
  createdAt: message.createdAt,
}));

function page(start: number, end: number): ConversationListMessagesResponse {
  return {
    messages: messages.slice(start, end),
    hasMore: start > 0,
    ...(start > 0 ? { nextCursor: start } : {}),
  };
}

async function fixture() {
  const conversation = {
    id: `history-conversation-${++fixtureIndex}`,
    workspaceId: 'history-workspace',
    taskId: 'history-task',
    track: 'model',
    targetRef: 'history-model',
    title: 'History',
    executionMode: 'full-access',
    createdAt: '2026-09-05T00:00:00Z',
    updatedAt: '2026-09-05T00:00:00Z',
  } as Conversation;
  const props = {
    conversation,
    modelName: 'History model',
    models: [],
    eventHistory: [],
    onTitleUpdated: vi.fn(),
  };
  const view = render(<ChatView {...props} />);
  await screen.findByText('历史正文 148');
  await screen.findByTestId('conversation-minimap-history-message-11');
  expect(
    screen
      .getByRole('navigation', { name: '对话消息导航' })
      .parentElement?.classList.contains('shell-chat-column'),
  ).toBe(true);
  const scroller = view.container.querySelector<HTMLDivElement>('.shell-chat-message-scroller')!;
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: {
      configurable: true,
      get: () => scroller.querySelectorAll('[data-message-id]').length * 100,
    },
    scrollTop: { configurable: true, writable: true, value: 1000 },
  });
  fireEvent.scroll(scroller);
  return { ...view, scroller, props };
}

beforeEach(() => {
  runtime.openTask.mockReset().mockResolvedValue({ task: { threadId: 'history-thread' } });
  runtime.listConversationMessages
    .mockReset()
    .mockImplementation(async (payload: ConversationListMessagesPayload) => {
      if (payload.aroundMessageId) return page(0, 50);
      if (payload.beforeSequence !== undefined)
        return page(Math.max(0, payload.beforeSequence - 50), payload.beforeSequence);
      return page(100, 150);
    });
  runtime.listConversationNavigation
    .mockReset()
    .mockImplementation(async (payload: ConversationListNavigationPayload) =>
      payload.beforeSequence === undefined
        ? { entries: entries.slice(100), hasMore: true, nextCursor: 100 }
        : { entries: entries.slice(0, 100), hasMore: false },
    );
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime } });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) =>
    window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) =>
    window.clearTimeout(handle),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ChatView complete history navigation', () => {
  it('discards an older gap read after a newer navigation intent and keeps loading notices out of message flow', async () => {
    const { scroller } = await fixture();
    fireEvent.click(screen.getByTestId('conversation-minimap-history-message-11'));
    await screen.findByText('历史正文 10');
    await waitFor(() => expect(scroller.dataset.navigationSettling).toBeUndefined());
    let release!: (value: ConversationListMessagesResponse) => void;
    runtime.listConversationMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: '加载中间消息' }));
    await waitFor(() => expect(release).toBeTypeOf('function'));
    fireEvent.click(screen.getByTestId('conversation-minimap-history-message-149'));
    await waitFor(() => expect(scroller.dataset.navigationSettling).toBeUndefined());
    await act(async () => {
      release(page(50, 100));
    });
    expect(screen.queryByText('历史正文 75')).toBeNull();
    expect(screen.getByRole('button', { name: '加载中间消息' }).hasAttribute('disabled')).toBe(
      false,
    );
    runtime.listConversationMessages.mockRejectedValueOnce(new Error('retry fixture'));
    fireEvent.click(screen.getByRole('button', { name: '加载中间消息' }));
    await screen.findByRole('button', { name: '重试最新消息' });
    expect(scroller.querySelector('.shell-history-status')).toBeNull();
  });

  it('bounds the remount cache and restores the correct older cursor after trimming', async () => {
    const view = await fixture();
    fireEvent.click(screen.getByTestId('conversation-minimap-history-message-11'));
    await screen.findByText('历史正文 10');
    await waitFor(() => expect(view.scroller.dataset.navigationSettling).toBeUndefined());
    fireEvent.click(screen.getByRole('button', { name: '加载中间消息' }));
    await screen.findByText('历史正文 75');
    view.unmount();
    const restored = render(<ChatView {...view.props} />);
    await screen.findByText('历史正文 148');
    expect(screen.queryByText('历史正文 10')).toBeNull();
    expect(restored.container.querySelectorAll('[data-message-id]').length).toBe(100);
    const scroller = restored.container.querySelector<HTMLDivElement>(
      '.shell-chat-message-scroller',
    )!;
    fireEvent.scroll(scroller);
    await screen.findByText('历史正文 10');
    expect(runtime.listConversationMessages.mock.lastCall?.[0]).toMatchObject({
      beforeSequence: 50,
    });
  });

  it('loads only an anchor page, keeps expanded code mounted and makes the missing interval explicit', async () => {
    const { container } = await fixture();
    const recent = container.querySelector('[data-message-id="history-message-149"]');
    fireEvent.click(screen.getByRole('button', { name: '展开全部 20 行' }));
    expect(recent?.querySelector('[aria-expanded="true"]')).not.toBeNull();
    fireEvent.click(screen.getByTestId('conversation-minimap-history-message-11'));
    await screen.findByText('历史正文 10');
    expect(runtime.listConversationMessages).toHaveBeenCalledTimes(2);
    expect(runtime.listConversationMessages.mock.lastCall?.[0]).toMatchObject({
      aroundMessageId: 'history-message-10',
      limit: 50,
    });
    expect(container.querySelector('[data-message-id="history-message-149"]')).toBe(recent);
    expect(recent?.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect(screen.getByText('这两段之间的历史消息尚未加载')).toBeTruthy();
    expect(screen.queryByText('历史正文 75')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加载中间消息' }));
    await screen.findByText('历史正文 75');
    expect(screen.queryByText('这两段之间的历史消息尚未加载')).toBeNull();
    expect(container.querySelector('[data-message-id="history-message-149"]')).toBe(recent);
    expect(recent?.querySelector('[aria-expanded="true"]')).not.toBeNull();
  });

  it('discards a pending anchor page when the reader cancels navigation with the wheel', async () => {
    const { scroller } = await fixture();
    let release!: (value: ConversationListMessagesResponse) => void;
    runtime.listConversationMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(screen.getByTestId('conversation-minimap-history-message-11'));
    await waitFor(() => expect(release).toBeTypeOf('function'));
    fireEvent.wheel(scroller, { deltaY: 80 });
    await act(async () => {
      release(page(0, 50));
    });
    expect(screen.queryByText('历史正文 10')).toBeNull();
    expect(scroller.dataset.navigationSettling).toBeUndefined();
    expect(screen.queryByText('正在读取目标附近的消息…')).toBeNull();
  });

  it('keeps old pages and reading state after a failed read and a latest-page retry', async () => {
    const { container } = await fixture();
    fireEvent.click(screen.getByTestId('conversation-minimap-history-message-11'));
    await screen.findByText('历史正文 10');
    const oldRow = container.querySelector('[data-message-id="history-message-10"]');
    runtime.listConversationMessages.mockRejectedValueOnce(
      new Error('read-only worker unavailable'),
    );
    fireEvent.click(screen.getByRole('button', { name: '加载中间消息' }));
    await screen.findByRole('button', { name: '重试最新消息' });
    fireEvent.click(screen.getByRole('button', { name: '重试最新消息' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试最新消息' })).toBeNull());
    expect(container.querySelector('[data-message-id="history-message-10"]')).toBe(oldRow);
    expect(screen.getByText('这两段之间的历史消息尚未加载')).toBeTruthy();
  });

  it('rejects an old anchor response after the same conversation is assigned a different task', async () => {
    const { rerender, props } = await fixture();
    let release!: (value: ConversationListMessagesResponse) => void;
    runtime.listConversationMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(screen.getByTestId('conversation-minimap-history-message-11'));
    await waitFor(() => expect(release).toBeTypeOf('function'));
    runtime.listConversationMessages.mockResolvedValue({ messages: [], hasMore: false });
    runtime.listConversationNavigation.mockResolvedValue({ entries: [], hasMore: false });
    rerender(
      <ChatView
        {...props}
        conversation={{
          ...props.conversation,
          taskId: 'new-history-task' as Conversation['taskId'],
        }}
      />,
    );
    await act(async () => {
      release(page(0, 50));
    });
    expect(screen.queryByText('历史正文 10')).toBeNull();
    expect(screen.queryByText('历史正文 148')).toBeNull();
  });
});
