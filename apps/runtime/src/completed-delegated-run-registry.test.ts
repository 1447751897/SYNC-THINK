import { describe, expect, it } from 'vitest';
import { CompletedDelegatedRunRegistry } from './completed-delegated-run-registry.js';

type TerminalState = 'completed' | 'failed' | 'cancelled' | 'timed_out';

describe('CompletedDelegatedRunRegistry', () => {
  it('remembers a terminal run and state together', () => {
    const registry = new CompletedDelegatedRunRegistry<{ answer: string }, TerminalState>();
    const run = { answer: 'done' };

    registry.remember('child-1', run, 'completed');

    expect(registry.getRun('child-1')).toBe(run);
    expect(registry.count()).toBe(1);
  });

  it('supports state arriving before the terminal snapshot', () => {
    const registry = new CompletedDelegatedRunRegistry<{ answer: string }, TerminalState>();
    registry.markState('child-1', 'timed_out');

    expect(registry.take('child-1')).toEqual({ state: 'timed_out' });
  });

  it('atomically consumes the retained record', () => {
    const registry = new CompletedDelegatedRunRegistry<{ answer: string }, TerminalState>();
    registry.remember('child-1', { answer: 'failed' }, 'failed');

    expect(registry.take('child-1')).toEqual({ run: { answer: 'failed' }, state: 'failed' });
    expect(registry.take('child-1')).toBeUndefined();
    expect(registry.count()).toBe(0);
  });

  it('deletes abandoned background results', () => {
    const registry = new CompletedDelegatedRunRegistry<{ answer: string }, TerminalState>();
    registry.remember('child-1', { answer: 'cancelled' }, 'cancelled');

    expect(registry.delete('child-1')).toBe(true);
    expect(registry.delete('child-1')).toBe(false);
  });
});
