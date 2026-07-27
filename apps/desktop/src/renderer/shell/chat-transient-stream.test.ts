import { describe, expect, it } from 'vitest';
import type { ConversationTransientFrame } from '@sync-think/protocol';
import { applyTransientConversationFrame } from './chat-transient-stream.js';

function frame(
  streamSequence: number,
  kind: ConversationTransientFrame['kind'],
  overrides: Partial<ConversationTransientFrame> = {},
): ConversationTransientFrame {
  return {
    threadId: 'thread-a' as ConversationTransientFrame['threadId'],
    runId: 'run-a' as ConversationTransientFrame['runId'],
    streamSequence,
    kind,
    occurredAt: `2026-07-27T00:00:0${streamSequence}.000Z`,
    ...overrides,
  };
}

describe('chat transient stream reducer', () => {
  it('accumulates text and reasoning with cursor dedupe', () => {
    const first = applyTransientConversationFrame({
      current: null,
      frame: frame(1, 'reasoning', { textDelta: 'think' }),
      threadId: 'thread-a',
      afterStreamSequence: 0,
    });
    const second = applyTransientConversationFrame({
      current: first.draft,
      frame: frame(2, 'text', { textDelta: 'answer' }),
      threadId: 'thread-a',
      afterStreamSequence: first.lastStreamSequence,
    });
    const duplicate = applyTransientConversationFrame({
      current: second.draft,
      frame: frame(2, 'text', { textDelta: 'duplicate' }),
      threadId: 'thread-a',
      afterStreamSequence: second.lastStreamSequence,
    });

    expect(second.draft).toMatchObject({
      runId: 'run-a',
      text: 'answer',
      reasoningText: 'think',
    });
    expect(duplicate).toEqual({
      draft: second.draft,
      lastStreamSequence: 2,
      terminal: false,
    });
  });

  it('ignores other threads and clears only the matching run on terminal', () => {
    const current = {
      runId: 'run-a',
      text: 'answer',
      timestamp: '2026-07-27T00:00:01.000Z',
    };
    const otherThread = applyTransientConversationFrame({
      current,
      frame: frame(3, 'text', {
        threadId: 'thread-b' as ConversationTransientFrame['threadId'],
        textDelta: 'wrong',
      }),
      threadId: 'thread-a',
      afterStreamSequence: 2,
    });
    const otherRunTerminal = applyTransientConversationFrame({
      current,
      frame: frame(3, 'terminal', {
        runId: 'run-b' as ConversationTransientFrame['runId'],
        terminalState: 'completed',
      }),
      threadId: 'thread-a',
      afterStreamSequence: 2,
    });
    const terminal = applyTransientConversationFrame({
      current,
      frame: frame(4, 'terminal', { terminalState: 'completed' }),
      threadId: 'thread-a',
      afterStreamSequence: 3,
    });

    expect(otherThread.draft).toBe(current);
    expect(otherThread.lastStreamSequence).toBe(2);
    expect(otherRunTerminal.draft).toBe(current);
    expect(otherRunTerminal.terminal).toBe(true);
    expect(terminal.draft).toBeNull();
    expect(terminal.terminal).toBe(true);
  });
});
