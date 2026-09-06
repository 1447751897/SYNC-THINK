import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqliteMessageStore,
  type EventDraft,
} from '@sync-think/storage';
import type { MessageId, RunId, TaskId, ThreadId } from '@sync-think/shared';
import { ConversationHistoryReadService } from './conversation-history-read-service.js';
import {
  ConversationHistoryWorker,
  readConversationHistorySnapshot,
} from './conversation-history-worker.js';
import { projectRunProcess } from './run-process-view.js';
import { Runtime } from './runtime.js';
import { decodeFrames, type Frame } from '@sync-think/protocol';

const directories: string[] = [];
const runId = 'history-run' as RunId;
const taskId = 'history-task' as TaskId;

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function event(
  id: string,
  type: string,
  payload: Record<string, unknown>,
  overrides: Partial<EventDraft> = {},
): EventDraft {
  return {
    id: id as EventDraft['id'],
    type,
    category: 'tool',
    workspaceId: 'workspace-a' as EventDraft['workspaceId'],
    runId,
    taskId,
    occurredAt: '2026-09-05T05:00:00.000Z',
    payload: { threadId: 'history-thread', ...payload },
    ...overrides,
  };
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-history-read-'));
  directories.push(directory);
  const databasePath = join(directory, 'test.db');
  await runMigrations(databasePath);
  const connection = await openDatabaseAsync({ path: databasePath });
  const store = new SqliteEventCheckpointStore(connection.raw);
  store.commitTransition({
    events: [
      event('start', 'run.started', {
        run: {
          providerModelId: 'original-model',
          modelId: 'routed-model',
          assistantTimeline: 'x'.repeat(2_000_000),
        },
      }),
      event('tool', 'tool.requested', {
        toolCall: {
          id: 'write-a',
          name: 'write_file',
          argumentsJson: JSON.stringify({ path: 'result.txt', content: '完整文件内容' }),
        },
      }),
      event('tool-done', 'tool.completed', {
        toolCallId: 'write-a',
        result: { ok: true },
        previousContent: '旧文件内容',
      }),
      event('plan', 'tool.requested', {
        toolCall: {
          id: 'plan-a',
          name: 'update_plan',
          argumentsJson: JSON.stringify({
            plan: [{ step: '恢复任务\n详细任务说明', status: 'in_progress' }],
          }),
        },
      }),
      event('usage', 'provider.usage', { requestId: 'request-a', tokensIn: 51, tokensOut: 13 }),
      event('done', 'run.completed', {}),
    ],
  });
  return { databasePath, connection, store };
}

