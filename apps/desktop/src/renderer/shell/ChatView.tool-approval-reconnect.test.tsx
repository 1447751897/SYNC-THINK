/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PendingToolApprovalSummary } from '@sync-think/protocol';
import type { Conversation } from '@sync-think/shared';
import { ChatView } from './ChatView.js';

const runtime = {
  decideToolApproval: vi.fn(),
  appendMessage: vi.fn(),
  listConversationMessages: vi.fn(),
  listPendingToolApprovals: vi.fn(),
  openTask: vi.fn(),
};

function conversation(): Conversation {
  return {
    id: 'conversation-approval-reconnect',
    workspaceId: 'workspace-approval-reconnect',
    taskId: 'task-approval-reconnect',
    track: 'model',
    targetRef: 'model-a',
    title: 'Approval reconnect',
    executionMode: 'ask',
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  } as unknown as Conversation;
}

function approval(): PendingToolApprovalSummary {
  return {
    approvalId: 'approval-reconnect-a',
    threadId: 'thread-approval-reconnect',
    runId: 'run-approval-reconnect',
    toolCallId: 'tool-call-reconnect',
    toolName: 'write_file',
    title: '写入文件 README.md',
    detail: '约 2 行 · 18 字符',
    path: 'README.md',
    status: 'pending',
    createdAt: '2026-08-21T00:00:01.000Z',
  } as PendingToolApprovalSummary;
}

function computerUseApproval(): PendingToolApprovalSummary {
  return {
    ...approval(),
    approvalId: 'approval-computer-use',
    toolCallId: 'tool-call-computer-use',
    toolName: 'mcp__computer-use__computer_click',
    arguments: { app_id: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
    title: '点击计算器',
    detail: '点击按钮 7',
  };
}

function renderChat(runtimeConnectionRevision = 0) {
  return render(
    <ChatView
      conversation={conversation()}
      modelName="Model A"
      models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
      eventHistory={[]}
      runtimeConnectionRevision={runtimeConnectionRevision}
      onTitleUpdated={vi.fn()}
    />,
  );
}

beforeEach(() => {
  runtime.appendMessage.mockReset();
  runtime.decideToolApproval.mockReset().mockResolvedValue({
    approvalId: 'approval-reconnect-a',
    decision: 'deny',
    runId: 'run-approval-reconnect',
  });
  runtime.openTask.mockReset().mockResolvedValue({
    task: { threadId: 'thread-approval-reconnect' },
  });
  runtime.listConversationMessages.mockReset().mockResolvedValue({ messages: [], hasMore: false });
  runtime.listPendingToolApprovals.mockReset().mockResolvedValue({ approvals: [approval()] });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ChatView pending tool approval reconnect', () => {
  it('restores an in-flight approval from Runtime on a cold Renderer start', async () => {
    renderChat();

    expect(await screen.findByText('写入文件 README.md')).toBeTruthy();
    expect(screen.getByTestId('composer-peek-surface').getAttribute('data-kind')).toBe('tool');
    expect(screen.getByTestId('tool-approval-approval-reconnect-a').className).toContain(
      'shell-composer-tool-approval',
    );
    expect(screen.queryByText('批准创建')).toBeNull();
    expect(runtime.listPendingToolApprovals).toHaveBeenCalledWith({
      threadId: 'thread-approval-reconnect',
    });
  });

  it('reconciles the card again after Runtime reconnect', async () => {
    runtime.listPendingToolApprovals
      .mockResolvedValueOnce({ approvals: [approval()] })
      .mockResolvedValue({ approvals: [] });
    const view = renderChat(0);
    expect(await screen.findByText('写入文件 README.md')).toBeTruthy();

    view.rerender(
      <ChatView
        conversation={conversation()}
        modelName="Model A"
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
        eventHistory={[]}
        runtimeConnectionRevision={1}
        onTitleUpdated={vi.fn()}
      />,
    );

    await waitFor(() => expect(runtime.listPendingToolApprovals).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('写入文件 README.md')).toBeNull());
  });

  it('denies a restored approval and refreshes the Runtime snapshot', async () => {
    runtime.listPendingToolApprovals
      .mockResolvedValueOnce({ approvals: [approval()] })
      .mockResolvedValue({ approvals: [] });
    renderChat();

    fireEvent.click(await screen.findByRole('button', { name: '拒绝' }));
    await waitFor(() =>
      expect(runtime.decideToolApproval).toHaveBeenCalledWith({
        approvalId: 'approval-reconnect-a',
        decision: 'deny',
        scope: 'once',
      }),
    );
    await waitFor(() => expect(runtime.listPendingToolApprovals).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('写入文件 README.md')).toBeNull());
  });

  it('offers session approval for ordinary tools and only renders the first pending item', async () => {
    runtime.listPendingToolApprovals
      .mockResolvedValueOnce({
        approvals: [
          approval(),
          {
            ...approval(),
            approvalId: 'approval-second',
            toolCallId: 'tool-call-second',
            title: '第二条审批',
          },
        ],
      })
      .mockResolvedValue({ approvals: [] });
    renderChat();

    expect(await screen.findByText('写入文件 README.md')).toBeTruthy();
    expect(screen.queryByText('第二条审批')).toBeNull();
    expect(screen.queryByRole('button', { name: '始终允许此应用' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '本会话允许' }));

    await waitFor(() =>
      expect(runtime.decideToolApproval).toHaveBeenCalledWith({
        approvalId: 'approval-reconnect-a',
        decision: 'approve',
        scope: 'session',
      }),
    );
  });

  it('offers persistent approval only for a valid Computer Use app id', async () => {
    runtime.listPendingToolApprovals
      .mockResolvedValueOnce({ approvals: [computerUseApproval()] })
      .mockResolvedValue({ approvals: [] });
    renderChat();

    expect(await screen.findByText('点击计算器')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '本会话允许' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '始终允许此应用' }));

    await waitFor(() =>
      expect(runtime.decideToolApproval).toHaveBeenCalledWith({
        approvalId: 'approval-computer-use',
        decision: 'approve',
        scope: 'always-app',
      }),
    );
  });
});

