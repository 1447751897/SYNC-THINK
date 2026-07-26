// agent command payload parsers (extracted from command-validation.ts).
import type { GetAgentPayload, UpdateAgentBindingPayload, ListAgentsPayload, CreateAgentPayload, ListAgentVersionsPayload, CreateAgentVersionPayload, ListGlobalAgentsPayload, CreateGlobalAgentPayload, UpdateGlobalAgentPayload, DeleteGlobalAgentPayload } from '@sync-think/protocol';
import { hasOnlyKeys, isRecord, AGENT_DEFINITION_KEYS, boundedAgentText, validAgentDefinition, GLOBAL_AGENT_KEYS, validGlobalAgentFields } from './shared.js';

export function parseGetAgentPayload(value: unknown): GetAgentPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.agentId !== undefined) {
    if (
      typeof value.agentId !== 'string' ||
      value.agentId.trim().length === 0 ||
      value.agentId.length > 128
    ) {
      return undefined;
    }
  }
  return value as GetAgentPayload;
}

export function parseUpdateAgentBindingPayload(
  value: unknown,
): UpdateAgentBindingPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.defaultModelId !== 'string' ||
    value.defaultModelId.trim().length === 0 ||
    value.defaultModelId.length > 256
  ) {
    return undefined;
  }
  if (!Array.isArray(value.fallbackModelIds) || value.fallbackModelIds.length > 32) {
    return undefined;
  }
  for (const id of value.fallbackModelIds) {
    if (typeof id !== 'string' || id.trim().length === 0 || id.length > 256) {
      return undefined;
    }
  }
  if (value.agentId !== undefined) {
    if (
      typeof value.agentId !== 'string' ||
      value.agentId.trim().length === 0 ||
      value.agentId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.pauseOnFailure !== undefined && typeof value.pauseOnFailure !== 'boolean') {
    return undefined;
  }
  if (value.defaultCredentialGroupId !== undefined) {
    if (
      typeof value.defaultCredentialGroupId !== 'string' ||
      value.defaultCredentialGroupId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.pinnedCredentialRefId !== undefined && value.pinnedCredentialRefId !== null) {
    if (
      typeof value.pinnedCredentialRefId !== 'string' ||
      value.pinnedCredentialRefId.length > 128
    ) {
      return undefined;
    }
  }
  let skillVersionIds: string[] | undefined;
  if (value.skillVersionIds !== undefined) {
    if (!Array.isArray(value.skillVersionIds) || value.skillVersionIds.length > 64) {
      return undefined;
    }
    const cleaned: string[] = [];
    for (const id of value.skillVersionIds) {
      if (typeof id !== 'string' || id.trim().length === 0 || id.length > 128) return undefined;
      cleaned.push(id.trim());
    }
    skillVersionIds = cleaned;
  }
  let mcpServerIds: string[] | undefined;
  if (value.mcpServerIds !== undefined) {
    if (!Array.isArray(value.mcpServerIds) || value.mcpServerIds.length > 64) {
      return undefined;
    }
    const cleanedMcp: string[] = [];
    for (const id of value.mcpServerIds) {
      if (typeof id !== 'string' || id.trim().length === 0 || id.length > 128) return undefined;
      cleanedMcp.push(id.trim());
    }
    mcpServerIds = cleanedMcp;
  }
  return {
    agentId: value.agentId as UpdateAgentBindingPayload['agentId'],
    defaultModelId: (
      value.defaultModelId as string
    ).trim() as UpdateAgentBindingPayload['defaultModelId'],
    fallbackModelIds: (value.fallbackModelIds as string[]).map(
      (id) => id.trim() as UpdateAgentBindingPayload['fallbackModelIds'][number],
    ),
    pauseOnFailure: value.pauseOnFailure as boolean | undefined,
    defaultCredentialGroupId:
      value.defaultCredentialGroupId as UpdateAgentBindingPayload['defaultCredentialGroupId'],
    pinnedCredentialRefId:
      value.pinnedCredentialRefId as UpdateAgentBindingPayload['pinnedCredentialRefId'],
    skillVersionIds,
    mcpServerIds,
  };
}

export function parseListAgentsPayload(value: unknown): ListAgentsPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || Object.keys(value).length !== 0) return undefined;
  return {};
}

export function parseCreateAgentPayload(value: unknown): CreateAgentPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, AGENT_DEFINITION_KEYS) ||
    !validAgentDefinition(value, { full: false })
  )
    return undefined;
  return value as unknown as CreateAgentPayload;
}

export function parseListAgentVersionsPayload(
  value: unknown,
): ListAgentVersionsPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['agentId']) || !boundedAgentText(value.agentId, 128))
    return undefined;
  return { agentId: value.agentId as ListAgentVersionsPayload['agentId'] };
}

export function parseCreateAgentVersionPayload(
  value: unknown,
): CreateAgentVersionPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [...AGENT_DEFINITION_KEYS, 'expectedVersion']) ||
    !boundedAgentText(value.agentId, 128) ||
    !Number.isSafeInteger(value.expectedVersion) ||
    Number(value.expectedVersion) < 1 ||
    !validAgentDefinition(value, { full: true })
  )
    return undefined;
  return value as unknown as CreateAgentVersionPayload;
}

// --- mutable global Agent / Team / Conversation payloads (2026-07-22 model) ---

export function parseListGlobalAgentsPayload(
  value: unknown,
): ListGlobalAgentsPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || !hasOnlyKeys(value, ['includeArchived'])) return undefined;
  if (value.includeArchived !== undefined && typeof value.includeArchived !== 'boolean')
    return undefined;
  return { includeArchived: value.includeArchived };
}

export function parseCreateGlobalAgentPayload(
  value: unknown,
): CreateGlobalAgentPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, GLOBAL_AGENT_KEYS) ||
    !validGlobalAgentFields(value, { full: true })
  )
    return undefined;
  return value as unknown as CreateGlobalAgentPayload;
}

export function parseUpdateGlobalAgentPayload(
  value: unknown,
): UpdateGlobalAgentPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [...GLOBAL_AGENT_KEYS, 'agentId', 'archived']) ||
    !boundedAgentText(value.agentId, 128) ||
    !validGlobalAgentFields(value, { full: false })
  )
    return undefined;
  if (value.archived !== undefined && typeof value.archived !== 'boolean') return undefined;
  return value as unknown as UpdateGlobalAgentPayload;
}

export function parseDeleteGlobalAgentPayload(
  value: unknown,
): DeleteGlobalAgentPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['agentId']) || !boundedAgentText(value.agentId, 128))
    return undefined;
  return { agentId: value.agentId as DeleteGlobalAgentPayload['agentId'] };
}
