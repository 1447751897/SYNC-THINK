import { describe, expect, it } from 'vitest';
import { parseRunProcessPayload, parseRunProcessPageRequest } from './run-process-page.js';

describe('run process page payloads', () => {
  it('preserves the original request and binds every page to a conversation', () => {
    expect(parseRunProcessPayload({ runId: 'run' })).toEqual({ runId: 'run' });
    const payload = {
      runId: 'run',
      conversationId: 'conversation',
      page: { section: 'fileChanges', offset: 40, version: 'a'.repeat(64) },
    };
    expect(parseRunProcessPayload(payload)).toEqual(payload);
    expect(parseRunProcessPayload({ ...payload, conversationId: undefined })).toBeUndefined();
    expect(parseRunProcessPayload({ ...payload, extra: true })).toBeUndefined();
  });
  it('rejects unbounded or malformed ranges and inherited identity', () => {
    for (const page of [
      { section: 'steps', offset: -1 },
      { section: 'steps', offset: 0, limit: 41 },
      { section: 'steps', offset: 0, limit: 0 },
      { section: 'unknown', offset: 0 },
      { section: ['steps'], offset: 0 },
      { section: 'steps', offset: 0, version: 'bad' },
    ])
      expect(parseRunProcessPageRequest(page)).toBeUndefined();
    expect(parseRunProcessPayload(Object.create({ runId: 'run' }))).toBeUndefined();
  });
});
