/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Conversation } from '@sync-think/shared';
import { ChatView } from './ChatView.js';
import { takeFailedComposeDrafts } from './failed-compose-drafts.js';

let kernelUpdateListener: ((snapshot: unknown) => void) | null = null;

const runtime = {
  appendMessage: vi.fn(),
  detectKernels: vi.fn(),
  getConversationContextStatus: vi.fn(),
  installKernel: vi.fn(),
  listConversationMessages: vi.fn(),
  readConversationContent: vi.fn(),
  openTask: vi.fn(),
  sendConversationMessage: vi.fn(),
  subscribeConversationTransientStream: vi.fn(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function conversation(id = 'conversation-kernel'): Conversation {
  return {
    id,
    workspaceId: 'workspace-kernel',
    taskId: `task-${id}`,
    track: 'model',
    targetRef: 'model-a',
    title: 'Kernel test',
    executionMode: 'full-access',
    createdAt: '2026-08-09T10:00:00.000Z',
    updatedAt: '2026-08-09T10:00:00.000Z',
  } as unknown as Conversation;
}

const kernels = [
  {
    kernelId: 'native',
    name: '原生内核',
    icon: 'native',
    capabilities: {
      permission: 'own' as const,
      permissionBridge: false,
      pause: 'executor' as const,
      compress: 'own' as const,
      usageReport: true,
      protocols: [],
    },
    installed: true,
    version: null,
    executablePath: null,
    knownGood: true,
  },
  {
    kernelId: 'claude-code',
    name: 'Claude Code',
    icon: 'claude-code',
    capabilities: {
      permission: 'own' as const,
      permissionBridge: true,
      pause: 'turn' as const,
      compress: 'own' as const,
      usageReport: true,
      protocols: ['anthropic-messages' as const],
      contextWindow: { nativeLimit: 1_000_000, overridable: true },
    },
    installed: true,
    version: '2.1.222',
    executablePath: 'C:/claude',
    knownGood: true,
  },
  {
    kernelId: 'codex',
    name: 'Codex',
    icon: 'codex',
    capabilities: {
      permission: 'own' as const,
      permissionBridge: false,
      pause: 'session' as const,
      compress: 'own' as const,
      usageReport: true,
      protocols: ['openai-chat' as const],
    },
    installed: true,
    version: '0.145.0',
    executablePath: 'C:/codex',
    knownGood: true,
  },
  {
    kernelId: 'pi',
    name: 'Pi',
    icon: 'pi',
    capabilities: {
      permission: 'none' as const,
      permissionBridge: false,
      pause: 'kill' as const,
      compress: 'own' as const,
      usageReport: false,
      protocols: [],
    },
    installed: false,
    version: null,
    executablePath: null,
    knownGood: false,
    installCommand: '应用私有目录',
  },
];

const installedKernels = kernels.map((kernel) =>
  kernel.kernelId === 'pi'
    ? { ...kernel, installed: true, version: '1.2.3', executablePath: 'C:/pi', knownGood: true }
    : kernel,
);

beforeEach(() => {
  takeFailedComposeDrafts(JSON.stringify(['workspace-kernel', 'conversation-kernel']));
  takeFailedComposeDrafts(JSON.stringify(['workspace-kernel', 'another-conversation']));
  window.localStorage.clear();
  kernelUpdateListener = null;
  runtime.readConversationContent.mockReset();
  runtime.openTask.mockReset().mockResolvedValue({ task: { threadId: 'thread-kernel' } });
  runtime.listConversationMessages.mockReset().mockResolvedValue({ messages: [], hasMore: false });
  runtime.sendConversationMessage.mockReset().mockResolvedValue({
    threadId: 'thread-kernel',
    taskVersion: 1,
  });
  runtime.appendMessage.mockReset().mockResolvedValue({
    messageId: 'msg-kernel-1',
    taskVersion: 1,
  });
  runtime.getConversationContextStatus.mockReset().mockResolvedValue({
    modelId: 'model-a',
    contextWindow: 400_000,
    modelContextWindow: 400_000,
    contextWindowSource: 'model-default',
    estimatedUsedTokens: 0,
    usageRatio: 0,
    compactThreshold: 0.7,
    sections: [
      { type: 'system', tokens: 0 },
      { type: 'agent', tokens: 0 },
      { type: 'project', tokens: 0 },
      { type: 'summary', tokens: 0 },
      { type: 'messages', tokens: 0 },
      { type: 'tools', tokens: 0 },
    ],
  });
  runtime.installKernel.mockReset();
  runtime.detectKernels.mockReset().mockResolvedValue({ kernels });
  runtime.subscribeConversationTransientStream.mockReset().mockReturnValue({
    ready: Promise.resolve({ subscriptionId: 'sub-kernel' }),
    unsubscribe: vi.fn(async () => undefined),
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: {
      runtime,
      kernelUpdates: {
        getState: vi.fn(async () => undefined),
        checkForUpdates: vi.fn(),
        installUpdate: vi.fn(),
        subscribeState: vi.fn((listener: (snapshot: unknown) => void) => {
          kernelUpdateListener = listener;
          return () => {
            kernelUpdateListener = null;
          };
        }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

function renderChat(current = conversation()) {
  return render(
    <ChatView
      conversation={current}
      modelName="Model A"
      models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
      eventHistory={[]}
      onTitleUpdated={vi.fn()}
    />,
  );
}

async function sendMessage(text: string) {
  fireEvent.change(screen.getByTestId('compose-input'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('compose-send'));
  await waitFor(() => expect(runtime.appendMessage).toHaveBeenCalled());
}

describe('ChatView kernel selection', () => {
  it('repairs a persisted model override that is no longer in the available catalog', async () => {
    window.localStorage.setItem(
      'sync-think.conversationModelOverrides',
      JSON.stringify({ 'conversation-kernel': 'disabled-grok' }),
    );
    renderChat();

    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem('sync-think.conversationModelOverrides') ?? '{}'),
      ).toEqual({ 'conversation-kernel': 'model-a' }),
    );
    expect(await screen.findByText('原模型已停用或删除，已切换到 Model A')).toBeTruthy();

    await sendMessage('use repaired model');
    expect(runtime.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'model-a' }),
    );
  });

  it('sends the persisted per-conversation kernel with appendMessage', async () => {
    window.localStorage.setItem(
      'sync-think.conversationKernelOverrides',
      JSON.stringify({ 'conversation-kernel': 'codex' }),
    );
    renderChat();
    await sendMessage('hello kernel');
    expect(runtime.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kernelId: 'codex' }),
    );
    // Non-native kernel renders a chip.
    expect((await screen.findByTestId('compose-kernel-chip')).getAttribute('aria-label')).toBe(
      '内核：GPT',
    );
  });

  it('defaults to native when no override exists', async () => {
    renderChat();
    await sendMessage('hello native');
    expect(runtime.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kernelId: 'native' }),
    );
    expect(screen.queryByTestId('compose-kernel-chip')).toBeNull();
  });

  it('persists a kernel picked in the model menu and re-sends it', async () => {
    renderChat();
    fireEvent.click(screen.getByTitle(/切换模型/));
    const ccOption = await screen.findByTestId('kernel-option-claude-code');
    fireEvent.click(ccOption);

    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem('sync-think.conversationKernelOverrides') ?? '{}'),
      ).toEqual({ 'conversation-kernel': 'claude-code' }),
    );

    await sendMessage('via claude');
    expect(runtime.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kernelId: 'claude-code' }),
    );
  });

  it('refreshes kernel versions in the picker after a private update', async () => {
    const updated = kernels.map((kernel) =>
      kernel.kernelId === 'codex' ? { ...kernel, version: '0.151.0' } : kernel,
    );
    runtime.detectKernels
      .mockResolvedValueOnce({ kernels })
      .mockResolvedValueOnce({ kernels: updated });
    renderChat();
    await waitFor(() => expect(runtime.detectKernels).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTitle(/切换模型/));
    expect((await screen.findByTestId('kernel-version-codex')).textContent).toBe('v0.145.0');

    await act(async () => {
      kernelUpdateListener?.({
        schemaVersion: 1,
        installerAvailable: true,
        checkedAt: '2026-08-31T00:00:00.000Z',
        items: [
          {
            kernelId: 'codex',
            name: 'Codex',
            packageName: '@openai/codex',
            managedVersion: '0.151.0',
            latestVersion: '0.151.0',
            phase: 'installed',
            errorCode: null,
          },
        ],
      });
    });

    await waitFor(() => expect(runtime.detectKernels).toHaveBeenCalledTimes(2));
    expect((await screen.findByTestId('kernel-version-codex')).textContent).toBe('v0.151.0');
  });

  it('refreshes the context window for the selected kernel', async () => {
    runtime.getConversationContextStatus.mockImplementation(async () => ({
      modelId: 'model-a',
      contextWindow: 400_000,
      modelContextWindow: 400_000,
      contextWindowSource: 'model-default',
      estimatedUsedTokens: 12_000,
      usageRatio: 0.03,
      compactThreshold: 0.7,
      sections: [
        { type: 'system', tokens: 0 },
        { type: 'agent', tokens: 0 },
        { type: 'project', tokens: 0 },
        { type: 'summary', tokens: 0 },
        { type: 'messages', tokens: 12_000 },
        { type: 'tools', tokens: 0 },
      ],
    }));

    renderChat();
    await waitFor(() => expect(runtime.getConversationContextStatus).toHaveBeenCalled());

    fireEvent.click(screen.getByTitle(/切换模型/));
    fireEvent.click(await screen.findByTestId('kernel-option-claude-code'));

    await waitFor(() =>
      expect(runtime.getConversationContextStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ conversationId: 'conversation-kernel', kernelId: 'claude-code' }),
      ),
    );
    fireEvent.click(screen.getByTestId('context-ring'));

    expect(screen.getByTestId('context-kernel-label').getAttribute('title')).toBe(
      '当前内核：ClaudeCode',
    );
    expect(
      screen.getByTestId('context-kernel-label').querySelector('[role="img"], img'),
    ).toBeTruthy();
    expect(screen.queryByTestId('context-limit-kernel-capped')).toBeNull();
    expect(screen.getByTestId('context-model-default').textContent).toContain('400k');
    expect(screen.getByTestId('context-kernel-self-managed').textContent).toBe(
      '上下文压缩由 ClaudeCode 内核自行管理',
    );
    expect(screen.queryByText('自动压缩')).toBeNull();
    expect(screen.queryByText(/发送下一条消息前自动压缩/)).toBeNull();
  });

  it('switches GPT to kernel-owned compact immediately without a watermark', async () => {
    window.localStorage.setItem(
      'sync-think.conversationKernelOverrides',
      JSON.stringify({ 'conversation-kernel': 'codex' }),
    );
    renderChat();
    await waitFor(() => expect(runtime.getConversationContextStatus).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('context-ring'));
    expect(screen.getByTestId('context-kernel-label').getAttribute('title')).toBe('当前内核：GPT');
    expect(
      screen.getByTestId('context-kernel-label').querySelector('[role="img"], img'),
    ).toBeTruthy();
    expect(screen.getByTestId('context-kernel-self-managed').textContent).toBe(
      '上下文压缩由 GPT 内核自行管理',
    );
    expect(screen.queryByText('自动压缩')).toBeNull();
  });

  it('does not reload durable messages when only the kernel changes', async () => {
    renderChat();
    await waitFor(() => expect(runtime.listConversationMessages).toHaveBeenCalledTimes(1));
    runtime.listConversationMessages.mockClear();

    fireEvent.click(screen.getByTitle(/切换模型/));
    fireEvent.click(await screen.findByTestId('kernel-option-claude-code'));

    await waitFor(() =>
      expect(runtime.getConversationContextStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ kernelId: 'claude-code' }),
      ),
    );
    expect(runtime.listConversationMessages).not.toHaveBeenCalled();
  });

  it('does not tear down the live stream when only the kernel changes', async () => {
    const onConversationUpdated = vi.fn();
    render(
      <ChatView
        conversation={conversation()}
        modelName="Model A"
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
        onConversationUpdated={onConversationUpdated}
      />,
    );
    await waitFor(() =>
      expect(runtime.subscribeConversationTransientStream).toHaveBeenCalledTimes(1),
    );
    runtime.subscribeConversationTransientStream.mockClear();

    fireEvent.click(screen.getByTitle(/切换模型/));
    fireEvent.click(await screen.findByTestId('kernel-option-claude-code'));

    await waitFor(() =>
      expect(runtime.getConversationContextStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ kernelId: 'claude-code' }),
      ),
    );
    expect(runtime.subscribeConversationTransientStream).not.toHaveBeenCalled();
    expect(onConversationUpdated).not.toHaveBeenCalled();
  });

  it('follows the model window for Claude Code instead of a 200k host cap', async () => {
    runtime.getConversationContextStatus.mockResolvedValue({
      modelId: 'model-a',
      contextWindow: 400_000,
      modelContextWindow: 400_000,
      contextWindowSource: 'model-default',
      estimatedUsedTokens: 12_000,
      usageRatio: 0.03,
      compactThreshold: 0.7,
      sections: [
        { type: 'system', tokens: 0 },
        { type: 'agent', tokens: 0 },
        { type: 'project', tokens: 0 },
        { type: 'summary', tokens: 0 },
        { type: 'messages', tokens: 12_000 },
        { type: 'tools', tokens: 0 },
      ],
    });

    renderChat();
    await waitFor(() => expect(runtime.getConversationContextStatus).toHaveBeenCalled());

    fireEvent.click(screen.getByTitle(/切换模型/));
    fireEvent.click(await screen.findByTestId('kernel-option-claude-code'));
    await waitFor(() =>
      expect(runtime.getConversationContextStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ kernelId: 'claude-code' }),
      ),
    );

    expect(screen.getByTestId('context-ring').getAttribute('aria-label')).toContain('/ 400k');
    fireEvent.click(screen.getByTestId('context-ring'));
    expect(screen.queryByTestId('context-limit-kernel-capped')).toBeNull();
  });

  it('does not reload the latest messages when task thread resolution completes', async () => {
    const taskA = deferred<{ task: { threadId: string } }>();
    const taskB = deferred<{ task: { threadId: string } }>();
    runtime.openTask.mockImplementation(({ taskId }: { taskId: string }) =>
      taskId === 'task-conversation-kernel-b' ? taskB.promise : taskA.promise,
    );

    const view = renderChat();
    await waitFor(() => expect(runtime.listConversationMessages).toHaveBeenCalledTimes(1));
    runtime.listConversationMessages.mockClear();

    view.rerender(
      <ChatView
        conversation={conversation('conversation-kernel-b')}
        modelName="Model A"
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );

    await waitFor(() => expect(runtime.listConversationMessages).toHaveBeenCalledTimes(1));
    expect(runtime.listConversationMessages).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conversation-kernel-b' }),
    );

    await act(async () => {
      taskB.resolve({ task: { threadId: 'thread-conversation-kernel-b' } });
      await taskB.promise;
    });
    expect(runtime.listConversationMessages).toHaveBeenCalledTimes(1);
  });

  it('does not offer Pi installation from the kernel picker', async () => {
    renderChat();

    fireEvent.click(screen.getByTitle(/切换模型/));
    const piOption = await screen.findByTestId('kernel-option-pi');
    expect(piOption.getAttribute('aria-disabled')).toBe('true');
    expect(piOption.getAttribute('aria-label')).toContain('未安装');
    fireEvent.click(piOption);
    expect(runtime.installKernel).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('sync-think.conversationKernelOverrides')).toBeNull();
  });
});

