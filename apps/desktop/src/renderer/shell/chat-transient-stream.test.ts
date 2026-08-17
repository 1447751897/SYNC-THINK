import { describe, expect, it } from 'vitest';
import type { ConversationTransientFrame } from '@sync-think/protocol';
import {
  applyTransientConversationFrame,
  applyTransientConversationFrames,
  buildConversationSnapshotDisplayQueue,
  getConversationDisplayQueueBatchOptions,
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

  it('accumulates provider reasoning frames into the draft as thinking text', () => {
    const first = applyTransientConversationFrame({
      current: null,
      frame: frame(1, 'reasoning', { textDelta: '先分析问题' }),
      threadId: 'thread-a',
      afterStreamSequence: 0,
    });
    const second = applyTransientConversationFrame({
      current: first.draft,
      frame: frame(2, 'reasoning', { textDelta: '再选择方案' }),
      threadId: 'thread-a',
      afterStreamSequence: first.lastStreamSequence,
    });

    expect(second.draft).toMatchObject({
      runId: 'run-a',
      reasoningText: '先分析问题再选择方案',
    });
    expect(second.draft?.text).toBe('');
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
      terminalState: 'completed',
    });
    expect(terminal.terminal).toBe(true);
  });

  it('clears a process-only draft as soon as the matching run completes', () => {
    const process = applyTransientConversationFrame({
      current: null,
      frame: frame(1, 'process'),
      threadId: 'thread-a',
      afterStreamSequence: 0,
    });
    const terminal = applyTransientConversationFrame({
      current: process.draft,
      frame: frame(2, 'terminal', { terminalState: 'completed' }),
      threadId: 'thread-a',
      afterStreamSequence: process.lastStreamSequence,
    });

    expect(terminal).toEqual({
      draft: null,
      lastStreamSequence: 2,
      terminal: true,
    });
  });

  it('retains an output-free draft when the run failed, so the cause stays visible', () => {
    // A kernel that dies during spawn (bad argv, missing binary, auth refused)
    // emits zero output. Dropping the draft here is what made such runs render
    // as a sent message with no reply and no explanation.
    const process = applyTransientConversationFrame({
      current: null,
      frame: frame(1, 'process'),
      threadId: 'thread-a',
      afterStreamSequence: 0,
    });
    const terminal = applyTransientConversationFrame({
      current: process.draft,
      frame: frame(2, 'terminal', {
        terminalState: 'failed',
        errorMessage: 'kernel args contain unsafe shell metacharacters',
      }),
      threadId: 'thread-a',
      afterStreamSequence: process.lastStreamSequence,
    });

    expect(terminal.draft).toMatchObject({
      terminal: true,
      terminalState: 'failed',
      terminalError: 'kernel args contain unsafe shell metacharacters',
    });
    expect(terminal.terminal).toBe(true);
  });

  it('retains an output-free cancelled draft as well', () => {
    const terminal = applyTransientConversationFrame({
      current: null,
      frame: frame(1, 'terminal', { terminalState: 'cancelled' }),
      threadId: 'thread-a',
      afterStreamSequence: 0,
    });
    // No prior draft at all: nothing to retain, and nothing to explain either.
    expect(terminal.draft).toBeNull();
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

  it('drains every already-arrived non-boundary frame regardless of legacy budgets', () => {
    const queued = Array.from({ length: 8 }, (_, index) =>
      frame(index + 1, 'text', { textDelta: 'stream' }),
    );

    const batch = takeTransientConversationFrameBatch(queued, {
      maxFrames: 1,
      maxTextCharacters: 1,
    });

    expect(batch.frames.map((item) => item.streamSequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(batch.remaining).toEqual([]);
  });

  it('preserves process and terminal ordering boundaries', () => {
    const queued = [
      frame(1, 'text', { textDelta: 'before tool' }),
      frame(2, 'process'),
      frame(3, 'text', { textDelta: 'after tool' }),
      frame(4, 'terminal', { terminalState: 'completed' }),
    ];

    const firstBoundary = takeTransientConversationFrameBatch(queued, {
      maxFrames: 1,
      maxTextCharacters: 1,
    });
    const secondBoundary = takeTransientConversationFrameBatch(firstBoundary.remaining, {
      maxFrames: 1,
      maxTextCharacters: 1,
    });

    expect(firstBoundary.frames.map((item) => item.kind)).toEqual(['text', 'process']);
    expect(secondBoundary.frames.map((item) => item.kind)).toEqual(['text', 'terminal']);
    expect(secondBoundary.remaining).toEqual([]);
  });

  it('submits small provider deltas immediately without client-side replay', () => {
    const queue = Array.from({ length: 4 }, (_, index) => ({
      source: 'transient' as const,
      frame: frame(index + 1, 'text', { textDelta: 'x'.repeat(20) }),
      offset: 0,
    }));
    const batch = takeConversationDisplayQueueBatch(
      queue,
      getConversationDisplayQueueBatchOptions(queue),
    );

    expect(batch.operations).toHaveLength(4);
    expect(batch.completed).toHaveLength(4);
    expect(batch.remaining).toEqual([]);
  });

  it('publishes every text delta already received in one display frame', () => {
    const queue = [
      { source: 'transient' as const, frame: frame(1, 'text', { textDelta: 'fine-a' }), offset: 0 },
      { source: 'transient' as const, frame: frame(2, 'text', { textDelta: 'fine-b' }), offset: 0 },
      {
        source: 'transient' as const,
        frame: frame(3, 'text', { textDelta: 'coarse'.repeat(200) }),
        offset: 0,
      },
    ];
    const batch = takeConversationDisplayQueueBatch(
      queue,
      getConversationDisplayQueueBatchOptions(queue),
    );

    expect(batch.operations.map((operation) => operation.type)).toEqual([
      'text.delta',
      'text.delta',
      'text.delta',
    ]);
    expect(batch.completed).toHaveLength(3);
    expect(batch.remaining).toEqual([]);
  });

  it('publishes a coarse provider delta atomically instead of replaying client-side chunks', () => {
    const largeText = 'x'.repeat(10_000);
    const largeFrame = frame(1, 'text', { textDelta: largeText });
    const queue = [{ source: 'transient' as const, frame: largeFrame, offset: 0 }];
    const batch = takeConversationDisplayQueueBatch(
      queue,
      getConversationDisplayQueueBatchOptions(queue),
    );

    expect(batch.operations).toHaveLength(1);
    expect(batch.operations[0]).toMatchObject({ type: 'text.delta', delta: largeText });
    expect(batch.remaining).toEqual([]);
  });

  it('finishes a coarse text operation before its following process boundary', () => {
    const textFrame = frame(1, 'text', { textDelta: 'before tool'.repeat(200) });
    const processFrame = frame(2, 'process');
    const afterTool = frame(3, 'text', { textDelta: 'after tool' });
    let queue = [
      { source: 'transient' as const, frame: textFrame, offset: 0 },
      { source: 'transient' as const, frame: processFrame, offset: 0 },
      { source: 'transient' as const, frame: afterTool, offset: 0 },
    ];
    const operationTypes: string[] = [];
    let textBeforeBoundary = '';

    while (queue.length > 0 && !operationTypes.includes('process.boundary')) {
      const batch = takeConversationDisplayQueueBatch(
        queue,
        getConversationDisplayQueueBatchOptions(queue),
      );
      for (const operation of batch.operations) {
        operationTypes.push(operation.type);
        if (operation.type === 'text.delta') textBeforeBoundary += operation.delta;
      }
      queue = batch.remaining as typeof queue;
    }

    expect(textBeforeBoundary).toBe(textFrame.textDelta);
    expect(operationTypes.at(-1)).toBe('process.boundary');
    expect(queue).toEqual([{ source: 'transient', frame: afterTool, offset: 0 }]);
  });

  it('publishes the complete timeline snapshot with its provider delta', () => {
    const text = 'timeline'.repeat(80);
    const textFrame = frame(1, 'text', {
      textDelta: text,
      assistantTimeline: [
        {
          id: 'answer',
          sequence: 0,
          kind: 'text',
          phase: 'final_answer',
          text,
          status: 'streaming',
        },
      ],
    });
    const queue = [{ source: 'transient' as const, frame: textFrame, offset: 0 }];
    const batch = takeConversationDisplayQueueBatch(
      queue,
      getConversationDisplayQueueBatchOptions(queue),
    );
    const operation = batch.operations[0];

    expect(operation?.type).toBe('text.delta');
    if (operation?.type !== 'text.delta') throw new Error('expected text delta');
    const visibleSegment = operation.assistantTimeline?.[0];
    expect(visibleSegment?.kind).toBe('text');
    if (visibleSegment?.kind !== 'text') throw new Error('expected text timeline segment');
    expect(visibleSegment.text).toBe(operation.delta);
    expect(visibleSegment.text).toBe(text);
  });

  it('publishes terminal after the complete queued delta in the same boundary batch', () => {
    const text = 'final'.repeat(2_000);
    const queue = [
      { source: 'transient' as const, frame: frame(1, 'text', { textDelta: text }), offset: 0 },
      {
        source: 'transient' as const,
        frame: frame(2, 'terminal', { terminalState: 'completed' }),
        offset: 0,
      },
    ];
    const batch = takeConversationDisplayQueueBatch(
      queue,
      getConversationDisplayQueueBatchOptions(queue),
    );

    expect(batch.operations.map((operation) => operation.type)).toEqual([
      'text.delta',
      'run.terminal',
    ]);
    expect(batch.operations[0]).toMatchObject({ type: 'text.delta', delta: text });
    expect(batch.remaining).toEqual([]);
  });

  it('reconciles reset snapshots directly instead of replaying catch-up characters', () => {
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
    const batch = takeConversationDisplayQueueBatch(queue, {
      maxFrames: 1,
      maxTextCharacters: 1,
    });

    expect(queue).toEqual([
      {
        source: 'snapshot',
        draft: target,
        streamSequence: 12,
      },
    ]);
    expect(batch.operations).toEqual([]);
    expect(batch.completed).toEqual(queue);
    expect(batch.remaining).toEqual([]);
  });

  it('drains all ordering boundaries in one RAF loop with no leftover characters', () => {
    const frames = [
      frame(1, 'text', { textDelta: 'a'.repeat(10_000) }),
      frame(2, 'process'),
      frame(3, 'commentary', { textDelta: '正在继续。' }),
      frame(4, 'terminal', { terminalState: 'completed' }),
    ];
    let queue = frames.map((item) => ({ source: 'transient' as const, frame: item, offset: 0 }));
    const operationTypes: string[] = [];

    while (queue.length > 0) {
      const batch = takeConversationDisplayQueueBatch(queue, {
        maxFrames: Number.MAX_SAFE_INTEGER,
        maxTextCharacters: Number.MAX_SAFE_INTEGER,
      });
      operationTypes.push(...batch.operations.map((operation) => operation.type));
      expect(batch.completed.length + batch.operations.length).toBeGreaterThan(0);
      queue = batch.remaining as typeof queue;
    }

    expect(operationTypes).toEqual([
      'text.delta',
      'process.boundary',
      'commentary.delta',
      'run.terminal',
    ]);
    expect(queue).toEqual([]);
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
    ).toEqual({
      ...current,
      timestamp: '2026-07-27T00:00:02.000Z',
    });
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

    expect(result).toMatchObject({
      lastStreamSequence: 1,
      terminal: false,
    });
    expect(result.draft).toMatchObject({
      runId: 'run-a',
      reasoningText: 'internal diagnostic summary',
    });
    expect(result.draft?.commentaryText).toBeUndefined();
  });

  it('surfaces run.failed terminalState and errorMessage on the draft', () => {
    const current = { runId: 'run-a', text: 'partial', timestamp: '2026-07-27T00:00:01.000Z' };
    const result = applyTransientConversationFrame({
      current,
      frame: frame(2, 'terminal', {
        terminalState: 'failed',
        errorMessage: 'unexpected status 502 Bad Gateway: content is not iterable',
      }),
      threadId: 'thread-a',
      afterStreamSequence: 1,
    });

    expect(result.draft).toMatchObject({
      runId: 'run-a',
      text: 'partial',
      terminal: true,
      terminalState: 'failed',
      terminalError: 'unexpected status 502 Bad Gateway: content is not iterable',
    });
  });
});
