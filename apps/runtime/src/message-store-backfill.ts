// Idempotent projection of durable chat events into SqliteMessageStore (S1).
// Safe to re-run: same message ids are skipped when already present; image attach merges blocks.
import type {
  Event,
  Message,
  MessageBlock,
  MessageId,
  ModelId,
  RunId,
  ThreadId,
} from '@sync-think/shared';
import { MessageStoreError, type SqliteMessageStore } from '@sync-think/storage';

export const MESSAGE_STORE_BACKFILL_SETTING_KEY = 'message-store-backfill';
export const MESSAGE_STORE_BACKFILL_VERSION = 1;

export interface MessageStoreBackfillProgress {
  version: number;
  lastEventSequence: number;
  lastEventId?: string;
  processedEvents: number;
  writtenMessages: number;
  updatedMessages: number;
  skippedEvents: number;
  completedAt?: string;
}

export interface MessageStoreBackfillResult extends MessageStoreBackfillProgress {
  fromSequence: number;
  toSequence: number;
}

export interface MessageStoreLike {
  nextSequence(threadId: ThreadId): number;
  getMessage(messageId: MessageId): Message | undefined;
  createFinalMessage(message: Message): Message;
  updateBlocks(messageId: MessageId, blocks: readonly MessageBlock[]): Message;
}

const MESSAGE_ROLES = new Set(['user', 'assistant', 'system', 'tool']);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseImageRefs(
  value: unknown,
): Array<{ id: string; name: string; mimeType: string; storageRef: string }> {
  if (!Array.isArray(value)) return [];
  const images: Array<{ id: string; name: string; mimeType: string; storageRef: string }> = [];
  for (const entry of value) {
    const image = asRecord(entry);
    if (!image) continue;
    const id = typeof image.id === 'string' ? image.id : '';
    const name = typeof image.name === 'string' ? image.name : '';
    const mimeType = typeof image.mimeType === 'string' ? image.mimeType : '';
    const storageRef = typeof image.storageRef === 'string' ? image.storageRef : '';
    if (!id || !name || !mimeType.startsWith('image/') || !/^[A-Za-z0-9._-]+$/.test(storageRef)) {
      continue;
    }
    images.push({ id, name, mimeType, storageRef });
  }
  return images;
}

function mergeImageBlocks(
  existing: readonly MessageBlock[],
  images: Array<{ id: string; name: string; mimeType: string; storageRef: string }>,
): MessageBlock[] {
  const blocks: MessageBlock[] = [...existing];
  if (!blocks.some((block) => block.type === 'text')) {
    blocks.unshift({ type: 'text', text: '' });
  }
  const seen = new Set(
    existing
      .filter((block) => block.type === 'image')
      .map((block) => {
        const payload = asRecord(block.payload);
        return typeof payload?.storageRef === 'string' ? payload.storageRef : '';
      })
      .filter(Boolean),
  );
  for (const image of images) {
    if (seen.has(image.storageRef)) continue;
    seen.add(image.storageRef);
    blocks.push({
      type: 'image',
      payload: {
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        storageRef: image.storageRef,
      },
    });
  }
  return blocks;
}

function writeMessage(store: MessageStoreLike, message: Message): 'written' | 'skipped' {
  if (store.getMessage(message.id)) return 'skipped';
  try {
    store.createFinalMessage(message);
    return 'written';
  } catch (error) {
    if (error instanceof MessageStoreError && error.code === 'message.conflict') {
      return 'skipped';
    }
    // Missing thread / invalid payload — skip this event, keep backfill moving.
    if (error instanceof MessageStoreError) return 'skipped';
    throw error;
  }
}

/**
 * Project chat-relevant durable events into the message table.
 * Only processes events after the exclusive (sequence,eventId) cursor.
 */
