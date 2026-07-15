import { describe, it, expect } from 'vitest';
import { healthcheck, makeHealthcheck } from '../src/healthcheck.js';
import { PROTOCOL_VERSION, DEFAULT_FEATURES } from '@sync-think/protocol';

describe('healthcheck', () => {
  it('returns ok with uptime monotonic and features', () => {
    const start = Date.now() - 1000;
    const hc = makeHealthcheck(start, { inFlightRuns: 3 });
    expect(hc.ok).toBe(true);
    expect(hc.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(hc.features).toEqual(DEFAULT_FEATURES);
    expect(hc.inFlightRuns).toBe(3);
    expect(hc.uptimeMs).toBeGreaterThanOrEqual(1000);
  });

  it('process-based variant keys on process.pid', () => {
    const start = Date.now() - 50;
    const h = healthcheck(start);
    expect('ok' in h && h.ok).toBe(true);
  });
});
