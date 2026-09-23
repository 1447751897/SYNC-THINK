import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(new URL('../src/main/workspace-handlers.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Workspace lifecycle IPC wiring', () => {
  it('registers workspace commands through the typed boundary', () => {
    for (const command of [
      'workspace.create',
      'workspace.bindFolder',
      'workspace.list',
      'workspace.update',
      'workspace.delete',
    ]) {
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(preloadSource).toContain('WORKSPACE_RUNTIME_IPC_CHANNELS,');
    for (const channelKey of Object.keys(WORKSPACE_RUNTIME_IPC_CHANNELS)) {
      expect(preloadSource).toContain(`WORKSPACE_RUNTIME_IPC_CHANNELS.${channelKey}`);
    }
    expect(mainSource).toContain('registerWorkspaceHandlers({');
    expect(mainSource).toContain('requestWorkspace:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    expect(globalSource).toContain('createWorkspace(payload: CreateWorkspacePayload)');
    expect(globalSource).toContain('bindWorkspaceFolder(');
    expect(globalSource).toContain('payload: BindWorkspaceFolderPayload');
    expect(globalSource).toContain('listWorkspaces(payload?: ListWorkspacesPayload)');
    expect(globalSource).toContain('updateWorkspace(payload: UpdateWorkspacePayload)');
    expect(globalSource).toContain('deleteWorkspace(payload: DeleteWorkspacePayload)');
  });
});
