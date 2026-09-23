import { describe, expect, it, vi } from 'vitest';
import { CapabilityUsageRecorder } from './capability-usage-recorder.js';

const usage = {
  id: 'run-a:skill:skill-a:skill-context',
  capabilityType: 'skill' as const,
  capabilityId: 'skill-a',
  workspaceId: 'workspace-a',
  runId: 'run-a',
  outcome: 'success' as const,
  contextTokens: 120,
};

describe('capability usage recorder', () => {
  it('does nothing when usage persistence is unavailable', () => {
    expect(new CapabilityUsageRecorder().record(usage)).toBe(false);
  });

  it('appends each usage identity once', () => {
    const appendUsageEvent = vi.fn();
    const recorder = new CapabilityUsageRecorder({ appendUsageEvent });

    expect(recorder.record(usage)).toBe(true);
    expect(recorder.record({ ...usage, contextTokens: 999 })).toBe(false);
    expect(recorder.record({ ...usage, id: `${usage.id}:other` })).toBe(true);

    expect(appendUsageEvent).toHaveBeenCalledTimes(2);
    expect(appendUsageEvent).toHaveBeenNthCalledWith(1, usage);
  });

  it('allows retry when persistence fails', () => {
    const appendUsageEvent = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('storage unavailable');
      })
      .mockReturnValue(undefined);
    const recorder = new CapabilityUsageRecorder({ appendUsageEvent });

    expect(() => recorder.record(usage)).toThrow('storage unavailable');
    expect(recorder.record(usage)).toBe(true);
    expect(appendUsageEvent).toHaveBeenCalledTimes(2);
  });
});
