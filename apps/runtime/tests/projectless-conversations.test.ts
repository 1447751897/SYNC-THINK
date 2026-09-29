import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { decodeFrames, type Frame } from '@sync-think/protocol';
import type { ScheduledTask, ThreadId, MessageId, ModelId } from '@sync-think/shared';
import type {
  SqliteConversationStore,
  SqliteWorkspaceStore,
  SqliteAppSettingStore,
  SqliteScheduledTaskStore,
} from '@sync-think/storage';
import { openPersistentRuntime } from '../src/persistence.js';
import { PROJECTLESS_DIRECTORY_KEY, projectlessLocationKey } from '../src/projectless-storage.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-projectless-test-'));
  const session = await openPersistentRuntime({
    installId: 'projectless-' + Date.now() + Math.random().toString(36).slice(2),
    dbPath: join(dir, 'db.sqlite'),
    secureStoreKeyPath: join(dir, 'key'),
    allowNoToken: true,
  });
  const runtime = session.runtime as unknown as {
    handlers: { onFrame(socket: { write(data: Buffer): boolean }, frame: Frame): void };
    conversationStore: SqliteConversationStore;
    workspaceStore: SqliteWorkspaceStore;
    appSettingStore: SqliteAppSettingStore;
    scheduledTaskStore: SqliteScheduledTaskStore;
    resolveChatWorkspaceRoot(threadId: string): string | undefined;
    getOrCreateTaskConversation(task: ScheduledTask, now: Date): Promise<string>;
    persistFinalChatMessage(input: {
      id: MessageId;
      threadId: ThreadId;
      role: 'user' | 'assistant';
      text: string;
    }): unknown;
  };
  let sequence = 0;
  const request = (type: string, payload: unknown): Promise<Frame> =>
    new Promise((resolve, reject) => {
      const id = 'req-' + ++sequence;
      const timeout = setTimeout(() => reject(new Error('RPC timeout: ' + type)), 5000);
      runtime.handlers.onFrame(
        {
          write(data) {
            for (const frame of decodeFrames(data).frames)
              if (frame.kind === 'response' && frame.id === id) {
                clearTimeout(timeout);
                resolve(frame);
              }
            return true;
          },
        },
        { id, kind: 'request', type, payload: payload as Frame['payload'] },
      );
    });
  const close = async () => {
    await session.close();
    const target = resolve(dir);
    if (!target.startsWith(resolve(tmpdir()) + '/') && !target.startsWith(resolve(tmpdir()) + '\\'))
      throw new Error('Unexpected fixture directory');
    rmSync(target, { recursive: true, force: true });
  };
  cleanup.push(close);
  return { dir, runtime, request };
}

