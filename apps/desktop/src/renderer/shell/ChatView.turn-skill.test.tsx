/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Conversation, GlobalAgent, Team } from '@sync-think/shared';
import { ChatView } from './ChatView.js';

const runtime = {
  appendMessage: vi.fn(),
  getSkill: vi.fn(),
  listConversationMessages: vi.fn(),
  listSkills: vi.fn(),
  rebindConversationTarget: vi.fn(),
  sendConversationMessage: vi.fn(),
};

function conversation(id: string, targetRef = 'agent-a'): Conversation {
  return {
    id,
    track: 'agent',
    targetRef,
    title: 'Skill test',
    executionMode: 'full-access',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  } as Conversation;
}

const agents = [
  { id: 'agent-a', name: 'Agent A', skillIds: ['skill-a', 'skill-b'] },
  { id: 'agent-b', name: 'Agent B', skillIds: [] },
] as unknown as GlobalAgent[];

const skillCatalog = {
  skills: [
    {
      skillVersionId: 'skill-a',
      skillId: 'family-a',
      name: 'review',
      description: 'Review this turn',
      version: '1.0.0',
      allowedTools: [],
      contentFingerprint: 'fingerprint-a',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-07-29T00:00:00.000Z',
    },
    {
      skillVersionId: 'skill-b',
      skillId: 'family-b',
      name: 'research',
      description: 'Research the next turn',
      version: '2.0.0',
      allowedTools: [],
      contentFingerprint: 'fingerprint-b',
      hasScripts: false,
      warnings: [],
      createdAt: '2026-07-29T00:00:01.000Z',
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function renderChat(
  current: Conversation,
  models = [{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }],
  initialSkillVersionIds?: readonly string[],
) {
  return render(
    <ChatView
      conversation={current}
      modelName="Model A"
      models={models}
      agents={agents}
      teams={[]}
      eventHistory={[]}
      onTitleUpdated={vi.fn()}
      onConversationUpdated={vi.fn()}
      initialSkillVersionIds={initialSkillVersionIds}
    />,
  );
}

async function toggleSkill(skillVersionId: string, expectedCount: number) {
  fireEvent.click(screen.getByTestId('turn-skill-trigger'));
  fireEvent.click(await screen.findByTestId(`turn-skill-option-${skillVersionId}`));
  expect(screen.getByTestId('turn-skill-trigger').textContent).toContain(`${expectedCount}/8`);
}

async function waitForInitialMessages() {
  await waitFor(() => expect(runtime.listConversationMessages).toHaveBeenCalledTimes(1));
  await act(async () => Promise.resolve());
}

beforeEach(() => {
  runtime.appendMessage.mockReset().mockResolvedValue({ messageId: 'message-a', taskVersion: 1 });
  runtime.getSkill.mockReset();
  runtime.listConversationMessages.mockReset().mockResolvedValue({
    messages: [],
    hasMore: false,
  });
  runtime.listSkills.mockReset().mockResolvedValue(skillCatalog);
  runtime.rebindConversationTarget.mockReset().mockResolvedValue({ conversation: {} });
  runtime.sendConversationMessage.mockReset().mockResolvedValue({
    threadId: 'thread-a',
    taskVersion: 0,
    conversationTitle: 'Skill test',
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

describe('ChatView turn Skill draft', () => {
  it('defaults to all configured Agent Skills and keeps them after append succeeds', async () => {
    renderChat(conversation('conversation-a'));
    await waitForInitialMessages();
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('2/8');
    expect(runtime.listSkills).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review this' } });
    fireEvent.click(screen.getByTestId('compose-send'));

    await waitFor(() =>
      expect(runtime.appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ skillVersionIds: ['skill-a', 'skill-b'], text: 'Review this' }),
      ),
    );
    expect(runtime.sendConversationMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-a',
      text: 'Review this',
    });
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('2/8');
    expect(runtime.getSkill).not.toHaveBeenCalled();
  });

  it('retains the selection when append fails so the user can retry', async () => {
    runtime.appendMessage.mockRejectedValueOnce(new Error('append failed'));
    renderChat(conversation('conversation-a'));
    await waitForInitialMessages();
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('2/8');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Retry this' } });
    fireEvent.click(screen.getByTestId('compose-send'));

    expect(await screen.findByText('发送失败: append failed')).toBeTruthy();
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('2/8');
  });

  it('keeps a temporary adjustment made while an append is pending', async () => {
    const pending = deferred<{ messageId: string; taskVersion: number }>();
    runtime.appendMessage.mockReturnValueOnce(pending.promise);
    renderChat(conversation('conversation-a'));
    await toggleSkill('skill-b', 1);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review this' } });
    fireEvent.click(screen.getByTestId('compose-send'));
    await waitFor(() => expect(runtime.appendMessage).toHaveBeenCalledTimes(1));
    expect(runtime.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ skillVersionIds: ['skill-a'] }),
    );

    await toggleSkill('skill-b', 2);

    await act(async () => {
      pending.resolve({ messageId: 'message-a', taskVersion: 1 });
      await pending.promise;
    });
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('2/8');
  });

  it('resets to the new effective owner defaults when the conversation or identity changes', async () => {
    const view = renderChat(conversation('conversation-a'));
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('2/8');

    fireEvent.click(screen.getByTestId('compose-identity'));
    fireEvent.click(await screen.findByTestId('identity-option-agent-agent-b'));
    await waitFor(() => expect(runtime.rebindConversationTarget).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('0/8');

    view.rerender(
      <ChatView
        conversation={conversation('conversation-b')}
        modelName="Model A"
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
        agents={agents}
        teams={[]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
        onConversationUpdated={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('2/8'),
    );
  });

  it('resets a Team selection when the coordinator changes with the same Skill IDs', async () => {
    const sharedAgents = [
      { id: 'agent-a', name: 'Agent A', skillIds: ['skill-a', 'skill-b'] },
      { id: 'agent-b', name: 'Agent B', skillIds: ['skill-a', 'skill-b'] },
    ] as unknown as GlobalAgent[];
    const current = {
      ...conversation('conversation-team', 'team-a'),
      track: 'team',
    } as Conversation;
    const team = {
      id: 'team-a',
      coordinatorAgentId: 'agent-a',
      members: [{ agentId: 'agent-a' }, { agentId: 'agent-b' }],
    } as unknown as Team;
    const view = render(
      <ChatView
        conversation={current}
        modelName="Model A"
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
        agents={sharedAgents}
        teams={[team]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
        onConversationUpdated={vi.fn()}
      />,
    );
    await toggleSkill('skill-b', 1);

    view.rerender(
      <ChatView
        conversation={current}
        modelName="Model A"
        models={[{ modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' }]}
        agents={sharedAgents}
        teams={[{ ...team, coordinatorAgentId: sharedAgents[1]!.id }]}
        eventHistory={[]}
        onTitleUpdated={vi.fn()}
        onConversationUpdated={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('2/8'),
    );
  });

  it('keeps Agent Skills when only the model override changes', async () => {
    renderChat(conversation('conversation-a'), [
      { modelId: 'model-a', displayName: 'Model A', providerName: 'Provider' },
      { modelId: 'model-b', displayName: 'Model B', providerName: 'Provider' },
    ]);
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('2/8');

    fireEvent.click(screen.getByTitle('切换模型'));
    const provider = await screen.findByTestId('model-provider-Provider');
    provider.focus();
    fireEvent.keyDown(provider, { key: 'ArrowLeft' });
    fireEvent.click(await screen.findByText('Model B'));

    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('2/8'),
    );
  });

  it('regenerates with an explicit empty selection without clearing the compose draft', async () => {
    runtime.listConversationMessages.mockResolvedValue({
      messages: [
        {
          id: 'user-old',
          threadId: 'thread-a',
          role: 'user',
          blocks: [{ type: 'text', text: 'Original prompt' }],
          createdAt: '2026-07-29T00:00:00.000Z',
          sequence: 1,
        },
        {
          id: 'assistant-old',
          threadId: 'thread-a',
          role: 'assistant',
          blocks: [{ type: 'text', text: 'Original answer' }],
          createdAt: '2026-07-29T00:00:01.000Z',
          sequence: 2,
        },
      ],
      hasMore: false,
    });
    renderChat(conversation('conversation-a'));
    await screen.findByText('Original answer');
    await toggleSkill('skill-b', 1);

    fireEvent.click(screen.getByTitle('重新生成'));
    await waitFor(() =>
      expect(runtime.appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ skillVersionIds: [], text: 'Original prompt' }),
      ),
    );
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('1/8');
  });

  it('uses and keeps a welcome-page override when the new conversation mounts', async () => {
    renderChat(conversation('conversation-a'), undefined, ['skill-b']);
    await waitForInitialMessages();
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('1/8');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Continue this' } });
    fireEvent.click(screen.getByTestId('compose-send'));

    await waitFor(() =>
      expect(runtime.appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ skillVersionIds: ['skill-b'], text: 'Continue this' }),
      ),
    );
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('1/8');
  });
});
