export const MAX_TURN_SKILL_VERSIONS = 8;
const MAX_SKILL_VERSION_ID_LENGTH = 256;
const MAX_RAW_SKILL_SELECTION_ITEMS = 64;

/**
 * Normalize the optional per-turn Skill selection at every process boundary.
 * `undefined` remains distinguishable from an explicit empty selection.
 */
export function normalizeSelectedSkillVersionIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TypeError('Selected Skill versions must be an array');
  }
  if (value.length > MAX_RAW_SKILL_SELECTION_ITEMS) {
    throw new TypeError('Selected Skill version array is too large');
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') {
      throw new TypeError('Each Skill version id must be a string');
    }
    const id = raw.trim();
    if (!id || id.length > MAX_SKILL_VERSION_ID_LENGTH) {
      throw new TypeError('Each Skill version id must be non-empty and at most 256 characters');
    }
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
    if (normalized.length > MAX_TURN_SKILL_VERSIONS) {
      throw new TypeError(`A turn may select at most ${MAX_TURN_SKILL_VERSIONS} Skill versions`);
    }
  }
  return normalized;
}
