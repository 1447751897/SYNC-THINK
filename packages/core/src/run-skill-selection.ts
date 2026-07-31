export interface RunSkillRecordSnapshot {
  id: string;
  archived: boolean;
  permissionApproved: boolean;
}

export interface ResolveRunSkillSelectionInput {
  allowlistedSkillVersionIds: readonly string[];
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
  const requested =
    input.selectedSkillVersionIds === undefined
      ? [...allowlisted]
      : uniqueIds(input.selectedSkillVersionIds);
  if (requested.length > 8) {
    throw new Error('A run may use at most 8 Skill versions');
  }
  const allowlist = new Set(allowlisted);

  for (const id of requested) {
    if (!allowlist.has(id)) {
      throw new Error(`Skill version is not allowlisted for this Agent: ${id}`);
    }
    const skill = input.getSkill(id);
    if (!skill) throw new Error(`Skill version not found: ${id}`);
    if (skill.archived) throw new Error(`Skill version is archived: ${id}`);
    if (!skill.permissionApproved) throw new Error(`Skill version is not approved: ${id}`);
  }

  return {
    requestedSkillVersionIds: requested,
    skillVersionIds: requested,
    inheritedAgentAllowlist: input.selectedSkillVersionIds === undefined,
  };
}
