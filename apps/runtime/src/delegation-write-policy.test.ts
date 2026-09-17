import { describe, expect, it } from 'vitest';
import { delegationMayWrite } from './runtime.js';

/**
 * A delegated child Agent runs headless: there is no approval card for it to
 * answer, which is why every child used to be hard-coded read-only. The Agent's
 * own `writePolicy` plus the conversation's permission mode now decide, most
 * restrictive first (docs/adr/0001-delegated-agent-write-policy.md).
 */
describe('delegationMayWrite', () => {
  it('keeps a read-only Agent read-only in every conversation mode', () => {
    for (const executionMode of ['ask', 'workspace', 'full-access']) {
      expect(delegationMayWrite({ writePolicy: 'read-only', executionMode })).toBe(false);
    }
  });

  it('treats a missing policy as read-only', () => {
    // Agents created before the column exist must not silently gain writes.
    expect(delegationMayWrite({ writePolicy: undefined, executionMode: 'full-access' })).toBe(false);
  });

  it('lets an inheriting Agent write only where the conversation allows it', () => {
    expect(delegationMayWrite({ writePolicy: 'inherit', executionMode: 'full-access' })).toBe(true);
    expect(delegationMayWrite({ writePolicy: 'inherit', executionMode: 'workspace' })).toBe(true);
  });

  it('refuses an inheriting Agent under ask, where nothing can approve it', () => {
    expect(delegationMayWrite({ writePolicy: 'inherit', executionMode: 'ask' })).toBe(false);
  });
});
