import { describe, expect, it, vi } from 'vitest';
import type { Event, RunId } from '@sync-think/shared';
import { DurableToolApprovalLedger } from './durable-tool-approval-ledger.js';

function event(
  type: 'tool.approval_requested' | 'tool.approval_decided',
  approvalId: string,
  sequence: number,
  overrides: Partial<Event> = {},
): Event {
  return {
    id: `event-${sequence}`,
    workspaceId: 'workspace-a',
    runId: 'run-a' as RunId,
    category: 'system',
    type,
    occurredAt: `2026-09-20T00:00:0${sequence}.000Z`,
    sequence,
    payload: { approvalId, threadId: 'thread-a', runId: 'run-a' },
    ...overrides,
  } as Event;
}

describe('durable tool approval ledger', () => {
  it('projects and filters fallback events by thread and run', () => {
    const ledger = new DurableToolApprovalLedger();
    ledger.remember(event('tool.approval_requested', 'approval-a', 1));
    ledger.remember(
      event('tool.approval_requested', 'approval-b', 2, {
        runId: 'run-b' as RunId,
        payload: { approvalId: 'approval-b', threadId: 'thread-a', runId: 'run-b' },
      }),
    );

    expect([...ledger.list({ threadId: 'thread-a' }).keys()]).toEqual(['approval-a', 'approval-b']);
    expect([...ledger.list({ threadId: 'thread-a', runId: 'run-a' as RunId }).keys()]).toEqual([
      'approval-a',
    ]);
  });

  it('returns one fallback approval by identity', () => {
    const ledger = new DurableToolApprovalLedger();
    ledger.remember(event('tool.approval_requested', 'approval-a', 1));
    ledger.remember(event('tool.approval_decided', 'approval-a', 2));

    const state = ledger.list({ approvalId: 'approval-a' }).get('approval-a');
    expect(state?.requested.type).toBe('tool.approval_requested');
    expect(state?.decided?.type).toBe('tool.approval_decided');
    expect(ledger.list({ approvalId: 'missing' }).size).toBe(0);
  });

  it('uses the event port as authority and does not retain fallback events', () => {
    const requested = event('tool.approval_requested', 'approval-store', 1);
    const listEvents = vi.fn(() => [requested]);
    const ledger = new DurableToolApprovalLedger({ listEvents });
    ledger.remember(event('tool.approval_requested', 'approval-memory', 2));

    expect([...ledger.list({ threadId: 'thread-a' }).keys()]).toEqual(['approval-store']);
    expect(listEvents).toHaveBeenCalledWith({ threadId: 'thread-a' });
  });
});
