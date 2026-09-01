import type { Conversation, GlobalAgent, Team } from '@sync-think/shared';

export interface ComposeSkillOption {
  skillVersionId: string;
  name: string;
  version: string;
  description: string;
  enabled?: boolean;
}

export function resolveAppendSkillVersionIds(
  _track: Conversation['track'],
  selectedSkillVersionIds: readonly string[],
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of selectedSkillVersionIds) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
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
  _conversation: Pick<Conversation, 'track' | 'targetRef'>,
  _agents: readonly GlobalAgent[],
  _teams: readonly Team[],
): string[] {
  // Agent defaults are injected by Runtime through a separate path. Compose
  // starts empty and only carries explicit workspace-catalog picks.
  return [];
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
    if (skill && skill.enabled !== false) result.push(skill);
  }
  return result;
}
