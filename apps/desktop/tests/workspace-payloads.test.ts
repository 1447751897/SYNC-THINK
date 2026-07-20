import { describe, expect, it } from 'vitest';
import {
  parseCreateTaskPayload,
  parseCreateWorkspacePayload,
  parseBindWorkspaceFolderPayload,
  parseBindWorkspaceGitRepositoryPayload,
  parseResolveWorktreeIntegrationPayload,
  parseDiscardEmptyTaskPayload,
  parseListTasksPayload,
  parseListWorkspacesPayload,
  parseOpenTaskPayload,
  parseSearchTasksPayload,
} from '../src/workspace-payloads.js';

describe('desktop workspace bridge payload validation', () => {
  it('accepts project creation without a folder and validates optional legacy folder input', () => {
    expect(parseCreateWorkspacePayload({ name: 'Project Atlas' })).toEqual({
      name: 'Project Atlas',
      folderPath: undefined,
      allowedRoots: undefined,
    });
    expect(
      parseCreateWorkspacePayload({
        folderPath: 'D:/projects/SYNC-THINK',
        name: 'SYNC-THINK',
      }),
    ).toEqual({
      folderPath: 'D:/projects/SYNC-THINK',
      name: 'SYNC-THINK',
      allowedRoots: undefined,
    });
    expect(() => parseCreateWorkspacePayload({ folderPath: '  ', name: 'x' })).toThrow(
      /Invalid create-workspace/,
    );
    expect(() => parseCreateWorkspacePayload({ folderPath: 'D:/a', name: '' })).toThrow(
      /Invalid create-workspace/,
    );
  });

  it('validates explicit project folder binding', () => {
    expect(
      parseBindWorkspaceFolderPayload({
        workspaceId: 'ws_1',
        folderPath: ' D:/projects/atlas ',
      }),
    ).toEqual({
      workspaceId: 'ws_1',
      folderPath: 'D:/projects/atlas',
      allowedRoots: undefined,
    });
    expect(() => parseBindWorkspaceFolderPayload({ workspaceId: '', folderPath: 'D:/x' })).toThrow(
      /Invalid bind-workspace-folder/,
    );
    expect(() =>
      parseBindWorkspaceFolderPayload({ workspaceId: 'ws_1', folderPath: '  ' }),
    ).toThrow(/Invalid bind-workspace-folder/);
  });

  it('validates Git repository binding without accepting secrets', () => {
    expect(
      parseBindWorkspaceGitRepositoryPayload({
        workspaceId: 'ws_1',
        repositoryUrl: ' https://github.com/example/project.git ',
        defaultRef: ' main ',
      }),
    ).toEqual({
      workspaceId: 'ws_1',
      repositoryUrl: 'https://github.com/example/project.git',
      defaultRef: 'main',
    });
    expect(() =>
      parseBindWorkspaceGitRepositoryPayload({ workspaceId: 'ws_1', repositoryUrl: ' ' }),
    ).toThrow(/Invalid bind-workspace-git-repository/);
  });

  it('validates explicit worktree conflict resolution', () => {
    expect(
      parseResolveWorktreeIntegrationPayload({
        childTaskId: ' child-1 ',
        strategy: 'accept-child',
      }),
    ).toEqual({ childTaskId: 'child-1', strategy: 'accept-child' });
    expect(() =>
      parseResolveWorktreeIntegrationPayload({ childTaskId: 'child-1', strategy: 'merge-all' }),
    ).toThrow(/Invalid resolve-worktree-integration/);
  });

  it('validates guarded empty-task disposal without accepting extra fields', () => {
    expect(
      parseDiscardEmptyTaskPayload({ taskId: ' task-blank ', expectedTaskVersion: 0 }),
    ).toEqual({ taskId: 'task-blank', expectedTaskVersion: 0 });
    expect(() =>
      parseDiscardEmptyTaskPayload({
        taskId: 'task-blank',
        expectedTaskVersion: 0,
        force: true,
      }),
    ).toThrow(/Invalid discard-empty-task/);
    expect(() =>
      parseDiscardEmptyTaskPayload({ taskId: 'task-blank', expectedTaskVersion: -1 }),
    ).toThrow(/Invalid discard-empty-task/);
  });

  it('accepts empty list-workspaces payload', () => {
    expect(parseListWorkspacesPayload(undefined)).toEqual({});
    expect(parseListWorkspacesPayload({})).toEqual({});
    expect(() => parseListWorkspacesPayload([])).toThrow(/Invalid list-workspaces/);
  });

  it('validates task create/list/open/search payloads', () => {
    expect(
      parseCreateTaskPayload({
        workspaceId: 'ws_1',
        title: '恢复主链',
        goal: '验证 checkpoint',
        agentVersionId: 'agent-version-1',
      }),
    ).toMatchObject({
      workspaceId: 'ws_1',
      title: '恢复主链',
      goal: '验证 checkpoint',
      agentVersionId: 'agent-version-1',
    });
    expect(() =>
      parseCreateTaskPayload({
        workspaceId: 'ws_1',
        title: '无效智能体',
        goal: '拒绝错误类型',
        agentVersionId: 1,
      }),
    ).toThrow(/Invalid create-task/);
    expect(parseListTasksPayload({ workspaceId: 'ws_1' })).toEqual({ workspaceId: 'ws_1' });
    expect(parseOpenTaskPayload({ taskId: 'task_1' })).toEqual({ taskId: 'task_1' });
    expect(parseSearchTasksPayload({ workspaceId: 'ws_1', query: '恢复' })).toEqual({
      workspaceId: 'ws_1',
      query: '恢复',
    });
    expect(() => parseListTasksPayload({})).toThrow(/Invalid list-tasks/);
    expect(() => parseOpenTaskPayload({ taskId: '' })).toThrow(/Invalid open-task/);
    expect(() => parseSearchTasksPayload({ workspaceId: 'ws_1', query: 'x'.repeat(513) })).toThrow(
      /Invalid search-tasks/,
    );
  });

  it('normalizes bounded acceptance criteria and rejects every oversized shape', () => {
    const base = {
      workspaceId: 'ws_criteria',
      title: 'Criteria',
      goal: 'Bound criteria before IPC',
    };
    expect(parseCreateTaskPayload({ ...base, acceptanceCriteria: ['  exact  '] })).toMatchObject({
      acceptanceCriteria: ['exact'],
    });
    expect(parseCreateTaskPayload({ ...base, acceptanceCriteria: [] })).toMatchObject({
      acceptanceCriteria: [],
    });
    for (const acceptanceCriteria of [
      Array.from({ length: 65 }, (_, index) => `criterion-${index}`),
      ['x'.repeat(4_001)],
      Array.from({ length: 17 }, () => 'x'.repeat(4_000)),
      ['   '],
    ]) {
      expect(() => parseCreateTaskPayload({ ...base, acceptanceCriteria })).toThrow(
        /Invalid create-task/,
      );
    }
  });
});
