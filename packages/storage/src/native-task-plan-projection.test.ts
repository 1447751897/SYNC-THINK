import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventId, RunId, TaskId, WorkspaceId } from '@sync-think/shared';
import { openDatabaseAsync } from './connection.js';
import { SqliteEventCheckpointStore } from './runtime-state-store.js';
import { runMigrations } from './scripts/migrate.js';

const directories: string[] = [];
const taskId = 'native-task-a' as TaskId;
const threadId = 'native-thread-a';

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function planEvent(id: string, status = 'in_progress') {
  return {
    id: id as EventId,
    workspaceId: 'workspace-a' as WorkspaceId,
    taskId,
    runId: 'run-a' as RunId,
    category: 'tool' as const,
    type: 'tool.requested',
    occurredAt: '2026-09-05T00:00:00.000Z',
    payload: {
      threadId,
      toolCall: {
        id,
        name: 'update_plan',
        argumentsJson: JSON.stringify({ plan: [{ step: '读取原生任务\n保持详细说明', status }] }),
      },
    },
  };
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-native-plan-'));
  directories.push(directory);
  const path = join(directory, 'state.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  const store = new SqliteEventCheckpointStore(connection.raw);
  store.commitTransition({ events: [planEvent('plan-a')] });
  return { path, connection, store };
}

describe('durable native task plan projection', () => {
  it('correlates unnamed native task results without reading unrelated tool results', async () => {
    const { connection, store } = await fixture();
    try {
      store.commitTransition({
        events: [
          {
            ...planEvent('create-request'),
            payload: {
              threadId,
              toolCall: {
                id: 'create-a',
                name: 'TaskCreate',
                argumentsJson: JSON.stringify({ subject: '具体任务', description: '具体说明' }),
              },
            },
          },
          {
            ...planEvent('unrelated-request'),
            payload: {
              threadId,
              toolCall: { id: 'read-a', name: 'read_file', argumentsJson: '{}' },
            },
          },
          {
            ...planEvent('unrelated-result'),
            type: 'tool.completed',
            payload: { threadId, toolCallId: 'read-a', result: 'x'.repeat(2_000_000) },
          },
          {
            ...planEvent('create-result'),
            type: 'tool.completed',
            payload: {
              threadId,
              toolCallId: 'create-a',
              result: {
                task: {
                  id: 'native-7',
                  subject: '具体任务',
                  description: '具体说明',
                  status: 'pending',
                },
              },
            },
          },
        ],
      });
      const selected = store.listTaskPlanEvents(taskId);
      expect(selected.map((entry) => entry.id)).toEqual([
        'plan-a',
        'create-request',
        'create-result',
      ]);
      expect(store.getTaskPlanState(taskId, threadId).items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'native-7', title: '具体任务', description: '具体说明' }),
        ]),
      );
    } finally {
      connection.raw.close();
    }
  });

  it('captures cold history without holding the writer lock and rejects a stale install', async () => {
    const { path, connection, store } = await fixture();
    const writer = await openDatabaseAsync({ path });
    try {
      writer.raw.pragma('busy_timeout = 0');
      const writerStore = new SqliteEventCheckpointStore(writer.raw);
      const load = store.listTaskPlanEvents.bind(store);
      vi.spyOn(store, 'listTaskPlanEvents').mockImplementationOnce((id) => {
        writerStore.commitTransition({ events: [planEvent('concurrent-plan', 'completed')] });
        return load(id);
      });
      const snapshot = store.captureTaskPlanSnapshot(taskId, threadId);
      expect(snapshot.state.items?.[0]?.status).toBe('in_progress');
      expect(store.installTaskPlanSnapshot(snapshot)).toBe(false);
      expect(store.getCachedTaskPlanState(taskId, threadId)).toBeUndefined();
      expect(store.getTaskPlanState(taskId, threadId).items?.[0]?.status).toBe('completed');
    } finally {
      writer.raw.close();
      connection.raw.close();
    }
  });

  it('installs a readonly worker snapshot only while its source cursor is current', async () => {
    const { path, connection, store } = await fixture();
    const reader = await openDatabaseAsync({ path, readonly: true });
    try {
      const readerStore = new SqliteEventCheckpointStore(reader.raw);
      const snapshot = readerStore.captureTaskPlanSnapshot(taskId, threadId);
      expect(store.getCachedTaskPlanState(taskId, threadId)).toBeUndefined();
      expect(store.installTaskPlanSnapshot(snapshot)).toBe(true);
      expect(store.getCachedTaskPlanState(taskId, threadId)).toEqual(snapshot.state);
      expect(readerStore.installTaskPlanSnapshot(snapshot)).toBe(false);
    } finally {
      reader.raw.close();
      connection.raw.close();
    }
  });

  it('drops unrelated run snapshots from task projection payloads', async () => {
    const { connection, store } = await fixture();
    try {
      const event = planEvent('large-snapshot');
      store.commitTransition({
        events: [
          {
            ...event,
            payload: {
              ...event.payload,
              run: { assistantTimeline: 'x'.repeat(2_000_000) },
            },
          },
        ],
      });
      const events = store.listTaskPlanEvents(taskId);
      expect(JSON.stringify(events).length).toBeLessThan(3000);
      expect(store.getTaskPlanState(taskId, threadId).items?.[0]?.description).toBe('保持详细说明');
    } finally {
      connection.raw.close();
    }
  });

  it('supports a read-only inspection without creating a snapshot', async () => {
    const { path, connection } = await fixture();
    connection.raw.close();
    const inspected = await openDatabaseAsync({ path, readonly: true });
    try {
      const store = new SqliteEventCheckpointStore(inspected.raw);
      expect(store.getTaskPlanState(taskId, threadId).items).toHaveLength(1);
      expect(
        inspected.raw.prepare('SELECT COUNT(*) AS count FROM native_task_plan_projection').get(),
      ).toEqual({ count: 0 });
    } finally {
      inspected.raw.close();
    }
  });

  it('persists a derived snapshot across reopen without reading historical payloads again', async () => {
    const { path, connection, store } = await fixture();
    const state = (() => {
      try {
        return store.getTaskPlanState(taskId, threadId);
      } finally {
        connection.raw.close();
      }
    })();
    expect(state.items).toEqual([
      { title: '读取原生任务', description: '保持详细说明', status: 'in_progress' },
    ]);
    const reopened = await openDatabaseAsync({ path });
    try {
      const second = new SqliteEventCheckpointStore(reopened.raw);
      const history = vi.spyOn(second, 'listTaskPlanEvents').mockImplementation(() => {
        throw new Error('historical payload read');
      });
      expect(second.getTaskPlanState(taskId, threadId)).toEqual(state);
      expect(history).not.toHaveBeenCalled();
    } finally {
      reopened.raw.close();
    }
  });

  it('updates an existing snapshot atomically from new native events', async () => {
    const { connection, store } = await fixture();
    try {
      store.getTaskPlanState(taskId, threadId);
      const history = vi.spyOn(store, 'listTaskPlanEvents').mockImplementation(() => {
        throw new Error('historical payload read');
      });
      store.commitTransition({ events: [planEvent('plan-b', 'completed')] });
      expect(store.getTaskPlanState(taskId, threadId).items?.[0]?.status).toBe('completed');
      expect(history).not.toHaveBeenCalled();
    } finally {
      connection.raw.close();
    }
  });

  it('rolls back snapshot changes together with a failed checkpoint', async () => {
    const { connection, store } = await fixture();
    try {
      const before = store.getTaskPlanState(taskId, threadId);
      const checkpoint = {
        id: 'checkpoint-a',
        runId: 'run-a' as RunId,
        state: {},
        createdAt: '2026-09-05',
      };
      store.commitTransition({
        events: [{ ...planEvent('usage-a'), type: 'provider.usage', payload: { threadId } }],
        checkpoint,
      });
      expect(() =>
        store.commitTransition({ events: [planEvent('plan-b', 'completed')], checkpoint }),
      ).toThrow();
      expect(store.getTaskPlanState(taskId, threadId).items).toEqual(before.items);
    } finally {
      connection.raw.close();
    }
  });

  it('does not reuse a snapshot for a different conversation thread', async () => {
    const { connection, store } = await fixture();
    try {
      store.getTaskPlanState(taskId, threadId);
      expect(store.getTaskPlanState(taskId, 'different-thread').items).toBeNull();
      expect(store.getTaskPlanState(taskId, threadId).items).toHaveLength(1);
    } finally {
      connection.raw.close();
    }
  });
});
