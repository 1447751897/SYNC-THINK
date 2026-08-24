import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationId, Message, MessageId, ModelId, WorkspaceId } from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteMessageStore,
  SqliteWorkspaceStore,
  type BetterSQLite3Raw,
} from '@sync-think/storage';
import { RuntimeDataManagementService } from './data-management-service.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface DataFixture {
  root: string;
  databasePath: string;
  raw: BetterSQLite3Raw;
  service: RuntimeDataManagementService;
  close(): void;
}

async function createFixture(): Promise<DataFixture> {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-data-management-'));
  tempDirectories.push(root);
  const databasePath = join(root, 'sync-think.db');
  await runMigrations(databasePath);
  const connection = await openDatabaseAsync({ path: databasePath });
  return {
    root,
    databasePath,
    raw: connection.raw,
    service: new RuntimeDataManagementService({
      raw: connection.raw,
      databasePath,
      dataRoot: root,
    }),
    close: () => connection.raw.close(),
  };
}

function addConversation(
  fixture: DataFixture,
  input: {
    suffix: string;
    workspaceId?: string;
    createdAt: string;
    text: string;
  },
): { workspaceId: string; conversationId: ConversationId } {
  const workspaces = new SqliteWorkspaceStore(fixture.raw);
  const workspace = input.workspaceId
    ? workspaces.getWorkspace(input.workspaceId as WorkspaceId)
    : workspaces.createWorkspace({
        id: `workspace-${input.suffix}` as never,
        name: `Workspace ${input.suffix}`,
        now: input.createdAt,
      });
  if (!workspace) throw new Error('workspace fixture missing');
  const task = workspaces.createTask({
    id: `task-${input.suffix}` as never,
    threadId: `thread-${input.suffix}` as never,
    workspaceId: workspace.id,
    title: `Conversation ${input.suffix}`,
    goal: `Conversation ${input.suffix}`,
    now: input.createdAt,
  });
  const conversations = new SqliteConversationStore(fixture.raw);
  const conversation = conversations.create({
    id: `conversation-${input.suffix}` as ConversationId,
    target: { track: 'model', modelId: 'model-fixture' as ModelId },
    workspaceId: workspace.id,
    title: `Conversation ${input.suffix}`,
    now: input.createdAt,
  });
  conversations.bindTask(conversation.id, task.taskId, input.createdAt);
  const message: Message = {
    id: `message-${input.suffix}` as MessageId,
    threadId: task.threadId,
    role: 'user',
    blocks: [{ type: 'text', text: input.text }],
    sequence: 0,
    createdAt: input.createdAt,
  };
  new SqliteMessageStore(fixture.raw).appendMessage(message);
  return { workspaceId: workspace.id, conversationId: conversation.id };
}

