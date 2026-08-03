import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('desktop waiting command wiring', () => {
  it('bridges the read-only waiting query through a strict main-process handler', () => {
    expect(mainSource).toContain("ipcMain.handle('runtime:desktop-command-list-waiting'");
    expect(mainSource).toContain("'desktop.command.listWaiting'");
    expect(mainSource).toContain('parseListWaitingDesktopCommandsPayload(value)');
    expect(mainSource).toContain("ipcMain.handle('runtime:desktop-command-continue'");
    expect(mainSource).toContain("ipcMain.handle('runtime:desktop-command-cancel'");
    expect(mainSource).toContain("'desktop.command.continue'");
    expect(mainSource).toContain("'desktop.command.cancel'");
  });

  it('exposes only the typed read-only waiting query to the renderer', () => {
    expect(preloadSource).toContain('listWaitingDesktopCommands:');
    expect(preloadSource).toContain("'runtime:desktop-command-list-waiting'");
    expect(globalSource).toContain('listWaitingDesktopCommands(');
    expect(preloadSource).toContain('continueDesktopCommand:');
    expect(preloadSource).toContain('cancelDesktopCommand:');
    expect(globalSource).toContain('continueDesktopCommand(');
    expect(globalSource).toContain('cancelDesktopCommand(');
  });
});