it('keeps a draft when a restored Pi selection has no execution adapter', async () => {
  window.localStorage.setItem(
    'sync-think.conversationKernelOverrides',
    JSON.stringify({ 'conversation-kernel': 'pi' }),
  );
  runtime.detectKernels.mockResolvedValue({ kernels: installedKernels });
  renderChat();
  fireEvent.change(screen.getByTestId('compose-input'), {
    target: { value: 'preserve my Pi draft' },
  });
  fireEvent.click(screen.getByTestId('compose-send'));
  expect(await screen.findByText(/Pi 执行尚未接通/)).toBeTruthy();
  expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe(
    'preserve my Pi draft',
  );
  expect(runtime.sendConversationMessage).not.toHaveBeenCalled();
  expect(runtime.appendMessage).not.toHaveBeenCalled();
});

function proseMessages() {
  return ['user', 'assistant'].map((role, index) => ({
    id: 'prose-' + role,
    threadId: 'thread-kernel',
    role,
    sequence: index + 1,
    createdAt: '2026-09-05T10:00:00.000Z',
    blocks: [
      {
        type: 'text',
        text: role === 'user' ? '提示预览' : '答案预览',
        contentRef: {
          reference: { source: 'message', id: 'prose-' + role, path: ['blocks', 0, 'text'] },
          utf16Length: 20000,
          utf8Bytes: 60000,
          format: 'text',
        },
      },
    ],
  }));
}
function proseChunk(text: string, offset: number, total: number, nextOffset?: number) {
  return {
    content: {
      text,
      offset,
      utf16Length: total,
      utf8Bytes: total * 3,
      format: 'text',
      version: 'a'.repeat(64),
      ...(nextOffset === undefined ? {} : { nextOffset }),
    },
  };
}

