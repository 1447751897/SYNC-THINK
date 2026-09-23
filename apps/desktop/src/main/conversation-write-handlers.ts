import {
  normalizeSelectedSkillVersionIds,
  type AppendMessagePayload,
  type ConversationCommand,
  type ConversationCommandRequest,
  type ConversationCommandResponse,
  type MessageImageReference,
} from '@sync-think/protocol';
import {
  parseConversationCompactPayload,
  parseConversationSendMessagePayload,
} from '../team-payloads.js';

export interface StagedAppendMessageImage {
  name: string;
  mimeType: string;
  stagingPath: string;
}

export interface StagedAppendMessagePayload {
  payload: unknown;
  images: StagedAppendMessageImage[];
}

export type PersistedAppendMessageImage = MessageImageReference & { url?: string };

export interface ConversationWriteHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  stageAppendMessageImages(value: unknown): StagedAppendMessagePayload;
  persistMessageImages(
    messageId: string,
    images: readonly StagedAppendMessageImage[],
  ): PersistedAppendMessageImage[];
  requestConversation<K extends ConversationCommand>(
    command: K,
    payload: ConversationCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<ConversationCommandResponse<K>>;
}

function parseAppendMessagePayload(value: unknown): AppendMessagePayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid append-message payload');
  }
  const payload = value as Partial<AppendMessagePayload>;
  const validRoles = new Set(['user', 'assistant', 'system', 'tool']);
  const hasImages = Array.isArray(payload.images) && payload.images.length > 0;
  if (
    typeof payload.threadId !== 'string' ||
    payload.threadId.length === 0 ||
    !Number.isInteger(payload.expectedTaskVersion) ||
    (payload.expectedTaskVersion ?? -1) < 0 ||
    typeof payload.role !== 'string' ||
    !validRoles.has(payload.role) ||
    typeof payload.text !== 'string' ||
    payload.text.length > 100_000 ||
    (!hasImages && payload.text.trim().length === 0)
  ) {
    throw new Error('Invalid append-message payload');
  }
  if (payload.images !== undefined) {
    if (!Array.isArray(payload.images) || payload.images.length > 8) {
      throw new Error('Invalid append-message images');
    }
    for (const image of payload.images) {
      if (
        !image ||
        typeof image !== 'object' ||
        typeof image.name !== 'string' ||
        typeof image.mimeType !== 'string' ||
        !image.mimeType.startsWith('image/')
      ) {
        throw new Error('Invalid append-message image item');
      }
      const hasDataUrl =
        typeof image.dataUrl === 'string' &&
        image.dataUrl.startsWith('data:image/') &&
        image.dataUrl.length <= 700_000;
      const hasStagingPath =
        typeof image.stagingPath === 'string' && image.stagingPath.length > 0;
      if (!hasDataUrl && !hasStagingPath) {
        throw new Error('Invalid append-message image item');
      }
    }
  }
  if (payload.networkEnabled !== undefined && typeof payload.networkEnabled !== 'boolean') {
    throw new Error('Invalid append-message networkEnabled');
  }
  const skillVersionIds = normalizeSelectedSkillVersionIds(payload.skillVersionIds);
  return {
    ...payload,
    ...(skillVersionIds === undefined ? {} : { skillVersionIds }),
  } as AppendMessagePayload;
}

/** Conversation write IPC group. Trust, connectivity, files and transport remain host-owned. */
export function registerConversationWriteHandlers<Event>(host: ConversationWriteHost<Event>): void {
  host.handle('runtime:append-message', async (event, value: unknown) => {
    host.assertSource(event);
    await host.ensureConnection();
    const staged = host.stageAppendMessageImages(value);
    const payload = parseAppendMessagePayload(staged.payload);
    const response = await host.requestConversation('task.appendMessage', payload);
    if (staged.images.length === 0) return response;

    const images = host.persistMessageImages(String(response.messageId), staged.images);
    if (images.length > 0) {
      await host.requestConversation('message.attachImages', {
        threadId: payload.threadId,
        messageId: response.messageId,
        images: images.map(({ url: _url, ...image }) => image),
      });
    }
    return { ...response, images };
  });

  host.handle('runtime:conversation-send-message', async (event, value: unknown) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.sendMessage',
      parseConversationSendMessagePayload(value),
    );
  });

  host.handle('runtime:conversation-compact', async (event, value: unknown) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestConversation(
      'conversation.compact',
      parseConversationCompactPayload(value),
      { timeoutMs: 120_000 },
    );
  });
}
