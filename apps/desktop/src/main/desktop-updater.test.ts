import { describe, expect, it, vi } from 'vitest';
import {
  DesktopUpdateController,
  normalizeUpdateReleaseNotes,
  resolveDesktopUpdateConfiguration,
  type DesktopUpdaterDriver,
  type DesktopUpdaterDriverListeners,
} from './desktop-updater.js';

class FakeUpdaterDriver implements DesktopUpdaterDriver {
  listeners: DesktopUpdaterDriverListeners = {};
  checkForUpdates = vi.fn<() => Promise<void>>(async () => undefined);
  downloadUpdate = vi.fn<() => Promise<void>>(async () => undefined);
  quitAndInstall = vi.fn<(isSilent: boolean, isForceRunAfter: boolean) => void>();
  flushRecoveryEvidence = vi.fn<() => Promise<void>>(async () => undefined);

  subscribe(listeners: DesktopUpdaterDriverListeners): () => void {
    this.listeners = listeners;
    return () => {
      this.listeners = {};
    };
  }
}

const now = () => new Date('2026-08-02T08:00:00.000Z');

function configuredController(
  options: {
    driver?: FakeUpdaterDriver;
    beforeInstall?: (context: { currentVersion: string; targetVersion: string; downloadedFile: string | null }) => Promise<void>;
    installSilently?: boolean;
  } = {},
) {
  const driver = options.driver ?? new FakeUpdaterDriver();
  const controller = new DesktopUpdateController({
    currentVersion: '0.0.1',
    configuration: {
      enabled: true,
      feedUrl: 'https://updates.example.test/windows/x64',
      channel: 'latest',
      requestHeaders: { Authorization: 'Bearer secret-token' },
      forceDevUpdateConfig: false,
    },
    driver,
    now,
    beforeInstall: options.beforeInstall,
    installSilently: options.installSilently,
  });
  return { controller, driver };
}

