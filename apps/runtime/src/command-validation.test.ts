import { describe, expect, it } from 'vitest';
import {
  parseBindWorkspaceFolderPayload,
  parseCreateTaskPayload,
  parseCreateWorkspacePayload,
} from './command-validation.js';

const validTask = {
  workspaceId: 'workspace-criteria-validation',
  title: 'Bound criteria',
  goal: 'Reject oversized acceptance criteria before persistence',
};

describe('create Task acceptance criteria validation', () => {
  it.each([
    { acceptanceCriteria: Array.from({ length: 65 }, (_, index) => `criterion-${index}`) },
    { acceptanceCriteria: ['x'.repeat(4_001)] },
    { acceptanceCriteria: Array.from({ length: 17 }, () => 'x'.repeat(4_000)) },
    { acceptanceCriteria: ['   '] },
  ])('rejects an out-of-bounds payload %#', ({ acceptanceCriteria }) => {
    expect(parseCreateTaskPayload({ ...validTask, acceptanceCriteria })).toBeUndefined();
  });

  it('returns normalized bounded criteria and allows an empty list', () => {
    expect(
      parseCreateTaskPayload({ ...validTask, acceptanceCriteria: ['  must pass  '] }),
    ).toMatchObject({ acceptanceCriteria: ['must pass'] });
    expect(parseCreateTaskPayload({ ...validTask, acceptanceCriteria: [] })).toMatchObject({
      acceptanceCriteria: [],
    });
  });
});

describe('optional project folder payload validation', () => {
  it('accepts a project without a folder and normalizes an optional folder', () => {
    expect(parseCreateWorkspacePayload({ name: '  Project Atlas  ' })).toEqual({
      name: 'Project Atlas',
      folderPath: undefined,
      allowedRoots: undefined,
    });
    expect(
      parseCreateWorkspacePayload({ name: 'Atlas', folderPath: ' D:/projects/atlas ' }),
    ).toMatchObject({ name: 'Atlas', folderPath: 'D:/projects/atlas' });
  });

  it('validates explicit folder binding before it reaches storage', () => {
    expect(
      parseBindWorkspaceFolderPayload({
        workspaceId: ' workspace-atlas ',
        folderPath: ' D:/projects/atlas ',
      }),
    ).toEqual({
      workspaceId: 'workspace-atlas',
      folderPath: 'D:/projects/atlas',
      allowedRoots: undefined,
    });
    expect(
      parseBindWorkspaceFolderPayload({ workspaceId: 'workspace-atlas', folderPath: '  ' }),
    ).toBeUndefined();
    expect(
      parseBindWorkspaceFolderPayload({ workspaceId: '', folderPath: 'D:/projects/atlas' }),
    ).toBeUndefined();
  });
});
