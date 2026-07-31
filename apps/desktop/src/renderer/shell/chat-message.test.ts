import { describe, expect, it } from 'vitest';
import type { Message } from '@sync-think/shared';
import { messageToChat } from './ChatView.js';

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
});
