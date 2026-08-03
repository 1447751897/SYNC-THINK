/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DesktopWaitingCommandSummary } from '@sync-think/protocol';
import type { Conversation, Event } from '@sync-think/shared';
import { ChatView } from './ChatView.js';

const runtime = {
  listConversationMessages: vi.fn(),
  listWaitingDesktopCommands: vi.fn(),
  continueDesktopCommand: vi.fn(),
  cancelDesktopCommand: vi.fn(),
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
    id: 'conversation-desktop-waiting',
    workspaceId: 'workspace-desktop',
    taskId: 'task-desktop',
    track: 'agent',
    targetRef: 'agent-a',
    title: 'Desktop waiting',
    executionMode: 'full-access',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  } as unknown as Conversation;
}

function eventAt(sequence: number, type: string, payload: Record<string, unknown> = {}): Event {
  return {
    id: `event-${sequence}`,
    workspaceId: 'workspace-desktop',
    taskId: 'task-desktop',
    runId: 'run-desktop',
    category: 'tool',
    type,
    sequence,
    occurredAt: `2026-08-01T00:00:0${sequence}.000Z`,
    payload: { threadId: 'thread-desktop', ...payload },
  } as unknown as Event;
}

const eventHistory = [
  eventAt(1, 'run.started'),
  eventAt(2, 'desktop.command.waiting_user', {
    commandId: 'event-payload-not-ui-source',
    title: 'Do not render event payload',
    value: 'secret-input-value',
  }),
];

