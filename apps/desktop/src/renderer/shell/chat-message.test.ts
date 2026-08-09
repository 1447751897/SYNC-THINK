import { describe, expect, it } from 'vitest';
import type { Message } from '@sync-think/shared';
import {
  filterPendingUserMessagesForDisplay,
  messageToChat,
  shouldDisplayChatMessage,
} from './ChatView.js';

describe('durable chat message mapping', () => {
  it('surfaces a persisted partial terminal marker without mixing it into markdown', () => {
    const chat = messageToChat({
      id: 'asst-run-a',
      threadId: 'thread-a',
      role: 'assistant',
      runId: 'run-a',
      sequence: 2,
      createdAt: '2026-07-28T00:00:00.000Z',
      blocks: [
        { type: 'text', text: 'partial answer' },
        {
          type: 'error',
          payload: { terminalState: 'failed', errorMessage: 'fixture failure' },
        },
      ],
    } as Message);

    expect(chat).toMatchObject({
      text: 'partial answer',
      terminalState: 'failed',
      terminalError: 'fixture failure',
    });
    expect(chat.text).not.toContain('fixture failure');
  });

  it('keeps a reasoning-only assistant turn out of the ordinary chat UI', () => {
    const chat = messageToChat({
      id: 'asst-run-reasoning',
      threadId: 'thread-a',
      role: 'assistant',
      runId: 'run-reasoning',
      sequence: 2,
      createdAt: '2026-08-07T00:00:00.000Z',
      blocks: [{ type: 'reasoning', reasoningText: 'reasoning summary only' }],
    } as Message);

    expect(chat.text).toBe('');
    expect(chat.commentaryText).toBeUndefined();
    expect(chat.commentarySegments).toBeUndefined();
    expect(shouldDisplayChatMessage(chat)).toBe(false);
  });

  it('keeps a terminal-only assistant turn visible without relying on reasoning', () => {
    const chat = messageToChat({
      id: 'asst-run-terminal',
      threadId: 'thread-a',
      role: 'assistant',
      runId: 'run-terminal',
      sequence: 2,
      createdAt: '2026-08-07T00:00:00.000Z',
      blocks: [
        {
          type: 'error',
          payload: { terminalState: 'failed', errorMessage: 'fixture failure' },
        },
      ],
    } as Message);

    expect(chat).toMatchObject({
      text: '',
      terminalState: 'failed',
      terminalError: 'fixture failure',
    });
    expect(shouldDisplayChatMessage(chat)).toBe(true);
  });

  it('rebuilds aggregate commentary with paragraph boundaries from persisted segments', () => {
    const chat = messageToChat({
      id: 'asst-run-segmented-commentary',
      threadId: 'thread-a',
      role: 'assistant',
      runId: 'run-segmented-commentary',
      sequence: 2,
      createdAt: '2026-08-08T00:00:00.000Z',
      blocks: [
        {
          type: 'commentary',
          payload: {
            commentarySegments: [
              {
                id: 'commentary-1',
                text: '正在检查项目结构。',
                startedAt: '2026-08-08T00:00:01.000Z',
                afterSequence: 10,
              },
              {
                id: 'commentary-2',
                text: '接下来读取相关文件。',
                startedAt: '2026-08-08T00:00:02.000Z',
                afterSequence: 12,
              },
            ],
          },
        },
      ],
    } as Message);

    expect(chat.commentaryText).toBe('正在检查项目结构。\n\n接下来读取相关文件。');
  });

  it('hides an optimistic user bubble as soon as its durable id appears', () => {
    const optimistic = {
      id: 'message-a',
      role: 'user',
      text: '流式验收',
      timestamp: '2026-08-08T10:00:00.000Z',
    } as const;
    const durable = {
      ...optimistic,
      sequence: 9,
      timestamp: '2026-08-08T10:00:01.000Z',
    } as const;

    expect(filterPendingUserMessagesForDisplay([optimistic], [durable])).toEqual([]);
    expect(filterPendingUserMessagesForDisplay([optimistic], [])).toEqual([optimistic]);
  });
});
