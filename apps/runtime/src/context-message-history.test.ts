import type { Message, MessageId, ThreadId } from '@sync-think/shared';
import { describe, expect, it } from 'vitest';
import { buildProviderMessagesFromDurableMessages } from './context-message-history.js';

function message(
  sequence: number,
  role: Message['role'],
  text: string,
  createdAt: string,
  blocks?: Message['blocks'],
): Message {
  return {
    id: `m-${sequence}` as MessageId,
    threadId: 'thread-1' as ThreadId,
    role,
    sequence,
    createdAt,
    blocks: blocks ?? [{ type: 'text', text }],
  };
}

describe('buildProviderMessagesFromDurableMessages', () => {
  it('keeps only messages after the latest compact boundary and injects the summary separately', () => {
    const result = buildProviderMessagesFromDurableMessages({
      messages: [
        message(0, 'user', 'old question', '2026-07-27T01:00:00.000Z'),
        message(1, 'assistant', 'old answer', '2026-07-27T01:01:00.000Z'),
        message(2, 'system', '上下文已压缩', '2026-07-27T01:02:00.000Z'),
        message(3, 'user', 'recent question', '2026-07-27T01:03:00.000Z'),
      ],
      compact: { summaryText: 'compact summary', compactedAt: '2026-07-27T01:02:00.000Z' },
      currentUserText: 'current question',
    });
    expect(result.compactSummary).toBe('compact summary');
    expect(result.messages).toEqual([
      { role: 'user', content: 'recent question' },
      { role: 'user', content: 'current question' },
    ]);
  });

  it('restores safe historical images after compact and never includes reasoning blocks', () => {
    const result = buildProviderMessagesFromDurableMessages({
      messages: [message(3, 'user', 'look', '2026-07-27T01:03:00.000Z', [
        { type: 'text', text: 'look' },
        { type: 'image', payload: { name: 'x.png', mimeType: 'image/png', storageRef: 'x.png' } },
        { type: 'plan', text: 'hidden reasoning' },
      ])],
      currentUserText: '',
      resolveImageDataUrl: (storageRef) => storageRef === 'x.png' ? 'data:image/png;base64,AAAA' : undefined,
    });
    expect(result.messages).toEqual([{ role: 'user', content: [
      { type: 'text', text: 'look' },
      { type: 'image', imageUrl: 'data:image/png;base64,AAAA' },
    ] }]);
    expect(JSON.stringify(result.messages)).not.toContain('hidden reasoning');
  });
});
