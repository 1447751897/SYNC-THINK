import { describe, expect, it } from 'vitest';
import {
  parseListMemoryPayload,
  parseDecideMemoryPayload,
  parseListDiagnosticsPayload,
  parseRollbackMemoryPayload,
} from '../src/memory-payloads.js';

describe('memory payloads', () => {
  it('parses list/decide/diagnostics and rejects bad decide', () => {
    expect(parseListMemoryPayload(null)).toEqual({});
    expect(parseListMemoryPayload({ workspaceId: 'w1', limit: 10 })).toEqual({
      workspaceId: 'w1',
      limit: 10,
    });
    expect(parseListDiagnosticsPayload({ taskId: 't1', limit: 5 })).toEqual({
      taskId: 't1',
      limit: 5,
    });
    expect(() => parseDecideMemoryPayload({ changeId: '', decision: 'approved' })).toThrow();
    expect(() => parseDecideMemoryPayload({ changeId: 'c1', decision: 'maybe' })).toThrow();
    const ok = parseDecideMemoryPayload({ changeId: ' c1 ', decision: 'rejected' });
    expect(ok).toEqual({ changeId: 'c1', decision: 'rejected' });
    expect(parseListMemoryPayload({ approvalState: 'rolled_back' })).toEqual({
      approvalState: 'rolled_back',
    });
    expect(parseRollbackMemoryPayload({ changeId: ' c2 ' })).toEqual({ changeId: 'c2' });
    expect(() => parseRollbackMemoryPayload({ changeId: '' })).toThrow();
  });
});
