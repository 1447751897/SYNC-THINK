import type {
  ConversationReadContentPayload,
  ConversationReadContentResponse,
} from '@sync-think/protocol';
import { DEFAULT_CONTENT_CHUNK_LENGTH } from '@sync-think/shared';
import { DeferredRequestReader } from './deferred-request-reader.js';
export { DeferredRequestReader } from './deferred-request-reader.js';
import type { RunProcessHistoryRequestPool } from './run-process-history-loader.js';

function validateResponse(
  payload: ConversationReadContentPayload,
  response: ConversationReadContentResponse,
): void {
  const content = response?.content;
  if (
    !content ||
    typeof content.text !== 'string' ||
    content.text.length > (payload.limit ?? DEFAULT_CONTENT_CHUNK_LENGTH) ||
    content.offset !== (payload.offset ?? 0) ||
    !Number.isSafeInteger(content.utf16Length) ||
    content.utf16Length < content.offset + content.text.length ||
    !Number.isSafeInteger(content.utf8Bytes) ||
    content.utf8Bytes < 0 ||
    typeof content.version !== 'string' ||
    !/^[a-f0-9]{64}$/.test(content.version) ||
    !['text', 'json'].includes(content.format)
  )
    throw new Error('content.invalid-response');
  const end = content.offset + content.text.length;
  if (
    end < content.utf16Length
      ? content.nextOffset !== end || end <= content.offset
      : content.nextOffset !== undefined
  )
    throw new Error('content.invalid-response');
  if (payload.version && payload.version !== content.version)
    throw new Error('content.version-changed');
}

export class DeferredContentReader extends DeferredRequestReader<
  ConversationReadContentPayload,
  ConversationReadContentResponse
> {
  constructor(
    load: (payload: ConversationReadContentPayload) => Promise<ConversationReadContentResponse>,
    pool?: RunProcessHistoryRequestPool,
    maxPending?: number,
  ) {
    super(load, validateResponse, pool, maxPending);
  }
}

export const deferredContentReader = new DeferredContentReader(async (payload) => {
  const runtime = window.syncThink?.runtime;
  if (!runtime?.readConversationContent) throw new Error('content.unavailable');
  return runtime.readConversationContent(payload);
});
