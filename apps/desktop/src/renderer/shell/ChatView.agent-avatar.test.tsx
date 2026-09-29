/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Conversation, Event, GlobalAgent, Message } from '@sync-think/shared';
import { ChatView } from './ChatView.js';

const runtime = {
  rebindConversationTarget: vi.fn(),
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

describe('ChatView assistant identity projection', () => {
  it('keeps empty agent chats stable when the sidebar opens another conversation at a real viewport height', async () => {
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    runtime.listConversationMessages.mockResolvedValue({ messages: [], hasMore: false });
    const records = [
      agent('data:image/png;base64,first'),
      agent('data:image/png;base64,second', { id: 'agent-second' as GlobalAgent['id'], name: '代码探索员' }),
    ];
    try {
      const view = render(<div key="first">{chat(records)}</div>);
      await waitFor(() => expect(runtime.listConversationMessages).toHaveBeenCalled());
      expect(screen.getByTestId('compose-identity').textContent).toBe('前端工程师');
      view.rerender(<div key="second">{chat(records, {
        ...conversation,
        id: 'conversation-second' as Conversation['id'],
        targetRef: 'agent-second',
      })}</div>);
      await waitFor(() => expect(screen.getByTestId('compose-identity').textContent).toBe('代码探索员'));
      expect(screen.getByTestId('compose-input')).toBeTruthy();
    } finally {
      cleanup();
      height.mockRestore();
    }
  });

  it.each([
    ['bot:v1:clover:preset', 'clover'],
    ['gen:v1:hex:green', 'hexagon'],
  ])('renders %s consistently in the reply and composer', async (avatar, shape) => {
    render(chat([agent(avatar)]));
    const answer = await screen.findByText('头像应该与智能体保持一致');
    const messageRow = answer.closest('[data-message-id]');
    await waitFor(() => {
      expect(messageRow?.querySelector('canvas')?.getAttribute('data-bot-avatar')).toBe(shape);
      expect(
        screen
          .getByTestId('compose-identity')
          .querySelector('canvas')
          ?.getAttribute('data-bot-avatar'),
      ).toBe(shape);
    });
    expect(messageRow?.querySelector('[data-animated]')?.getAttribute('data-animated')).toBe(
      'false',
    );
  });

  it('renders the agent avatar beside each assistant reply while compose shows the live avatar', async () => {
    const avatar = 'data:image/png;base64,frontend-avatar-v1';
    render(chat([agent(avatar)]));

    const answer = await screen.findByText('头像应该与智能体保持一致');
    const messageRow = answer.closest('[data-message-id]');
    expect(messageRow).toBeTruthy();
    expect(within(messageRow as HTMLElement).getByRole('img', { name: '前端工程师' })).toBeTruthy();
    expect(messageRow?.querySelector('.shell-ai-avatar')).toBeNull();
    expect(within(messageRow as HTMLElement).getByText('前端工程师')).toBeTruthy();

    expect(
      within(screen.getByTestId('compose-identity'))
        .getByRole('img', { name: '前端工程师' })
        .getAttribute('src'),
    ).toBe(avatar);
  });

  it('refreshes the compose avatar after an agent change without changing reply avatars', async () => {
    const view = render(chat([agent('data:image/png;base64,frontend-avatar-v1')]));
    await screen.findByText('头像应该与智能体保持一致');

    const nextAvatar = 'data:image/png;base64,frontend-avatar-v2';
    view.rerender(chat([agent(nextAvatar)]));

    await waitFor(() => {
      expect(
        within(screen.getByTestId('compose-identity'))
          .getByRole('img', { name: '前端工程师' })
          .getAttribute('src'),
      ).toBe(nextAvatar);
    });
    const messageRow = screen.getByText('头像应该与智能体保持一致').closest('[data-message-id]');
    expect(within(messageRow as HTMLElement).getByRole('img', { name: '前端工程师' })).toBeTruthy();
    expect(messageRow?.querySelector('.shell-ai-avatar')).toBeNull();
  });

  it('uses the historical Run agent identity avatar beside the assistant reply', async () => {
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
    expect(within(messageRow as HTMLElement).getByRole('img', { name: '原智能体' })).toBeTruthy();
    expect(messageRow?.querySelector('.shell-ai-avatar')).toBeNull();
    expect(within(messageRow as HTMLElement).getByText('原智能体')).toBeTruthy();
  });

  it('keeps model-conversation assistant replies avatar-free', async () => {
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
    expect(messageRow?.querySelector('.shell-ai-avatar')).toBeNull();
  });
});


it.each(['model', 'agent', 'team'] as const)('shows a passive identity label in a %s conversation', async (track) => {
  runtime.rebindConversationTarget.mockClear();
  render(chat([agent('bot:v1:clover:preset')], { ...conversation, track }));
  const label = screen.getByTestId('compose-identity');
  expect(label.tagName).toBe('SPAN');
  expect(label.getAttribute('tabindex')).toBeNull();
  expect(label.getAttribute('aria-haspopup')).toBeNull();
  expect(label.getAttribute('aria-expanded')).toBeNull();
  fireEvent.click(label);
  fireEvent.keyDown(label, { key: 'Enter' });
  fireEvent.keyDown(label, { key: ' ' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(runtime.rebindConversationTarget).not.toHaveBeenCalled();
  await screen.findByText('头像应该与智能体保持一致');
});
