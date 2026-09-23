import { describe, expect, it } from 'vitest';
import { parseUsageSummaryPayload } from '../src/provider-payloads.js';

describe('provider-payloads', () => {
  it('parses task-scoped usage summary payloads and trims the task id', () => {
    expect(parseUsageSummaryPayload({ taskId: ' task-a ' })).toEqual({
      taskId: 'task-a',
    });
    expect(
      parseUsageSummaryPayload({
        sinceDays: 30,
        taskId: 'task-a',
        includeRequests: false,
        requestLimit: 250,
      }),
    ).toEqual({
      sinceDays: 30,
      taskId: 'task-a',
      includeRequests: false,
      requestLimit: 250,
    });
  });

  it('rejects invalid task-scoped usage summary payloads', () => {
    expect(() => parseUsageSummaryPayload({ taskId: '   ' })).toThrow(
      /Invalid usage-summary payload/,
    );
    expect(() => parseUsageSummaryPayload({ taskId: 'x'.repeat(257) })).toThrow(
      /Invalid usage-summary payload/,
    );
    expect(() => parseUsageSummaryPayload({ taskId: 123 })).toThrow(
      /Invalid usage-summary payload/,
    );
    expect(() => parseUsageSummaryPayload({ taskId: 'task-a', unknown: true })).toThrow(
      /Invalid usage-summary payload/,
    );
    expect(() => parseUsageSummaryPayload({ includeRequests: 'yes' })).toThrow(
      /Invalid usage-summary payload/,
    );
    expect(() => parseUsageSummaryPayload({ requestLimit: 0 })).toThrow(
      /Invalid usage-summary payload/,
    );
    expect(() => parseUsageSummaryPayload({ requestLimit: 1_001 })).toThrow(
      /Invalid usage-summary payload/,
    );
  });
});
