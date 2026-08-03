import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DesktopUpdateController } from './desktop-updater.js';
import {
  desktopUpdateInstallProbeHandoffPath,
  resolveDesktopUpdateInstallProbeBootstrap,
  resolveDesktopUpdateInstallProbeConfiguration,
  runDesktopUpdateInstallProbe,
  writeDesktopUpdateInstallProbeHandoff,
} from './desktop-update-install-probe.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function configuration() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-update-install-probe-'));
  tempDirs.push(root);
  return resolveDesktopUpdateInstallProbeConfiguration(
    JSON.stringify({
      resultPath: join(root, 'result.json'),
      userDataPath: join(root, 'user-data'),
      targetVersion: '0.0.2',
      markerName: 'update-install-marker',
    }),
  )!;
}

function baseController(): DesktopUpdateController {
  return {
    checkForUpdates: vi.fn().mockResolvedValue({
      ok: true,
      errorCode: null,
      state: { phase: 'available', availableVersion: '0.0.2' },
    }),
    downloadUpdate: vi.fn().mockResolvedValue({
      ok: true,
      errorCode: null,
      state: { phase: 'downloaded', availableVersion: '0.0.2' },
    }),
    installUpdate: vi.fn().mockResolvedValue({
      ok: true,
      errorCode: null,
      state: { phase: 'installing' },
    }),
  } as unknown as DesktopUpdateController;
}

describe('desktop update install probe configuration', () => {
  it('requires absolute result and user-data paths', () => {
    expect(() =>
      resolveDesktopUpdateInstallProbeConfiguration(
        JSON.stringify({
          resultPath: 'result.json',
          userDataPath: 'user-data',
          targetVersion: '0.0.2',
          markerName: 'marker',
        }),
      ),
    ).toThrow('desktop.update.probe-path-not-absolute');
  });
});

