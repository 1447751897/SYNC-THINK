import type { DeferredContent } from '@sync-think/shared';
import type { ConversationId } from '@sync-think/shared';
import { deferredContentReader } from './deferred-content-reader.js';

/** Resolve the full immutable stored output, including JSON, never silently copy a preview. */
export async function readContextToolText(preview: string, content: DeferredContent | undefined, conversationId?: string): Promise<string> {
  if (!content) return preview;
  if (!conversationId) throw new Error('缺少对话信息，请重新打开执行记录');
  const chunks: string[] = [];
  let offset = 0, length: number | undefined, version: string | undefined;
  while (true) {
    const response = await deferredContentReader.read({ conversationId: conversationId as ConversationId, reference: content.reference, offset, ...(version ? { version } : {}) });
    const chunk = response.content;
    if ((version && version !== chunk.version) || (length !== undefined && length !== chunk.utf16Length) || chunk.offset !== offset)
      throw new Error('执行记录已变化，请重新复制');
    version = chunk.version; length = chunk.utf16Length; chunks.push(chunk.text);
    if (chunk.nextOffset === undefined) {
      if (offset + chunk.text.length !== length) throw new Error('执行记录尚未完整载入，请重试');
      break;
    }
    if (chunk.nextOffset <= offset || chunk.nextOffset !== offset + chunk.text.length) throw new Error('执行记录分页异常');
    offset = chunk.nextOffset;
  }
  return chunks.join('');
}
