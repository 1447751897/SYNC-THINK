import type { Conversation, GlobalAgent, Team } from '@sync-think/shared';

export interface ComposeSkillOption {
  skillVersionId: string;
  name: string;
  version: string;
  description: string;
}

export const MAX_TURN_SKILL_SELECTION = 8;

export function resolveAppendSkillVersionIds(
  track: Conversation['track'],
  selectedSkillVersionIds: readonly string[],
): string[] {
  if (track === 'model') return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of selectedSkillVersionIds) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length === MAX_TURN_SKILL_SELECTION) break;
  }
  return result;
}

export function resolveConversationSkillOwner(
  conversation: Pick<Conversation, 'track' | 'targetRef'>,
  agents: readonly GlobalAgent[],
  teams: readonly Team[],
): GlobalAgent | undefined {
  if (conversation.track === 'model') return undefined;
  if (conversation.track === 'agent') {
    return agents.find((agent) => String(agent.id) === String(conversation.targetRef));
  }
  const team = teams.find((candidate) => String(candidate.id) === String(conversation.targetRef));
  const ownerId = team?.coordinatorAgentId ?? team?.members[0]?.agentId;
  return ownerId
    ? agents.find((agent) => String(agent.id) === String(ownerId))
    : undefined;
}

export function resolveDefaultComposeSkillVersionIds(
  conversation: Pick<Conversation, 'track' | 'targetRef'>,
  agents: readonly GlobalAgent[],
  teams: readonly Team[],
): string[] {
  const owner = resolveConversationSkillOwner(conversation, agents, teams);
  return resolveAppendSkillVersionIds(conversation.track, owner?.skillIds ?? []);
}

export function filterEquippedSkillOptions<T extends ComposeSkillOption>(
  allowlistedSkillVersionIds: readonly string[],
  catalog: readonly T[],
): T[] {
  const byId = new Map(catalog.map((skill) => [skill.skillVersionId, skill] as const));
  const result: T[] = [];
  const seen = new Set<string>();
  for (const raw of allowlistedSkillVersionIds) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const skill = byId.get(id);
    if (skill) result.push(skill);
  }
  return result;
}
