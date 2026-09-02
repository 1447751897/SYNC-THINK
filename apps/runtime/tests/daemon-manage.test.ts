import { describe, expect, it } from 'vitest';
import {
  buildDaemonStatusPayload,
  isHeartbeatStale,
  HEARTBEAT_STALE_MS,
  type DaemonStatusPayload,
} from '../src/daemon/manage.js';
import { createDaemonStatus } from '../src/daemon/core.js';

describe('buildDaemonStatusPayload', () => {
  it('builds a status snapshot with all daemon metrics', () => {
    const status = { ...createDaemonStatus(), heartbeatAt: '2025-01-01T09:59:59.000Z' };
    const payload = buildDaemonStatusPayload(status, {
      running: true,
      runtimeReady: true,
      autostartRegistered: true,
      maxConcurrent: 2,
      now: new Date('2025-01-01T10:00:00.000Z'),
    });
    expect(payload).toMatchObject({
      running: true,
      runtimeReady: true,
      autostart: true,
      maxConcurrent: 2,
      todayFired: 0,
      queued: 0,
      timerCount: 0,
    });
    expect(payload.heartbeatStale).toBe(false);
  });

  it('flags stale heartbeat (no heartbeat yet)', () => {
    const status = createDaemonStatus(); // heartbeatAt 未设置
    const payload = buildDaemonStatusPayload(status, {
      running: true,
      now: new Date('2025-01-01T10:00:00.000Z'),
    });
    expect(payload.heartbeatStale).toBe(true);
  });
});

describe('isHeartbeatStale', () => {
  it('returns false for a recent heartbeat', () => {
    const now = new Date('2025-01-01T10:00:00.000Z');
    const heartbeat = new Date(now.getTime() - 2_000);
    expect(isHeartbeatStale(heartbeat, now)).toBe(false);
  });

  it('returns true for a heartbeat older than the stale threshold', () => {
    const now = new Date('2025-01-01T10:00:00.000Z');
    const heartbeat = new Date(now.getTime() - (HEARTBEAT_STALE_MS + 1_000));
    expect(isHeartbeatStale(heartbeat, now)).toBe(true);
  });

  it('returns true for no heartbeat at all', () => {
    expect(isHeartbeatStale(undefined, new Date())).toBe(true);
  });
});

describe('daemon status payload shape', () => {
  it('exposes the fields the settings card renders', () => {
    const payload: DaemonStatusPayload = {
      running: true,
      runtimeReady: false,
      heartbeatAt: '2025-01-01T10:00:00.000Z',
      heartbeatStale: false,
      todayFired: 6,
      queued: 2,
      timerCount: 5,
      autostart: true,
      maxConcurrent: 2,
    };
    expect(payload.todayFired).toBe(6);
    expect(payload.queued).toBe(2);
    expect(payload.timerCount).toBe(5);
    expect(payload.autostart).toBe(true);
    expect(payload.maxConcurrent).toBe(2);
  });
});