describe('ConversationHistoryReadService', () => {
  it('reuses a versioned Worker snapshot across process pages and invalidates on new events', async () => {
    const { connection, store } = await fixture();
    try {
      const capture = vi.spyOn(store, 'captureRunProcessSnapshot');
      const request = {
        kind: 'run-process' as const,
        runId,
        page: { section: 'steps' as const, offset: 0, limit: 1 },
      };
      const first = readConversationHistorySnapshot(store, request);
      const next = readConversationHistorySnapshot(store, request);
      expect(capture).toHaveBeenCalledTimes(1);
      expect(next).toEqual(first);
      store.commitTransition({
        events: [
          event('new-tool', 'tool.requested', {
            toolCallId: 'new-call',
            toolName: 'run_command',
            arguments: { command: 'echo new' },
          }),
        ],
      });
      readConversationHistorySnapshot(store, request);
      expect(capture).toHaveBeenCalledTimes(2);
    } finally {
      connection.raw.close();
    }
  });

  it('bounds the Worker queue and cancels pending reads when closed', async () => {
    const { databasePath, connection } = await fixture();
    const worker = new ConversationHistoryWorker({ databasePath, maxPending: 1 });
    try {
      const pending = worker.read({ kind: 'run-process', runId });
      const cancelled = expect(pending).rejects.toThrow('history.closed');
      await expect(worker.read({ kind: 'task-plan', taskId })).rejects.toThrow('history.busy');
      await worker.close();
      await cancelled;
      await expect(worker.read({ kind: 'run-process', runId })).rejects.toThrow('history.closed');
    } finally {
      await worker.close();
      connection.raw.close();
    }
  });

  it('terminates a timed-out Worker and can start a fresh reader on the next request', async () => {
    const { databasePath, connection } = await fixture();
    const options = { databasePath, timeoutMs: 1 };
    const worker = new ConversationHistoryWorker(options);
    try {
      await expect(worker.read({ kind: 'run-process', runId })).rejects.toThrow('history.timeout');
      options.timeoutMs = 30_000;
      expect(await worker.read({ kind: 'run-process', runId })).toMatchObject({
        kind: 'run-process',
        runId,
      });
    } finally {
      await worker.close();
      connection.raw.close();
    }
  });

  it('reads navigation and anchor pages through the readonly Worker, not the Runtime connection', async () => {
    const { databasePath, connection, store } = await fixture();
    const messages = new SqliteMessageStore(connection.raw);
    const threadId = 'navigation-thread' as ThreadId;
    connection.raw
      .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run(threadId, 'navigation-task', '2026-09-05T00:00:00Z');
    for (let sequence = 0; sequence < 120; sequence += 1) {
      messages.append({
        id: `navigation-${sequence}` as MessageId,
        threadId,
        role: sequence % 2 ? 'assistant' : 'user',
        sequence,
        createdAt: '2026-09-05T00:00:00Z',
        blocks: [{ type: 'text', text: `message ${sequence}` }],
      });
    }
    const service = new ConversationHistoryReadService({
      databasePath,
      store,
      messageStore: messages,
    });
    const synchronousRead = vi.spyOn(messages, 'listNavigation').mockImplementation(() => {
      throw new Error('main-thread read');
    });
    const synchronousPage = vi.spyOn(messages, 'listMessages').mockImplementation(() => {
      throw new Error('main-thread page');
    });
    try {
      expect(
        (await service.listMessageNavigation(threadId, { limit: 5 })).entries.map(
          (entry) => entry.sequence,
        ),
      ).toEqual([115, 116, 117, 118, 119]);
      expect(
        (
          await service.listMessages(threadId, {
            aroundMessageId: 'navigation-20' as MessageId,
            limit: 3,
          })
        ).messages.map((entry) => entry.sequence),
      ).toEqual([19, 20, 21]);
      expect(synchronousRead).not.toHaveBeenCalled();
      expect(synchronousPage).not.toHaveBeenCalled();
    } finally {
      await service.close();
      connection.raw.close();
    }
  });

  it('returns a valid task snapshot even if its optional cache write fails, with one diagnostic', async () => {
    const { databasePath, connection, store } = await fixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(store, 'installTaskPlanSnapshot').mockImplementation(() => {
      throw new Error('cache write failed');
    });
    const service = new ConversationHistoryReadService({
      databasePath,
      store,
      loadSnapshot: async (request) => readConversationHistorySnapshot(store, request),
    });
    try {
      expect((await service.getTaskPlanState(taskId, 'history-thread')).items).toHaveLength(1);
      expect((await service.getTaskPlanState(taskId, 'history-thread')).items).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      await service.close();
      connection.raw.close();
    }
  });

  it('does not retain process values larger than the configured cache byte budget', async () => {
    const { databasePath, connection, store } = await fixture();
    const loadSnapshot = vi.fn(
      async (request: Parameters<typeof readConversationHistorySnapshot>[1]) =>
        readConversationHistorySnapshot(store, request),
    );
    const service = new ConversationHistoryReadService({
      databasePath,
      store,
      loadSnapshot,
      maxCacheBytes: 1,
    });
    try {
      await service.getRunProcess(runId);
      await service.getRunProcess(runId);
      expect(loadSnapshot).toHaveBeenCalledTimes(2);
    } finally {
      await service.close();
      connection.raw.close();
    }
  });

  it('keeps Runtime health dispatch responsive while a process query awaits the reader', async () => {
    const { connection, store } = await fixture();
    connection.raw
      .prepare(
        "UPDATE event SET payload_json = json_remove(payload_json, '$.run') WHERE id = 'start'",
      )
      .run();
    let finish!: (value: ReturnType<typeof projectRunProcess>) => void;
    const pending = new Promise<ReturnType<typeof projectRunProcess>>((resolve) => {
      finish = resolve;
    });
    const reader = {
      getRunProcess: vi.fn(() => pending),
      getTaskPlanState: vi.fn(),
      close: vi.fn(async () => {}),
    };
    const runtime = new Runtime({
      installId: 'history-health-dispatch',
      allowNoToken: true,
      stateStore: store,
      conversationHistory: reader,
    });
    const writes: Buffer[] = [];
    const dispatch = (frame: Frame) =>
      (
        runtime as unknown as {
          handlers: { onFrame(socket: { write(data: Buffer): boolean }, frame: Frame): void };
        }
      ).handlers.onFrame(
        {
          write: (data) => {
            writes.push(data);
            return true;
          },
        },
        frame,
      );
    try {
      dispatch({
        id: 'process',
        kind: 'request',
        type: 'conversation.getRunProcess',
        payload: { runId },
      });
      expect(reader.getRunProcess).toHaveBeenCalledWith(runId, undefined, undefined);
      expect(writes).toHaveLength(0);
      dispatch({ id: 'health', kind: 'request', type: 'runtime.healthcheck', payload: {} });
      expect(decodeFrames(Buffer.concat(writes)).frames).toEqual([
        expect.objectContaining({ id: 'health', type: 'runtime.healthcheck' }),
      ]);
      finish(projectRunProcess(runId, store.listRunProcessEvents(runId)));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(decodeFrames(Buffer.concat(writes)).frames[1]).toMatchObject({
        id: 'process',
        type: 'conversation.getRunProcess',
      });
    } finally {
      finish(projectRunProcess(runId, []));
      await runtime.stop();
      connection.raw.close();
    }
  });

  it('restores cold tasks in a readonly Worker and reuses the durable snapshot on the main connection', async () => {
    const { databasePath, connection, store } = await fixture();
    const service = new ConversationHistoryReadService({ databasePath, store });
    try {
      const history = vi.spyOn(store, 'listTaskPlanEvents').mockImplementation(() => {
        throw new Error('main-thread historical read');
      });
      const state = await service.getTaskPlanState(taskId, 'history-thread');
      expect(state.items?.[0]?.description).toBe('详细任务说明');
      expect(store.getCachedTaskPlanState(taskId, 'history-thread')).toEqual(state);
      expect(await service.getTaskPlanState(taskId, 'history-thread')).toEqual(state);
      expect(history).not.toHaveBeenCalled();
      expect(connection.raw.prepare('SELECT COUNT(*) AS count FROM event').get()).toEqual({
        count: 6,
      });
    } finally {
      await service.close();
      connection.raw.close();
    }
  });

  it('projects the same steps, full file changes and token statistics without loading run snapshots', async () => {
    const { databasePath, connection, store } = await fixture();
    const expected = projectRunProcess(runId, store.listEventsByRun(runId));
    expect(JSON.stringify(store.listRunProcessEvents(runId)).length).toBeLessThan(5000);
    const service = new ConversationHistoryReadService({ databasePath, store });
    try {
      const history = vi.spyOn(store, 'listEventsByRun').mockImplementation(() => {
        throw new Error('main-thread historical read');
      });
      expect(await service.getRunProcess(runId)).toEqual(expected);
      expect(await service.getRunProcess(runId)).toEqual(expected);
      expect(history).not.toHaveBeenCalled();
    } finally {
      await service.close();
      connection.raw.close();
    }
  });

  it('deduplicates identical requests, invalidates by event cursor and bounds cached runs', async () => {
    const { databasePath, connection, store } = await fixture();
    const load = vi.fn(async (request: Parameters<typeof readConversationHistorySnapshot>[1]) =>
      readConversationHistorySnapshot(store, request),
    );
    const service = new ConversationHistoryReadService({
      databasePath,
      store,
      loadSnapshot: load,
      maxCachedRuns: 1,
    });
    try {
      const [first, second] = await Promise.all([
        service.getRunProcess(runId),
        service.getRunProcess(runId),
      ]);
      expect(second).toEqual(first);
      expect(load).toHaveBeenCalledTimes(1);
      await service.getRunProcess(runId);
      expect(load).toHaveBeenCalledTimes(1);
      store.commitTransition({
        events: [
          event('late-usage', 'provider.usage', { requestId: 'late', tokensIn: 7, tokensOut: 9 }),
        ],
      });
      expect(await service.getRunProcess(runId)).toEqual(
        projectRunProcess(runId, store.listEventsByRun(runId)),
      );
      expect(load).toHaveBeenCalledTimes(2);
      const otherRun = 'other-run' as RunId;
      store.commitTransition({
        events: [event('other-start', 'run.started', {}, { runId: otherRun })],
      });
      await service.getRunProcess(otherRun);
      await service.getRunProcess(runId);
      expect(load).toHaveBeenCalledTimes(4);
    } finally {
      await service.close();
      connection.raw.close();
    }
  });

  it('leaves the event loop responsive while a history request is pending and rejects after close', async () => {
    const { databasePath, connection, store } = await fixture();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new ConversationHistoryReadService({
      databasePath,
      store,
      loadSnapshot: async (request) => {
        await waiting;
        return readConversationHistorySnapshot(store, request);
      },
    });
    try {
      const request = service.getRunProcess(runId);
      await new Promise<void>((resolve) => setImmediate(resolve));
      release();
      expect(await request).toMatchObject({ runId });
      await service.close();
      await expect(service.getRunProcess(runId)).rejects.toThrow('closed');
    } finally {
      release();
      await service.close();
      connection.raw.close();
    }
  });
});
