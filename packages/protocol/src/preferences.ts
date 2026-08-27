export const PERSONALIZATION_SETTING_KEY = 'preferences.personalization' as const;

export const PERSONALIZATION_LIMITS = {
  name: 24,
  workDescription: 2_000,
  globalPrompt: 12_000,
} as const;

export interface PersonalizationSetting {
  name: string;
  workDescription: string;
  globalPrompt: string;
}

export const DEFAULT_PERSONALIZATION_SETTING: PersonalizationSetting = {
  name: '',
  workDescription: '',
  globalPrompt: '',
};

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

export function normalizePersonalizationSetting(value: unknown): PersonalizationSetting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_PERSONALIZATION_SETTING };
  }
  const record = value as Record<string, unknown>;
  return {
    name: boundedText(record.name, PERSONALIZATION_LIMITS.name),
    workDescription: boundedText(record.workDescription, PERSONALIZATION_LIMITS.workDescription),
    globalPrompt: boundedText(record.globalPrompt, PERSONALIZATION_LIMITS.globalPrompt),
  };
}
