import { describe, expect, it } from 'vitest';
import {
  createWebsiteCapabilitySession,
  demoKernels,
  parseCapabilityView,
} from './website-capability-state.js';

describe('website capability session', () => {
  it('limits page entry to the three supported views', () => {
    expect(parseCapabilityView('agents')).toBe('agents');
    expect(parseCapabilityView('teams')).toBe('teams');
    expect(parseCapabilityView('kernels')).toBe('kernels');
    expect(parseCapabilityView('https://example.com')).toBeNull();
    expect(parseCapabilityView(null)).toBeNull();
    expect(demoKernels.map((kernel) => kernel.kernelId)).toEqual([
      'native',
      'codex',
      'claude-code',
    ]);
  });
  it('supports agent creation, edits and deletion without changing another session', async () => {
    const session = createWebsiteCapabilitySession();
    const other = createWebsiteCapabilitySession();
    const original = session.getSnapshot();
    const { agent } = await session.runtime.createGlobalAgent({
      name: '测试助手',
      defaultModelId: original.agents[0].defaultModelId,
    });
    await session.runtime.updateGlobalAgent({
      agentId: agent.id,
      description: '修改说明',
      skillIds: ['demo-review'],
    });
    expect(session.getSnapshot().agents.at(-1)?.description).toBe('修改说明');
    expect(original.agents).toHaveLength(3);
    expect(other.getSnapshot().agents).toHaveLength(3);
    await session.runtime.deleteGlobalAgent({ agentId: agent.id });
    expect(session.getSnapshot().agents).toHaveLength(3);
  });
  it('keeps member roles and collaboration strategy editable, and protects referenced agents', async () => {
    const session = createWebsiteCapabilitySession();
    const { agents, teams } = session.getSnapshot();
    await expect(session.runtime.deleteGlobalAgent({ agentId: agents[0].id })).rejects.toThrow(
      '仍在小队',
    );
    await session.runtime.updateTeam({
      teamId: teams[0].id,
      strategy: 'parallel',
      members: [{ agentId: agents[0].id, role: 'researcher', title: '研究' }],
    });
    expect(session.getSnapshot().teams[0].strategy).toBe('parallel');
    expect(session.getSnapshot().teams[0].members[0].role).toBe('researcher');
    expect(teams[0].members).toHaveLength(3);
    const { team } = await session.runtime.createTeam({
      name: '新小队',
      members: [{ agentId: agents[1].id }],
    });
    expect(session.getSnapshot().teams).toHaveLength(2);
    await session.runtime.deleteTeam({ teamId: team.id });
    session.reset();
    expect(session.getSnapshot().teams[0].members).toHaveLength(3);
    expect(session.getSnapshot().teams[0].strategy).toBe('serial');
  });
  it('exposes only mock kernel updates and returns detached detection data', async () => {
    const session = createWebsiteCapabilitySession();
    const detected = await session.runtime.detectKernels();
    detected.kernels[0].installed = false;
    expect((await session.runtime.detectKernels()).kernels[0].installed).toBe(true);
    const result = await session.kernelUpdates.checkForUpdates();
    expect(result.ok).toBe(true);
    expect(result.state.items.every((item) => item.managedVersion === '0.0.0-demo')).toBe(true);
    result.state.items.length = 0;
    expect((await session.kernelUpdates.getState()).items).toHaveLength(2);
  });
});
