/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Event } from '@sync-think/shared';
import ConversationAttentionController, {
  type ConversationAttentionProjection,
} from './ConversationAttentionController.js';
const conversation = {
  id: 'a',
  taskId: 'task-a',
  title: '数据库迁移',
  workspaceId: 'ws-a',
} as Conversation;
function event(sequence: number, type: string, payload: Record<string, unknown> = {}): Event {
  return {
    id: `event-${sequence}` as Event['id'],
    sequence,
    type,
    category: 'system',
    taskId: 'task-a' as Event['taskId'],
    runId: 'run-a' as Event['runId'],
    workspaceId: 'ws-a' as Event['workspaceId'],
    occurredAt: new Date().toISOString(),
    payload: { threadId: 'thread-a', askId: 'ask-a', ...payload },
  };
}
function fixture(events: Event[]) {
  const portalHost = document.createElement('span');
  document.body.append(portalHost);
  const api = { onConversationNotice: vi.fn(() => vi.fn()) };
  const onProjection = vi.fn<(projection: ConversationAttentionProjection) => void>();
  const options = {
    api,
    conversations: [conversation],
    workspaces: [],
    events,
    connectionRevision: 0,
    lastSeen: {},
    visibleIds: new Set<string>(),
    titleFor: () => '模型',
    onOpenConversation: vi.fn(),
    onProjection,
    portalHost,
  };
  const tree = render(<ConversationAttentionController {...options} />);
  return {
    ...tree,
    api,
    portalHost,
    onProjection,
    update: (
      changes: Partial<typeof options> & {
        authority?: { throughSequence: number; activeRunIds: ReadonlySet<string> };
      },
    ) => tree.rerender(<ConversationAttentionController {...options} {...changes} />),
  };
}
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  localStorage.clear();
});
describe('persistent global attention coordinator', () => {
  it('retains questions as the header portal moves and streaming history is rotated', async () => {
    const view = fixture([event(1, 'run.started'), event(2, 'conversation.ask_pending')]);
    await screen.findByRole('button', { name: '待处理 · 1' });
    const secondHost = document.createElement('span');
    document.body.append(secondHost);
    view.update({ portalHost: secondHost, events: [event(4096, 'message.appended')] });
    expect(screen.getByRole('button', { name: '待处理 · 1' }).parentElement).toBe(secondHost);
    expect(view.api.onConversationNotice).toHaveBeenCalledTimes(1);
    view.update({ portalHost: secondHost, events: [event(4097, 'conversation.ask_answered')] });
    await screen.findByRole('button', { name: '待处理 · 0' });
  });
  it('reconciles orphan waits using Runtime authority instead of displaying obsolete questions', async () => {
    const view = fixture([event(1, 'run.started'), event(2, 'conversation.ask_pending')]);
    view.update({ authority: { throughSequence: 2, activeRunIds: new Set() } });
    await screen.findByRole('button', { name: '待处理 · 0' });
    expect(view.onProjection.mock.calls.at(-1)?.[0].requests.get('a')).toEqual([]);
  });
  it('does not retain a failure entry after a new retry is running', async () => {
    const view = fixture([event(1, 'run.started'), event(2, 'run.failed')]);
    await screen.findByRole('button', { name: '待处理 · 1' });
    view.update({
      events: [
        event(1, 'run.started'),
        event(2, 'run.failed'),
        { ...event(3, 'run.started'), runId: 'run-b' as Event['runId'] },
      ],
    });
    await screen.findByRole('button', { name: '待处理 · 0' });
  });
  it('restores a pending question directly from Runtime when no original event is replayed', async () => {
    const view = fixture([]);
    const api = {
      ...view.api,
      openTask: vi.fn(async () => ({ task: { threadId: 'thread-a' } })),
      conversationAskPending: vi.fn(async () => ({
        ask: {
          askId: 'restored',
          threadId: 'thread-a',
          runId: 'run-a',
          questions: [],
          createdAt: new Date().toISOString(),
        },
      })),
    };
    view.rerender(
      <ConversationAttentionController
        api={api as never}
        conversations={[conversation]}
        workspaces={[]}
        events={[]}
        connectionRevision={1}
        authority={{ throughSequence: 50, activeRunIds: new Set(['run-a']) }}
        lastSeen={{}}
        visibleIds={new Set()}
        titleFor={() => '模型'}
        onOpenConversation={vi.fn()}
        onProjection={view.onProjection}
        portalHost={view.portalHost}
      />,
    );
    await screen.findByRole('button', { name: '待处理 · 1' });
    await waitFor(() =>
      expect(view.onProjection.mock.calls.at(-1)?.[0].requests.get('a')?.[0]).toMatchObject({
        key: 'ask:restored',
      }),
    );
  });
});
