import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');
const shellSource = readFileSync(
  new URL('../src/renderer/shell/ShellApp.tsx', import.meta.url),
  'utf8',
);
const dialogSource = readFileSync(
  new URL('../src/renderer/shell/Dialog.tsx', import.meta.url),
  'utf8',
);

describe('project folder binding desktop wiring', () => {
  it('bridges explicit folder binding through main and preload', () => {
    expect(mainSource).toContain("ipcMain.handle('runtime:workspace-bind-folder'");
    expect(mainSource).toContain("'workspace.bindFolder'");
    expect(mainSource).toContain("title: '为项目绑定文件夹'");
    expect(preloadSource).toContain('bindWorkspaceFolder:');
    expect(preloadSource).toContain("'runtime:workspace-bind-folder'");
    expect(globalSource).toContain('bindWorkspaceFolder(');
  });

  it('creates projects through a native picker or in-app dialog, never window.prompt', () => {
    // The shell binds a folder at create time (native picker, or a path supplied by
    // the create dialog) instead of the legacy renderer's two chained prompts.
    expect(shellSource).toContain('await api.pickFolder();');
    expect(shellSource).toContain('await api.createWorkspace({ name, folderPath: picked.path });');
    expect(shellSource).not.toContain('window.prompt');
    // Dialog.tsx exists precisely so no surface reaches for the native modals.
    expect(dialogSource).toContain('Replaces window.prompt');
  });
});
