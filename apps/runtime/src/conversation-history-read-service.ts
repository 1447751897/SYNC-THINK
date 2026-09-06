import type {
  TaskPlanHistoryPage,
  TaskPlanHistoryReadOptions,
  ConversationFileChangesOptions,
  ConversationFileChangesPage,
  RunProcessView,
  RunProcessPageRequest,
} from '@sync-think/protocol';
import type { ContentChunk, RunId, TaskId, TaskPlanState, ThreadId } from '@sync-think/shared';
import type { FileDiffPage, FileDiffReadOptions } from '@sync-think/shared';
import type {
  EventCursor,
  SqliteEventCheckpointStore,
  SqliteMessageStore,
  ListMessagesOptions,
  ListMessageNavigationOptions,
  MessagePage,
  MessageNavigationPage,
  SqliteConversationContentStore,
  ContentReadOptions,
  ContentReadScope,
} from '@sync-think/storage';
import {
  ConversationHistoryWorker,
  readConversationHistorySnapshot,
  type ConversationHistoryRequest,
  type ConversationHistorySnapshot,
} from './conversation-history-worker.js';

export interface ConversationHistoryReader {
  readTaskPlanHistory?(
    scope: ContentReadScope,
    options: TaskPlanHistoryReadOptions,
  ): Promise<TaskPlanHistoryPage>;
  listFileChanges?(
    scope: ContentReadScope,
    options: ConversationFileChangesOptions,
  ): Promise<ConversationFileChangesPage>;
  readFileDiff?(scope: ContentReadScope, options: FileDiffReadOptions): Promise<FileDiffPage>;
  readContent?(scope: ContentReadScope, options: ContentReadOptions): Promise<ContentChunk>;
  listMessages?(threadId: ThreadId, options: ListMessagesOptions): Promise<MessagePage>;
  listMessageNavigation?(
    threadId: ThreadId,
    options: ListMessageNavigationOptions,
  ): Promise<MessageNavigationPage>;
  getTaskPlanState(taskId: TaskId, threadId?: string): Promise<TaskPlanState>;
  getRunProcess(
    runId: RunId,
    page?: RunProcessPageRequest,
    scope?: ContentReadScope,
  ): Promise<RunProcessView>;
  close(): Promise<void>;
}

interface HistoryReadServiceOptions {
  store: SqliteEventCheckpointStore;
  messageStore?: SqliteMessageStore;
  contentStore?: SqliteConversationContentStore;
  databasePath: string;
  sidecarRoot?: string;
  maxCachedRuns?: number;
  maxCacheBytes?: number;
  maxPending?: number;
  loadSnapshot?: (request: ConversationHistoryRequest) => Promise<ConversationHistorySnapshot>;
}

interface CachedRunProcess {
  cursor: EventCursor;
  process: RunProcessView;
  bytes: number;
}

function sameCursor(left: EventCursor, right: EventCursor): boolean {
  return left.sequence === right.sequence && left.eventId === right.eventId;
}

export class ConversationHistoryReadService implements ConversationHistoryReader {
  private readonly worker: ConversationHistoryWorker;
  private readonly loadSnapshot: NonNullable<HistoryReadServiceOptions['loadSnapshot']>;
  private readonly pending = new Map<string, Promise<ConversationHistorySnapshot>>();
  private readonly runs = new Map<RunId, CachedRunProcess>();
  private cacheBytes = 0;
  private closed = false;
  private lastCacheDiagnosticAt = -Infinity;

  constructor(private readonly options: HistoryReadServiceOptions) {
    this.worker = new ConversationHistoryWorker(options);
    this.loadSnapshot =
      options.loadSnapshot ??
      (options.databasePath === ':memory:'
        ? async (request) =>
            readConversationHistorySnapshot(
              options.store,
              request,
              options.messageStore,
              options.contentStore,
            )
        : (request) => this.worker.read(request));
  }

  async listMessages(threadId: ThreadId, options: ListMessagesOptions): Promise<MessagePage> {
    this.ensureOpen();
    const result = await this.read(JSON.stringify(['message-page', threadId, options]), {
      kind: 'message-page',
      threadId,
      options,
    });
    this.ensureOpen();
    if (result.kind !== 'message-page' || result.threadId !== threadId)
      throw new Error('history.unexpected-result');
    return result.page;
  }

  async readContent(scope: ContentReadScope, options: ContentReadOptions): Promise<ContentChunk> {
    this.ensureOpen();
    const result = await this.read(JSON.stringify(['content', scope, options]), {
      kind: 'content',
      scope,
      options,
    });
    this.ensureOpen();
    if (result.kind !== 'content') throw new Error('history.unexpected-result');
    return result.content;
  }

  async listFileChanges(
    scope: ContentReadScope,
    options: ConversationFileChangesOptions,
  ): Promise<ConversationFileChangesPage> {
    this.ensureOpen();
    const result = await this.read(JSON.stringify(['file-directory', scope, options]), {
      kind: 'file-directory',
      scope,
      options,
    });
    this.ensureOpen();
    if (result.kind !== 'file-directory') throw new Error('history.unexpected-result');
    return result.page;
  }

