import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('project file editor Electron wiring', () => {
  it('routes reads and optimistic atomic writes through the main-process service', () => {
    expect(mainSource).toContain("from './project-file-editor.js'");
    expect(mainSource).toContain("ipcMain.handle('desktop:read-project-file'");
    expect(mainSource).toContain("ipcMain.handle('desktop:write-project-file'");
    expect(mainSource).toContain('writeProjectFile({');
    expect(preloadSource).toContain('writeProjectFile:');
    expect(preloadSource).toContain("'desktop:write-project-file'");
    expect(globalSource).toContain('writeProjectFile(payload:');
    expect(globalSource).toContain('expectedMtimeMs: number | null');
  });

  it('subscribes to file changes per renderer and exposes explicit cleanup', () => {
    expect(mainSource).toContain("ipcMain.handle('desktop:watch-project-file'");
    expect(mainSource).toContain("ipcMain.handle('desktop:unwatch-project-file'");
    expect(mainSource).toContain('disposeProjectFileWatchesForSender');
    expect(preloadSource).toContain('watchProjectFile:');
    expect(preloadSource).toContain("'desktop:project-file-changed'");
    expect(preloadSource).toContain("'desktop:unwatch-project-file'");
    expect(globalSource).toContain('watchProjectFile(');
  });
});
