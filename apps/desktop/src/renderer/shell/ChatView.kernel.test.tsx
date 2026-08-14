/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Conversation } from '@sync-think/shared';
import { ChatView } from './ChatView.js';

const runtime = {
  appendMessage: vi.fn(),
  detectKernels: vi.fn(),
  listConversationMessages: vi.fn(),
  openTask: vi.fn(),
  sendConversationMessage: vi.fn(),
};

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
    capabilities: { permission: 'own' as const, permissionBridge: false, pause: 'executor' as const, compress: 'own' as const, usageReport: true, protocols: [] },
    installed: true,
    version: null,
    executablePath: null,
    knownGood: true,
  },
  {
    kernelId: 'claude-code',
    name: 'Claude Code',
    icon: 'claude-code',
    capabilities: { permission: 'own' as const, permissionBridge: true, pause: 'turn' as const, compress: 'own' as const, usageReport: true, protocols: ['anthropic-messages' as const] },
    installed: true,
    version: '2.1.222',
    executablePath: 'C:/claude',
    knownGood: true,
  },
  {
    kernelId: 'codex',
    name: 'Codex',
    icon: 'codex',
    capabilities: { permission: 'own' as const, permissionBridge: false, pause: 'session' as const, compress: 'own' as const, usageReport: true, protocols: ['openai-chat' as const] },
    installed: true,
    version: '0.145.0',
    executablePath: 'C:/codex',
    knownGood: true,
  },
];

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

function renderChat() {
  return render(
    <ChatView
      conversation={conversation()}
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
    expect(await screen.findByTestId('compose-kernel-chip')).toBeTruthy();
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
        JSON.parse(
          window.localStorage.getItem('sync-think.conversationKernelOverrides') ?? '{}',
        ),
      ).toEqual({ 'conversation-kernel': 'claude-code' }),
    );

    await sendMessage('via claude');
    expect(runtime.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kernelId: 'claude-code' }),
    );
  });
});
