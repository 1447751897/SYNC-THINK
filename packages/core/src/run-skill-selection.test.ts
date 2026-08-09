import { describe, expect, it } from 'vitest';
import { resolveRunSkillSelection } from './run-skill-selection.js';

const records = new Map([
  ['skill-a', { id: 'skill-a', enabled: true, archived: false, permissionApproved: true }],
  ['skill-b', { id: 'skill-b', enabled: true, archived: false, permissionApproved: true }],
  [
    'skill-disabled',
    { id: 'skill-disabled', enabled: false, archived: false, permissionApproved: true },
  ],
  [
    'skill-archived',
    { id: 'skill-archived', enabled: true, archived: true, permissionApproved: true },
  ],
  [
    'skill-pending',
    { id: 'skill-pending', enabled: true, archived: false, permissionApproved: false },
  ],
]);

function resolve(selectedSkillVersionIds?: readonly string[]) {
  return resolveRunSkillSelection({
    allowlistedSkillVersionIds: [
      'skill-a',
      'skill-b',
      'skill-disabled',
      'skill-archived',
      'skill-pending',
    ],
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

  it('allows explicit selection only from the Agent allowlist', () => {
    expect(resolve(['skill-b', 'skill-b']).skillVersionIds).toEqual(['skill-b']);
    expect(
      () =>
        resolveRunSkillSelection({
          allowlistedSkillVersionIds: [],
          selectedSkillVersionIds: ['skill-a'],
          getSkill: (id) => records.get(id),
        }),
    ).toThrow(/allowlist/i);
  });

  it('keeps inherited Agent Skills and merges explicit Compose Skills', () => {
    const result = resolveRunSkillSelection({
      allowlistedSkillVersionIds: ['skill-a', 'skill-b'],
      inheritedSkillVersionIds: ['skill-a'],
      selectedSkillVersionIds: ['skill-b', 'skill-a', 'skill-b'],
      getSkill: (id) => records.get(id),
    });

    expect(result.requestedSkillVersionIds).toEqual(['skill-b', 'skill-a']);
    expect(result.skillVersionIds).toEqual(['skill-a', 'skill-b']);
    expect(result.inheritedAgentAllowlist).toBe(false);
  });

  it('retains inherited Agent Skills when Compose sends an empty selection', () => {
    const result = resolveRunSkillSelection({
      allowlistedSkillVersionIds: ['skill-a'],
      inheritedSkillVersionIds: ['skill-a'],
      selectedSkillVersionIds: [],
      getSkill: (id) => records.get(id),
    });

    expect(result.requestedSkillVersionIds).toEqual([]);
    expect(result.skillVersionIds).toEqual(['skill-a']);
  });

  it('caps the merged inherited and explicit set at eight Skill versions', () => {
    const manyRecords = new Map(
      Array.from({ length: 9 }, (_, index) => {
        const id = `skill-${index}`;
        return [
          id,
          { id, enabled: true, archived: false, permissionApproved: true },
        ] as const;
      }),
    );

    expect(() =>
      resolveRunSkillSelection({
        allowlistedSkillVersionIds: [...manyRecords.keys()],
        inheritedSkillVersionIds: ['skill-0', 'skill-1', 'skill-2', 'skill-3'],
        selectedSkillVersionIds: ['skill-4', 'skill-5', 'skill-6', 'skill-7', 'skill-8'],
        getSkill: (id) => manyRecords.get(id),
      }),
    ).toThrow(/at most 8/i);
  });

  it('rejects missing, disabled, archived, and unapproved versions', () => {
    expect(() => resolve(['skill-other'])).toThrow(/allowlist/i);
    expect(() =>
      resolveRunSkillSelection({
        allowlistedSkillVersionIds: ['skill-missing'],
        selectedSkillVersionIds: ['skill-missing'],
        getSkill: (id) => records.get(id),
      }),
    ).toThrow(/not found/i);
    expect(() => resolve(['skill-disabled'])).toThrow(/not enabled/i);
    expect(() => resolve(['skill-archived'])).toThrow(/archived/i);
    expect(() => resolve(['skill-pending'])).toThrow(/not approved/i);
  });
});
