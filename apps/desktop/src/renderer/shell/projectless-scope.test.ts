import { describe, expect, it } from 'vitest';
import type { WorkspaceSummary } from '@sync-think/protocol';
import {
  PROJECTLESS_SCOPE,
  projectConversationScopes,
  projectWorkspaceScopes,
  runtimeConversation,
  runtimeWorkspaceId,
} from './projectless-scope.js';
const workspaces = [
  { workspaceId: 'project', name: '项目', createdAt: '', updatedAt: '' },
  { workspaceId: 'internal', name: '__inbox__', createdAt: '', updatedAt: '' },
] as WorkspaceSummary[];
describe('projectless UI scope', () => {
  it('groups unbound and legacy inbox conversations without changing actual workspace bindings', () => {
    const input = [
      { id: 'a', workspaceId: undefined },
      { id: 'b', workspaceId: 'internal' },
      { id: 'c', workspaceId: 'project' },
    ];
    const projected = projectConversationScopes(input, workspaces);
    expect(projected.map((c) => c.workspaceId)).toEqual([
      PROJECTLESS_SCOPE,
      PROJECTLESS_SCOPE,
      'project',
    ]);
    expect(input[1].workspaceId).toBe('internal');
    expect(projectWorkspaceScopes(workspaces).map((w) => w.workspaceId)).toEqual([
      'project',
      PROJECTLESS_SCOPE,
    ]);
    expect(runtimeWorkspaceId(PROJECTLESS_SCOPE)).toBeUndefined();
    expect(runtimeConversation(projected[0])).toEqual({ id: 'a', workspaceId: undefined });
    expect(runtimeConversation(projected[2]).workspaceId).toBe('project');
  });
  it('provides an unbound conversation entry before any workspace exists', () => {
    expect(projectWorkspaceScopes([])).toHaveLength(1);
    expect(projectWorkspaceScopes([])[0].name).toBe('不绑定工作区');
    expect(runtimeWorkspaceId(undefined)).toBeUndefined();
  });
});
