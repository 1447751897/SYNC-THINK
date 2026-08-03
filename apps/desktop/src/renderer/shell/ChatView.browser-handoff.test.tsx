/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BrowserHandoffSummary } from '@sync-think/protocol';
import type { Conversation, Event } from '@sync-think/shared';
import { ChatView } from './ChatView.js';

const runtime = {
  cancelBrowserHandoff: vi.fn(),
  continueBrowserHandoff: vi.fn(),
  listConversationMessages: vi.fn(),
  listWaitingBrowserHandoffs: vi.fn(),
  openTask: vi.fn(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function conversation(): Conversation {
  return {
    id: 'conversation-handoff',
    workspaceId: 'workspace-handoff',
    taskId: 'task-handoff',
    track: 'agent',
    targetRef: 'agent-a',
    title: 'Browser handoff',
    executionMode: 'full-access',
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  } as unknown as Conversation;
}

function eventAt(sequence: number, type: string, payload: Record<string, unknown> = {}): Event {
  return {
    id: `event-${sequence}`,
    workspaceId: 'workspace-handoff',
    taskId: 'task-handoff',
    runId: 'run-handoff',
    category: type === 'approval.requested' ? 'approval' : 'orchestration',
    type,
    sequence,
    occurredAt: `2026-07-31T00:00:0${sequence}.000Z`,
    payload: { threadId: 'thread-handoff', ...payload },
  } as unknown as Event;
}

const eventHistory = [
  eventAt(1, 'run.started'),
  eventAt(2, 'approval.requested', {
    action: 'browser.handoff',
    handoffId: 'event-payload-is-not-the-ui-source',
    requestedOutcome: 'Do not render this payload',
  }),
];

function handoff(overrides: Partial<BrowserHandoffSummary> = {}): BrowserHandoffSummary {
  return {
    handoffId: 'handoff-a',
    revision: 1,
    workspaceId: 'workspace-handoff',
    taskId: 'task-handoff',
    runId: 'run-handoff',
    stepId: 'step-handoff',
    agentVersionId: 'agent-version-handoff',
    siteOrigin: 'https://accounts.example.com',
    reason: 'login',
    requestedOutcome: 'Complete account login',
    onCancel: 'close-page',
    status: 'waiting_user',
    createdAt: '2026-07-31T00:00:01.000Z',
    updatedAt: '2026-07-31T00:00:01.000Z',
    canContinue: true,
    canCancel: true,
    ...overrides,
  } as unknown as BrowserHandoffSummary;
}

function renderChat(props: { runtimeConnectionRevision?: number; events?: readonly Event[] } = {}) {
  return render(
    <ChatView
      conversation={conversation()}
      modelName="Model A"
      models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
      eventHistory={props.events ?? eventHistory}
      runtimeConnectionRevision={props.runtimeConnectionRevision}
      onTitleUpdated={vi.fn()}
    />,
  );
}

beforeEach(() => {
  runtime.cancelBrowserHandoff.mockReset().mockResolvedValue({
    status: 'cancelled',
    handoffId: 'handoff-a',
    replayed: false,
    runId: 'run-handoff',
    stepId: 'step-handoff',
  });
  runtime.continueBrowserHandoff.mockReset().mockResolvedValue({
    status: 'continued',
    handoffId: 'handoff-a',
    replayed: false,
    runId: 'run-handoff',
    stepId: 'step-handoff',
  });
  runtime.listConversationMessages.mockReset().mockResolvedValue({ messages: [], hasMore: false });
  runtime.listWaitingBrowserHandoffs.mockReset().mockResolvedValue({ handoffs: [handoff()] });
  runtime.openTask.mockReset().mockResolvedValue({ task: { threadId: 'thread-handoff' } });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ChatView durable browser handoff integration', () => {
  it('queries the active run and renders only the Runtime durable summary', async () => {
    renderChat();

    expect(await screen.findByText('Complete account login')).toBeTruthy();
    expect(screen.queryByText('Do not render this payload')).toBeNull();
    expect(runtime.listWaitingBrowserHandoffs).toHaveBeenCalledWith({
      workspaceId: 'workspace-handoff',
      runId: 'run-handoff',
    });
  });

  it('recovers after a cold Renderer start and isolates workspace-wide results by Task', async () => {
    runtime.listWaitingBrowserHandoffs.mockResolvedValue({
      handoffs: [
        handoff(),
        handoff({
          handoffId: 'handoff-other-task',
          taskId: 'task-other' as BrowserHandoffSummary['taskId'],
          runId: 'run-other' as BrowserHandoffSummary['runId'],
          requestedOutcome: 'Do not show another Task handoff',
        }),
      ],
    });

    renderChat({ events: [] });

    expect(await screen.findByText('Complete account login')).toBeTruthy();
    expect(screen.queryByText('Do not show another Task handoff')).toBeNull();
    expect(runtime.listWaitingBrowserHandoffs).toHaveBeenCalledWith({
      workspaceId: 'workspace-handoff',
    });
  });

  it('re-queries when durable orchestration enters the human approval gate', async () => {
    runtime.listWaitingBrowserHandoffs
      .mockResolvedValueOnce({ handoffs: [] })
      .mockResolvedValue({ handoffs: [handoff()] });
    const view = renderChat({ events: [] });

    await waitFor(() => expect(runtime.listWaitingBrowserHandoffs).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Complete account login')).toBeNull();

    view.rerender(
      <ChatView
        conversation={conversation()}
        modelName="Model A"
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
        eventHistory={[eventAt(3, 'run.awaitingToolApproval')]}
        onTitleUpdated={vi.fn()}
      />,
    );

    expect(await screen.findByText('Complete account login')).toBeTruthy();
    expect(runtime.listWaitingBrowserHandoffs).toHaveBeenCalledTimes(2);
  });

  it('continues with revision binding, shares the busy lock, and refreshes the list', async () => {
    const pending = deferred<{
      status: 'continued';
      handoffId: string;
      replayed: boolean;
      runId: string;
      stepId: string;
    }>();
    runtime.continueBrowserHandoff.mockReturnValueOnce(pending.promise);
    runtime.listWaitingBrowserHandoffs
      .mockResolvedValueOnce({ handoffs: [handoff()] })
      .mockResolvedValue({ handoffs: [] });
    renderChat();

    const continueButton = await screen.findByRole('button', {
      name: '\u6211\u5df2\u5b8c\u6210\uff0c\u7ee7\u7eed',
    });
    const cancelButton = screen.getByRole('button', {
      name: '\u53d6\u6d88\u5e76\u5173\u95ed\u9875\u9762',
    });
    fireEvent.click(continueButton);

    expect(runtime.continueBrowserHandoff).toHaveBeenCalledWith({
      handoffId: 'handoff-a',
      expectedRevision: 1,
    });
    await waitFor(() => {
      expect((continueButton as HTMLButtonElement).disabled).toBe(true);
      expect((cancelButton as HTMLButtonElement).disabled).toBe(true);
    });

    pending.resolve({
      status: 'continued',
      handoffId: 'handoff-a',
      replayed: false,
      runId: 'run-handoff',
      stepId: 'step-handoff',
    });
    await waitFor(() => expect(screen.queryByText('Complete account login')).toBeNull());
    expect(runtime.listWaitingBrowserHandoffs).toHaveBeenCalledTimes(2);
  });

  it('maps close-page cancellation to lease release', async () => {
    runtime.listWaitingBrowserHandoffs
      .mockResolvedValueOnce({ handoffs: [handoff()] })
      .mockResolvedValue({ handoffs: [] });
    renderChat();

    fireEvent.click(
      await screen.findByRole('button', { name: '\u53d6\u6d88\u5e76\u5173\u95ed\u9875\u9762' }),
    );

    await waitFor(() =>
      expect(runtime.cancelBrowserHandoff).toHaveBeenCalledWith({
        handoffId: 'handoff-a',
        expectedRevision: 1,
        leaseDisposition: 'release',
      }),
    );
    await waitFor(() => expect(screen.queryByText('Complete account login')).toBeNull());
  });

  it('re-queries durable state after a Runtime reconnect revision', async () => {
    const view = renderChat({ runtimeConnectionRevision: 0 });
    await screen.findByText('Complete account login');
    expect(runtime.listWaitingBrowserHandoffs).toHaveBeenCalledTimes(1);

    view.rerender(
      <ChatView
        conversation={conversation()}
        modelName="Model A"
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
        eventHistory={eventHistory}
        runtimeConnectionRevision={1}
        onTitleUpdated={vi.fn()}
      />,
    );

    await waitFor(() => expect(runtime.listWaitingBrowserHandoffs).toHaveBeenCalledTimes(2));
  });

  it('shows a retry state for query failures and loads the durable card after retry', async () => {
    runtime.listWaitingBrowserHandoffs
      .mockRejectedValueOnce(new Error('runtime unavailable'))
      .mockResolvedValue({ handoffs: [handoff()] });
    renderChat();

    const retry = await screen.findByRole('button', { name: '\u91cd\u8bd5' });
    expect(screen.queryByText('Complete account login')).toBeNull();
    fireEvent.click(retry);

    expect(await screen.findByText('Complete account login')).toBeTruthy();
    expect(runtime.listWaitingBrowserHandoffs).toHaveBeenCalledTimes(2);
  });

  it('keeps an action failure visible after refreshing the durable state', async () => {
    runtime.continueBrowserHandoff.mockRejectedValueOnce(new Error('stale revision'));
    runtime.listWaitingBrowserHandoffs.mockResolvedValue({ handoffs: [handoff()] });
    renderChat();

    fireEvent.click(
      await screen.findByRole('button', { name: '\u6211\u5df2\u5b8c\u6210\uff0c\u7ee7\u7eed' }),
    );

    expect(await screen.findByText(/\u64cd\u4f5c\u672a\u751f\u6548/)).toBeTruthy();
    expect(runtime.listWaitingBrowserHandoffs).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('button', { name: '\u6211\u5df2\u5b8c\u6210\uff0c\u7ee7\u7eed' }),
    ).toHaveProperty('disabled', false);
  });
});
