export interface RunSkillRecordSnapshot {
  id: string;
  enabled: boolean;
  archived: boolean;
  permissionApproved: boolean;
}

export interface ResolveRunSkillSelectionInput {
  allowlistedSkillVersionIds: readonly string[];
  /**
   * Skill versions inherited from the bound Agent/Team. These are kept in the
   * final run selection even when the composer sends no extra Skill ids.
   */
  inheritedSkillVersionIds?: readonly string[];
  /** Undefined preserves the older client behavior of using the full allowlist. */
  selectedSkillVersionIds?: readonly string[];
  getSkill(skillVersionId: string): RunSkillRecordSnapshot | undefined;
}

export interface ResolvedRunSkillSelection {
  requestedSkillVersionIds: string[];
  skillVersionIds: string[];
  inheritedAgentAllowlist: boolean;
}

function uniqueIds(ids: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/** Resolve and authorize one turn's exact SkillVersion snapshot. */
export function resolveRunSkillSelection(
  input: ResolveRunSkillSelectionInput,
): ResolvedRunSkillSelection {
  const allowlisted = uniqueIds(input.allowlistedSkillVersionIds);
  const inherited =
    input.inheritedSkillVersionIds === undefined
      ? []
      : uniqueIds(input.inheritedSkillVersionIds);
  const selected =
    input.selectedSkillVersionIds === undefined
      ? undefined
      : uniqueIds(input.selectedSkillVersionIds);
  const requested = selected === undefined ? [...allowlisted] : selected;
  const effective =
    input.inheritedSkillVersionIds === undefined
      ? [...requested]
      : uniqueIds([...inherited, ...(selected ?? [])]);
  const allowed = new Set(allowlisted);
  for (const id of effective) {
    if (!allowed.has(id)) {
      throw new Error(`Skill version is not on this run's allowlist: ${id}`);
    }
    const skill = input.getSkill(id);
    if (!skill) throw new Error(`Skill version not found: ${id}`);
    if (skill.archived) throw new Error(`Skill version is archived: ${id}`);
    if (!skill.enabled) throw new Error(`Skill version is not enabled: ${id}`);
    if (!skill.permissionApproved) throw new Error(`Skill version is not approved: ${id}`);
  }

  return {
    requestedSkillVersionIds: requested,
    skillVersionIds: effective,
    inheritedAgentAllowlist: input.selectedSkillVersionIds === undefined,
  };
}
