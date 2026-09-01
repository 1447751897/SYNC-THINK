import { describe, expect, it } from 'vitest';
import {
  MAX_SKILL_SELECTION_ITEMS,
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

  it('accepts more than eight unique versions and rejects oversized payloads', () => {
    const nine = Array.from({ length: 9 }, (_, index) => `skill-v${index}`);
    expect(normalizeSelectedSkillVersionIds(nine)).toEqual(nine);
    expect(() => normalizeSelectedSkillVersionIds([''])).toThrow(/skill version id/i);
    expect(() => normalizeSelectedSkillVersionIds([1])).toThrow(/skill version id/i);
    expect(() => normalizeSelectedSkillVersionIds('skill-v1')).toThrow(/array/i);
    expect(() =>
      normalizeSelectedSkillVersionIds(
        Array.from({ length: MAX_SKILL_SELECTION_ITEMS + 1 }, (_, index) => `skill-v${index}`),
      ),
    ).toThrow(/too large/i);
  });
});
