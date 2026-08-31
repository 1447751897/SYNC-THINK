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
