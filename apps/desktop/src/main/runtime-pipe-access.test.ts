import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  connect: vi.fn(),
  spawn: vi.fn(() => { throw new Error('Unexpected background spawn'); }),
}));
vi.mock('node:net', async (original) => ({
  ...await original<typeof import('node:net')>(),
  connect: io.connect,
}));
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(),
  spawn: io.spawn,
}));

import {
  ensureDaemonProcess,
  ensureRuntimeProcess,
  probeDaemonPipe,
  probeRuntimePipe,
  waitForRuntimeProcess,
} from './runtime-supervisor.js';
import { classifyRuntimeConnectError } from './runtime-client.js';

function result(code?: string) {
  io.connect.mockImplementation(() => {
    const socket = new EventEmitter() as EventEmitter & {
      destroyed: boolean;
      destroy(): void;
    };
    socket.destroyed = false;
    socket.destroy = () => { socket.destroyed = true; };
    queueMicrotask(() => code
      ? socket.emit('error', Object.assign(new Error('connect ' + code), { code }))
      : socket.emit('connect'));
    return socket;
  });
}

afterEach(() => vi.clearAllMocks());

describe('Desktop access to an existing background pipe', () => {
  for (const code of ['EPERM', 'EACCES']) {
    it.each([
      ['runtime', probeRuntimePipe],
      ['daemon', probeDaemonPipe],
    ] as const)('surfaces ' + code + ' from %s instead of reporting a missing service', async (_kind, probe) => {
      result(code);
      await expect(probe('permission-fixture')).rejects.toMatchObject({ code });
    });

    it.each([
      ['runtime', ensureRuntimeProcess],
      ['daemon', ensureDaemonProcess],
    ] as const)('does not spawn another %s owner after ' + code, async (_kind, ensure) => {
      result(code);
      await expect(ensure({ installId: 'permission-fixture', allowNoToken: true }))
        .rejects.toMatchObject({ code });
      expect(io.spawn).not.toHaveBeenCalled();
    });

    it('fails the runtime readiness wait immediately after ' + code, async () => {
      result(code);
      await expect(waitForRuntimeProcess('permission-fixture'))
        .rejects.toMatchObject({ code });
      expect(io.connect).toHaveBeenCalledTimes(1);
    });

    it('classifies ' + code + ' as non-retryable permission failure', () => {
      expect(classifyRuntimeConnectError(Object.assign(new Error('connect denied'), { code })))
        .toEqual({ code: 'runtime.permission-denied', retryable: false });
    });
  }

  it('still distinguishes an absent endpoint from a reachable one', async () => {
    result('ENOENT');
    expect(await probeRuntimePipe('permission-fixture')).toBe(false);
    result();
    expect(await probeDaemonPipe('permission-fixture')).toBe(true);
  });
});
