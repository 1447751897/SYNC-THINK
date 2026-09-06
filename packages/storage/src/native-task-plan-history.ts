import { createHash } from 'node:crypto';
import {
  projectTaskPlanHistory,
  type Event,
  type TaskPlanHistoryOptions,
  type TaskPlanHistorySnapshot,
  type TaskId,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';
import type { ContentReadScope } from './conversation-content-store.js';

export interface PreparedTaskPlanHistory {
  snapshot: TaskPlanHistorySnapshot;
  version: string;
}

export class SqliteNativeTaskPlanHistory {
  private readonly entries = new Map<
    string,
    { revision: string; value: PreparedTaskPlanHistory; bytes: number }
  >();
  private bytes = 0;

  constructor(
    private readonly raw: BetterSQLite3Raw,
    private readonly loadEvents: (taskId: TaskId) => Event[],
    private readonly maxBytes = 16 * 1024 * 1024,
    private readonly maxEntries = 4,
  ) {}

  private revision(): string {
    const changes = this.raw.prepare('SELECT total_changes() AS changes').get() as {
      changes: number;
    };
    return (
      String(this.raw.pragma('data_version', { simple: true })) +
      ':' +
      changes.changes +
      ':' +
      String(this.raw.pragma('schema_version', { simple: true }))
    );
  }

  read(scope: ContentReadScope, options: TaskPlanHistoryOptions = {}): PreparedTaskPlanHistory {
    const outerTransaction = this.raw.inTransaction;
    const revision = this.revision();
    const key = JSON.stringify([
      scope.workspaceId,
      scope.taskId,
      scope.threadId,
      options.beforeSequence,
      options.beforeRunId,
      options.runId,
    ]);
    const cached = outerTransaction ? undefined : this.entries.get(key);
    const value = this.raw
      .transaction(() => {
        const exists = this.raw
          .prepare(
            'SELECT 1 FROM thread JOIN task ON task.id = thread.task_id WHERE thread.id = ? AND task.id = ? AND task.workspace_id = ?',
          )
          .get(scope.threadId, scope.taskId, scope.workspaceId);
        if (!exists) throw new Error('content.not-found');
        if (cached?.revision === revision && this.revision() === revision) return cached.value;
        const snapshot = projectTaskPlanHistory(
          this.loadEvents(scope.taskId),
          { taskId: scope.taskId, threadId: scope.threadId },
          options,
        );
        if (options.runId && !snapshot.selected) throw new Error('history.plan-not-found');
        const serialized = JSON.stringify(snapshot.selected ?? null);
        return { snapshot, version: createHash('sha256').update(serialized).digest('hex') };
      })
      .deferred();
    if (!outerTransaction && this.revision() === revision) {
      const previous = this.entries.get(key);
      if (previous) {
        this.entries.delete(key);
        this.bytes -= previous.bytes;
      }
      const bytes =
        previous?.value === value ? previous.bytes : Buffer.byteLength(JSON.stringify(value));
      if (bytes <= this.maxBytes && this.maxEntries > 0) {
        this.entries.set(key, { revision, value, bytes });
        this.bytes += bytes;
      }
      while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value!;
        this.bytes -= this.entries.get(oldest)!.bytes;
        this.entries.delete(oldest);
      }
    }
    return value;
  }
}
