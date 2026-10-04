import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { waitForOwnedBrowserExit } from './browser-host.js';
function child() {
  return Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    killed: false,
    kill: vi.fn(),
  });
}
it('waits for graceful Browser.close before a kill fallback so Profile writes can finish', async () => {
  const process = child();
  const pending = waitForOwnedBrowserExit(process as unknown as ChildProcess, 1000);
  expect(process.kill).not.toHaveBeenCalled();
  process.emit('exit', 0);
  await pending;
  expect(process.kill).not.toHaveBeenCalled();
  expect(process.listenerCount('exit')).toBe(0);
});
it('uses the kill fallback only after the graceful exit deadline', async () => {
  const process = child();
  await waitForOwnedBrowserExit(process as unknown as ChildProcess, 5);
  expect(process.kill).toHaveBeenCalledTimes(1);
  expect(process.listenerCount('exit')).toBe(0);
});
it('does not kill a browser which already exited', async () => {
  const process = Object.assign(child(), { exitCode: 0 });
  await waitForOwnedBrowserExit(process as unknown as ChildProcess, 5);
  expect(process.kill).not.toHaveBeenCalled();
});
