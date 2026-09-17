/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Conversation, Event } from '@sync-think/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatView } from './ChatView.js';
import { ScrollToBottomButton } from './ScrollToBottomButton.js';

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
  id: 'conversation-jump-to-latest',
  workspaceId: 'workspace-jump-to-latest',
  taskId: 'task-jump-to-latest',
  track: 'model',
  targetRef: 'model-jump-to-latest',
  title: 'Jump to latest',
  executionMode: 'full-access',
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
} as unknown as Conversation;

const models = [
  {
    modelId: 'model-jump-to-latest',
    displayName: 'Jump model',
    providerName: 'Provider',
  },
];

function event(sequence: number, type: string, payload: Record<string, unknown> = {}): Event {
  return {
    id: `event-${sequence}`,
    workspaceId: 'workspace-jump-to-latest',
    taskId: 'task-jump-to-latest',
    runId: 'run-jump-to-latest',
    category: type.startsWith('run.') ? 'run' : 'message',
    type,
    sequence,
    occurredAt: `2026-09-04T00:00:0${sequence}.000Z`,
    payload: { threadId: 'thread-jump-to-latest', ...payload },
  } as unknown as Event;
}

beforeEach(() => {
  resizeObservers.length = 0;
  window.localStorage.removeItem('sync-think.conversationScrollPositions');
  runtime.openTask.mockReset().mockResolvedValue({
    task: { threadId: 'thread-jump-to-latest' },
  });
  runtime.listConversationMessages.mockReset().mockResolvedValue({
    messages: [],
    hasMore: false,
  });
  runtime.getConversationContextStatus.mockReset().mockResolvedValue({
    modelId: 'model-jump-to-latest',
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

describe('ScrollToBottomButton', () => {
  it('stays out of the tab order and hidden until it is visible', () => {
    render(<ScrollToBottomButton visible={false} unread={false} onScrollToBottom={vi.fn()} />);
    const button = screen.getByTestId('scroll-to-bottom');
    expect(button.getAttribute('data-visible')).toBe('false');
    expect(button.getAttribute('aria-hidden')).toBe('true');
    expect(button.getAttribute('tabindex')).toBe('-1');
    expect(screen.queryByLabelText('回到底部，有新内容')).toBeNull();
  });

  it('announces unread output and reports the click', () => {
    const onScrollToBottom = vi.fn();
    render(<ScrollToBottomButton visible unread onScrollToBottom={onScrollToBottom} />);
    const button = screen.getByTestId('scroll-to-bottom');
    expect(button.getAttribute('data-unread')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('回到底部，有新内容');
    expect(button.getAttribute('tabindex')).toBe('0');
    fireEvent.click(button);
    expect(onScrollToBottom).toHaveBeenCalledTimes(1);
  });
});

describe('ChatView jump to latest', () => {
  it('appears only after the reader leaves the tail, and returns them on click', async () => {
    const { container } = render(
      <ChatView
        conversation={conversation}
        modelName="Jump model"
        models={models}
        eventHistory={[event(1, 'run.started'), event(2, 'message.reasoning_delta', { textDelta: '正在核对。' })]}
        onTitleUpdated={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('think-row-summary').textContent).toBe('正在核对。'),
    );

    const scroller = container.querySelector('.shell-chat-message-scroller') as HTMLDivElement;
    let scrollTop = 0;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => 600 },
      scrollHeight: { configurable: true, get: () => 1600 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });

    const button = screen.getByTestId('scroll-to-bottom');
    expect(button.getAttribute('data-visible')).toBe('false');

    // 1000px from the tail: past the stick threshold, so the affordance shows.
    scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(button.getAttribute('data-visible')).toBe('true');
    // No output landed while the reader was away, so nothing reads as unread.
    expect(button.getAttribute('data-unread')).toBeNull();

    // Inside the threshold the reader counts as back at the tail.
    scrollTop = 960;
    fireEvent.scroll(scroller);
    expect(button.getAttribute('data-visible')).toBe('false');

    // Leave again, then let the click bring them home and re-arm the pin.
    scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(button.getAttribute('data-visible')).toBe('true');
    fireEvent.click(button);
    expect(scrollTop).toBe(1000);
    expect(button.getAttribute('data-visible')).toBe('false');
    expect(button.getAttribute('data-unread')).toBeNull();
  });

  it('marks the button unread when output lands while the reader is away', async () => {
    const { container, rerender } = render(
      <ChatView
        conversation={conversation}
        modelName="Jump model"
        models={models}
        eventHistory={[
          event(1, 'run.started'),
          event(2, 'message.reasoning_delta', { textDelta: '初始输出。' }),
        ]}
        onTitleUpdated={vi.fn()}
      />,
    );

    // Wait for the initial load and streaming render to settle before scrolling.
    // Landing the reader while that request is still in flight would let the
    // restore pass re-pin the viewport to the tail right afterwards.
    await waitFor(() =>
      expect(screen.getByTestId('think-row-summary').textContent).toBe('初始输出。'),
    );

    const scroller = container.querySelector('.shell-chat-message-scroller') as HTMLDivElement;
    let scrollTop = 0;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => 600 },
      scrollHeight: { configurable: true, get: () => 1600 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });

    const button = screen.getByTestId('scroll-to-bottom');
    // A real reader scrolls up from the tail. The first event only clears the
    // programmatic write the mount pin left behind; the second is the gesture
    // that actually releases the follow-the-tail pin.
    scrollTop = 1000;
    fireEvent.scroll(scroller);
    scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(button.getAttribute('data-unread')).toBeNull();

    // New assistant output arrives while the viewport sits 1000px above the tail.
    act(() => {
      rerender(
        <ChatView
          conversation={conversation}
          modelName="Jump model"
          models={models}
          eventHistory={[
            event(1, 'run.started'),
            event(2, 'message.reasoning_delta', { textDelta: '初始输出。' }),
            event(3, 'message.reasoning_delta', { textDelta: '离线期间的新增输出。' }),
          ]}
          onTitleUpdated={vi.fn()}
        />,
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId('think-row-summary').textContent).toContain('离线期间的新增输出。'),
    );
    expect(scrollTop).toBe(0);
    expect(button.getAttribute('data-visible')).toBe('true');
    await waitFor(() => expect(button.getAttribute('data-unread')).toBe('true'));
  });
});
