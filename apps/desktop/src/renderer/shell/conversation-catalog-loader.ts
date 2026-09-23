import type {
  ListConversationsPayload,
  ListConversationsResponse,
} from '@sync-think/protocol';

export const CONVERSATION_CATALOG_PAGE_SIZE = 100;

export interface ConversationCatalogSource {
  listConversations(payload?: ListConversationsPayload): Promise<ListConversationsResponse>;
}

type ConversationCatalogFilter = Omit<ListConversationsPayload, 'cursor' | 'limit'>;

/** Reads the complete catalog through bounded transport pages for legacy Shell consumers. */
export async function loadConversationCatalog(
  source: ConversationCatalogSource,
  filter: ConversationCatalogFilter = {},
): Promise<ListConversationsResponse> {
  const conversations: ListConversationsResponse['conversations'] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const response = await source.listConversations({
      ...filter,
      ...(cursor ? { cursor } : {}),
      limit: CONVERSATION_CATALOG_PAGE_SIZE,
    });
    for (const conversation of response.conversations) {
      const id = String(conversation.id);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      conversations.push(conversation);
    }
    const nextCursor = response.nextCursor;
    if (!nextCursor) break;
    if (seenCursors.has(nextCursor)) {
      throw new Error('会话目录分页游标重复，刷新已停止');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return { conversations };
}
