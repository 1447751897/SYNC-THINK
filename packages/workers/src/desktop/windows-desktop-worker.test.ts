import { describe, expect, it } from 'vitest';
import { WindowsDesktopWorker } from './windows-desktop-worker.js';
import type { WorkerEvent } from '../types.js';

async function collect(worker: WindowsDesktopWorker) {
  const events: WorkerEvent[] = [];
  for await (const event of worker.exec(
    { workingDir: process.cwd(), action: { kind: 'list-windows', maxElements: 10 } },
    { token: 'desktop-test', allowedRoot: process.cwd(), timeoutMs: 15_000, maxOutputBytes: 32_000 },
  )) events.push(event);
  return events;
}

describe.runIf(process.platform === 'win32')('WindowsDesktopWorker', () => {
  it('reads real top-level Windows UI Automation windows with bounded output', async () => {
    const events = await collect(new WindowsDesktopWorker());
    expect(events.at(-1)).toMatchObject({ type: 'completed', output: { ok: true } });
    const output = events.at(-1);
    if (output?.type !== 'completed') throw new Error('Desktop worker did not complete');
    expect(Array.isArray(output.output.data)).toBe(true);
  });
});
