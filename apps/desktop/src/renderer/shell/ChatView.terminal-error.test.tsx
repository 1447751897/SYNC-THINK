/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Conversation, Message } from '@sync-think/shared';
import { ChatView } from './ChatView.js';

const runtime = {
  getConversationRunProcess: vi.fn(),
  listConversationMessages: vi.fn(),
  openTask: vi.fn(),
};

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
        errorMessage: '请求被网关拒绝（400）：网关不支持参数 enable_thinking、prompt_cache_key（中转网关可能不接受非标准参数）。请调整模型或网关配置，或联系网关管理员。',
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

beforeEach(() => {
  runtime.openTask.mockReset().mockResolvedValue({ task: { threadId: 'thread-terminal' } });
  runtime.listConversationMessages.mockReset().mockResolvedValue({
    messages: [failedMessage],
    hasMore: false,
  });
  runtime.getConversationRunProcess.mockReset().mockResolvedValue({ process: null });
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

    const processToggle = await screen.findByTestId('process-panel-toggle');
    expect(processToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(processToggle);
    // The failure notice and concrete reason live inside the execution panel.
    expect(await screen.findByText('回复失败，已保留中断前内容')).toBeTruthy();
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

    // The panel must exist even with zero process items — otherwise the run is
    // silently invisible and the user just sees no reply.
    const processToggle = await screen.findByTestId('process-panel-toggle');
    fireEvent.click(processToggle);
    expect(await screen.findByTestId('assistant-terminal-failed')).toBeTruthy();
    expect(screen.getByTestId('assistant-terminal-error').textContent).toContain(
      'unsafe shell metacharacters',
    );
  });
});
