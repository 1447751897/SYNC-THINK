import { describe, expect, it, vi } from 'vitest';
import type { DelegatedAgentProjection } from '@sync-think/protocol';
import type { Message, MessageBlock, MessageId, RunId, ThreadId } from '@sync-think/shared';
import { DelegationMessageHistory } from './delegation-message-history.js';
import { delegatedAgentsFromBlocks } from './delegation-message-projection.js';

const parentId = 'parent' as RunId;
function card(id: string, status: DelegatedAgentProjection['status']): DelegatedAgentProjection {
  return {
    childRunId: id as RunId, parentRunId: parentId, name: 'Reviewer', avatar: '🔎',
    kind: 'existing', agentId: 'reviewer', status,
    toolEvents: [{ toolName: 'read_file', status: 'completed' }],
  };
}
function message(blocks: MessageBlock[] = []): Message {
  return {
    id: 'asst-parent' as MessageId, threadId: 'thread' as ThreadId,
    role: 'assistant', sequence: 1, createdAt: '2026-09-19T00:00:00Z', blocks,
  };
}
function fixture(initial: Message | undefined = message()) {
  let stored: Message | undefined = initial;
  const messages = {
    getMessage: vi.fn(() => stored),
    updateBlocks: vi.fn((_id: MessageId, blocks: readonly MessageBlock[]) => {
      if (!stored) throw new Error('missing parent');
      stored = { ...stored, blocks: [...blocks] };
      return stored;
    }),
    listDelegatedMessages: vi.fn(() => stored ? [stored] : []),
    findDelegatedMessage: vi.fn((_threadId: ThreadId, childRunId: string) =>
      stored && delegatedAgentsFromBlocks(stored.blocks).some((item) => item.childRunId === childRunId)
        ? stored
        : undefined),
  };
  return {
    messages,
    history: new DelegationMessageHistory(messages, () => undefined),
    setParent: (next: Message | undefined) => { stored = next; },
  };
}

describe('DelegationMessageHistory', () => {
  it('retains pending cards when release precedes parent persistence', () => {
    const f = fixture();
    f.setParent(undefined);
    f.history.upsert(card('A', 'completed'));
    f.history.releaseParent(parentId);
    expect(f.history.listByParent(parentId)).toMatchObject([{ childRunId: 'A', status: 'completed' }]);
    expect(f.messages.updateBlocks).not.toHaveBeenCalled();
    f.setParent(message());
    f.history.persistParent(parentId);
    expect(new DelegationMessageHistory(f.messages, () => undefined).listByParent(parentId))
      .toMatchObject([{ childRunId: 'A', status: 'completed' }]);
  });

  it('retains a failed flush and merges a later sibling when retry succeeds', () => {
    const f = fixture();
    f.history.upsert(card('A', 'completed'));
    f.messages.updateBlocks.mockImplementationOnce(() => { throw new Error('write failed'); });
    expect(() => f.history.releaseParent(parentId)).toThrow('write failed');
    f.history.upsert(card('B', 'cancelled'));
    f.history.releaseParent(parentId);
    const restored = new DelegationMessageHistory(f.messages, () => undefined);
    expect(restored.listByParent(parentId).map(({ childRunId, status }) => ({ childRunId, status })))
      .toEqual([{ childRunId: 'A', status: 'completed' }, { childRunId: 'B', status: 'cancelled' }]);
    // Successful terminal flush releases transient cards; storage is now the authority.
    f.setParent(message());
    expect(f.history.listByParent(parentId)).toEqual([]);
  });

  it('keeps parent content and unrelated metadata, with one delegated metadata owner', () => {
    const f = fixture();
    const blocks: MessageBlock[] = [
      { type: 'text', text: 'Answer', payload: { custom: 'text', delegatedAgents: [card('old', 'running')] } },
      { type: 'commentary', text: 'Progress', payload: { custom: 'commentary', delegatedAgents: [] } },
    ];
    const before = JSON.stringify(blocks);
    const next = f.history.withMetadata(blocks, [card('A', 'completed')]);
    expect(next[0]).toEqual({ type: 'text', text: 'Answer', payload: { custom: 'text' } });
    expect(next[1]).toMatchObject({ type: 'commentary', text: 'Progress', payload: {
      custom: 'commentary', delegatedAgents: [{ childRunId: 'A' }],
    } });
    expect(JSON.stringify(blocks)).toBe(before);
    expect(delegatedAgentsFromBlocks(next)).toHaveLength(1);
    expect(f.history.withMetadata([], [card('A', 'cancelled')])[0])
      .toMatchObject({ type: 'commentary', text: '' });
  });

  it('does not alias input cards or caller-owned tool arrays', () => {
    const f = fixture();
    const input = card('A', 'running');
    const returned = f.history.upsert(input);
    input.toolEvents[0]!.toolName = 'changed input';
    returned[0]!.toolEvents[0]!.toolName = 'changed return';
    const listed = f.history.listByParent(parentId);
    expect(listed[0]!.toolEvents[0]!.toolName).toBe('read_file');
    listed[0]!.toolEvents[0]!.toolName = 'changed list';
    expect(f.history.listByParent(parentId)[0]!.toolEvents[0]!.toolName).toBe('read_file');
  });

  it('uses keyed state for live cards without scanning or replaying conversation history', () => {
    const f = fixture();
    f.history.upsert(card('A', 'running'));
    f.history.persistParent(parentId);
    const getState = vi.fn(() => ({
      childRunId: 'A', parentRunId: parentId, threadId: 'thread', agentId: 'reviewer',
      name: 'Reviewer', status: 'cancelled' as const, toolCount: 1,
      updatedAt: 'now', sequence: 4,
    }));
    const restored = new DelegationMessageHistory(f.messages, getState);
    expect(restored.listByParent(parentId)).toMatchObject([{ status: 'cancelled' }]);
    expect(getState.mock.calls).toEqual([['A']]);
    expect(f.messages.listDelegatedMessages).not.toHaveBeenCalled();
    expect(f.messages.getMessage).toHaveBeenLastCalledWith('asst-parent');
  });

  it('ignores other-parent metadata and delayed progress after a durable terminal card', () => {
    const f = fixture(message([{ type: 'text', payload: { delegatedAgents: [
      card('A', 'cancelled'), { ...card('B', 'running'), parentRunId: 'other' },
    ] } }]));
    f.history.upsert(card('A', 'running'));
    expect(f.history.listByParent(parentId)).toMatchObject([{ childRunId: 'A', status: 'cancelled' }]);
  });

  it('releases transient-only cards when the host has no message store', () => {
    const history = new DelegationMessageHistory(undefined, () => undefined);
    history.upsert(card('A', 'completed'));
    history.releaseParent(parentId);
    expect(history.listByParent(parentId)).toEqual([]);
  });
});
