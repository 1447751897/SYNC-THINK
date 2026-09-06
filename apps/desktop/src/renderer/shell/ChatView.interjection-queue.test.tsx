/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Event } from '@sync-think/shared';
import { ChatView } from './ChatView.js';

const runtime = {
  appendMessage: vi.fn(),
  listConversationMessages: vi.fn(),
  openTask: vi.fn(),
  sendConversationMessage: vi.fn(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

function conversation(id = 'conversation-queue'): Conversation {
  return {
    id,
    workspaceId: 'workspace-queue',
    taskId: `task-${id}`,
    track: 'model',
    targetRef: 'model-a',
    title: 'Queue test',
    executionMode: 'full-access',
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
  } as unknown as Conversation;
}

function eventAt(
  current: Conversation,
  sequence: number,
  type: 'run.started' | 'run.completed',
): Event {
  return {
    id: `${current.id}-event-${sequence}`,
    workspaceId: current.workspaceId,
    taskId: current.taskId,
    runId: `run-${current.id}`,
    category: 'run',
    type,
    sequence,
    occurredAt: `2026-08-08T10:00:0${sequence}.000Z`,
    payload: { threadId: `thread-${current.id}` },
  } as unknown as Event;
}

function activeEvents(current: Conversation): Event[] {
  return [eventAt(current, 1, 'run.started')];
}

function terminalEvents(current: Conversation): Event[] {
  return [
    eventAt(current, 1, 'run.started'),
    eventAt(current, 2, 'run.completed'),
  ];
}

function renderChat(current: Conversation, events: readonly Event[]) {
  return render(
    <ChatView
      conversation={current}
      modelName="Model A"
      models={[
        { modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' },
        { modelId: 'model-b', displayName: 'GPT-5.6 Luna', providerName: 'Provider' },
      ]}
      eventHistory={events}
      onTitleUpdated={vi.fn()}
    />,
  );
}

function rerenderChat(
  view: ReturnType<typeof renderChat>,
  current: Conversation,
  events: readonly Event[],
  runtimeConnectionRevision = 0,
) {
  view.rerender(
    <ChatView
      conversation={current}
      modelName="Model A"
      models={[
        { modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' },
        { modelId: 'model-b', displayName: 'GPT-5.6 Luna', providerName: 'Provider' },
      ]}
      eventHistory={events}
      runtimeConnectionRevision={runtimeConnectionRevision}
      onTitleUpdated={vi.fn()}
    />,
  );
}

async function waitForInitialLoad() {
  await waitFor(() => expect(runtime.listConversationMessages).toHaveBeenCalled());
}

async function queueRequest(text: string) {
  fireEvent.change(screen.getByTestId('compose-input'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('compose-send'));
  expect(await screen.findByText(text)).toBeTruthy();
}

async function selectLuna() {
  fireEvent.click(screen.getByTitle(/切换模型/));
  const provider = await screen.findByTestId('model-provider-Provider');
  provider.focus();
  fireEvent.keyDown(provider, { key: 'ArrowRight' });
  fireEvent.click(await screen.findByText('GPT-5.6 Luna'));
}

function queuedItemId(): string {
  const item = document.querySelector<HTMLElement>(
    '[data-testid^="compose-request-queue-item-"]',
  );
  if (!item) throw new Error('queued compose request is missing');
  return item.dataset.testid!.replace('compose-request-queue-item-', '');
}

beforeEach(() => {
  window.localStorage.clear();
  runtime.appendMessage.mockReset().mockResolvedValue({
    messageId: 'message-queue',
    taskVersion: 1,
  });
  runtime.listConversationMessages.mockReset().mockResolvedValue({
    messages: [],
    hasMore: false,
  });
  runtime.openTask.mockReset().mockImplementation(({ taskId }: { taskId: string }) =>
    Promise.resolve({ task: { threadId: `thread-${taskId.replace(/^task-/, '')}` } }),
  );
  runtime.sendConversationMessage.mockReset().mockImplementation(
    ({ conversationId }: { conversationId: string }) =>
      Promise.resolve({
        threadId: `thread-${conversationId}`,
        taskVersion: 0,
        conversationTitle: 'Queue test',
      }),
  );
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ChatView queued requests and interjection', () => {
  it('uses one action slot and keeps running drafts on the queue send path', async () => {
    const current = conversation('conversation-action-slot');
    renderChat(current, activeEvents(current));
    await waitForInitialLoad();

    expect(screen.getByTestId('compose-stop')).toBeTruthy();
    expect(screen.queryByTestId('compose-voice')).toBeNull();
    expect(screen.queryByTestId('compose-send')).toBeNull();

    fireEvent.change(screen.getByTestId('compose-input'), {
      target: { value: '运行中排队的新需求' },
    });
    expect(screen.getByTestId('compose-send')).toBeTruthy();
    expect(screen.queryByTestId('compose-stop')).toBeNull();
    expect(screen.queryByTestId('compose-voice')).toBeNull();

    fireEvent.click(screen.getByTestId('compose-send'));
    expect(await screen.findByText('运行中排队的新需求')).toBeTruthy();
    expect(runtime.sendConversationMessage).not.toHaveBeenCalled();
    expect(runtime.appendMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId('compose-stop')).toBeTruthy();
    expect(screen.queryByTestId('compose-send')).toBeNull();
  });

  it('keeps a request above the composer without sending it while a Run is active', async () => {
    const current = conversation();
    renderChat(current, activeEvents(current));
    await waitForInitialLoad();

    await queueRequest('等当前任务完成后检查测试');

    expect(runtime.sendConversationMessage).not.toHaveBeenCalled();
    expect(runtime.appendMessage).not.toHaveBeenCalled();
    const queue = screen.getByTestId('compose-request-queue');
    const input = screen.getByTestId('compose-input');
    expect(queue.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('当前回复完成后按顺序执行')).toBeTruthy();
  });

  it('allows a queued request to be edited and deleted before dispatch', async () => {
    const current = conversation();
    renderChat(current, activeEvents(current));
    await waitForInitialLoad();
    await queueRequest('旧需求');
    const requestId = queuedItemId();

    fireEvent.click(screen.getByTestId(`compose-request-edit-${requestId}`));
    fireEvent.change(screen.getByTestId(`compose-request-edit-input-${requestId}`), {
      target: { value: '编辑后的需求' },
    });
    fireEvent.click(screen.getByTestId(`compose-request-edit-save-${requestId}`));
    expect(await screen.findByText('编辑后的需求')).toBeTruthy();

    fireEvent.click(screen.getByTestId(`compose-request-delete-${requestId}`));
    expect(screen.queryByTestId('compose-request-queue')).toBeNull();
    expect(runtime.sendConversationMessage).not.toHaveBeenCalled();
    expect(runtime.appendMessage).not.toHaveBeenCalled();
  });

  it('only supersedes the current Run after the user clicks 插话', async () => {
    const current = conversation();
    renderChat(current, activeEvents(current));
    await waitForInitialLoad();
    await queueRequest('立即改做新的方向');
    const requestId = queuedItemId();

    expect(runtime.appendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(`compose-request-interject-${requestId}`));

    await waitFor(() =>
      expect(runtime.appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'user',
          text: '立即改做新的方向',
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByTestId('compose-request-queue')).toBeNull());
  });

  it('dispatches an interjection with the model selected at dispatch time', async () => {
    const current = conversation();
    renderChat(current, activeEvents(current));
    await waitForInitialLoad();
    await queueRequest('切换模型后立即插话');
    const requestId = queuedItemId();

    await selectLuna();
    fireEvent.click(screen.getByTestId(`compose-request-interject-${requestId}`));

    await waitFor(() =>
      expect(runtime.appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '切换模型后立即插话',
          modelId: 'model-b',
        }),
      ),
    );
  });

  it('does not auto-dispatch a queued request while the current Run is still active', async () => {
    const current = conversation();
    renderChat(current, activeEvents(current));
    await waitForInitialLoad();
    await queueRequest('排队不应打断当前回复');
    expect(runtime.appendMessage).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      await act(async () => {
        vi.advanceTimersByTime(7_000);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(runtime.appendMessage).not.toHaveBeenCalled();
    expect(runtime.sendConversationMessage).not.toHaveBeenCalled();
    expect(screen.getByText('排队不应打断当前回复')).toBeTruthy();
    expect(screen.queryByText('回答已中断')).toBeNull();
  });

  it('automatically dispatches the FIFO head after the current Run becomes terminal', async () => {
    const current = conversation();
    const view = renderChat(current, activeEvents(current));
    await waitForInitialLoad();
    await queueRequest('第一个后续需求');
    await queueRequest('第二个后续需求');

    rerenderChat(view, current, terminalEvents(current));

    await waitFor(() => expect(runtime.appendMessage).toHaveBeenCalledTimes(1));
    expect(runtime.appendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ text: '第一个后续需求' }),
    );
    expect(screen.getByText('第二个后续需求')).toBeTruthy();
  });

  it('keeps a failed automatic request queued without retrying forever, then retries on demand', async () => {
    runtime.appendMessage
      .mockRejectedValueOnce(new Error('append failed'))
      .mockResolvedValueOnce({ messageId: 'message-retry', taskVersion: 2 });
    const current = conversation();
    const view = renderChat(current, activeEvents(current));
    await waitForInitialLoad();
    await queueRequest('失败后保留');
    const requestId = queuedItemId();

    rerenderChat(view, current, terminalEvents(current));

    expect(await screen.findByText('自动执行失败，需求已保留，可点击重试')).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    expect(runtime.appendMessage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId(`compose-request-interject-${requestId}`));
    await waitFor(() => expect(runtime.appendMessage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('compose-request-queue')).toBeNull());
  });

  it('does not dispatch the same queued request twice across reconnect renders', async () => {
    const pending = deferred<{ messageId: string; taskVersion: number }>();
    runtime.appendMessage.mockReturnValueOnce(pending.promise);
    const current = conversation();
    const view = renderChat(current, activeEvents(current));
    await waitForInitialLoad();
    await queueRequest('只发送一次');

    rerenderChat(view, current, terminalEvents(current), 0);
    await waitFor(() => expect(runtime.appendMessage).toHaveBeenCalledTimes(1));
    rerenderChat(view, current, terminalEvents(current), 1);
    await act(async () => Promise.resolve());
    expect(runtime.appendMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ messageId: 'message-once', taskVersion: 1 });
      await pending.promise;
    });
    await waitFor(() => expect(screen.queryByTestId('compose-request-queue')).toBeNull());
  });

  it('does not dispatch the same request twice after switching away and back mid-send', async () => {
    const pending = deferred<{ messageId: string; taskVersion: number }>();
    runtime.appendMessage.mockReturnValueOnce(pending.promise);
    const first = conversation('conversation-a');
    const second = conversation('conversation-b');
    const view = renderChat(first, activeEvents(first));
    await waitForInitialLoad();
    await queueRequest('跨会话仍只发送一次');

    rerenderChat(view, first, terminalEvents(first));
    await waitFor(() => expect(runtime.appendMessage).toHaveBeenCalledTimes(1));
    rerenderChat(view, second, terminalEvents(second));
    rerenderChat(view, first, terminalEvents(first));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    expect(runtime.appendMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ messageId: 'message-switch', taskVersion: 1 });
      await pending.promise;
    });
    await waitFor(() => expect(screen.queryByTestId('compose-request-queue')).toBeNull());
  });

  it('keeps a background queue failure scoped to its original conversation', async () => {
    const pending = deferred<{ messageId: string; taskVersion: number }>();
    runtime.appendMessage.mockReturnValueOnce(pending.promise);
    const first = conversation('conversation-failure-a');
    const second = conversation('conversation-failure-b');
    const view = renderChat(first, activeEvents(first));
    await waitForInitialLoad();
    await queueRequest('background queue failure');
    const requestId = queuedItemId();

    rerenderChat(view, first, terminalEvents(first));
    await waitFor(() => expect(runtime.appendMessage).toHaveBeenCalledTimes(1));
    rerenderChat(view, second, terminalEvents(second));

    await act(async () => {
      pending.reject(new Error('background append failed'));
      await pending.promise.catch(() => undefined);
    });
    expect(screen.queryByText(/background append failed/)).toBeNull();
    expect(screen.queryByTestId(`compose-request-queue-item-${requestId}`)).toBeNull();

    rerenderChat(view, first, terminalEvents(first));
    expect(await screen.findByTestId(`compose-request-queue-item-${requestId}`)).toBeTruthy();
    expect(
      await screen.findByText('自动执行失败，需求已保留，可点击重试'),
    ).toBeTruthy();
  });
});
