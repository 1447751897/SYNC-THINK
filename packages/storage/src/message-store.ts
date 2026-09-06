import {
  type AgentVersionId,
  type CredentialRefId,
  type Message,
  type MessageBlock,
  type MessageId,
  type MessageNavigationEntry,
  type MessageRole,
  type ModelId,
  type RunId,
  type StepId,
  type ThreadId,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

export const DEFAULT_MESSAGE_PAGE_LIMIT = 50;
export const MAX_MESSAGE_PAGE_LIMIT = 100;
export const MAX_MESSAGE_NAVIGATION_PAGE_LIMIT = 500;
export const MESSAGE_NAVIGATION_TEXT_LIMIT = 240;
export const MAX_MESSAGE_BLOCKS = 128;
export const MAX_MESSAGE_BLOCKS_JSON_BYTES = 256 * 1024;
const MAX_MESSAGE_JSON_DEPTH = 16;
const MESSAGE_ROLES = new Set<MessageRole>(['user', 'assistant', 'system', 'tool']);
const MESSAGE_BLOCK_TYPES = new Set<MessageBlock['type']>([
  'text',
  'code',
  'image',
  'plan',
  'tool-call',
  'tool-result',
  'error',
  'commentary',
  'reasoning',
]);

export type MessageStoreErrorCode =
  | 'message.invalid_input'
  | 'message.invalid_record'
  | 'message.thread_not_found'
  | 'message.not_found'
  | 'message.conflict';

export class MessageStoreError extends Error {
  override readonly name = 'MessageStoreError';

  constructor(
    readonly code: MessageStoreErrorCode,
    detail: string,
  ) {
    super(`${code}: ${detail}`);
  }
}

export interface ListMessagesOptions {
  beforeSequence?: number;
  aroundMessageId?: MessageId;
  limit?: number;
}

export interface ListMessageNavigationOptions {
  beforeSequence?: number;
  limit?: number;
}

export interface MessageNavigationPage {
  entries: MessageNavigationEntry[];
  hasMore: boolean;
  nextCursor?: number;
}

export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
  nextCursor?: number;
}

interface MessageDatabaseRow {
  id: string;
  threadId: string;
  role: string;
  agentVersionId: string | null;
  modelId: string | null;
  credentialRefId: string | null;
  runId: string | null;
  stepId: string | null;
  sequence: number;
  blocksJson: string;
  createdAt: string;
}

function invalidInput(detail: string): never {
  throw new MessageStoreError('message.invalid_input', detail);
}

