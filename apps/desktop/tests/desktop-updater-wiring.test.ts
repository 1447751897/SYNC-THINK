import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const driverSource = readFileSync(
  new URL('../src/main/electron-updater-driver.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(
  new URL('../src/renderer/shell/SettingsPage.tsx', import.meta.url),
  'utf8',
);
const panelSource = readFileSync(
  new URL('../src/renderer/shell/DesktopUpdatePanel.tsx', import.meta.url),
  'utf8',
);

describe('desktop updater Electron wiring', () => {
  it('keeps every updater action behind trusted Main IPC handlers', () => {
    for (const channel of [
      'desktop:update-get-state',
      'desktop:update-check',
      'desktop:update-download',
      'desktop:update-install',
    ]) {
      const handlerStart = mainSource.indexOf(`ipcMain.handle('${channel}'`);
      expect(handlerStart).toBeGreaterThan(-1);
      const nextHandler = mainSource.indexOf('ipcMain.handle(', handlerStart + 1);
      const handlerSource = mainSource.slice(
        handlerStart,
        nextHandler === -1 ? mainSource.length : nextHandler,
      );
      expect(handlerSource).toContain('assertRuntimeIpcSource(event)');
    }
    expect(mainSource).toContain("target.send('desktop:update-state', snapshot)");
    expect(mainSource).toContain('beforeInstall: async (context) =>');
    expect(mainSource).toContain('desktopUpdateRollbackCoordinator?.prepareInstall');
    expect(mainSource).toContain('await shutdownDesktopServices()');
    expect(driverSource).toContain("import electronUpdater from 'electron-updater'");
    expect(driverSource).not.toContain("import { autoUpdater } from 'electron-updater'");
  });

  it('exposes only the bounded update snapshot and mounts it in About settings', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('desktop:update-get-state')");
    expect(preloadSource).toContain("ipcRenderer.invoke('desktop:update-check')");
    expect(preloadSource).toContain("ipcRenderer.invoke('desktop:update-download')");
    expect(preloadSource).toContain("ipcRenderer.invoke('desktop:update-install')");
    expect(preloadSource).toContain("const channel = 'desktop:update-state'");
    expect(globalSource).toContain('updates: {');
    expect(settingsSource).toContain('<DesktopUpdatePanel />');
    expect(panelSource).toContain('window.syncThink?.updates');

    for (const source of [preloadSource, globalSource, settingsSource, panelSource]) {
      expect(source).not.toContain('SYNC_THINK_UPDATE_TOKEN');
      expect(source).not.toContain('SYNC_THINK_UPDATE_FEED_URL');
      expect(source).not.toContain('Authorization: Bearer');
    }
  });
});
