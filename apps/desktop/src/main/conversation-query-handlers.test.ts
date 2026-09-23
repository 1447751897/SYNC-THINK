import { describe, expect, it, vi } from 'vitest';
import {
  registerConversationQueryHandlers,
  type ConversationQueryHost,
} from './conversation-query-handlers.js';

const queries = [
  ['list-messages', 'listMessages', { conversationId: 'conversation', limit: 20 }],
  [
    'list-navigation',
    'listNavigation',
    { conversationId: 'conversation', beforeSequence: 12, limit: 5 },
  ],
  ['get-context-status', 'getContextStatus', { conversationId: 'conversation' }],
  ['get-run-process', 'getRunProcess', { conversationId: 'conversation', runId: 'run' }],
  ['task-plan-history', 'taskPlanHistory', { conversationId: 'conversation', offset: 0 }],
  ['list-file-changes', 'listFileChanges', { conversationId: 'conversation', offset: 0 }],
  [
    'read-content',
    'readContent',
    {
      conversationId: 'conversation',
      reference: { source: 'event', id: 'event', path: ['result'] },
    },
  ],
  [
    'read-file-diff',
    'readFileDiff',
    { conversationId: 'conversation', before: { text: '' }, after: { text: 'hello' } },
  ],
  ['list-run-timeline', 'listRunTimeline', { runId: 'run', cursor: 'cursor', limit: 5 }],
] as const;

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { result: 'unchanged transport response' };
  const request = vi.fn(async () => {
    order.push('request');
    return response;
  });
  const host = {
    handle: (channel: string, listener: (event: string, value: unknown) => Promise<unknown>) => {
      expect(handlers.has(channel)).toBe(false);
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => {
      order.push('source');
    }),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestConversation: request as ConversationQueryHost<string>['requestConversation'],
  };
  registerConversationQueryHandlers(host);
  return { handlers, host, request, order, response };
}

describe('conversation query IPC boundary', () => {
  it.each(queries)(
    'forwards %s through the scoped parser after sender validation and connection',
    async (channel, command, payload) => {
      const { handlers, host, request, order, response } = fixture();
      expect(handlers.size).toBe(queries.length);
      expect(await handlers.get(`runtime:conversation-${channel}`)!('trusted', payload)).toBe(
        response,
      );
      expect(host.assertSource).toHaveBeenCalledWith('trusted');
      expect(request).toHaveBeenCalledWith(
        `conversation.${command}`,
        expect.objectContaining(payload),
      );
      expect(order).toEqual(['source', 'connect', 'request']);
    },
  );
  it.each(queries)(
    'rejects an untrusted %s call before connection or transport',
    async (channel, _command, payload) => {
      const { handlers, host, request } = fixture();
      host.assertSource.mockImplementation(() => {
        throw new Error('untrusted sender');
      });
      await expect(
        handlers.get(`runtime:conversation-${channel}`)!('untrusted', payload),
      ).rejects.toThrow('untrusted sender');
      expect(host.ensureConnection).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    },
  );
  it.each(queries)('rejects malformed %s requests without invoking transport', async (channel) => {
    const { handlers, request } = fixture();
    await expect(
      handlers.get(`runtime:conversation-${channel}`)!('trusted', null),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('passes connection errors back without issuing a query', async () => {
    const { handlers, host, request } = fixture();
    const failure = new Error('offline');
    host.ensureConnection.mockRejectedValue(failure);
    await expect(
      handlers.get('runtime:conversation-list-messages')!('trusted', queries[0][2]),
    ).rejects.toBe(failure);
    expect(request).not.toHaveBeenCalled();
  });
  it('preserves transport failure identity', async () => {
    const { handlers, request } = fixture();
    const failure = new Error('stale version');
    request.mockRejectedValue(failure);
    await expect(
      handlers.get('runtime:conversation-read-content')!('trusted', queries[6][2]),
    ).rejects.toBe(failure);
  });
});
