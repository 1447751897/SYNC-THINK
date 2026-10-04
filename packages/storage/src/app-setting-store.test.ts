import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, isAbsolute } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { SqliteAppSettingStore } from './app-setting-store.js';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    const target = realpathSync.native(root);
    const parent = realpathSync.native(tmpdir());
    const rel = relative(parent, target);
    if (
      dirname(target) !== parent ||
      !basename(target).startsWith('sync-think-setting-cas-') ||
      isAbsolute(rel) ||
      rel.startsWith('..')
    )
      throw new Error('Fixture cleanup escaped temp');
    rmSync(target, { recursive: true, force: true });
  }
});
describe('persistent setting compare-and-set', () => {
  it('admits only one sender against the same persisted evidence version across connections', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'sync-think-setting-cas-')));
    roots.push(root);
    const path = join(root, 'cas.sqlite');
    const first = await openDatabaseAsync({ path });
    const second = await openDatabaseAsync({ path });
    try {
      first.raw.exec(
        'CREATE TABLE app_setting(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL)',
      );
      const a = new SqliteAppSettingStore(first.raw);
      const b = new SqliteAppSettingStore(second.raw);
      const old = { outputs: [{ sha256: 'verified-file' }] };
      a.set('receipt', old);
      const beforeA = a.get('receipt')!.value;
      const beforeB = b.get('receipt')!.value;
      expect(
        a.compareAndSet('receipt', beforeA, {
          ...old,
          delivery: { state: 'sending', toolCallId: 'sender-a' },
        }),
      ).toBe(true);
      expect(
        b.compareAndSet('receipt', beforeB, {
          ...old,
          delivery: { state: 'sending', toolCallId: 'sender-b' },
        }),
      ).toBe(false);
      expect(b.get('receipt')!.value).toEqual({
        ...old,
        delivery: { state: 'sending', toolCallId: 'sender-a' },
      });
    } finally {
      second.raw.close();
      first.raw.close();
    }
  });
});
