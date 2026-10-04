import { describe, expect, it } from 'vitest';
import { restoreDaemonStatus, updateDaemonStatus, type DaemonStatus } from './core.js';

const now = new Date(2026, 9, 3, 15, 0, 0);
const stopped: DaemonStatus = { running: false, counterDate: '2026-10-03', todayFired: 4, queued: 0, timerCount: 6, heartbeatAt: new Date(2026, 9, 3, 14, 0, 0).toISOString() };

describe('daemon startup status', () => {
  it('restores same-day counters without inheriting the previous shutdown flag', () => {
    const status = restoreDaemonStatus(stopped, now);
    expect(status).toEqual({ ...stopped, running: true });
    expect(updateDaemonStatus(status, { heartbeatAt: now }).running).toBe(true);
    expect(stopped.running).toBe(false);
  });
  it('rolls yesterday counters while declaring the new process running', () => {
    const status = restoreDaemonStatus({ ...stopped, counterDate: '2026-10-02' }, now);
    expect(status).toMatchObject({ running: true, counterDate: '2026-10-03', todayFired: 0, timerCount: 6 });
  });
  it('initializes a clean process without a previous status file', () => {
    expect(restoreDaemonStatus(undefined, now)).toEqual({ running: true, counterDate: '2026-10-03', todayFired: 0, queued: 0, timerCount: 0 });
  });
});
