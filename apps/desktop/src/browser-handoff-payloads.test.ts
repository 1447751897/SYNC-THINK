import { describe, expect, it } from 'vitest';
import {
  parseCancelBrowserHandoffPayload,
  parseContinueBrowserHandoffPayload,
  parseListWaitingBrowserHandoffsPayload,
} from './browser-handoff-payloads.js';

describe('browser handoff payloads', () => {
  it('normalizes valid list and decision payloads', () => {
    expect(parseListWaitingBrowserHandoffsPayload(undefined)).toEqual({});
    expect(
      parseListWaitingBrowserHandoffsPayload({ workspaceId: 'workspace-1', runId: 'run-1' }),
    ).toEqual({ workspaceId: 'workspace-1', runId: 'run-1' });
    expect(
      parseContinueBrowserHandoffPayload({ handoffId: 'handoff-1', expectedRevision: 1 }),
    ).toEqual({ handoffId: 'handoff-1', expectedRevision: 1 });
    expect(
      parseCancelBrowserHandoffPayload({
        handoffId: 'handoff-1',
        expectedRevision: 1,
        leaseDisposition: 'release',
      }),
    ).toEqual({ handoffId: 'handoff-1', expectedRevision: 1, leaseDisposition: 'release' });
  });

  it('preserves the group conversation scope through the desktop boundary', () => {
    expect(parseListWaitingBrowserHandoffsPayload({
      workspaceId: 'workspace-1', conversationId: 'group-1', runId: 'run-1',
    })).toEqual({ workspaceId: 'workspace-1', conversationId: 'group-1', runId: 'run-1' });
  });

  it.each(['', 'group 1', 17, null, 'x'.repeat(257)])('rejects invalid conversationId %s', (conversationId) => {
    expect(() => parseListWaitingBrowserHandoffsPayload({ conversationId })).toThrow(
      'Invalid list-waiting-browser-handoffs payload',
    );
  });

  it('keeps cancellation lease disposition optional', () => {
    expect(
      parseCancelBrowserHandoffPayload({ handoffId: 'handoff-1', expectedRevision: 1 }),
    ).toEqual({ handoffId: 'handoff-1', expectedRevision: 1 });
  });

  it('rejects unknown fields, whitespace IDs, stale revisions and invalid dispositions', () => {
    expect(() => parseListWaitingBrowserHandoffsPayload({ extra: true })).toThrow(
      'Invalid list-waiting-browser-handoffs payload',
    );
    expect(() =>
      parseContinueBrowserHandoffPayload({ handoffId: 'handoff 1', expectedRevision: 1 }),
    ).toThrow('Invalid continue-browser-handoff payload');
    expect(() =>
      parseContinueBrowserHandoffPayload({ handoffId: 'handoff-1', expectedRevision: 2 }),
    ).toThrow('Invalid continue-browser-handoff payload');
    expect(() =>
      parseCancelBrowserHandoffPayload({
        handoffId: 'handoff-1',
        expectedRevision: 1,
        leaseDisposition: 'close',
      }),
    ).toThrow('Invalid cancel-browser-handoff payload');
  });
});