describe('ChatView complete prose actions', () => {
  it('does not fetch source automatically and copies every answer chunk, not the preview', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: proseMessages(),
      hasMore: false,
    });
    runtime.readConversationContent
      .mockResolvedValueOnce(proseChunk('完整回答🙂', 0, 8, 6))
      .mockResolvedValueOnce(proseChunk('结尾', 6, 8));
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderChat();
    await screen.findByText('答案预览');
    expect(runtime.readConversationContent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('完整回答🙂结尾'));
    expect(runtime.readConversationContent).toHaveBeenCalledTimes(2);
    expect(runtime.readConversationContent.mock.calls[1][0]).toMatchObject({
      conversationId: 'conversation-kernel',
      offset: 6,
      version: 'a'.repeat(64),
    });
  });
  it('regenerates using the complete original prompt instead of its bounded preview', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: proseMessages(),
      hasMore: false,
    });
    runtime.readConversationContent
      .mockResolvedValueOnce(proseChunk('完整提示🙂', 0, 8, 6))
      .mockResolvedValueOnce(proseChunk('结尾', 6, 8));
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }));
    await waitFor(() =>
      expect(runtime.appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: '完整提示🙂结尾' }),
      ),
    );
    expect(runtime.readConversationContent.mock.calls[0][0].reference.id).toBe('prose-user');
  });
  it('shows a copy error and retries without writing a partial answer', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: proseMessages(),
      hasMore: false,
    });
    runtime.readConversationContent
      .mockRejectedValueOnce(new Error('content.version-changed'))
      .mockResolvedValueOnce(proseChunk('完整回答', 0, 4));
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: '复制' }));
    await screen.findByText('读取或复制失败，请重试');
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('完整回答'));
  });
  it('does not resend the preview when original prompt reading fails', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: proseMessages(),
      hasMore: false,
    });
    runtime.readConversationContent.mockRejectedValueOnce(new Error('content.version-changed'));
    renderChat();
    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }));
    await screen.findByText(/读取原始提示失败，未重新发送/);
    expect(runtime.appendMessage).not.toHaveBeenCalled();
  });
  it('cancels an in-flight regeneration on conversation change and ignores a late private result', async () => {
    const pending = deferred<ReturnType<typeof proseChunk>>();
    runtime.listConversationMessages.mockResolvedValue({
      messages: proseMessages(),
      hasMore: false,
    });
    runtime.readConversationContent.mockReturnValueOnce(pending.promise);
    const rendered = renderChat();
    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }));
    await waitFor(() => expect(runtime.readConversationContent).toHaveBeenCalledTimes(1));
    runtime.listConversationMessages.mockResolvedValue({ messages: [], hasMore: false });
    rendered.rerender(
      <ChatView
        conversation={conversation('conversation-other')}
        modelName="Model A"
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );
    await act(async () => pending.resolve(proseChunk('旧会话原文', 0, 5)));
    expect(runtime.appendMessage).not.toHaveBeenCalled();
    expect(screen.queryByText('旧会话原文')).toBeNull();
  });
});

