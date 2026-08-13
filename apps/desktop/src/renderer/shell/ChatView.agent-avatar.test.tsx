/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { Conversation, Event, GlobalAgent, Message } from '@sync-think/shared';
import { ChatView } from './ChatView.js';

const runtime = {
  listConversationMessages: vi.fn(),
  openTask: vi.fn(),
};

const conversation = {
  id: 'conversation-agent-avatar',
  workspaceId: 'workspace-agent-avatar',
  taskId: 'task-agent-avatar',
  track: 'agent',
  targetRef: 'agent-frontend',
  title: 'Agent avatar',
  executionMode: 'full-access',
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
} as unknown as Conversation;

const persistedAssistantMessage = {
  id: 'assistant-agent-avatar',
  threadId: 'thread-agent-avatar',
  role: 'assistant',
  runId: 'run-agent-avatar',
  sequence: 1,
  createdAt: '2026-08-13T00:00:01.000Z',
  blocks: [{ type: 'text', text: '头像应该与智能体保持一致' }],
} as unknown as Message;

function agent(
  avatar: string,
  overrides: Partial<Pick<GlobalAgent, 'id' | 'name'>> = {},
): GlobalAgent {
  return {
    id: 'agent-frontend',
    name: '前端工程师',
    avatar,
    description: '负责前端实现',
    persona: '前端工程师',
    defaultModelId: 'model-a',
    fallbackModelIds: [],
    skillIds: [],
    mcpServerIds: [],
    reasoningEffort: 'auto',
    archived: false,
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  } as unknown as GlobalAgent;
}

function chat(
  agentRecords: readonly GlobalAgent[],
  currentConversation: Conversation = conversation,
  eventHistory: readonly Event[] = [],
) {
  return (
    <ChatView
      conversation={currentConversation}
      modelName="Model A"
      models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
      agents={agentRecords}
      teams={[]}
      eventHistory={eventHistory}
      onTitleUpdated={vi.fn()}
    />
  );
}

beforeEach(() => {
  runtime.openTask.mockReset().mockResolvedValue({ task: { threadId: 'thread-agent-avatar' } });
  runtime.listConversationMessages.mockReset().mockResolvedValue({
    messages: [persistedAssistantMessage],
    hasMore: false,
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

describe('ChatView agent avatar projection', () => {
  it('uses the live conversation agent avatar for persisted replies and the compose identity', async () => {
    const avatar = 'data:image/png;base64,frontend-avatar-v1';
    render(chat([agent(avatar)]));

    const answer = await screen.findByText('头像应该与智能体保持一致');
    const messageRow = answer.closest('[data-message-id]');
    expect(messageRow).toBeTruthy();
    expect(
      within(messageRow as HTMLElement)
        .getByRole('img', { name: '前端工程师' })
        .getAttribute('src'),
    ).toBe(avatar);
    expect(within(messageRow as HTMLElement).queryByText('前端工程师')).toBeNull();

    expect(
      within(screen.getByTestId('compose-identity'))
        .getByRole('img', { name: '前端工程师' })
        .getAttribute('src'),
    ).toBe(avatar);
  });

  it('refreshes existing conversation avatars after the agent avatar changes', async () => {
    const view = render(chat([agent('data:image/png;base64,frontend-avatar-v1')]));
    await screen.findByText('头像应该与智能体保持一致');

    const nextAvatar = 'data:image/png;base64,frontend-avatar-v2';
    view.rerender(chat([agent(nextAvatar)]));

    await waitFor(() => {
      const messageRow = screen.getByText('头像应该与智能体保持一致').closest('[data-message-id]');
      expect(
        within(messageRow as HTMLElement)
          .getByRole('img', { name: '前端工程师' })
          .getAttribute('src'),
      ).toBe(nextAvatar);
    });
  });

  it('keeps the Run agent identity when the conversation is later rebound', async () => {
    const current = agent('data:image/png;base64,current-agent');
    const original = agent('data:image/png;base64,original-agent', {
      id: 'agent-original' as GlobalAgent['id'],
      name: '原智能体',
    });
    const runStarted = {
      id: 'event-run-started',
      workspaceId: 'workspace-agent-avatar',
      taskId: 'task-agent-avatar',
      runId: 'run-agent-avatar',
      category: 'run',
      type: 'run.started',
      sequence: 1,
      occurredAt: '2026-08-13T00:00:00.500Z',
      payload: {
        threadId: 'thread-agent-avatar',
        globalAgentId: 'agent-original',
        globalAgentName: '原智能体',
      },
    } as unknown as Event;

    render(chat([current, original], conversation, [runStarted]));

    const messageRow = (await screen.findByText('头像应该与智能体保持一致')).closest(
      '[data-message-id]',
    );
    expect(
      within(messageRow as HTMLElement)
        .getByRole('img', { name: '原智能体' })
        .getAttribute('src'),
    ).toBe('data:image/png;base64,original-agent');
  });

  it('keeps the default assistant icon for model conversations', async () => {
    const modelConversation = {
      ...conversation,
      track: 'model',
      targetRef: 'model-a',
    } as unknown as Conversation;

    render(chat([agent('data:image/png;base64,frontend-avatar')], modelConversation));

    const messageRow = (await screen.findByText('头像应该与智能体保持一致')).closest(
      '[data-message-id]',
    );
    expect(within(messageRow as HTMLElement).queryByRole('img')).toBeNull();
    expect(messageRow?.querySelector('.shell-ai-avatar .lucide-bot')).toBeTruthy();
  });
});
