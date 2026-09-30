/** @vitest-environment jsdom */
// Regression tests for persisted empty replies and stale collaboration titles.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Conversation, CollaborationSnapshot } from '@sync-think/shared';
import { ChatView } from './ChatView.js';
import { CollaborationChatView } from './CollaborationChatView.js';
const mock = vi.hoisted(() => ({
  snapshot: undefined as CollaborationSnapshot | undefined,
  command: vi.fn(),
}));
vi.mock('./use-collaboration-chat.js', () => ({
  useCollaborationChat: () => ({ snapshot: mock.snapshot, error: '', command: mock.command }),
  collaborationRequest: vi.fn(),
}));
const conversation = {
  id: 'audit-chat',
  workspaceId: 'audit-workspace',
  taskId: 'audit-task',
  track: 'agent',
  targetRef: 'audit-agent',
  title: '审查调研',
  executionMode: 'ask',
  createdAt: '2026-09-29T00:00:00Z',
  updatedAt: '2026-09-29T00:00:00Z',
} as Conversation;
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: {
      runtime: {
        openTask: vi.fn().mockResolvedValue({ task: { threadId: 'audit-thread' } }),
        listConversationMessages: vi
          .fn()
          .mockResolvedValue({
            messages: [
              {
                id: 'audit-msg',
                threadId: 'audit-thread',
                role: 'assistant',
                runId: 'audit-run',
                sequence: 1,
                createdAt: '2026-09-29T00:00:00Z',
                blocks: [
                  {
                    type: 'error',
                    payload: {
                      terminalState: 'paused',
                      errorMessage: 'AUDIT: model unavailable, no fallback',
                    },
                  },
                ],
              },
            ],
            hasMore: false,
          }),
        getConversationRunProcess: vi.fn().mockResolvedValue({ process: null }),
        detectKernels: vi.fn().mockResolvedValue({ kernels: [] }),
      },
    },
  });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});
it('empty paused ChatView must not retain an empty answer bubble', async () => {
  const { container } = render(
    <ChatView
      conversation={conversation}
      agentWorkspace
      modelName="Audit Model"
      models={[]}
      agents={[]}
      teams={[]}
      eventHistory={[]}
      onTitleUpdated={vi.fn()}
    />,
  );
  await screen.findByTestId('streaming-response');
  const body = container.querySelector('.shell-response__content');

  expect(body).toBeNull();
});
it('group header must display the same canonical renamed title as the conversation catalogue', () => {
  mock.snapshot = {
    conversation: {
      id: conversation.id,
      workspaceId: conversation.workspaceId!,
      kind: 'group',
      title: '代码审查员 + 技术调研员 + 测试设计员',
      coordinatorMemberId: 'agent:a',
      policy: {
        allowPeerDirect: false,
        maxConcurrent: 3,
        maxMessageHops: 6,
        maxAutoMessages: 12,
        taskTimeoutSeconds: 7200,
        statusTimeoutSeconds: 120,
      },
      createdAt: conversation.createdAt,
    },
    members: [
      { id: 'user:local', kind: 'user', name: '你', avatar: '', role: '用户', active: true },
      {
        id: 'agent:a',
        agentId: 'a',
        kind: 'agent',
        name: '代码审查员',
        avatar: '',
        role: '协调',
        active: true,
      },
    ],
    tasks: [],
    attempts: [],
    deliveries: [],
    messages: [],
    revision: 1,
    receipts: {},
  };
  const { container } = render(
    <CollaborationChatView
      workspace
      conversation={{ ...conversation, collaborationKind: 'group' }}
      agents={[]}
      onOpenConversation={vi.fn()}
    />,
  );

  expect(container.querySelector('header')?.textContent).toContain('审查调研');
});
