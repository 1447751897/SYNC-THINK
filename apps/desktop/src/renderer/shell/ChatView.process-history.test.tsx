/**
 * @vitest-environment jsdom
 */
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Message } from '@sync-think/shared';
import type { RunProcessView } from '@sync-think/protocol';
import { ChatView } from './ChatView.js';

const runtime = {
  openTask: vi.fn(),
  listConversationMessages: vi.fn(),
  getConversationRunProcess: vi.fn(),
};
const observations: {
  callback: IntersectionObserverCallback;
  nodes: Set<Element>;
  disconnected: boolean;
}[] = [];
const pending: { runId: string; resolve: (value: { process: RunProcessView }) => void }[] = [];
let fixtureSequence = 0;

function view(runId: string): RunProcessView {
  return {
    runId: runId as RunProcessView['runId'],
    steps: [],
    fileChanges: [],
    running: false,
    doneCount: 0,
    errorCount: 0,
  };
}

function conversation(id: string): Conversation {
  return {
    id,
    workspaceId: 'workspace-history',
    taskId: `task-${id}`,
    track: 'model',
    targetRef: 'model-history',
    title: id,
    executionMode: 'full-access',
    createdAt: '2026-09-05T06:00:00.000Z',
    updatedAt: '2026-09-05T06:00:00.000Z',
  } as Conversation;
}

function messages(id: string, count = 12): Message[] {
  return Array.from(
    { length: count },
    (_, index) =>
      ({
        id: `${id}-message-${index}`,
        runId: `${id}-run-${index}`,
        threadId: `thread-task-${id}`,
        role: 'assistant',
        sequence: index + 1,
        createdAt: '2026-09-05T06:00:01.000Z',
        blocks: [{ type: 'text', text: `${id} reply ${index}` }],
      }) as Message,
  );
}

function chat(id: string) {
  return (
    <ChatView
      key={id}
      conversation={conversation(id)}
      modelName="History model"
      models={[
        { modelId: 'model-history', displayName: 'History model', providerName: 'Provider' },
      ]}
      eventHistory={[]}
      onTitleUpdated={vi.fn()}
    />
  );
}

beforeEach(() => {
  fixtureSequence += 1;
  window.localStorage.clear();
  observations.length = 0;
  pending.length = 0;
  runtime.openTask
    .mockReset()
    .mockImplementation(({ taskId }: { taskId: string }) =>
      Promise.resolve({ task: { threadId: `thread-${taskId}` } }),
    );
  runtime.listConversationMessages.mockReset();
  runtime.getConversationRunProcess
    .mockReset()
    .mockImplementation(
      ({ runId }: { runId: string }) =>
        new Promise<{ process: RunProcessView }>((resolve) => pending.push({ runId, resolve })),
    );
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime } });
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      readonly observation;
      constructor(callback: IntersectionObserverCallback) {
        this.observation = { callback, nodes: new Set<Element>(), disconnected: false };
        observations.push(this.observation);
      }
      observe(node: Element) {
        this.observation.nodes.add(node);
      }
      disconnect() {
        this.observation.disconnected = true;
      }
    },
  );
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    for (const request of pending) request.resolve({ process: view(request.runId) });
  });
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ChatView historical process loading', () => {
  it('reports a conversation review target even before any historical run has loaded', async () => {
    const id = 'review-' + fixtureSequence;
    const onLatestReviewChange = vi.fn();
    runtime.listConversationMessages.mockResolvedValue({ messages: [], hasMore: false });
    const element = chat(id);
    render(<ChatView {...element.props} onLatestReviewChange={onLatestReviewChange} />);
    await waitFor(() =>
      expect(onLatestReviewChange).toHaveBeenCalledWith({
        reviewScope: 'conversation',
        conversationId: id,
      }),
    );
    expect(runtime.getConversationRunProcess).not.toHaveBeenCalled();
  });
  it('prioritizes intersecting history without scanning geometry on scroll', async () => {
    const id = `priority-${fixtureSequence}`;
    runtime.listConversationMessages.mockResolvedValue({ messages: messages(id), hasMore: false });
    const result = render(chat(id));
    await waitFor(() => expect(runtime.getConversationRunProcess).toHaveBeenCalledTimes(3));
    expect(pending.map((request) => request.runId)).toEqual([
      `${id}-run-11`,
      `${id}-run-10`,
      `${id}-run-9`,
    ]);
    const target = result.container.querySelector(`[data-process-run-id="${id}-run-1"]`)!;
    const observer = [...observations]
      .reverse()
      .find((candidate) => candidate.nodes.has(target) && !candidate.disconnected)!;
    expect(observer).toBeTruthy();
    act(() =>
      observer.callback(
        [{ target, isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    await act(async () => pending[0]!.resolve({ process: view(pending[0]!.runId) }));
    expect(pending[3]!.runId).toBe(`${id}-run-1`);
    expect(runtime.getConversationRunProcess).toHaveBeenCalledTimes(4);
    expect(screen.getByText(`${id} reply 1`)).toBeTruthy();
  });

  it('keeps the shared limit across keyed navigation and discards the old page response', async () => {
    const oldId = `old-${fixtureSequence}`;
    const nextId = `next-${fixtureSequence}`;
    runtime.listConversationMessages
      .mockResolvedValueOnce({ messages: messages(oldId), hasMore: false })
      .mockResolvedValue({ messages: messages(nextId), hasMore: false });
    const result = render(chat(oldId));
    await waitFor(() => expect(pending).toHaveLength(3));
    result.rerender(chat(nextId));
    await screen.findByText(`${nextId} reply 0`);
    expect(pending).toHaveLength(3);
    await act(async () => pending[0]!.resolve({ process: view(pending[0]!.runId) }));
    expect(pending).toHaveLength(4);
    expect(pending[3]!.runId).toBe(`${nextId}-run-11`);
    expect(screen.queryByText(`${oldId} reply 0`)).toBeNull();
  });

  it('shows a bounded failure beside the preserved answer and reloads it manually', async () => {
    const id = `retry-${fixtureSequence}`;
    runtime.listConversationMessages.mockResolvedValue({
      messages: messages(id, 1),
      hasMore: false,
    });
    runtime.getConversationRunProcess
      .mockRejectedValueOnce(new Error('unclassified backend detail TOKEN=private'))
      .mockResolvedValue({ process: view(`${id}-run-0`) });
    render(chat(id));
    const notice = await screen.findByTestId('run-process-load-notice');
    expect(notice.textContent).toContain('执行过程读取失败，正文已保留');
    expect(notice.textContent).not.toContain('private');
    expect(screen.getByText(`${id} reply 0`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新加载执行过程' }));
    await waitFor(() => expect(screen.queryByTestId('run-process-load-notice')).toBeNull());
    expect(runtime.getConversationRunProcess).toHaveBeenCalledTimes(2);
    expect(screen.getByText(`${id} reply 0`)).toBeTruthy();
  });

  it('survives effect replay without leaking or duplicating physical requests', async () => {
    const id = `strict-${fixtureSequence}`;
    runtime.listConversationMessages.mockResolvedValue({ messages: messages(id), hasMore: false });
    render(<StrictMode>{chat(id)}</StrictMode>);
    await waitFor(() => expect(pending).toHaveLength(3));
    await act(async () => pending[0]!.resolve({ process: view(pending[0]!.runId) }));
    expect(pending).toHaveLength(4);
    expect(new Set(pending.map((request) => request.runId)).size).toBe(4);
  });
});
