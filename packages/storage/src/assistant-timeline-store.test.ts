import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { SqliteAssistantTimelineStore } from './assistant-timeline-store.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function openStore() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-assistant-timeline-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    store: new SqliteAssistantTimelineStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

function segment(sequence: number, text = `segment-${sequence}`) {
  return {
    id: `segment-${sequence}`,
    sequence,
    value: {
      id: `segment-${sequence}`,
      sequence,
      kind: 'thinking',
      text,
      status: 'completed',
    },
  };
}

describe('SqliteAssistantTimelineStore', () => {
  it('retains every segment beyond the compact chat-message limit and pages in order', async () => {
    const { store, close } = await openStore();
    try {
      store.upsertSegments(
        'run-long',
        Array.from({ length: 157 }, (_, sequence) => segment(sequence)),
      );

      const first = store.listSegments('run-long', { limit: 64 });
      expect(first.totalSegments).toBe(157);
      expect(first.segments.map((item) => item.sequence)).toEqual(
        Array.from({ length: 64 }, (_, sequence) => sequence),
      );
      expect(first.nextCursor).toBeTruthy();

      const second = store.listSegments('run-long', {
        limit: 64,
        cursor: first.nextCursor,
      });
      const third = store.listSegments('run-long', {
        limit: 64,
        cursor: second.nextCursor,
      });
      const all = [...first.segments, ...second.segments, ...third.segments];
      expect(all).toHaveLength(157);
      expect(all.map((item) => item.id)).toEqual(
        Array.from({ length: 157 }, (_, sequence) => `segment-${sequence}`),
      );
      expect(third.nextCursor).toBeUndefined();
    } finally {
      close();
    }
  });

  it('updates a streaming segment in place while retaining segments evicted from live memory', async () => {
    const { store, close } = await openStore();
    try {
      store.upsertSegments(
        'run-streaming',
        Array.from({ length: 512 }, (_, sequence) => segment(sequence)),
      );
      store.upsertSegments(
        'run-streaming',
        Array.from({ length: 512 }, (_, index) => segment(index + 128)),
      );
      store.upsertSegments('run-streaming', [segment(639, 'completed-tail')]);

      const seen = [];
      let cursor: string | undefined;
      do {
        const page = store.listSegments('run-streaming', { limit: 100, cursor });
        seen.push(...page.segments);
        cursor = page.nextCursor;
      } while (cursor);

      expect(seen).toHaveLength(640);
      expect(seen[0]?.id).toBe('segment-0');
      expect(seen.at(-1)?.value).toMatchObject({ text: 'completed-tail' });
    } finally {
      close();
    }
  });
});
