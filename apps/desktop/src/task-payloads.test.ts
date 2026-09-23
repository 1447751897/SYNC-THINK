import { describe, expect, it } from 'vitest';
import {
  parseArchiveTaskPayload,
  parseCreateTaskPayload,
  parseListTasksPayload,
  parseOpenTaskPayload,
  parseSearchTasksPayload,
  parseUnarchiveTaskPayload,
} from './task-payloads.js';

describe('Task directory payload validation', () => {
  it('validates task create/list/open/search payloads', () => {
    expect(
      parseCreateTaskPayload({
        workspaceId: 'ws_1',
        title: '恢复主链',
        goal: '验证 checkpoint',
      }),
    ).toMatchObject({ workspaceId: 'ws_1', title: '恢复主链', goal: '验证 checkpoint' });
    expect(parseListTasksPayload({ workspaceId: 'ws_1', includeArchived: true })).toEqual({
      workspaceId: 'ws_1',
      includeArchived: true,
    });
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

  it('normalizes bounded acceptance criteria and rejects oversized shapes', () => {
    const base = {
      workspaceId: 'ws_criteria',
      title: 'Criteria',
      goal: 'Bound criteria before IPC',
    };
    expect(parseCreateTaskPayload({ ...base, acceptanceCriteria: ['  exact  '] })).toMatchObject({
      acceptanceCriteria: ['exact'],
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

  it('normalizes version-fenced archive and unarchive requests', () => {
    const payload = { taskId: 'task_1', expectedTaskVersion: 4, cascade: false };
    expect(parseArchiveTaskPayload(payload)).toEqual(payload);
    expect(parseUnarchiveTaskPayload(payload)).toEqual(payload);
  });

  it('rejects invalid archive version and cascade values', () => {
    expect(() => parseArchiveTaskPayload({ taskId: 'task_1', expectedTaskVersion: -1 })).toThrow(
      /Invalid archive-task/,
    );
    expect(() =>
      parseUnarchiveTaskPayload({ taskId: 'task_1', expectedTaskVersion: 1, cascade: 'yes' }),
    ).toThrow(/Invalid archive-task/);
  });
});
