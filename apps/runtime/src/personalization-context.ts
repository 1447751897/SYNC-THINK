import {
  normalizePersonalizationSetting,
  type PersonalizationSetting,
} from '@sync-think/protocol/preferences';

export function buildPersonalizationInstructions(value: unknown): string | undefined {
  const profile = normalizePersonalizationSetting(value);
  const parts = [
    profile.name.trim() ? `Preferred user name: ${profile.name.trim()}` : undefined,
    profile.workDescription.trim()
      ? `User work context:\n${profile.workDescription.trim()}`
      : undefined,
    profile.globalPrompt.trim()
      ? `Global user instructions (apply to every conversation):\n${profile.globalPrompt.trim()}`
      : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? ['## User personalization', ...parts].join('\n\n') : undefined;
}

export function personalizationFingerprint(value: unknown): PersonalizationSetting {
  return normalizePersonalizationSetting(value);
}
