import { describe, expect, it, vi } from 'vitest';
import type { DelegatedAgentProjection } from '@sync-think/protocol';
import type { DelegatedRunRecord, Message, MessageId, RunId, ThreadId } from '@sync-think/shared';
import { DelegationService } from './delegation-service.js';

function agent(id: string, status: DelegatedAgentProjection['status']): DelegatedAgentProjection {
  return {
    childRunId: id as RunId,
    parentRunId: 'parent' as RunId,
    name: 'Reviewer',
    avatar: '=',
    kind: 'existing',
    agentId: 'reviewer',
    status,
    toolEvents: [],
  };
}

describe('delegated task history', () => {
  it('persists event-backed repairs but keeps temporary liveness observations out of durable state', () => {
    let stored: DelegatedRunRecord = {
      childRunId: 'child', parentRunId: 'parent', threadId: 'thread', agentId: 'reviewer',
      name: 'Reviewer', status: 'running', toolCount: 1, updatedAt: 'now', sequence: 1,
    };
    const repository = {
      get: () => stored,
      listByThread: () => [stored],
      upsert: vi.fn((next: DelegatedRunRecord) => { stored = next; return next; }),
    };
    const reconcile = vi.fn((item: DelegatedRunRecord): DelegatedRunRecord => ({ ...item, status: 'failed' }));
    const service = new DelegationService(undefined, repository, reconcile);
    expect(service.query('thread', { childRunId: 'child' })).toMatchObject({ status: 'failed' });
    expect(repository.upsert).not.toHaveBeenCalled();
    expect(service.getState('child')).toMatchObject({ status: 'running' });
    reconcile.mockImplementationOnce((item) => ({ ...item, status: 'cancelled', sequence: 2 }));
    expect(service.query('thread', { childRunId: 'child' })).toMatchObject({ status: 'cancelled' });
    expect(repository.upsert).toHaveBeenCalledTimes(1);
    service.query('thread', { childRunId: 'child' });
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('queries domain state without message history, scopes by thread and pages final reports', () => {
    const service = new DelegationService();
    service.recordState({
      childRunId: 'child',
      parentRunId: 'parent',
      threadId: 'thread',
      agentId: 'reviewer',
      name: 'Reviewer',
      status: 'completed',
      toolCount: 120,
      result: 'a'.repeat(8_000) + 'final finding',
      sequence: 10,
      updatedAt: '2026-09-19T00:00:00Z',
    });
    expect(service.query('thread', {})).toMatchObject({
      tasks: [{ toolCount: 120, hasResult: true }],
    });
    expect(service.query('thread', { childRunId: 'child' })).toMatchObject({ nextOffset: 8_000 });
    expect(service.query('thread', { childRunId: 'child', offset: 8_000 })).toMatchObject({
      result: 'final finding',
    });
    expect(service.query('other', { childRunId: 'child' })).toMatchObject({ ok: false });
  });

  it('retains cards even when the parent has no text, and ignores progress after cancellation', () => {
    const service = new DelegationService();
    service.upsert(agent('A', 'cancelled'));
    service.upsert(agent('A', 'running'));
    const blocks = service.withMetadata([], service.listByParent('parent' as RunId));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].payload).toMatchObject({
      delegatedAgents: [{ childRunId: 'A', status: 'cancelled' }],
    });
  });
  it('retains completed siblings when a child finishes after the parent and a service reconnect', () => {
    let parent: Message = {
      id: 'asst-parent' as MessageId,
      threadId: 'thread' as ThreadId,
      role: 'assistant',
      sequence: 1,
      createdAt: '2026-09-19T00:00:00Z',
      blocks: [{ type: 'text', text: 'Waiting for reviewers' }],
    };
    const messages = {
      getMessage: () => parent,
      updateBlocks: (_id: MessageId, blocks: readonly Message['blocks'][number][]) => {
        parent = { ...parent, blocks: [...blocks] };
        return parent;
      },
    };
    const first = new DelegationService(messages);
    first.upsert(agent('A', 'completed'));
    first.upsert(agent('B', 'running'));
    first.persistParent('parent' as RunId);
    first.releaseParent('parent' as RunId);

    const reconnected = new DelegationService(messages);
    reconnected.upsert(agent('B', 'completed'));
    reconnected.persistParent('parent' as RunId);
    expect(
      new DelegationService(messages)
        .listByParent('parent' as RunId)
        .map(({ childRunId, status }) => ({ childRunId, status })),
    ).toEqual([
      { childRunId: 'A', status: 'completed' },
      { childRunId: 'B', status: 'completed' },
    ]);
  });
});
