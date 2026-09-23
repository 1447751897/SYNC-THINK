import { describe, expect, it } from 'vitest';
import {
  parseBindWorkspaceFolderPayload,
  parseCreateWorkspacePayload,
  parseDeleteWorkspacePayload,
  parseListWorkspacesPayload,
  parseUpdateWorkspacePayload,
} from './workspace-lifecycle-payloads.js';

describe('Workspace lifecycle payload parsing', () => {
  it('accepts project creation without a folder and validates optional legacy folder input', () => {
    expect(parseCreateWorkspacePayload({ name: 'Project Atlas' })).toEqual({
      name: 'Project Atlas',
      folderPath: undefined,
      allowedRoots: undefined,
    });
    expect(
      parseCreateWorkspacePayload({ folderPath: ' D:/projects/SYNC-THINK ', name: ' SYNC-THINK ' }),
    ).toEqual({
      folderPath: 'D:/projects/SYNC-THINK',
      name: 'SYNC-THINK',
      allowedRoots: undefined,
    });
    expect(() => parseCreateWorkspacePayload({ folderPath: '  ', name: 'x' })).toThrow(
      /Invalid create-workspace/,
    );
  });

  it('validates explicit project folder binding', () => {
    expect(
      parseBindWorkspaceFolderPayload({ workspaceId: ' ws_1 ', folderPath: ' D:/projects/atlas ' }),
    ).toEqual({
      workspaceId: 'ws_1',
      folderPath: 'D:/projects/atlas',
      allowedRoots: undefined,
    });
    expect(() => parseBindWorkspaceFolderPayload({ workspaceId: '', folderPath: 'D:/x' })).toThrow(
      /Invalid bind-workspace-folder/,
    );
  });

  it('accepts only empty workspace-list shapes', () => {
    expect(parseListWorkspacesPayload(undefined)).toEqual({});
    expect(parseListWorkspacesPayload({ ignoredForCompatibility: true })).toEqual({});
    expect(() => parseListWorkspacesPayload([])).toThrow(/Invalid list-workspaces/);
  });

  it('normalizes bounded workspace updates', () => {
    expect(
      parseUpdateWorkspacePayload({
        workspaceId: ' ws_1 ',
        name: ' Atlas ',
        icon: '  ',
        sortOrder: 3.8,
        hidden: true,
      }),
    ).toEqual({
      workspaceId: 'ws_1',
      name: 'Atlas',
      folderPath: undefined,
      icon: null,
      sortOrder: 3,
      hidden: true,
    });
    expect(() => parseUpdateWorkspacePayload({ workspaceId: 'ws_1' })).toThrow(
      /Invalid update-workspace/,
    );
  });

  it('normalizes workspace deletion identity', () => {
    expect(parseDeleteWorkspacePayload({ workspaceId: ' ws_1 ' })).toEqual({ workspaceId: 'ws_1' });
    expect(() => parseDeleteWorkspacePayload({ workspaceId: '' })).toThrow(
      /Invalid delete-workspace/,
    );
  });
});
