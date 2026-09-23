import { describe, expect, it } from 'vitest';
import { AbortControllerRegistry } from './abort-controller-registry.js';

describe('abort controller registry', () => {
  it('starts and retrieves a controller', () => {
    const registry = new AbortControllerRegistry();

    const controller = registry.start('run-a');

    expect(registry.get('run-a')).toBe(controller);
    expect(registry.count()).toBe(1);
  });

  it('can replace and abort the previous controller', () => {
    const registry = new AbortControllerRegistry();
    const previous = registry.start('request-a');

    const current = registry.start('request-a', { abortPrevious: true });

    expect(previous.signal.aborted).toBe(true);
    expect(current.signal.aborted).toBe(false);
    expect(registry.get('request-a')).toBe(current);
  });

  it('deletes only the controller that still owns the key', () => {
    const registry = new AbortControllerRegistry();
    const previous = registry.start('request-a');
    const current = registry.start('request-a');

    expect(registry.deleteIf('request-a', previous)).toBe(false);
    expect(registry.get('request-a')).toBe(current);
    expect(registry.deleteIf('request-a', current)).toBe(true);
    expect(registry.count()).toBe(0);
  });

  it('supports abort-only and abort-with-delete lifecycles', () => {
    const registry = new AbortControllerRegistry();
    const retained = registry.start('run-a');
    const removed = registry.start('run-b');

    expect(registry.abort('run-a')).toBe(true);
    expect(retained.signal.aborted).toBe(true);
    expect(registry.get('run-a')).toBe(retained);
    expect(registry.abortAndDelete('run-b')).toBe(true);
    expect(removed.signal.aborted).toBe(true);
    expect(registry.get('run-b')).toBeUndefined();
  });

  it('aborts every current controller during shutdown', () => {
    const registry = new AbortControllerRegistry();
    const first = registry.start('run-a');
    const second = registry.start('run-b');

    registry.abortAll();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(registry.count()).toBe(2);
  });
});
