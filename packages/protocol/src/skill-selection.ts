export const MAX_SKILL_SELECTION_ITEMS = 512;
const MAX_SKILL_VERSION_ID_LENGTH = 256;

/**
 * Normalize the optional per-turn Skill selection at every process boundary.
 * `undefined` remains distinguishable from an explicit empty selection.
 * There is no product quota on unique Skill versions; the item cap is a payload DoS bound.
 */
export function normalizeSelectedSkillVersionIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TypeError('Selected Skill versions must be an array');
  }
  if (value.length > MAX_SKILL_SELECTION_ITEMS) {
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
  }
  return normalized;
}
