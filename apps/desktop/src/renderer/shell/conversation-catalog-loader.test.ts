import { describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@sync-think/shared';
import {
  CONVERSATION_CATALOG_PAGE_SIZE,
  loadConversationCatalog,
} from './conversation-catalog-loader.js';

function conversation(id: string): Conversation {
  return {
    id,
    track: 'model',
    targetRef: 'model-a',
    title: id,
    executionMode: 'full-access',
    interactionMode: 'execute',
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
  } as Conversation;
}

describe('conversation catalog loader', () => {
  it('assembles bounded pages in server order', async () => {
    const source = {
      listConversations: vi
        .fn()
        .mockResolvedValueOnce({
          conversations: [conversation('one'), conversation('two')],
          nextCursor: 'page-2',
        })
        .mockResolvedValueOnce({ conversations: [conversation('three')] }),
    };

    await expect(
      loadConversationCatalog(source, { includeArchived: true }),
    ).resolves.toEqual({
      conversations: [conversation('one'), conversation('two'), conversation('three')],
    });
    expect(source.listConversations).toHaveBeenNthCalledWith(1, {
      includeArchived: true,
      limit: CONVERSATION_CATALOG_PAGE_SIZE,
    });
    expect(source.listConversations).toHaveBeenNthCalledWith(2, {
      includeArchived: true,
      cursor: 'page-2',
      limit: CONVERSATION_CATALOG_PAGE_SIZE,
    });
  });

  it('deduplicates records that move across pages during a refresh', async () => {
    const source = {
      listConversations: vi
        .fn()
        .mockResolvedValueOnce({
          conversations: [conversation('one'), conversation('two')],
          nextCursor: 'page-2',
        })
        .mockResolvedValueOnce({
          conversations: [conversation('two'), conversation('three')],
        }),
    };

    const result = await loadConversationCatalog(source);
    expect(result.conversations.map((item) => item.id)).toEqual(['one', 'two', 'three']);
  });

  it('stops a malformed server from repeating the same cursor forever', async () => {
    const source = {
      listConversations: vi.fn().mockResolvedValue({
        conversations: [],
        nextCursor: 'repeated',
      }),
    };

    await expect(loadConversationCatalog(source)).rejects.toThrow('会话目录分页游标重复');
    expect(source.listConversations).toHaveBeenCalledTimes(2);
  });
});
