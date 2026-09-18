/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Conversation, Event, Message } from '@sync-think/shared';
import type { ConversationListMessagesResponse } from '@sync-think/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatView, resetRecentConversationPageCacheForTests } from './ChatView.js';

interface ResizeObserverProbe {
  callback: ResizeObserverCallback;
  active: boolean;
  target?: Element;
}

const resizeObservers: ResizeObserverProbe[] = [];
const runtime = {
  getConversationContextStatus: vi.fn(),
  listConversationMessages: vi.fn(),
  openTask: vi.fn(),
};

const conversation = {
  id: 'conversation-scroll-anchor',
  workspaceId: 'workspace-scroll-anchor',
  taskId: 'task-scroll-anchor',
  track: 'model',
  targetRef: 'model-scroll-anchor',
  title: 'Scroll anchor',
  executionMode: 'full-access',
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
} as unknown as Conversation;

function conversationFixture(id: string): Conversation {
  return {
    id,
    workspaceId: 'workspace-scroll-anchor',
    taskId: `task-${id}`,
    track: 'model',
    targetRef: 'model-scroll-anchor',
    title: id,
    executionMode: 'full-access',
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
  } as unknown as Conversation;
}

function durableMessage(conversationId: string, sequence: number, text: string): Message {
  return {
    id: `${conversationId}-message-${sequence}` as Message['id'],
    threadId: `thread-${conversationId}` as Message['threadId'],
    role: sequence % 2 === 0 ? 'user' : 'assistant',
    sequence,
    createdAt: `2026-09-04T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    blocks: [{ type: 'text', text }],
  };
}

function event(sequence: number, type: string, payload: Record<string, unknown> = {}): Event {
  return {
    id: `event-${sequence}`,
    workspaceId: 'workspace-scroll-anchor',
    taskId: 'task-scroll-anchor',
    runId: 'run-scroll-anchor',
    category: type.startsWith('run.') ? 'run' : 'message',
    type,
    sequence,
    occurredAt: `2026-09-04T00:00:0${sequence}.000Z`,
    payload: { threadId: 'thread-scroll-anchor', ...payload },
  } as unknown as Event;
}

beforeEach(() => {
  resetRecentConversationPageCacheForTests();
  resizeObservers.length = 0;
  window.localStorage.removeItem('sync-think.conversationScrollPositions');
  runtime.openTask.mockReset().mockResolvedValue({
    task: { threadId: 'thread-scroll-anchor' },
  });
  runtime.listConversationMessages.mockReset().mockResolvedValue({
    messages: [],
    hasMore: false,
  });
  runtime.getConversationContextStatus.mockReset().mockResolvedValue({
    modelId: 'model-scroll-anchor',
    contextWindow: 128_000,
    modelContextWindow: 128_000,
    contextWindowSource: 'model-default',
    estimatedUsedTokens: 0,
    usageRatio: 0,
    compactThreshold: 0.7,
    sections: [],
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserverMock {
      private readonly probe: ResizeObserverProbe;

      constructor(callback: ResizeObserverCallback) {
        this.probe = { callback, active: false };
        resizeObservers.push(this.probe);
      }

      observe(target: Element) {
        this.probe.target = target;
        this.probe.active = true;
      }

      unobserve() {}
      disconnect() {
        this.probe.active = false;
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ChatView streaming scroll anchor', () => {
  it('restores messages and the saved position when switching A -> B -> A in one view', async () => {
    const conversationA = conversationFixture('conversation-switch-a');
    const conversationB = conversationFixture('conversation-switch-b');
    runtime.listConversationMessages.mockImplementation(
      async ({ conversationId }: { conversationId: string }): Promise<ConversationListMessagesResponse> => {
        const id = String(conversationId);
        const message = durableMessage(id, 1, `消息来自 ${id}`);
        return { messages: [message], hasMore: false };
      },
    );

    const { container, rerender } = render(
      <ChatView
        conversation={conversationA}
        modelName="Scroll model"
        models={[]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );
    await screen.findByText('消息来自 conversation-switch-a');

    const scroller = container.querySelector('.shell-chat-message-scroller') as HTMLDivElement;
    let scrollTop = 1_400;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => 600 },
      scrollHeight: { configurable: true, get: () => 2_000 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });
    fireEvent.scroll(scroller);
    scrollTop = 800;
    fireEvent.scroll(scroller);
    await waitFor(() =>
      expect(window.localStorage.getItem('sync-think.conversationScrollPositions')).toContain(
        'conversation-switch-a',
      ),
    );
    expect(window.localStorage.getItem('sync-think.conversationScrollPositions')).toContain(
      '"stickToBottom":false',
    );

    rerender(
      <ChatView
        conversation={conversationB}
        modelName="Scroll model"
        models={[]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );
    await waitFor(() => expect(runtime.listConversationMessages).toHaveBeenCalledTimes(2));
    await screen.findByText('消息来自 conversation-switch-b');

    rerender(
      <ChatView
        conversation={conversationA}
        modelName="Scroll model"
        models={[]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );
    await screen.findByText('消息来自 conversation-switch-a');

    await waitFor(() => expect(runtime.listConversationMessages).toHaveBeenCalledTimes(3));
    expect(scrollTop).toBe(800);
  });

  it('does not let an older conversation response replace the active conversation', async () => {
    const conversationA = conversationFixture('conversation-race-a');
    const conversationB = conversationFixture('conversation-race-b');
    let releaseA!: (response: ConversationListMessagesResponse) => void;
    let releaseB!: (response: ConversationListMessagesResponse) => void;
    runtime.listConversationMessages.mockImplementation(
      ({ conversationId }: { conversationId: string }) =>
        new Promise<ConversationListMessagesResponse>((resolve) => {
          if (conversationId === conversationA.id) releaseA = resolve;
          else releaseB = resolve;
        }),
    );

    const { rerender } = render(
      <ChatView
        conversation={conversationA}
        modelName="Scroll model"
        models={[]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );
    await waitFor(() => expect(releaseA).toBeTypeOf('function'));

    rerender(
      <ChatView
        conversation={conversationB}
        modelName="Scroll model"
        models={[]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );
    await waitFor(() => expect(releaseB).toBeTypeOf('function'));

    await act(async () => {
      releaseA({
        messages: [durableMessage(String(conversationA.id), 1, '旧会话响应')],
        hasMore: false,
      });
    });
    expect(screen.queryByText('旧会话响应')).toBeNull();

    await act(async () => {
      releaseB({
        messages: [durableMessage(String(conversationB.id), 1, '当前会话响应')],
        hasMore: false,
      });
    });
    expect(await screen.findByText('当前会话响应')).toBeTruthy();
    expect(screen.queryByText('旧会话响应')).toBeNull();
  });

  it('restores a conversation scroll position after the view is remounted', async () => {
    let scrollTop = 0;
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLDivElement.prototype,
      'scrollHeight',
    );
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLDivElement.prototype,
      'clientHeight',
    );
    const originalScrollTop = Object.getOwnPropertyDescriptor(
      HTMLDivElement.prototype,
      'scrollTop',
    );
    Object.defineProperties(HTMLDivElement.prototype, {
      scrollHeight: {
        configurable: true,
        get() {
          return this.classList.contains('shell-chat-message-scroller') ? 1600 : 0;
        },
      },
      clientHeight: {
        configurable: true,
        get() {
          return this.classList.contains('shell-chat-message-scroller') ? 600 : 0;
        },
      },
      scrollTop: {
        configurable: true,
        get() {
          return this.classList.contains('shell-chat-message-scroller') ? scrollTop : 0;
        },
        set(value: number) {
          if (this.classList.contains('shell-chat-message-scroller')) scrollTop = value;
        },
      },
    });

    try {
      const first = render(
        <ChatView
          conversation={conversation}
          modelName="Scroll model"
          models={[]}
          eventHistory={[]}
          onTitleUpdated={vi.fn()}
        />,
      );
      const scroller = await screen
        .findByTestId('compose-input')
        .then(() => first.container.querySelector('.shell-chat-message-scroller'));
      expect(scroller).toBeTruthy();
      scrollTop = 1000;
      fireEvent.scroll(scroller!);
      scrollTop = 500;
      fireEvent.scroll(scroller!);
      await waitFor(() =>
        expect(window.localStorage.getItem('sync-think.conversationScrollPositions')).toContain(
          '500',
        ),
      );
      first.unmount();

      const second = render(
        <ChatView
          conversation={conversation}
          modelName="Scroll model"
          models={[]}
          eventHistory={[]}
          onTitleUpdated={vi.fn()}
        />,
      );
      await screen.findByTestId('compose-input');
      expect(second.container.querySelector('.shell-chat-message-scroller')).toBeTruthy();
      expect(scrollTop).toBe(500);
    } finally {
      if (originalScrollHeight)
        Object.defineProperty(HTMLDivElement.prototype, 'scrollHeight', originalScrollHeight);
      else delete (HTMLDivElement.prototype as { scrollHeight?: number }).scrollHeight;
      if (originalClientHeight)
        Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', originalClientHeight);
      else delete (HTMLDivElement.prototype as { clientHeight?: number }).clientHeight;
      if (originalScrollTop)
        Object.defineProperty(HTMLDivElement.prototype, 'scrollTop', originalScrollTop);
      else delete (HTMLDivElement.prototype as { scrollTop?: number }).scrollTop;
    }
  });

  it.each([true, false])(
    'follows reasoning growth only while the reader stays pinned: %s',
    async (following) => {
      const events = [
        event(1, 'run.started'),
        event(2, 'message.reasoning_delta', { textDelta: '正在核对联网搜索能力。' }),
      ];
      const { container } = render(
        <ChatView
          conversation={conversation}
          modelName="Scroll model"
          models={[
            {
              modelId: 'model-scroll-anchor',
              displayName: 'Scroll model',
              providerName: 'Provider',
            },
          ]}
          eventHistory={events}
          onTitleUpdated={vi.fn()}
        />,
      );

      await waitFor(() =>
        expect(screen.getByTestId('think-row-summary').textContent).toBe('正在核对联网搜索能力。'),
      );

      const scroller = container.querySelector('.shell-chat-message-scroller') as HTMLDivElement;
      const content = container.querySelector(
        '.shell-chat-content:not(.shell-chat-content--composer)',
      );
      await waitFor(() => {
        expect(
          resizeObservers.some((observer) => observer.active && observer.target === content),
        ).toBe(true);
      });
      const mainObserver = resizeObservers.find(
        (observer) => observer.active && observer.target === content,
      )!;

      let scrollHeight = 900;
      let scrollTop = 300;
      const writes: number[] = [];
      Object.defineProperties(scroller, {
        clientHeight: { configurable: true, get: () => 600 },
        scrollHeight: { configurable: true, get: () => scrollHeight },
        scrollTop: {
          configurable: true,
          get: () => scrollTop,
          set: (value: number) => {
            writes.push(value);
            scrollTop = value;
          },
        },
      });

      if (!following) {
        scrollTop = 0;
        fireEvent.wheel(scroller, { deltaY: -30 });
      }
      for (const nextHeight of [930, 960, 990]) {
        scrollHeight = nextHeight;
        act(() => mainObserver.callback([], {} as ResizeObserver));
      }

      expect(writes).toEqual(following ? [330, 360, 390] : []);
      expect(scrollTop).toBe(following ? 390 : 0);
    },
  );

  it('keeps following after html/mermaid layout clamps scrollTop while still at the tail', async () => {
    const events = [
      event(1, 'run.started'),
      event(2, 'message.reasoning_delta', { textDelta: '正在核对联网搜索能力。' }),
    ];
    const { container } = render(
      <ChatView
        conversation={conversation}
        modelName="Scroll model"
        models={[
          {
            modelId: 'model-scroll-anchor',
            displayName: 'Scroll model',
            providerName: 'Provider',
          },
        ]}
        eventHistory={events}
        onTitleUpdated={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('think-row-summary').textContent).toBe('正在核对联网搜索能力。'),
    );

    const scroller = container.querySelector('.shell-chat-message-scroller') as HTMLDivElement;
    const content = container.querySelector(
      '.shell-chat-content:not(.shell-chat-content--composer)',
    );
    await waitFor(() => {
      expect(
        resizeObservers.some((observer) => observer.active && observer.target === content),
      ).toBe(true);
    });
    const mainObserver = resizeObservers.find(
      (observer) => observer.active && observer.target === content,
    )!;

    let scrollHeight = 900;
    let scrollTop = 300;
    const writes: number[] = [];
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => 600 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          writes.push(value);
          scrollTop = value;
        },
      },
    });

    scrollHeight = 820;
    scrollTop = 220;
    fireEvent.scroll(scroller);

    scrollHeight = 860;
    act(() => mainObserver.callback([], {} as ResizeObserver));

    expect(writes).toEqual([260]);
    expect(scrollTop).toBe(260);
  });

  it('follows streaming think growth from the live tail even without a resize frame', async () => {
    const { container, rerender } = render(
      <ChatView
        conversation={conversation}
        modelName="Scroll model"
        models={[
          {
            modelId: 'model-scroll-anchor',
            displayName: 'Scroll model',
            providerName: 'Provider',
          },
        ]}
        eventHistory={[
          event(1, 'run.started'),
          event(2, 'message.reasoning_delta', { textDelta: '正在核对联网搜索能力。' }),
        ]}
        onTitleUpdated={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('think-row-summary').textContent).toBe('正在核对联网搜索能力。'),
    );

    const scroller = container.querySelector('.shell-chat-message-scroller') as HTMLDivElement;
    let scrollHeight = 900;
    let scrollTop = 300;
    const writes: number[] = [];
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => 600 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          writes.push(value);
          scrollTop = value;
        },
      },
    });

    scrollHeight = 1040;
    rerender(
      <ChatView
        conversation={conversation}
        modelName="Scroll model"
        models={[
          {
            modelId: 'model-scroll-anchor',
            displayName: 'Scroll model',
            providerName: 'Provider',
          },
        ]}
        eventHistory={[
          event(1, 'run.started'),
          event(2, 'message.reasoning_delta', { textDelta: '正在核对联网搜索能力。' }),
          event(3, 'message.reasoning_delta', { textDelta: '接着核对工具结果并继续往下写。' }),
        ]}
        onTitleUpdated={vi.fn()}
      />,
    );

    await waitFor(() => expect(writes).toEqual([440]));
    expect(scrollTop).toBe(440);
  });

  it('continues following ordinary content growth outside a reasoning-only stream', async () => {
    const { container } = render(
      <ChatView
        conversation={conversation}
        modelName="Scroll model"
        models={[
          {
            modelId: 'model-scroll-anchor',
            displayName: 'Scroll model',
            providerName: 'Provider',
          },
        ]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );

    await screen.findByTestId('compose-input');
    const scroller = container.querySelector('.shell-chat-message-scroller') as HTMLDivElement;
    const content = container.querySelector(
      '.shell-chat-content:not(.shell-chat-content--composer)',
    );
    await waitFor(() => {
      expect(
        resizeObservers.some((observer) => observer.active && observer.target === content),
      ).toBe(true);
    });
    const mainObserver = resizeObservers.find(
      (observer) => observer.active && observer.target === content,
    )!;

    let scrollHeight = 900;
    let scrollTop = 300;
    const writes: number[] = [];
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => 600 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          writes.push(value);
          scrollTop = value;
        },
      },
    });

    scrollHeight = 930;
    act(() => mainObserver.callback([], {} as ResizeObserver));

    expect(writes).toEqual([330]);
    expect(scrollTop).toBe(330);
  });

  it('restores the saved position after the view unmounts and remounts (DSH route: no DOM keep-alive)', async () => {
    // DeepSeek Harness keeps no conversation DOM alive: switching sessions
    // unmounts the old ChatView and remounts a fresh one, and the reading
    // position survives purely via the unbounded conversationScrollPositions
    // map. This test exercises exactly that — full unmount, then a brand-new
    // mount whose restoredScrollPositionRef starts at null.
    const conversationA = conversationFixture('conversation-remount-a');
    runtime.listConversationMessages.mockImplementation(
      async ({
        conversationId,
      }: {
        conversationId: string;
      }): Promise<ConversationListMessagesResponse> => {
        const id = String(conversationId);
        return { messages: [durableMessage(id, 1, `消息来自 ${id}`)], hasMore: false };
      },
    );

    const { container, unmount } = render(
      <ChatView
        conversation={conversationA}
        modelName="Scroll model"
        models={[]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );
    await screen.findByText('消息来自 conversation-remount-a');

    const scroller = container.querySelector(
      '.shell-chat-message-scroller',
    ) as HTMLDivElement;
    let scrollTop = 1_400;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => 600 },
      scrollHeight: { configurable: true, get: () => 2_000 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });
    fireEvent.scroll(scroller);
    scrollTop = 750;
    fireEvent.scroll(scroller);
    await waitFor(() =>
      expect(window.localStorage.getItem('sync-think.conversationScrollPositions')).toContain(
        'conversation-remount-a',
      ),
    );

    // DSH route: the surface unmounts on switch. The cleanup effect must flush
    // the position to the map before the DOM node is gone.
    unmount();

    // A fresh mount later — a brand-new ChatView instance with a reset
    // restoredScrollPositionRef, exactly like switching back to this session.
    const second = render(
      <ChatView
        conversation={conversationA}
        modelName="Scroll model"
        models={[]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );
    await screen.findByText('消息来自 conversation-remount-a');

    const scroller2 = second.container.querySelector(
      '.shell-chat-message-scroller',
    ) as HTMLDivElement;
    let scrollTop2 = 0;
    Object.defineProperties(scroller2, {
      clientHeight: { configurable: true, get: () => 600 },
      scrollHeight: { configurable: true, get: () => 2_000 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop2,
        set: (value: number) => {
          scrollTop2 = value;
        },
      },
    });
    // The saved anchor must be replayed onto the fresh DOM node.
    await waitFor(() => expect(scrollTop2).toBe(750));
  });
});
