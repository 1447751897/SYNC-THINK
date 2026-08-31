/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Conversation } from '@sync-think/shared';
import { ChatView } from './ChatView.js';

const runtime = {
  appendMessage: vi.fn(),
  detectKernels: vi.fn(),
  getConversationContextStatus: vi.fn(),
  installKernel: vi.fn(),
  listConversationMessages: vi.fn(),
  openTask: vi.fn(),
  sendConversationMessage: vi.fn(),
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
      contextWindow: { nativeLimit: 200_000, overridable: false },
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
    installCommand: 'npm i -g pi',
  },
];

const installedKernels = kernels.map((kernel) =>
  kernel.kernelId === 'pi'
    ? { ...kernel, installed: true, version: '1.2.3', executablePath: 'C:/pi', knownGood: true }
    : kernel,
);

beforeEach(() => {
  window.localStorage.clear();
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
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
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

  it('refreshes the context window for the selected kernel', async () => {
    runtime.getConversationContextStatus.mockImplementation(
      async ({ kernelId }: { kernelId?: string }) => ({
        modelId: 'model-a',
        contextWindow: kernelId === 'claude-code' ? 200_000 : 400_000,
        modelContextWindow: 400_000,
        contextWindowSource: kernelId === 'claude-code' ? 'kernel-limit' : 'model-default',
        ...(kernelId === 'claude-code' ? { kernelContextWindowLimit: 200_000 } : {}),
        estimatedUsedTokens: 12_000,
        usageRatio: kernelId === 'claude-code' ? 0.06 : 0.03,
        compactThreshold: 0.7,
        sections: [
          { type: 'system', tokens: 0 },
          { type: 'agent', tokens: 0 },
          { type: 'project', tokens: 0 },
          { type: 'summary', tokens: 0 },
          { type: 'messages', tokens: 12_000 },
          { type: 'tools', tokens: 0 },
        ],
      }),
    );

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

    expect(screen.getByTestId('context-kernel-label').textContent).toBe('ClaudeCode');
    expect(screen.getByTestId('context-limit-kernel-capped').textContent).toContain('受内核限制');
    expect(screen.getByTestId('context-model-default').textContent).toContain('400k');
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

  it('keeps the Claude Code ring capped when an older status reports the model window', async () => {
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

    expect(screen.getByTestId('context-ring').getAttribute('aria-label')).toContain('/ 200k');
    fireEvent.click(screen.getByTestId('context-ring'));
    expect(screen.getByTestId('context-limit-kernel-capped').textContent).toContain('受内核限制');
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

  it('installs Pi, re-detects it, and only then allows selection', async () => {
    runtime.installKernel.mockResolvedValue({ ok: true });
    runtime.detectKernels
      .mockResolvedValueOnce({ kernels })
      .mockResolvedValueOnce({ kernels: installedKernels });
    renderChat();

    fireEvent.click(screen.getByTitle(/切换模型/));
    const piOption = await screen.findByTestId('kernel-option-pi');
    expect(piOption.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(piOption);

    await waitFor(() => expect(runtime.installKernel).toHaveBeenCalledWith('pi'));
    await waitFor(() => expect(runtime.detectKernels).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('kernel-option-pi').getAttribute('aria-label')).toContain(
        '安装成功 v1.2.3',
      ),
    );
    expect(screen.getByTestId('kernel-option-pi').hasAttribute('aria-disabled')).toBe(false);

    fireEvent.click(screen.getByTestId('kernel-option-pi'));
    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem('sync-think.conversationKernelOverrides') ?? '{}'),
      ).toEqual({ 'conversation-kernel': 'pi' }),
    );
  });

  it('shows the Pi install error and keeps the kernel unselected', async () => {
    runtime.installKernel.mockResolvedValue({ ok: false, error: '权限不足' });
    renderChat();

    fireEvent.click(screen.getByTitle(/切换模型/));
    fireEvent.click(await screen.findByTestId('kernel-option-pi'));

    await waitFor(() =>
      expect(screen.getByTestId('kernel-option-pi').textContent).toContain('安装失败 · 权限不足'),
    );
    expect(runtime.detectKernels).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('sync-think.conversationKernelOverrides')).toBeNull();
  });

  it('keeps one Pi install running when the menu closes or the item is clicked repeatedly', async () => {
    const install = deferred<{ ok: true }>();
    runtime.installKernel.mockReturnValue(install.promise);
    runtime.detectKernels
      .mockResolvedValueOnce({ kernels })
      .mockResolvedValueOnce({ kernels: installedKernels });
    renderChat();

    const modelTrigger = screen.getByTitle(/切换模型/);
    fireEvent.click(modelTrigger);
    const piOption = await screen.findByTestId('kernel-option-pi');
    fireEvent.click(piOption);
    fireEvent.click(piOption);
    await waitFor(() => expect(runtime.installKernel).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('kernel-option-pi').textContent).toContain('安装中');

    fireEvent.click(modelTrigger);
    await waitFor(() => expect(screen.queryByTestId('kernel-option-pi')).toBeNull());
    install.resolve({ ok: true });
    await waitFor(() => expect(runtime.detectKernels).toHaveBeenCalledTimes(2));

    fireEvent.click(modelTrigger);
    await waitFor(() =>
      expect(screen.getByTestId('kernel-option-pi').getAttribute('aria-label')).toContain(
        '安装成功 v1.2.3',
      ),
    );
    expect(runtime.installKernel).toHaveBeenCalledTimes(1);
  });
});
