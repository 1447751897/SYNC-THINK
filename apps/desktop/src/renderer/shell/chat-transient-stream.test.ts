import { describe, expect, it } from 'vitest';
import type { ConversationTransientFrame } from '@sync-think/protocol';
import {
  applyTransientConversationFrame,
  applyTransientConversationFrames,
  buildConversationSnapshotDisplayQueue,
  mergeTransientConversationDraft,
  reconcileTransientConversationDraft,
  takeConversationDisplayQueueBatch,
  takeTransientConversationFrameBatch,
} from './chat-transient-stream.js';

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
  it('accumulates text and commentary with cursor dedupe', () => {
    const first = applyTransientConversationFrame({
      current: null,
      frame: frame(1, 'commentary', { textDelta: '正在检查。' }),
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
      commentaryText: '正在检查。',
    });
    expect(duplicate).toEqual({
      draft: second.draft,
      lastStreamSequence: 2,
      terminal: false,
    });
  });

  it('advances process-only frames without treating them as reasoning text', () => {
    const result = applyTransientConversationFrame({
      current: null,
      frame: frame(1, 'process'),
      threadId: 'thread-a',
      afterStreamSequence: 0,
    });

    expect(result.draft).toEqual({
      runId: 'run-a',
      text: '',
      timestamp: '2026-07-27T00:00:01.000Z',
    });
    expect(result.lastStreamSequence).toBe(1);
  });

  it('ignores other threads and marks only the matching run terminal without clearing it', () => {
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
    expect(terminal.draft).toEqual({
      ...current,
      terminal: true,
    });
    expect(terminal.terminal).toBe(true);
  });

  it('clears a process-only draft as soon as the matching run becomes terminal', () => {
    const process = applyTransientConversationFrame({
      current: null,
      frame: frame(1, 'process'),
      threadId: 'thread-a',
      afterStreamSequence: 0,
    });
    const terminal = applyTransientConversationFrame({
      current: process.draft,
      frame: frame(2, 'terminal', { terminalState: 'failed' }),
      threadId: 'thread-a',
      afterStreamSequence: process.lastStreamSequence,
    });

    expect(terminal).toEqual({
      draft: null,
      lastStreamSequence: 2,
      terminal: true,
    });
  });

  it('reduces a render-frame batch with one cursor advance and a retained terminal draft', () => {
    const frames = Array.from({ length: 100 }, (_, index) =>
      frame(index + 1, index % 2 === 0 ? 'commentary' : 'text', {
        textDelta: index % 2 === 0 ? 'r' : 't',
      }),
    );
    frames.push(frame(101, 'terminal', { terminalState: 'cancelled' }));

    const result = applyTransientConversationFrames({
      current: null,
      frames,
      threadId: 'thread-a',
      afterStreamSequence: 0,
    });

    expect(result).toMatchObject({
      draft: {
        runId: 'run-a',
        text: 't'.repeat(50),
        commentaryText: 'r'.repeat(50),
        timestamp: '2026-07-27T00:00:0100.000Z',
        terminal: true,
      },
      lastStreamSequence: 101,
      terminal: true,
    });
    expect(result.draft?.commentarySegments).toHaveLength(50);
    expect(result.draft?.commentarySegments?.[0]).toMatchObject({
      text: 'r',
      startedAt: '2026-07-27T00:00:01.000Z',
      completedAt: '2026-07-27T00:00:02.000Z',
    });
  });

  it('drains only a bounded visible batch per paint instead of swallowing the whole queue', () => {
    const queued = Array.from({ length: 8 }, (_, index) =>
      frame(index + 1, 'text', { textDelta: 'stream' }),
    );

    const firstPaint = takeTransientConversationFrameBatch(queued, {
      maxFrames: 3,
      maxTextCharacters: 12,
    });

    expect(firstPaint.frames.map((item) => item.streamSequence)).toEqual([1, 2]);
    expect(firstPaint.remaining.map((item) => item.streamSequence)).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it('preserves process and terminal ordering behind already queued text', () => {
    const queued = [
      frame(1, 'text', { textDelta: 'before tool' }),
      frame(2, 'process'),
      frame(3, 'text', { textDelta: 'after tool' }),
      frame(4, 'terminal', { terminalState: 'completed' }),
    ];

    const firstPaint = takeTransientConversationFrameBatch(queued, {
      maxFrames: 8,
      maxTextCharacters: 100,
    });
    const secondPaint = takeTransientConversationFrameBatch(firstPaint.remaining, {
      maxFrames: 8,
      maxTextCharacters: 100,
    });

    expect(firstPaint.frames.map((item) => item.kind)).toEqual(['text', 'process']);
    expect(secondPaint.frames.map((item) => item.kind)).toEqual(['text', 'terminal']);
  });

  it('paces one oversized commentary frame without advancing its cursor early', () => {
    const oversized = frame(1, 'commentary', {
      textDelta: '思考内容'.repeat(120),
    });
    const firstPaint = takeConversationDisplayQueueBatch(
      [{ source: 'transient', frame: oversized, offset: 0 }],
      {
        maxFrames: 4,
        maxTextCharacters: 24,
      },
    );

    expect(firstPaint.operations).toEqual([
      expect.objectContaining({
        type: 'commentary.delta',
        delta: oversized.textDelta!.slice(0, 24),
      }),
    ]);
    expect(firstPaint.completed).toEqual([]);
    expect(firstPaint.remaining).toEqual([
      { source: 'transient', frame: oversized, offset: 24 },
    ]);
  });

  it('paces one oversized final answer and completes only after every slice is visible', () => {
    const oversized = frame(1, 'text', {
      textDelta: '最终总结'.repeat(40),
    });
    let queue = [{ source: 'transient' as const, frame: oversized, offset: 0 }];
    let visible = '';
    let completed = false;

    while (queue.length > 0) {
      const paint = takeConversationDisplayQueueBatch(queue, {
        maxFrames: 4,
        maxTextCharacters: 17,
      });
      visible += paint.operations
        .filter((operation) => operation.type === 'text.delta')
        .map((operation) => operation.delta)
        .join('');
      completed ||= paint.completed.some((item) => item.source === 'transient');
      queue = paint.remaining as typeof queue;
      if (queue.length > 0) expect(completed).toBe(false);
    }

    expect(visible).toBe(oversized.textDelta);
    expect(completed).toBe(true);
  });

  it('does not let a process boundary overtake a partially displayed text frame', () => {
    const textFrame = frame(1, 'text', { textDelta: 'before tool'.repeat(20) });
    const processFrame = frame(2, 'process');
    const firstPaint = takeConversationDisplayQueueBatch(
      [
        { source: 'transient', frame: textFrame, offset: 0 },
        { source: 'transient', frame: processFrame, offset: 0 },
      ],
      {
        maxFrames: 8,
        maxTextCharacters: 12,
      },
    );

    expect(firstPaint.operations.map((operation) => operation.type)).toEqual(['text.delta']);
    expect(firstPaint.completed).toEqual([]);
    expect(firstPaint.remaining[0]).toEqual({
      source: 'transient',
      frame: textFrame,
      offset: 12,
    });
    expect(firstPaint.remaining[1]).toEqual({
      source: 'transient',
      frame: processFrame,
      offset: 0,
    });
  });

  it('paces reset snapshot catch-up before reconciling complete metadata', () => {
    const current = {
      runId: 'run-a',
      text: '',
      commentaryText: '已检查',
      timestamp: '2026-07-27T00:00:01.000Z',
    };
    const target = {
      runId: 'run-a',
      text: '最终总结'.repeat(20),
      commentaryText: '已检查，继续分析细节。',
      commentarySegments: [
        {
          id: 'commentary-4-0',
          text: '已检查，继续分析细节。',
          startedAt: '2026-07-27T00:00:01.000Z',
          afterSequence: 4,
        },
      ],
      timestamp: '2026-07-27T00:00:03.000Z',
    };
    const queue = buildConversationSnapshotDisplayQueue({
      current,
      incoming: target,
      streamSequence: 12,
    });
    const firstPaint = takeConversationDisplayQueueBatch(queue, {
      maxFrames: 4,
      maxTextCharacters: 4,
    });

    expect(firstPaint.operations).toEqual([
      expect.objectContaining({ type: 'commentary.delta', delta: '，继续分' }),
    ]);
    expect(firstPaint.completed.some((item) => item.source === 'snapshot')).toBe(false);
    expect(firstPaint.remaining.at(-1)).toEqual({
      source: 'snapshot',
      draft: target,
      streamSequence: 12,
    });
  });

  it('keeps commentary when a same-run process frame arrives', () => {
    const current = {
      runId: 'run-a',
      text: '',
      commentaryText: 'still working',
      timestamp: '2026-07-27T00:00:01.000Z',
    };

    expect(
      applyTransientConversationFrame({
        current,
        frame: frame(2, 'process'),
        threadId: 'thread-a',
        afterStreamSequence: 1,
      }).draft,
    ).toBe(current);
  });

  it('merges reset snapshots monotonically instead of replacing newer commentary with stale data', () => {
    const current = {
      runId: 'run-a',
      text: 'answer in progress',
      commentaryText: 'commentary continued',
      commentarySegments: [
        {
          id: 'commentary-4-0',
          text: 'commentary continued',
          startedAt: '2026-07-27T00:00:01.000Z',
          afterSequence: 4,
        },
      ],
      timestamp: '2026-07-27T00:00:03.000Z',
    };
    const staleSnapshot = {
      runId: 'run-a',
      text: 'answer',
      commentaryText: 'commentary',
      commentarySegments: [
        {
          id: 'commentary-4-0',
          text: 'commentary',
          startedAt: '2026-07-27T00:00:01.000Z',
          afterSequence: 4,
        },
      ],
      timestamp: '2026-07-27T00:00:02.000Z',
    };

    expect(mergeTransientConversationDraft(current, staleSnapshot)).toEqual(current);
    expect(mergeTransientConversationDraft(current, null)).toEqual({
      ...current,
      terminal: true,
    });
  });

  it('does not retain an empty draft when a reset confirms there is no active snapshot', () => {
    expect(
      mergeTransientConversationDraft(
        {
          runId: 'run-a',
          text: '',
          timestamp: '2026-07-27T00:00:03.000Z',
        },
        null,
      ),
    ).toBeNull();
  });

  it('clears a terminal transient draft only after the same run exists durably', () => {
    const terminalDraft = {
      runId: 'run-a',
      text: '',
      commentaryText: 'durable handoff',
      timestamp: '2026-07-27T00:00:03.000Z',
      terminal: true,
    };

    expect(reconcileTransientConversationDraft(terminalDraft, ['run-b'])).toEqual(terminalDraft);
    expect(reconcileTransientConversationDraft(terminalDraft, ['run-a'])).toBeNull();
  });

  it('clears an empty terminal draft without waiting for a durable assistant message', () => {
    expect(
      reconcileTransientConversationDraft(
        {
          runId: 'run-a',
          text: ' ',
          commentaryText: '\n',
          timestamp: '2026-07-27T00:00:03.000Z',
          terminal: true,
        },
        [],
      ),
    ).toBeNull();
  });

  it('advances past reasoning diagnostics without exposing them as commentary', () => {
    const result = applyTransientConversationFrame({
      current: null,
      frame: frame(1, 'reasoning', { textDelta: 'internal diagnostic summary' }),
      threadId: 'thread-a',
      afterStreamSequence: 0,
    });

    expect(result).toEqual({
      draft: null,
      lastStreamSequence: 1,
      terminal: false,
    });
  });
});
