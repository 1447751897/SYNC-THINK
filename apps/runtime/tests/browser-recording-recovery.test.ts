import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabaseAsync, runMigrations, SqliteBrowserStore } from '@sync-think/storage';
import type { BrowserHostLike } from '@sync-think/workers';
import { openPersistentRuntime } from '../src/persistence.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('persistent Browser recording recovery', () => {
  it('interrupts active recordings and cleans exact or orphaned Profile resources before startup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-recording-recovery-'));
    tempDirs.push(root);
    const dbPath = join(root, 'sync-think.db');
    await runMigrations(dbPath);
    const setup = await openDatabaseAsync({ path: dbPath });
    const setupStore = new SqliteBrowserStore(setup.raw);
    const leased = setupStore.createRecording({
      id: 'recording-recovery-leased',
      profileId: 'default',
      ownerId: 'recording:recording-recovery-leased',
      expectedProfileRevision: 1,
    });
    setupStore.markRecordingStarted({
      id: leased.id,
      leaseId: 'lease-recovery-leased',
      pageId: 'page-recovery-leased',
    });
    const orphanProfile = setupStore.createProfile({
      id: 'profile-recovery-orphan',
      name: 'Recovery orphan',
    });
    setupStore.createRecording({
      id: 'recording-recovery-orphan',
      profileId: orphanProfile.id,
      ownerId: 'recording:recording-recovery-orphan',
      expectedProfileRevision: orphanProfile.revision,
    });
    setup.raw.close();

    const host: BrowserHostLike = {
      acquireLease: vi.fn(async () => {
        throw new Error('not used');
      }),
      inspectLease: vi.fn(async () => {
        throw new Error('not used');
      }),
      recoverLease: vi.fn(async (input) => input),
      execute: vi.fn(async () => {
        throw new Error('not used');
      }),
      startRecording: vi.fn(async () => undefined),
      stopRecording: vi.fn(async () => undefined),
      releaseLease: vi.fn(async () => undefined),
      closeProfileSession: vi.fn(async () => undefined),
      hasActiveProfileLeases: vi.fn(() => false),
      shutdown: vi.fn(async () => undefined),
    };

    const session = await openPersistentRuntime({
      dbPath,
      installId: 'browser-recording-recovery',
      allowNoToken: true,
      secureStoreKeyPath: join(root, 'secure-store', 'test-key.bin'),
      browserHost: host,
    });
    try {
      const verification = await openDatabaseAsync({ path: dbPath });
      try {
        const store = new SqliteBrowserStore(verification.raw);
        expect(store.listActiveRecordings()).toEqual([]);
        expect(store.getRecording(leased.id)).toMatchObject({
          status: 'interrupted',
          stopReason: 'runtime_restarted',
          errorCode: 'browser.recording-runtime-restarted',
        });
        expect(store.getRecording('recording-recovery-orphan')).toMatchObject({
          status: 'interrupted',
          stopReason: 'runtime_restarted',
        });
      } finally {
        verification.raw.close();
      }
      expect(host.recoverLease).toHaveBeenCalledWith({
        leaseId: 'lease-recovery-leased',
        pageId: 'page-recovery-leased',
        profileId: 'default',
        ownerId: 'recording:recording-recovery-leased',
      });
      expect(host.stopRecording).toHaveBeenCalledWith('lease-recovery-leased');
      expect(host.releaseLease).toHaveBeenCalledWith('lease-recovery-leased', {
        closePage: true,
      });
      expect(host.closeProfileSession).toHaveBeenCalledWith(orphanProfile.id);
    } finally {
      await session.close();
    }
  });
});
