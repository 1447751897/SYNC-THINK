/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Conversation, DeferredContent, Message, RunId } from '@sync-think/shared';
import type { ConversationTransientSubscriptionEvent } from './use-conversation-transient-subscription.js';
import { ChatView } from './ChatView.js';
import { deferredContentReader } from './deferred-content-reader.js';
vi.mock('./deferred-content-reader.js', () => ({ deferredContentReader: { read: vi.fn() } }));
const runtime = {
  openTask: vi.fn(),
  subscribeConversationTransientStream: vi.fn(),
  listConversationMessages: vi.fn(),
  appendMessage: vi.fn(),
  sendConversationMessage: vi.fn(),
  getConversationRunProcess: vi.fn(),
};
const copy = vi.fn();
let sequence = 0;
const contentRef: DeferredContent = {
  reference: { source: 'timeline', runId: 'run-response' as RunId, id: 'answer', path: ['text'] },
  utf16Length: 100000,
  utf8Bytes: 100000,
  format: 'text',
};
const answer = '最终答案：项目通过 README.md 描述安装步骤。';
function reply(deferred = false): Message {
  return {
    id: 'response-assistant',
    threadId: 'thread-response',
    role: 'assistant',
    runId: 'run-response',
    sequence: 2,
    createdAt: '2026-09-24T12:00:00Z',
    blocks: [
      { type: 'text', text: '我先检查 README，这段属于执行过程。' },
      {
        type: 'tool-call',
        toolCallId: 'read-call',
        name: 'read_file',
        argumentsJson: '{"path":"README.md"}',
      },
      { type: 'tool-result', toolCallId: 'read-call', name: 'read_file', text: '# Project' },
      { type: 'text', text: deferred ? '预览答案' : answer, ...(deferred ? { contentRef } : {}) },
    ],
  } as unknown as Message;
}
function renderChat(agentWorkspace = false, track: Conversation['track'] = 'model') {
  const conversation = {
    id: 'conversation-response-' + ++sequence,
    workspaceId: 'workspace-response',
    taskId: 'task-response',
    track,
    targetRef: 'model-a',
    title: 'Response integration',
    executionMode: 'full-access',
    createdAt: '2026-09-24T12:00:00Z',
    updatedAt: '2026-09-24T12:00:00Z',
  } as unknown as Conversation;
  return render(
    <ChatView
      agentWorkspace={agentWorkspace}
      conversation={conversation}
      modelName="Model A"
      models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
      eventHistory={[]}
      onTitleUpdated={vi.fn()}
    />,
  );
}
beforeEach(() => {
  window.localStorage.clear();
  runtime.subscribeConversationTransientStream.mockReset();
  runtime.openTask.mockReset().mockResolvedValue({ task: { threadId: 'thread-response' } });
  runtime.listConversationMessages
    .mockReset()
    .mockResolvedValue({ messages: [reply()], hasMore: false });
  runtime.getConversationRunProcess.mockReset().mockResolvedValue({ process: null });
  runtime.appendMessage.mockReset().mockResolvedValue({ messageId: 'retry', taskVersion: 2 });
  runtime.sendConversationMessage
    .mockReset()
    .mockResolvedValue({ threadId: 'thread-response', taskVersion: 1 });
  copy.mockReset().mockResolvedValue(undefined);
  vi.mocked(deferredContentReader.read).mockReset();
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime } });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('ChatView response integration', () => {
  it('renders live kernel tokens before terminal, then reclassifies tool commentary without duplication', async () => {
    let deliver!: (event: ConversationTransientSubscriptionEvent) => void;
    runtime.listConversationMessages.mockResolvedValue({ messages: [], hasMore: false });
    runtime.subscribeConversationTransientStream.mockImplementation((_payload, listener) => {
      deliver = listener;
      return { ready: Promise.resolve({ subscriptionId: 'live-response' }), unsubscribe: vi.fn(async () => undefined) };
    });
    renderChat();
    await waitFor(() => expect(deliver).toBeTypeOf('function'));
    const emit = (streamSequence: number, fields: Record<string, unknown>) => act(() => deliver({
      type: 'frame', frame: { threadId: 'thread-response', runId: 'run-live-response', streamSequence, occurredAt: '2026-09-25T00:00:00Z', ...fields },
    } as ConversationTransientSubscriptionEvent));
    emit(1, { kind: 'text', provisional: true, textDelta: '我先检查资料。' });
    await screen.findByText('我先检查资料。');
    expect(screen.getByTestId('streaming-response').getAttribute('data-state')).toBe('streaming');
    const commentary = { id: 'commentary', sequence: 0, kind: 'text', phase: 'commentary', text: '我先检查资料。', status: 'completed' };
    emit(2, { kind: 'commentary', textDelta: '', assistantTimeline: [commentary] });
    emit(3, { kind: 'text', provisional: true, textDelta: '这是正在输出的答案。', assistantTimeline: [commentary] });
    await screen.findByText('这是正在输出的答案。');
    const response = screen.getByTestId('streaming-response');
    expect(response.getAttribute('data-state')).toBe('streaming');
    expect(within(response).queryByText('我先检查资料。')).toBeNull();
    emit(4, { kind: 'terminal', terminalState: 'completed', assistantTimeline: [commentary, { id: 'answer', sequence: 1, kind: 'text', phase: 'final_answer', text: '这是正在输出的答案。', status: 'completed' }] });
    await waitFor(() => expect(response.getAttribute('data-state')).toBe('complete'));
    expect(screen.getAllByText('这是正在输出的答案。')).toHaveLength(1);
  });
  it('copies only the displayed answer instead of command commentary', async () => {
    renderChat();
    await screen.findByText(answer);
    const response = screen.getByTestId('streaming-response');
    expect(response.getAttribute('data-state')).toBe('complete');
    expect(within(response).getAllByRole('button', { name: '复制' })).toHaveLength(1);
    fireEvent.click(within(response).getByRole('button', { name: '复制' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(answer));
    expect(within(response).getByRole('button', { name: '已复制' })).toBeTruthy();
  });
  it('reads the full deferred answer for rendering and copying', async () => {
    runtime.listConversationMessages.mockResolvedValue({ messages: [reply(true)], hasMore: false });
    const text = answer + ' 完整尾部';
    vi.mocked(deferredContentReader.read).mockResolvedValue({
      content: {
        text,
        offset: 0,
        utf16Length: text.length,
        utf8Bytes: text.length * 3,
        version: 'a'.repeat(64),
        format: 'text',
      },
    });
    renderChat();
    await screen.findByText(text);
    fireEvent.click(
      within(screen.getByTestId('streaming-response')).getByRole('button', { name: '复制' }),
    );
    await waitFor(() => expect(copy).toHaveBeenCalledWith(text));
  });
  it('keeps failed copy actionable and reports success only after the clipboard succeeds', async () => {
    copy.mockRejectedValueOnce(new Error('clipboard failed'));
    renderChat();
    await screen.findByText(answer);
    const response = within(screen.getByTestId('streaming-response'));
    fireEvent.click(response.getByRole('button', { name: '复制' }));
    await waitFor(() => expect(response.getByRole('alert').textContent).toContain('复制失败'));
    expect(response.queryByRole('button', { name: '已复制' })).toBeNull();
    fireEvent.click(response.getByRole('button', { name: '重试复制' }));
    await response.findByRole('button', { name: '已复制' });
    expect(copy).toHaveBeenCalledTimes(2);
  });
});

 it('keeps workspace execution compact during real reasoning frames and exposes the actual trace on demand', async () => {
    let deliver!: (event: ConversationTransientSubscriptionEvent) => void;
    runtime.listConversationMessages.mockResolvedValue({ messages: [], hasMore: false });
    runtime.subscribeConversationTransientStream.mockImplementation((_payload, listener) => { deliver = listener; return { ready: Promise.resolve({ subscriptionId: 'workspace-live' }), unsubscribe: vi.fn(async () => undefined) }; });
    renderChat(true);
    await waitFor(() => expect(deliver).toBeTypeOf('function'));
    act(() => deliver({ type: 'frame', frame: { threadId: 'thread-response', runId: 'run-workspace', streamSequence: 1, occurredAt: '2026-09-28T00:00:00Z', kind: 'reasoning', textDelta: '真实思考片段' } } as ConversationTransientSubscriptionEvent));
    await screen.findByText('思考中…');
    expect(screen.queryByText('执行过程')).toBeNull();
    expect(screen.queryByText('Think')).toBeNull();
    expect(screen.getByTestId('agent-execution-status').closest('.shell-msg')?.getAttribute('data-aw-waiting')).toBe('true');
    fireEvent.click(within(screen.getByTestId('agent-execution-status')).getByRole('button'));
    expect(screen.getByText('执行过程')).toBeTruthy();
    expect(screen.getByTestId('process-panel')).toBeTruthy();
  });

 it.each([false, true])('shows edit summaries only outside the agent workspace (agentWorkspace=%s)', async (agentWorkspace) => {
    runtime.getConversationRunProcess.mockResolvedValue({ process: { runId: 'run-response', steps: [], fileChanges: [{ path: 'visualizations/longguo-command-center.html', action: 'edited' }], running: false, doneCount: 0, errorCount: 0 } });
    renderChat(agentWorkspace);
    await screen.findByText(answer);
    await waitFor(() => expect(runtime.getConversationRunProcess).toHaveBeenCalled());
    if (agentWorkspace) expect(screen.queryByText(/编辑了 1 个文件/)).toBeNull();
    else expect(await screen.findByText(/编辑了 1 个文件/)).toBeTruthy();
  });

it.each(['agent', 'team'] as const)('also hides file summaries in non-workspace %s chats', async track => {
  runtime.getConversationRunProcess.mockResolvedValue({ process: { runId: 'run-response', steps: [], fileChanges: [{ path: 'edited.html', action: 'edited' }], running: false, doneCount: 0, errorCount: 0 } });
  renderChat(false, track); await screen.findByText(answer);
  await waitFor(() => expect(runtime.getConversationRunProcess).toHaveBeenCalled());
  expect(screen.queryByText(/编辑了 1 个文件/)).toBeNull();
});
