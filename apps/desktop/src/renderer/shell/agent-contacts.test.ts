/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, GlobalAgent } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import {
  agentChatHistory,
  isAgentActive,
  readAgentContactGroups,
  readSidebarMode,
  writeAgentContactGroups,
  writeSidebarMode,
} from './agent-contacts.js';
import { setAgentGloballyActive, setAgentWorkspaceActive } from './agent-workspace-activation.js';

import { projectlessWorkspace, PROJECTLESS_SCOPE } from './projectless-scope.js';

const agent = {
  id: 'a',
  availabilityScope: 'global',
  enabled: true,
  archived: false,
} as GlobalAgent;
const workspaces = [
  { workspaceId: 'ws-a', name: 'A' },
  { workspaceId: 'ws-b', name: 'B' },
  { workspaceId: 'ws-c', name: 'C' },
] as WorkspaceSummary[];
const conv = (id: string, partial: Partial<Conversation> = {}): Conversation =>
  ({
    id,
    workspaceId: 'ws-a',
    track: 'agent',
    targetRef: 'a',
    createdAt: '2026-09-20',
    lastMessageAt: '2026-09-20',
    ...partial,
  }) as Conversation;
afterEach(() => localStorage.clear());

describe('agent contacts', () => {
  it('finds the latest direct chat in this workspace, ignoring pins, archived and group chats', () => {
    const list = [
      conv('old', { pinnedAt: '2026-09-24' }),
      conv('latest', { lastMessageAt: '2026-09-22' }),
      conv('other-workspace', {
        workspaceId: 'ws-b' as Conversation['workspaceId'],
        lastMessageAt: '2026-09-24',
      }),
      conv('archived', { archivedAt: '2026-09-24' }),
      conv('group', { collaborationKind: 'group' }),
      conv('model', { track: 'model' }),
      conv('other-agent', { targetRef: 'b' }),
    ];
    expect(agentChatHistory(list, 'ws-a', 'a').map((c) => c.id)).toEqual(['latest', 'old']);
    expect(agentChatHistory(list, 'ws-c', 'a')).toEqual([]);
  });
  it('keeps identity activations independent across workspaces', () => {
    expect(isAgentActive(agent, 'ws-a', {})).toBe(true);
    const scoped = { ...agent, availabilityScope: 'workspace' as const };
    expect(isAgentActive(scoped, 'ws-a', { 'a:ws-a': true, 'a:ws-b': true })).toBe(true);
    expect(isAgentActive(scoped, 'ws-b', { 'a:ws-a': true, 'a:ws-b': true })).toBe(true);
    expect(isAgentActive(scoped, 'ws-c', { 'a:ws-a': true })).toBe(false);
    expect(isAgentActive({ ...agent, enabled: false }, 'ws-a', {})).toBe(false);
  });
  it('persists mode and workspace-local groups without touching conversations', () => {
    expect(readSidebarMode()).toBe('conversations');
    writeSidebarMode('agents');
    expect(readSidebarMode()).toBe('agents');
    writeAgentContactGroups('ws-a', [{ id: 'g', name: '产品组', agentIds: ['a', 'a'] }]);
    expect(readAgentContactGroups('ws-a')[0]?.agentIds).toEqual(['a']);
    expect(readAgentContactGroups('ws-b')).toEqual([]);
    localStorage.setItem('sync-think.agent-contact-groups.v1:ws-a', '{broken');
    expect(readAgentContactGroups('ws-a')).toEqual([]);
  });
});

