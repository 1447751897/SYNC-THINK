/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createKillOnCloseJob } from './job-object.js';

const sleepForever = process.execPath;
const sleepArgs = ['-e', 'setInterval(()=>{},1000)'];

async function waitForExit(child: import('node:child_process').ChildProcess, timeoutMs: number) {
  const exit = once(child, 'exit');
  const timer = delay(timeoutMs).then(() => null);
  const [code, signal] = await Promise.race([exit, timer]);
  return { code, signal };
}

describe('createKillOnCloseJob', () => {
  it('returns null on non-Windows platforms', () => {
    if (process.platform === 'win32') return;
    expect(createKillOnCloseJob()).toBeNull();
  });

  it('KILL_ON_JOB_CLOSE terminates assigned children when the job closes (win32)', async () => {
    if (process.platform !== 'win32') return;
    const job = createKillOnCloseJob();
    expect(job).not.toBeNull();
    if (!job) return;

    const child = spawn(sleepForever, sleepArgs, { stdio: 'ignore' });
    await once(child, 'spawn');
    const pid = child.pid;
    expect(pid).toBeTypeOf('number');

    // Fresh children are alive before assignment.
    expect(isAlive(pid!)).toBe(true);

    const assigned = job.assign(pid!);
    expect(assigned).toBe(true);

    job.close();
    const { code, signal } = await waitForExit(child, 5000);
    // The OS kills the child as part of the job close — no taskkill involved.
    expect(code !== null || signal !== null).toBe(true);
    expect(isAlive(pid!)).toBe(false);
  });

  it('keeps the child alive while the job is open (win32)', async () => {
    if (process.platform !== 'win32') return;
    const job = createKillOnCloseJob();
    if (!job) return;
    const child = spawn(sleepForever, sleepArgs, { stdio: 'ignore' });
    await once(child, 'spawn');
    const pid = child.pid;
    expect(job.assign(pid!)).toBe(true);
    await delay(500);
    expect(isAlive(pid!)).toBe(true);
    job.close();
    await waitForExit(child, 5000);
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
