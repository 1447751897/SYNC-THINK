import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqliteMessageStore,
} from '@sync-think/storage';
import type {
  KernelAdapter,
  KernelEvent,
  KernelPermissionDecision,
  KernelPermissionRequest,
  KernelRequest,
  KernelUsage,
  Message,
  RunId,
  WorkspaceId,
} from '@sync-think/shared';
import { createDemoRun, type DemoRunState } from '../src/demo-run.js';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class FixtureKernelAdapter implements KernelAdapter {
  readonly id = 'fixture-kernel';
  readonly name = 'Fixture Kernel';
  readonly icon = 'fixture';
  readonly knownGoodVersions = ['1.0.0'];
  readonly capabilities = {
    protocols: ['openai-responses' as const],
    permission: 'own' as const,
    permissionBridge: false,
    pause: 'session' as const,
    compress: 'own' as const,
    usageReport: true,
  };

  constructor(private readonly events: readonly KernelEvent[]) {}

  async detectVersion(): Promise<string | null> {
    return '1.0.0';
  }

  async *start(_request: KernelRequest): AsyncIterable<KernelEvent> {
    yield* this.events;
  }

  async stop(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async cancel(): Promise<void> {}
  onExit(_callback: (code: number | null, stderrTail: string) => void): void {}
  onPermissionRequest(_callback: (request: KernelPermissionRequest) => void): void {}
  respondPermission(_requestId: string, _decision: KernelPermissionDecision): void {}
  onUsage(_callback: (usage: KernelUsage) => void): void {}
}

interface RuntimeExternalKernelHarness {
  demoRuns: Map<string, DemoRunState>;
  executeExternalKernelRun(runId: RunId): Promise<void>;
}

async function createFixture(events: readonly KernelEvent[]) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-external-kernel-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  connection.raw
    .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
    .run(threadId, `task-${threadId}`, '2026-08-14T00:00:00.000Z');
  const stateStore = new SqliteEventCheckpointStore(connection.raw);
  const messageStore = new SqliteMessageStore(connection.raw);
  const adapter = new FixtureKernelAdapter(events);
  const runtime = new Runtime({
    installId: `external-kernel-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    allowNoToken: true,
    stateStore,
    messageStore,
    workspaceId: 'workspace-external-kernel' as WorkspaceId,
    kernelAdapterResolver: () => adapter,
  });
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2)}` as RunId;
  const run = createDemoRun(runId, threadId, 'fixture prompt', {
    kernelId: adapter.id,
    modelId: 'fixture-model',
    providerModelId: 'fixture-model',
    useFakeProvider: false,
  });
  const harness = runtime as unknown as RuntimeExternalKernelHarness;
  harness.demoRuns.set(runId, run);
  return { adapter, connection, harness, messageStore, runId, stateStore, threadId };
}

function assistantMessage(messages: Message[]): Message | undefined {
  return messages.find((message) => message.role === 'assistant');
}

describe('Runtime external kernel finalization', () => {
  it('persists the latest streamed text in the terminal event and final message', async () => {
    const fixture = await createFixture([
      { type: 'delta', text: 'hello ' },
      { type: 'delta', text: 'kernel' },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);

      const terminal = fixture.stateStore
        .listEventsByRun(fixture.runId)
        .find((event) => event.type === 'run.completed');
      expect(terminal?.payload).toMatchObject({ assistantText: 'hello kernel' });
      const assistant = assistantMessage(
        fixture.messageStore.listMessages(fixture.threadId as never).messages,
      );
      expect(assistant?.blocks).toEqual([{ type: 'text', text: 'hello kernel' }]);
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('fails an EOF without terminal while retaining partial streamed text', async () => {
    const fixture = await createFixture([{ type: 'delta', text: 'partial kernel output' }]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);

      const terminal = fixture.stateStore
        .listEventsByRun(fixture.runId)
        .find((event) => event.type === 'run.failed');
      expect(terminal?.payload).toMatchObject({
        assistantText: 'partial kernel output',
        errorMessage: 'kernel process ended before a terminal event',
      });
      const assistant = assistantMessage(
        fixture.messageStore.listMessages(fixture.threadId as never).messages,
      );
      expect(assistant?.blocks[0]).toEqual({ type: 'text', text: 'partial kernel output' });
      expect(assistant?.blocks[1]).toEqual(
        expect.objectContaining({
          type: 'error',
          payload: expect.objectContaining({ terminalState: 'failed' }),
        }),
      );
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('projects kernel reasoning, compaction and usage without polluting chat text', async () => {
    const fixture = await createFixture([
      { type: 'reasoning', text: 'internal plan' },
      { type: 'delta', text: 'visible answer' },
      { type: 'compacted' },
      {
        type: 'usage',
        usage: { real: 150, window: 200_000, input: 100, output: 50, cached: 40 },
      },
      {
        type: 'usage',
        usage: { real: 150, window: 200_000, input: 100, output: 50, cached: 40 },
      },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);
      const events = fixture.stateStore.listEventsByRun(fixture.runId);

      // Reasoning is diagnostic-only: it must never become durable chat text.
      const assistant = assistantMessage(
        fixture.messageStore.listMessages(fixture.threadId as never).messages,
      );
      expect(assistant?.blocks).toEqual([{ type: 'text', text: 'visible answer' }]);

      // The kernel compacted its own context; the host records a kernel-scoped
      // boundary and never the native context.compacted truncation marker.
      expect(events.some((event) => event.type === 'kernel.context_compacted')).toBe(true);
      expect(events.some((event) => event.type === 'context.compacted')).toBe(false);

      // Two identical usage reports stay two distinct requests (no value-derived
      // ids collapsing progressive updates).
      const usageRequestIds = events
        .filter((event) => event.type === 'provider.usage')
        .map((event) => event.payload.requestId);
      expect(usageRequestIds).toHaveLength(2);
      expect(new Set(usageRequestIds).size).toBe(2);
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('keeps partial tool calls and failed tool results distinguishable', async () => {
    const fixture = await createFixture([
      {
        type: 'tool-call',
        toolId: 'tool-1',
        name: 'Read',
        argsJson: '{"path":"a"}',
        partial: true,
      },
      { type: 'tool-result', toolId: 'tool-1', output: 'boom', isError: true },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);
      const events = fixture.stateStore.listEventsByRun(fixture.runId);

      const requested = events.find((event) => event.type === 'tool.requested');
      expect(requested?.payload).toMatchObject({ partial: true });
      const completed = events.find((event) => event.type === 'tool.completed');
      expect(completed?.payload).toMatchObject({ result: 'boom', failed: true });
    } finally {
      fixture.connection.raw.close();
    }
  });
});
