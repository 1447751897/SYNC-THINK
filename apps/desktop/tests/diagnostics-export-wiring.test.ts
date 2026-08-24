import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(
  new URL('../src/renderer/shell/SettingsPage.tsx', import.meta.url),
  'utf8',
);
const shellCss = readFileSync(new URL('../src/renderer/shell/shell.css', import.meta.url), 'utf8');

describe('desktop diagnostics export wiring', () => {
  it('captures bounded crash evidence and handles export in Electron Main', () => {
    expect(mainSource).toContain('DesktopCrashJournal');
    expect(mainSource).toMatch(/ipcMain\.handle\(\s*['\"]desktop:diagnostics-export['\"]/);
    expect(mainSource).toContain("app.on('child-process-gone'");
    expect(mainSource).toContain("window.webContents.on('render-process-gone'");
    expect(mainSource).toContain('writeDesktopDiagnosticsBundle');
  });

  it('exposes one typed preload bridge without renderer filesystem access', () => {
    expect(preloadSource).toContain('exportDiagnostics:');
    expect(preloadSource).toContain("'desktop:diagnostics-export'");
    expect(globalSource).toContain('exportDiagnostics(');
    expect(settingsSource).toContain('runtime.exportData(');
    expect(settingsSource).not.toContain("from 'node:fs'");
  });

  it('keeps keyboard focus, scaling, and reduced-motion evidence in the data surface', () => {
    expect(settingsSource).toContain('getDataStorageStats');
    expect(settingsSource).toContain('cleanEmptyAttachmentDirectories');
    expect(settingsSource).toContain('数据迁移');
    expect(settingsSource).toContain('aria-live="polite"');
    expect(shellCss).toContain('.settings-diagnostics-export__button:focus-visible');
    expect(shellCss).toContain('@media (max-width: 820px)');
    expect(shellCss).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