describe('desktop update install probe handoff', () => {
  it('restores the isolated runtime environment once after installer relaunch', async () => {
    const config = await configuration();
    const defaultUserData = join(config.userDataPath, 'default-user-data');
    const handoffPath = desktopUpdateInstallProbeHandoffPath(defaultUserData);
    const executablePath = join(config.userDataPath, 'install', 'SYNC-THINK.exe');

    await writeDesktopUpdateInstallProbeHandoff({
      handoffPath,
      executablePath,
      configuration: config,
      environment: {
        LOCALAPPDATA: join(config.userDataPath, 'local-app-data'),
        SYNC_THINK_DB_PATH: join(config.userDataPath, 'runtime-data', 'sync-think.db'),
        SYNC_THINK_RUNTIME_FORCE_RESTART: '1',
        SYNC_THINK_UPDATE_TOKEN: 'must-not-be-persisted',
      },
      now: new Date('2026-08-02T06:00:00.000Z'),
    });

    const bootstrap = resolveDesktopUpdateInstallProbeBootstrap({
      rawConfiguration: undefined,
      handoffPath,
      executablePath,
      now: new Date('2026-08-02T06:01:00.000Z'),
    });

    expect(bootstrap).toMatchObject({
      source: 'handoff',
      configuration: { targetVersion: '0.0.2', userDataPath: config.userDataPath },
      environment: {
        LOCALAPPDATA: join(config.userDataPath, 'local-app-data'),
        SYNC_THINK_DB_PATH: join(config.userDataPath, 'runtime-data', 'sync-think.db'),
        SYNC_THINK_RUNTIME_FORCE_RESTART: '1',
      },
    });
    expect(bootstrap?.environment).not.toHaveProperty('SYNC_THINK_UPDATE_TOKEN');
    await expect(readFile(handoffPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('ignores a handoff bound to another executable', async () => {
    const config = await configuration();
    const handoffPath = desktopUpdateInstallProbeHandoffPath(
      join(config.userDataPath, 'default-user-data'),
    );
    await writeDesktopUpdateInstallProbeHandoff({
      handoffPath,
      executablePath: join(config.userDataPath, 'install', 'SYNC-THINK.exe'),
      configuration: config,
      environment: {},
    });

    expect(
      resolveDesktopUpdateInstallProbeBootstrap({
        rawConfiguration: undefined,
        handoffPath,
        executablePath: join(config.userDataPath, 'other', 'SYNC-THINK.exe'),
      }),
    ).toBeNull();
  });
});
describe('runDesktopUpdateInstallProbe', () => {
  it('creates a durable marker before requesting one real install', async () => {
    const config = await configuration();
    const controller = baseController();

    const result = await runDesktopUpdateInstallProbe({
      configuration: config,
      currentVersion: '0.0.1',
      controller,
      ensureRuntimeReady: vi.fn().mockResolvedValue(undefined),
      createMarker: vi.fn().mockResolvedValue('workspace-marker-id'),
      markerExists: vi.fn(),
      now: () => new Date('2026-08-02T06:00:00.000Z'),
    });

    expect(result.installRequestCount).toBe(1);
    expect(result.markerId).toBe('workspace-marker-id');
    expect(result.events.map((event) => event.type)).toEqual([
      'base-runtime-ready',
      'update-available',
      'update-downloaded',
      'install-requested',
    ]);
    expect(controller.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('persists relaunch state before recording or invoking the installer request', async () => {
    const config = await configuration();
    const order: string[] = [];
    const controller = baseController();
    vi.mocked(controller.installUpdate).mockImplementation(async () => {
      order.push('install');
      return { ok: true, errorCode: null, state: { phase: 'installing' } } as never;
    });

    const result = await runDesktopUpdateInstallProbe({
      configuration: config,
      currentVersion: '0.0.1',
      controller,
      ensureRuntimeReady: vi.fn().mockResolvedValue(undefined),
      createMarker: vi.fn().mockResolvedValue('workspace-marker-id'),
      markerExists: vi.fn(),
      prepareInstallRelaunch: vi.fn().mockImplementation(async () => {
        order.push('handoff');
        const persisted = JSON.parse(await readFile(config.resultPath, 'utf8'));
        expect(persisted.installRequestCount).toBe(0);
      }),
    });

    expect(order).toEqual(['handoff', 'install']);
    expect(result.installRequestCount).toBe(1);
  });

  it('does not request installation when relaunch persistence fails', async () => {
    const config = await configuration();
    const controller = baseController();

    await expect(
      runDesktopUpdateInstallProbe({
        configuration: config,
        currentVersion: '0.0.1',
        controller,
        ensureRuntimeReady: vi.fn().mockResolvedValue(undefined),
        createMarker: vi.fn().mockResolvedValue('workspace-marker-id'),
        markerExists: vi.fn(),
        prepareInstallRelaunch: vi.fn().mockRejectedValue(new Error('handoff.write-failed')),
      }),
    ).rejects.toThrow('handoff.write-failed');

    expect(controller.installUpdate).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(config.resultPath, 'utf8'))).toMatchObject({
      installRequestCount: 0,
      errorCode: 'handoff.write-failed',
    });
  });

  it('verifies the marker after installer relaunch and completes the state', async () => {
    const config = await configuration();
    await runDesktopUpdateInstallProbe({
      configuration: config,
      currentVersion: '0.0.1',
      controller: baseController(),
      ensureRuntimeReady: vi.fn().mockResolvedValue(undefined),
      createMarker: vi.fn().mockResolvedValue('workspace-marker-id'),
      markerExists: vi.fn(),
    });

    const markerExists = vi.fn().mockResolvedValue(true);
    const result = await runDesktopUpdateInstallProbe({
      configuration: config,
      currentVersion: '0.0.2',
      controller: {} as DesktopUpdateController,
      ensureRuntimeReady: vi.fn().mockResolvedValue(undefined),
      createMarker: vi.fn(),
      markerExists,
    });

    expect(markerExists).toHaveBeenCalledWith('update-install-marker', 'workspace-marker-id');
    expect(result.completed).toBe(true);
    expect(result.installRequestCount).toBe(1);
    expect(JSON.parse(await readFile(config.resultPath, 'utf8'))).toMatchObject({
      completed: true,
      markerId: 'workspace-marker-id',
    });
  });
});