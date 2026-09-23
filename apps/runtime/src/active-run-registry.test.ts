import { describe, expect, it } from 'vitest';
import { ActiveRunRegistry } from './active-run-registry.js';

describe('ActiveRunRegistry', () => {
  it('registers each active run once', () => {
    const registry = new ActiveRunRegistry();

    expect(registry.start('run-1')).toBe(true);
    expect(registry.start('run-1')).toBe(false);
    expect(registry.has('run-1')).toBe(true);
    expect(registry.count()).toBe(1);
  });

  it('finishes only registered runs', () => {
    const registry = new ActiveRunRegistry();
    registry.start('run-1');

    expect(registry.finish('run-1')).toBe(true);
    expect(registry.finish('run-1')).toBe(false);
    expect(registry.has('run-1')).toBe(false);
  });

  it('returns an isolated snapshot of active ids', () => {
    const registry = new ActiveRunRegistry();
    registry.start('run-1');
    registry.start('run-2');

    const ids = registry.ids();
    ids.push('external');

    expect(registry.ids()).toEqual(['run-1', 'run-2']);
    expect(registry.count()).toBe(2);
  });

  it('clears all registrations', () => {
    const registry = new ActiveRunRegistry();
    registry.start('run-1');
    registry.start('run-2');

    registry.clear();

    expect(registry.count()).toBe(0);
  });
});
