import { describe, expect, it } from 'vitest';
import { ExternalEventExecutionRegistry } from './external-event-execution-registry.js';

describe('external event execution registry', () => {
  it('registers one execution across event and run indexes', () => {
    const registry = new ExternalEventExecutionRegistry();

    expect(
      registry.register({ eventId: 'event-a', leaseToken: 'lease-a', runId: 'run-a' }),
    ).toEqual({ shouldAttachCleanup: true });

    expect(registry.activeCount()).toBe(1);
    expect(registry.eventIds()).toEqual(['event-a']);
    expect(registry.getByEvent('event-a')).toEqual({
      eventId: 'event-a',
      leaseToken: 'lease-a',
      runId: 'run-a',
    });
    expect(registry.getByRun('run-a')?.eventId).toBe('event-a');
  });

  it('refreshes a lease without attaching duplicate cleanup', () => {
    const registry = new ExternalEventExecutionRegistry();
    registry.register({ eventId: 'event-a', leaseToken: 'lease-a', runId: 'run-a' });

    expect(
      registry.register({ eventId: 'event-a', leaseToken: 'lease-b', runId: 'run-a' }),
    ).toEqual({ shouldAttachCleanup: false });

    expect(registry.activeCount()).toBe(1);
    expect(registry.getByRun('run-a')?.leaseToken).toBe('lease-b');
  });

  it('completes all indexes and cleanup ownership atomically', () => {
    const registry = new ExternalEventExecutionRegistry();
    registry.register({ eventId: 'event-a', leaseToken: 'lease-a', runId: 'run-a' });

    expect(registry.completeRun('run-a')).toEqual({
      eventId: 'event-a',
      leaseToken: 'lease-a',
      runId: 'run-a',
    });
    expect(registry.activeCount()).toBe(0);
    expect(registry.getByEvent('event-a')).toBeUndefined();
    expect(registry.getByRun('run-a')).toBeUndefined();
    expect(registry.completeRun('run-a')).toBeUndefined();
  });

  it('keeps concurrent executions isolated', () => {
    const registry = new ExternalEventExecutionRegistry();
    registry.register({ eventId: 'event-a', leaseToken: 'lease-a', runId: 'run-a' });
    registry.register({ eventId: 'event-b', leaseToken: 'lease-b', runId: 'run-b' });

    registry.completeRun('run-a');

    expect(registry.activeCount()).toBe(1);
    expect(registry.eventIds()).toEqual(['event-b']);
    expect(registry.getByRun('run-b')?.leaseToken).toBe('lease-b');
  });
});
