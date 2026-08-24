import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelId } from '@sync-think/shared';
import { openDatabaseAsync } from './connection.js';
import { SqliteConversationStore } from './conversation-store.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function openStore() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-conversation-'));
  tempDirs.push(dir);
  const path = join(dir, 'sync-think.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  return {
    store: new SqliteConversationStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

describe('SqliteConversationStore context window override', () => {
  it('persists a conversation override and clears it back to the model default', async () => {
    const { store, close } = await openStore();
    try {
      const conversation = store.create({
        target: { track: 'model', modelId: 'model-gpt' as ModelId },
        now: '2026-08-23T00:00:00.000Z',
      });

      expect(conversation.contextWindowOverride).toBeUndefined();

      const updated = store.setContextWindowOverride(
        conversation.id,
        256_000,
        '2026-08-23T00:01:00.000Z',
      );
      expect(updated.contextWindowOverride).toBe(256_000);
      expect(store.get(conversation.id)?.contextWindowOverride).toBe(256_000);

      const cleared = store.setContextWindowOverride(
        conversation.id,
        null,
        '2026-08-23T00:02:00.000Z',
      );
      expect(cleared.contextWindowOverride).toBeUndefined();
      expect(store.get(conversation.id)?.contextWindowOverride).toBeUndefined();
    } finally {
      close();
    }
  });
});