describe('projectless conversations', () => {
  it('uses the configured directory for new conversations and pins existing conversations to their original directory', async () => {
    const f = await fixture();
    const initial = await f.request('settings.get', { keys: [PROJECTLESS_DIRECTORY_KEY] });
    expect(
      (initial.payload as { settings: Record<string, unknown> }).settings[
        PROJECTLESS_DIRECTORY_KEY
      ],
    ).toBe(join(f.dir, 'projectless'));
    const root = join(f.dir, 'custom data');
    expect(
      (await f.request('settings.set', { key: PROJECTLESS_DIRECTORY_KEY, value: root })).error,
    ).toBeUndefined();
    const created = await f.request('conversation.create', {
      track: 'model',
      targetRef: 'fixture-model',
      title: '无工作区对话',
    });
    expect(created.error).toBeUndefined();
    const conversation = (created.payload as { conversation: { id: string; workspaceId?: string } })
      .conversation;
    expect(conversation.workspaceId).toBeUndefined();
    const directory = join(root, 'conversations', conversation.id);
    expect(existsSync(join(directory, 'files'))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(directory, 'conversation.json'), 'utf8')).workspaceId,
    ).toBeNull();
    const internal = f.runtime.workspaceStore.createWorkspace({ name: '__inbox__' });
    const task = f.runtime.workspaceStore.createTask({
      workspaceId: internal.id,
      title: '对话',
      goal: 'test',
    });
    f.runtime.conversationStore.bindTask(conversation.id, task.taskId);
    expect(f.runtime.resolveChatWorkspaceRoot(task.threadId)).toBe(join(directory, 'files'));
    f.runtime.persistFinalChatMessage({
      id: 'message-1' as MessageId,
      threadId: task.threadId,
      role: 'user',
      text: '保存这条消息',
    });
    expect(
      JSON.parse(readFileSync(join(directory, 'messages', 'message-1.json'), 'utf8')).blocks,
    ).toContainEqual({ type: 'text', text: '保存这条消息' });
    writeFileSync(join(directory, 'files', 'note.txt'), 'kept');
    const next = join(f.dir, 'next');
    await f.request('settings.set', { key: PROJECTLESS_DIRECTORY_KEY, value: next });
    expect(f.runtime.resolveChatWorkspaceRoot(task.threadId)).toBe(join(directory, 'files'));
    expect(readFileSync(join(directory, 'files', 'note.txt'), 'utf8')).toBe('kept');
    const second = await f.request('conversation.create', {
      track: 'model',
      targetRef: 'fixture-model',
    });
    const secondId = (second.payload as { conversation: { id: string } }).conversation.id;
    expect(f.runtime.appSettingStore.get(projectlessLocationKey(secondId))?.value).toBe(
      join(next, 'conversations', secondId),
    );
  });

  it('rejects invalid directory settings without replacing the saved value', async () => {
    const f = await fixture();
    const root = join(f.dir, 'chosen');
    await f.request('settings.set', { key: PROJECTLESS_DIRECTORY_KEY, value: root });
    const file = join(f.dir, 'not-a-directory');
    writeFileSync(file, 'content');
    for (const value of ['', '../relative', file, 42]) {
      expect(
        (await f.request('settings.set', { key: PROJECTLESS_DIRECTORY_KEY, value })).error,
      ).toBeDefined();
      expect(f.runtime.appSettingStore.get(PROJECTLESS_DIRECTORY_KEY)?.value).toBe(root);
    }
  });

  it('routes global scheduled tasks and legacy inbox conversations to isolated directories while preserving real workspace roots', async () => {
    const f = await fixture();
    const response = await f.request('scheduledTask.create', {
      name: '每日摘要',
      instruction: '整理今日摘要',
      target: { kind: 'model', modelId: 'fixture-model' },
      rule: { kind: 'every', intervalMinutes: 1440 },
      enabled: false,
    });
    expect(response.error).toBeUndefined();
    const scheduled = (response.payload as { task: ScheduledTask }).task;
    const id = await f.runtime.getOrCreateTaskConversation(scheduled, new Date());
    const conversation = f.runtime.conversationStore.get(id)!;
    expect(conversation.workspaceId).toBeUndefined();
    const task = f.runtime.workspaceStore.getTask(conversation.taskId!)!;
    expect(f.runtime.resolveChatWorkspaceRoot(task.threadId)).toBe(
      join(f.dir, 'projectless', 'conversations', id, 'files'),
    );
    expect(
      await f.runtime.getOrCreateTaskConversation(
        f.runtime.scheduledTaskStore.get(scheduled.id)!,
        new Date(),
      ),
    ).toBe(id);
    const inbox = f.runtime.workspaceStore.getWorkspace(task.workspaceId)!;
    const legacy = f.runtime.conversationStore.create({
      workspaceId: inbox.id,
      target: { track: 'model', modelId: 'fixture-model' as ModelId },
    });
    const backing = f.runtime.workspaceStore.createTask({
      workspaceId: inbox.id,
      title: '旧对话',
      goal: 'legacy',
    });
    f.runtime.conversationStore.bindTask(legacy.id, backing.taskId);
    expect(f.runtime.resolveChatWorkspaceRoot(backing.threadId)).toBe(
      join(f.dir, 'projectless', 'conversations', legacy.id, 'files'),
    );
    const folder = join(f.dir, 'repository');
    mkdirSync(folder);
    const workspace = f.runtime.workspaceStore.createWorkspace({
      name: '项目',
      folderPath: folder,
    });
    const bound = f.runtime.conversationStore.create({
      workspaceId: workspace.id,
      target: { track: 'model', modelId: 'fixture-model' as ModelId },
    });
    const boundTask = f.runtime.workspaceStore.createTask({
      workspaceId: workspace.id,
      title: '项目对话',
      goal: 'bound',
    });
    f.runtime.conversationStore.bindTask(bound.id, boundTask.taskId);
    expect(f.runtime.resolveChatWorkspaceRoot(boundTask.threadId)).toBe(folder);
    expect(f.runtime.appSettingStore.get(projectlessLocationKey(bound.id))).toBeUndefined();
    const movedToProject = f.runtime.scheduledTaskStore.update(scheduled.id, { workspaceId: workspace.id })!;
    const projectConversationId = await f.runtime.getOrCreateTaskConversation(movedToProject, new Date());
    expect(f.runtime.conversationStore.get(projectConversationId)?.workspaceId).toBe(workspace.id);
    const movedToGlobal = f.runtime.scheduledTaskStore.update(scheduled.id, { workspaceId: null })!;
    const globalConversationId = await f.runtime.getOrCreateTaskConversation(movedToGlobal, new Date());
    expect(f.runtime.conversationStore.get(globalConversationId)?.workspaceId).toBeUndefined();
    expect(globalConversationId).not.toBe(projectConversationId);
    expect(f.runtime.conversationStore.get(projectConversationId)).toBeDefined();
  });
});
