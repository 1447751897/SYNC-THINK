import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DesktopUpdateRollbackCoordinator,
  recoveryInstallerPath,
  type DesktopUpdateInstallerVerification,
} from './desktop-update-rollback-coordinator.js';
import { DesktopUpdateRollbackStore } from './desktop-update-rollback-store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(version = '0.0.1') {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-update-rollback-'));
  temporaryDirectories.push(root);
  const installer = recoveryInstallerPath(root, version);
  await mkdir(join(installer, '..'), { recursive: true });
  await writeFile(installer, 'installer-fixture');
  const verification: DesktopUpdateInstallerVerification = {
    bytes: 17,
    sha512: 'b'.repeat(128),
    signature: {
      status: 'valid',
      signerThumbprint: 'ABCDEF',
      timestampStatus: 'valid',
    },
  };
  const verifyInstaller = vi.fn(async () => verification);
  const launchWatchdog = vi.fn(async () => undefined);
  const coordinator = new DesktopUpdateRollbackCoordinator({
    recoveryRoot: root,
    currentVersion: version,
    now: () => new Date('2026-08-02T08:00:00.000Z'),
    createIntentId: () => 'intent-fixed',
    verifyInstaller,
    launchWatchdog,
    healthDeadlineMs: 180_000,
  });
  return { root, installer, verification, verifyInstaller, launchWatchdog, coordinator };
}

describe('DesktopUpdateRollbackCoordinator', () => {
  it('registers the archived installer only after bytes/hash/signature verification', async () => {
    const { coordinator, installer, verifyInstaller } = await fixture();

    const release = await coordinator.registerCurrentVersionInstaller();

    expect(verifyInstaller).toHaveBeenCalledWith(installer, false);
    expect(release).toMatchObject({ version: '0.0.1', installer: { path: installer } });
  });

  it('arms a durable one-shot watchdog before installing a newer target', async () => {
    const { coordinator, launchWatchdog, root } = await fixture();
    await coordinator.registerCurrentVersionInstaller();

    const result = await coordinator.prepareInstall({
      targetVersion: '0.0.2',
      downloadedFile: join(root, 'cache', 'SYNC-THINK-Setup-0.0.2-x64.exe'),
    });

    expect(result).toMatchObject({ status: 'armed', intentId: 'intent-fixed' });
    expect(launchWatchdog).toHaveBeenCalledTimes(1);
    expect(launchWatchdog).toHaveBeenCalledWith(
      expect.objectContaining({
        previousVersion: '0.0.1',
        targetVersion: '0.0.2',
        intentId: 'intent-fixed',
      }),
    );
    const store = new DesktopUpdateRollbackStore(root);
    await expect(store.readActiveIntent()).resolves.toMatchObject({ intentId: 'intent-fixed' });
  });

  it('records unavailable instead of pretending rollback is armed on first install', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-think-update-rollback-empty-'));
    temporaryDirectories.push(root);
    const launchWatchdog = vi.fn(async () => undefined);
    const coordinator = new DesktopUpdateRollbackCoordinator({
      recoveryRoot: root,
      currentVersion: '0.0.1',
      now: () => new Date('2026-08-02T08:00:00.000Z'),
      createIntentId: () => 'intent-unavailable',
      verifyInstaller: vi.fn(),
      launchWatchdog,
    });

    const result = await coordinator.prepareInstall({ targetVersion: '0.0.2' });

    expect(result).toMatchObject({ status: 'unavailable', reason: 'prior-installer-missing' });
    expect(launchWatchdog).not.toHaveBeenCalled();
    const outcome = JSON.parse(
      await (await import('node:fs/promises')).readFile(
        join(root, 'outcomes', 'intent-unavailable.json'),
        'utf8',
      ),
    );
    expect(outcome).toMatchObject({
      automaticRollbackAttempted: false,
      status: 'unavailable',
    });
  });

  it('writes health only for the exact active target and never for the previous version', async () => {
    const armed = await fixture('0.0.1');
    await armed.coordinator.registerCurrentVersionInstaller();
    await armed.coordinator.prepareInstall({ targetVersion: '0.0.2' });

    await expect(armed.coordinator.markRuntimeHealthy()).resolves.toBe('version-mismatch');

    const target = new DesktopUpdateRollbackCoordinator({
      recoveryRoot: armed.root,
      currentVersion: '0.0.2',
      now: () => new Date('2026-08-02T08:02:00.000Z'),
      verifyInstaller: armed.verifyInstaller,
      launchWatchdog: armed.launchWatchdog,
    });
    await expect(target.markRuntimeHealthy({ registerInstaller: false })).resolves.toBe('marked');
    const marker = await new DesktopUpdateRollbackStore(armed.root).readHealthMarker('intent-fixed');
    expect(marker).toMatchObject({ intentId: 'intent-fixed', targetVersion: '0.0.2' });
  });

  it('fails closed when the prior installer projection changes before install', async () => {
    const { coordinator, verifyInstaller } = await fixture();
    await coordinator.registerCurrentVersionInstaller();
    verifyInstaller.mockResolvedValueOnce({
      bytes: 18,
      sha512: 'c'.repeat(128),
      signature: {
        status: 'valid',
        signerThumbprint: 'ABCDEF',
        timestampStatus: 'valid',
      },
    });

    await expect(coordinator.prepareInstall({ targetVersion: '0.0.2' })).rejects.toThrow(
      'desktop.update.rollback-prior-installer-changed',
    );
  });
});