describe('multi-workspace activation', () => {
  const api = () => ({
    setGlobalAgentWorkspaceActivation: vi.fn().mockResolvedValue({}),
    updateGlobalAgent: vi.fn().mockResolvedValue({}),
  });
  it('retains every other workspace before switching a global agent to explicit activation', async () => {
    const runtime = api();
    await setAgentWorkspaceActive(runtime, agent, workspaces, 'ws-a', false);
    expect(runtime.setGlobalAgentWorkspaceActivation.mock.calls.map(([v]) => v)).toEqual([
      { agentId: 'a', workspaceId: 'ws-b', active: true },
      { agentId: 'a', workspaceId: 'ws-c', active: true },
      { agentId: 'a', workspaceId: 'ws-a', active: false },
    ]);
    expect(runtime.updateGlobalAgent).toHaveBeenCalledWith({
      agentId: 'a',
      availabilityScope: 'workspace',
    });
    expect(runtime.updateGlobalAgent.mock.invocationCallOrder[0]).toBeGreaterThan(
      runtime.setGlobalAgentWorkspaceActivation.mock.invocationCallOrder[2]!,
    );
  });
  it('does not narrow global availability if one write fails', async () => {
    const runtime = api();
    runtime.setGlobalAgentWorkspaceActivation.mockRejectedValueOnce(new Error('offline'));
    await expect(
      setAgentWorkspaceActive(runtime, agent, workspaces, 'ws-a', false),
    ).rejects.toThrow('offline');
    expect(runtime.updateGlobalAgent).not.toHaveBeenCalled();
  });
  it('activates a second workspace without changing the first or overwriting agent configuration', async () => {
    const runtime = api();
    await setAgentWorkspaceActive(
      runtime,
      { ...agent, availabilityScope: 'workspace' },
      workspaces,
      'ws-b',
      true,
    );
    expect(runtime.setGlobalAgentWorkspaceActivation).toHaveBeenCalledTimes(1);
    expect(runtime.setGlobalAgentWorkspaceActivation).toHaveBeenCalledWith({
      agentId: 'a',
      workspaceId: 'ws-b',
      active: true,
    });
    expect(runtime.updateGlobalAgent).not.toHaveBeenCalled();
  });
  it('global activation includes future workspaces', async () => {
    const runtime = api();
    await setAgentGloballyActive(runtime, agent, workspaces, true);
    expect(runtime.updateGlobalAgent).toHaveBeenCalledWith({
      agentId: 'a',
      availabilityScope: 'global',
    });
  });
});


describe('activation write boundaries', () => {
  it('skips the projectless scope in global activation and workspace narrowing', async () => {
    const runtime = { updateGlobalAgent: vi.fn(async () => ({})), setGlobalAgentWorkspaceActivation: vi.fn(async () => ({})) };
    const scopes = [...workspaces, projectlessWorkspace];
    await setAgentGloballyActive(runtime, agent, scopes, true);
    expect(runtime.setGlobalAgentWorkspaceActivation.mock.calls).toHaveLength(3);
    expect(runtime.setGlobalAgentWorkspaceActivation).not.toHaveBeenCalledWith(expect.objectContaining({ workspaceId: PROJECTLESS_SCOPE }));
    runtime.setGlobalAgentWorkspaceActivation.mockClear();
    await setAgentWorkspaceActive(runtime, agent, scopes, 'ws-a', false);
    expect(runtime.setGlobalAgentWorkspaceActivation.mock.calls).toHaveLength(3);
    expect(runtime.setGlobalAgentWorkspaceActivation).not.toHaveBeenCalledWith(expect.objectContaining({ workspaceId: PROJECTLESS_SCOPE }));
  });
  it('rejects a virtual activation target before making any writes', async () => {
    const runtime = { updateGlobalAgent: vi.fn(async () => ({})), setGlobalAgentWorkspaceActivation: vi.fn(async () => ({})) };
    await expect(setAgentWorkspaceActive(runtime, agent, [...workspaces, projectlessWorkspace], PROJECTLESS_SCOPE, true)).rejects.toThrow('请选择一个真实工作区');
    expect(runtime.setGlobalAgentWorkspaceActivation).not.toHaveBeenCalled();
    expect(runtime.updateGlobalAgent).not.toHaveBeenCalled();
  });
});