function command(
  overrides: Partial<DesktopWaitingCommandSummary> = {},
): DesktopWaitingCommandSummary {
  return {
    commandId: 'desktop-command-a',
    workspaceId: 'workspace-desktop',
    taskId: 'task-desktop',
    runId: 'run-desktop',
    toolName: 'desktop_invoke_element',
    action: 'invoke-element',
    target: { processId: 42, title: 'Fixture window', appId: 'fixture.app' },
    reason: 'user-input-detected',
    errorCode: 'desktop.user-input-detected',
    status: 'waiting_user',
    canContinue: true,
    canCancel: true,
    createdAt: '2026-08-01T00:00:01.000Z',
    updatedAt: '2026-08-01T00:00:02.000Z',
    ...overrides,
  } as unknown as DesktopWaitingCommandSummary;
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
  runtime.listConversationMessages.mockReset().mockResolvedValue({ messages: [], hasMore: false });
  runtime.listWaitingDesktopCommands.mockReset().mockResolvedValue({ commands: [command()] });
  runtime.continueDesktopCommand.mockReset().mockResolvedValue({
    status: 'continued',
    commandId: 'desktop-command-a',
    replayed: false,
    updatedAt: '2026-08-01T00:00:03.000Z',
  });
  runtime.cancelDesktopCommand.mockReset().mockResolvedValue({
    status: 'cancelled',
    commandId: 'desktop-command-a',
    replayed: false,
    updatedAt: '2026-08-01T00:00:03.000Z',
  });
  runtime.openTask.mockReset().mockResolvedValue({ task: { threadId: 'thread-desktop' } });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ChatView durable desktop waiting integration', () => {
  it('renders only the durable Runtime summary and filters results by Task and active Run', async () => {
    runtime.listWaitingDesktopCommands.mockResolvedValue({
      commands: [
        command(),
        command({
          commandId: 'desktop-command-other-task',
          taskId: 'task-other' as DesktopWaitingCommandSummary['taskId'],
          target: { title: 'Do not render another task' },
        }),
      ],
    });

    renderChat();

    expect(await screen.findByText('Fixture window')).toBeTruthy();
    expect(screen.queryByText('Do not render event payload')).toBeNull();
    expect(screen.queryByText('Do not render another task')).toBeNull();
    expect(document.body.textContent).not.toContain('secret-input-value');
    expect(runtime.listWaitingDesktopCommands).toHaveBeenCalledWith({
      workspaceId: 'workspace-desktop',
      runId: 'run-desktop',
    });
  });

  it('re-queries durable state after a waiting event and a Runtime reconnect', async () => {
    runtime.listWaitingDesktopCommands
      .mockResolvedValueOnce({ commands: [] })
      .mockResolvedValue({ commands: [command()] });
    const view = renderChat({ events: [eventAt(1, 'run.started')] });
    await waitFor(() => expect(runtime.listWaitingDesktopCommands).toHaveBeenCalledTimes(1));

    view.rerender(
      <ChatView
        conversation={conversation()}
        modelName="Model A"
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
        eventHistory={eventHistory}
        runtimeConnectionRevision={0}
        onTitleUpdated={vi.fn()}
      />,
    );
    expect(await screen.findByText('Fixture window')).toBeTruthy();
    expect(runtime.listWaitingDesktopCommands).toHaveBeenCalledTimes(2);

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
    await waitFor(() => expect(runtime.listWaitingDesktopCommands).toHaveBeenCalledTimes(3));
  });

  it('keeps the newest query result when an older response resolves late', async () => {
    const stale = deferred<{ commands: DesktopWaitingCommandSummary[] }>();
    runtime.listWaitingDesktopCommands
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ commands: [command()] });
    const view = renderChat({ events: [eventAt(1, 'run.started')] });
    await waitFor(() => expect(runtime.listWaitingDesktopCommands).toHaveBeenCalledTimes(1));

    view.rerender(
      <ChatView
        conversation={conversation()}
        modelName="Model A"
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
        eventHistory={eventHistory}
        onTitleUpdated={vi.fn()}
      />,
    );
    expect(await screen.findByText('Fixture window')).toBeTruthy();

    stale.resolve({ commands: [] });
    await Promise.resolve();
    expect(screen.getByText('Fixture window')).toBeTruthy();
  });

  it('continues a waiting command through the updated-at fence and refreshes durable state', async () => {
    runtime.listWaitingDesktopCommands
      .mockResolvedValueOnce({ commands: [command()] })
      .mockResolvedValue({ commands: [] });
    renderChat();

    fireEvent.click(
      await screen.findByRole('button', { name: '\u6211\u5df2\u5904\u7406\uff0c\u7ee7\u7eed' }),
    );
    await waitFor(() =>
      expect(runtime.continueDesktopCommand).toHaveBeenCalledWith({
        commandId: 'desktop-command-a',
        expectedUpdatedAt: '2026-08-01T00:00:02.000Z',
      }),
    );
    await waitFor(() => expect(runtime.listWaitingDesktopCommands).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Fixture window')).toBeNull();
  });

  it('cancels a waiting command through the same concurrency fence', async () => {
    runtime.listWaitingDesktopCommands
      .mockResolvedValueOnce({ commands: [command()] })
      .mockResolvedValue({ commands: [] });
    renderChat();

    fireEvent.click(await screen.findByRole('button', { name: '\u53d6\u6d88\u7b49\u5f85' }));
    await waitFor(() =>
      expect(runtime.cancelDesktopCommand).toHaveBeenCalledWith({
        commandId: 'desktop-command-a',
        expectedUpdatedAt: '2026-08-01T00:00:02.000Z',
      }),
    );
    await waitFor(() => expect(runtime.listWaitingDesktopCommands).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Fixture window')).toBeNull();
  });

  it('locks both decisions while one command resolution is pending', async () => {
    runtime.continueDesktopCommand.mockImplementation(() => new Promise(() => {}));
    renderChat();

    fireEvent.click(
      await screen.findByRole('button', { name: '\u6211\u5df2\u5904\u7406\uff0c\u7ee7\u7eed' }),
    );
    await waitFor(() => expect(runtime.continueDesktopCommand).toHaveBeenCalledTimes(1));
    expect(
      (
        screen.getByRole('button', {
          name: '\u6211\u5df2\u5904\u7406\uff0c\u7ee7\u7eed',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: '\u53d6\u6d88\u7b49\u5f85' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('re-queries durable state and reports a stale resolution failure', async () => {
    runtime.listWaitingDesktopCommands
      .mockResolvedValueOnce({ commands: [command()] })
      .mockResolvedValue({
        commands: [command({ updatedAt: '2026-08-01T00:00:04.000Z' })],
      });
    runtime.continueDesktopCommand.mockRejectedValue(new Error('desktop.command-conflict'));
    renderChat();

    fireEvent.click(
      await screen.findByRole('button', { name: '\u6211\u5df2\u5904\u7406\uff0c\u7ee7\u7eed' }),
    );
    expect(
      await screen.findByText(
        '\u64cd\u4f5c\u672a\u751f\u6548\uff0c\u684c\u9762\u7b49\u5f85\u72b6\u6001\u53ef\u80fd\u5df2\u5728\u5176\u4ed6\u7a97\u53e3\u6539\u53d8\u3002\u8bf7\u5237\u65b0\u72b6\u6001\u540e\u91cd\u8bd5\u3002',
      ),
    ).toBeTruthy();
    expect(runtime.listWaitingDesktopCommands).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Fixture window')).toBeTruthy();
  });

  it.each(['desktop.command.continued', 'desktop.command.cancelled'])(
    're-queries durable state after a %s lifecycle event',
    async (eventType) => {
      runtime.listWaitingDesktopCommands.mockResolvedValue({ commands: [command()] });
      const view = renderChat({ events: eventHistory });
      await waitFor(() => expect(runtime.listWaitingDesktopCommands).toHaveBeenCalledTimes(1));

      view.rerender(
        <ChatView
          conversation={conversation()}
          modelName="Model A"
          models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
          eventHistory={[...eventHistory, eventAt(3, eventType)]}
          onTitleUpdated={vi.fn()}
        />,
      );
      await waitFor(() => expect(runtime.listWaitingDesktopCommands).toHaveBeenCalledTimes(2));
    },
  );

  it('offers retry after a query failure', async () => {
    runtime.listWaitingDesktopCommands
      .mockRejectedValueOnce(new Error('runtime unavailable'))
      .mockResolvedValue({ commands: [command()] });
    renderChat();

    fireEvent.click(await screen.findByRole('button', { name: '\u91cd\u8bd5' }));
    expect(await screen.findByText('Fixture window')).toBeTruthy();
    expect(runtime.listWaitingDesktopCommands).toHaveBeenCalledTimes(2);
  });
});
