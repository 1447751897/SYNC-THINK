import { join } from 'node:path';

import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';

import {
  DESKTOP_UPDATE_RECOVERY_EVIDENCE_LIMIT,
  DesktopUpdateRecoveryStore,
} from './desktop-update-recovery-store.js';
import type {
  DesktopUpdateConfiguration,
  DesktopUpdaterDriver,
  DesktopUpdaterDriverListeners,
} from './desktop-updater.js';

const { autoUpdater } = electronUpdater;
const RECOVERY_EVIDENCE_FILE = 'desktop-updater-recovery.json';

function assertEnabledConfiguration(
  configuration: DesktopUpdateConfiguration,
): asserts configuration is Extract<DesktopUpdateConfiguration, { enabled: true }> {
  if (!configuration.enabled) throw new Error('desktop.update.configuration-disabled');
}

export function createElectronUpdaterDriver(
  configuration: DesktopUpdateConfiguration,
): DesktopUpdaterDriver {
  assertEnabledConfiguration(configuration);

  autoUpdater.logger = null;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.disableDifferentialDownload = false;
  autoUpdater.forceDevUpdateConfig = configuration.forceDevUpdateConfig;
  autoUpdater.requestHeaders = configuration.requestHeaders
    ? { ...configuration.requestHeaders }
    : null;
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: configuration.feedUrl,
    channel: configuration.channel,
    useMultipleRangeRequest: false,
  });
  // Setting a channel can toggle allowDowngrade inside electron-updater.
  autoUpdater.allowDowngrade = false;
  const recoveryEvidencePath = join(app.getPath('userData'), 'diagnostics', RECOVERY_EVIDENCE_FILE);
  const recoveryEvidenceStore = new DesktopUpdateRecoveryStore(recoveryEvidencePath);

  return {
    subscribe(listeners: DesktopUpdaterDriverListeners): () => void {
      const onChecking = () => listeners.checking?.();
      const onAvailable = (info: UpdateInfo) => listeners.available?.({ version: info.version });
      const onNotAvailable = (info: UpdateInfo) =>
        listeners.notAvailable?.({ version: info.version });
      const onProgress = (info: ProgressInfo) => listeners.progress?.({ percent: info.percent });
      const onDownloaded = (info: UpdateDownloadedEvent) =>
        listeners.downloaded?.({ version: info.version, downloadedFile: info.downloadedFile ?? null });
      const onError = (error: Error) => listeners.error?.(error);

      autoUpdater.on('checking-for-update', onChecking);
      autoUpdater.on('update-available', onAvailable);
      autoUpdater.on('update-not-available', onNotAvailable);
      autoUpdater.on('download-progress', onProgress);
      autoUpdater.on('update-downloaded', onDownloaded);
      autoUpdater.on('error', onError);

      return () => {
        autoUpdater.removeListener('checking-for-update', onChecking);
        autoUpdater.removeListener('update-available', onAvailable);
        autoUpdater.removeListener('update-not-available', onNotAvailable);
        autoUpdater.removeListener('download-progress', onProgress);
        autoUpdater.removeListener('update-downloaded', onDownloaded);
        autoUpdater.removeListener('error', onError);
      };
    },
    async checkForUpdates(): Promise<void> {
      await autoUpdater.checkForUpdates();
    },
    async downloadUpdate(): Promise<void> {
      await autoUpdater.downloadUpdate();
    },
    quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void {
      autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
    },
    getDiagnostics() {
      return {
        differentialDownloadEnabled: autoUpdater.disableDifferentialDownload !== true,
        automaticInstallOnQuit: autoUpdater.autoInstallOnAppQuit === true,
        allowDowngrade: autoUpdater.allowDowngrade === true,
        currentVersionPreservedUntilInstall: true,
        persistentRecoveryEvidenceEnabled: true,
        recoveryEvidenceLimit: DESKTOP_UPDATE_RECOVERY_EVIDENCE_LIMIT,
      };
    },
    recordRecoveryEvidence(evidence) {
      void recoveryEvidenceStore.record(evidence).catch(() => undefined);
    },
    async flushRecoveryEvidence(): Promise<void> {
      await recoveryEvidenceStore.flush();
    },
  };
}
