import type { ChatMessage } from './conversation-types.js';
import type { HistoryRange } from './conversation-history-pages.js';

export interface CachedConversationPage {
  messages: ChatMessage[];
  ranges: HistoryRange[];
  hasMore: boolean;
  nextCursor?: number;
}

/** Per-host cache, independent of React, IPC and browser storage. */
export class ConversationPageCache {
  private readonly pages = new Map<string, CachedConversationPage>();
  constructor(
    private readonly capacity = 8,
    private readonly messageLimit = 100,
  ) {
    if (
      !Number.isSafeInteger(capacity) ||
      capacity < 1 ||
      !Number.isSafeInteger(messageLimit) ||
      messageLimit < 1
    )
      throw new Error('Invalid conversation cache limits');
  }
  clear(): void {
    this.pages.clear();
  }

  read(conversationId: string): CachedConversationPage | undefined {
    const cached = this.pages.get(conversationId);
    if (!cached) return undefined;
    // Refresh insertion order so the bounded map behaves as a small LRU cache.
    this.pages.delete(conversationId);
    this.pages.set(conversationId, cached);
    return cached;
  }

  /**
   * 「可用」的缓存页：**空页不算已加载**。
   *
   * 一次空结果（请求抢在 runtime 就绪之前、或上游给了空页）会把 `messages: []`
   * 写进缓存，而所有加载路径都拿「缓存命中」当「已经加载过」——于是这个会话
   * 在界面上永远空白（库里明明有消息）。这里的语义改成：有内容才算数，
   * 空页一律当作需要重新拉取。
   */
  readUsable(conversationId: string): CachedConversationPage | undefined {
    const page = this.read(conversationId);
    return page && page.messages.length > 0 ? page : undefined;
  }

  write(conversationId: string, page: CachedConversationPage): void {
    const retainedIds = new Set(
      [...page.messages]
        .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))
        .slice(-this.messageLimit)
        .map((message) => message.id),
    );
    const messages = page.messages.filter((message) => retainedIds.has(message.id));
    const trimmed = messages.length < page.messages.length;
    const firstSequence = Math.min(
      ...messages.map((message) => message.sequence ?? Number.MAX_SAFE_INTEGER),
    );
    const ranges = trimmed
      ? page.ranges
          .filter((range) => range.end >= firstSequence)
          .map((range) => ({ ...range, start: Math.max(range.start, firstSequence) }))
      : page.ranges;
    this.pages.delete(conversationId);
    this.pages.set(conversationId, {
      ...page,
      messages,
      ranges,
      hasMore: trimmed || page.hasMore,
      nextCursor: trimmed && Number.isSafeInteger(firstSequence) ? firstSequence : page.nextCursor,
    });
    while (this.pages.size > this.capacity) {
      const oldest = this.pages.keys().next().value as string | undefined;
      if (!oldest) break;
      this.pages.delete(oldest);
    }
  }
}

// The renderer host owns this instance; tests and other hosts can supply their own.
export const recentConversationPageCache = new ConversationPageCache();
