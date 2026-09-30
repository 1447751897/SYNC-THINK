/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import type { Conversation, GlobalAgent } from '@sync-think/shared';
import {
  agentContactId,
  buildAgentWorkspaceContacts,
  groupContactId,
  readContactOrder,
  readPinnedAgents,
  reorderContactIds,
  togglePinnedAgent,
  writeContactOrder,
  writePinnedAgents,
} from './agent-workspace-contacts.js';

const agent = (id: string, name: string): GlobalAgent =>
  ({ id, name, description: `${name}简介`, enabled: true, archived: false, availabilityScope: 'global' }) as GlobalAgent;
const conv = (id: string, patch: Partial<Conversation> = {}): Conversation =>
  ({
    id,
    workspaceId: 'ws1',
    title: id,
    track: 'agent',
    targetRef: 'a0',
    collaborationKind: 'direct',
    createdAt: '2026-09-28T00:00:00Z',
    updatedAt: '2026-09-28T00:00:00Z',
    lastMessageAt: '2026-09-28T00:00:00Z',
    ...patch,
  }) as Conversation;

afterEach(() => localStorage.clear());

describe('agent workspace contacts', () => {
  it('merges standalone agents and mixed group chats into one ordered list', () => {
    const contacts = buildAgentWorkspaceContacts({
      agents: [agent('a0', '设计师'), agent('a1', '审查员')],
      conversations: [
        conv('direct', { targetRef: 'a1', collaborationKind: 'direct', lastMessagePreview: '先看这段' }),
        conv('group', { title: '创作小队 + 审查员', targetRef: 'a0', collaborationKind: 'group' }),
        conv('team', { track: 'team', targetRef: 'team-a', collaborationKind: 'group', title: '创作小队' }),
      ],
      groupedAgentIds: new Set(['a0']),
      teamIds: new Set(['team-a']),
      searchTerm: '',
      order: [],
      pinnedAgentIds: new Set(),
    });
    expect(contacts.map((item) => item.id)).toEqual([agentContactId('a1'), groupContactId('group')]);
  });

  it('keeps pinned contacts above a custom drag order', () => {
    const contacts = buildAgentWorkspaceContacts({
      agents: [agent('a0', '设计师'), agent('a1', '审查员')],
      conversations: [
        conv('older', { targetRef: 'a0', collaborationKind: 'direct' }),
        conv('group', { title: '群聊', collaborationKind: 'group', pinnedAt: '2026-09-29T00:00:00Z' }),
      ],
      groupedAgentIds: new Set(),
      teamIds: new Set(),
      searchTerm: '',
      order: [agentContactId('a0'), agentContactId('a1'), groupContactId('group')],
      pinnedAgentIds: new Set(['a1']),
    });
    expect(contacts.map((item) => [item.id, item.pinned])).toEqual([
      [groupContactId('group'), true],
      [agentContactId('a0'), false],
    ]);
  });

  it('reorders visible contact ids and persists workspace lists', () => {
    expect(reorderContactIds(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    writeContactOrder('ws1', ['group:1', 'agent:a']);
    writePinnedAgents('ws1', ['a']);
    expect(readContactOrder('ws1')).toEqual(['group:1', 'agent:a']);
    expect(readPinnedAgents('ws1')).toEqual(['a']);
    expect(togglePinnedAgent(['a'], 'a')).toEqual([]);
    expect(togglePinnedAgent([], 'a')).toEqual(['a']);
  });
});


it('hides unchatted and empty draft contacts even when pinned', () => {
  const contacts = buildAgentWorkspaceContacts({
    agents: [agent('a0', '未聊'), agent('a1', '已聊'), agent('a2', '仅草稿')],
    conversations: [conv('real', { targetRef: 'a1', lastMessageAt: '2026-09-29T00:00:00Z' }), conv('empty', { targetRef: 'a2', taskId: 'prepared-task' as Conversation['taskId'], hasMessages: false })],
    groupedAgentIds: new Set(), teamIds: new Set(), searchTerm: '', order: [], pinnedAgentIds: new Set(['a0']),
  });
  expect(contacts.map(item => item.id)).toEqual([agentContactId('a1')]);
});
