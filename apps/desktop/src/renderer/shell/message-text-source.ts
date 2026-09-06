import type { ConversationId } from '@sync-think/shared';
import type { MessageTextPart } from './MessageTextContent.js';
import { deferredContentReader } from './deferred-content-reader.js';

export async function resolveMessageText(
  parts: readonly MessageTextPart[] | undefined,
  fallback: string,
  conversationId: string,
  signal?: AbortSignal,
  separator = '\n',
): Promise<string> {
  if (!parts?.some((part) => part.contentRef)) return fallback;
  if (!conversationId) throw new Error('content.unavailable');
  const texts: string[] = [];
  for (const part of parts) {
    if (!part.contentRef) {
      texts.push(part.text);
      continue;
    }
    const chunks: string[] = [];
    let offset = 0;
    let version: string | undefined;
    let length: number | undefined;
    while (true) {
      if (signal?.aborted) throw new Error('content.cancelled');
      const response = await deferredContentReader.read(
        {
          conversationId: conversationId as ConversationId,
          reference: part.contentRef.reference,
          offset,
          ...(version ? { version } : {}),
        },
        signal,
      );
      if (signal?.aborted) throw new Error('content.cancelled');
      const chunk = response.content;
      if (
        chunk.format !== 'text' ||
        chunk.offset !== offset ||
        (version && chunk.version !== version) ||
        (length !== undefined && chunk.utf16Length !== length)
      )
        throw new Error('content.version-changed');
      version = chunk.version;
      length = chunk.utf16Length;
      chunks.push(chunk.text);
      if (chunk.nextOffset === undefined) {
        if (offset + chunk.text.length !== length) throw new Error('content.incomplete');
        break;
      }
      if (chunk.nextOffset <= offset || chunk.nextOffset !== offset + chunk.text.length)
        throw new Error('content.invalid-range');
      offset = chunk.nextOffset;
    }
    texts.push(chunks.join(''));
  }
  return texts.join(separator);
}
