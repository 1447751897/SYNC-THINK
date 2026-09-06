import { describe, expect, it } from 'vitest';
import { parseTaskPlanHistoryPayload } from './task-plan-history.js';

describe('task plan history request boundary', () => {
  it('accepts a scoped first page and versioned task pagination', () => {
    expect(parseTaskPlanHistoryPayload({ conversationId: 'conversation' })).toEqual({
      conversationId: 'conversation',
      offset: 0,
    });
    expect(
      parseTaskPlanHistoryPayload({
        conversationId: 'conversation',
        runId: 'run',
        beforeSequence: 20,
        offset: 40,
        version: 'a'.repeat(64),
      }),
    ).toMatchObject({ runId: 'run', offset: 40 });
  });
  it.each([
    null,
    [],
    {},
    { conversationId: '' },
    { conversationId: 'x', runId: '' },
    { conversationId: 'x', beforeSequence: 0 },
    { conversationId: 'x', beforeRunId: 'unbound' },
    { conversationId: 'x', beforeSequence: 1, beforeRunId: '' },
    { conversationId: 'x', beforeSequence: 1.5 },
    { conversationId: 'x', offset: -1 },
    { conversationId: 'x', offset: null },
    { conversationId: 'x', offset: 40 },
    { conversationId: 'x', runId: 'run', offset: 40 },
    { conversationId: 'x', version: 'a'.repeat(64) },
    { conversationId: 'x', runId: 'run', version: 'bad' },
    { conversationId: 'x', threadId: 'foreign' },
    { conversationId: 'x'.repeat(129) },
  ])('rejects malformed or unbound request %j', (value) => {
    expect(parseTaskPlanHistoryPayload(value)).toBeUndefined();
  });
});
