import type { ComposeAttachment } from './compose-mention.js';
import type { ReasoningEffort } from './compose-toolbar.js';

const COMPOSE_REQUEST_QUEUE_VERSION = 1;
const COMPOSE_REQUEST_QUEUE_PREFIX = 'sync-think.compose-request-queue.v1:';

export interface ComposeRequestQueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface QueuedComposeRequest {
  id: string;
  conversationId: string;
  createdAt: string;
  text: string;
  attachments: ComposeAttachment[];
  modelOverride: string;
  reasoningEffort: ReasoningEffort;
  networkEnabled: boolean;
  skillVersionIds: string[];
  /** Kernel the message was composed under; queued interjections must keep it. */
  kernelOverride: string;
}

export type CreateQueuedComposeRequestInput = Omit<
  QueuedComposeRequest,
  'id' | 'createdAt'
>;

interface PersistedComposeRequestQueue {
  version: typeof COMPOSE_REQUEST_QUEUE_VERSION;
  items: QueuedComposeRequest[];
}

const VALID_REASONING_EFFORTS: ReadonlySet<ReasoningEffort> = new Set([
  'auto',
  'minimal',
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

function cloneAttachment(attachment: ComposeAttachment): ComposeAttachment {
  return { ...attachment };
}

function cloneQueuedComposeRequest(request: QueuedComposeRequest): QueuedComposeRequest {
  return {
    ...request,
    attachments: request.attachments.map(cloneAttachment),
    skillVersionIds: [...request.skillVersionIds],
  };
}

function createQueueId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ? `compose-request-${randomId}` : `compose-request-${Date.now()}-${Math.random()}`;
}

function isComposeAttachment(value: unknown): value is ComposeAttachment {
  if (!value || typeof value !== 'object') return false;
  const attachment = value as Record<string, unknown>;
  return (
    typeof attachment.path === 'string' &&
    typeof attachment.name === 'string' &&
    (attachment.kind === 'file' ||
      attachment.kind === 'dir' ||
      attachment.kind === 'image') &&
    (attachment.previewUrl === undefined || typeof attachment.previewUrl === 'string') &&
    (attachment.mimeType === undefined || typeof attachment.mimeType === 'string') &&
    (attachment.sizeBytes === undefined ||
      (typeof attachment.sizeBytes === 'number' && Number.isFinite(attachment.sizeBytes)))
  );
}

function parseQueuedComposeRequest(
  value: unknown,
  conversationId: string,
): QueuedComposeRequest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const request = value as Record<string, unknown>;
  if (
    typeof request.id !== 'string' ||
    !request.id ||
    request.conversationId !== conversationId ||
    typeof request.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(request.createdAt)) ||
    typeof request.text !== 'string' ||
    !Array.isArray(request.attachments) ||
    !request.attachments.every(isComposeAttachment) ||
    typeof request.modelOverride !== 'string' ||
    typeof request.reasoningEffort !== 'string' ||
    !VALID_REASONING_EFFORTS.has(request.reasoningEffort as ReasoningEffort) ||
    typeof request.networkEnabled !== 'boolean' ||
    !Array.isArray(request.skillVersionIds) ||
    !request.skillVersionIds.every((skillVersionId) => typeof skillVersionId === 'string') ||
    (request.kernelOverride !== undefined && typeof request.kernelOverride !== 'string')
  ) {
    return undefined;
  }
  const parsed = request as unknown as QueuedComposeRequest;
  // Legacy queued entries (pre multi-kernel) carry no kernel; default to native.
  return cloneQueuedComposeRequest({
    ...parsed,
    kernelOverride: typeof request.kernelOverride === 'string' ? request.kernelOverride : 'native',
  });
}

function resolveStorage(
  storage?: ComposeRequestQueueStorage,
): ComposeRequestQueueStorage | undefined {
  if (storage) return storage;
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function composeRequestQueueStorageKey(conversationId: string): string {
  return `${COMPOSE_REQUEST_QUEUE_PREFIX}${conversationId}`;
}

export function createQueuedComposeRequest(
  input: CreateQueuedComposeRequestInput,
  identity: { id?: string; createdAt?: string } = {},
): QueuedComposeRequest {
  return cloneQueuedComposeRequest({
    ...input,
    id: identity.id ?? createQueueId(),
    createdAt: identity.createdAt ?? new Date().toISOString(),
  });
}

export function enqueueQueuedComposeRequest(
  queue: readonly QueuedComposeRequest[],
  request: QueuedComposeRequest,
): QueuedComposeRequest[] {
  return [...queue.map(cloneQueuedComposeRequest), cloneQueuedComposeRequest(request)];
}

export function updateQueuedComposeRequest(
  queue: readonly QueuedComposeRequest[],
  requestId: string,
  update: Partial<
    Pick<
      QueuedComposeRequest,
      | 'text'
      | 'attachments'
      | 'modelOverride'
      | 'reasoningEffort'
      | 'networkEnabled'
      | 'skillVersionIds'
    >
  >,
): QueuedComposeRequest[] {
  return queue.map((request) =>
    request.id === requestId
      ? cloneQueuedComposeRequest({
          ...request,
          ...update,
          attachments: update.attachments
            ? update.attachments.map(cloneAttachment)
            : request.attachments,
          skillVersionIds: update.skillVersionIds
            ? [...update.skillVersionIds]
            : request.skillVersionIds,
        })
      : request,
  );
}

export function removeQueuedComposeRequest(
  queue: readonly QueuedComposeRequest[],
  requestId: string,
): QueuedComposeRequest[] {
  return queue.filter((request) => request.id !== requestId);
}

export function readQueuedComposeRequests(
  conversationId: string,
  storage?: ComposeRequestQueueStorage,
): QueuedComposeRequest[] {
  const target = resolveStorage(storage);
  if (!target) return [];
  try {
    const raw = target.getItem(composeRequestQueueStorageKey(conversationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PersistedComposeRequestQueue>;
    if (
      parsed.version !== COMPOSE_REQUEST_QUEUE_VERSION ||
      !Array.isArray(parsed.items)
    ) {
      return [];
    }
    return parsed.items.flatMap((item) => {
      const request = parseQueuedComposeRequest(item, conversationId);
      return request ? [request] : [];
    });
  } catch {
    return [];
  }
}

export function writeQueuedComposeRequests(
  conversationId: string,
  queue: readonly QueuedComposeRequest[],
  storage?: ComposeRequestQueueStorage,
): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    const key = composeRequestQueueStorageKey(conversationId);
    if (queue.length === 0) {
      target.removeItem(key);
      return true;
    }
    const payload: PersistedComposeRequestQueue = {
      version: COMPOSE_REQUEST_QUEUE_VERSION,
      items: queue
        .filter((request) => request.conversationId === conversationId)
        .map(cloneQueuedComposeRequest),
    };
    target.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}
