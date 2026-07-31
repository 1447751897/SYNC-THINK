import { describe, expect, it } from 'vitest';
import { resolveRunSkillSelection } from './run-skill-selection.js';

const records = new Map([
  ['skill-a', { id: 'skill-a', archived: false, permissionApproved: true }],
  ['skill-b', { id: 'skill-b', archived: false, permissionApproved: true }],
  ['skill-archived', { id: 'skill-archived', archived: true, permissionApproved: true }],
  ['skill-pending', { id: 'skill-pending', archived: false, permissionApproved: false }],
]);

function resolve(selectedSkillVersionIds?: readonly string[]) {
  return resolveRunSkillSelection({
    allowlistedSkillVersionIds: ['skill-a', 'skill-b', 'skill-archived', 'skill-pending'],
    selectedSkillVersionIds,
    getSkill: (id) => records.get(id),
  });
}

describe('resolveRunSkillSelection', () => {
  it('distinguishes old-client inheritance from explicit no-Skill selection', () => {
    expect(
      resolveRunSkillSelection({
        allowlistedSkillVersionIds: ['skill-a', 'skill-b'],
        selectedSkillVersionIds: undefined,
        getSkill: (id) => records.get(id),
      }).skillVersionIds,
    ).toEqual(['skill-a', 'skill-b']);
    expect(resolve([]).skillVersionIds).toEqual([]);
  });

  it('keeps only the requested allowlisted exact versions', () => {
    expect(resolve(['skill-b', 'skill-b']).skillVersionIds).toEqual(['skill-b']);
  });

  it('rejects unallowlisted, missing, archived, and unapproved versions', () => {
    expect(() => resolve(['skill-other'])).toThrow(/not allowlisted/i);
    expect(() =>
      resolveRunSkillSelection({
        allowlistedSkillVersionIds: ['skill-missing'],
        selectedSkillVersionIds: ['skill-missing'],
        getSkill: (id) => records.get(id),
      }),
    ).toThrow(/not found/i);
    expect(() => resolve(['skill-archived'])).toThrow(/archived/i);
    expect(() => resolve(['skill-pending'])).toThrow(/not approved/i);
  });
});
