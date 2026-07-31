import { describe, expect, it } from 'vitest';
import {
  MAX_TURN_SKILL_VERSIONS,
  normalizeSelectedSkillVersionIds,
} from './skill-selection.js';

describe('normalizeSelectedSkillVersionIds', () => {
  it('preserves compatibility undefined and explicit empty selection', () => {
    expect(normalizeSelectedSkillVersionIds(undefined)).toBeUndefined();
    expect(normalizeSelectedSkillVersionIds([])).toEqual([]);
  });

  it('trims and deduplicates exact version ids in first-seen order', () => {
    expect(
      normalizeSelectedSkillVersionIds([' skill-v2 ', 'skill-v1', 'skill-v2', 'skill-v1']),
    ).toEqual(['skill-v2', 'skill-v1']);
  });

  it('rejects malformed ids and more than eight unique versions', () => {
    expect(MAX_TURN_SKILL_VERSIONS).toBe(8);
    expect(() => normalizeSelectedSkillVersionIds([''])).toThrow(/skill version id/i);
    expect(() => normalizeSelectedSkillVersionIds([1])).toThrow(/skill version id/i);
    expect(() => normalizeSelectedSkillVersionIds('skill-v1')).toThrow(/array/i);
    expect(() =>
      normalizeSelectedSkillVersionIds(
        Array.from({ length: MAX_TURN_SKILL_VERSIONS + 1 }, (_, index) => `skill-v${index}`),
      ),
    ).toThrow(/at most 8/i);
  });
});
