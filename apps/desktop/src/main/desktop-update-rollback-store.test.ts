import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DesktopUpdateRollbackStore,
  type DesktopUpdateHealthyRelease,
  type DesktopUpdateRollbackIntent,
} from './desktop-update-rollback-store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{ root: string; store: DesktopUpdateRollbackStore }> {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-update-rollback-store-'));
  temporaryDirectories.push(root);
  return { root, store: new DesktopUpdateRollbackStore(root) };
}

function healthy(root: string, version = '0.0.1'): DesktopUpdateHealthyRelease {
  return {
    schemaVersion: 1,
    version,
    registeredAt: '2026-08-02T08:00:00.000Z',
    installer: {
      path: join(root, 'installers', version, `SYNC-THINK-Setup-${version}-x64.exe`),
      bytes: 123,
      sha512: 'a'.repeat(128),
      signature: {
        status: 'valid',
        signerThumbprint: 'ABCDEF',
        timestampStatus: 'valid',
      },
    },
  };
}

function intent(root: string): DesktopUpdateRollbackIntent {
  return {
    schemaVersion: 1,
    intentId: 'intent-0001',
    createdAt: '2026-08-02T08:01:00.000Z',
    deadlineAt: '2026-08-02T08:04:00.000Z',
    previousVersion: '0.0.1',
    targetVersion: '0.0.2',
    targetDownloadedFile: null,
    targetExecutablePath: join(root, 'install', 'SYNC-THINK.exe'),
    previousRelease: healthy(root),
    healthMarkerPath: join(root, 'health', 'intent-0001.json'),
    watchdogReadyPath: join(root, 'watchdog-ready', 'intent-0001.json'),
    relaunchFencePath: join(root, 'relaunch', 'intent-0001.json'),
    attemptFencePath: join(root, 'attempts', 'intent-0001.json'),
    outcomePath: join(root, 'outcomes', 'intent-0001.json'),
    allowUnsignedFixture: false,
  };
}

describe('DesktopUpdateRollbackStore', () => {
  it('atomically persists and reads a version-scoped healthy release', async () => {
    const { root, store } = await fixture();
    const record = healthy(root);

    await store.writeHealthyRelease(record);

    await expect(store.readHealthyRelease('0.0.1')).resolves.toEqual(record);
    expect(JSON.parse(await readFile(store.healthyReleasePath('0.0.1'), 'utf8'))).toEqual(record);
  });

  it('publishes an active intent only after the durable intent record exists', async () => {
    const { root, store } = await fixture();
    const record = intent(root);

    await store.writeIntent(record);

    await expect(store.readIntent(record.intentId)).resolves.toEqual(record);
    await expect(store.readActiveIntent()).resolves.toEqual(record);
  });

  it('writes a target health marker and a one-shot attempt fence without overwriting it', async () => {
    const { root, store } = await fixture();
    const record = intent(root);
    await store.writeIntent(record);

    await store.writeHealthMarker({
      schemaVersion: 1,
      intentId: record.intentId,
      targetVersion: record.targetVersion,
      healthyAt: '2026-08-02T08:02:00.000Z',
    });
    await expect(store.readHealthMarker(record.intentId)).resolves.toMatchObject({
      intentId: record.intentId,
      targetVersion: '0.0.2',
    });

    await expect(
      store.createAttemptFence({
        schemaVersion: 1,
        intentId: record.intentId,
        attemptedAt: '2026-08-02T08:04:00.000Z',
      }),
    ).resolves.toBe(true);
    await expect(
      store.createAttemptFence({
        schemaVersion: 1,
        intentId: record.intentId,
        attemptedAt: '2026-08-02T08:05:00.000Z',
      }),
    ).resolves.toBe(false);
  });

  it('keeps only the configured newest healthy installer records', async () => {
    const { root, store } = await fixture();
    for (const version of ['0.0.1', '0.0.2', '0.0.3']) {
      await store.writeHealthyRelease(healthy(root, version));
    }

    const removed = await store.pruneHealthyReleases(2);

    expect(removed).toEqual(['0.0.1']);
    await expect(store.readHealthyRelease('0.0.1')).resolves.toBeNull();
    await expect(store.readHealthyRelease('0.0.2')).resolves.not.toBeNull();
    await expect(store.readHealthyRelease('0.0.3')).resolves.not.toBeNull();
  });
});
