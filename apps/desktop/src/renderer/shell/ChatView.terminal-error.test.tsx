/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Conversation, Event, Message } from '@sync-think/shared';
import { ChatView } from './ChatView.js';

const runtime = {
  appendMessage: vi.fn(),
  detectKernels: vi.fn(),
  getConversationRunProcess: vi.fn(),
  listConversationMessages: vi.fn(),
  openTask: vi.fn(),
  sendConversationMessage: vi.fn(),
};

const userMessage = {
  id: 'user-before-failure',
  threadId: 'thread-terminal',
  role: 'user',
  sequence: 0,
  createdAt: '2026-08-07T09:29:59.000Z',
  blocks: [{ type: 'text', text: '请继续处理这个任务' }],
} as unknown as Message;

const conversation = {
  id: 'conversation-terminal',
  workspaceId: 'workspace-terminal',
  taskId: 'task-terminal',
  track: 'model',
  targetRef: 'model-terminal',
  title: 'Terminal error',
  executionMode: 'full-access',
  createdAt: '2026-08-07T09:00:00.000Z',
  updatedAt: '2026-08-07T09:00:00.000Z',
} as unknown as Conversation;

const failedMessage = {
  id: 'assistant-failed',
  threadId: 'thread-terminal',
  role: 'assistant',
  runId: 'run-failed',
  sequence: 1,
  createdAt: '2026-08-07T09:30:00.000Z',
  blocks: [
    { type: 'text', text: '部分内容已生成' },
    {
      type: 'error',
      payload: {
        terminalState: 'failed',
        errorMessage:
          '请求被网关拒绝（400）：网关不支持参数 enable_thinking、prompt_cache_key（中转网关可能不接受非标准参数）。请调整模型或网关配置，或联系网关管理员。',
      },
    },
  ],
} as unknown as Message;

const KERNEL_SPAWN_ERROR =
  'kernel args contain unsafe shell metacharacters: --ask-for-approval never exec --json';

/**
 * A kernel that dies during spawn emits no text at all — only an error block.
 * This is the shape that used to render as a sent message with no reply and no
 * explanation, because the empty draft was discarded along with its cause.
 */
const outputlessFailure = {
  id: 'assistant-spawn-failed',
  threadId: 'thread-terminal',
  role: 'assistant',
  runId: 'run-spawn-failed',
  sequence: 1,
  createdAt: '2026-08-17T08:07:30.901Z',
  blocks: [
    {
      type: 'error',
      payload: { terminalState: 'failed', errorMessage: KERNEL_SPAWN_ERROR },
    },
  ],
} as unknown as Message;

const cancelledMessage = {
  id: 'assistant-cancelled',
  threadId: 'thread-terminal',
  role: 'assistant',
  runId: 'run-cancelled',
  sequence: 1,
  createdAt: '2026-08-17T08:07:30.901Z',
  blocks: [
    { type: 'text', text: '已经完成了一部分' },
    { type: 'error', payload: { terminalState: 'cancelled' } },
  ],
} as unknown as Message;

