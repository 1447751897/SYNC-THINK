import type { GlobalAgent } from '@sync-think/shared';

/** Full update payload for `updateGlobalAgent`, preserving every field not overridden. */
export function updateAgentPayload(agent: GlobalAgent, overrides: Partial<GlobalAgent> = {}) {
  const next = { ...agent, ...overrides };
  return {
    agentId: next.id,
    name: next.name,
    avatar: next.avatar,
    description: next.description,
    persona: next.persona,
    defaultModelId: next.defaultModelId,
    defaultKernelId: next.defaultKernelId ?? 'native',
    fallbackModelIds: next.fallbackModelIds ?? [],
    skillIds: next.skillIds ?? [],
    mcpServerIds: next.mcpServerIds ?? [],
    reasoningEffort: next.reasoningEffort || 'auto',
    availabilityScope: next.availabilityScope ?? 'global',
    writePolicy: next.writePolicy ?? 'inherit',
  };
}
