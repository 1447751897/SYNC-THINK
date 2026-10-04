/** @vitest-environment jsdom */
import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Event, Message } from '@sync-think/shared';
import type { ConversationTransientSnapshot, RunProcessView } from '@sync-think/protocol';
import type { ConversationTransientSubscriptionEvent } from './use-conversation-transient-subscription.js';
import { recentConversationDisplayCache } from './conversation-display-cache.js';
import { ChatView, resetRecentConversationPageCacheForTests } from './ChatView.js';

const runtime = {
  openTask: vi.fn(),
  listConversationMessages: vi.fn(),
  subscribeConversationTransientStream: vi.fn(),
  getConversationRunProcess: vi.fn(),
};
const answer = '已经收到的回答，切回时应立即出现。';
const commentary = '我先检查当前资料。';
const timestamp = '2026-10-04T06:00:00.000Z';
const taskId = 'task-cache';
const threadId = 'thread-cache';
const runId = 'run-cache';
let deliver: (event: ConversationTransientSubscriptionEvent) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function conversation(id = 'conversation-cache', boundTask = taskId): Conversation {
  return {
    id,
    taskId: boundTask,
    workspaceId: 'workspace-cache',
    track: 'model',
    targetRef: 'model-cache',
    title: id,
    executionMode: 'full-access',
    createdAt: timestamp,
    updatedAt: timestamp,
  } as Conversation;
}
function process(running = true): RunProcessView {
  return {
    runId: runId as RunProcessView['runId'],
    running,
    startedAt: timestamp,
    steps: [
      {
        id: 'step-cache',
        kind: 'read',
        label: '读取已缓存资料',
        zh: '读取',
        verb: 'read',
        toolName: 'read_file',
        status: 'done',
        path: 'cached.md',
      },
    ],
    fileChanges: [],
    doneCount: 1,
    errorCount: 0,
    ...(!running ? { completedAt: timestamp } : {}),
  } as RunProcessView;
}
function snapshot(): ConversationTransientSnapshot {
  return {
    threadId,
    runId,
    text: answer,
    commentaryText: commentary,
    assistantTimeline: [
      {
        id: 'commentary-cache',
        sequence: 0,
        kind: 'text',
        phase: 'commentary',
        text: commentary,
        status: 'completed',
      },
      {
        id: 'answer-cache',
        sequence: 1,
        kind: 'text',
        phase: 'final_answer',
        text: answer,
        status: 'streaming',
      },
    ],
    process: process(),
    updatedAt: timestamp,
  } as ConversationTransientSnapshot;
}
const started = {
  id: 'started-cache',
  type: 'run.started',
  category: 'run',
  workspaceId: 'workspace-cache',
  taskId,
  runId,
  sequence: 1,
  occurredAt: timestamp,
  payload: { threadId },
} as unknown as Event;
function chat(value = conversation(), events: Event[] = [started]) {
  return (
    <ChatView
      conversation={value}
      modelName="Cache model"
      models={[{ modelId: 'model-cache', displayName: 'Cache model', providerName: 'Provider' }]}
      eventHistory={events}
      onTitleUpdated={vi.fn()}
    />
  );
}
async function seed() {
  const view = render(chat());
  await waitFor(() => expect(deliver).toBeTypeOf('function'));
  act(() => deliver({ type: 'reset', latestStreamSequence: 7, snapshot: snapshot() }));
  await screen.findByText(answer);
  expect(document.body.textContent).toContain(commentary);
  expect(document.body.textContent).toContain('cached.md');
  return view;
}

