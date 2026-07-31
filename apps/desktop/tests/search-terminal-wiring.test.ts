import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../src/renderer/shell/ShellApp.tsx', import.meta.url), 'utf8');
const dockSource = readFileSync(new URL('../src/renderer/shell/RightDock.tsx', import.meta.url), 'utf8');
const terminalSource = readFileSync(
  new URL('../src/renderer/shell/TerminalPane.tsx', import.meta.url),
  'utf8',
);
const shellBuildSource = readFileSync(new URL('../scripts/build-shell.mjs', import.meta.url), 'utf8');

describe('workspace search and terminal wiring', () => {
  it('routes bounded content search through Main and exposes typed Renderer results', () => {
    expect(mainSource).toContain("from './project-content-search.js'");
    expect(mainSource).toContain("ipcMain.handle('desktop:search-project-content'");
    expect(preloadSource).toContain('searchProjectContent:');
    expect(globalSource).toContain('searchProjectContent(payload:');
    expect(dockSource).toContain("'content'");
    expect(dockSource).toContain('result.line');
  });

  it('streams one controlled terminal command into a first-class Pane tab', () => {
    expect(mainSource).toContain("ipcMain.handle('desktop:start-project-terminal'");
    expect(mainSource).toContain("ipcMain.handle('desktop:cancel-project-terminal'");
    expect(preloadSource).toContain('subscribeProjectTerminal');
    expect(globalSource).toContain('startProjectTerminal(payload:');
    expect(shellSource).toContain("from './TerminalPane.js'");
    expect(shellSource).toContain('<TerminalPane');
    expect(shellSource).toContain('openTerminalInPane');
    expect(terminalSource).toContain('loadXtermVendor');
    expect(shellBuildSource).toContain("'xterm-vendor.ts'");
    expect(shellBuildSource).toContain("'xterm-vendor.js'");
  });
});
