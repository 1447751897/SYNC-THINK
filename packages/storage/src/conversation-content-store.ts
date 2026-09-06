import {
  DURABLE_TRUNCATION_MARKER,
  publicEventPayload,
  parseDeferredContent,
  sanitizeDurableText,
  type Message,
  type DeferredContent,
} from '@sync-think/shared';
import { createHash } from 'node:crypto';
import { ContentSnapshotCache, type PreparedContent } from './content-snapshot-cache.js';
import {
  DEFAULT_CONTENT_CHUNK_LENGTH,
  MAX_CONTENT_CHUNK_LENGTH,
  parseContentReference,
  parseFileDiffReadOptions,
  projectFileDiffPage,
  type FileDiffReadOptions,
  type FileDiffPage,
  type FileDiffSource,
  type ContentChunk,
  type ContentReference,
  type TaskId,
  type ThreadId,
  type WorkspaceId,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';
import { parseStoredEventPayload, type EventPayloadSidecarStore } from './event-payload-sidecar.js';

export interface ContentReadScope {
  workspaceId: WorkspaceId;
  taskId: TaskId;
  threadId: ThreadId;
}

export interface ContentReadOptions {
  reference: ContentReference;
  offset?: number;
  limit?: number;
  version?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function selectValue(root: unknown, path: ContentReference['path']): unknown {
  let value = root;
  for (const key of path) {
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        throw new Error('content.not-found');
      }
    }
    if (Array.isArray(value) && typeof key === 'number' && key < value.length) value = value[key];
    else if (record(value) && typeof key === 'string' && Object.hasOwn(value, key))
      value = value[key];
    else throw new Error('content.not-found');
  }
  return value;
}

function splitsSurrogate(text: string, offset: number): boolean {
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff;
}

export class SqliteConversationContentStore {
  private readonly preparedContent = new ContentSnapshotCache();
  constructor(
    private readonly raw: BetterSQLite3Raw,
    private readonly sidecar?: EventPayloadSidecarStore,
  ) {}

