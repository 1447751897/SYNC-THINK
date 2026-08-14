import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { startKernelProcess } from './process.js';

function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('startKernelProcess', () => {
  it('spawns a kernel with injected env and captures the stderr tail', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sync-think-kernel-proc-'));
    try {
      const script = [
        'console.error("KERNEL_BOOT " + (process.env.KERNEL_TEST_VAR || "missing"));',
        'setInterval(()=>{},1000);',
      ].join('');
      const handle = startKernelProcess({
        command: process.execPath,
        args: ['-e', script],
        cwd,
        env: { KERNEL_TEST_VAR: 'present' },
      });
      await once(handle.child, 'spawn');
      const pid = handle.child.pid!;
      expect(pid).toBeTypeOf('number');
      expect(isAlive(pid)).toBe(true);

      // Wait for the boot line to be captured in the stderr tail.
      for (let i = 0; i < 50; i++) {
        if (handle.stderrTail().includes('KERNEL_BOOT present')) break;
        await delay(50);
      }
      expect(handle.stderrTail()).toContain('KERNEL_BOOT present');
      expect(handle.job).not.toBeNull(); // win32: Job Object attached

      await handle.killTree();
      await delay(500);
      expect(isAlive(pid)).toBe(false);
    } finally {
      removeDir(cwd);
    }
  });

  it('routes .cmd shims through cmd.exe (win32)', async () => {
    if (process.platform !== 'win32') return;
    const cwd = mkdtempSync(join(tmpdir(), 'sync-think-kernel-shim-'));
    try {
      const handle = startKernelProcess({
        command: 'claude',
        args: ['--version'],
        cwd,
      });
      const child = handle.child;
      const exit = await Promise.race([
        once(child, 'exit'),
        delay(15000).then(() => null),
      ]);
      expect(exit).not.toBeNull();
      await handle.killTree();
    } finally {
      removeDir(cwd);
    }
  });
});
