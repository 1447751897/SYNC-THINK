import {
  type AgentVersionId,
  type CredentialRefId,
  type Message,
  type MessageBlock,
  type MessageId,
  type MessageRole,
  type ModelId,
  type RunId,
  type StepId,
  type ThreadId,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

export const DEFAULT_MESSAGE_PAGE_LIMIT = 50;
export const MAX_MESSAGE_PAGE_LIMIT = 100;
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
  limit?: number;
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
    if (/data:image\//i.test(value)) invalidInput(`${path} must use a storageRef instead of data:image/`);
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
    const existing = this.raw
      .prepare(`${MESSAGE_SELECT} WHERE id = ?`)
      .get(message.id) as MessageDatabaseRow | undefined;
    if (existing) {
      if (!rowMatchesMessage(existing, message, blocksJson)) {
        throw new MessageStoreError('message.conflict', `message id ${message.id} was reused`);
      }
      return mapMessageRow(existing);
    }

    const thread = this.raw.prepare('SELECT 1 FROM thread WHERE id = ?').get(message.threadId);
    if (!thread) {
      throw new MessageStoreError('message.thread_not_found', `thread ${message.threadId} does not exist`);
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
      .prepare(
        'SELECT COALESCE(MAX(sequence), -1) AS maxSequence FROM message WHERE thread_id = ?',
      )
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
    const existing = this.raw
      .prepare(`${MESSAGE_SELECT} WHERE id = ?`)
      .get(messageId) as MessageDatabaseRow | undefined;
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

  getMessage(messageId: MessageId): Message | undefined {
    const row = this.raw
      .prepare(`${MESSAGE_SELECT} WHERE id = ?`)
      .get(messageId) as MessageDatabaseRow | undefined;
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
}
