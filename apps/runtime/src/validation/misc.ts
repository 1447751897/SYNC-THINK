// misc command payload parsers (extracted from command-validation.ts).
import type { ListPoliciesPayload, ProbeCapabilitiesPayload, ConfirmCapabilitiesPayload } from '@sync-think/protocol';
import { isRecord } from './shared.js';

export function parseListPoliciesPayload(value: unknown): ListPoliciesPayload | undefined {
  if (!isRecord(value) || Object.hasOwn(value, 'scopes')) return undefined;
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.trim().length === 0 ||
    value.workspaceId.length > 256
  ) {
    return undefined;
  }
  for (const field of ['taskId', 'agentId'] as const) {
    if (
      value[field] !== undefined &&
      (typeof value[field] !== 'string' ||
        value[field].trim().length === 0 ||
        value[field].length > 256)
    ) {
      return undefined;
    }
  }
  return {
    workspaceId: value.workspaceId.trim() as ListPoliciesPayload['workspaceId'],
    taskId:
      typeof value.taskId === 'string'
        ? (value.taskId.trim() as ListPoliciesPayload['taskId'])
        : undefined,
    agentId:
      typeof value.agentId === 'string'
        ? (value.agentId.trim() as ListPoliciesPayload['agentId'])
        : undefined,
  };
}

export function parseProbeCapabilitiesPayload(
  value: unknown,
): ProbeCapabilitiesPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 256
  ) {
    return undefined;
  }
  if (value.modelId !== undefined) {
    if (
      typeof value.modelId !== 'string' ||
      value.modelId.length === 0 ||
      value.modelId.length > 256
    ) {
      return undefined;
    }
  }
  return value as unknown as ProbeCapabilitiesPayload;
}

export function parseConfirmCapabilitiesPayload(
  value: unknown,
): ConfirmCapabilitiesPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.modelId !== 'string' ||
    value.modelId.length === 0 ||
    value.modelId.length > 256 ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length > 16 ||
    !value.capabilities.every((c) => typeof c === 'string')
  ) {
    return undefined;
  }
  if (value.confirmed !== undefined && typeof value.confirmed !== 'boolean') return undefined;
  return value as unknown as ConfirmCapabilitiesPayload;
}

// --- 0026: model-source config parsers ---
