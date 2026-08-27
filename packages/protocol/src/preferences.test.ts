import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERSONALIZATION_SETTING,
  PERSONALIZATION_LIMITS,
  normalizePersonalizationSetting,
} from './preferences.js';

describe('personalization setting', () => {
  it('normalizes missing and malformed values', () => {
    expect(normalizePersonalizationSetting(undefined)).toEqual(DEFAULT_PERSONALIZATION_SETTING);
    expect(normalizePersonalizationSetting([])).toEqual(DEFAULT_PERSONALIZATION_SETTING);
    expect(normalizePersonalizationSetting({ name: 42, globalPrompt: false })).toEqual(
      DEFAULT_PERSONALIZATION_SETTING,
    );
  });

  it('bounds every user-controlled prompt field', () => {
    const normalized = normalizePersonalizationSetting({
      name: 'n'.repeat(100),
      workDescription: 'w'.repeat(3_000),
      globalPrompt: 'p'.repeat(20_000),
    });

    expect(normalized.name).toHaveLength(PERSONALIZATION_LIMITS.name);
    expect(normalized.workDescription).toHaveLength(PERSONALIZATION_LIMITS.workDescription);
    expect(normalized.globalPrompt).toHaveLength(PERSONALIZATION_LIMITS.globalPrompt);
  });
});
