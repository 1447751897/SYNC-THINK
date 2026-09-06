import { describe, expect, it } from 'vitest';
import { publicEventPayload } from './event-display.js';
import { parseContentReference } from './deferred-content.js';

describe('public event display sources', () => {
  it('preserves complete display fields while excluding private run state', () => {
    const payload = {
      result: 'complete',
      vendorDetail: { nested: 'full detail' },
      run: {
        threadId: 'thread',
        modelId: 'model',
        assistantText: 'private',
        credentialValue: 'private',
      },
      runStateDelta: { private: true },
    };
    expect(publicEventPayload(payload)).toEqual({
      result: 'complete',
      vendorDetail: { nested: 'full detail' },
      run: { threadId: 'thread', modelId: 'model' },
    });
    expect(payload.runStateDelta).toEqual({ private: true });
  });
  it('permits only the display payload root for an event display reference', () => {
    expect(
      parseContentReference({ source: 'event-display', id: 'event', path: ['payload'] }),
    ).toEqual({ source: 'event-display', id: 'event', path: ['payload'] });
    for (const path of [[], ['run'], ['payload', 'run'], ['runStateDelta']])
      expect(parseContentReference({ source: 'event-display', id: 'event', path })).toBeUndefined();
    expect(
      parseContentReference({
        source: 'event-display',
        id: 'event',
        path: ['payload'],
        file: 'secret',
      }),
    ).toBeUndefined();
  });
});
