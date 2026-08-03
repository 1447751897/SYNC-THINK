import { describe, expect, it } from 'vitest';
import { collect } from '../support.js';
import type { DesktopHostExecutor } from './desktop-host-client.js';
import { IsolatedDesktopWorker } from './desktop-worker.js';

const baseInput = { action: { kind: 'probe' } as const, workingDir: process.cwd() };
const baseToken = { token: 'desktop', allowedRoot: process.cwd(), timeoutMs: 1_000 };

describe('IsolatedDesktopWorker', () => {
  it('emits the structured native host result', async () => {
    const host: DesktopHostExecutor = {
      execute: async () => ({
        kind: 'probe',
        backend: 'uia-com',
        platform: 'win32',
        architecture: 'x64',
        rootAvailable: true,
      }),
    };
    const events = await collect(new IsolatedDesktopWorker(host).exec(baseInput, baseToken));
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      output: { ok: true, result: { kind: 'probe', rootAvailable: true } },
    });
  });

  it('maps stable host failures into WorkerEvent failures', async () => {
    const host: DesktopHostExecutor = {
      execute: async () => {
        const error = new Error('timeout') as Error & {
          code: string;
          failureClass: 'timeout';
        };
        error.code = 'desktop.timeout';
        error.failureClass = 'timeout';
        throw error;
      },
    };
    const events = await collect(new IsolatedDesktopWorker(host).exec(baseInput, baseToken));
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      failureClass: 'timeout',
      error: { code: 'desktop.timeout' },
    });
  });
});
