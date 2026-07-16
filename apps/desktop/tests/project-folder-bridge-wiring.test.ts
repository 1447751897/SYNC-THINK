import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../src/renderer/index.tsx', import.meta.url), 'utf8');

describe('project folder binding desktop wiring', () => {
  it('bridges explicit folder binding through main and preload', () => {
    expect(mainSource).toContain("ipcMain.handle('runtime:workspace-bind-folder'");
    expect(mainSource).toContain("'workspace.bindFolder'");
    expect(mainSource).toContain("title: '为项目绑定文件夹'");
    expect(preloadSource).toContain('bindWorkspaceFolder:');
    expect(preloadSource).toContain("'runtime:workspace-bind-folder'");
    expect(globalSource).toContain('bindWorkspaceFolder(');
  });

  it('creates projects in-product without prompting for a folder', () => {
    expect(rendererSource).toContain('<ProjectCreateDialog');
    expect(rendererSource).toContain('await runtime.createWorkspace({ name });');
    expect(rendererSource).not.toContain("window.prompt('工作区名称'");
    expect(rendererSource).not.toContain("window.prompt('本地文件夹绝对路径'");
  });
});
