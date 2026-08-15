/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Event, Message } from '@sync-think/shared';
import { ChatView } from './ChatView.js';

const runtime = {
  listConversationMessages: vi.fn(),
  openTask: vi.fn(),
  sendConversationMessage: vi.fn(),
  appendMessage: vi.fn(),
};

const conversation = {
  id: 'conversation-typing',
  workspaceId: 'workspace-typing',
  taskId: 'task-typing',
  track: 'model',
  targetRef: 'model-a',
  title: 'Typing state',
  executionMode: 'full-access',
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
} as unknown as Conversation;

const runStarted = {
  id: 'event-run-started',
  workspaceId: 'workspace-typing',
  taskId: 'task-typing',
  runId: 'run-a',
  category: 'run',
  type: 'run.started',
  sequence: 1,
  occurredAt: '2026-08-14T00:00:01.000Z',
  payload: { threadId: 'thread-typing' },
} as unknown as Event;

const finalReply = {
  id: 'assistant-final',
  threadId: 'thread-typing',
  role: 'assistant',
  runId: 'run-a',
  sequence: 2,
  createdAt: '2026-08-14T00:00:02.000Z',
  blocks: [{ type: 'text', text: 'Final reply is already visible.' }],
} as unknown as Message;

function terminalEvent(type: 'run.failed' | 'run.cancelled') {
  return {
    id: `event-${type}`,
    workspaceId: 'workspace-typing',
    taskId: 'task-typing',
    runId: 'run-a',
    category: 'run',
    type,
    sequence: 3,
    occurredAt: '2026-08-14T00:00:03.000Z',
    payload: { threadId: 'thread-typing' },
  } as unknown as Event;
}

function renderChat(eventHistory: Event[] = [runStarted]) {
  return render(
    <ChatView
      conversation={conversation}
      modelName="Model A"
      models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
      eventHistory={eventHistory}
      onTitleUpdated={vi.fn()}
    />,
  );
}

beforeEach(() => {
  runtime.openTask.mockReset().mockResolvedValue({ task: { threadId: 'thread-typing' } });
  runtime.listConversationMessages.mockReset();
  runtime.sendConversationMessage.mockReset().mockResolvedValue({
    threadId: 'thread-typing',
    taskVersion: 1,
  });
  runtime.appendMessage.mockReset().mockResolvedValue({
    messageId: 'message-user-durable',
    streamId: 'run-a',
    taskTitle: 'Typing state',
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ChatView typing indicator reconciliation', () => {
  it('hides the indicator once the active run has a durable final reply', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: [finalReply],
      hasMore: false,
    });

    renderChat();

    expect(await screen.findByText('Final reply is already visible.')).toBeTruthy();
    await waitFor(() => {
      expect(document.querySelector('.shell-typing-dot')).toBeNull();
    });
  });

  it('keeps the indicator visible while the run has no durable final reply', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: [],
      hasMore: false,
    });

    renderChat();

    await waitFor(() => {
      expect(document.querySelector('.shell-typing-dot')).toBeTruthy();
    });
  });

  it.each(['run.failed', 'run.cancelled'] as const)(
    'clears the indicator and stop button when %s arrives without an assistant message',
    async (terminalType) => {
      runtime.listConversationMessages.mockResolvedValue({
        messages: [],
        hasMore: false,
      });

      renderChat([runStarted, terminalEvent(terminalType)]);

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'trigger a run' } });
      fireEvent.click(screen.getByTestId('compose-send'));

      await waitFor(() => {
        expect(runtime.appendMessage).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(screen.queryByTestId('assistant-typing-indicator')).toBeNull();
        expect(screen.queryByTestId('compose-stop')).toBeNull();
      });
    },
  );
});
