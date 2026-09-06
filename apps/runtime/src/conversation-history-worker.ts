import { paginateTaskPlanHistory } from './task-plan-history-page.js';
import type { TaskPlanHistoryPage, TaskPlanHistoryReadOptions } from '@sync-think/protocol';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import {
  openDatabaseAsync,
  EventPayloadSidecarStore,
  SqliteEventCheckpointStore,
  SqliteMessageStore,
  SqliteConversationContentStore,
  type ContentReadOptions,
  type ContentReadScope,
  type ListMessageNavigationOptions,
  type ListMessagesOptions,
  type MessageNavigationPage,
  type MessagePage,
  type EventCursor,
  type TaskPlanSnapshot,
} from '@sync-think/storage';
import type { RunProcessView, RunProcessPageRequest } from '@sync-think/protocol';
import type {
  ContentChunk,
  RunId,
  TaskId,
  ThreadId,
  FileDiffPage,
  FileDiffReadOptions,
} from '@sync-think/shared';
import { readConversationFileChanges } from './conversation-file-changes.js';
import type {
  ConversationFileChangesOptions,
  ConversationFileChangesPage,
} from '@sync-think/protocol';
import { projectRunProcessSnapshot } from './run-process-view.js';
import { paginateRunProcess } from './run-process-page.js';
import { RunProcessSnapshotCache } from './run-process-snapshot-cache.js';
import { projectMessageContent } from './deferred-content-projection.js';

export type ConversationHistoryRequest =
  | { kind: 'task-plan-history'; scope: ContentReadScope; options: TaskPlanHistoryReadOptions }
  | { kind: 'file-directory'; scope: ContentReadScope; options: ConversationFileChangesOptions }
  | { kind: 'file-diff'; scope: ContentReadScope; options: FileDiffReadOptions }
  | { kind: 'content'; scope: ContentReadScope; options: ContentReadOptions }
  | { kind: 'task-plan'; taskId: TaskId; threadId?: string }
  | { kind: 'run-process'; runId: RunId; page?: RunProcessPageRequest; scope?: ContentReadScope }
  | { kind: 'message-navigation'; threadId: ThreadId; options: ListMessageNavigationOptions }
  | { kind: 'message-page'; threadId: ThreadId; options: ListMessagesOptions };

export type ConversationHistorySnapshot =
  | { kind: 'task-plan-history'; scope: ContentReadScope; page: TaskPlanHistoryPage }
  | { kind: 'file-directory'; page: ConversationFileChangesPage }
  | { kind: 'file-diff'; diff: FileDiffPage }
  | { kind: 'content'; content: ContentChunk }
  | { kind: 'task-plan'; snapshot: TaskPlanSnapshot }
  | { kind: 'run-process'; runId: RunId; cursor: EventCursor; process: RunProcessView }
  | { kind: 'message-navigation'; threadId: ThreadId; page: MessageNavigationPage }
  | { kind: 'message-page'; threadId: ThreadId; page: MessagePage };

interface HistoryWorkerOptions {
  databasePath: string;
  sidecarRoot?: string;
  timeoutMs?: number;
  idleMs?: number;
  maxPending?: number;
}

interface PendingHistoryRead {
  resolve(value: ConversationHistorySnapshot): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface HistoryWorkerMessage {
  id?: number;
  snapshot?: ConversationHistorySnapshot;
  error?: string;
}

const processSnapshots = new WeakMap<SqliteEventCheckpointStore, RunProcessSnapshotCache>();

export function readConversationHistorySnapshot(
  store: SqliteEventCheckpointStore,
  request: ConversationHistoryRequest,
  messages?: SqliteMessageStore,
  content?: SqliteConversationContentStore,
): ConversationHistorySnapshot {
  if (request.kind === 'file-directory') {
    if (!content) throw new Error('history.content-store-unavailable');
    return {
      kind: 'file-directory',
      page: readConversationFileChanges(store, content, request.scope, request.options),
    };
  }
  if (request.kind === 'file-diff') {
    if (!content) throw new Error('history.content-store-unavailable');
    return { kind: 'file-diff', diff: content.readDiff(request.scope, request.options) };
  }
  if (request.kind === 'content') {
    if (!content) throw new Error('history.content-store-unavailable');
    return { kind: 'content', content: content.read(request.scope, request.options) };
  }
  if (request.kind === 'message-navigation' || request.kind === 'message-page') {
    if (!messages) throw new Error('history.message-store-unavailable');
    if (request.kind === 'message-page') {
      const page = messages.listMessages(request.threadId, request.options);
      return {
        kind: request.kind,
        threadId: request.threadId,
        page: {
          ...page,
          messages: page.messages.map((message) =>
            projectMessageContent(content?.recoverLegacyMessage(message) ?? message),
          ),
        },
      };
    }
    return {
      kind: request.kind,
      threadId: request.threadId,
      page: messages.listNavigation(request.threadId, request.options),
    };
  }
  if (request.kind === 'task-plan-history') {
    const prepared = store.getTaskPlanHistory(request.scope, {
      runId: request.options.runId,
      beforeSequence: request.options.beforeSequence,
      beforeRunId: request.options.beforeRunId,
    });
    return {
      kind: request.kind,
      scope: request.scope,
      page: paginateTaskPlanHistory(prepared, request.options),
    };
  }
  if (request.kind === 'task-plan') {
    return {
      kind: 'task-plan',
      snapshot: store.captureTaskPlanSnapshot(request.taskId, request.threadId),
    };
  }
  if (request.scope) {
    if (!content) throw new Error('history.content-store-unavailable');
    content.assertRunScope(request.scope, request.runId);
  }
  let cache = processSnapshots.get(store);
  if (!cache) {
    cache = new RunProcessSnapshotCache();
    processSnapshots.set(store, cache);
  }
  const cursor = store.getRunEventCursor(request.runId);
  let snapshot = cache.get(request.runId, cursor);
  if (!snapshot) {
    snapshot = store.captureRunProcessSnapshot(request.runId, (events) =>
      projectRunProcessSnapshot(request.runId, events),
    );
    cache.set(request.runId, snapshot);
  }
  return {
    kind: 'run-process',
    runId: request.runId,
    cursor: snapshot.cursor,
    process: paginateRunProcess(snapshot.process, request.page),
  };
}

export class ConversationHistoryWorker {
  private worker?: Worker;
  private nextId = 0;
  private closed = false;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private stopping: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<number, PendingHistoryRead>();