  recoverLegacyMessage(message: Message): Message {
    if (message.role !== 'assistant' || !message.runId || message.id !== 'asst-' + message.runId)
      return message;
    const prose = message.blocks.filter((block) => block.type === 'text');
    const prefix =
      prose.length === 1 &&
      !parseDeferredContent(
        prose[0].contentRef ?? (record(prose[0].payload) ? prose[0].payload.contentRef : undefined),
      ) &&
      prose[0].text?.endsWith(DURABLE_TRUNCATION_MARKER)
        ? prose[0].text.slice(0, -DURABLE_TRUNCATION_MARKER.length)
        : undefined;
    const needsTimeline = message.blocks.some(
      (block) =>
        record(block.payload) &&
        Array.isArray(block.payload.assistantTimeline) &&
        block.payload.assistantTimeline.some(
          (segment) =>
            record(segment) &&
            [
              ['text', 'textRef'],
              ['output', 'outputRef'],
              ['argumentsJson', 'argumentsRef'],
            ].some(
              ([field, reference]) =>
                !parseDeferredContent(segment[reference]) &&
                typeof segment[field] === 'string' &&
                segment[field].endsWith(DURABLE_TRUNCATION_MARKER),
            ),
        ),
    );
    if ((!prefix || prefix.length < 32) && !needsTimeline) return message;
    return this.raw.transaction(() => {
      const scope = this.raw
        .prepare(
          'SELECT task.workspace_id AS workspaceId, task.id AS taskId, thread.id AS threadId FROM message JOIN thread ON thread.id = message.thread_id JOIN task ON task.id = thread.task_id WHERE message.id = ? AND message.thread_id = ? AND message.run_id = ? AND message.role = ?',
        )
        .get(message.id, message.threadId, message.runId, 'assistant') as
        ContentReadScope | undefined;
      if (!scope) return message;
      const recovered = this.recoverTimelineReferences(message);
      if (recovered !== message) return recovered;
      if (!prefix || prefix.length < 32) return message;
      const terminal = this.raw
        .prepare(
          "SELECT id FROM event WHERE run_id = ? AND workspace_id = ? AND (task_id IS NULL OR task_id = ?) AND type IN ('run.completed', 'run.failed', 'run.cancelled') ORDER BY sequence DESC, id DESC LIMIT 2",
        )
        .all(message.runId, scope.workspaceId, scope.taskId) as Array<{ id: string }>;
      if (terminal.length !== 1) return message;
      const candidates: ContentReference[] = [
        { source: 'event-prose', id: terminal[0].id, path: ['assistantText'] },
        { source: 'event-prose', id: terminal[0].id, path: ['run', 'assistantText'] },
      ];
      for (const reference of candidates) {
        let source: unknown;
        try {
          source = selectValue(this.readSource(scope, reference), reference.path);
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.startsWith('content.not-found') ||
              ('code' in error && String(error.code).startsWith('event-payload.')))
          )
            continue;
          throw error;
        }
        if (
          typeof source !== 'string' ||
          source.length <= prefix.length ||
          source.endsWith(DURABLE_TRUNCATION_MARKER) ||
          !source.startsWith(prefix)
        )
          continue;
        const contentRef = {
          reference,
          utf16Length: source.length,
          utf8Bytes: Buffer.byteLength(source),
          format: 'text' as const,
        };
        return {
          ...message,
          blocks: message.blocks.map((block) =>
            block === prose[0] ? { ...block, contentRef } : block,
          ),
        };
      }
      return message;
    })();
  }

  private recoverTimelineReferences(message: Message): Message {
    let changed = false;
    const recoveredProse: Array<{ kind: string; text: string; reference: DeferredContent }> = [];
    const blocks = message.blocks.map((block) => {
      if (!record(block.payload) || !Array.isArray(block.payload.assistantTimeline)) return block;
      const assistantTimeline = block.payload.assistantTimeline.map((segment) => {
        if (!record(segment) || typeof segment.id !== 'string') return segment;
        const fields =
          segment.kind === 'tool'
            ? [
                ['output', 'outputRef'],
                ['argumentsJson', 'argumentsRef'],
              ]
            : segment.kind === 'text' || segment.kind === 'thinking'
              ? [['text', 'textRef']]
              : [];
        const missing = fields.filter(
          ([field, reference]) =>
            !parseDeferredContent(segment[reference]) &&
            typeof segment[field] === 'string' &&
            segment[field].endsWith(DURABLE_TRUNCATION_MARKER),
        );
        if (!missing.length) return segment;
        const row = this.raw
          .prepare(
            'SELECT segment_json AS segmentJson FROM assistant_timeline_segment WHERE run_id = ? AND segment_id = ?',
          )
          .get(message.runId, segment.id) as { segmentJson: string } | undefined;
        if (!row) return segment;
        let source: unknown;
        try {
          source = JSON.parse(row.segmentJson);
        } catch {
          return segment;
        }
        if (
          !record(source) ||
          source.kind !== segment.kind ||
          source.sequence !== segment.sequence ||
          (segment.phase !== undefined && source.phase !== segment.phase)
        )
          return segment;
        let projected = segment;
        for (const [field, referenceField] of missing) {
          const original = segment[field] as string;
          const prefix = original.slice(0, -DURABLE_TRUNCATION_MARKER.length);
          const text = source[field];
          const reference = parseContentReference({
            source: 'timeline',
            runId: message.runId,
            id: segment.id,
            path: [field],
          });
          if (
            !reference ||
            typeof text !== 'string' ||
            prefix.length < 32 ||
            text.length <= prefix.length ||
            text.endsWith(DURABLE_TRUNCATION_MARKER) ||
            !text.startsWith(prefix)
          )
            continue;
          const deferred: DeferredContent = {
            reference,
            utf16Length: text.length,
            utf8Bytes: Buffer.byteLength(text),
            format: 'text',
          };
          projected = { ...projected, [referenceField]: deferred };
          changed = true;
          if (field === 'text')
            recoveredProse.push({ kind: String(segment.kind), text, reference: deferred });
        }
        return projected;
      });
      return { ...block, payload: { ...block.payload, assistantTimeline } };
    });
    if (!changed) return message;
    return {
      ...message,
      blocks: blocks.map((block) => {
        const field =
          block.type === 'reasoning' && typeof block.reasoningText === 'string'
            ? 'reasoningText'
            : 'text';
        const text = block[field];
        if (
          block.contentRef ||
          !['text', 'reasoning'].includes(block.type) ||
          !text?.endsWith(DURABLE_TRUNCATION_MARKER)
        )
          return block;
        const prefix = text.slice(0, -DURABLE_TRUNCATION_MARKER.length);
        const candidates = recoveredProse.filter(
          (source) =>
            source.kind === (block.type === 'text' ? 'text' : 'thinking') &&
            source.text.startsWith(prefix),
        );
        return candidates.length === 1 ? { ...block, contentRef: candidates[0].reference } : block;
      }),
    };
  }

  readDiff(scope: ContentReadScope, input: FileDiffReadOptions): FileDiffPage {
    const options = parseFileDiffReadOptions(input);
    if (!options) throw new Error('content.invalid-reference');
    return this.raw.transaction(() => {
      this.assertScope(scope);
      const resolve = (source: FileDiffSource): string => {
        if ('text' in source) return source.text;
        const value = selectValue(this.readSource(scope, source.reference), source.reference.path);
        if (typeof value !== 'string') throw new Error('content.not-text');
        return value;
      };
      const before = resolve(options.before);
      const after = resolve(options.after);
      const beforeVersion = createHash('sha256').update(JSON.stringify(before)).digest('hex');
      const afterVersion = createHash('sha256').update(JSON.stringify(after)).digest('hex');
      const version = createHash('sha256')
        .update(beforeVersion + ':' + afterVersion)
        .digest('hex');
      if (options.version !== undefined && options.version !== version)
        throw new Error('content.version-changed');
      return {
        ...projectFileDiffPage(before, after, options, version),
        beforeVersion,
        afterVersion,
      };
    })();
  }

  read(scope: ContentReadScope, options: ContentReadOptions): ContentChunk {
    const reference = parseContentReference(options.reference);
    if (!reference) throw new Error('content.invalid-reference');
    const offset = options.offset ?? 0;
    const limit = options.limit ?? DEFAULT_CONTENT_CHUNK_LENGTH;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 256 ||
      limit > MAX_CONTENT_CHUNK_LENGTH ||
      (options.version !== undefined && !/^[a-f0-9]{64}$/.test(options.version))
    )
      throw new Error('content.invalid-range');
    const source = this.readPreparedContent(scope, reference);
    const text = source.text;
    if (offset > text.length || splitsSurrogate(text, offset))
      throw new Error('content.invalid-range');
    if (options.version !== undefined && options.version !== source.version)
      throw new Error('content.version-changed');
    let end = Math.min(text.length, offset + limit);
    if (splitsSurrogate(text, end)) end -= 1;
    return {
      text: text.slice(offset, end),
      offset,
      ...(end < text.length ? { nextOffset: end } : {}),
      utf16Length: text.length,
      utf8Bytes: source.utf8Bytes,
      version: source.version,
      format: source.format,
    };
  }

  private contentRevision(): string {
    const version = this.raw.pragma('data_version', { simple: true });
    const changes = this.raw.prepare('SELECT total_changes() AS changes').get() as {
      changes: number;
    };
    const schema = this.raw.pragma('schema_version', { simple: true });
    return String(version) + ':' + changes.changes + ':' + String(schema);
  }

  private readPreparedContent(
    scope: ContentReadScope,
    reference: ContentReference,
  ): PreparedContent {
    const load = (cached?: PreparedContent) =>
      this.raw.transaction(() => {
        this.assertScope(scope);
        if (cached) return cached;
        const value = selectValue(this.readSource(scope, reference), reference.path);
        const format = typeof value === 'string' ? 'text' : 'json';
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        if (typeof text !== 'string') throw new Error('content.not-found');
        return {
          text,
          format,
          utf8Bytes: Buffer.byteLength(text),
          version: createHash('sha256').update(JSON.stringify(text)).digest('hex'),
        } as PreparedContent;
      })();
    if (this.raw.inTransaction) return load();
    const revision = this.contentRevision();
    const key = JSON.stringify([scope.workspaceId, scope.taskId, scope.threadId, reference]);
    const content = load(this.preparedContent.get(key, revision));
    if (this.contentRevision() !== revision) {
      this.preparedContent.clear();
      return load();
    }
    this.preparedContent.set(key, content, revision);
    return content;
  }

  captureRunDirectory<Result>(
    scope: ContentReadScope,
    project: (
      runs: Array<{ runId: import('@sync-think/shared').RunId; sequence: number; eventId: string }>,
    ) => Result,
  ): Result {
    return this.raw
      .transaction(() => {
        this.assertScope(scope);
        const runs = this.raw
          .prepare(
            `WITH scoped_runs AS (
          SELECT run_id FROM event WHERE workspace_id = ? AND type = 'run.started'
          AND (task_id IS NULL OR task_id = ?)
          AND COALESCE(json_extract(payload_json, '$.threadId'), json_extract(payload_json, '$.run.threadId')) = ?
          UNION SELECT run_id FROM message WHERE thread_id = ? AND run_id IS NOT NULL
        ) SELECT event.run_id AS runId, event.sequence, event.id AS eventId
        FROM scoped_runs JOIN event ON event.id = (
          SELECT id FROM event WHERE run_id = scoped_runs.run_id AND workspace_id = ? ORDER BY sequence DESC, id DESC LIMIT 1
        ) ORDER BY event.run_id`,
          )
          .all(
            scope.workspaceId,
            scope.taskId,
            scope.threadId,
            scope.threadId,
            scope.workspaceId,
          ) as Array<{
          runId: import('@sync-think/shared').RunId;
          sequence: number;
          eventId: string;
        }>;
        return project(runs);
      })
      .deferred();
  }

  assertRunScope(scope: ContentReadScope, runId: string): void {
    this.assertScope(scope);
    if (!this.runBelongsToScope(runId, scope)) throw new Error('content.not-found');
  }

  private assertScope(scope: ContentReadScope): void {
    const exists = this.raw
      .prepare(
        `SELECT 1 FROM thread JOIN task ON task.id = thread.task_id
      WHERE thread.id = ? AND task.id = ? AND task.workspace_id = ?`,
      )
      .get(scope.threadId, scope.taskId, scope.workspaceId);
    if (!exists) throw new Error('content.not-found');
  }

  private runBelongsToScope(runId: string, scope: ContentReadScope): boolean {
    const started = this.raw
      .prepare(
        `SELECT 1 FROM event WHERE run_id = ? AND workspace_id = ?
      AND type = 'run.started' AND (task_id IS NULL OR task_id = ?)
      AND COALESCE(json_extract(payload_json, '$.threadId'), json_extract(payload_json, '$.run.threadId')) = ? LIMIT 1`,
      )
      .get(runId, scope.workspaceId, scope.taskId, scope.threadId);
    if (started) return true;
    return Boolean(
      this.raw
        .prepare('SELECT 1 FROM message WHERE run_id = ? AND thread_id = ? LIMIT 1')
        .get(runId, scope.threadId),
    );
  }

  private readSource(scope: ContentReadScope, reference: ContentReference): unknown {
    if (reference.source === 'message') {
      const row = this.raw
        .prepare('SELECT blocks_json AS blocksJson FROM message WHERE id = ? AND thread_id = ?')
        .get(reference.id, scope.threadId) as { blocksJson: string } | undefined;
      if (!row) throw new Error('content.not-found');
      return { blocks: JSON.parse(row.blocksJson) as unknown };
    }
    if (reference.source === 'timeline') {
      if (!this.runBelongsToScope(reference.runId, scope)) throw new Error('content.not-found');
      const row = this.raw
        .prepare(
          'SELECT segment_json AS segmentJson FROM assistant_timeline_segment WHERE run_id = ? AND segment_id = ?',
        )
        .get(reference.runId, reference.id) as { segmentJson: string } | undefined;
      if (!row) throw new Error('content.not-found');
      return JSON.parse(row.segmentJson) as unknown;
    }
    const row = this.raw
      .prepare(
        `SELECT type, task_id AS taskId, run_id AS runId, payload_json AS payloadJson
      FROM event WHERE id = ? AND workspace_id = ?`,
      )
      .get(reference.id, scope.workspaceId) as
      | { type: string; taskId: string | null; runId: string | null; payloadJson: string }
      | undefined;
    if (!row || (row.taskId !== null && row.taskId !== scope.taskId))
      throw new Error('content.not-found');
    const payload = parseStoredEventPayload(row.payloadJson, this.sidecar);
    const threadId =
      typeof payload.threadId === 'string'
        ? payload.threadId
        : record(payload.run)
          ? payload.run.threadId
          : undefined;
    if (
      threadId !== undefined
        ? threadId !== scope.threadId
        : !row.runId || !this.runBelongsToScope(row.runId, scope)
    )
      throw new Error('content.not-found');
    if (reference.source === 'event-prose') {
      if (!['run.completed', 'run.failed', 'run.cancelled'].includes(row.type))
        throw new Error('content.not-found');
      if (
        reference.path[0] === 'run' &&
        record(payload.run) &&
        ((payload.run.runId !== undefined && payload.run.runId !== row.runId) ||
          (payload.run.threadId !== undefined && payload.run.threadId !== scope.threadId))
      )
        throw new Error('content.not-found');
      const text = selectValue(payload, reference.path);
      if (typeof text !== 'string') throw new Error('content.not-found');
      const sanitized = sanitizeDurableText(text);
      return reference.path[0] === 'run'
        ? { run: { assistantText: sanitized } }
        : { assistantText: sanitized };
    }
    return reference.source === 'event-display'
      ? { payload: publicEventPayload(payload) }
      : payload;
  }
}