it('deduplicates full-text copy clicks and cancels clipboard writes after conversation change', async () => {
  const pending = deferred<ReturnType<typeof proseChunk>>();
  runtime.listConversationMessages.mockResolvedValue({ messages: proseMessages(), hasMore: false });
  runtime.readConversationContent.mockReturnValueOnce(pending.promise);
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const rendered = renderChat();
  const copy = await screen.findByRole('button', { name: '复制' });
  fireEvent.click(copy);
  fireEvent.click(copy);
  await waitFor(() => expect(runtime.readConversationContent).toHaveBeenCalledTimes(1));
  expect((copy as HTMLButtonElement).disabled).toBe(true);
  runtime.listConversationMessages.mockResolvedValue({ messages: [], hasMore: false });
  rendered.rerender(
    <ChatView
      conversation={conversation('conversation-other')}
      modelName="Model A"
      models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
      eventHistory={[]}
      onTitleUpdated={vi.fn()}
    />,
  );
  await act(async () => pending.resolve(proseChunk('旧会话原文', 0, 5)));
  expect(writeText).not.toHaveBeenCalled();
  expect(runtime.readConversationContent).toHaveBeenCalledTimes(1);
});

describe('failed compose draft recovery', () => {
  it('restores the original draft after the durable append is rejected', async () => {
    runtime.appendMessage.mockRejectedValueOnce(new Error('Message exceeds 262144 UTF-8 bytes'));
    renderChat();
    await sendMessage('original draft');
    await screen.findByText(/发送失败: Message exceeds/);
    expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe(
      'original draft',
    );
  });

  it('keeps a newer edit and offers the failed draft for recovery', async () => {
    let reject!: (error: Error) => void;
    runtime.appendMessage.mockReturnValueOnce(
      new Promise((_resolve, onReject) => {
        reject = onReject;
      }),
    );
    renderChat();
    await sendMessage('original draft');
    fireEvent.change(screen.getByTestId('compose-input'), { target: { value: 'newer draft' } });
    await act(async () => reject(new Error('storage write failed')));
    expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe('newer draft');
    fireEvent.click(screen.getByRole('button', { name: '恢复未发送草稿' }));
    expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe(
      'newer draft\n\noriginal draft',
    );
    expect(screen.queryByRole('button', { name: '恢复未发送草稿' })).toBeNull();
  });

  it('does not restore a failed prompt into another conversation', async () => {
    let reject!: (error: Error) => void;
    runtime.appendMessage.mockReturnValueOnce(
      new Promise((_resolve, onReject) => {
        reject = onReject;
      }),
    );
    const view = renderChat();
    await sendMessage('private original draft');
    view.rerender(
      <ChatView
        conversation={conversation('another-conversation')}
        modelName="Model A"
        models={[]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );
    await act(async () => reject(new Error('storage write failed')));
    expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).not.toContain(
      'private original draft',
    );
    expect(screen.queryByRole('button', { name: '恢复未发送草稿' })).toBeNull();
    view.rerender(
      <ChatView
        conversation={conversation()}
        modelName="Model A"
        models={[]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '恢复未发送草稿' }));
    expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe(
      'private original draft',
    );
  });
});

it.each([false, true])(
  'recovers a rejected draft after a keyed ChatView remount (return before rejection: %s)',
  async (returnBeforeRejection) => {
    let reject!: (error: Error) => void;
    runtime.appendMessage.mockReturnValueOnce(
      new Promise((_resolve, onReject) => {
        reject = onReject;
      }),
    );
    const original = renderChat();
    await sendMessage('draft owned by the original view');
    original.unmount();
    const other = renderChat(conversation('another-conversation'));
    if (returnBeforeRejection) other.unmount();
    const returned = returnBeforeRejection ? renderChat() : undefined;
    await act(async () => reject(new Error('fixture rejected append')));
    if (!returnBeforeRejection) {
      expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe('');
      expect(screen.queryByRole('button', { name: '恢复未发送草稿' })).toBeNull();
      other.unmount();
      renderChat();
    }
    fireEvent.click(await screen.findByRole('button', { name: '恢复未发送草稿' }));
    expect((screen.getByTestId('compose-input') as HTMLTextAreaElement).value).toBe(
      'draft owned by the original view',
    );
    expect(screen.queryByRole('button', { name: '恢复未发送草稿' })).toBeNull();
    returned?.unmount();
  },
);
