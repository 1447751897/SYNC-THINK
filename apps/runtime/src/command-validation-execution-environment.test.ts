import { describe, expect, it } from 'vitest';
import {
  parseBindWorkspaceGitRepositoryPayload,
  parseCreateBrowserIdentityPayload,
  parseSetTaskBrowserIdentityPayload,
  parseUpdateBrowserIdentityPayload,
} from './command-validation.js';

describe('project execution environment command validation', () => {
  it('accepts a bounded repository URL and optional base ref', () => {
    expect(
      parseBindWorkspaceGitRepositoryPayload({
        workspaceId: 'workspace-1',
        repositoryUrl: 'https://github.com/example/project.git',
        defaultRef: 'main',
      }),
    ).toEqual({
      workspaceId: 'workspace-1',
      repositoryUrl: 'https://github.com/example/project.git',
      defaultRef: 'main',
    });
    expect(
      parseBindWorkspaceGitRepositoryPayload({
        workspaceId: 'workspace-1',
        repositoryUrl: '',
      }),
    ).toBeUndefined();
  });

  it('validates browser identity management and task pinning', () => {
    expect(parseCreateBrowserIdentityPayload({ name: ' 工作账号 ', makeDefault: true })).toEqual({
      name: '工作账号',
      makeDefault: true,
    });
    expect(parseUpdateBrowserIdentityPayload({ id: 'browser-1', name: '发布账号' })).toEqual({
      id: 'browser-1',
      name: '发布账号',
    });
    expect(
      parseSetTaskBrowserIdentityPayload({
        taskId: 'task-1',
        browserIdentityId: 'browser-1',
      }),
    ).toEqual({ taskId: 'task-1', browserIdentityId: 'browser-1' });
    expect(parseCreateBrowserIdentityPayload({ name: '' })).toBeUndefined();
  });
});
