/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Conversation, Event } from '@sync-think/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatView } from './ChatView.js';

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
  resizeObservers.length = 0;
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
});