describe('resolveDesktopUpdateConfiguration', () => {
  it('stays disabled without an explicit private feed', () => {
    expect(resolveDesktopUpdateConfiguration({}, { isPackaged: true })).toEqual({
      enabled: false,
      channel: 'latest',
      errorCode: null,
    });
  });

  it('accepts HTTPS and loopback HTTP feeds but rejects unsafe URL shapes', () => {
    expect(
      resolveDesktopUpdateConfiguration(
        {
          SYNC_THINK_UPDATE_FEED_URL: 'https://updates.example.test/windows/x64',
          SYNC_THINK_UPDATE_CHANNEL: 'beta',
          SYNC_THINK_UPDATE_TOKEN: 'private-token',
        },
        { isPackaged: true },
      ),
    ).toEqual({
      enabled: true,
      feedUrl: 'https://updates.example.test/windows/x64',
      channel: 'beta',
      requestHeaders: { Authorization: 'Bearer private-token' },
      forceDevUpdateConfig: false,
    });

    expect(
      resolveDesktopUpdateConfiguration(
        {
          SYNC_THINK_UPDATE_FEED_URL: 'http://127.0.0.1:43123/releases',
          SYNC_THINK_UPDATE_ALLOW_DEV: '1',
        },
        { isPackaged: false },
      ),
    ).toMatchObject({ enabled: true, forceDevUpdateConfig: true });

    for (const feedUrl of [
      'http://updates.example.test/releases',
      'https://user:password@updates.example.test/releases',
      'https://updates.example.test/releases?token=leak',
      'https://updates.example.test/releases#latest',
    ]) {
      expect(
        resolveDesktopUpdateConfiguration(
          { SYNC_THINK_UPDATE_FEED_URL: feedUrl },
          { isPackaged: true },
        ),
      ).toEqual({
        enabled: false,
        channel: 'latest',
        errorCode: 'desktop.update.feed-invalid',
      });
    }
  });

  it('rejects malformed channels and unsafe tokens', () => {
    expect(
      resolveDesktopUpdateConfiguration(
        {
          SYNC_THINK_UPDATE_FEED_URL: 'https://updates.example.test/releases',
          SYNC_THINK_UPDATE_CHANNEL: '../private',
        },
        { isPackaged: true },
      ),
    ).toMatchObject({ enabled: false, errorCode: 'desktop.update.channel-invalid' });

    expect(
      resolveDesktopUpdateConfiguration(
        {
          SYNC_THINK_UPDATE_FEED_URL: 'https://updates.example.test/releases',
          SYNC_THINK_UPDATE_TOKEN: 'secret\r\nX-Injected: true',
        },
        { isPackaged: true },
      ),
    ).toMatchObject({ enabled: false, errorCode: 'desktop.update.token-invalid' });

    expect(
      resolveDesktopUpdateConfiguration(
        {
          SYNC_THINK_UPDATE_FEED_URL: 'https://updates.example.test/releases',
          SYNC_THINK_UPDATE_TOKEN: '   ',
        },
        { isPackaged: true },
      ),
    ).toMatchObject({ enabled: false, errorCode: 'desktop.update.token-invalid' });
  });

  it('configures an installed app from the bundled feed without any environment', () => {
    expect(
      resolveDesktopUpdateConfiguration(
        {},
        {
          isPackaged: true,
          bundledFeed: { feedUrl: 'https://sync-think.online/updates', channel: null },
        },
      ),
    ).toEqual({
      enabled: true,
      feedUrl: 'https://sync-think.online/updates',
      channel: 'latest',
      requestHeaders: null,
      forceDevUpdateConfig: false,
    });
  });

  it('applies the bundled channel until the environment overrides it', () => {
    expect(
      resolveDesktopUpdateConfiguration(
        {},
        {
          isPackaged: true,
          bundledFeed: { feedUrl: 'https://sync-think.online/updates', channel: 'beta' },
        },
      ),
    ).toMatchObject({ enabled: true, channel: 'beta' });

    expect(
      resolveDesktopUpdateConfiguration(
        { SYNC_THINK_UPDATE_CHANNEL: 'latest' },
        {
          isPackaged: true,
          bundledFeed: { feedUrl: 'https://sync-think.online/updates', channel: 'beta' },
        },
      ),
    ).toMatchObject({ enabled: true, channel: 'latest' });
  });

  it('lets the environment override both bundled feed and channel', () => {
    expect(
      resolveDesktopUpdateConfiguration(
        {
          SYNC_THINK_UPDATE_FEED_URL: 'https://staging.example.test/releases',
          SYNC_THINK_UPDATE_CHANNEL: 'beta',
        },
        {
          isPackaged: true,
          bundledFeed: { feedUrl: 'https://sync-think.online/updates', channel: 'latest' },
        },
      ),
    ).toEqual({
      enabled: true,
      feedUrl: 'https://staging.example.test/releases',
      channel: 'beta',
      requestHeaders: null,
      forceDevUpdateConfig: false,
    });
  });

  it('still validates bundled feeds against the same URL safety rules', () => {
    for (const feedUrl of [
      'http://sync-think.online/updates',
      'https://user:password@sync-think.online/updates',
      'https://sync-think.online/updates?token=leak',
      'not-a-url',
    ]) {
      expect(
        resolveDesktopUpdateConfiguration({}, { isPackaged: true, bundledFeed: { feedUrl } }),
      ).toMatchObject({ enabled: false, errorCode: 'desktop.update.feed-invalid' });
    }

    expect(
      resolveDesktopUpdateConfiguration(
        {},
        { isPackaged: true, bundledFeed: { feedUrl: 'https://sync-think.online/updates', channel: '../private' } },
      ),
    ).toMatchObject({ enabled: false, errorCode: 'desktop.update.channel-invalid' });
  });

  it('keeps a bundled feed inert in development unless the dev gate is open', () => {
    const bundledFeed = { feedUrl: 'http://127.0.0.1:43123/releases', channel: null };

    expect(resolveDesktopUpdateConfiguration({}, { isPackaged: false, bundledFeed })).toMatchObject({
      enabled: false,
      errorCode: 'desktop.update.dev-disabled',
    });

    expect(
      resolveDesktopUpdateConfiguration(
        { SYNC_THINK_UPDATE_ALLOW_DEV: '1' },
        { isPackaged: false, bundledFeed },
      ),
    ).toMatchObject({ enabled: true, forceDevUpdateConfig: true });
  });

  it('ignores a bundled feed that carries no URL', () => {
    expect(
      resolveDesktopUpdateConfiguration(
        {},
        { isPackaged: true, bundledFeed: { feedUrl: null, channel: null } },
      ),
    ).toEqual({ enabled: false, channel: 'latest', errorCode: null });
  });
});

