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
  getConversationContextStatus: vi.fn(),
  getUsageSummary: vi.fn(),
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
  contextWatermarkTokens: 5_000,
  lastRequestUsage: {
    tokensIn: 4_000,
    tokensOut: 488,
    cachedTokensHit: 3_200,
    cachedTokensCreated: 0,
  },
  durationMs: 1_000,
  providerModelId: 'gpt-5',
  modelId: 'model-usage',
} as unknown as RunProcessView;

beforeEach(() => {
  window.localStorage.clear();
  runtime.openTask.mockReset().mockResolvedValue({ task: { threadId: 'thread-usage' } });
  runtime.getConversationContextStatus.mockReset().mockResolvedValue({
    modelId: 'model-usage',
    contextWindow: 400_000,
    estimatedUsedTokens: 183_000,
    usageRatio: 0.4575,
    compactThreshold: 0.7,
    compactedAt: '2026-08-04T08:45:00.000Z',
    sections: [
      { type: 'system', tokens: 2_000 },
      { type: 'agent', tokens: 27 },
      { type: 'project', tokens: 79 },
      { type: 'summary', tokens: 12_000 },
      { type: 'messages', tokens: 163_000 },
      { type: 'tools', tokens: 5_894 },
    ],
  });
  runtime.listConversationMessages.mockReset().mockResolvedValue({
    messages: [assistantMessage],
    hasMore: false,
  });
  runtime.getConversationRunProcess.mockReset().mockResolvedValue({ process: processView });
  runtime.getUsageSummary.mockReset().mockResolvedValue({
    rows: [],
    requests: [],
    tools: [],
    toolModels: [],
    toolFailures: [],
    pricing: [],
    totalRequests: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCostByCurrency: {},
    totalReasoningTokens: 0,
    totalTokens: 0,
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

describe('ChatView reply usage details', () => {
  it('uses the durable task-scoped usage summary for cumulative conversation tokens', async () => {
    runtime.getUsageSummary.mockResolvedValueOnce({
      rows: [],
      requests: [
        {
          requestId: 'request-1',
          taskId: 'task-usage',
          occurredAt: '2026-08-04T09:01:00.000Z',
          modelId: 'model-usage',
          tokensIn: 8_000,
          tokensOut: 500,
          totalTokens: 8_500,
          status: 'success',
        },
        {
          requestId: 'request-2',
          taskId: 'task-usage',
          occurredAt: '2026-08-04T09:02:00.000Z',
          modelId: 'model-usage',
          tokensIn: 3_500,
          tokensOut: 345,
          totalTokens: 3_845,
          status: 'success',
        },
      ],
      tools: [],
      toolModels: [],
      toolFailures: [],
      pricing: [],
      totalRequests: 2,
      totalTokensIn: 11_500,
      totalTokensOut: 845,
      totalCostByCurrency: {},
      totalReasoningTokens: 0,
      totalTokens: 12_345,
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

    await waitFor(() =>
      expect(runtime.getUsageSummary).toHaveBeenCalledWith({ taskId: 'task-usage' }),
    );
    fireEvent.mouseEnter(screen.getByTestId('context-ring'));
    expect((await screen.findByTestId('context-session-tokens')).textContent).toBe('12.3k');
  });

  it('does not add the transient event projection on top of the durable total', async () => {
    runtime.getUsageSummary.mockResolvedValueOnce({
      rows: [],
      requests: [],
      tools: [],
      toolModels: [],
      toolFailures: [],
      pricing: [],
      totalRequests: 1,
      totalTokensIn: 90,
      totalTokensOut: 10,
      totalCostByCurrency: {},
      totalReasoningTokens: 0,
      totalTokens: 100,
    });

    render(
      <ChatView
        conversation={conversation}
        modelName="GPT-5"
        models={[{ modelId: 'model-usage', displayName: 'GPT-5', providerName: 'Provider' }]}
        eventHistory={[
          {
            id: 'usage-event',
            workspaceId: 'workspace-usage',
            taskId: 'task-usage',
            runId: 'run-usage',
            category: 'provider',
            type: 'provider.usage',
            sequence: 1,
            occurredAt: '2026-08-04T09:01:00.000Z',
            payload: {
              requestId: 'request-1',
              tokensIn: 90,
              tokensOut: 10,
              totalTokens: 100,
            },
          } as never,
        ]}
        onTitleUpdated={vi.fn()}
      />,
    );

    await waitFor(() => expect(runtime.getUsageSummary).toHaveBeenCalled());
    fireEvent.mouseEnter(screen.getByTestId('context-ring'));
    expect((await screen.findByTestId('context-session-tokens')).textContent).toBe('100');
  });

  it('does not let a stale usage response overwrite the newly selected conversation', async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof runtime.getUsageSummary>>) => void;
    const oldSummary = new Promise<Awaited<ReturnType<typeof runtime.getUsageSummary>>>(
      (resolve) => {
        resolveOld = resolve;
      },
    );
    runtime.getUsageSummary
      .mockImplementationOnce(() => oldSummary)
      .mockResolvedValueOnce({
        rows: [],
        requests: [],
        tools: [],
        toolModels: [],
        toolFailures: [],
        pricing: [],
        totalRequests: 1,
        totalTokensIn: 200,
        totalTokensOut: 20,
        totalCostByCurrency: {},
        totalReasoningTokens: 0,
        totalTokens: 220,
      });
    runtime.openTask.mockImplementation(async ({ taskId }: { taskId: string }) => ({
      task: { threadId: taskId === 'task-usage-b' ? 'thread-usage-b' : 'thread-usage' },
    }));

    const view = render(
      <ChatView
        conversation={conversation}
        modelName="GPT-5"
        models={[{ modelId: 'model-usage', displayName: 'GPT-5', providerName: 'Provider' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );
    view.rerender(
      <ChatView
        conversation={
          {
            ...conversation,
            id: 'conversation-usage-b',
            taskId: 'task-usage-b',
            title: 'Usage details B',
          } as unknown as Conversation
        }
        modelName="GPT-5"
        models={[{ modelId: 'model-usage', displayName: 'GPT-5', providerName: 'Provider' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(runtime.getUsageSummary).toHaveBeenCalledWith({ taskId: 'task-usage-b' }),
    );
    resolveOld({
      rows: [],
      requests: [],
      tools: [],
      toolModels: [],
      toolFailures: [],
      pricing: [],
      totalRequests: 1,
      totalTokensIn: 9_000,
      totalTokensOut: 900,
      totalCostByCurrency: {},
      totalReasoningTokens: 0,
      totalTokens: 9_900,
    });
    await Promise.resolve();
    fireEvent.mouseEnter(screen.getByTestId('context-ring'));
    expect((await screen.findByTestId('context-session-tokens')).textContent).toBe('220');
  });

  it('uses the Runtime full-conversation snapshot for context occupancy', async () => {
    render(
      <ChatView
        conversation={conversation}
        modelName="GPT-5"
        models={[{ modelId: 'model-usage', displayName: 'GPT-5', providerName: 'Provider' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );

    await waitFor(() => expect(runtime.getConversationContextStatus).toHaveBeenCalled());
    fireEvent.mouseEnter(screen.getByTestId('context-ring'));

    const tooltip = await screen.findByTestId('context-ring-tooltip');
    expect(within(tooltip).getByTestId('context-used-value').textContent).toContain('183k');
    expect(within(tooltip).getByText('当前对话上下文构成')).toBeTruthy();
    expect(within(tooltip).getByTestId('context-section-summary').textContent).toContain('12k');
    expect(within(tooltip).getByTestId('context-compact-distance').textContent).toBe('97k');
  });

  it('shows context occupancy, billing total, and single-request input/cache/output in the hover panel', async () => {
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
    // 主标签现在是上下文占用（watermark=5000），不是累计求和（14.5k）。
    fireEvent.focus(await screen.findByText('1s · 5k'));

    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText('本次回复累计')).toBeTruthy();
    expect(within(tooltip).getByText('计费累计')).toBeTruthy();
    expect(within(tooltip).getByText('14.5k')).toBeTruthy();
    expect(within(tooltip).getByText('上下文占用')).toBeTruthy();
    expect(within(tooltip).getByText('5k')).toBeTruthy();
    // 普通输入/缓存读取/输出用「最后一次请求」的单次口径（lastRequestUsage）：
    // in=4000、cachedHit=3200、out=488 → 普通输入=800、缓存读取=3.2k、输出=488。
    expect(within(tooltip).getByText('普通输入')).toBeTruthy();
    expect(within(tooltip).getByText('800')).toBeTruthy();
    expect(within(tooltip).getByText('缓存读取')).toBeTruthy();
    expect(within(tooltip).getByText('3.2k')).toBeTruthy();
    expect(within(tooltip).getByText('输出')).toBeTruthy();
    expect(within(tooltip).getByText('488')).toBeTruthy();
  });

  it('shows unreported cache accounting instead of fabricating zeroes', async () => {
    runtime.getConversationRunProcess.mockResolvedValueOnce({
      process: {
        ...processView,
        cachedTokensHit: undefined,
        cachedTokensCreated: undefined,
        lastRequestUsage: {
          tokensIn: 4_000,
          tokensOut: 488,
          cachedTokensHit: undefined,
          cachedTokensCreated: undefined,
        },
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
    fireEvent.focus(await screen.findByText('1s · 5k'));

    const tooltip = await screen.findByRole('tooltip');
    // 缓存读取未上报时显示「未上报」，不伪造 0。
    expect(within(tooltip).getAllByText('未上报')).toHaveLength(1);
    expect(within(tooltip).getByText('上下文占用')).toBeTruthy();
  });

  it('keeps per-reply usage visible for a completed commentary-only assistant turn', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: [
        {
          ...assistantMessage,
          blocks: [{ type: 'commentary', text: '已完成检查，没有额外正文。' }],
        } as Message,
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

    // 内联执行过程视图平铺呈现 commentary；usage 落在消息 footer。
    expect((await screen.findAllByText('已完成检查，没有额外正文。')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('inline-process-commentary')).toBeTruthy();
    await waitFor(() => expect(runtime.getConversationRunProcess).toHaveBeenCalled());
    expect(await screen.findByText(/1s · 5k/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '复制' })).toBeNull();
    expect(screen.queryByRole('button', { name: '分享' })).toBeNull();
  });

  it('shows explicit runtime reconnect and failure notices without durable message pollution', async () => {
    const view = render(
      <ChatView
        conversation={conversation}
        modelName="GPT-5"
        models={[{ modelId: 'model-usage', displayName: 'GPT-5', providerName: 'Provider' }]}
        eventHistory={[]}
        runtimeConnectionNotice={{
          state: 'retrying',
          text: '正在重新连接运行时 2/6',
        }}
        onTitleUpdated={vi.fn()}
      />,
    );

    expect((await screen.findByRole('status')).textContent).toContain('正在重新连接运行时 2/6');

    view.rerender(
      <ChatView
        conversation={conversation}
        modelName="GPT-5"
        models={[{ modelId: 'model-usage', displayName: 'GPT-5', providerName: 'Provider' }]}
        eventHistory={[]}
        runtimeConnectionNotice={{
          state: 'failed',
          text: '连接运行时失败：runtime.unavailable',
        }}
        onTitleUpdated={vi.fn()}
      />,
    );

    expect((await screen.findByRole('status')).textContent).toContain(
      '连接运行时失败：runtime.unavailable',
    );
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

  it('restores the per-conversation reasoning effort from storage on mount', async () => {
    window.localStorage.setItem(
      'sync-think.conversationReasoningEfforts',
      JSON.stringify({ 'conversation-usage': 'high' }),
    );
    render(
      <ChatView
        conversation={conversation}
        modelName="GPT-5"
        models={[{ modelId: 'model-usage', displayName: 'GPT-5', providerName: 'Provider' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );

    const trigger = await screen.findByTitle('切换模型，思考强度：高');
    expect(trigger.textContent).toContain('高');
  });

  it('persists the reasoning effort when the user changes it from the model menu', async () => {
    render(
      <ChatView
        conversation={conversation}
        modelName="GPT-5"
        models={[{ modelId: 'model-usage', displayName: 'GPT-5', providerName: 'Provider' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByTitle('切换模型，思考强度：自动'));
    fireEvent.click(await screen.findByTestId('model-reasoning-trigger'));
    fireEvent.click(await screen.findByTestId('model-reasoning-option-high'));

    await waitFor(() =>
      expect(screen.getByTitle('切换模型，思考强度：高').textContent).toContain('高'),
    );
    expect(
      JSON.parse(window.localStorage.getItem('sync-think.conversationReasoningEfforts') ?? '{}'),
    ).toEqual({ 'conversation-usage': 'high' });
  });

  it('moves network search into the @ menu and persists it for the conversation', async () => {
    const view = render(
      <ChatView
        conversation={conversation}
        modelName="GPT-5"
        models={[{ modelId: 'model-usage', displayName: 'GPT-5', providerName: 'Provider' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );

    expect(screen.queryByTitle(/联网已开/)).toBeNull();
    const input = await screen.findByTestId('compose-input');
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });

    const popover = await screen.findByTestId('compose-mention-pop');
    expect(within(popover).getByText('设置')).toBeTruthy();
    expect(within(popover).getByText('联网搜索')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Tab' });
    const enableNetwork = within(popover).getByRole('button', { name: '开启联网搜索' });
    expect(document.activeElement).toBe(enableNetwork);
    fireEvent.keyDown(enableNetwork, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    await waitFor(() => expect(screen.queryByTestId('compose-mention-pop')).toBeNull());

    fireEvent.change(input, { target: { value: '', selectionStart: 0 } });
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
    const reopenedPopover = await screen.findByTestId('compose-mention-pop');
    fireEvent.click(within(reopenedPopover).getByRole('button', { name: '关闭联网搜索' }));

    expect(
      JSON.parse(window.localStorage.getItem('sync-think.conversationNetworkEnabled') ?? '{}'),
    ).toEqual({ 'conversation-usage': false });

    view.unmount();
    render(
      <ChatView
        conversation={conversation}
        modelName="GPT-5"
        models={[{ modelId: 'model-usage', displayName: 'GPT-5', providerName: 'Provider' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );
    const restoredInput = await screen.findByTestId('compose-input');
    fireEvent.change(restoredInput, { target: { value: '@', selectionStart: 1 } });
    expect(
      (await screen.findByRole('button', { name: '关闭联网搜索' })).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
