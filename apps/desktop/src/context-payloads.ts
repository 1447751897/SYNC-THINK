import type { AmendContextPacketPayload, PeekContextPacketPayload } from '@sync-think/protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parsePeekContextPacketPayload(value: unknown): PeekContextPacketPayload {
  if (!isRecord(value)) throw new Error('Invalid peek-context-packet payload');
  if (typeof value.threadId !== 'string' || value.threadId.trim().length === 0) {
    throw new Error('Invalid peek-context-packet payload');
  }
  for (const field of ['modelId', 'credentialRefId', 'agentVersionId', 'userText'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      throw new Error('Invalid peek-context-packet payload');
    }
  }
  if (typeof value.userText === 'string' && value.userText.length > 100_000) {
    throw new Error('Invalid peek-context-packet payload');
  }
  return {
    threadId: value.threadId.trim() as PeekContextPacketPayload['threadId'],
    modelId: typeof value.modelId === 'string' ? value.modelId : undefined,
    credentialRefId:
      typeof value.credentialRefId === 'string'
        ? (value.credentialRefId as PeekContextPacketPayload['credentialRefId'])
        : undefined,
    agentVersionId:
      typeof value.agentVersionId === 'string'
        ? (value.agentVersionId as PeekContextPacketPayload['agentVersionId'])
        : undefined,
    userText: typeof value.userText === 'string' ? value.userText : undefined,
  };
}

export function parseAmendContextPacketPayload(value: unknown): AmendContextPacketPayload {
  if (!isRecord(value)) throw new Error('Invalid amend-context-packet payload');
  if (typeof value.threadId !== 'string' || value.threadId.trim().length === 0) {
    throw new Error('Invalid amend-context-packet payload');
  }
  if (value.clearAll !== undefined && typeof value.clearAll !== 'boolean') {
    throw new Error('Invalid amend-context-packet payload');
  }
  if (value.excludeSourceIds !== undefined) {
    if (!Array.isArray(value.excludeSourceIds)) {
      throw new Error('Invalid amend-context-packet payload');
    }
    if (value.excludeSourceIds.length > 256) {
      throw new Error('Invalid amend-context-packet payload');
    }
    for (const id of value.excludeSourceIds) {
      if (typeof id !== 'string' || id.trim().length === 0 || id.length > 256) {
        throw new Error('Invalid amend-context-packet payload');
      }
    }
  }
  return {
    threadId: value.threadId.trim() as AmendContextPacketPayload['threadId'],
    excludeSourceIds: Array.isArray(value.excludeSourceIds)
      ? value.excludeSourceIds.map((id) => String(id).trim()).filter(Boolean)
      : undefined,
    clearAll: typeof value.clearAll === 'boolean' ? value.clearAll : undefined,
  };
}