describe('DesktopUpdateController', () => {
  it('projects a secret-free state and drives manual check, download and install', async () => {
    const order: string[] = [];
    const { controller, driver } = configuredController({
      beforeInstall: async () => {
        order.push('shutdown');
      },
    });
    driver.quitAndInstall.mockImplementation(() => order.push('install'));

    expect(controller.getSnapshot()).toEqual({
      schemaVersion: 1,
      phase: 'idle',
      configured: true,
      currentVersion: '0.0.1',
      channel: 'latest',
      availableVersion: null,
      releaseNotes: null,
      progressPercent: null,
      checkedAt: null,
      downloadedAt: null,
      errorCode: null,
    });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('secret-token');
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('updates.example.test');

    await expect(controller.checkForUpdates()).resolves.toMatchObject({ ok: true });
    expect(controller.getSnapshot().phase).toBe('checking');

    driver.listeners.available?.({ version: '0.0.2' });
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'available',
      availableVersion: '0.0.2',
      releaseNotes: null,
      checkedAt: '2026-08-02T08:00:00.000Z',
    });

    await expect(controller.downloadUpdate()).resolves.toMatchObject({ ok: true });
    driver.listeners.progress?.({ percent: 42.26 });
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'downloading',
      progressPercent: 42.3,
    });

    driver.listeners.downloaded?.({ version: '0.0.2' });
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'downloaded',
      progressPercent: 100,
      downloadedAt: '2026-08-02T08:00:00.000Z',
    });

    await expect(controller.installUpdate()).resolves.toMatchObject({ ok: true });
    expect(order).toEqual(['shutdown', 'install']);
    expect(driver.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(controller.getSnapshot().phase).toBe('installing');
  });

  it('keeps the downloaded installer path Main-only and passes it to the install fence', async () => {
    const beforeInstall = vi.fn(async () => undefined);
    const { controller, driver } = configuredController({ beforeInstall });
    driver.listeners.downloaded?.({
      version: '0.0.2',
      downloadedFile: 'C:\\update-cache\\SYNC-THINK-Setup-0.0.2-x64.exe',
    });

    await expect(controller.installUpdate()).resolves.toMatchObject({ ok: true });

    expect(beforeInstall).toHaveBeenCalledWith({
      currentVersion: '0.0.1',
      targetVersion: '0.0.2',
      downloadedFile: 'C:\\update-cache\\SYNC-THINK-Setup-0.0.2-x64.exe',
    });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('update-cache');
  });

  it('waits for the shutdown fence and rejects a concurrent install attempt', async () => {
    let finishShutdown: (() => void) | undefined;
    const beforeInstall = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishShutdown = resolve;
        }),
    );
    const { controller, driver } = configuredController({ beforeInstall });
    driver.listeners.downloaded?.({ version: '0.0.2' });

    const firstInstall = controller.installUpdate();
    expect(controller.getSnapshot().phase).toBe('installing');
    expect(beforeInstall).toHaveBeenCalledTimes(1);
    expect(driver.quitAndInstall).not.toHaveBeenCalled();

    await expect(controller.installUpdate()).resolves.toMatchObject({
      ok: false,
      errorCode: 'desktop.update.action-busy',
    });
    expect(beforeInstall).toHaveBeenCalledTimes(1);

    finishShutdown?.();
    await expect(firstInstall).resolves.toMatchObject({ ok: true });
    expect(driver.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(driver.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('supports unattended installation for the packaged update E2E probe', async () => {
    const { controller, driver } = configuredController({ installSilently: true });
    driver.listeners.downloaded?.({ version: '0.0.2' });

    await expect(controller.installUpdate()).resolves.toMatchObject({ ok: true });
    expect(driver.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('does not invoke the installer when the shutdown fence fails', async () => {
    const { controller, driver } = configuredController({
      beforeInstall: async () => {
        throw new Error('runtime shutdown failed with private details');
      },
    });
    driver.listeners.downloaded?.({ version: '0.0.2' });

    await expect(controller.installUpdate()).resolves.toMatchObject({
      ok: false,
      errorCode: 'desktop.update.install-failed',
      state: {
        phase: 'error',
        errorCode: 'desktop.update.install-failed',
      },
    });
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('private details');
  });

  it('rejects a stale prepared installer after a newer version fails to download', async () => {
    const { controller, driver } = configuredController({
      beforeInstall: async () => {
        throw new Error('shutdown fence failed');
      },
    });

    driver.listeners.available?.({ version: '0.0.2' });
    driver.listeners.downloaded?.({ version: '0.0.2' });
    await expect(controller.installUpdate()).resolves.toMatchObject({
      ok: false,
      errorCode: 'desktop.update.install-failed',
    });
    expect(controller.getSnapshot().downloadedAt).not.toBeNull();

    driver.listeners.available?.({ version: '0.0.3' });
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'available',
      availableVersion: '0.0.3',
      downloadedAt: null,
    });
    driver.downloadUpdate.mockRejectedValueOnce(new Error('new download failed'));
    await expect(controller.downloadUpdate()).resolves.toMatchObject({
      ok: false,
      errorCode: 'desktop.update.download-failed',
    });

    await expect(controller.installUpdate()).resolves.toMatchObject({
      ok: false,
      errorCode: 'desktop.update.action-invalid',
    });
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
  });

  it('deduplicates an updater error event followed by the same rejected action', async () => {
    const { controller, driver } = configuredController();
    const providerError = new Error('provider request failed');
    driver.checkForUpdates.mockImplementationOnce(async () => {
      driver.listeners.error?.(providerError);
      throw providerError;
    });

    await expect(controller.checkForUpdates()).resolves.toMatchObject({
      ok: false,
      errorCode: 'desktop.update.check-failed',
    });
    expect(controller.getRecoveryEvidence()).toHaveLength(1);
    expect(controller.getRecoveryEvidence()[0]).toMatchObject({
      action: 'check',
      failedPhase: 'checking',
      errorCode: 'desktop.update.check-failed',
    });
  });

  it('flushes pending recovery evidence through the driver', async () => {
    const { controller, driver } = configuredController();

    await controller.flushRecoveryEvidence();

    expect(driver.flushRecoveryEvidence).toHaveBeenCalledTimes(1);
  });

  it('rejects install unless a download has completed', async () => {
    const { controller, driver } = configuredController();

    await expect(controller.installUpdate()).resolves.toMatchObject({
      ok: false,
      errorCode: 'desktop.update.action-invalid',
    });
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
  });

  it('rejects invalid and concurrent actions without invoking the driver twice', async () => {
    const { controller, driver } = configuredController();
    let finishCheck: (() => void) | undefined;
    driver.checkForUpdates.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCheck = resolve;
        }),
    );

    const invalidDownload = await controller.downloadUpdate();
    expect(invalidDownload).toMatchObject({
      ok: false,
      errorCode: 'desktop.update.action-invalid',
    });

    const firstCheck = controller.checkForUpdates();
    const secondCheck = await controller.checkForUpdates();
    expect(secondCheck).toMatchObject({
      ok: false,
      errorCode: 'desktop.update.action-busy',
    });
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1);
    finishCheck?.();
    await firstCheck;

    driver.listeners.downloaded?.({ version: '0.0.2' });
    await expect(controller.checkForUpdates()).resolves.toMatchObject({
      ok: false,
      errorCode: 'desktop.update.action-invalid',
    });
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('maps provider failures to stable codes without exposing raw errors', async () => {
    const { controller, driver } = configuredController();
    driver.checkForUpdates.mockRejectedValue(new Error('Authorization: Bearer secret-token'));

    const result = await controller.checkForUpdates();
    expect(result).toMatchObject({ ok: false, errorCode: 'desktop.update.check-failed' });
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error',
      errorCode: 'desktop.update.check-failed',
    });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('projects safe metadata, channel and checksum failures from electron-updater', async () => {
    const { controller, driver } = configuredController();
    driver.checkForUpdates.mockRejectedValueOnce(
      Object.assign(new Error('invalid remote version'), { code: 'ERR_UPDATER_INVALID_VERSION' }),
    );
    await expect(controller.checkForUpdates()).resolves.toMatchObject({
      ok: false,
      errorCode: 'desktop.update.metadata-invalid',
    });

    driver.checkForUpdates.mockRejectedValueOnce(
      Object.assign(new Error('missing beta.yml'), {
        code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
      }),
    );
    await expect(controller.checkForUpdates()).resolves.toMatchObject({
      ok: false,
      errorCode: 'desktop.update.channel-unavailable',
    });

    driver.listeners.available?.({ version: '0.0.2' });
    driver.downloadUpdate.mockRejectedValueOnce(
      Object.assign(new Error('sha512 mismatch'), { code: 'ERR_CHECKSUM_MISMATCH' }),
    );
    const downloadResult = await controller.downloadUpdate();
    expect(downloadResult).toMatchObject({
      ok: false,
      errorCode: 'desktop.update.checksum-mismatch',
    });
    expect(JSON.stringify(downloadResult)).not.toContain('sha512 mismatch');
  });

  it('carries feed release notes into the snapshot and clears them when no version is pending', async () => {
    const { controller, driver } = configuredController();

    await controller.checkForUpdates();
    driver.listeners.available?.({
      version: '0.0.2',
      releaseNotes: '- 更新日志改为应用内展示\r\n- 修复若干问题',
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'available',
      availableVersion: '0.0.2',
      releaseNotes: '- 更新日志改为应用内展示\n- 修复若干问题',
    });

    driver.listeners.notAvailable?.({ version: '0.0.1' });
    expect(controller.getSnapshot()).toMatchObject({ phase: 'up-to-date', releaseNotes: null });
  });

  it('sanitizes release notes before they reach the renderer', async () => {
    const { controller, driver } = configuredController();

    await controller.checkForUpdates();
    driver.listeners.available?.({
      version: '0.0.2',
      releaseNotes: '<img src=x onerror=alert(1)>\u001b[31m' + 'a'.repeat(9000),
    });

    const notes = controller.getSnapshot().releaseNotes;
    expect(notes).not.toBeNull();
    expect(notes).not.toContain('\u001b');
    expect(notes?.endsWith('…')).toBe(true);
    // The renderer treats the payload as opaque text, so markup stays literal
    // rather than being stripped: that is what keeps it inert.
    expect(notes?.startsWith('<img src=x onerror=alert(1)>')).toBe(true);
  });

  it('keeps an unconfigured updater inert', async () => {
    const controller = new DesktopUpdateController({
      currentVersion: '0.0.1',
      configuration: { enabled: false, channel: 'latest', errorCode: null },
      driver: null,
      now,
    });

    expect(controller.getSnapshot().phase).toBe('disabled');
    await expect(controller.checkForUpdates()).resolves.toMatchObject({
      ok: false,
      errorCode: 'desktop.update.disabled',
    });
  });
});