  async readFileDiff(scope: ContentReadScope, options: FileDiffReadOptions): Promise<FileDiffPage> {
    this.ensureOpen();
    const result = await this.read(JSON.stringify(['file-diff', scope, options]), {
      kind: 'file-diff',
      scope,
      options,
    });
    this.ensureOpen();
    if (result.kind !== 'file-diff') throw new Error('history.unexpected-result');
    return result.diff;
  }

  async listMessageNavigation(
    threadId: ThreadId,
    options: ListMessageNavigationOptions,
  ): Promise<MessageNavigationPage> {
    this.ensureOpen();
    const result = await this.read(JSON.stringify(['message-navigation', threadId, options]), {
      kind: 'message-navigation',
      threadId,
      options,
    });
    this.ensureOpen();
    if (result.kind !== 'message-navigation' || result.threadId !== threadId)
      throw new Error('history.unexpected-result');
    return result.page;
  }

  async readTaskPlanHistory(
    scope: ContentReadScope,
    options: TaskPlanHistoryReadOptions,
  ): Promise<TaskPlanHistoryPage> {
    this.ensureOpen();
    const result = await this.read(JSON.stringify(['task-plan-history', scope, options]), {
      kind: 'task-plan-history',
      scope,
      options,
    });
    this.ensureOpen();
    if (
      result.kind !== 'task-plan-history' ||
      result.scope.workspaceId !== scope.workspaceId ||
      result.scope.taskId !== scope.taskId ||
      result.scope.threadId !== scope.threadId
    )
      throw new Error('history.unexpected-result');
    return result.page;
  }

  async getTaskPlanState(taskId: TaskId, threadId?: string): Promise<TaskPlanState> {
    this.ensureOpen();
    const cached = this.options.store.getCachedTaskPlanState(taskId, threadId);
    if (cached) return cached;
    const result = await this.read(JSON.stringify(['task-plan', taskId, threadId]), {
      kind: 'task-plan',
      taskId,
      threadId,
    });
    this.ensureOpen();
    if (
      result.kind !== 'task-plan' ||
      result.snapshot.taskId !== taskId ||
      result.snapshot.threadId !== threadId
    )
      throw new Error('history.unexpected-result');
    try {
      this.options.store.installTaskPlanSnapshot(result.snapshot);
    } catch {
      const now = Date.now();
      if (now - this.lastCacheDiagnosticAt >= 60_000) {
        this.lastCacheDiagnosticAt = now;
        console.warn(
          '[runtime] conversation history cache write failed; returning the source snapshot',
        );
      }
    }
    return result.snapshot.state;
  }

  async getRunProcess(
    runId: RunId,
    page?: RunProcessPageRequest,
    scope?: ContentReadScope,
  ): Promise<RunProcessView> {
    this.ensureOpen();
    if (scope && this.options.contentStore) this.options.contentStore.assertRunScope(scope, runId);
    const cursor = this.options.store.getRunEventCursor(runId);
    const cached = this.runs.get(runId);
    if (
      !page &&
      (!scope || this.options.contentStore) &&
      cached &&
      sameCursor(cached.cursor, cursor)
    ) {
      this.runs.delete(runId);
      this.runs.set(runId, cached);
      return cached.process;
    }
    const result = await this.read(JSON.stringify(['run-process', runId, cursor, page, scope]), {
      kind: 'run-process',
      runId,
      ...(page ? { page } : {}),
      ...(scope ? { scope } : {}),
    });
    this.ensureOpen();
    if (result.kind !== 'run-process' || result.runId !== runId)
      throw new Error('history.unexpected-result');
    if (!page && sameCursor(result.cursor, this.options.store.getRunEventCursor(runId)))
      this.cache(runId, result);
    return result.process;
  }

  private cache(runId: RunId, result: { cursor: EventCursor; process: RunProcessView }): void {
    const previous = this.runs.get(runId);
    if (previous) this.cacheBytes -= previous.bytes;
    this.runs.delete(runId);
    const bytes = Buffer.byteLength(JSON.stringify(result.process));
    const maxBytes = this.options.maxCacheBytes ?? 16 * 1024 * 1024;
    const maxRuns = this.options.maxCachedRuns ?? 32;
    if (bytes > maxBytes || maxRuns < 1) return;
    this.runs.set(runId, { ...result, bytes });
    this.cacheBytes += bytes;
    while (this.runs.size > maxRuns || this.cacheBytes > maxBytes) {
      const oldest = this.runs.keys().next().value!;
      this.cacheBytes -= this.runs.get(oldest)!.bytes;
      this.runs.delete(oldest);
    }
  }

  private read(
    key: string,
    request: ConversationHistoryRequest,
  ): Promise<ConversationHistorySnapshot> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= (this.options.maxPending ?? 32))
      return Promise.reject(new Error('history.busy'));
    const pending = Promise.resolve()
      .then(() => this.loadSnapshot(request))
      .then((result) => {
        this.ensureOpen();
        return result;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, pending);
    return pending;
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('history.closed');
  }

  async close(): Promise<void> {
    this.closed = true;
    this.runs.clear();
    this.cacheBytes = 0;
    await this.worker.close();
  }
}
