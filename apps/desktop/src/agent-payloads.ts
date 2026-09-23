import type { GetAgentPayload, UpdateAgentBindingPayload } from '@sync-think/protocol';

import { isRecord } from '@sync-think/shared/value-validation';

export function parseGetAgentPayload(value: unknown): GetAgentPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('Invalid get-agent payload');
  if (value.agentId !== undefined && typeof value.agentId !== 'string') {
    throw new Error('Invalid get-agent payload');
  }
  return {
    agentId: value.agentId as GetAgentPayload['agentId'],
  };
}

export function parseUpdateAgentBindingPayload(value: unknown): UpdateAgentBindingPayload {
  if (!isRecord(value)) throw new Error('Invalid update-agent-binding payload');
  if (
    typeof value.defaultModelId !== 'string' ||
    value.defaultModelId.trim().length === 0 ||
    !Array.isArray(value.fallbackModelIds)
  ) {
    throw new Error('Invalid update-agent-binding payload');
  }
  for (const id of value.fallbackModelIds) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('Invalid update-agent-binding payload');
    }
  }
  if (value.pauseOnFailure !== undefined && typeof value.pauseOnFailure !== 'boolean') {
    throw new Error('Invalid update-agent-binding payload');
  }
  let skillVersionIds: string[] | undefined;
  if (value.skillVersionIds !== undefined) {
    if (!Array.isArray(value.skillVersionIds))
      throw new Error('Invalid update-agent-binding payload');
    skillVersionIds = [];
    for (const id of value.skillVersionIds) {
      if (typeof id !== 'string' || id.trim().length === 0) {
        throw new Error('Invalid update-agent-binding payload');
      }
      skillVersionIds.push(id.trim());
    }
  }
  let mcpServerIds: string[] | undefined;
  if (value.mcpServerIds !== undefined) {
    if (!Array.isArray(value.mcpServerIds)) throw new Error('Invalid update-agent-binding payload');
    mcpServerIds = [];
    for (const id of value.mcpServerIds) {
      if (typeof id !== 'string' || id.trim().length === 0) {
        throw new Error('Invalid update-agent-binding payload');
      }
      mcpServerIds.push(id.trim());
    }
  }
  return {
    agentId: value.agentId as UpdateAgentBindingPayload['agentId'],
    defaultModelId: value.defaultModelId.trim() as UpdateAgentBindingPayload['defaultModelId'],
    fallbackModelIds: (value.fallbackModelIds as string[]).map(
      (id) => id.trim() as UpdateAgentBindingPayload['fallbackModelIds'][number],
    ),
    pauseOnFailure: value.pauseOnFailure as boolean | undefined,
    defaultCredentialGroupId:
      typeof value.defaultCredentialGroupId === 'string'
        ? (value.defaultCredentialGroupId.trim() as UpdateAgentBindingPayload['defaultCredentialGroupId'])
        : (value.defaultCredentialGroupId as UpdateAgentBindingPayload['defaultCredentialGroupId']),
    pinnedCredentialRefId:
      value.pinnedCredentialRefId === null
        ? null
        : typeof value.pinnedCredentialRefId === 'string'
          ? (value.pinnedCredentialRefId.trim() as UpdateAgentBindingPayload['pinnedCredentialRefId'])
          : (value.pinnedCredentialRefId as UpdateAgentBindingPayload['pinnedCredentialRefId']),
    skillVersionIds,
    mcpServerIds,
  };
}
