import { describe, expect, it } from 'vitest';
import type { AssistantTurnSegment, ConversationTransientSnapshot, DelegatedAgentProjection } from '@sync-think/protocol';
import type { RunId, ThreadId } from '@sync-think/shared';
import {
  delegatedUsageFromProcess, projectDelegatedAgentCard, projectDelegationSnapshot,
  resolveParentDelegationToolCallId, type DelegationCardSource,
} from './delegation-projection.js';

const parentRunId = 'parent' as RunId;
const threadId = 'thread' as ThreadId;
const child: DelegationCardSource = {
  runId: 'child' as RunId, userText: 'Review', assistantText: ' Report ', globalAgentName: ' 代码审查员 ',
};
function tool(id: string, task: string, status: 'running' | 'completed' = 'running'): AssistantTurnSegment {
  return { id, sequence: 1, kind: 'tool', toolCallId: id, name: 'agent_run',
    argumentsJson: JSON.stringify({ task }), status };
}
function card(overrides: Partial<Parameters<typeof projectDelegatedAgentCard>[0]> = {}) {
  return projectDelegatedAgentCard({
    child, agentId: 'reviewer', parentRunId, eventType: 'message.delta', siblings: [], childUsage: {}, ...overrides,
  });
}

describe('delegation card projection', () => {
  it('prefers the live exact-task row over a settled replay', () => {
    expect(card({ parentTimeline: [tool('replay', 'Review', 'completed'), tool('live', ' Review ')] })
      .projection.parentToolCallId).toBe('live');
  });

  it('skips rows claimed by siblings but keeps the current child eligible', () => {
    const siblings = [
      { ...card().projection, childRunId: 'sibling' as RunId, parentToolCallId: 'first' },
      { ...card().projection, parentToolCallId: 'second' },
    ];
    expect(card({ siblings, parentTimeline: [tool('first', 'Review'), tool('second', 'Review')] })
      .projection.parentToolCallId).toBe('second');
  });

  it('retains an explicitly bound row even after the parent timeline disappears', () => {
    expect(card({ child: { ...child, delegationParentToolCallId: 'bound' } }).projection)
      .toMatchObject({ parentToolCallId: 'bound' });
  });

  it('uses the single unclaimed row when arguments were compacted', () => {
    expect(resolveParentDelegationToolCallId({
      timeline: [{ ...tool('row', 'different'), argumentsJson: '{' } as AssistantTurnSegment],
      task: 'Review', claimed: new Set(),
    })).toBe('row');
  });

  it('leaves ambiguous and unrelated parent tool rows unbound', () => {
    expect(card({ parentTimeline: [tool('a', 'other'), tool('b', 'other')] }).projection)
      .not.toHaveProperty('parentToolCallId');
    expect(card({ parentTimeline: [{ ...tool('a', 'Review'), name: 'read_file' } as AssistantTurnSegment] }).projection)
      .not.toHaveProperty('parentToolCallId');
  });

  it.each([
    ['run.completed', undefined, 'completed'],
    ['run.completed', 'timed_out', 'completed'],
    ['run.failed', undefined, 'failed'],
    ['run.failed', 'timed_out', 'timed_out'],
    ['run.cancelled', undefined, 'cancelled'],
    ['run.cancelled', 'timed_out', 'timed_out'],
  ])('keeps terminal status for %s / %s', (eventType, reason, expected) => {
    expect(card({ eventType, child: { ...child, delegationTerminationReason: reason } }))
      .toMatchObject({ terminalState: expected, projection: { status: expected, result: 'Report' } });
  });

  it('keeps status observations attached when projecting a completed child', () => {
    const result = card({ eventType: 'run.completed' });
    result.projection.statusObservation = {
      source: 'query',
      diagnostic: 'completed_unnotified',
      observedAt: '2026-01-01T00:00:00.000Z',
      probeCount: 1,
    };
    expect(result.projection.statusObservation).toMatchObject({ diagnostic: 'completed_unnotified', probeCount: 1 });
  });

  it('omits draft text and preserves the latest running tool and parallel group', () => {
    const result = card({ child: { ...child, delegationParallelGroup: 'batch', assistantTimeline: [
      { ...tool('one', ''), name: 'read_file' } as AssistantTurnSegment,
      { ...tool('two', ''), name: 'git_diff' } as AssistantTurnSegment,
    ] } });
    expect(result.terminalState).toBeUndefined();
    expect(result.projection).toMatchObject({ status: 'running', activeTool: 'git_diff', parallelGroup: 'batch' });
    expect(result.projection).not.toHaveProperty('result');
    expect(result.projection.toolEvents).toHaveLength(2);
  });

  it.each([
    [' = ', ' 代码审查员 ', '=', '代码审查员'],
    ['', ' 代码审查员 ', '代码', '代码审查员'],
    [undefined, ' ', '🤖', '已配置智能体'],
  ])('retains avatar precedence %s / %s', (storedAvatar, globalAgentName, avatar, name) => {
    expect(card({ storedAvatar, child: { ...child, globalAgentName } }).projection).toMatchObject({ avatar, name });
  });

  it('preserves zero usage values and omits unknown totals', () => {
    expect(delegatedUsageFromProcess({})).toEqual({});
    const usage = delegatedUsageFromProcess({ tokensIn: 0, tokensOut: 5, cachedTokensHit: 0, cachedTokensCreated: 3, durationMs: 0 });
    expect(usage).toEqual({ usage: { tokensIn: 0, tokensOut: 5, cachedTokensHit: 0, cachedTokensCreated: 3 }, durationMs: 0 });
    expect(card({ childUsage: usage }).projection).toMatchObject(usage);
  });

  it('retains the bounded tool log without modifying the child timeline', () => {
    const source = { ...child, assistantTimeline: Array.from({ length: 100 }, (_, i) => tool(String(i), 'Review')) };
    const before = JSON.stringify(source);
    const { projection } = card({ child: source });
    expect(projection.toolEvents.filter((event) => !event.omitted)).toHaveLength(80);
    expect(projection.toolEvents.at(-1)).toMatchObject({ omitted: true });
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe('delegation reconnect snapshots', () => {
  const agents: DelegatedAgentProjection[] = [card().projection];
  const input = { threadId, parentRunId, streamSequence: 10, occurredAt: 'now', agents };

  it('keeps a newer foreground snapshot untouched', () => {
    const current: ConversationTransientSnapshot = {
      threadId, runId: 'newer' as RunId, streamSequence: 9, text: 'New answer', updatedAt: 'before',
    };
    expect(projectDelegationSnapshot({ ...input, current })).toBeUndefined();
    expect(current.text).toBe('New answer');
    expect(current.streamSequence).toBe(9);
  });

  it('retains parent text and process while replacing cards and advancing the cursor', () => {
    const current: ConversationTransientSnapshot = {
      threadId, runId: parentRunId, streamSequence: 9, text: 'Answer', updatedAt: 'before',
      commentaryText: 'Progress', reasoningText: 'Reasoning', commentarySegments: [], reasoningSegments: [],
      assistantTimeline: [], process: { runId: parentRunId, steps: [], fileChanges: [], running: true, doneCount: 0, errorCount: 0 },
    };
    const before = JSON.stringify(current);
    const next = projectDelegationSnapshot({ ...input, current });
    expect(next).toEqual({ ...current, delegatedAgents: agents, streamSequence: 10, updatedAt: 'now' });
    expect(JSON.stringify(current)).toBe(before);
    expect(next?.delegatedAgents?.[0]).not.toBe(agents[0]);
    expect(next?.delegatedAgents?.[0]?.toolEvents).not.toBe(agents[0]?.toolEvents);
  });

  it('creates a parent snapshot when none exists', () => {
    expect(projectDelegationSnapshot({ ...input, current: undefined })).toEqual({
      threadId, runId: parentRunId, text: '', streamSequence: 10, updatedAt: 'now', delegatedAgents: agents,
    });
  });
});
