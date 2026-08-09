import { describe, it, expect } from 'vitest';
import { healthcheck, makeHealthcheck } from '../src/healthcheck.js';
import { PROTOCOL_VERSION, DEFAULT_FEATURES } from '@sync-think/protocol';

describe('healthcheck', () => {
  it('returns ok with uptime monotonic and features', () => {
    const start = Date.now() - 1000;
    const hc = makeHealthcheck(start, {
      inFlightRuns: 3,
      inFlightRunIds: ['run-c', 'run-a', 'run-b'],
      eventSequence: 42,
    });
    expect(hc.ok).toBe(true);
    expect(hc.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(hc.features).toEqual(DEFAULT_FEATURES);
    expect(hc.inFlightRuns).toBe(3);
    expect(hc.inFlightRunIds).toEqual(['run-a', 'run-b', 'run-c']);
    expect(hc.eventSequence).toBe(42);
    expect(hc.uptimeMs).toBeGreaterThanOrEqual(1000);
  });

  it('process-based variant keys on process.pid', () => {
    const start = Date.now() - 50;
    const h = healthcheck(start);
    expect('ok' in h && h.ok).toBe(true);
    if (h.ok) {
      expect(h.inFlightRunIds).toEqual([]);
      expect(h.eventSequence).toBe(0);
    }
  });
});
