import { describe, expect, it } from 'vitest';
import { parseListWaitingBrowserHandoffsPayload } from './browser-handoff.js';

describe('Runtime browser handoff query scope contract', () => {
  it('accepts the group scope that the desktop IPC boundary must forward', () => {
    const payload = { conversationId: 'group-a', workspaceId: 'workspace-a', runId: 'run-a' };
    expect(parseListWaitingBrowserHandoffsPayload(payload)).toEqual(payload);
  });

  it('continues accepting unscoped and private workspace/run reads', () => {
    expect(parseListWaitingBrowserHandoffsPayload({})).toEqual({});
    expect(parseListWaitingBrowserHandoffsPayload({ workspaceId: 'workspace-a', runId: 'run-a' }))
      .toEqual({ workspaceId: 'workspace-a', runId: 'run-a' });
  });

  it.each(['', 'group a', null, 42, 'x'.repeat(257)])('rejects invalid conversation scope %s', conversationId => {
    expect(parseListWaitingBrowserHandoffsPayload({ conversationId })).toBeUndefined();
  });

  it('keeps strict unknown-field validation rather than widening the command surface', () => {
    expect(parseListWaitingBrowserHandoffsPayload({ conversationId: 'group-a', extra: true })).toBeUndefined();
  });
});