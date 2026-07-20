import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closePlaywrightBrowserWorkers,
  PlaywrightBrowserWorker,
} from './browser-worker.js';
import type { WorkerEvent, WorkerToken } from '../types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await closePlaywrightBrowserWorkers(15_000);
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}, 30_000);

async function collect(events: AsyncIterable<WorkerEvent>): Promise<WorkerEvent[]> {
  const collected: WorkerEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe.runIf(process.platform === 'win32')('PlaywrightBrowserWorker', () => {
  it('reuses one independent persistent profile across browser actions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-profile-'));
    tempDirs.push(root);
    const profilePath = join(root, 'profile');
    const token: WorkerToken = {
      token: 'browser-test',
      allowedRoot: root,
      timeoutMs: 20_000,
      maxOutputBytes: 8_000,
    };
    const worker = new PlaywrightBrowserWorker();
    const navigation = await collect(
      worker.exec(
        {
          workingDir: root,
          profilePath,
          action: { kind: 'navigate', url: 'data:text/html,<main>SYNC-THINK Browser</main>' },
        },
        token,
      ),
    );
    expect(navigation.at(-1)).toMatchObject({ type: 'completed', output: { ok: true } });
    const extraction = await collect(
      worker.exec(
        { workingDir: root, profilePath, action: { kind: 'extract', selector: 'main' } },
        token,
      ),
    );
    expect(extraction.at(-1)).toMatchObject({
      type: 'completed',
      output: { extractedText: 'SYNC-THINK Browser' },
    });
  });
});

describe('closePlaywrightBrowserWorkers', () => {
  it('returns within the shutdown bound when a browser context does not close', async () => {
    const neverCloses = {
      close: () => new Promise<void>(() => undefined),
    } as unknown as Parameters<
      typeof PlaywrightBrowserWorker.contexts.set
    >[1];
    PlaywrightBrowserWorker.contexts.set('stuck-profile', neverCloses);

    const startedAt = Date.now();
    await closePlaywrightBrowserWorkers(20);

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(PlaywrightBrowserWorker.contexts.size).toBe(0);
  });
});
