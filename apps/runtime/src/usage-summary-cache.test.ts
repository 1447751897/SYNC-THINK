import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabaseAsync, type BetterSQLite3Raw } from '@sync-think/storage';
import {
  USAGE_SUMMARY_CACHE_VERSION,
  UsageSummaryQueryService,
  loadUsageSummarySnapshotInWorker,
  refreshUsageSummarySnapshotFromDatabase,
  summarizeUsageSnapshot,
  type UsageSummaryCacheSnapshot,
} from './usage-summary-cache.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createFixture(): Promise<{
  raw: BetterSQLite3Raw;
  databasePath: string;
  close(): void;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'sync-think-usage-summary-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'usage.db');
  const connection = await openDatabaseAsync({ path: databasePath });
  connection.raw.exec(`
    CREATE TABLE event (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      task_id TEXT,
      run_id TEXT,
      step_id TEXT,
      message_id TEXT,
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE run (id TEXT PRIMARY KEY, task_id TEXT NOT NULL);
    CREATE TABLE thread (id TEXT PRIMARY KEY, task_id TEXT NOT NULL);
    CREATE TABLE conversation (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      title TEXT NOT NULL
    );
  `);
  return {
    raw: connection.raw,
    databasePath,
    close: () => connection.raw.close(),
  };
}