function expiredApproval() {
  return {
    ...approval(),
    status: 'expired',
    reason: 'stale-approval',
    expiredAt: '2026-09-06T00:00:00.000Z',
    requestMessageId: 'original-request',
  };
}

function originalApprovalRequest() {
  return {
    id: 'original-request',
    threadId: 'thread-approval-reconnect',
    runId: 'run-approval-reconnect',
    role: 'user',
    sequence: 1,
    blocks: [{ type: 'text', text: '核对原来的文档并修改错字' }],
    createdAt: '2026-08-21T00:00:00.000Z',
  };
}

describe('ChatView expired approval recovery', () => {
  it('shows durable expiry on reconnect without offering old approval scopes', async () => {
    runtime.listPendingToolApprovals.mockResolvedValue({
      approvals: [],
      expired: [expiredApproval()],
      expiredCount: 1,
    });
    renderChat();
    expect(await screen.findByText('审批已失效')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull();
    expect(screen.queryByRole('button', { name: '本会话允许' })).toBeNull();
    expect(runtime.decideToolApproval).not.toHaveBeenCalled();
    expect(runtime.listConversationMessages).not.toHaveBeenCalledWith(
      expect.objectContaining({ aroundMessageId: 'original-request' }),
    );
  });

  it('reads the exact original request on demand and appends it without sending or approving', async () => {
    runtime.listPendingToolApprovals.mockResolvedValue({
      approvals: [],
      expired: [expiredApproval()],
    });
    runtime.listConversationMessages.mockImplementation(async (payload) =>
      payload.aroundMessageId
        ? { messages: [originalApprovalRequest()], hasMore: false }
        : { messages: [], hasMore: false },
    );
    renderChat();
    const button = await screen.findByRole('button', { name: '重新编辑原请求' });
    fireEvent.change(screen.getByTestId('compose-input'), { target: { value: '我刚写的新内容' } });
    fireEvent.click(button);
    await waitFor(() =>
      expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe(
        '我刚写的新内容\n\n核对原来的文档并修改错字',
      ),
    );
    expect(runtime.listConversationMessages).toHaveBeenCalledWith({
      conversationId: 'conversation-approval-reconnect',
      aroundMessageId: 'original-request',
      limit: 1,
    });
    expect(runtime.decideToolApproval).not.toHaveBeenCalled();
    expect(await screen.findByText(/已恢复原请求，请核对后发送/)).toBeTruthy();
  });

  it('reports expiry from a click response even if the follow-up list has no expired records', async () => {
    runtime.decideToolApproval.mockResolvedValue({
      approvalId: approval().approvalId,
      decision: 'deny',
      scope: 'once',
      outcome: 'expired',
      reason: 'stale-approval',
      runId: approval().runId,
    });
    runtime.listPendingToolApprovals
      .mockResolvedValueOnce({ approvals: [approval()] })
      .mockResolvedValue({ approvals: [] });
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: '批准' }));
    expect(await screen.findByText(/原审批已失效/)).toBeTruthy();
    expect(screen.queryByText('已批准')).toBeNull();
  });
});

