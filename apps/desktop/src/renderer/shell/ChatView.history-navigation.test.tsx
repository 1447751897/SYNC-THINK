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
  expect(scroller.querySelectorAll('[data-message-id]')).toHaveLength(12);
  return { ...view, scroller, props };
}

async function revealHistoryGap(scroller: HTMLDivElement) {
  fireEvent.wheel(scroller, { deltaY: 120 });
  scroller.scrollTop = 45 * 220;
  fireEvent.scroll(scroller);
  try {
    return await screen.findByRole('button', { name: '加载中间消息' });
  } catch (error) {
    const ids = [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')].map(
      (node) => node.dataset.messageId,
    );
    throw new Error(`gap not mounted; ids=${ids.at(0)}..${ids.at(-1)} count=${ids.length}`, {
      cause: error,
    });
  }
}

async function revealVirtualMessage(sequence: number) {
  fireEvent.click(screen.getByTestId(`conversation-minimap-history-message-${sequence}`));
  return screen.findByText(`历史正文 ${sequence}`);
}

async function waitForHistoryLoad() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /加载更早消息/ }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
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
    const gapButton = await revealHistoryGap(scroller);
    let release!: (value: ConversationListMessagesResponse) => void;
    runtime.listConversationMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(gapButton);
    await waitFor(() => expect(release).toBeTypeOf('function'));
    fireEvent.click(screen.getByTestId('conversation-minimap-history-message-149'));
    await waitFor(() => expect(scroller.dataset.navigationSettling).toBeUndefined());
    await act(async () => {
      release(page(50, 100));
    });
    expect(screen.queryByText('历史正文 75')).toBeNull();
    const retryGapButton = await revealHistoryGap(scroller);
    expect(retryGapButton.hasAttribute('disabled')).toBe(false);
    const failedGapCalls = runtime.listConversationMessages.mock.calls.length;
    runtime.listConversationMessages.mockRejectedValueOnce(new Error('retry fixture'));
    fireEvent.click(retryGapButton);
    await waitFor(() =>
      expect(runtime.listConversationMessages).toHaveBeenCalledTimes(failedGapCalls + 1),
    );
    expect(screen.queryByRole('button', { name: '重试最新消息' })).toBeNull();
    expect(screen.queryByText('历史消息读取失败，请重试导航或加载操作。')).toBeNull();
    expect(scroller.querySelector('.shell-history-status')).toBeNull();
    // The request count changes before rejection/finally clears the loading state.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '加载中间消息' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
  });

  it('renders the bounded remount cache immediately, refreshes it, and keeps the older cursor', async () => {
    const view = await fixture();
    fireEvent.click(screen.getByTestId('conversation-minimap-history-message-11'));
    await screen.findByText('历史正文 10');
    await waitFor(() => expect(view.scroller.dataset.navigationSettling).toBeUndefined());
    fireEvent.click(await revealHistoryGap(view.scroller));
    await waitForHistoryLoad();
    await revealVirtualMessage(75);
    const callsBeforeRemount = runtime.listConversationMessages.mock.calls.length;
    view.unmount();
    const restored = render(<ChatView {...view.props} />);
    await screen.findByText('历史正文 148');
    await waitFor(() =>
      expect(runtime.listConversationMessages).toHaveBeenCalledTimes(callsBeforeRemount + 1),
    );
    expect(screen.queryByText('历史正文 10')).toBeNull();
    expect(restored.container.querySelectorAll('[data-message-id]').length).toBe(12);
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息（88）' }));
    await waitFor(() =>
      expect(restored.container.querySelectorAll('[data-message-id]').length).toBe(52),
    );
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息（48）' }));
    await waitFor(() =>
      expect(restored.container.querySelectorAll('[data-message-id]').length).toBeLessThan(24),
    );
    expect(restored.container.querySelector('[data-message-window-spacer="bottom"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息（8）' }));
    await waitFor(() =>
      expect(restored.container.querySelectorAll('[data-message-id]').length).toBeLessThan(24),
    );
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
    await waitFor(() =>
      expect(runtime.listConversationMessages.mock.lastCall?.[0]).toMatchObject({
        beforeSequence: 50,
      }),
    );
    fireEvent.click(screen.getByTestId('conversation-minimap-history-message-11'));
    await screen.findByText('历史正文 10');
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
    expect(container.querySelector('[data-message-id="history-message-149"]')).toBeNull();
    expect(recent?.querySelector('[aria-expanded="true"]')).not.toBeNull();
    const scroller = container.querySelector<HTMLDivElement>('.shell-chat-message-scroller')!;
    await revealHistoryGap(scroller);
    expect(screen.getByText('这两段之间的历史消息尚未加载')).toBeTruthy();
    expect(screen.queryByText('历史正文 75')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加载中间消息' }));
    await waitForHistoryLoad();
    await revealVirtualMessage(75);
    expect(screen.queryByText('这两段之间的历史消息尚未加载')).toBeNull();
    fireEvent.click(screen.getByTestId('conversation-minimap-history-message-149'));
    await screen.findByText('历史正文 148');
    expect(
      container
        .querySelector('[data-message-id="history-message-149"]')
        ?.querySelector('[aria-expanded="true"]'),
    ).not.toBeNull();
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

  it('keeps old pages and reading state after a failed gap read and a gap retry', async () => {
    const { container } = await fixture();
    const scroller = container.querySelector<HTMLDivElement>('.shell-chat-message-scroller')!;
    fireEvent.click(screen.getByTestId('conversation-minimap-history-message-11'));
    await screen.findByText('历史正文 10');
    const oldRow = container.querySelector('[data-message-id="history-message-10"]');
    const gapButton = await revealHistoryGap(scroller);
    const failedGapCalls = runtime.listConversationMessages.mock.calls.length;
    runtime.listConversationMessages.mockRejectedValueOnce(
      new Error('read-only worker unavailable'),
    );
    fireEvent.click(gapButton);
    await waitFor(() =>
      expect(runtime.listConversationMessages).toHaveBeenCalledTimes(failedGapCalls + 1),
    );
    expect(screen.queryByRole('button', { name: '重试最新消息' })).toBeNull();
    expect(oldRow).toBeTruthy();
    expect(screen.getByText('这两段之间的历史消息尚未加载')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '加载中间消息' }));
    await waitForHistoryLoad();
    await revealVirtualMessage(75);
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