describe('normalizeUpdateReleaseNotes', () => {
  it('passes plain text through after trimming', () => {
    expect(normalizeUpdateReleaseNotes('  修复了若干问题  ')).toBe('修复了若干问题');
  });

  it('joins the electron-updater note array form', () => {
    expect(
      normalizeUpdateReleaseNotes([
        { version: '0.1.0', note: '第一条' },
        { version: '0.0.9', note: '第二条' },
      ]),
    ).toBe('第一条\n\n第二条');
    expect(normalizeUpdateReleaseNotes(['甲', '乙'])).toBe('甲\n\n乙');
  });

  it('drops control characters but keeps tabs and line breaks', () => {
    const raw = '第一行\r\n第二行\u0000\u0007\u001b[31m红\t色\u007f';
    expect(normalizeUpdateReleaseNotes(raw)).toBe('第一行\n第二行[31m红\t色');
  });

  it('returns null for empty, mistyped and note-free payloads', () => {
    expect(normalizeUpdateReleaseNotes(undefined)).toBeNull();
    expect(normalizeUpdateReleaseNotes(null)).toBeNull();
    expect(normalizeUpdateReleaseNotes(42)).toBeNull();
    expect(normalizeUpdateReleaseNotes({ note: '未预期的对象' })).toBeNull();
    expect(normalizeUpdateReleaseNotes('   \n\t  ')).toBeNull();
    expect(normalizeUpdateReleaseNotes([])).toBeNull();
    expect(normalizeUpdateReleaseNotes([{ version: '1.0.0' }])).toBeNull();
  });

  it('caps oversized notes with an ellipsis', () => {
    const normalized = normalizeUpdateReleaseNotes('a'.repeat(9000));
    expect(normalized).not.toBeNull();
    expect(normalized?.length).toBe(8 * 1024 + 1);
    expect(normalized?.endsWith('…')).toBe(true);
  });
});