beforeEach(() => {
  resetRecentConversationPageCacheForTests();
  window.localStorage.clear();
  deliver = undefined as unknown as typeof deliver;
  runtime.openTask.mockReset().mockResolvedValue({ task: { threadId } });
  runtime.listConversationMessages.mockReset().mockResolvedValue({
    messages: [
      {
        id: 'user-cache',
        threadId,
        role: 'user',
        sequence: 0,
        createdAt: timestamp,
        blocks: [{ type: 'text', text: '检查这些资料。' }],
      } as Message,
    ],
    hasMore: false,
  });
  runtime.getConversationRunProcess.mockReset().mockResolvedValue({ process: process() });
  runtime.subscribeConversationTransientStream
    .mockReset()
    .mockImplementation((_payload, listener) => {
      deliver = listener;
      return {
        ready: Promise.resolve({ subscriptionId: 'cache-subscription' }),
        unsubscribe: vi.fn(async () => undefined),
      };
    });
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime } });
});
afterEach(() => {
  cleanup();
  resetRecentConversationPageCacheForTests();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ChatView conversation display cache', () => {
  it('restores the live answer, commentary and process before any background request resolves', async () => {
    const first = await seed();
    first.unmount();
    runtime.openTask.mockReturnValue(deferred<unknown>().promise);
    runtime.listConversationMessages.mockReturnValue(deferred<unknown>().promise);
    const pendingProcess = deferred<{ process: RunProcessView }>();
    runtime.getConversationRunProcess.mockReturnValue(pendingProcess.promise);
    runtime.subscribeConversationTransientStream.mockImplementation(() => undefined);
    render(chat());
    expect(screen.getByText(answer)).toBeTruthy();
    expect(document.body.textContent).toContain(commentary);
    expect(document.body.textContent).toContain('cached.md');
    expect(screen.getByTestId('streaming-response').getAttribute('data-state')).toBe('streaming');
    expect(screen.queryByRole('status', { name: '正在加载对话' })).toBeNull();
    expect(runtime.openTask).toHaveBeenCalledTimes(2);
    expect(runtime.listConversationMessages).toHaveBeenCalledTimes(2);
    await act(async () => pendingProcess.resolve({ process: process() }));
  });

  it('keeps the restored content visible through StrictMode effect replay', async () => {
    const first = await seed();
    first.unmount();
    runtime.openTask.mockReturnValue(deferred<unknown>().promise);
    runtime.listConversationMessages.mockReturnValue(deferred<unknown>().promise);
    const pendingProcess = deferred<{ process: RunProcessView }>();
    runtime.getConversationRunProcess.mockReturnValue(pendingProcess.promise);
    render(<StrictMode>{chat()}</StrictMode>);
    expect(screen.getByText(answer)).toBeTruthy();
    expect(document.body.textContent).toContain('cached.md');
    await act(async () => pendingProcess.resolve({ process: process() }));
    expect(screen.getByText(answer)).toBeTruthy();
  });

  it('resumes after the painted stream cursor without appending replayed tokens twice', async () => {
    const first = await seed();
    first.unmount();
    runtime.subscribeConversationTransientStream.mockClear();
    render(chat());
    await waitFor(() => expect(runtime.subscribeConversationTransientStream).toHaveBeenCalled());
    expect(runtime.subscribeConversationTransientStream.mock.calls[0][0]).toEqual({
      threadId,
      afterStreamSequence: 7,
    });
    const emit = (streamSequence: number, textDelta: string) =>
      act(() =>
        deliver({
          type: 'frame',
          frame: {
            threadId,
            runId,
            streamSequence,
            kind: 'text',
            textDelta,
            occurredAt: timestamp,
            assistantTimeline: snapshot().assistantTimeline!.map((segment) =>
              segment.id === 'answer-cache' && streamSequence > 7
                ? { ...segment, text: answer + textDelta }
                : segment,
            ),
          },
        } as ConversationTransientSubscriptionEvent),
      );
    emit(7, answer);
    emit(8, '新增内容。');
    await waitFor(() => expect(document.body.textContent).toContain(answer + '新增内容。'));
    expect(document.body.textContent?.split(answer).length).toBe(2);
    expect(
      recentConversationDisplayCache.read(JSON.stringify(['conversation-cache', taskId]))?.draft
        ?.text,
    ).toBe(answer + '新增内容。');
  });

  it('accepts a new stream epoch after Runtime resets a cached cursor backwards', async () => {
    const first = await seed();
    first.unmount();
    render(chat());
    await waitFor(() =>
      expect(runtime.subscribeConversationTransientStream).toHaveBeenCalledTimes(2),
    );
    act(() => {
      deliver({ type: 'reset', latestStreamSequence: 0 });
      deliver({
        type: 'frame',
        frame: {
          threadId,
          runId: 'new-run-cache',
          streamSequence: 1,
          kind: 'text',
          textDelta: '新的运行内容。',
          occurredAt: timestamp,
        },
      } as ConversationTransientSubscriptionEvent);
    });
    await screen.findByText('新的运行内容。');
    expect(screen.queryByText(answer)).toBeNull();
  });

  it('keeps cached process rows visible while refreshing a running process in the background', async () => {
    const first = await seed();
    first.unmount();
    const pending = deferred<{ process: RunProcessView }>();
    runtime.getConversationRunProcess.mockClear().mockReturnValue(pending.promise);
    runtime.subscribeConversationTransientStream.mockImplementation(() => undefined);
    render(chat());
    expect(document.body.textContent).toContain('cached.md');
    await waitFor(() => expect(runtime.getConversationRunProcess).toHaveBeenCalledWith({ runId }));
    await act(async () => pending.resolve({ process: process(false) }));
    await waitFor(() =>
      expect(screen.getByTestId('streaming-response').getAttribute('data-state')).toBe('complete'),
    );
    expect(screen.getByText(answer)).toBeTruthy();
  });

  it('reconciles a run completed while hidden and removes its cached live bubble once the durable reply arrives', async () => {
    const first = await seed();
    first.unmount();
    const history = deferred<{ messages: Message[]; hasMore: boolean }>();
    runtime.listConversationMessages.mockReturnValue(history.promise);
    runtime.getConversationRunProcess.mockResolvedValue({ process: process(false) });
    render(chat());
    expect(screen.getByText(answer)).toBeTruthy();
    await waitFor(() =>
      expect(runtime.subscribeConversationTransientStream).toHaveBeenCalledTimes(2),
    );
    act(() => deliver({ type: 'reset', latestStreamSequence: 8 }));
    expect(screen.getByText(answer)).toBeTruthy();
    await act(async () =>
      history.resolve({
        messages: [
          {
            id: 'assistant-cache',
            threadId,
            runId,
            role: 'assistant',
            sequence: 2,
            createdAt: timestamp,
            blocks: [{ type: 'text', text: answer }],
          } as Message,
        ],
        hasMore: false,
      }),
    );
    await waitFor(() =>
      expect(document.querySelector('[data-message-id="streaming-run-cache"]')).toBeNull(),
    );
    expect(screen.getAllByText(answer)).toHaveLength(1);
    cleanup();
    runtime.listConversationMessages.mockReturnValue(deferred<unknown>().promise);
    render(chat());
    expect(screen.getAllByText(answer)).toHaveLength(1);
    expect(document.querySelector('[data-message-id="streaming-run-cache"]')).toBeNull();
  });

  it('does not duplicate a cached active turn when durable completion arrives without a transient terminal frame', async () => {
    const first = await seed();
    first.unmount();
    runtime.subscribeConversationTransientStream.mockImplementation(() => undefined);
    runtime.listConversationMessages.mockResolvedValue({
      messages: [
        {
          id: 'assistant-cache',
          threadId,
          runId,
          role: 'assistant',
          sequence: 2,
          createdAt: timestamp,
          blocks: [{ type: 'text', text: answer }],
        } as Message,
      ],
      hasMore: false,
    });
    runtime.getConversationRunProcess.mockResolvedValue({ process: process(false) });
    render(chat());
    await waitFor(() =>
      expect(document.querySelector('[data-message-id="streaming-run-cache"]')).toBeNull(),
    );
    expect(screen.getAllByText(answer)).toHaveLength(1);
  });

  it('preserves the cached reply when background history refresh fails', async () => {
    const first = await seed();
    first.unmount();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      runtime.listConversationMessages.mockRejectedValue(new Error('connection unavailable'));
      render(chat());
      expect(screen.getByText(answer)).toBeTruthy();
      await waitFor(() => expect(error).toHaveBeenCalled());
      expect(screen.getByText(answer)).toBeTruthy();
      expect(document.body.textContent).toContain('cached.md');
    } finally {
      error.mockRestore();
    }
  });

  it('restores the durable task plan before its background history read returns', async () => {
    const firstResponse = await runtime.listConversationMessages();
    runtime.listConversationMessages.mockResolvedValue({
      ...firstResponse,
      taskPlan: {
        sequence: 3,
        runId,
        items: [{ title: '保留任务卡片', status: 'in_progress' }],
        running: true,
        pending: {},
      },
    });
    const first = await seed();
    expect(document.body.textContent).toContain('保留任务卡片');
    first.unmount();
    runtime.listConversationMessages.mockReturnValue(deferred<unknown>().promise);
    render(chat());
    expect(document.body.textContent).toContain('保留任务卡片');
    expect(screen.getByText(answer)).toBeTruthy();
  });

  it('does not restore another conversation or a previous task binding into the current chat', async () => {
    const first = await seed();
    runtime.openTask.mockReturnValue(deferred<unknown>().promise);
    runtime.listConversationMessages.mockReturnValue(deferred<unknown>().promise);
    first.rerender(chat(conversation('other-conversation', 'other-task'), []));
    expect(screen.queryByText(answer)).toBeNull();
    expect(document.body.textContent).not.toContain('cached.md');
    first.rerender(chat(conversation('conversation-cache', 'replacement-task'), []));
    expect(screen.queryByText(answer)).toBeNull();
    expect(document.body.textContent).not.toContain('cached.md');
    first.rerender(chat());
    expect(screen.getByText(answer)).toBeTruthy();
    expect(document.body.textContent).toContain('cached.md');
  });
});
