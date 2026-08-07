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
    expect(within(tooltip).getByText('本次回复累计')).toBeTruthy();
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

  it('shows unreported cache accounting instead of fabricating zeroes', async () => {
    runtime.getConversationRunProcess.mockResolvedValueOnce({
      process: {
        ...processView,
        cachedTokensHit: undefined,
        cachedTokensCreated: undefined,
      },
    });
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
    expect(within(tooltip).getAllByText('未上报')).toHaveLength(2);
  });

  it('collapses a long user message and expands on demand', async () => {
    const longText = '这是一条超长的用户消息。'.repeat(200);
    runtime.listConversationMessages.mockResolvedValue({
      messages: [
        {
          id: 'user-long',
          threadId: 'thread-usage',
          role: 'user',
          sequence: 0,
          createdAt: '2026-08-04T09:00:00.000Z',
          blocks: [{ type: 'text', text: longText }],
        } as unknown as Message,
      ],
      hasMore: false,
    });
    // jsdom reports scrollHeight 0 — simulate a message taller than the cap.
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 500,
    });
    try {
      render(
        <ChatView
          conversation={conversation}
          modelName="GPT-5"
          models={[{ modelId: 'model-usage', displayName: 'GPT-5', providerName: 'Provider' }]}
          eventHistory={[]}
          onTitleUpdated={vi.fn()}
        />,
      );

      // Default collapsed: toggle shows 显示更多.
      const expand = await screen.findByRole('button', { name: /显示更多/ });
      expect(expand).toBeTruthy();
      // Clicking expands the message.
      fireEvent.click(expand);
      expect(await screen.findByRole('button', { name: /收起/ })).toBeTruthy();
      // Collapse again.
      fireEvent.click(screen.getByRole('button', { name: /收起/ }));
      expect(await screen.findByRole('button', { name: /显示更多/ })).toBeTruthy();
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', original);
      else delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });

  it('does not show the toggle for short user messages', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: [
        {
          id: 'user-short',
          threadId: 'thread-usage',
          role: 'user',
          sequence: 0,
          createdAt: '2026-08-04T09:00:00.000Z',
          blocks: [{ type: 'text', text: '短消息' }],
        } as unknown as Message,
      ],
      hasMore: false,
    });
    render(
      <ChatView
        conversation={conversation}
        modelName="GPT-5"
        models={[{ modelId: 'model-usage', displayName: 'GPT-5', providerName: 'Provider' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );

    expect(await screen.findByText('短消息')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /显示更多|收起/ })).toBeNull();
  });
});
