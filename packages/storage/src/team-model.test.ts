import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentId, ConversationId, ModelId, TaskId, TeamId } from '@sync-think/shared';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteGlobalAgentStore } from './global-agent-store.js';
import { SqliteTeamStore } from './team-store.js';
import { SqliteConversationStore } from './conversation-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-team-model-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

async function openStores() {
  const dbPath = makeDbPath();
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    agents: new SqliteGlobalAgentStore(connection.raw),
    teams: new SqliteTeamStore(connection.raw),
    conversations: new SqliteConversationStore(connection.raw),
    raw: connection.raw,
    close: () => connection.raw.close(),
  };
}

const MODEL = 'model-sonnet' as ModelId;

describe('SqliteGlobalAgentStore (mutable model)', () => {
  it('creates, updates in place, and lists without version chains', async () => {
    const { agents, close } = await openStores();
    try {
      const created = agents.create({ name: '前端小张', defaultModelId: MODEL, persona: '改前端' });
      expect(created.persona).toBe('改前端');

      const updated = agents.update({ agentId: created.id, persona: '改前端和测试' });
      expect(updated.id).toBe(created.id);
      expect(updated.persona).toBe('改前端和测试');
      // Same row mutated — list still has exactly one record.
      expect(agents.list()).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('hides archived agents from the default list', async () => {
    const { agents, close } = await openStores();
    try {
      const a = agents.create({ name: 'A', defaultModelId: MODEL });
      agents.create({ name: 'B', defaultModelId: MODEL });
      agents.update({ agentId: a.id, archived: true });
      expect(agents.list().map((x) => x.name)).toEqual(['B']);
      expect(agents.list({ includeArchived: true })).toHaveLength(2);
    } finally {
      close();
    }
  });

  it('refuses to delete an agent still on a team roster', async () => {
    const { agents, teams, close } = await openStores();
    try {
      const a = agents.create({ name: 'A', defaultModelId: MODEL });
      teams.create({ name: '交付小队', members: [{ agentId: a.id }] });
      expect(() => agents.delete(a.id)).toThrow(/member of team/);
    } finally {
      close();
    }
  });
});

describe('SqliteTeamStore (mutable model + run snapshot)', () => {
  it('creates a team with an ordered roster and validates dependencies', async () => {
    const { agents, teams, close } = await openStores();
    try {
      const arch = agents.create({ name: '架构师', defaultModelId: MODEL });
      const builder = agents.create({ name: '前端小张', defaultModelId: MODEL });
      const team = teams.create({
        name: '交付小队',
        strategy: 'serial',
        coordinatorAgentId: arch.id,
        members: [
          { agentId: arch.id, role: 'pm', title: '梳理边界' },
          { agentId: builder.id, role: 'builder', title: '改代码', dependsOn: [arch.id] },
        ],
      });
      expect(team.members.map((m) => m.memberOrder)).toEqual([0, 1]);
      expect(team.members[1].dependsOn).toEqual([arch.id]);

      expect(() =>
        teams.create({
          name: 'bad',
          members: [{ agentId: builder.id, dependsOn: ['agent-nope' as AgentId] }],
        }),
      ).toThrow(/depends on non-member/);
      expect(() =>
        teams.create({
          name: 'bad2',
          coordinatorAgentId: arch.id,
          members: [{ agentId: builder.id }],
        }),
      ).toThrow(/must be a team member/);
    } finally {
      close();
    }
  });

  it('edits are plain updates and only affect the NEXT run (snapshot freeze)', async () => {
    const { agents, teams, conversations, close } = await openStores();
    try {
      const a = agents.create({ name: 'A', defaultModelId: MODEL });
      const b = agents.create({ name: 'B', defaultModelId: MODEL });
      const team = teams.create({ name: '小队', members: [{ agentId: a.id, title: '干活' }] });
      const conv = conversations.create({ target: { track: 'team', teamId: team.id } });

      const run = teams.startRun({ teamId: team.id, conversationId: conv.id });
      expect(run.rosterSnapshot.members.map((m) => m.agentId)).toEqual([a.id]);

      // Mutate the team mid-run: swap the roster entirely.
      teams.update({ teamId: team.id, members: [{ agentId: b.id, title: '接手' }] });

      // The in-flight run still sees the frozen roster.
      const reread = teams.getRun(run.id);
      expect(reread?.rosterSnapshot.members.map((m) => m.agentId)).toEqual([a.id]);

      // A new run picks up the edited roster.
      teams.setRunStatus(run.id, 'completed');
      const run2 = teams.startRun({ teamId: team.id, conversationId: conv.id });
      expect(run2.rosterSnapshot.members.map((m) => m.agentId)).toEqual([b.id]);
    } finally {
      close();
    }
  });

  it('refuses hard delete while running or with history', async () => {
    const { agents, teams, conversations, close } = await openStores();
    try {
      const a = agents.create({ name: 'A', defaultModelId: MODEL });
      const team = teams.create({ name: '小队', members: [{ agentId: a.id }] });
      const conv = conversations.create({ target: { track: 'team', teamId: team.id } });
      const run = teams.startRun({ teamId: team.id, conversationId: conv.id });
      expect(() => teams.delete(team.id)).toThrow(/running run/);
      teams.setRunStatus(run.id, 'completed');
      expect(() => teams.delete(team.id)).toThrow(/historical runs/);

      const empty = teams.create({ name: '空队', members: [{ agentId: a.id }] });
      teams.delete(empty.id);
      expect(teams.get(empty.id)).toBeUndefined();
    } finally {
      close();
    }
  });
});

describe('SqliteConversationStore (first-class conversations)', () => {
  it('lists per track with pinned-first ordering', async () => {
    const { conversations, close } = await openStores();
    try {
      const c1 = conversations.create({
        target: { track: 'model', modelId: MODEL },
        title: '旧的',
        now: '2026-07-20T00:00:00.000Z',
      });
      const c2 = conversations.create({
        target: { track: 'model', modelId: MODEL },
        title: '新的',
        now: '2026-07-21T00:00:00.000Z',
      });
      conversations.create({
        target: { track: 'agent', agentId: 'agent-x' as AgentId },
        title: '智能体的',
      });

      // Recency first without pins…
      expect(conversations.list({ track: 'model' }).map((c) => c.title)).toEqual(['新的', '旧的']);
      // …pin the old one and it jumps to the top of ITS track only.
      conversations.setPinned(c1.id, true);
      expect(conversations.list({ track: 'model' }).map((c) => c.title)).toEqual(['旧的', '新的']);
      expect(conversations.list({ track: 'agent' })).toHaveLength(1);

      conversations.setArchived(c2.id, true);
      expect(conversations.list({ track: 'model' }).map((c) => c.title)).toEqual(['旧的']);
    } finally {
      close();
    }
  });

  it('upgrades model-direct chats only, preserving identity', async () => {
    const { conversations, close } = await openStores();
    try {
      const conv = conversations.create({ target: { track: 'model', modelId: MODEL } });
      const upgraded = conversations.upgradeTrack(conv.id, {
        track: 'team',
        teamId: 'team-t1' as TeamId,
      });
      expect(upgraded.id).toBe(conv.id);
      expect(upgraded.track).toBe('team');
      expect(() =>
        conversations.upgradeTrack(upgraded.id, { track: 'agent', agentId: 'agent-a' as AgentId }),
      ).toThrow(/only model-direct/);
    } finally {
      close();
    }
  });

  it('rebinds the target within the same track and across tracks', async () => {
    const { conversations, close } = await openStores();
    try {
      const conv = conversations.create({ target: { track: 'agent', agentId: 'agent-a' as AgentId } });

      // Same-track retarget: agent → another agent.
      const swapped = conversations.rebindTarget(conv.id, 'agent', 'agent-b');
      expect(swapped.id).toBe(conv.id);
      expect(swapped.track).toBe('agent');
      expect(swapped.targetRef).toBe('agent-b');

      // Cross-track: agent → team, then back down team → model (no direction limits).
      const teamBound = conversations.rebindTarget(conv.id, 'team', 'team-t1');
      expect(teamBound.track).toBe('team');
      expect(teamBound.targetRef).toBe('team-t1');
      const modelBound = conversations.rebindTarget(conv.id, 'model', MODEL);
      expect(modelBound.track).toBe('model');
      expect(modelBound.targetRef).toBe(MODEL);
      // updated_at moves with the rebind.
      expect(modelBound.updatedAt >= conv.updatedAt).toBe(true);

      // Guards: empty targetRef and unknown conversation both throw.
      expect(() => conversations.rebindTarget(conv.id, 'agent', '   ')).toThrow(/non-empty/);
      expect(() =>
        conversations.rebindTarget('conv-missing' as ConversationId, 'agent', 'agent-a'),
      ).toThrow(/not found/);
    } finally {
      close();
    }
  });

  it('tracks the conversation-level permission mode as the only knob', async () => {
    const { conversations, close } = await openStores();
    try {
      const conv = conversations.create({ target: { track: 'model', modelId: MODEL } });
      expect(conv.executionMode).toBe('full-access');
      const updated = conversations.setExecutionMode(conv.id, 'full-access');
      expect(updated.executionMode).toBe('full-access');
    } finally {
      close();
    }
  });

  it('binds a task lazily and stays idempotent (one task per conversation)', async () => {
    const { conversations, close } = await openStores();
    try {
      const conv = conversations.create({ target: { track: 'model', modelId: MODEL } });
      expect(conv.taskId).toBeUndefined();
      const bound = conversations.bindTask(conv.id, 'task-1' as TaskId);
      expect(bound.taskId).toBe('task-1');
      // Re-reading persists the binding.
      expect(conversations.get(conv.id)?.taskId).toBe('task-1');
      // Idempotent for the same task; rejects a different task.
      expect(conversations.bindTask(conv.id, 'task-1' as TaskId).taskId).toBe('task-1');
      expect(() => conversations.bindTask(conv.id, 'task-2' as TaskId)).toThrow(/already bound/);
    } finally {
      close();
    }
  });

  it('rejects unknown ids with clear errors', async () => {
    const { conversations, close } = await openStores();
    try {
      expect(() => conversations.setPinned('conv-none' as ConversationId, true)).toThrow(
        /not found/,
      );
    } finally {
      close();
    }
  });
});

describe('migration 0024 seeding', () => {
  it('seeds mutable agent rows from the latest agent_version per agent', async () => {
    const dbPath = makeDbPath();
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    try {
      // Simulate a legacy chain: two versions of one agent, then re-run the
      // seeding SELECT used by the migration to confirm it picks MAX(version).
      connection.raw
        .prepare(
          `INSERT INTO agent_version (
             id, agent_id, version, name, description, role, developer_instructions,
             input_contract, output_contract, default_model_id, default_credential_group_id,
             created_at
           ) VALUES (?, ?, ?, ?, '', 'builder', ?, '', '', ?, 'credential-group-unassigned', ?)`,
        )
        .run('av-1', 'agent-legacy', 1, '旧名', '旧人设', MODEL, '2026-07-01T00:00:00.000Z');
      connection.raw
        .prepare(
          `INSERT INTO agent_version (
             id, agent_id, version, name, description, role, developer_instructions,
             input_contract, output_contract, default_model_id, default_credential_group_id,
             created_at
           ) VALUES (?, ?, ?, ?, '', 'builder', ?, '', '', ?, 'credential-group-unassigned', ?)`,
        )
        .run('av-2', 'agent-legacy', 2, '新名', '新人设', MODEL, '2026-07-02T00:00:00.000Z');

      const seeded = connection.raw
        .prepare(
          `SELECT av.name, av.developer_instructions AS persona FROM agent_version av
           WHERE av.agent_id = 'agent-legacy' AND av.version = (
             SELECT MAX(v2.version) FROM agent_version v2 WHERE v2.agent_id = av.agent_id
           )`,
        )
        .get() as { name: string; persona: string };
      expect(seeded).toEqual({ name: '新名', persona: '新人设' });
    } finally {
      connection.raw.close();
    }
  });
});