function insertEvent(
  raw: BetterSQLite3Raw,
  input: {
    id: string;
    sequence: number;
    type: string;
    occurredAt: string;
    payload?: Record<string, unknown>;
    taskId?: string;
    runId?: string;
    stepId?: string;
  },
): void {
  raw
    .prepare(
      `INSERT INTO event (
        id, workspace_id, task_id, run_id, step_id, message_id,
        category, type, sequence, occurred_at, payload_json
      ) VALUES (?, 'workspace-1', ?, ?, ?, NULL, 'runtime', ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.taskId ?? null,
      input.runId ?? null,
      input.stepId ?? null,
      input.type,
      input.sequence,
      input.occurredAt,
      JSON.stringify(input.payload ?? {}),
    );
}

describe('usage summary cache projection', () => {
  it('recovers legacy external-kernel usage rows that only stored the provider model id', async () => {
    const fixture = await createFixture();
    try {
      insertEvent(fixture.raw, {
        id: 'usage-legacy-kernel',
        sequence: 1,
        type: 'provider.usage',
        occurredAt: '2026-08-29T00:00:00.000Z',
        payload: {
          requestId: 'kernel-request-1',
          providerId: 'provider-kimi',
          providerModelId: 'gpt-5.6-luna',
          tokensIn: 2_000,
          tokensOut: 100,
          totalTokens: 2_100,
        },
      });

      const summary = summarizeUsageSnapshot(refreshUsageSummarySnapshotFromDatabase(fixture.raw));

      expect(summary.requests).toEqual([
        expect.objectContaining({
          requestId: 'kernel-request-1',
          modelId: 'gpt-5.6-luna',
          providerModelId: 'gpt-5.6-luna',
          totalTokens: 2_100,
        }),
      ]);
    } finally {
      fixture.close();
    }
  });

  it('keeps legacy provider turns separate when only a shared packet id is available', async () => {
    const fixture = await createFixture();
    try {
      insertEvent(fixture.raw, {
        id: 'usage-legacy-turn-1',
        sequence: 1,
        type: 'provider.usage',
        occurredAt: '2026-08-02T09:00:00.000Z',
        taskId: 'task-legacy',
        runId: 'run-legacy',
        stepId: 'step-legacy',
        payload: {
          packetId: 'packet-shared-by-tool-loop',
          modelId: 'model-legacy',
          providerId: 'provider-legacy',
          tokensIn: 1_000,
          tokensOut: 10,
          cachedTokensHit: 512,
          totalTokens: 1_010,
        },
      });
      insertEvent(fixture.raw, {
        id: 'usage-legacy-turn-2',
        sequence: 2,
        type: 'provider.usage',
        occurredAt: '2026-08-02T09:00:01.000Z',
        taskId: 'task-legacy',
        runId: 'run-legacy',
        stepId: 'step-legacy',
        payload: {
          packetId: 'packet-shared-by-tool-loop',
          modelId: 'model-legacy',
          providerId: 'provider-legacy',
          tokensIn: 2_000,
          tokensOut: 20,
          cachedTokensHit: 1_024,
          totalTokens: 2_020,
        },
      });

      const summary = summarizeUsageSnapshot(refreshUsageSummarySnapshotFromDatabase(fixture.raw));

      expect(summary.requests).toHaveLength(2);
      expect(summary.requests.map((row) => row.requestId)).toEqual([
        'usage-legacy-turn-2',
        'usage-legacy-turn-1',
      ]);
      expect(summary.rows).toEqual([
        expect.objectContaining({
          modelId: 'model-legacy',
          requests: 2,
          tokensIn: 3_000,
          tokensOut: 30,
          cachedTokensHit: 1_536,
          totalTokens: 3_030,
        }),
      ]);
    } finally {
      fixture.close();
    }
  });

  it('ignores unrelated event storms and preserves provider/run/tool aggregation semantics', async () => {
    const fixture = await createFixture();
    try {
      for (let index = 0; index < 100; index += 1) {
        insertEvent(fixture.raw, {
          id: `noise-${index}`,
          sequence: index + 1,
          type: index % 2 === 0 ? 'context.packet.built' : 'run.fallback.selected',
          occurredAt: '2026-08-01T00:00:00.000Z',
          payload: { body: 'x'.repeat(1_000) },
          runId: 'run-noise',
        });
      }
      fixture.raw.prepare(`INSERT INTO run (id, task_id) VALUES ('run-1', 'task-1')`).run();
      fixture.raw
        .prepare(
          `INSERT INTO conversation (id, task_id, title)
           VALUES ('conversation-1', 'task-1', 'Usage cache regression')`,
        )
        .run();
      insertEvent(fixture.raw, {
        id: 'usage-1',
        sequence: 101,
        type: 'provider.usage',
        occurredAt: '2026-08-02T10:00:00.000Z',
        taskId: 'task-1',
        runId: 'run-1',
        stepId: 'step-1',
        payload: {
          requestId: 'request-1',
          modelId: 'model-1',
          providerId: 'provider-1',
          providerModelId: 'vendor/model-1',
          tokensIn: 10,
          tokensOut: 20,
          cachedTokensHit: 4,
          reasoningTokens: 2,
          totalTokens: 30,
        },
      });
      insertEvent(fixture.raw, {
        id: 'usage-2',
        sequence: 102,
        type: 'provider.usage',
        occurredAt: '2026-08-02T10:00:01.000Z',
        taskId: 'task-1',
        runId: 'run-1',
        stepId: 'step-1',
        payload: {
          requestId: 'request-1',
          modelId: 'model-1',
          providerId: 'provider-1',
          providerModelId: 'vendor/model-1',
          tokensIn: 15,
          tokensOut: 18,
          cachedTokensHit: 6,
          reasoningTokens: 3,
          totalTokens: 33,
        },
      });
      insertEvent(fixture.raw, {
        id: 'run-completed',
        sequence: 103,
        type: 'run.completed',
        occurredAt: '2026-08-02T10:00:03.000Z',
        taskId: 'task-1',
        runId: 'run-1',
      });
      insertEvent(fixture.raw, {
        id: 'tool-requested',
        sequence: 104,
        type: 'tool.requested',
        occurredAt: '2026-08-02T10:00:01.500Z',
        taskId: 'task-1',
        runId: 'run-1',
        payload: {
          toolCallId: 'call-1',
          toolName: 'write_file',
          run: { modelId: 'model-1', providerId: 'provider-1' },
        },
      });
      insertEvent(fixture.raw, {
        id: 'tool-failed',
        sequence: 105,
        type: 'tool.completed',
        occurredAt: '2026-08-02T10:00:02.000Z',
        taskId: 'task-1',
        runId: 'run-1',
        payload: {
          toolCallId: 'call-1',
          result: '<tool_use_error>disk full</tool_use_error>',
        },
      });

      const snapshot = refreshUsageSummarySnapshotFromDatabase(fixture.raw);
      const summary = summarizeUsageSnapshot(snapshot);

      expect(snapshot.facts).toHaveLength(5);
      expect(summary.requests).toEqual([
        expect.objectContaining({
          requestId: 'request-1',
          tokensIn: 15,
          tokensOut: 20,
          cachedTokensHit: 6,
          reasoningTokens: 3,
          totalTokens: 33,
          status: 'success',
          latencyMs: 3_000,
        }),
      ]);
      expect(summary.rows).toEqual([
        expect.objectContaining({
          modelId: 'model-1',
          requests: 1,
          succeededRequests: 1,
          failedRequests: 0,
          totalTokens: 33,
        }),
      ]);
      expect(summary.tools).toEqual([
        expect.objectContaining({
          toolName: 'write_file',
          calls: 1,
          failures: 1,
          successRate: 0,
        }),
      ]);
      expect(summary.toolFailures).toEqual([
        expect.objectContaining({
          toolName: 'write_file',
          modelId: 'model-1',
          conversationTitle: 'Usage cache regression',
          errorSummary: '<tool_use_error>disk full</tool_use_error>',
        }),
      ]);
      expect(summarizeUsageSnapshot(snapshot, '2026-08-02T10:00:02.500Z').requests).toHaveLength(0);
    } finally {
      fixture.close();
    }
  });

  it('scans only the appended rowid tail and rebuilds when the high-water fence no longer matches', async () => {
    const fixture = await createFixture();
    try {
      insertEvent(fixture.raw, {
        id: 'usage-1',
        sequence: 1,
        type: 'provider.usage',
        occurredAt: '2026-08-02T10:00:00.000Z',
        payload: { requestId: 'request-1', modelId: 'model-1', tokensIn: 1, tokensOut: 2 },
      });
      const firstRanges: Array<[number, number]> = [];
      const first = refreshUsageSummarySnapshotFromDatabase(fixture.raw, undefined, {
        onScanRange: (afterRowid, throughRowid) => firstRanges.push([afterRowid, throughRowid]),
      });
      expect(firstRanges).toEqual([[0, 1]]);

      insertEvent(fixture.raw, {
        id: 'noise-2',
        sequence: 2,
        type: 'context.packet.built',
        occurredAt: '2026-08-02T10:00:01.000Z',
      });
      insertEvent(fixture.raw, {
        id: 'usage-3',
        sequence: 3,
        type: 'provider.usage',
        occurredAt: '2026-08-02T10:00:02.000Z',
        payload: { requestId: 'request-2', modelId: 'model-2', tokensIn: 3, tokensOut: 4 },
      });
      const incrementalRanges: Array<[number, number]> = [];
      const second = refreshUsageSummarySnapshotFromDatabase(fixture.raw, first, {
        onScanRange: (afterRowid, throughRowid) =>
          incrementalRanges.push([afterRowid, throughRowid]),
      });
      expect(incrementalRanges).toEqual([[1, 3]]);
      expect(second.facts).toHaveLength(2);

      const invalidFence: UsageSummaryCacheSnapshot = {
        ...second,
        highWater: second.highWater ? { ...second.highWater, eventId: 'replaced' } : null,
      };
      const rebuildRanges: Array<[number, number]> = [];
      const rebuilt = refreshUsageSummarySnapshotFromDatabase(fixture.raw, invalidFence, {
        onScanRange: (afterRowid, throughRowid) => rebuildRanges.push([afterRowid, throughRowid]),
      });
      expect(rebuildRanges).toEqual([[0, 3]]);
      expect(rebuilt.facts).toHaveLength(2);
    } finally {
      fixture.close();
    }
  });
});

describe('UsageSummaryQueryService', () => {
  it('shares one in-flight refresh between concurrent range queries', async () => {
    let resolveSnapshot!: (snapshot: UsageSummaryCacheSnapshot) => void;
    const loader = vi.fn(
      () =>
        new Promise<UsageSummaryCacheSnapshot>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    const service = new UsageSummaryQueryService({
      databasePath: 'fixture.db',
      cachePath: 'fixture-cache.json',
      snapshotLoader: loader,
    });

    const first = service.query();
    const second = service.query('2026-08-01T00:00:00.000Z');
    expect(loader).toHaveBeenCalledTimes(1);

    resolveSnapshot({ version: USAGE_SUMMARY_CACHE_VERSION, highWater: null, facts: [] });
    await expect(first).resolves.toMatchObject({ requests: [] });
    await expect(second).resolves.toMatchObject({ requests: [] });
  });
});

describe('loadUsageSummarySnapshotInWorker', () => {
  it('loads the source module in a worker and persists the sidecar snapshot', async () => {
    const fixture = await createFixture();
    const cachePath = join(
      temporaryDirectories[temporaryDirectories.length - 1]!,
      'usage-summary-cache-v2.json',
    );
    try {
      insertEvent(fixture.raw, {
        id: 'usage-worker-1',
        sequence: 1,
        type: 'provider.usage',
        occurredAt: '2026-08-04T00:00:00.000Z',
        payload: {
          requestId: 'request-worker-1',
          modelId: 'model-worker-1',
          tokensIn: 5,
          tokensOut: 8,
          totalTokens: 13,
        },
      });

      const snapshot = await loadUsageSummarySnapshotInWorker({
        databasePath: fixture.databasePath,
        cachePath,
      });
      const persisted = JSON.parse(await readFile(cachePath, 'utf8')) as UsageSummaryCacheSnapshot;

      expect(snapshot.facts).toHaveLength(1);
      expect(persisted).toEqual(snapshot);
      expect(summarizeUsageSnapshot(snapshot).requests).toEqual([
        expect.objectContaining({
          requestId: 'request-worker-1',
          totalTokens: 13,
        }),
      ]);
    } finally {
      fixture.close();
    }
  });
});