export function backfillMessagesFromEvents(
  store: MessageStoreLike,
  events: readonly Event[],
  options: { afterSequence?: number; afterEventId?: string } = {},
): MessageStoreBackfillResult {
  const afterSequence =
    typeof options.afterSequence === 'number' && Number.isSafeInteger(options.afterSequence)
      ? Math.max(0, options.afterSequence)
      : 0;

  const afterEventId = typeof options.afterEventId === 'string' ? options.afterEventId : undefined;

  let processedEvents = 0;
  let writtenMessages = 0;
  let updatedMessages = 0;
  let skippedEvents = 0;
  let toSequence = afterSequence;

  const ordered = [...events]
    .filter(
      (event) =>
        event.sequence > afterSequence ||
        (afterEventId !== undefined &&
          event.sequence === afterSequence &&
          String(event.id).localeCompare(afterEventId) > 0),
    )
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));

  for (const event of ordered) {
    toSequence = Math.max(toSequence, event.sequence);
    processedEvents += 1;
    const payload = asRecord(event.payload) ?? {};

    if (event.type === 'message.appended') {
      if (payload.compact === true) {
        skippedEvents += 1;
        continue;
      }
      const threadId =
        typeof payload.threadId === 'string' && payload.threadId
          ? (payload.threadId as ThreadId)
          : undefined;
      const role = typeof payload.role === 'string' ? payload.role : '';
      const text = typeof payload.text === 'string' ? payload.text : '';
      const messageIdRaw =
        (typeof payload.messageId === 'string' && payload.messageId) ||
        (typeof event.messageId === 'string' && event.messageId) ||
        '';
      if (!threadId || !messageIdRaw || !MESSAGE_ROLES.has(role)) {
        skippedEvents += 1;
        continue;
      }
      // Empty non-user messages are not durable chat rows.
      if (role !== 'user' && !text.trim()) {
        skippedEvents += 1;
        continue;
      }
      const messageId = messageIdRaw as MessageId;
      if (store.getMessage(messageId)) {
        skippedEvents += 1;
        continue;
      }
      const result = writeMessage(store, {
        id: messageId,
        threadId,
        role: role as Message['role'],
        sequence: store.nextSequence(threadId),
        blocks: [{ type: 'text', text }],
        createdAt: event.occurredAt,
      });
      if (result === 'written') writtenMessages += 1;
      else skippedEvents += 1;
      continue;
    }

    if (event.type === 'run.completed') {
      const threadId =
        typeof payload.threadId === 'string' && payload.threadId
          ? (payload.threadId as ThreadId)
          : undefined;
      const assistantText = typeof payload.assistantText === 'string' ? payload.assistantText : '';
      const runId =
        (typeof event.runId === 'string' && event.runId) ||
        (typeof payload.idempotencyKey === 'string' && payload.idempotencyKey) ||
        '';
      if (!threadId || !runId || !assistantText.trim()) {
        skippedEvents += 1;
        continue;
      }
      const messageId = `asst-${runId}` as MessageId;
      if (store.getMessage(messageId)) {
        skippedEvents += 1;
        continue;
      }
      const modelId =
        typeof payload.modelId === 'string' && payload.modelId
          ? (payload.modelId as ModelId)
          : undefined;
      const result = writeMessage(store, {
        id: messageId,
        threadId,
        role: 'assistant',
        sequence: store.nextSequence(threadId),
        blocks: [{ type: 'text', text: assistantText }],
        createdAt: event.occurredAt,
        runId: runId as RunId,
        ...(modelId ? { modelId } : {}),
      });
      if (result === 'written') writtenMessages += 1;
      else skippedEvents += 1;
      continue;
    }

    if (event.type === 'message.images-attached') {
      const messageIdRaw =
        (typeof payload.messageId === 'string' && payload.messageId) ||
        (typeof event.messageId === 'string' && event.messageId) ||
        '';
      const images = parseImageRefs(payload.images);
      if (!messageIdRaw || images.length === 0) {
        skippedEvents += 1;
        continue;
      }
      const messageId = messageIdRaw as MessageId;
      const existing = store.getMessage(messageId);
      if (!existing) {
        skippedEvents += 1;
        continue;
      }
      const nextBlocks = mergeImageBlocks(existing.blocks, images);
      const before = JSON.stringify(existing.blocks);
      const after = JSON.stringify(nextBlocks);
      if (before === after) {
        skippedEvents += 1;
        continue;
      }
      try {
        store.updateBlocks(messageId, nextBlocks);
        updatedMessages += 1;
      } catch {
        skippedEvents += 1;
      }
      continue;
    }

    skippedEvents += 1;
  }

  return {
    version: MESSAGE_STORE_BACKFILL_VERSION,
    lastEventSequence: toSequence,
    ...(ordered.length > 0
      ? { lastEventId: String(ordered[ordered.length - 1]!.id) }
      : afterEventId !== undefined
        ? { lastEventId: afterEventId }
        : {}),
    processedEvents,
    writtenMessages,
    updatedMessages,
    skippedEvents,
    fromSequence: afterSequence,
    toSequence,
    completedAt: new Date().toISOString(),
  };
}

export function readBackfillProgress(value: unknown): MessageStoreBackfillProgress | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const lastEventSequence = record.lastEventSequence;
  if (
    typeof lastEventSequence !== 'number' ||
    !Number.isSafeInteger(lastEventSequence) ||
    lastEventSequence < 0
  ) {
    return undefined;
  }
  return {
    version:
      typeof record.version === 'number' && Number.isSafeInteger(record.version)
        ? record.version
        : MESSAGE_STORE_BACKFILL_VERSION,
    lastEventSequence,
    ...(typeof record.lastEventId === 'string' ? { lastEventId: record.lastEventId } : {}),
    processedEvents:
      typeof record.processedEvents === 'number' && Number.isSafeInteger(record.processedEvents)
        ? record.processedEvents
        : 0,
    writtenMessages:
      typeof record.writtenMessages === 'number' && Number.isSafeInteger(record.writtenMessages)
        ? record.writtenMessages
        : 0,
    updatedMessages:
      typeof record.updatedMessages === 'number' && Number.isSafeInteger(record.updatedMessages)
        ? record.updatedMessages
        : 0,
    skippedEvents:
      typeof record.skippedEvents === 'number' && Number.isSafeInteger(record.skippedEvents)
        ? record.skippedEvents
        : 0,
    ...(typeof record.completedAt === 'string' ? { completedAt: record.completedAt } : {}),
  };
}

/** Convenience for SqliteMessageStore + optional progress store. */
export function runMessageStoreBackfill(input: {
  messageStore: SqliteMessageStore;
  events: readonly Event[];
  progress?: MessageStoreBackfillProgress;
}): MessageStoreBackfillResult {
  return backfillMessagesFromEvents(input.messageStore, input.events, {
    afterSequence: input.progress?.lastEventSequence ?? 0,
    afterEventId: input.progress?.lastEventId,
  });
}
