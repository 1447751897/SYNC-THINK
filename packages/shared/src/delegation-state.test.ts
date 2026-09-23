import { expect, it } from 'vitest';
import { delegatedRunFromEvent } from './delegation-state.js';
import type { Event } from './types/event.js';

function event(): Event {
  return {
    id: 'event' as Event['id'],
    runId: 'child' as Event['runId'],
    workspaceId: 'workspace' as Event['workspaceId'],
    category: 'run',
    type: 'run.completed',
    sequence: 8,
    occurredAt: 'now',
    payload: {
      threadId: 'thread',
      delegatedRun: {
        childRunId: 'child',
        parentRunId: 'parent',
        threadId: 'thread',
        agentId: 'agent',
        name: 'Reviewer',
        status: 'completed',
        toolCount: 7,
        sequence: 999,
        updatedAt: 'forged',
      },
    },
  };
}
it('takes the durable cursor from the envelope and ignores unknown snapshot fields', () => {
  expect(delegatedRunFromEvent(event())).toMatchObject({ sequence: 8, updatedAt: 'now' });
});
it.each([
  { childRunId: 'other' },
  { threadId: 'other' },
  { parentRunId: 'child' },
  { toolCount: -1 },
  { toolCount: 0.5 },
  { result: {} },
])('rejects invalid snapshot %j', (change) => {
  const value = event();
  Object.assign(value.payload.delegatedRun as object, change);
  expect(() => delegatedRunFromEvent(value)).toThrow('delegation.invalid_event');
});
it('rejects a snapshot status inconsistent with the event', () => {
  const value = event();
  value.type = 'provider.usage';
  expect(() => delegatedRunFromEvent(value)).toThrow('delegation.event_status_mismatch');
});
it('leaves legacy events without a snapshot alone', () => {
  const value = event();
  delete value.payload.delegatedRun;
  expect(delegatedRunFromEvent(value)).toBeUndefined();
});
