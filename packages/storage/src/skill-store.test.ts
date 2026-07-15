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

});
