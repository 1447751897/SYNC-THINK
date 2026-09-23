import { isRecord } from '@sync-think/shared/value-validation';

export interface PersistedKernelConversationSession {
  version: 1;
  sessionId: string;
  fingerprint: string;
  updatedAt: string;
  responseContinuationScopeId?: string;
  workspaceRoot?: string;
  contextHash?: string;
  routingHash?: string;
  lastMessageSequence?: number;
  lastMessageAt?: string;
}

export interface KernelConversationSessionSettingStore {
  get(key: string): { value: unknown } | undefined;
  set(key: string, value: unknown): unknown;
}

function parseSession(value: unknown): PersistedKernelConversationSession | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.sessionId !== 'string' ||
    !value.sessionId.trim() ||
    typeof value.fingerprint !== 'string' ||
    !value.fingerprint.trim() ||
    typeof value.updatedAt !== 'string'
  ) {
    return undefined;
  }
  return {
    version: 1,
    sessionId: value.sessionId,
    fingerprint: value.fingerprint,
    updatedAt: value.updatedAt,
    ...(typeof value.responseContinuationScopeId === 'string' &&
    value.responseContinuationScopeId.trim()
      ? { responseContinuationScopeId: value.responseContinuationScopeId.trim() }
      : {}),
    ...(typeof value.workspaceRoot === 'string' && value.workspaceRoot.trim()
      ? { workspaceRoot: value.workspaceRoot.trim() }
      : {}),
    ...(typeof value.contextHash === 'string' && value.contextHash.trim()
      ? { contextHash: value.contextHash.trim() }
      : {}),
    ...(typeof value.routingHash === 'string' && value.routingHash.trim()
      ? { routingHash: value.routingHash.trim() }
      : {}),
    ...(typeof value.lastMessageSequence === 'number' &&
    Number.isSafeInteger(value.lastMessageSequence) &&
    value.lastMessageSequence >= 0
      ? { lastMessageSequence: value.lastMessageSequence }
      : {}),
    ...(typeof value.lastMessageAt === 'string' && value.lastMessageAt.trim()
      ? { lastMessageAt: value.lastMessageAt.trim() }
      : {}),
  };
}

/** Owns durable external-kernel session parsing, read-through caching, and persistence. */
export class KernelConversationSessionRepository {
  private readonly sessions = new Map<string, PersistedKernelConversationSession>();

  constructor(private readonly settings?: KernelConversationSessionSettingStore) {}

  load(key: string): PersistedKernelConversationSession | undefined {
    const cached = this.sessions.get(key);
    if (cached) return cached;
    const persisted = parseSession(this.settings?.get(key)?.value);
    if (persisted) this.sessions.set(key, persisted);
    return persisted;
  }

  save(
    key: string,
    session: PersistedKernelConversationSession,
  ): PersistedKernelConversationSession | undefined {
    const previous = this.load(key);
    this.sessions.set(key, session);
    this.settings?.set(key, session);
    return previous;
  }

  remove(key: string, expectedSessionId?: string): PersistedKernelConversationSession | undefined {
    const existing = this.load(key);
    if (!existing || (expectedSessionId && existing.sessionId !== expectedSessionId)) {
      return undefined;
    }
    this.sessions.delete(key);
    this.settings?.set(key, null);
    return existing;
  }
}
