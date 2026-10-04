import { describe, expect, it, vi } from 'vitest';
import type { Event } from '@sync-think/shared';
import { ConversationNotifications } from './conversation-notifications.js';
const NOW = Date.parse('2026-10-04T12:00:00Z');
function event(
  sequence: number,
  type: string,
  payload: Record<string, unknown> = {},
  age = 0,
): Event {
  return {
    id: `event-${sequence}` as Event['id'],
    sequence,
    type,
    category: 'system',
    workspaceId: 'ws' as Event['workspaceId'],
    taskId: 'task-a' as Event['taskId'],
    runId: (payload.runId ?? 'run-a') as Event['runId'],
    occurredAt: new Date(NOW + age).toISOString(),
    payload: { ...payload },
  };
}
function fixture(focused = false) {
  const host = {
    now: () => NOW,
    listConversations: vi.fn(async () => [{ id: 'a', taskId: 'task-a', title: '数据库迁移' }]),
    publish: vi.fn(),
    show: vi.fn(),
    isFocused: vi.fn(() => focused),
  };
  return { host, notifier: new ConversationNotifications(host) };
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
describe('main-process conversation notifications', () => {
  it.each([
    'conversation.ask_pending',
    'tool.approval_requested',
    'desktop.command.waiting_user',
    'run.completed',
    'run.failed',
  ])('notifies %s while hidden without renderer frames', async (type) => {
    const { notifier, host } = fixture();
    notifier.ingest([
      event(1, type, { askId: 'ask-a', approvalId: 'approval-a', commandId: 'desktop-a' }),
    ]);
    await flush();
    expect(host.publish).toHaveBeenCalledOnce();
    expect(host.show).toHaveBeenCalledOnce();
    expect(host.show.mock.calls[0]).toEqual([
      expect.objectContaining({ conversationId: 'a', title: '数据库迁移' }),
      true,
    ]);
  });
  it('publishes foreground notices but leaves native notifications silent', async () => {
    const { notifier, host } = fixture(true);
    notifier.ingest([event(1, 'run.completed')]);
    await flush();
    expect(host.publish).toHaveBeenCalledOnce();
    expect(host.show).not.toHaveBeenCalled();
  });
  it('does not replay old completion or question notifications on startup', async () => {
    const { notifier, host } = fixture();
    notifier.ingest([
      event(1, 'run.completed', {}, -1000),
      event(2, 'conversation.ask_pending', { askId: 'old' }, -500),
    ]);
    await flush();
    expect(host.publish).not.toHaveBeenCalled();
    expect(host.show).not.toHaveBeenCalled();
  });
  it('deduplicates reconnect deliveries and duplicate request IDs with new event IDs', async () => {
    const { notifier, host } = fixture();
    const ask = event(1, 'conversation.ask_pending', { askId: 'ask-a' });
    notifier.ingest([ask]);
    await flush();
    notifier.ingest([ask, event(2, ask.type, ask.payload)]);
    await flush();
    expect(host.show).toHaveBeenCalledOnce();
  });
  it('suppresses resolved requests from the same replay batch', async () => {
    const { notifier, host } = fixture();
    notifier.ingest([
      event(1, 'conversation.ask_pending', { askId: 'ask-a' }),
      event(2, 'conversation.ask_answered', { askId: 'ask-a' }),
    ]);
    await flush();
    expect(host.show).not.toHaveBeenCalled();
  });
  it('rechecks requests after asynchronous title lookup so an already answered question does not notify', async () => {
    const { notifier, host } = fixture();
    let resolve!: (value: { id: string; taskId: string; title: string }[]) => void;
    host.listConversations.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    notifier.ingest([event(1, 'conversation.ask_pending', { askId: 'ask-a' })]);
    notifier.ingest([event(2, 'conversation.ask_answered', { askId: 'ask-a' })]);
    resolve([{ id: 'a', taskId: 'task-a', title: '数据库迁移' }]);
    await flush();
    expect(host.show).not.toHaveBeenCalled();
  });
  it('notifies formal plan review instead of announcing task completion', async () => {
    const { notifier, host } = fixture();
    notifier.ingest([
      event(1, 'conversation.plan_submitted', { conversationId: 'a', revision: 1 }),
      event(2, 'run.completed'),
    ]);
    await flush();
    expect(host.show).toHaveBeenCalledOnce();
    expect(host.publish.mock.calls[0][0].kind).toBe('approval');
  });
  it('ignores cancellations and pauses', async () => {
    const { notifier, host } = fixture();
    notifier.ingest([event(1, 'run.cancelled'), event(2, 'run.paused')]);
    await flush();
    expect(host.show).not.toHaveBeenCalled();
  });
  it('allows completion notifications to be disabled without muting questions or failures', async () => {
    const { notifier, host } = fixture();
    notifier.setPreferences({ completed: false, sound: false });
    notifier.ingest([event(1, 'run.completed')]);
    await flush();
    expect(host.show).not.toHaveBeenCalled();
    notifier.ingest([event(2, 'conversation.ask_pending', { askId: 'ask-a', runId: 'run-b' })]);
    await flush();
    notifier.ingest([event(3, 'run.failed', { runId: 'run-c' })]);
    await flush();
    expect(host.publish.mock.calls.map(([notice]) => notice.kind)).toEqual(['answer', 'failed']);
  });
  it('uses optional sound without changing notification priority', async () => {
    const { notifier, host } = fixture();
    notifier.setPreferences({ completed: true, sound: true });
    notifier.ingest([event(1, 'run.completed')]);
    await flush();
    expect(host.show.mock.calls[0][1]).toBe(false);
  });
  it('isolates unmapped conversations', async () => {
    const { notifier, host } = fixture();
    host.listConversations.mockResolvedValueOnce([
      { id: 'b', taskId: 'task-b', title: '另一会话' },
    ]);
    notifier.ingest([event(1, 'run.completed')]);
    await flush();
    expect(host.show).not.toHaveBeenCalled();
  });
  it('degrades gracefully when the conversation query fails', async () => {
    const { notifier, host } = fixture();
    host.listConversations.mockRejectedValueOnce(new Error('offline'));
    notifier.ingest([event(1, 'run.completed')]);
    await flush();
    expect(host.show).not.toHaveBeenCalled();
  });
});

it('notifies legacy completion events linked by taskId even without a runId', async () => {
  const { notifier, host } = fixture();
  notifier.ingest([{ ...event(1, 'run.completed'), runId: undefined }]);
  await flush();
  expect(host.publish).toHaveBeenCalledOnce();
  expect(host.publish.mock.calls[0][0]).toMatchObject({ conversationId: 'a', kind: 'completed' });
});
