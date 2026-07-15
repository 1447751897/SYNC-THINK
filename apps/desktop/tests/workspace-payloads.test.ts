import { describe, expect, it } from 'vitest';
import {
  parseCreateTaskPayload,
  parseCreateWorkspacePayload,
  parseListTasksPayload,
  parseListWorkspacesPayload,
  parseOpenTaskPayload,
  parseSearchTasksPayload,
} from '../src/workspace-payloads.js';

describe('desktop workspace bridge payload validation', () => {
  it('accepts valid workspace create and rejects empty path/name', () => {
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
      }),
    ).toMatchObject({
      workspaceId: 'ws_1',
      title: '恢复主链',
      goal: '验证 checkpoint',
    });
    expect(parseListTasksPayload({ workspaceId: 'ws_1' })).toEqual({ workspaceId: 'ws_1' });
    expect(parseOpenTaskPayload({ taskId: 'task_1' })).toEqual({ taskId: 'task_1' });
    expect(parseSearchTasksPayload({ workspaceId: 'ws_1', query: '恢复' })).toEqual({
      workspaceId: 'ws_1',
      query: '恢复',
    });
    expect(() => parseListTasksPayload({})).toThrow(/Invalid list-tasks/);
    expect(() => parseOpenTaskPayload({ taskId: '' })).toThrow(/Invalid open-task/);
    expect(() =>
      parseSearchTasksPayload({ workspaceId: 'ws_1', query: 'x'.repeat(513) }),
    ).toThrow(/Invalid search-tasks/);
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
