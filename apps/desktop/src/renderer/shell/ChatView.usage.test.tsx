/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Conversation, Message } from '@sync-think/shared';
import type { RunProcessView } from '@sync-think/protocol';
import { ChatView } from './ChatView.js';

const runtime = {
  getConversationRunProcess: vi.fn(),
  listConversationMessages: vi.fn(),
  openTask: vi.fn(),
};

const conversation = {
  id: 'conversation-usage',
  workspaceId: 'workspace-usage',
  taskId: 'task-usage',
  track: 'model',
  targetRef: 'model-usage',
  title: 'Usage details',
  executionMode: 'full-access',
  createdAt: '2026-08-04T09:00:00.000Z',
  updatedAt: '2026-08-04T09:00:00.000Z',
} as unknown as Conversation;

const assistantMessage = {
  id: 'assistant-usage',
  threadId: 'thread-usage',
  role: 'assistant',
  runId: 'run-usage',
  sequence: 1,
  createdAt: '2026-08-04T09:30:00.000Z',
  blocks: [{ type: 'text', text: 'cached reply' }],
} as Message;

const processView = {
  runId: 'run-usage',
  steps: [],
  fileChanges: [],
  running: false,
  doneCount: 0,
  errorCount: 0,
  tokensIn: 14_000,
  tokensOut: 488,
  cachedTokensHit: 12_800,
  cachedTokensCreated: 0,
  durationMs: 1_000,
  providerModelId: 'gpt-5',
  modelId: 'model-usage',
} as unknown as RunProcessView;

beforeEach(() => {
  runtime.openTask.mockReset().mockResolvedValue({ task: { threadId: 'thread-usage' } });
  runtime.listConversationMessages.mockReset().mockResolvedValue({
    messages: [assistantMessage],
    hasMore: false,
  });
  runtime.getConversationRunProcess.mockReset().mockResolvedValue({ process: processView });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ChatView reply usage details', () => {
  it('separates ordinary input, cache reads, cache writes, and output in the hover panel', async () => {
    render(
      <ChatView
        conversation={conversation}
        modelName="GPT-5"
        models={[{ modelId: 'model-usage', displayName: 'GPT-5', providerName: 'Provider' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );

    expect(await screen.findByText('cached reply')).toBeTruthy();
    await waitFor(() => expect(runtime.getConversationRunProcess).toHaveBeenCalled());
    fireEvent.focus(await screen.findByText('1s · 14.5k'));

    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText('总 Token')).toBeTruthy();
    expect(within(tooltip).getByText('14.5k')).toBeTruthy();
    expect(within(tooltip).getByText('普通输入')).toBeTruthy();
    expect(within(tooltip).getByText('1.2k')).toBeTruthy();
    expect(within(tooltip).getByText('缓存读取')).toBeTruthy();
    expect(within(tooltip).getByText('12.8k')).toBeTruthy();
    expect(within(tooltip).getByText('缓存创建')).toBeTruthy();
    expect(within(tooltip).getByText('输出')).toBeTruthy();
    expect(within(tooltip).getByText('488')).toBeTruthy();
  });
});
