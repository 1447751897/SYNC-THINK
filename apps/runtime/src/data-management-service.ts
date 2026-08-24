import { once } from 'node:events';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, rmdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import {
  SYNC_THINK_DATA_EXPORT_FORMAT,
  SYNC_THINK_DATA_EXPORT_VERSION,
  type DataBackupResponse,
  type DataCleanConversationsPayload,
  type DataCleanConversationsResponse,
  type DataCleanEmptyAttachmentDirectoriesResponse,
  type DataCompactStorageResponse,
  type DataConflictStrategy,
  type DataExportPayload,
  type DataExportResponse,
  type DataImportPayload,
  type DataImportResponse,
  type DataStorageStatsResponse,
} from '@sync-think/protocol';
import { ulid } from '@sync-think/shared';
import type { BetterSQLite3Raw } from '@sync-think/storage';

const MAX_IMPORT_FILE_BYTES = 512 * 1024 * 1024;
const ATTACHMENT_ROOT_NAMES = ['message-images', 'chat-image-staging'] as const;

interface RuntimeDataManagementServiceOptions {
  raw: BetterSQLite3Raw;
  databasePath: string;
  dataRoot: string;
}

interface WorkspaceExportRow {
  id: string;
  folderPath: string | null;
  name: string;
  policyId: string | null;
  uiPrefsJson: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ConversationExportRow {
  id: string;
  track: 'model' | 'agent' | 'team';
  targetRef: string;
  workspaceId: string | null;
  title: string;
  pinnedAt: string | null;
  archivedAt: string | null;
  executionMode: string;
  interactionMode: 'plan' | 'execute';
  contextWindowOverride: number | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  threadId: string | null;
}

interface MessageExportRow {
  id: string;
  role: string;
  agentVersionId: string | null;
  modelId: string | null;
  runId: string | null;
  stepId: string | null;
  sequence: number;
  blocksJson: string;
  createdAt: string;
}

interface DataExportDocument {
  format: typeof SYNC_THINK_DATA_EXPORT_FORMAT;
  version: typeof SYNC_THINK_DATA_EXPORT_VERSION;
  exportedAt: string;
  workspaces: WorkspaceExportDocument[];
  conversations: ConversationExportDocument[];
}

interface WorkspaceExportDocument {
  id: string;
  folderPath?: string;
  name: string;
  policyId?: string;
  uiPrefsJson?: string;
  createdAt: string;
  updatedAt: string;
}

interface ConversationExportDocument {
  conversation: {
    id: string;
    track: 'model' | 'agent' | 'team';
    targetRef: string;
    workspaceId?: string;
    title: string;
    pinnedAt?: string;
    archivedAt?: string;
    executionMode: string;
    interactionMode: 'plan' | 'execute';
    contextWindowOverride?: number;
    lastMessageAt?: string;
    createdAt: string;
    updatedAt: string;
  };
  messages: MessageExportDocument[];
}

interface MessageExportDocument {
  id: string;
  role: string;
  agentVersionId?: string;
  modelId?: string;
  runId?: string;
  stepId?: string;
  sequence: number;
  blocks: unknown[];
  createdAt: string;
}

function numberFromCountRow(row: unknown): number {
  if (!row || typeof row !== 'object') return 0;
  const value = (row as { count?: unknown }).count;
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function directoryFileSize(root: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) total += await directoryFileSize(path);
    else if (entry.isFile()) total += await fileSize(path);
  }
  return total;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined {
  return nonEmptyString(value) ? value : undefined;
}

function safeBlocksJson(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapWorkspaceRow(row: WorkspaceExportRow): WorkspaceExportDocument {
  return {
    id: row.id,
    ...(row.folderPath ? { folderPath: row.folderPath } : {}),
    name: row.name,
    ...(row.policyId ? { policyId: row.policyId } : {}),
    ...(row.uiPrefsJson ? { uiPrefsJson: row.uiPrefsJson } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapConversationRow(
  row: ConversationExportRow,
): ConversationExportDocument['conversation'] {
  return {
    id: row.id,
    track: row.track,
    targetRef: row.targetRef,
    ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
    title: row.title,
    ...(row.pinnedAt ? { pinnedAt: row.pinnedAt } : {}),
    ...(row.archivedAt ? { archivedAt: row.archivedAt } : {}),
    executionMode: row.executionMode,
    interactionMode: row.interactionMode,
    ...(row.contextWindowOverride ? { contextWindowOverride: row.contextWindowOverride } : {}),
    ...(row.lastMessageAt ? { lastMessageAt: row.lastMessageAt } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMessageRow(row: MessageExportRow): MessageExportDocument {
  return {
    id: row.id,
    role: row.role,
    ...(row.agentVersionId ? { agentVersionId: row.agentVersionId } : {}),
    ...(row.modelId ? { modelId: row.modelId } : {}),
    ...(row.runId ? { runId: row.runId } : {}),
    ...(row.stepId ? { stepId: row.stepId } : {}),
    sequence: row.sequence,
    blocks: safeBlocksJson(row.blocksJson),
    createdAt: row.createdAt,
  };
}

async function writeChunk(
  stream: ReturnType<typeof createWriteStream>,
  value: string,
): Promise<void> {
  if (stream.write(value)) return;
  await once(stream, 'drain');
}

function assertAbsoluteFilePath(path: string, label: string): string {
  if (!nonEmptyString(path) || !isAbsolute(path)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return resolve(path);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseExportDocument(value: unknown): DataExportDocument {
  const document = asObject(value);
  if (!document) throw new Error('unsupported Sync-Think data export');
  if (
    document.format !== SYNC_THINK_DATA_EXPORT_FORMAT ||
    document.version !== SYNC_THINK_DATA_EXPORT_VERSION ||
    !Array.isArray(document.workspaces) ||
    !Array.isArray(document.conversations)
  ) {
    throw new Error('unsupported Sync-Think data export');
  }
  return document as unknown as DataExportDocument;
}

function normalizeConflictStrategy(value: DataConflictStrategy): DataConflictStrategy {
  if (value !== 'skip' && value !== 'overwrite') {
    throw new Error('conflictStrategy must be skip or overwrite');
  }
  return value;
}

export class RuntimeDataManagementService {
  private readonly raw: BetterSQLite3Raw;
  private readonly databasePath: string;
  private readonly dataRoot: string;

  constructor(options: RuntimeDataManagementServiceOptions) {
    this.raw = options.raw;
    this.databasePath = assertAbsoluteFilePath(options.databasePath, 'databasePath');
    this.dataRoot = assertAbsoluteFilePath(options.dataRoot, 'dataRoot');
  }

  async getStorageStats(): Promise<DataStorageStatsResponse> {
    const [databaseBytes, walBytes, conversationFilesSizeBytes] = await Promise.all([
      fileSize(this.databasePath),
      fileSize(`${this.databasePath}-wal`),
      Promise.all(
        ATTACHMENT_ROOT_NAMES.map((name) => directoryFileSize(join(this.dataRoot, name))),
      ).then((sizes) => sizes.reduce((sum, size) => sum + size, 0)),
    ]);
    return {
      success: true,
      dataDirectory: this.dataRoot,
      dbSizeBytes: databaseBytes + walBytes,
      conversationFilesSizeBytes,
      conversationCount: numberFromCountRow(
        this.raw.prepare('SELECT COUNT(*) AS count FROM conversation').get(),
      ),
      messageCount: numberFromCountRow(
        this.raw.prepare('SELECT COUNT(*) AS count FROM message').get(),
      ),
    };
  }

  async exportData(payload: DataExportPayload): Promise<DataExportResponse> {
    const filePath = assertAbsoluteFilePath(payload.filePath, 'filePath');
    if (payload.workspaceId !== undefined && !nonEmptyString(payload.workspaceId)) {
      throw new Error('workspaceId must be a non-empty string');
    }
    await mkdir(dirname(filePath), { recursive: true });
    const workspaceRows = this.raw
      .prepare(
        `SELECT id, folder_path AS folderPath, name, policy_id AS policyId,
                ui_prefs_json AS uiPrefsJson, created_at AS createdAt, updated_at AS updatedAt
         FROM workspace
         ${payload.workspaceId ? 'WHERE id = ?' : ''}
         ORDER BY created_at ASC, id ASC`,
      )
      .all(...(payload.workspaceId ? [payload.workspaceId] : [])) as WorkspaceExportRow[];
    const conversationRows = this.raw
      .prepare(
        `SELECT c.id, c.track, c.target_ref AS targetRef, c.workspace_id AS workspaceId,
                c.title, c.pinned_at AS pinnedAt, c.archived_at AS archivedAt,
                c.execution_mode AS executionMode, c.interaction_mode AS interactionMode,
                c.context_window_override AS contextWindowOverride,
                c.last_message_at AS lastMessageAt, c.created_at AS createdAt,
                c.updated_at AS updatedAt, th.id AS threadId
         FROM conversation c
         LEFT JOIN task t ON t.id = c.task_id
         LEFT JOIN thread th ON th.task_id = t.id
         ${payload.workspaceId ? 'WHERE c.workspace_id = ?' : ''}
         ORDER BY c.created_at ASC, c.id ASC`,
      )
      .all(...(payload.workspaceId ? [payload.workspaceId] : [])) as ConversationExportRow[];
    const messages = this.raw.prepare(
      `SELECT id, role, agent_version_id AS agentVersionId, model_id AS modelId,
              run_id AS runId, step_id AS stepId, sequence, blocks_json AS blocksJson,
              created_at AS createdAt
       FROM message WHERE thread_id = ? ORDER BY sequence ASC, id ASC`,
    );
    const stream = createWriteStream(filePath, { encoding: 'utf8' });
    let messageCount = 0;
    try {
      await writeChunk(
        stream,
        `{"format":${JSON.stringify(SYNC_THINK_DATA_EXPORT_FORMAT)},"version":${SYNC_THINK_DATA_EXPORT_VERSION},"exportedAt":${JSON.stringify(new Date().toISOString())},"workspaces":${JSON.stringify(workspaceRows.map(mapWorkspaceRow))},"conversations":[`,
      );
      for (
        let conversationIndex = 0;
        conversationIndex < conversationRows.length;
        conversationIndex += 1
      ) {
        const row = conversationRows[conversationIndex]!;
        if (conversationIndex > 0) await writeChunk(stream, ',');
        await writeChunk(
          stream,
          `{"conversation":${JSON.stringify(mapConversationRow(row))},"messages":[`,
        );
        let messageIndex = 0;
        if (row.threadId) {
          for (const message of messages.iterate(
            row.threadId,
          ) as IterableIterator<MessageExportRow>) {
            if (messageIndex > 0) await writeChunk(stream, ',');
            await writeChunk(stream, JSON.stringify(mapMessageRow(message)));
            messageIndex += 1;
            messageCount += 1;
          }
        }
        await writeChunk(stream, ']}');
      }
      await writeChunk(stream, ']}');
      stream.end();
      await finished(stream);
    } catch (error) {
      stream.destroy();
      await rm(filePath, { force: true }).catch(() => undefined);
      throw error;
    }
    return {
      success: true,
      filePath,
      count: {
        workspaces: workspaceRows.length,
        conversations: conversationRows.length,
        messages: messageCount,
      },
    };
  }

  async importData(payload: DataImportPayload): Promise<DataImportResponse> {
    const filePath = assertAbsoluteFilePath(payload.filePath, 'filePath');
    const conflictStrategy = normalizeConflictStrategy(payload.conflictStrategy);
    const descriptor = await stat(filePath);
    if (!descriptor.isFile()) throw new Error('data import path is not a file');
    if (descriptor.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error('data import exceeds the 512 MiB JSON limit');
    }
    const document = parseExportDocument(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
    const imported = { workspaces: 0, conversations: 0, messages: 0 };
    let skipped = 0;
    const importTransaction = this.raw.transaction(() => {
      for (const workspaceValue of document.workspaces) {
        const workspace = asObject(workspaceValue);
        if (!workspace || !nonEmptyString(workspace.id) || !nonEmptyString(workspace.name)) {
          throw new Error('data import contains an invalid workspace');
        }
        const existing = this.raw
          .prepare('SELECT id FROM workspace WHERE id = ?')
          .get(workspace.id);
        if (existing && conflictStrategy === 'skip') {
          skipped += 1;
          continue;
        }
        const now = new Date().toISOString();
        if (existing) {
          this.raw
            .prepare(
              `UPDATE workspace
               SET name = ?, policy_id = ?, ui_prefs_json = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(
              workspace.name.trim(),
              optionalString(workspace.policyId) ?? null,
              optionalString(workspace.uiPrefsJson) ?? null,
              optionalString(workspace.updatedAt) ?? now,
              workspace.id,
            );
        } else {
          this.raw
            .prepare(
              `INSERT INTO workspace
                 (id, folder_path, name, policy_id, ui_prefs_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              workspace.id,
              null,
              workspace.name.trim(),
              optionalString(workspace.policyId) ?? null,
              optionalString(workspace.uiPrefsJson) ?? null,
              optionalString(workspace.createdAt) ?? now,
              optionalString(workspace.updatedAt) ?? now,
            );
        }
        imported.workspaces += 1;
      }

      for (const conversationValue of document.conversations) {
        const entry = asObject(conversationValue);
        const conversation = asObject(entry?.conversation);
        const messages = Array.isArray(entry?.messages) ? entry.messages : undefined;
        if (
          !conversation ||
          !messages ||
          !nonEmptyString(conversation.id) ||
          !nonEmptyString(conversation.targetRef) ||
          !['model', 'agent', 'team'].includes(String(conversation.track))
        ) {
          throw new Error('data import contains an invalid conversation');
        }
        const existing = this.raw
          .prepare('SELECT id, task_id AS taskId FROM conversation WHERE id = ?')
          .get(conversation.id) as { id: string; taskId: string | null } | undefined;
        if (existing && conflictStrategy === 'skip') {
          skipped += 1;
          continue;
        }
        if (existing) this.deleteConversationRecord(conversation.id);

        let workspaceId = optionalString(conversation.workspaceId);
        if (
          workspaceId &&
          !this.raw.prepare('SELECT id FROM workspace WHERE id = ?').get(workspaceId)
        ) {
          workspaceId = undefined;
        }
        if (!workspaceId && messages.length > 0) {
          const fallback = this.raw
            .prepare('SELECT id FROM workspace ORDER BY created_at ASC, id ASC LIMIT 1')
            .get() as { id: string } | undefined;
          workspaceId = fallback?.id;
        }
        const now = new Date().toISOString();
        let taskId: string | null = null;
        let threadId: string | null = null;
        if (messages.length > 0) {
          if (!workspaceId)
            throw new Error('data import conversation messages require a workspace');
          taskId = `task-${ulid()}`;
          threadId = `thread-${ulid()}`;
          const createdAt = optionalString(conversation.createdAt) ?? now;
          this.raw
            .prepare(
              `INSERT INTO task (
                 id, workspace_id, parent_task_id, title, goal, status, participation_mode,
                 acceptance_criteria_json, version, last_opened_at, created_at, updated_at
               ) VALUES (?, ?, NULL, ?, ?, 'active', 'conversation', '[]', 0, NULL, ?, ?)`,
            )
            .run(
              taskId,
              workspaceId,
              optionalString(conversation.title) ?? 'Imported conversation',
              optionalString(conversation.title) ?? 'Imported conversation',
              createdAt,
              optionalString(conversation.updatedAt) ?? createdAt,
            );
          this.raw
            .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
            .run(threadId, taskId, createdAt);
        }
        this.raw
          .prepare(
            `INSERT INTO conversation (
               id, track, target_ref, workspace_id, title, pinned_at, archived_at,
               execution_mode, interaction_mode, context_window_override, last_message_at,
               task_id, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            conversation.id,
            conversation.track,
            conversation.targetRef,
            workspaceId ?? null,
            typeof conversation.title === 'string' ? conversation.title : '',
            optionalString(conversation.pinnedAt) ?? null,
            optionalString(conversation.archivedAt) ?? null,
            optionalString(conversation.executionMode) ?? 'full-access',
            conversation.interactionMode === 'plan' ? 'plan' : 'execute',
            Number.isSafeInteger(conversation.contextWindowOverride)
              ? conversation.contextWindowOverride
              : null,
            optionalString(conversation.lastMessageAt) ?? null,
            taskId,
            optionalString(conversation.createdAt) ?? now,
            optionalString(conversation.updatedAt) ?? now,
          );
        imported.conversations += 1;

        if (threadId) {
          const usedSequences = new Set<number>();
          for (const [index, messageValue] of messages.entries()) {
            const message = asObject(messageValue);
            if (!message || !nonEmptyString(message.role) || !Array.isArray(message.blocks)) {
              throw new Error('data import contains an invalid message');
            }
            let sequence = Number(message.sequence);
            if (!Number.isSafeInteger(sequence) || sequence < 0 || usedSequences.has(sequence)) {
              sequence = index;
              while (usedSequences.has(sequence)) sequence += 1;
            }
            usedSequences.add(sequence);
            let messageId = optionalString(message.id) ?? `message-${ulid()}`;
            if (this.raw.prepare('SELECT id FROM message WHERE id = ?').get(messageId)) {
              messageId = `message-${ulid()}`;
            }
            this.raw
              .prepare(
                `INSERT INTO message (
                   id, thread_id, role, agent_version_id, model_id, credential_ref_id,
                   run_id, step_id, sequence, blocks_json, created_at
                 ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
              )
              .run(
                messageId,
                threadId,
                message.role,
                optionalString(message.agentVersionId) ?? null,
                optionalString(message.modelId) ?? null,
                optionalString(message.runId) ?? null,
                optionalString(message.stepId) ?? null,
                sequence,
                JSON.stringify(message.blocks),
                optionalString(message.createdAt) ?? now,
              );
            imported.messages += 1;
          }
        }
      }
    });
    importTransaction.immediate();
    return { success: true, imported, skipped };
  }

  async backup(input: { targetDirectory: string; now?: Date }): Promise<DataBackupResponse> {
    const targetDirectory = assertAbsoluteFilePath(input.targetDirectory, 'targetDirectory');
    await mkdir(targetDirectory, { recursive: true });
    const createdAt = (input.now ?? new Date()).toISOString();
    const stamp = createdAt.replace(/[:.]/g, '-');
    let backupPath = join(targetDirectory, `sync-think-backup-${stamp}.db`);
    let suffix = 1;
    while (existsSync(backupPath)) {
      backupPath = join(targetDirectory, `sync-think-backup-${stamp}-${suffix}.db`);
      suffix += 1;
    }
    await this.raw.backup(backupPath);
    return {
      success: true,
      backupPath,
      sizeBytes: await fileSize(backupPath),
      createdAt,
    };
  }

  async compactStorage(): Promise<DataCompactStorageResponse> {
    const before = (await this.getStorageStats()).dbSizeBytes;
    this.raw.pragma('optimize');
    try {
      this.raw.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // A concurrent reader can keep WAL pages alive; optimize remains valid.
    }
    const autoVacuum = Number(this.raw.pragma('auto_vacuum', { simple: true }));
    if (autoVacuum === 2) this.raw.pragma('incremental_vacuum(10000)');
    const after = (await this.getStorageStats()).dbSizeBytes;
    return {
      success: true,
      reclaimedBytes: Math.max(0, before - after),
      compacted: numberFromCountRow(
        this.raw.prepare('SELECT COUNT(*) AS count FROM conversation').get(),
      ),
    };
  }

  cleanConversations(
    payload: DataCleanConversationsPayload,
  ): Promise<DataCleanConversationsResponse> {
    const beforeTimestamp = payload.beforeTimestamp;
    if (
      beforeTimestamp !== undefined &&
      (!Number.isFinite(beforeTimestamp) || beforeTimestamp < 0)
    ) {
      return Promise.reject(new Error('beforeTimestamp must be a non-negative epoch value'));
    }
    const beforeIso =
      beforeTimestamp === undefined ? undefined : new Date(beforeTimestamp).toISOString();
    const condition = beforeIso ? 'COALESCE(last_message_at, created_at) < ?' : '1 = 1';
    const joinedCondition = beforeIso ? 'COALESCE(c.last_message_at, c.created_at) < ?' : '1 = 1';
    const params = beforeIso ? [beforeIso] : [];
    const clean = this.raw.transaction(() => {
      const deletedMessages = this.raw
        .prepare(
          `DELETE FROM message
           WHERE thread_id IN (
             SELECT th.id
             FROM conversation c
             INNER JOIN task t ON t.id = c.task_id
             INNER JOIN thread th ON th.task_id = t.id
             WHERE ${joinedCondition}
           )`,
        )
        .run(...params).changes;
      this.raw
        .prepare(
          `DELETE FROM conversation_plan_revision
           WHERE plan_id IN (
             SELECT id FROM conversation_plan
             WHERE conversation_id IN (SELECT id FROM conversation WHERE ${condition})
           )`,
        )
        .run(...params);
      this.raw
        .prepare(
          `DELETE FROM conversation_plan
           WHERE conversation_id IN (SELECT id FROM conversation WHERE ${condition})`,
        )
        .run(...params);
      const deletedConversations = this.raw
        .prepare(`DELETE FROM conversation WHERE ${condition}`)
        .run(...params).changes;
      return { deletedConversations, deletedMessages };
    });
    const result = clean.immediate();
    return Promise.resolve({ success: true, ...result });
  }

  async cleanEmptyAttachmentDirectories(): Promise<DataCleanEmptyAttachmentDirectoriesResponse> {
    let removedConversationDirs = 0;
    for (const name of ATTACHMENT_ROOT_NAMES) {
      removedConversationDirs += await this.removeEmptyDescendants(join(this.dataRoot, name), true);
    }
    return { success: true, removedConversationDirs };
  }

  private deleteConversationRecord(conversationId: string): void {
    const existing = this.raw
      .prepare(
        `SELECT c.id, th.id AS threadId
         FROM conversation c
         LEFT JOIN task t ON t.id = c.task_id
         LEFT JOIN thread th ON th.task_id = t.id
         WHERE c.id = ?`,
      )
      .get(conversationId) as { id: string; threadId: string | null } | undefined;
    if (!existing) return;
    if (existing.threadId) {
      this.raw.prepare('DELETE FROM message WHERE thread_id = ?').run(existing.threadId);
    }
    this.raw
      .prepare(
        `DELETE FROM conversation_plan_revision
         WHERE plan_id IN (SELECT id FROM conversation_plan WHERE conversation_id = ?)`,
      )
      .run(conversationId);
    this.raw.prepare('DELETE FROM conversation_plan WHERE conversation_id = ?').run(conversationId);
    this.raw.prepare('DELETE FROM conversation WHERE id = ?').run(conversationId);
  }

  private async removeEmptyDescendants(directory: string, isRoot: boolean): Promise<number> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return 0;
    }
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      removed += await this.removeEmptyDescendants(join(directory, entry.name), false);
    }
    if (isRoot) return removed;
    const remaining = await readdir(directory).catch(() => ['missing']);
    if (remaining.length === 0) {
      await rmdir(directory);
      removed += 1;
    }
    return removed;
  }
}
