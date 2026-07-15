import { describe, expect, it } from 'vitest';
import { parseCreateTaskPayload } from './command-validation.js';

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
