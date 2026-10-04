import { describe, expect, it } from 'vitest';
import type { Event } from '@sync-think/shared';
import {
  buildConversationAttention,
  ConversationAttentionIndex,
} from './conversation-attention.js';
function event(
  sequence: number,
  type: string,
  payload: Record<string, unknown> = {},
  extra: Partial<Event> = {},
): Event {
  return {
    id: `event-${sequence}` as Event['id'],
    sequence,
    workspaceId: 'ws' as Event['workspaceId'],
    category: 'system',
    type,
    occurredAt: '2026-10-04T00:00:00Z',
    payload: { threadId: 'thread-a', runId: 'run-a', ...payload },
    ...extra,
  };
}
const conversations = [
  { id: 'a', taskId: 'task-a' },
  { id: 'b', taskId: 'task-b' },
];
const binding = event(1, 'message.appended', {}, { taskId: 'task-a' as Event['taskId'] });
function pending(sequence = 2, askId = 'ask-a') {
  return event(sequence, 'conversation.ask_pending', { askId });
}
describe('global conversation attention', () => {
  it('maps actual task/thread bindings and isolates other conversations', () => {
    const result = buildConversationAttention([binding, pending()], conversations);
    expect(result.get('a')?.[0]).toMatchObject({
      key: 'ask:ask-a',
      kind: 'answer',
      label: '等你回答',
    });
    expect(result.get('b')).toEqual([]);
  });
  it.each(['conversation.ask_answered', 'conversation.ask_cancelled'])(
    'clears on %s, including out-of-order delivery',
    (type) => {
      expect(
        buildConversationAttention(
          [event(3, type, { askId: 'ask-a' }), pending(), binding],
          conversations,
        ).get('a'),
      ).toEqual([]);
    },
  );
  it('does not resolve a second question when the first is answered', () => {
    const result = buildConversationAttention(
      [
        binding,
        pending(),
        pending(3, 'ask-b'),
        event(4, 'conversation.ask_answered', { askId: 'ask-a' }),
      ],
      conversations,
    );
    expect(result.get('a')?.map((item) => item.key)).toEqual(['ask:ask-b']);
  });
  it.each(['run.completed', 'run.failed', 'run.cancelled', 'run.paused'])(
    'clears run-scoped waits on %s and does not resurrect replay',
    (type) => {
      const index = new ConversationAttentionIndex();
      index.ingest([binding, pending()]);
      index.ingest([event(4, type)]);
      index.ingest([pending()]);
      expect(index.forConversation(conversations[0])).toEqual([]);
    },
  );
  it('clears only the terminal run, not a simultaneous request in another run', () => {
    const index = new ConversationAttentionIndex();
    index.ingest([
      binding,
      pending(),
      event(3, 'tool.approval_requested', { approvalId: 'approval-b', runId: 'run-b' }),
      event(4, 'run.completed'),
    ]);
    expect(index.forConversation(conversations[0]).map((item) => item.key)).toEqual([
      'approval:approval-b',
    ]);
  });
  it('keeps formal plans after the planning run finishes and resolves them only on a plan decision', () => {
    const index = new ConversationAttentionIndex();
    index.ingest([
      event(2, 'conversation.plan_submitted', { conversationId: 'a', revision: 1 }),
      event(3, 'run.completed'),
    ]);
    expect(index.forConversation(conversations[0])[0]?.kind).toBe('approval');
    index.ingest([event(4, 'conversation.plan_approved', { conversationId: 'a', revision: 1 })]);
    expect(index.forConversation(conversations[0])).toEqual([]);
  });
  it('keeps desktop handoffs until continued even after a run completes', () => {
    const index = new ConversationAttentionIndex();
    index.ingest([
      binding,
      event(2, 'desktop.command.waiting_user', { commandId: 'desktop-a' }),
      event(3, 'run.completed'),
    ]);
    expect(index.forConversation(conversations[0])[0]?.kind).toBe('desktop');
    index.ingest([event(4, 'desktop.command.continued', { commandId: 'desktop-a' })]);
    expect(index.forConversation(conversations[0])).toEqual([]);
  });
  it('restores approval state and maps events with only runId using earlier bindings', () => {
    const index = new ConversationAttentionIndex();
    index.ingest([
      binding,
      event(2, 'run.started', {}, { runId: 'run-a' as Event['runId'] }),
      event(3, 'tool.approval_requested', { approvalId: 'tool-a', threadId: undefined }),
    ]);
    expect(index.forConversation(conversations[0])[0]?.kind).toBe('approval');
    index.ingest([event(4, 'tool.approval_decided', { approvalId: 'tool-a' })]);
    expect(index.forConversation(conversations[0])).toEqual([]);
  });
  it('preserves unresolved requests when streaming evicts original events from the UI history', () => {
    const index = new ConversationAttentionIndex();
    index.ingest([binding, pending()]);
    index.ingest([event(4096, 'message.appended')]);
    expect(index.forConversation(conversations[0])).toHaveLength(1);
  });
  it('supports legacy synthetic task IDs', () => {
    expect(
      buildConversationAttention(
        [pending()],
        [{ id: 'a', taskId: 'task-from-thread:thread-a' }],
      ).get('a'),
    ).toHaveLength(1);
  });
});

it('resolves a persistent browser handoff on explicit continuation', () => {
  const index = new ConversationAttentionIndex();
  index.ingest([
    binding,
    event(2, 'approval.requested', { approvalId: 'browser-a', action: 'browser.handoff' }),
    event(3, 'run.paused'),
  ]);
  expect(index.forConversation(conversations[0])).toHaveLength(1);
  index.ingest([event(4, 'browser.handoff.continued', { handoffId: 'handoff-a' })]);
  expect(index.forConversation(conversations[0])).toEqual([]);
});
