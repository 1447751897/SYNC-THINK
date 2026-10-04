import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeProvider, type AdapterEvent, type ProviderCallRequest } from '@sync-think/adapters';
import { decodeFrames, type Frame } from '@sync-think/protocol';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteMessageStore,
  SqliteEventCheckpointStore,
  SqliteWorkspaceStore,
  SqliteUnitOfWork,
} from '@sync-think/storage';
import type { EventId, MessageId, ModelId, WorkspaceId } from '@sync-think/shared';
import { collectThreadChatHistory } from './chat-tools.js';
import { Runtime } from './runtime.js';
import { ConversationCompactBoundaryCache } from './conversation-compact-boundary-cache.js';
import { buildProviderMessagesFromDurableMessages } from './context-message-history.js';

const summary = [
  '## Primary Request and Intent\n- 原约束：主角林舟，不发送邮件。',
  '## Key Technical Concepts\n- (none)',
  '## Files and Code\n- story.md',
  '## Errors and Fixes\n- (none)',
  '## Pending Jobs\n- 完成终稿',
  '## Current Work\n- 写作中',
  '## Next Step\n- 继续用户最新要求',
  '## Critical Context\n- 保留证据与硬约束。',
].join('\n');
class CompactProvider extends FakeProvider {
  calls: ProviderCallRequest[] = [];
  failure = false;
  beforeSummary?: () => unknown;
  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push(
      structuredClone({ ...request, signal: undefined }) as unknown as ProviderCallRequest,
    );
    await this.beforeSummary?.();
    if (this.failure) {
      yield { type: 'error', failureClass: 'transient', message: 'fixture model interrupted' };
      return;
    }
    yield { type: 'text-delta', text: summary };
    yield { type: 'usage', tokensIn: 1000, tokensOut: 100 };
    yield { type: 'finished', reason: 'stop' };
  }
}
async function fixture(options: { legacy?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sync-think-compaction-rpc-')));
  const path = join(root, 'test.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  const workspaces = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaces.createWorkspace({
    id: 'compact-workspace' as WorkspaceId,
    name: 'isolated compact',
  });
  const task = workspaces.createTask({
    workspaceId: workspace.id,
    title: 'compaction probe',
    goal: 'retain exact raw tail',
  });
  const conversations = new SqliteConversationStore(connection.raw);
  const conversation = conversations.create({
    target: { track: 'model', modelId: 'fake-mini' as ModelId },
    workspaceId: workspace.id,
  });
  conversations.bindTask(conversation.id, task.taskId);
  const messages = new SqliteMessageStore(connection.raw);
  const events = new SqliteEventCheckpointStore(connection.raw);
  const at = '2026-10-02T00:00:00.000Z';
  for (let index = 0; index < 12; index++)
    messages.appendMessage({
      id: ('compact-message-' + index) as MessageId,
      threadId: task.threadId,
      sequence: index,
      role: index % 2 ? 'assistant' : 'user',
      createdAt: at,
      blocks: [{ type: 'text', text: 'turn-' + index + ' ' + 'x'.repeat(8000) }],
    });
  if (options.legacy) {
    for (let index = 0; index < 12; index++)
      events.commitTransition({
        events: [
          {
            id: ('legacy-event-' + index) as EventId,
            workspaceId: workspace.id,
            taskId: task.taskId,
            category: 'message',
            type: 'message.appended',
            occurredAt: at,
            payload: {
              threadId: task.threadId,
              role: index % 2 ? 'assistant' : 'user',
              text: 'turn-' + index + ' ' + 'x'.repeat(8000),
            },
          },
        ],
      });
  }
  const provider = new CompactProvider();
  const runtimeOptions: ConstructorParameters<typeof Runtime>[0] = {
    installId: basename(root),
    allowNoToken: true,
    projectlessDataDirectory: join(root, 'projectless'),
    workspaceStore: workspaces,
    conversationStore: conversations,
    messageStore: options.legacy ? undefined : messages,
    stateStore: events,
    demoProvider: provider,
    unitOfWork: new SqliteUnitOfWork(connection.raw),
  };
  const runtime = new Runtime(runtimeOptions);
  let count = 0;
  const rpc = (type: string, payload: unknown): Promise<Frame> =>
    new Promise((resolve, reject) => {
      const id = 'compact-rpc-' + ++count;
      const timeout = setTimeout(() => reject(new Error('Fixture RPC timeout: ' + type)), 5000);
      try {
        (
          runtime as unknown as {
            handlers: { onFrame(socket: { write(buffer: Buffer): boolean }, frame: Frame): void };
          }
        ).handlers.onFrame(
          {
            write(buffer) {
              for (const frame of decodeFrames(buffer).frames)
                if (frame.kind === 'response' && frame.id === id) {
                  clearTimeout(timeout);
                  resolve(frame);
                }
              return true;
            },
          },
          { id, kind: 'request', type, payload },
        );
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  const replay = () =>
    new ConversationCompactBoundaryCache({
      loadEvents: () => events.listEventsByTask(task.taskId),
    }).get(String(task.threadId));
  const close = async () => {
    await runtime.stop();
    connection.raw.close();
    const resolved = realpathSync(root);
    if (
      dirname(resolved) !== realpathSync(tmpdir()) ||
      !basename(resolved).startsWith('sync-think-compaction-rpc-')
    )
      throw new Error('Unexpected fixture cleanup path');
    rmSync(resolved, { recursive: true, force: true });
  };
  return {
    rpc,
    conversation,
    task,
    messages,
    provider,
    events,
    replay,
    close,
    runtime,
    runtimeOptions,
  };
}
describe('durable compaction RPC', () => {
  it('persists an in-flight span, refuses a duplicate, and cancels without committing on shutdown', async () => {
    const f = await fixture();
    let release!: () => void;
    f.provider.beforeSummary = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    try {
      const pending = f.rpc('conversation.compact', {
        conversationId: f.conversation.id,
        keepRecent: 8,
      });
      while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
      const start = f.events
        .listEventsByTask(f.task.taskId)
        .find((event) => event.type === 'context.compaction_started')!;
      expect(start.payload).toMatchObject({
        coveredThroughMessageSequence: 3,
        modelId: 'fake-mini',
      });
      expect(start.payload.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
      const duplicate = await f.rpc('conversation.compact', {
        conversationId: f.conversation.id,
        keepRecent: 8,
      });
      expect(duplicate.error).toBeDefined();
      expect(f.provider.calls).toHaveLength(1);
      const stopped = f.runtime.stop();
      release();
      expect((await pending).error).toBeDefined();
      await stopped;
      expect(f.replay()).toBeUndefined();
      expect(f.messages.listMessages(f.task.threadId, { limit: 100 }).messages).toHaveLength(12);
    } finally {
      release?.();
      await f.close();
    }
  });
  it('recovers an interrupted summary as a visible failure without silently rebilling it', async () => {
    const f = await fixture();
    let restarted: Runtime | undefined;
    try {
      f.events.commitTransition({
        events: [
          {
            id: 'orphan-summary' as EventId,
            workspaceId: 'compact-workspace' as WorkspaceId,
            taskId: f.task.taskId,
            category: 'context',
            type: 'context.compaction_started',
            occurredAt: '2026-10-02T00:00:00.000Z',
            payload: {
              threadId: f.task.threadId,
              conversationId: f.conversation.id,
              taskId: f.task.taskId,
              operationId: 'orphan',
              ownerId: f.runtimeOptions.installId + ':old-instance',
              leaseExpiresAt: Date.now() + 90000,
              modelBinding: 'route',
              sourceFingerprint: 'a'.repeat(64),
              boundaryFingerprint: 'b'.repeat(64),
              coveredThroughMessageSequence: 3,
            },
          },
        ],
      });
      await f.runtime.stop();
      restarted = new Runtime(f.runtimeOptions);
      await restarted.start();
      expect(
        f.events
          .listEventsByTask(f.task.taskId)
          .filter((event) => event.type === 'context.compaction_failed')
          .map((event) => event.payload),
      ).toContainEqual(
        expect.objectContaining({
          operationId: 'orphan',
          reason: 'runtime-restarted',
          originalHistoryPreserved: true,
        }),
      );
      expect(f.provider.calls).toHaveLength(0);
      expect(f.replay()).toBeUndefined();
    } finally {
      await restarted?.stop();
      await f.close();
    }
  });
  it('persists exact coverage, replays the raw tail, merges the old checkpoint and bills summaries separately', async () => {
    const f = await fixture();
    try {
      const first = await f.rpc('conversation.compact', {
        conversationId: f.conversation.id,
        mode: 'manual',
        keepRecent: 8,
      });
      expect(first.error).toBeUndefined();
      expect(first.payload).toMatchObject({ compacted: true, foldedCount: 4, mode: 'manual' });
      const boundary = f.replay()!;
      expect(boundary.coveredThroughMessageSequence).toBe(3);
      const raw = f.messages.listMessages(f.task.threadId, { limit: 100 }).messages;
      const request = buildProviderMessagesFromDurableMessages({
        messages: raw,
        compact: boundary,
        currentUserText: 'continue',
      });
      expect(
        request.messages.slice(0, 8).map((message) => String(message.content).split(' ')[0]),
      ).toEqual(['turn-4', 'turn-5', 'turn-6', 'turn-7', 'turn-8', 'turn-9', 'turn-10', 'turn-11']);
      expect(raw.filter((message) => message.role !== 'system')).toHaveLength(12);
      const second = await f.rpc('conversation.compact', {
        conversationId: f.conversation.id,
        mode: 'manual',
        keepRecent: 4,
      });
      expect(second.error).toBeUndefined();
      expect(second.payload).toMatchObject({ compacted: true });
      expect(JSON.stringify(f.provider.calls[1]?.messages)).toContain('原约束：主角林舟');
      expect(f.replay()?.coveredThroughMessageSequence).toBe(7);
      expect(
        f.events.listAllEvents(0).filter((event) => event.type === 'provider.usage'),
      ).toHaveLength(2);
      expect(
        f.events
          .listAllEvents(0)
          .filter((event) => event.type === 'provider.usage')
          .every((event) => event.payload.purpose === 'compaction'),
      ).toBe(true);
      const status = await f.rpc('conversation.getContextStatus', {
        conversationId: f.conversation.id,
      });
      expect(status.error).toBeUndefined();
      expect(status.payload).toMatchObject({ compactThreshold: 0.85 });
    } finally {
      await f.close();
    }
  });
  it('does not commit a partial local summary when the model fails', async () => {
    const f = await fixture();
    try {
      f.provider.failure = true;
      const response = await f.rpc('conversation.compact', {
        conversationId: f.conversation.id,
        mode: 'manual',
        keepRecent: 8,
      });
      expect(response.error).toBeDefined();
      expect(f.replay()).toBeUndefined();
      expect(f.messages.listMessages(f.task.threadId, { limit: 100 }).messages).toHaveLength(12);
      expect(
        f.events.listAllEvents(0).some((event) => event.type === 'context.compaction_failed'),
      ).toBe(true);
    } finally {
      await f.close();
    }
  });
  it('preserves a message added during summary generation, including an older wall-clock timestamp', async () => {
    const f = await fixture();
    try {
      f.provider.beforeSummary = () =>
        f.messages.appendMessage({
          id: 'arriving-message' as MessageId,
          threadId: f.task.threadId,
          sequence: 12,
          role: 'user',
          createdAt: '2025-01-01T00:00:00.000Z',
          blocks: [{ type: 'text', text: 'added during compaction' }],
        });
      const response = await f.rpc('conversation.compact', {
        conversationId: f.conversation.id,
        mode: 'manual',
        keepRecent: 8,
      });
      expect(response.error).toBeUndefined();
      const request = buildProviderMessagesFromDurableMessages({
        messages: f.messages.listMessages(f.task.threadId, { limit: 100 }).messages,
        compact: f.replay(),
        currentUserText: '',
      });
      expect(request.messages.at(-1)?.content).toBe('added during compaction');
    } finally {
      await f.close();
    }
  });
  it('rejects the checkpoint when selected durable content is edited during the model call', async () => {
    const f = await fixture();
    try {
      f.provider.beforeSummary = () =>
        f.messages.updateBlocks('compact-message-0' as MessageId, [
          { type: 'text', text: 'edited constraint' },
        ]);
      const response = await f.rpc('conversation.compact', {
        conversationId: f.conversation.id,
        mode: 'manual',
        keepRecent: 8,
      });
      expect(response.error?.message).toContain('所选历史已变化');
      expect(f.replay()).toBeUndefined();
      expect(f.messages.getMessage('compact-message-0' as MessageId)?.blocks[0]?.text).toBe(
        'edited constraint',
      );
    } finally {
      await f.close();
    }
  });
});

it('retains the exact recent event tail when canonical message storage is absent', async () => {
  const f = await fixture({ legacy: true });
  try {
    const response = await f.rpc('conversation.compact', {
      conversationId: f.conversation.id,
      mode: 'manual',
      keepRecent: 8,
    });
    expect(response.error).toBeUndefined();
    expect(response.payload).toMatchObject({ compacted: true });
    expect(f.replay()?.coveredEventSequences).toEqual([1, 2, 3, 4]);
    const history = collectThreadChatHistory(f.events.listAllEvents(0), String(f.task.threadId));
    expect(
      history.messages
        .filter((message) => !message.checkpoint)
        .map((message) => message.content.split(' ')[0]),
    ).toEqual(['turn-4', 'turn-5', 'turn-6', 'turn-7', 'turn-8', 'turn-9', 'turn-10', 'turn-11']);
  } finally {
    await f.close();
  }
});

it('does not pay for summarizing only the existing checkpoint when no new prefix is eligible', async () => {
  const f = await fixture();
  try {
    const first = await f.rpc('conversation.compact', {
      conversationId: f.conversation.id,
      mode: 'manual',
      keepRecent: 8,
    });
    expect(first.error).toBeUndefined();
    expect(first.payload).toMatchObject({ compacted: true, foldedCount: 4 });
    const repeat = await f.rpc('conversation.compact', {
      conversationId: f.conversation.id,
      mode: 'manual',
      keepRecent: 8,
    });
    expect(repeat.error).toBeUndefined();
    expect(repeat.payload).toMatchObject({ compacted: false, foldedCount: 0 });
    expect(f.provider.calls).toHaveLength(1);
    expect(f.replay()?.coveredThroughMessageSequence).toBe(3);
  } finally {
    await f.close();
  }
});
