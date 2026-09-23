import type { PlatformToolContext } from './platform-tools.js';

export interface PlatformAgentSourceRecord {
  id: string;
  name: string;
  avatar: string;
  description: string;
  source: string;
  availabilityScope: string;
  defaultModelId: string;
  skillIds: readonly string[];
  mcpServerIds: readonly string[];
}

export interface PlatformAgentSource {
  listEffective(workspaceId: string): readonly PlatformAgentSourceRecord[];
}

export function createPlatformAgentStoreAdapter(
  source: PlatformAgentSource,
): NonNullable<PlatformToolContext['agentStore']> {
  return {
    listEffective: (workspaceId) =>
      source.listEffective(workspaceId).map((record) => ({
        id: String(record.id),
        name: record.name,
        avatar: record.avatar,
        description: record.description,
        source: record.source,
        availabilityScope: record.availabilityScope,
        defaultModelId: String(record.defaultModelId),
        skillIds: [...record.skillIds],
        mcpServerIds: [...record.mcpServerIds],
      })),
  };
}
