import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteSkillStore } from './skill-store.js';
import {
  DEFAULT_CONVERSATION_AGENT_ID,
  SqliteAgentStore,
} from './agent-store.js';
import { SqliteGlobalAgentStore } from './global-agent-store.js';
import { SqliteApprovalStore } from './approval-store.js';
import type { WorkspaceId } from '@sync-think/shared';
import type { ModelId } from '@sync-think/shared';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-skill-store-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

async function openStores() {
  const dbPath = makeDbPath();
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    skillStore: new SqliteSkillStore(connection.raw),
    agentStore: new SqliteAgentStore(connection.raw),
    globalAgentStore: new SqliteGlobalAgentStore(connection.raw),
    approvalStore: new SqliteApprovalStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

describe('SqliteSkillStore', () => {
  it('imports a skill version and lists it', async () => {
    const { skillStore, close } = await openStores();
    try {
      const v = skillStore.importVersion({
        name: 'minimal',
        description: 'A minimal skill',
        version: '0.1.0',
        sourceMd: '---\nname: minimal\n---\nbody',
        body: 'body',
        allowedTools: [],
        contentFingerprint: 'deadbeef',
        hasScripts: false,
        warnings: [],
        now: '2026-07-12T04:00:00.000Z',
      });
      expect(v.name).toBe('minimal');
      expect(v.version).toBe('0.1.0');
      expect(v.contentFingerprint).toBe('deadbeef');
      expect(v.skillId).toMatch(/^skill-/);
      expect(skillStore.listVersions()).toHaveLength(1);
      expect(skillStore.getVersion(v.id)?.id).toBe(v.id);
    } finally {
      close();
    }
  });

  it('lists picker metadata without selecting full source or body fields', async () => {
    const { skillStore, close } = await openStores();
    try {
      const skill = skillStore.importVersion({
        name: 'metadata-only',
        description: 'Picker row',
        version: '1.0.0',
        sourceMd: 'FULL_SOURCE_MUST_STAY_LAZY',
        body: 'FULL_BODY_MUST_STAY_LAZY',
        contentFingerprint: 'metadata-fingerprint',
      });
      const rows = skillStore.listVersionMetadata();
      expect(rows).toEqual([
        expect.objectContaining({ id: skill.id, contentFingerprint: 'metadata-fingerprint' }),
      ]);
      expect('sourceMd' in rows[0]!).toBe(false);
      expect('body' in rows[0]!).toBe(false);
      expect(JSON.stringify(rows)).not.toContain('FULL_BODY_MUST_STAY_LAZY');
    } finally {
      close();
    }
  });

  it('loads exact equipped metadata even when a version falls outside the catalog limit', async () => {
    const { skillStore, close } = await openStores();
    try {
      const equipped = skillStore.importVersion({
        name: 'equipped-old-version',
        description: 'Pinned by an Agent',
        version: '1.0.0',
        sourceMd: 'EQUIPPED_SOURCE_STAYS_LAZY',
        body: 'EQUIPPED_BODY_STAYS_LAZY',
        contentFingerprint: 'equipped-old-fingerprint',
        now: '2026-07-28T00:00:00.000Z',
      });
      for (let index = 0; index < 500; index += 1) {
        skillStore.importVersion({
          name: `newer-${index}`,
          description: 'Newer catalog entry',
          version: '1.0.0',
          sourceMd: `source-${index}`,
          body: `body-${index}`,
          contentFingerprint: `newer-fingerprint-${index}`,
          now: `2026-07-29T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
        });
      }

      expect(skillStore.listVersionMetadata(500).some((row) => row.id === equipped.id)).toBe(
        false,
      );
      const exact = skillStore.listVersionMetadataByIds([equipped.id]);
      expect(exact.map((row) => row.id)).toEqual([equipped.id]);
      expect(JSON.stringify(exact)).not.toContain('EQUIPPED_BODY_STAYS_LAZY');
    } finally {
      close();
    }
  });

  it('is content-addressed (same fingerprint returns existing row)', async () => {
    const { skillStore, close } = await openStores();
    try {
      const a = skillStore.importVersion({
        name: 'minimal',
        description: 'd',
        version: '0.1.0',
        sourceMd: 'src',
        body: 'body',
        contentFingerprint: 'fp-1',
      });
      const b = skillStore.importVersion({
        name: 'minimal',
        description: 'd',
        version: '0.1.0',
        sourceMd: 'src',
        body: 'body',
        contentFingerprint: 'fp-1',
      });
      expect(b.id).toBe(a.id);
      expect(skillStore.listVersions()).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('agent updateBinding can set skill allowlist (new version)', async () => {
    const { skillStore, agentStore, close } = await openStores();
    try {
      const skill = skillStore.importVersion({
        name: 'minimal',
        description: 'd',
        version: '0.1.0',
        sourceMd: 'src',
        body: 'body',
        contentFingerprint: 'fp-allow',
        allowedTools: ['read-file'],
      });
      agentStore.ensureConversationAgent({
        defaultModelId: 'model-a' as ModelId,
      });
      const updated = agentStore.updateBinding({
        agentId: DEFAULT_CONVERSATION_AGENT_ID,
        defaultModelId: 'model-a' as ModelId,
        fallbackModelIds: [],
        skillVersionIds: [skill.id],
      });
      expect(updated.skillVersionIds).toEqual([skill.id]);
      expect(updated.version).toBe(2);
    } finally {
      close();
    }
  });

  it('findLatestByName returns previous version excluding fingerprint', async () => {
    const { skillStore, close } = await openStores();
    try {
      const v1 = skillStore.importVersion({
        name: 'upgrade-diff',
        description: 'base',
        version: '0.1.0',
        sourceMd: 'v1',
        body: 'body',
        allowedTools: ['read-file'],
        contentFingerprint: 'fp-v1-aaaa',
        hasScripts: false,
        warnings: [],
        now: '2026-07-12T01:00:00.000Z',
      });
      const v2 = skillStore.importVersion({
        name: 'upgrade-diff',
        description: 'next',
        version: '0.2.0',
        sourceMd: 'v2',
        body: 'body',
        allowedTools: ['read-file', 'write-fs'],
        contentFingerprint: 'fp-v2-bbbb',
        hasScripts: false,
        warnings: [],
        now: '2026-07-12T02:00:00.000Z',
      });
      expect(skillStore.findLatestByName('upgrade-diff')?.id).toBe(v2.id);
      expect(skillStore.findLatestByName('upgrade-diff', { excludeFingerprint: v2.contentFingerprint })?.id).toBe(
        v1.id,
      );
    } finally {
      close();
    }
  });

  it('deletes an unreferenced version and refuses one equipped by a global agent', async () => {
    const { skillStore, globalAgentStore, close } = await openStores();
    try {
      const removable = skillStore.importVersion({
        name: 'removable',
        description: 'd',
        version: '0.1.0',
        sourceMd: 'src',
        body: 'body',
        contentFingerprint: 'fp-delete-free',
      });
      expect(skillStore.deleteVersion(removable.id)).toMatchObject({ deleted: true });
      expect(skillStore.listVersions().some((row) => row.id === removable.id)).toBe(false);
      expect(skillStore.getVersion(removable.id)?.archivedAt).toBeDefined();

      const equipped = skillStore.importVersion({
        name: 'equipped',
        description: 'd',
        version: '0.1.0',
        sourceMd: 'src',
        body: 'body',
        contentFingerprint: 'fp-delete-bound',
      });
      const agent = globalAgentStore.create({
        name: 'Reviewer',
        defaultModelId: 'model-a' as ModelId,
        skillIds: [equipped.id],
      });
      const blocked = skillStore.deleteVersion(equipped.id);
      expect(blocked.deleted).toBe(false);
      expect(blocked.blockers.globalAgentIds).toContain(agent.id);
      expect(skillStore.getVersion(equipped.id)).toBeDefined();

      globalAgentStore.update({
        agentId: agent.id,
        skillIds: [],
      });
      expect(skillStore.deleteVersion(equipped.id)).toMatchObject({ deleted: true });
      expect(skillStore.listVersions().some((row) => row.id === equipped.id)).toBe(false);
      expect(skillStore.getVersion(equipped.id)?.archivedAt).toBeDefined();
    } finally {
      close();
    }
  });

  it('blocks deletion while a permission approval for the version is pending', async () => {
    const { skillStore, approvalStore, close } = await openStores();
    try {
      const skill = skillStore.importVersion({
        name: 'pending-upgrade',
        description: 'd',
        version: '0.2.0',
        sourceMd: 'src',
        body: 'body',
        contentFingerprint: 'fp-delete-pending',
      });
      const approval = approvalStore.enqueue({
        workspaceId: 'ws-a' as WorkspaceId,
        kind: 'skill-permission',
        action: 'skill.permission-upgrade:pending-upgrade',
        metadata: { skillVersionId: skill.id },
      });
      const blocked = skillStore.deleteVersion(skill.id);
      expect(blocked.deleted).toBe(false);
      expect(blocked.blockers.pendingApprovalIds).toContain(approval.id);
      expect(skillStore.getVersion(skill.id)).toBeDefined();
    } finally {
      close();
    }
  });

});
