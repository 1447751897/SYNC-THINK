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

  it('bridges Git, browser identity, effective access, and worktree integration commands', () => {
    for (const channel of [
      'runtime:workspace-bind-git-repository',
      'runtime:browser-identity-list',
      'runtime:browser-identity-create',
      'runtime:browser-identity-update',
      'runtime:browser-identity-delete',
      'runtime:task-set-browser-identity',
      'runtime:task-describe-execution-access',
      'runtime:task-resolve-worktree-integration',
      'runtime:task-discard-empty',
      'runtime:task-set-empty-workspace',
    ]) {
      expect(mainSource).toContain(`ipcMain.handle('${channel}'`);
      expect(preloadSource).toContain(`'${channel}'`);
    }
    for (const method of [
      'bindWorkspaceGitRepository',
      'listBrowserIdentities',
      'createBrowserIdentity',
      'updateBrowserIdentity',
      'deleteBrowserIdentity',
      'setTaskBrowserIdentity',
      'describeTaskExecutionAccess',
      'resolveWorktreeIntegration',
      'discardEmptyTask',
      'setEmptyTaskWorkspace',
    ]) {
      expect(preloadSource).toContain(`${method}:`);
      expect(globalSource).toContain(`${method}(`);
    }
  });

  it('creates projects in-product without prompting for a folder', () => {
    expect(rendererSource).toContain('<ProjectCreateDialog');
    expect(rendererSource).toContain('await runtime.createWorkspace({ name });');
    expect(rendererSource).toContain('onCreateWorkspace={openProjectCreateDialog}');
    expect(rendererSource).toContain('onCreateWorkspaceFromFolder={createWorkspaceFromFolder}');
    expect(rendererSource).toContain('await createTask(workspaceId);');
    expect(rendererSource).not.toContain("window.prompt('工作区名称'");
    expect(rendererSource).not.toContain("window.prompt('本地文件夹绝对路径'");
  });
});