beforeEach(() => {
  window.localStorage.clear();
  runtime.appendMessage
    .mockReset()
    .mockResolvedValue({ messageId: 'retry-message', taskVersion: 2 });
  runtime.detectKernels.mockReset().mockResolvedValue({ kernels: [] });
  runtime.openTask.mockReset().mockResolvedValue({ task: { threadId: 'thread-terminal' } });
  runtime.listConversationMessages.mockReset().mockResolvedValue({
    messages: [failedMessage],
    hasMore: false,
  });
  runtime.getConversationRunProcess.mockReset().mockResolvedValue({ process: null });
  runtime.sendConversationMessage.mockReset().mockResolvedValue({
    threadId: 'thread-terminal',
    taskVersion: 1,
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

describe('ChatView terminal failure reason', () => {
  it('offers working continue and retry actions for an interrupted answer', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: [
        {
          ...userMessage,
          blocks: [
            {
              type: 'text',
              text: '请继续处理这个任务',
              payload: { skillVersionIds: ['skill-review-v1'] },
            },
          ],
        },
        cancelledMessage,
      ],
      hasMore: false,
    });
    render(
      <ChatView
        conversation={conversation}
        modelName="gpt-5.6-luna"
        models={[{ modelId: 'model-terminal', displayName: 'gpt-5.6-luna', providerName: 'Relay' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );

    expect(await screen.findByText('回答已中断')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '继续回答' }));
    await waitFor(() =>
      expect(runtime.appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '继续上一条未完成的回答。',
          skillVersionIds: ['skill-review-v1'],
        }),
      ),
    );

    cleanup();
    runtime.appendMessage.mockClear();
    runtime.listConversationMessages.mockResolvedValue({
      messages: [
        {
          ...userMessage,
          blocks: [
            {
              type: 'text',
              text: '请继续处理这个任务',
              payload: { skillVersionIds: ['skill-review-v1'] },
            },
          ],
        },
        cancelledMessage,
      ],
      hasMore: false,
    });
    render(
      <ChatView
        conversation={conversation}
        modelName="gpt-5.6-luna"
        models={[{ modelId: 'model-terminal', displayName: 'gpt-5.6-luna', providerName: 'Relay' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );
    await screen.findByText('回答已中断');
    fireEvent.click(screen.getByRole('button', { name: '重试回答' }));
    await waitFor(() =>
      expect(runtime.appendMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          text: '请继续处理这个任务',
          skillVersionIds: ['skill-review-v1'],
        }),
      ),
    );
  });

  it('keeps a failed turn factual without a model-switch retry action', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: [userMessage, outputlessFailure],
      hasMore: false,
    });
    render(
      <ChatView
        conversation={conversation}
        modelName="gpt-5.6-luna"
        models={[
          { modelId: 'model-terminal', displayName: 'gpt-5.6-luna', providerName: 'Relay' },
          { modelId: 'model-backup', displayName: 'gpt-5.6-sol', providerName: 'Backup' },
        ]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );

    const terminal = await screen.findByTestId('assistant-terminal-failed');
    expect(screen.queryByRole('button', { name: '选择模型并重试' })).toBeNull();
    expect(screen.getByTestId('assistant-terminal-error').textContent).toContain(
      'unsafe shell metacharacters',
    );
    fireEvent.click(terminal.querySelector('summary')!);
    expect(terminal.querySelector('.shell-harness-terminal__detail')?.textContent).toContain(
      KERNEL_SPAWN_ERROR,
    );
  });

  it('shows the concrete failure reason next to the failure notice', async () => {
    render(
      <ChatView
        conversation={conversation}
        modelName="GLM-5.2"
        models={[{ modelId: 'model-terminal', displayName: 'GLM-5.2', providerName: 'Provider' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );

    expect(await screen.findByText('运行失败')).toBeTruthy();
    const reason = screen.getByTestId('assistant-terminal-error');
    expect(reason.textContent).toContain('请求被网关拒绝（400）');
    expect(reason.textContent).toContain('enable_thinking');
    expect(reason.textContent).toContain('prompt_cache_key');
  });

  it('surfaces a spawn-time kernel failure that produced no output at all', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: [outputlessFailure],
      hasMore: false,
    });
    render(
      <ChatView
        conversation={conversation}
        modelName="gpt-5.6-luna"
        models={[{ modelId: 'model-terminal', displayName: 'gpt-5.6-luna', providerName: 'Relay' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );

    // The failure row must exist even with zero process items.
    expect(await screen.findByTestId('assistant-terminal-failed')).toBeTruthy();
    expect(screen.getByTestId('assistant-terminal-error').textContent).toContain(
      'unsafe shell metacharacters',
    );
  });

  it('keeps a paused-run failure inside its assistant process panel without a duplicate bubble', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: [userMessage],
      hasMore: false,
    });
    const pausedEvent = {
      id: 'event-paused-terminal',
      workspaceId: 'workspace-terminal',
      taskId: 'task-terminal',
      runId: 'run-spawn-failed',
      category: 'run',
      type: 'run.paused',
      sequence: 3,
      occurredAt: '2026-08-17T08:07:30.901Z',
      payload: {
        threadId: 'thread-terminal',
        reason: 'no_fallback_configured',
        failureClass: 'unknown',
        errorMessage: KERNEL_SPAWN_ERROR,
      },
    } as unknown as Event;
    const laterRun = {
      ...pausedEvent,
      id: 'event-later-run',
      runId: 'run-later',
      type: 'run.started',
      sequence: 4,
      occurredAt: '2026-08-17T08:08:00.000Z',
      payload: { threadId: 'thread-terminal' },
    } as unknown as Event;

    const view = render(
      <ChatView
        conversation={conversation}
        modelName="gpt-5.6-luna"
        models={[{ modelId: 'model-terminal', displayName: 'gpt-5.6-luna', providerName: 'Relay' }]}
        eventHistory={[pausedEvent, laterRun]}
        onTitleUpdated={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('assistant-terminal-failed')).toBeTruthy();
    expect(view.container.querySelector('.shell-error-bubble')).toBeNull();
  });

  it('places a legacy backfilled failure beside its original turn instead of after newer replies', async () => {
    const laterUser = {
      ...userMessage,
      id: 'user-after-failure',
      sequence: 1,
      createdAt: '2026-08-07T09:31:00.000Z',
      blocks: [{ type: 'text', text: '下一轮消息' }],
    } as unknown as Message;
    const laterAssistant = {
      id: 'assistant-after-failure',
      threadId: 'thread-terminal',
      role: 'assistant',
      runId: 'run-after-failure',
      sequence: 2,
      createdAt: '2026-08-07T09:32:00.000Z',
      blocks: [{ type: 'text', text: '下一轮已完成' }],
    } as unknown as Message;
    const legacyFailure = {
      ...outputlessFailure,
      id: 'asst-run-legacy-paused',
      runId: 'run-legacy-paused',
      sequence: 3,
      createdAt: '2026-08-07T09:30:00.000Z',
      blocks: [
        {
          type: 'error',
          payload: {
            terminalState: 'failed',
            errorMessage: KERNEL_SPAWN_ERROR,
            legacyBackfill: true,
          },
        },
      ],
    } as unknown as Message;
    runtime.listConversationMessages.mockResolvedValue({
      // This is durable sequence order after a v2 backfill into an existing DB.
      messages: [userMessage, laterUser, laterAssistant, legacyFailure],
      hasMore: false,
    });

    const view = render(
      <ChatView
        conversation={conversation}
        modelName="gpt-5.6-luna"
        models={[{ modelId: 'model-terminal', displayName: 'gpt-5.6-luna', providerName: 'Relay' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('assistant-terminal-failed')).toBeTruthy();
    expect(
      [...view.container.querySelectorAll<HTMLElement>('[data-message-id]')].map(
        (node) => node.dataset.messageId,
      ),
    ).toEqual([
      'user-before-failure',
      'asst-run-legacy-paused',
      'user-after-failure',
      'assistant-after-failure',
    ]);
  });
});
