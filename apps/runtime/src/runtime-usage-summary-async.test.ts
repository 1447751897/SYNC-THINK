import { decodeFrames, type Frame } from '@sync-think/protocol';
import { describe, expect, it } from 'vitest';
import { Runtime } from './runtime.js';
import type { UsageSummaryRawResult } from './usage-summary-cache.js';

function emptySummary(): UsageSummaryRawResult {
  return { rows: [], requests: [], tools: [], toolModels: [], toolFailures: [] };
}

describe('Runtime usage summary dispatch', () => {
  it('keeps healthcheck responsive while the usage cache refresh is pending', async () => {
    let resolveUsage!: (summary: UsageSummaryRawResult) => void;
    const usagePending = new Promise<UsageSummaryRawResult>((resolve) => {
      resolveUsage = resolve;
    });
    const runtime = new Runtime({
      installId: 'usage-summary-healthcheck',
      allowNoToken: true,
      queryUsageSummary: () => usagePending,
    });
    const usageWrites: Buffer[] = [];
    const healthWrites: Buffer[] = [];
    const internal = runtime as unknown as {
      handlers: {
        onFrame(socket: { write(data: Buffer): boolean }, frame: Frame): void;
      };
    };

    internal.handlers.onFrame(
      {
        write(data) {
          usageWrites.push(Buffer.from(data));
          return true;
        },
      },
      {
        id: 'usage-1',
        kind: 'request',
        type: 'usage.summary',
        payload: {},
      },
    );
    internal.handlers.onFrame(
      {
        write(data) {
          healthWrites.push(Buffer.from(data));
          return true;
        },
      },
      {
        id: 'health-1',
        kind: 'request',
        type: 'runtime.healthcheck',
        payload: {},
      },
    );

    expect(usageWrites).toHaveLength(0);
    expect(decodeFrames(Buffer.concat(healthWrites)).frames[0]).toMatchObject({
      id: 'health-1',
      kind: 'response',
      type: 'runtime.healthcheck',
    });

    resolveUsage(emptySummary());
    await new Promise((resolve) => setImmediate(resolve));
    expect(decodeFrames(Buffer.concat(usageWrites)).frames[0]).toMatchObject({
      id: 'usage-1',
      kind: 'response',
      type: 'usage.summary',
    });
  });
});