function validateJsonValue(value: unknown, path: string, depth: number): void {
  if (depth > MAX_MESSAGE_JSON_DEPTH) invalidInput(`${path} exceeds maximum JSON depth`);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (/data:image\//i.test(value))
      invalidInput(`${path} must use a storageRef instead of data:image/`);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidInput(`${path} must contain a finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonValue(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalidInput(`${path} must contain plain JSON objects`);
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      validateJsonValue(entry, `${path}.${key}`, depth + 1);
    }
    return;
  }
  invalidInput(`${path} must be JSON-serializable`);
}

function encodeBlocks(blocks: readonly MessageBlock[]): string {
  if (!Array.isArray(blocks)) invalidInput('blocks must be an array');
  if (blocks.length > MAX_MESSAGE_BLOCKS) {
    invalidInput(`blocks exceeds the ${MAX_MESSAGE_BLOCKS} block limit`);
  }
  blocks.forEach((block, index) => {
    if (block === null || typeof block !== 'object' || Array.isArray(block)) {
      invalidInput(`blocks[${index}] must be an object`);
    }
    if (!MESSAGE_BLOCK_TYPES.has(block.type)) {
      invalidInput(`blocks[${index}].type is unsupported`);
    }
    if (block.text !== undefined && typeof block.text !== 'string') {
      invalidInput(`blocks[${index}].text must be a string`);
    }
    if (block.reasoningText !== undefined && typeof block.reasoningText !== 'string') {
      invalidInput(`blocks[${index}].reasoningText must be a string`);
    }
    for (const key of Object.keys(block)) {
      if (key !== 'type' && key !== 'text' && key !== 'reasoningText' && key !== 'payload') {
        invalidInput(`blocks[${index}].${key} is unsupported`);
      }
    }
    validateJsonValue(block, `blocks[${index}]`, 0);
  });

  let json: string;
  try {
    json = JSON.stringify(blocks);
  } catch {
    invalidInput('blocks must be JSON-serializable');
  }
  if (Buffer.byteLength(json, 'utf8') > MAX_MESSAGE_BLOCKS_JSON_BYTES) {
    invalidInput(`blocks_json exceeds ${MAX_MESSAGE_BLOCKS_JSON_BYTES} UTF-8 bytes`);
  }
  return json;
}

export function validateMessageBlocks(blocks: readonly MessageBlock[]): void {
  encodeBlocks(blocks);
}

function validateMessage(message: Message): string {
  if (typeof message.id !== 'string' || message.id.length === 0) invalidInput('id is required');
  if (typeof message.threadId !== 'string' || message.threadId.length === 0) {
    invalidInput('threadId is required');
  }
  if (!MESSAGE_ROLES.has(message.role)) invalidInput(`unsupported role: ${String(message.role)}`);
  if (!Number.isSafeInteger(message.sequence) || message.sequence < 0) {
    invalidInput('sequence must be a non-negative safe integer');
  }
  if (typeof message.createdAt !== 'string' || message.createdAt.length === 0) {
    invalidInput('createdAt is required');
  }
  return encodeBlocks(message.blocks);
}

function decodeBlocks(json: string): MessageBlock[] {
  if (Buffer.byteLength(json, 'utf8') > MAX_MESSAGE_BLOCKS_JSON_BYTES) {
    throw new MessageStoreError('message.invalid_record', 'blocks_json exceeds its byte limit');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new MessageStoreError('message.invalid_record', 'blocks_json is not valid JSON');
  }
  try {
    return JSON.parse(encodeBlocks(parsed as MessageBlock[])) as MessageBlock[];
  } catch (error) {
    if (error instanceof MessageStoreError) {
      throw new MessageStoreError('message.invalid_record', error.message);
    }
    throw error;
  }
}

function mapMessageRow(row: MessageDatabaseRow): Message {
  if (!MESSAGE_ROLES.has(row.role as MessageRole)) {
    throw new MessageStoreError('message.invalid_record', `unsupported role: ${row.role}`);
  }
  if (!Number.isSafeInteger(row.sequence) || row.sequence < 0) {
    throw new MessageStoreError('message.invalid_record', 'sequence is invalid');
  }
  return {
    id: row.id as MessageId,
    threadId: row.threadId as ThreadId,
    role: row.role as MessageRole,
    agentVersionId:
      row.agentVersionId === null ? undefined : (row.agentVersionId as AgentVersionId),
    modelId: row.modelId === null ? undefined : (row.modelId as ModelId),
    credentialRefId:
      row.credentialRefId === null ? undefined : (row.credentialRefId as CredentialRefId),
    runId: row.runId === null ? undefined : (row.runId as RunId),
    stepId: row.stepId === null ? undefined : (row.stepId as StepId),
    sequence: row.sequence,
    blocks: decodeBlocks(row.blocksJson),
    createdAt: row.createdAt,
  };
}

function rowMatchesMessage(row: MessageDatabaseRow, message: Message, blocksJson: string): boolean {
  return (
    row.id === message.id &&
    row.threadId === message.threadId &&
    row.role === message.role &&
    row.agentVersionId === (message.agentVersionId ?? null) &&
    row.modelId === (message.modelId ?? null) &&
    row.credentialRefId === (message.credentialRefId ?? null) &&
    row.runId === (message.runId ?? null) &&
    row.stepId === (message.stepId ?? null) &&
    row.sequence === message.sequence &&
    row.blocksJson === blocksJson &&
    row.createdAt === message.createdAt
  );
}

const MESSAGE_SELECT = `SELECT
  id,
  thread_id AS threadId,
  role,
  agent_version_id AS agentVersionId,
  model_id AS modelId,
  credential_ref_id AS credentialRefId,
  run_id AS runId,
  step_id AS stepId,
  sequence,
  blocks_json AS blocksJson,
  created_at AS createdAt
FROM message`;

export class SqliteMessageStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  append(message: Message): Message {
    const blocksJson = validateMessage(message);
    const existing = this.raw.prepare(`${MESSAGE_SELECT} WHERE id = ?`).get(message.id) as
      MessageDatabaseRow | undefined;
    if (existing) {
      if (!rowMatchesMessage(existing, message, blocksJson)) {
        throw new MessageStoreError('message.conflict', `message id ${message.id} was reused`);
      }
      return mapMessageRow(existing);
    }

    const thread = this.raw.prepare('SELECT 1 FROM thread WHERE id = ?').get(message.threadId);
    if (!thread) {
      throw new MessageStoreError(
        'message.thread_not_found',
        `thread ${message.threadId} does not exist`,
      );
    }

    const sequenceOwner = this.raw
      .prepare('SELECT id FROM message WHERE thread_id = ? AND sequence = ?')
      .get(message.threadId, message.sequence) as { id: string } | undefined;
    if (sequenceOwner) {
      throw new MessageStoreError(
        'message.conflict',
        `thread ${message.threadId} sequence ${message.sequence} belongs to ${sequenceOwner.id}`,
      );
    }

    try {
      this.raw
        .prepare(
          `INSERT INTO message (
            id, thread_id, role, agent_version_id, model_id, credential_ref_id,
            run_id, step_id, sequence, blocks_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          message.id,
          message.threadId,
          message.role,
          message.agentVersionId ?? null,
          message.modelId ?? null,
          message.credentialRefId ?? null,
          message.runId ?? null,
          message.stepId ?? null,
          message.sequence,
          blocksJson,
          message.createdAt,
        );
    } catch (error) {
      if (error instanceof Error && /unique constraint/i.test(error.message)) {
        throw new MessageStoreError('message.conflict', error.message);
      }
      throw error;
    }
    return { ...message, blocks: decodeBlocks(blocksJson) };
  }

  appendMessage(message: Message): Message {
    return this.append(message);
  }

  createFinalMessage(message: Message): Message {
    return this.append(message);
  }

  /** Allocate the next thread-local sequence (MAX(sequence)+1, or 0 when empty). */
  nextSequence(threadId: ThreadId): number {
    if (typeof threadId !== 'string' || threadId.length === 0) {
      invalidInput('threadId is required');
    }
    const row = this.raw
      .prepare('SELECT COALESCE(MAX(sequence), -1) AS maxSequence FROM message WHERE thread_id = ?')
      .get(threadId) as { maxSequence: number };
    const next = Number(row.maxSequence) + 1;
    if (!Number.isSafeInteger(next) || next < 0) {
      invalidInput('next sequence overflowed the safe integer range');
    }
    return next;
  }

  /**
   * Replace blocks for an existing message (used when Desktop attaches durable image refs
   * after the initial text message was written). Same-id same-blocks is idempotent.
   */
  updateBlocks(messageId: MessageId, blocks: readonly MessageBlock[]): Message {
    if (typeof messageId !== 'string' || messageId.length === 0) invalidInput('id is required');
    const existing = this.raw.prepare(`${MESSAGE_SELECT} WHERE id = ?`).get(messageId) as
      MessageDatabaseRow | undefined;
    if (!existing) {
      throw new MessageStoreError('message.invalid_input', `message ${messageId} does not exist`);
    }
    const current = mapMessageRow(existing);
    const next: Message = { ...current, blocks: [...blocks] };
    const blocksJson = encodeBlocks(next.blocks);
    if (existing.blocksJson === blocksJson) return current;
    this.raw.prepare('UPDATE message SET blocks_json = ? WHERE id = ?').run(blocksJson, messageId);
    return { ...next, blocks: decodeBlocks(blocksJson) };
  }

  findRunUserMessageId(threadId: ThreadId, runId: RunId): MessageId | undefined {
    const rows = this.raw
      .prepare(
        "SELECT id FROM message WHERE run_id = ? AND thread_id = ? AND role = 'user' LIMIT 2",
      )
      .all(runId, threadId) as Array<{ id: string }>;
    if (rows.length > 0) return rows.length === 1 ? (rows[0]!.id as MessageId) : undefined;
    const legacy = this.raw
      .prepare(
        `SELECT message.id
         FROM event AS started
         JOIN event AS context
           ON context.workspace_id = started.workspace_id
          AND context.sequence = started.sequence - 1
         JOIN event AS appended
           ON appended.workspace_id = started.workspace_id
          AND appended.sequence = started.sequence - 2
         JOIN message ON message.id = json_extract(appended.payload_json, '$.messageId')
         WHERE started.run_id = @runId AND started.type = 'run.started'
           AND context.run_id = started.run_id AND context.type = 'context.packet.built'
           AND appended.type = 'message.appended'
           AND json_extract(started.payload_json, '$.threadId') = @threadId
           AND json_extract(context.payload_json, '$.threadId') = @threadId
           AND json_extract(appended.payload_json, '$.threadId') = @threadId
           AND json_extract(appended.payload_json, '$.role') = 'user'
           AND json_extract(context.payload_json, '$.packetId') = json_extract(started.payload_json, '$.packetId')
           AND json_extract(appended.payload_json, '$.text') = json_extract(started.payload_json, '$.run.userText')
           AND message.thread_id = @threadId AND message.role = 'user' AND message.run_id IS NULL
         LIMIT 2`,
      )
      .all({ runId, threadId }) as Array<{ id: string }>;
    return legacy.length === 1 ? (legacy[0]!.id as MessageId) : undefined;
  }

  getMessage(messageId: MessageId): Message | undefined {
    const row = this.raw.prepare(`${MESSAGE_SELECT} WHERE id = ?`).get(messageId) as
      MessageDatabaseRow | undefined;
    return row ? mapMessageRow(row) : undefined;
  }

  listMessages(threadId: ThreadId, options: ListMessagesOptions = {}): MessagePage {
    const limit = options.limit ?? DEFAULT_MESSAGE_PAGE_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MESSAGE_PAGE_LIMIT) {
      invalidInput(`limit must be an integer between 1 and ${MAX_MESSAGE_PAGE_LIMIT}`);
    }
    if (
      options.beforeSequence !== undefined &&
      (!Number.isSafeInteger(options.beforeSequence) || options.beforeSequence < 0)
    ) {
      invalidInput('beforeSequence must be a non-negative safe integer');
    }

    if (options.aroundMessageId !== undefined) {
      if (
        options.beforeSequence !== undefined ||
        typeof options.aroundMessageId !== 'string' ||
        !options.aroundMessageId.trim()
      ) {
        invalidInput('aroundMessageId must be non-empty and exclusive of beforeSequence');
      }
      return this.raw.transaction(() => {
        const anchor = this.raw
          .prepare('SELECT sequence FROM message WHERE id = ? AND thread_id = ?')
          .get(options.aroundMessageId, threadId) as { sequence: number } | undefined;
        if (!anchor)
          throw new MessageStoreError('message.not_found', 'anchor is not in this thread');
        const readBefore = (count: number) =>
          this.raw
            .prepare(
              `${MESSAGE_SELECT} WHERE thread_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT ?`,
            )
            .all(threadId, anchor.sequence, count) as MessageDatabaseRow[];
        let before = readBefore(Math.floor(limit / 2));
        const after = this.raw
          .prepare(
            `${MESSAGE_SELECT} WHERE thread_id = ? AND sequence >= ? ORDER BY sequence ASC LIMIT ?`,
          )
          .all(threadId, anchor.sequence, limit - before.length) as MessageDatabaseRow[];
        if (before.length + after.length < limit) before = readBefore(limit - after.length);
        const messages = [...before.reverse(), ...after].map(mapMessageRow);
        const firstSequence = messages[0].sequence;
        const hasMore = Boolean(
          this.raw
            .prepare('SELECT 1 FROM message WHERE thread_id = ? AND sequence < ? LIMIT 1')
            .get(threadId, firstSequence),
        );
        return { messages, hasMore, ...(hasMore ? { nextCursor: firstSequence } : {}) };
      })();
    }

    const beforeClause = options.beforeSequence === undefined ? '' : 'AND sequence < ?';
    const parameters =
      options.beforeSequence === undefined
        ? [threadId, limit + 1]
        : [threadId, options.beforeSequence, limit + 1];
    const rows = this.raw
      .prepare(
        `${MESSAGE_SELECT}
         WHERE thread_id = ? ${beforeClause}
         ORDER BY sequence DESC
         LIMIT ?`,
      )
      .all(...parameters) as MessageDatabaseRow[];
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit).reverse();
    const messages = pageRows.map(mapMessageRow);
    return {
      messages,
      hasMore,
      ...(hasMore && messages.length > 0 ? { nextCursor: messages[0].sequence } : {}),
    };
  }

  listNavigation(
    threadId: ThreadId,
    options: ListMessageNavigationOptions = {},
  ): MessageNavigationPage {
    const limit = options.limit ?? 200;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MESSAGE_NAVIGATION_PAGE_LIMIT) {
      invalidInput(`navigation limit must be between 1 and ${MAX_MESSAGE_NAVIGATION_PAGE_LIMIT}`);
    }
    if (
      options.beforeSequence !== undefined &&
      (!Number.isSafeInteger(options.beforeSequence) || options.beforeSequence < 0)
    ) {
      invalidInput('beforeSequence must be a non-negative safe integer');
    }
    const beforeClause = options.beforeSequence === undefined ? '' : 'AND sequence < ?';
    const parameters =
      options.beforeSequence === undefined
        ? [threadId, limit + 1]
        : [threadId, options.beforeSequence, limit + 1];
    const rows = this.raw
      .prepare(
        `
      SELECT id, sequence, role, created_at AS createdAt, run_id AS runId,
        COALESCE((SELECT substr(group_concat(preview, ' '), 1, ${MESSAGE_NAVIGATION_TEXT_LIMIT}) FROM (
          SELECT substr(json_extract(block.value, '$.text'), 1, ${MESSAGE_NAVIGATION_TEXT_LIMIT}) AS preview
          FROM json_each(CASE WHEN json_valid(message.blocks_json) THEN message.blocks_json ELSE '[]' END) AS block
          WHERE json_extract(block.value, '$.type') IN ('text', 'code', 'error')
            AND json_type(block.value, '$.text') = 'text'
          ORDER BY CAST(block.key AS INTEGER) LIMIT 4
        )), '') AS text,
        (SELECT json_object(
          'state', CASE WHEN json_extract(block.value, '$.payload.terminalState') IN ('failed', 'cancelled')
            THEN json_extract(block.value, '$.payload.terminalState') ELSE NULL END,
          'legacy', CASE WHEN json_type(block.value, '$.payload.legacyBackfill') = 'true' THEN 1 ELSE 0 END)
          FROM json_each(CASE WHEN json_valid(message.blocks_json) THEN message.blocks_json ELSE '[]' END) AS block
          WHERE json_extract(block.value, '$.type') = 'error'
          ORDER BY CAST(block.key AS INTEGER) LIMIT 1) AS terminalMetadata
      FROM message WHERE thread_id = ? AND role IN ('user', 'assistant') ${beforeClause}
      ORDER BY sequence DESC LIMIT ?
    `,
      )
      .all(...parameters) as Array<
      Omit<MessageNavigationEntry, 'runId'> & {
        runId: RunId | null;
        terminalMetadata: string | null;
      }
    >;
    const hasMore = rows.length > limit;
    const entries = rows
      .slice(0, limit)
      .reverse()
      .map(({ runId, terminalMetadata, ...entry }) => {
        const terminal = terminalMetadata
          ? (JSON.parse(terminalMetadata) as {
              state: MessageNavigationEntry['terminalState'] | null;
              legacy: number;
            })
          : undefined;
        return {
          ...entry,
          ...(runId ? { runId } : {}),
          ...(terminal?.state ? { terminalState: terminal.state } : {}),
          ...(terminal?.legacy ? { legacyTerminalBackfill: true } : {}),
        };
      });
    return {
      entries,
      hasMore,
      ...(hasMore && entries.length ? { nextCursor: entries[0].sequence } : {}),
    };
  }

  /**
   * Look up the kernel that produced each run (from the `run.started` event in
   * the shared event log). Used by the runtime to backfill message badges for
   * runs persisted before kernel tracking existed — the event log is indexed by
   * run_id, so per-batch IN lookups stay cheap.
   */
  resolveRunKernelIds(runIds: readonly string[]): Map<string, string> {
    const result = new Map<string, string>();
    const unique = [
      ...new Set(runIds.filter((id): id is string => typeof id === 'string' && id.length > 0)),
    ];
    if (unique.length === 0) return result;
    for (let i = 0; i < unique.length; i += 200) {
      const batch = unique.slice(i, i + 200);
      const placeholders = batch.map(() => '?').join(',');
      const rows = this.raw
        .prepare(
          `SELECT run_id, payload_json FROM event
           WHERE run_id IN (${placeholders}) AND type = 'run.started'`,
        )
        .all(...batch) as Array<{ run_id: string; payload_json: string }>;
      for (const row of rows) {
        try {
          const payload = JSON.parse(row.payload_json) as { kernelId?: unknown };
          if (typeof payload.kernelId === 'string' && payload.kernelId) {
            result.set(row.run_id, payload.kernelId);
          }
        } catch {
          // Malformed event payload — skip.
        }
      }
    }
    return result;
  }
}