describe('RuntimeDataManagementService', () => {
  it('reports live database, conversation, message and conversation-file storage totals', async () => {
    const fixture = await createFixture();
    try {
      addConversation(fixture, {
        suffix: 'stats',
        createdAt: '2026-01-01T00:00:00.000Z',
        text: 'hello stats',
      });
      const attachmentDirectory = join(fixture.root, 'message-images', 'conversation-stats');
      mkdirSync(attachmentDirectory, { recursive: true });
      writeFileSync(join(attachmentDirectory, 'image.bin'), Buffer.alloc(37));

      const result = await fixture.service.getStorageStats();

      expect(result.success).toBe(true);
      expect(result.dataDirectory).toBe(fixture.root);
      expect(result.dbSizeBytes).toBeGreaterThan(0);
      expect(result.conversationFilesSizeBytes).toBe(37);
      expect(result.conversationCount).toBe(1);
      expect(result.messageCount).toBe(1);
    } finally {
      fixture.close();
    }
  });

  it('exports workspace conversations to JSON and imports them with explicit conflict behavior', async () => {
    const source = await createFixture();
    const target = await createFixture();
    try {
      const first = addConversation(source, {
        suffix: 'export-a',
        createdAt: '2026-02-01T00:00:00.000Z',
        text: 'first exported message',
      });
      addConversation(source, {
        suffix: 'export-b',
        workspaceId: first.workspaceId,
        createdAt: '2026-02-02T00:00:00.000Z',
        text: 'second exported message',
      });
      const exportPath = join(source.root, 'sync-think-export.json');

      const exported = await source.service.exportData({ filePath: exportPath });
      expect(exported).toMatchObject({
        success: true,
        count: { workspaces: 1, conversations: 2, messages: 2 },
      });
      const document = JSON.parse(readFileSync(exportPath, 'utf8')) as {
        format: string;
        version: number;
        conversations: Array<{ messages: Array<{ blocks: unknown[] }> }>;
      };
      expect(document).toMatchObject({ format: 'sync-think-data-export', version: 1 });
      expect(document.conversations[0]?.messages[0]?.blocks).toEqual([
        { type: 'text', text: 'first exported message' },
      ]);

      const imported = await target.service.importData({
        filePath: exportPath,
        conflictStrategy: 'skip',
      });
      expect(imported).toMatchObject({
        success: true,
        imported: { workspaces: 1, conversations: 2, messages: 2 },
        skipped: 0,
      });
      await expect(target.service.getStorageStats()).resolves.toMatchObject({
        conversationCount: 2,
        messageCount: 2,
      });

      const duplicate = await target.service.importData({
        filePath: exportPath,
        conflictStrategy: 'skip',
      });
      expect(duplicate).toMatchObject({
        success: true,
        imported: { workspaces: 0, conversations: 0, messages: 0 },
        skipped: 3,
      });
      await expect(target.service.getStorageStats()).resolves.toMatchObject({
        conversationCount: 2,
        messageCount: 2,
      });
    } finally {
      source.close();
      target.close();
    }
  });

  it('creates a consistent online SQLite backup that includes committed WAL rows', async () => {
    const fixture = await createFixture();
    try {
      addConversation(fixture, {
        suffix: 'backup',
        createdAt: '2026-03-01T00:00:00.000Z',
        text: 'backup me',
      });
      const backupDirectory = join(fixture.root, 'manual-backups');

      const result = await fixture.service.backup({
        targetDirectory: backupDirectory,
        now: new Date('2026-03-04T05:06:07.000Z'),
      });

      expect(result.success).toBe(true);
      expect(result.backupPath).toBe(
        join(backupDirectory, 'sync-think-backup-2026-03-04T05-06-07-000Z.db'),
      );
      expect(existsSync(result.backupPath)).toBe(true);
      expect(result.sizeBytes).toBeGreaterThan(0);
      const backup = await openDatabaseAsync({
        path: result.backupPath,
        readonly: true,
        fileMustExist: true,
      });
      try {
        const row = backup.raw.prepare('SELECT COUNT(*) AS count FROM conversation').get() as {
          count: number;
        };
        expect(row.count).toBe(1);
      } finally {
        backup.raw.close();
      }
    } finally {
      fixture.close();
    }
  });

  it('cleans only conversations before the selected timestamp and removes their messages', async () => {
    const fixture = await createFixture();
    try {
      addConversation(fixture, {
        suffix: 'old',
        createdAt: '2025-01-01T00:00:00.000Z',
        text: 'old message',
      });
      addConversation(fixture, {
        suffix: 'new',
        createdAt: '2026-07-01T00:00:00.000Z',
        text: 'new message',
      });

      const result = await fixture.service.cleanConversations({
        beforeTimestamp: Date.parse('2026-01-01T00:00:00.000Z'),
      });

      expect(result).toMatchObject({
        success: true,
        deletedConversations: 1,
        deletedMessages: 1,
      });
      expect(
        new SqliteConversationStore(fixture.raw)
          .list({ includeArchived: true })
          .map((item) => item.id),
      ).toEqual(['conversation-new']);
      const counts = await fixture.service.getStorageStats();
      expect(counts).toMatchObject({ conversationCount: 1, messageCount: 1 });
    } finally {
      fixture.close();
    }
  });

  it('removes only empty attachment directories under the governed data roots', async () => {
    const fixture = await createFixture();
    try {
      const emptyCurrent = join(fixture.root, 'message-images', 'empty-current');
      const emptyLegacy = join(fixture.root, 'chat-image-staging', 'empty-legacy', 'nested');
      const populated = join(fixture.root, 'message-images', 'populated');
      mkdirSync(emptyCurrent, { recursive: true });
      mkdirSync(emptyLegacy, { recursive: true });
      mkdirSync(populated, { recursive: true });
      writeFileSync(join(populated, 'keep.txt'), 'keep');

      const result = await fixture.service.cleanEmptyAttachmentDirectories();

      expect(result).toMatchObject({ success: true, removedConversationDirs: 3 });
      expect(existsSync(emptyCurrent)).toBe(false);
      expect(existsSync(join(fixture.root, 'chat-image-staging', 'empty-legacy'))).toBe(false);
      expect(existsSync(populated)).toBe(true);
    } finally {
      fixture.close();
    }
  });
});
