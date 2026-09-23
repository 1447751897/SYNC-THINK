import { expect, it } from 'vitest';
import { ConversationPageCache, type CachedConversationPage } from './conversation-page-cache.js';

function page(count: number): CachedConversationPage {
  return {
    messages: Array.from({ length: count }, (_, index) => ({
      id: String(index + 1),
      role: 'user' as const,
      text: 'message',
      timestamp: '2026-09-19',
      sequence: index + 1,
    })),
    ranges: [{ start: 1, end: count }],
    hasMore: false,
  };
}
it('evicts least recently used pages without sharing state between hosts', () => {
  const cache = new ConversationPageCache(2);
  cache.write('a', page(1));
  cache.write('b', page(1));
  cache.read('a');
  cache.write('c', page(1));
  expect(cache.read('b')).toBeUndefined();
  expect(cache.readUsable('a')?.messages).toHaveLength(1);
  expect(new ConversationPageCache().read('a')).toBeUndefined();
  cache.clear();
  expect(cache.read('a')).toBeUndefined();
});
it('retains recent messages and exposes the correct cursor for reloading evicted history', () => {
  const cache = new ConversationPageCache(2, 3);
  cache.write('thread', page(5));
  expect(cache.read('thread')).toMatchObject({
    messages: [{ id: '3' }, { id: '4' }, { id: '5' }],
    ranges: [{ start: 3, end: 5 }],
    hasMore: true,
    nextCursor: 3,
  });
  cache.write('empty', page(0));
  expect(cache.readUsable('empty')).toBeUndefined();
});
