import { describe, expect, it } from 'vitest';
import { pipePathPortable } from '@sync-think/protocol';
import {
  daemonPipePath,
  decideSchedulerHeartbeat,
  probeDaemonPipe,
  type PipeProbe,
} from '../src/daemon/yield.js';

// ── daemonPipePath：独立管道名 ─────────────────────────────────────────────

describe('daemonPipePath', () => {
  it('uses a distinct pipe name from the desktop runtime pipe', () => {
    const runtime = pipePathPortable('dev-0001');
    const daemon = daemonPipePath('dev-0001');
    expect(daemon).not.toBe(runtime);
    expect(daemon).toContain('dev-0001');
    expect(daemon).toContain('daemon');
  });

  it('is deterministic per installId', () => {
    expect(daemonPipePath('dev-0001')).toBe(daemonPipePath('dev-0001'));
    expect(daemonPipePath('dev-0001')).not.toBe(daemonPipePath('dev-0002'));
  });
});

// ── probeDaemonPipe：探测 daemon 是否活着 ──────────────────────────────────

function fakeProbe(result: boolean): PipeProbe {
  return () => Promise.resolve(result);
}

describe('probeDaemonPipe', () => {
  it('resolves true when the probe connects', async () => {
    await expect(probeDaemonPipe('dev-0001', fakeProbe(true))).resolves.toBe(true);
  });

  it('resolves false when the probe times out or errors', async () => {
    await expect(probeDaemonPipe('dev-0001', fakeProbe(false))).resolves.toBe(false);
  });

  it('passes the daemon pipe path to the probe', async () => {
    let probedPath = '';
    const probe: PipeProbe = (path) => {
      probedPath = path;
      return Promise.resolve(true);
    };
    await probeDaemonPipe('dev-0001', probe);
    expect(probedPath).toBe(daemonPipePath('dev-0001'));
  });
});

// ── decideSchedulerHeartbeat：让位决策 ─────────────────────────────────────

describe('decideSchedulerHeartbeat', () => {
  it('starts the tick when the daemon is not alive (fallback to current behavior)', () => {
    expect(decideSchedulerHeartbeat({ daemonAlive: false, daemonWorker: false })).toBe(true);
  });

  it('starts the tick when the daemon probe failed (default)', () => {
    expect(decideSchedulerHeartbeat({})).toBe(true);
  });

  it('yields (no tick) when the daemon is alive', () => {
    expect(decideSchedulerHeartbeat({ daemonAlive: true, daemonWorker: false })).toBe(false);
  });

  it('never starts the tick in worker mode (unique scheduler constraint)', () => {
    expect(decideSchedulerHeartbeat({ daemonWorker: true })).toBe(false);
    expect(decideSchedulerHeartbeat({ daemonAlive: true, daemonWorker: true })).toBe(false);
  });
});