describe('approval draft recovery races', () => {
  it('keeps newer typing and suppresses duplicate reads while recovery is pending', async () => {
    let finishRead!: (value: unknown) => void;
    const deferred = new Promise((resolve) => {
      finishRead = resolve;
    });
    runtime.listPendingToolApprovals.mockResolvedValue({
      approvals: [],
      expired: [expiredApproval()],
    });
    runtime.listConversationMessages.mockImplementation(async (payload) =>
      payload.aroundMessageId ? deferred : { messages: [], hasMore: false },
    );
    renderChat();
    const button = await screen.findByRole('button', { name: '重新编辑原请求' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.change(screen.getByTestId('compose-input'), { target: { value: '读取时的新编辑' } });
    finishRead({ messages: [originalApprovalRequest()], hasMore: false });
    await waitFor(() =>
      expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe(
        '读取时的新编辑\n\n核对原来的文档并修改错字',
      ),
    );
    expect(
      runtime.listConversationMessages.mock.calls.filter(([payload]) => payload.aroundMessageId),
    ).toHaveLength(1);
    expect(runtime.appendMessage).not.toHaveBeenCalled();
  });

  it('does not recover a different run or fall back to the latest message', async () => {
    runtime.listPendingToolApprovals.mockResolvedValue({
      approvals: [],
      expired: [expiredApproval()],
    });
    runtime.listConversationMessages.mockImplementation(async (payload) =>
      payload.aroundMessageId
        ? { messages: [{ ...originalApprovalRequest(), runId: 'different-run' }], hasMore: false }
        : { messages: [], hasMore: false },
    );
    renderChat();
    const button = await screen.findByRole('button', { name: '重新编辑原请求' });
    fireEvent.change(screen.getByTestId('compose-input'), { target: { value: '保留我的草稿' } });
    fireEvent.click(button);
    expect(await screen.findByText(/恢复原请求失败，当前草稿保持不变/)).toBeTruthy();
    expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe('保留我的草稿');
    expect(runtime.appendMessage).not.toHaveBeenCalled();
  });

  it('ignores a source response that arrives after switching conversations', async () => {
    let finishRead!: (value: unknown) => void;
    const deferred = new Promise((resolve) => {
      finishRead = resolve;
    });
    runtime.listPendingToolApprovals.mockImplementation(async (payload) =>
      payload.threadId === 'thread-approval-reconnect'
        ? { approvals: [], expired: [expiredApproval()] }
        : { approvals: [] },
    );
    runtime.listConversationMessages.mockImplementation(async (payload) =>
      payload.aroundMessageId ? deferred : { messages: [], hasMore: false },
    );
    runtime.openTask.mockImplementation(async (payload) => ({
      task: {
        threadId: payload.taskId === 'other-task' ? 'other-thread' : 'thread-approval-reconnect',
      },
    }));
    const view = renderChat();
    fireEvent.click(await screen.findByRole('button', { name: '重新编辑原请求' }));
    view.rerender(
      <ChatView
        conversation={{
          ...conversation(),
          id: 'other-conversation' as never,
          taskId: 'other-task' as never,
        }}
        modelName="Model A"
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('compose-input'), { target: { value: '另一个会话' } });
    finishRead({ messages: [originalApprovalRequest()], hasMore: false });
    await waitFor(() =>
      expect(runtime.openTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'other-task' }),
      ),
    );
    expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe('另一个会话');
    expect(screen.queryByText(/已恢复原请求，请核对后发送/)).toBeNull();
    expect(runtime.appendMessage).not.toHaveBeenCalled();
  });
});

describe('legacy source request recovery', () => {
  it('recovers an exact Runtime-verified legacy message with no stored runId', async () => {
    runtime.listPendingToolApprovals.mockResolvedValue({
      approvals: [],
      expired: [expiredApproval()],
    });
    runtime.listConversationMessages.mockImplementation(async (payload) =>
      payload.aroundMessageId
        ? { messages: [{ ...originalApprovalRequest(), runId: undefined }], hasMore: false }
        : { messages: [], hasMore: false },
    );
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: '重新编辑原请求' }));
    await waitFor(() =>
      expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe(
        '核对原来的文档并修改错字',
      ),
    );
    expect(runtime.appendMessage).not.toHaveBeenCalled();
    expect(runtime.decideToolApproval).not.toHaveBeenCalled();
  });

  it('still rejects a source message explicitly owned by another run', async () => {
    runtime.listPendingToolApprovals.mockResolvedValue({
      approvals: [],
      expired: [expiredApproval()],
    });
    runtime.listConversationMessages.mockImplementation(async (payload) =>
      payload.aroundMessageId
        ? { messages: [{ ...originalApprovalRequest(), runId: 'other-run' }], hasMore: false }
        : { messages: [], hasMore: false },
    );
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: '重新编辑原请求' }));
    expect(await screen.findByText(/原请求已变更或不属于该审批/)).toBeTruthy();
    expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe('');
    expect(runtime.appendMessage).not.toHaveBeenCalled();
  });
});