  constructor(private readonly options: HistoryWorkerOptions) {}

  async read(request: ConversationHistoryRequest): Promise<ConversationHistorySnapshot> {
    await this.stopping;
    if (this.closed) throw new Error('history.closed');
    if (this.pending.size >= (this.options.maxPending ?? 32)) throw new Error('history.busy');
    clearTimeout(this.idleTimer);
    const worker = this.worker ?? this.start();
    worker.ref();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.dispose(new Error('history.timeout'), worker),
        this.options.timeoutMs ?? 30_000,
      );
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, request });
    });
  }

  private start(): Worker {
    const moduleUrl = new URL(import.meta.url);
    const tsxApi = moduleUrl.pathname.endsWith('.ts')
      ? pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm/api')).href
      : undefined;
    const url = tsxApi
      ? new URL(
          `data:text/javascript,${encodeURIComponent(
            `import api from ${JSON.stringify(tsxApi)}; await api.tsImport(${JSON.stringify(moduleUrl.href)}, import.meta.url);`,
          )}`,
        )
      : moduleUrl;
    const worker = new Worker(url, {
      workerData: {
        kind: 'conversation-history',
        databasePath: this.options.databasePath,
        sidecarRoot: this.options.sidecarRoot,
      },
    });
    this.worker = worker;
    worker.on('message', (message: HistoryWorkerMessage) => {
      if (this.worker !== worker) return;
      if (message.id === undefined) {
        this.dispose(new Error(message.error ?? 'history.worker-failed'), worker);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.snapshot) pending.resolve(message.snapshot);
      else pending.reject(new Error(message.error ?? 'history.read-failed'));
      if (this.pending.size === 0) {
        worker.unref();
        this.idleTimer = setTimeout(
          () => this.dispose(new Error('history.idle'), worker),
          this.options.idleMs ?? 30_000,
        );
        this.idleTimer.unref();
      }
    });
    worker.once('error', (error) => this.dispose(error, worker));
    worker.once('exit', (code) => this.dispose(new Error(`history.worker-exit:${code}`), worker));
    return worker;
  }

  private dispose(error: Error, worker: Worker | undefined = this.worker): void {
    if (!worker || this.worker !== worker) return;
    this.worker = undefined;
    clearTimeout(this.idleTimer);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.stopping = worker.terminate();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.dispose(new Error('history.closed'));
    await this.stopping;
  }
}

if (!isMainThread && workerData?.kind === 'conversation-history') {
  void openDatabaseAsync({ path: workerData.databasePath, readonly: true, fileMustExist: true })
    .then((connection) => {
      const messages = new SqliteMessageStore(connection.raw);
      const content = new SqliteConversationContentStore(
        connection.raw,
        workerData.sidecarRoot ? new EventPayloadSidecarStore(workerData.sidecarRoot) : undefined,
      );
      const store = new SqliteEventCheckpointStore(
        connection.raw,
        workerData.sidecarRoot
          ? { sidecar: new EventPayloadSidecarStore(workerData.sidecarRoot) }
          : undefined,
      );
      parentPort?.on(
        'message',
        ({ id, request }: { id: number; request: ConversationHistoryRequest }) => {
          try {
            parentPort?.postMessage({
              id,
              snapshot: readConversationHistorySnapshot(store, request, messages, content),
            } satisfies HistoryWorkerMessage);
          } catch (error) {
            parentPort?.postMessage({
              id,
              error: error instanceof Error ? error.message : String(error),
            } satisfies HistoryWorkerMessage);
          }
        },
      );
      parentPort?.once('close', () => {
        if (connection.raw.open) connection.raw.close();
      });
    })
    .catch((error) =>
      parentPort?.postMessage({
        error: error instanceof Error ? error.message : String(error),
      } satisfies HistoryWorkerMessage),
    );
}
