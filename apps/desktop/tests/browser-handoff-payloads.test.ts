import { describe, expect, it } from 'vitest';
import {
  parseCancelBrowserHandoffPayload,
  parseContinueBrowserHandoffPayload,
  parseListWaitingBrowserHandoffsPayload,
} from '../src/browser-handoff-payloads.js';

describe('browser handoff payloads', () => {
  it('accepts strict list, continue, and cancel payloads', () => {
    expect(
      parseListWaitingBrowserHandoffsPayload({ workspaceId: 'workspace-1', runId: 'run-1' }),
    ).toEqual({ workspaceId: 'workspace-1', runId: 'run-1' });
    expect(parseContinueBrowserHandoffPayload({ handoffId: 'handoff-1', expectedRevision: 1 }))
      .toEqual({ handoffId: 'handoff-1', expectedRevision: 1 });
    expect(
      parseCancelBrowserHandoffPayload({
        handoffId: 'handoff-1',
        expectedRevision: 1,
        leaseDisposition: 'release',
      }),
    ).toEqual({ handoffId: 'handoff-1', expectedRevision: 1, leaseDisposition: 'release' });
  });

  it.each([
    { workspaceId: 'workspace 1' },
    { runId: '' },
    { workspaceId: 'workspace-1', unexpected: true },
  ])('rejects invalid list payload %#', (payload) => {
    expect(() => parseListWaitingBrowserHandoffsPayload(payload)).toThrow(
      /Invalid list-waiting-browser-handoffs/,
    );
  });

  it.each([
    { handoffId: 'handoff-1', expectedRevision: 2 },
    { handoffId: 'handoff 1', expectedRevision: 1 },
    { handoffId: 'handoff-1', expectedRevision: 1, unexpected: true },
  ])('rejects invalid continue payload %#', (payload) => {
    expect(() => parseContinueBrowserHandoffPayload(payload)).toThrow(
      /Invalid continue-browser-handoff/,
    );
  });

  it.each([
    { handoffId: 'handoff-1', expectedRevision: 0 },
    { handoffId: 'handoff-1', expectedRevision: 1, leaseDisposition: 'close' },
    { handoffId: 'handoff-1', expectedRevision: 1, unexpected: true },
  ])('rejects invalid cancel payload %#', (payload) => {
    expect(() => parseCancelBrowserHandoffPayload(payload)).toThrow(
      /Invalid cancel-browser-handoff/,
    );
  });
});
