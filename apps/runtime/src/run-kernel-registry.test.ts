import { describe, expect, it, vi } from 'vitest';
import { RunKernelRegistry, type RunKernelSettingsPort } from './run-kernel-registry.js';

describe('run kernel registry', () => {
  it('lazily loads and filters the persisted map', () => {
    const get = vi.fn(() => ({
      value: { 'run-a': 'codex', 'run-empty': '', 'run-invalid': 42 },
    }));
    const registry = new RunKernelRegistry({ get, set: vi.fn() });

    expect(get).not.toHaveBeenCalled();
    expect(registry.get('run-a')).toBe('codex');
    expect(registry.get('run-empty')).toBeUndefined();
    expect(registry.get('run-invalid')).toBeUndefined();
    expect(registry.count()).toBe(1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('persists changed records once and keeps them when persistence fails', () => {
    const set = vi.fn(() => {
      throw new Error('disk unavailable');
    });
    const registry = new RunKernelRegistry({ get: vi.fn(() => undefined), set });

    registry.record('run-a', 'claude-code');
    registry.record('run-a', 'claude-code');
    registry.record('', 'codex');
    registry.record('run-b', undefined);

    expect(registry.get('run-a')).toBe('claude-code');
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('kernel.runKernelIds', { 'run-a': 'claude-code' });
  });

  it('merges event-log backfill without writing settings', () => {
    const settings: RunKernelSettingsPort = { get: vi.fn(() => undefined), set: vi.fn() };
    const registry = new RunKernelRegistry(settings);

    registry.merge(new Map([['run-a', 'codex']]));

    expect(registry.get('run-a')).toBe('codex');
    expect(settings.set).not.toHaveBeenCalled();
  });
});
