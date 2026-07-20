import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentId, CredentialGroupId, ModelId } from '@sync-think/shared';
import { openDatabaseAsync } from './connection.js';
import { SqliteAgentStore } from './agent-store.js';
import { SqliteGroupStore } from './group-store.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-group-store-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

function createAgent(store: SqliteAgentStore, agentId: string, name: string) {
  return store.createAgent({
    agentId: agentId as AgentId,
    name,
    role: name.toLowerCase(),
    developerInstructions: `${name} instructions`,
    inputContract: 'subtask packet',
    outputContract: 'handoff result',
    defaultModelId: `model-${agentId}` as ModelId,
    defaultCredentialGroupId: 'credential-group-main' as CredentialGroupId,
  });
}

describe('SqliteGroupStore', () => {
  it('persists exactly one lead and every member responsibility across reopen', async () => {
    const dbPath = makeDbPath();
    await runMigrations(dbPath);

    let groupId = '';
    let leadVersionId = '';
    let coderVersionId = '';
    {
      const connection = await openDatabaseAsync({ path: dbPath });
      const agents = new SqliteAgentStore(connection.raw);
      const groups = new SqliteGroupStore(connection.raw);
      const lead = createAgent(agents, 'agent-architect', 'Architect');
      const coder = createAgent(agents, 'agent-coder', 'Coder');
      leadVersionId = lead.id;
      coderVersionId = coder.id;

      const created = groups.create({
        name: '全栈特攻队',
        description: '分析、编码与审查协同',
        kind: 'fixed',
        leadAgentVersionId: lead.id,
        approvalMode: 'full',
        collaborationMode: 'parallel',
        maxConcurrency: 3,
        members: [
          { agentVersionId: lead.id, responsibility: '拆分任务并统一总结' },
          { agentVersionId: coder.id, responsibility: '实现代码并回传结果' },
        ],
        now: '2026-07-18T01:00:00.000Z',
      });
      groupId = created.id;

      expect(created.leadAgentVersionId).toBe(lead.id);
      expect(created.members).toEqual([
        expect.objectContaining({ agentVersionId: lead.id, responsibility: '拆分任务并统一总结' }),
        expect.objectContaining({ agentVersionId: coder.id, responsibility: '实现代码并回传结果' }),
      ]);
      expect(created.version).toBe(1);
      connection.raw.close();
    }

    {
      const connection = await openDatabaseAsync({ path: dbPath });
      const groups = new SqliteGroupStore(connection.raw);
      const restored = groups.get(groupId);
      expect(restored).toMatchObject({
        id: groupId,
        name: '全栈特攻队',
        leadAgentVersionId: leadVersionId,
        approvalMode: 'full',
        collaborationMode: 'parallel',
        maxConcurrency: 3,
      });
      expect(restored?.members.map((member) => member.agentVersionId)).toEqual([
        leadVersionId,
        coderVersionId,
      ]);
      connection.raw.close();
    }
  });

  it('rejects a missing/duplicate lead, blank responsibility, and stale updates', async () => {
    const dbPath = makeDbPath();
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const agents = new SqliteAgentStore(connection.raw);
    const groups = new SqliteGroupStore(connection.raw);
    try {
      const lead = createAgent(agents, 'agent-lead', 'Lead');
      const coder = createAgent(agents, 'agent-member', 'Member');

      expect(() =>
        groups.create({
          name: 'Missing Lead',
          kind: 'fixed',
          leadAgentVersionId: lead.id,
          members: [{ agentVersionId: coder.id, responsibility: '执行' }],
        }),
      ).toThrow(/lead.*member/i);

      expect(() =>
        groups.create({
          name: 'Blank Responsibility',
          kind: 'fixed',
          leadAgentVersionId: lead.id,
          members: [
            { agentVersionId: lead.id, responsibility: '统筹' },
            { agentVersionId: coder.id, responsibility: '   ' },
          ],
        }),
      ).toThrow(/responsibility/i);

      const created = groups.create({
        name: 'Valid Group',
        kind: 'fixed',
        leadAgentVersionId: lead.id,
        members: [
          { agentVersionId: lead.id, responsibility: '统筹' },
          { agentVersionId: coder.id, responsibility: '执行' },
        ],
      });
      groups.update({
        groupId: created.id,
        expectedVersion: 1,
        description: 'updated',
      });
      expect(() =>
        groups.update({
          groupId: created.id,
          expectedVersion: 1,
          description: 'stale',
        }),
      ).toThrow(/version conflict/i);
    } finally {
      connection.raw.close();
    }
  });

  it('follows the latest Agent version without removing and re-adding the member', async () => {
    const dbPath = makeDbPath();
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const agents = new SqliteAgentStore(connection.raw);
    const groups = new SqliteGroupStore(connection.raw);
    try {
      const lead = createAgent(agents, 'agent-follow-lead', 'Lead v1');
      const worker = createAgent(agents, 'agent-follow-worker', 'Worker');
      const group = groups.create({
        name: 'Follow latest group',
        kind: 'fixed',
        leadAgentVersionId: lead.id,
        members: [
          { agentVersionId: lead.id, responsibility: '统筹和最终交付' },
          { agentVersionId: worker.id, responsibility: '执行实现' },
        ],
      });
      const leadV2 = agents.updateDefinition({
        agentId: lead.agentId,
        name: 'Lead v2',
      });

      const affected = groups.followLatestAgentVersion(lead.agentId, leadV2.id);
      expect(affected).toHaveLength(1);
      const updated = groups.get(group.id)!;
      expect(updated.leadAgentVersionId).toBe(leadV2.id);
      expect(updated.members).toEqual([
        expect.objectContaining({
          agentVersionId: leadV2.id,
          responsibility: '统筹和最终交付',
        }),
        expect.objectContaining({
          agentVersionId: worker.id,
          responsibility: '执行实现',
        }),
      ]);
      expect(updated.version).toBe(2);
    } finally {
      connection.raw.close();
    }
  });
});
