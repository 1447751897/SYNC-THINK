import { describe, expect, it, vi } from 'vitest';
import type { DelegatedAgentProjection } from '@sync-think/protocol';
import type { Message, MessageBlock, MessageId, RunId, ThreadId } from '@sync-think/shared';
import { DelegationLegacyMessageHistory } from './delegation-legacy-message-history.js';
import {
  delegatedAgentsFromBlocks,
  legacyDelegatedRunRecords,
} from './delegation-message-projection.js';

const parentId = 'parent' as RunId;

function card(id: string, status: DelegatedAgentProjection['status']): DelegatedAgentProjection {
  return {
    childRunId: id as RunId,
    parentRunId: parentId,
    name: 'Reviewer',
    avatar: '=',
    kind: 'existing',
    agentId: 'reviewer',
    status,
    toolEvents: [{ toolName: 'read_file', status: 'completed' }],
  };
}

function message(blocks: MessageBlock[], sequence = 1): Message {
  return {
    id: `asst-parent-${sequence}` as MessageId,
    threadId: 'thread' as ThreadId,
    role: 'assistant',
    sequence,
    createdAt: `2026-09-19T00:00:0${sequence}Z`,
    blocks,
  };
}

describe('DelegationLegacyMessageHistory', () => {
  it('decodes legacy history in sequence order and preserves omitted tool counts', () => {
    const old = message([
      { type: 'text', payload: { delegatedAgents: [card('A', 'running')] } },
    ]);
    const latest = message(
      [
        {
          type: 'commentary',
          payload: {
            delegatedAgents: [
              null,
              {},
              { ...card('invalid', 'running'), status: 'unknown' },
              {
                ...card('A', 'completed'),
                result: 'Report',
                toolEvents: [
                  { toolName: 'read_file' },
                  { toolName: '…另有 15 项工具调用未返回', omitted: true },
                ],
              },
            ],
          },
        },
      ],
      2,
    );
    expect(legacyDelegatedRunRecords([latest, old])).toMatchObject([
      { childRunId: 'A', status: 'completed', toolCount: 16, result: 'Report', sequence: 0 },
    ]);
  });

  it('uses exact legacy message lookup for one child report', () => {
    const stored = message([
      {
        type: 'commentary',
        payload: {
          delegatedAgents: [
            { ...card('A', 'completed'), result: 'Report A' },
            { ...card('B', 'completed'), result: 'Report B' },
          ],
        },
      },
    ]);
    const messages = {
      listDelegatedMessages: vi.fn(() => [stored]),
      findDelegatedMessage: vi.fn((_threadId: ThreadId, childRunId: string) =>
        delegatedAgentsFromBlocks(stored.blocks).some((item) => item.childRunId === childRunId)
          ? stored
          : undefined,
      ),
    };
    const history = new DelegationLegacyMessageHistory(messages);
    expect(history.get('thread', 'B')).toMatchObject({ childRunId: 'B', result: 'Report B' });
    expect(messages.findDelegatedMessage).toHaveBeenCalledWith('thread', 'B');
    expect(messages.listDelegatedMessages).not.toHaveBeenCalled();
  });
});
