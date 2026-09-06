import { randomUUID } from 'node:crypto';
import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  type ConversationListMessagesResponse,
  type ConversationReadContentResponse,
  type Frame,
} from '@sync-think/protocol';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteAssistantTimelineStore,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteMessageStore,
  SqliteWorkspaceStore,
  type EventDraft,
} from '@sync-think/storage';
import type { ContentReference, DeferredContent, ModelId, RunId } from '@sync-think/shared';
import { createDemoRun } from '../src/demo-run.js';
import {
  Runtime,
  assistantTextFallbackMessageBlocks,
  assistantTimelineToMessageBlocks,
} from '../src/runtime.js';
import { ConversationHistoryReadService } from '../src/conversation-history-read-service.js';

async function client(installId: string) {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  let remaining = Buffer.alloc(0);
  let requestId = 0;
  const frames: Frame[] = [];
  const pending = new Map<string, (frame: Frame) => void>();
  socket.on('data', (data) => {
    const decoded = decodeFrames(Buffer.concat([remaining, data]));
    remaining = Buffer.from(decoded.remaining);
    for (const frame of decoded.frames) {
      frames.push(frame);
      const resolve = pending.get(frame.id);
      if (resolve) {
        pending.delete(frame.id);
        resolve(frame);
      }
    }
  });
  const request = (type: string, payload: Record<string, unknown>) =>
    new Promise<Frame>((resolve) => {
      const id = `content-request-${++requestId}`;
      pending.set(id, resolve);
      socket.write(encodeFrame({ id, type, kind: 'request', payload }));
    });
  await request('__hello', {
    protocolVersion: 2,
    appVersion: 'fixture',
    installId,
    nonce: 'content-fixture',
    features: ['conversation.readContent'],
  });
  return { socket, request, frames };
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-content-rpc-'));
  const databasePath = join(directory, 'content.db');
  const installId = `content-rpc-${randomUUID()}`;
  await runMigrations(databasePath);
  let connection = await openDatabaseAsync({ path: databasePath });
  let workspaces = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaces.createWorkspace({ name: 'Content RPC fixture' });
  const task = workspaces.createTask({
    workspaceId: workspace.id,
    title: 'Content fixture',
    goal: 'Read full results',
  });
  let conversations = new SqliteConversationStore(connection.raw);
  const conversation = conversations.create({
    workspaceId: workspace.id,
    title: 'Content fixture',
    target: { track: 'model', modelId: 'fixture' as ModelId },
  });
  conversations.bindTask(conversation.id, task.taskId);
  const otherTask = workspaces.createTask({
    workspaceId: workspace.id,
    title: 'Other task',
    goal: 'Scope isolation',
  });
  const otherConversation = conversations.create({
    workspaceId: workspace.id,
    title: 'Other fixture',
    target: { track: 'model', modelId: 'fixture' as ModelId },
  });
  conversations.bindTask(otherConversation.id, otherTask.taskId);
  let store = new SqliteEventCheckpointStore(connection.raw);
  let messages = new SqliteMessageStore(connection.raw);
  let timeline = new SqliteAssistantTimelineStore(connection.raw);
  let history = new ConversationHistoryReadService({ databasePath, store, messageStore: messages });
  const create = () =>
    new Runtime({
      installId,
      allowNoToken: true,
      stateStore: store,
      workspaceStore: workspaces,
      conversationStore: conversations,
      messageStore: messages,
      assistantTimelineStore: timeline,
      conversationHistory: history,
    });
  let runtime = create();
  let rpc: Awaited<ReturnType<typeof client>> | undefined;
  const runId = 'content-run' as RunId;
  const draft = (id: string, type: string, payload: Record<string, unknown>): EventDraft =>
    ({
      id,
      workspaceId: workspace.id,
      taskId: task.taskId,
      runId,
      category: type.startsWith('run.') ? 'run' : 'tool',
      type,
      occurredAt: '2026-09-05T14:00:00.000Z',
      payload: { threadId: task.threadId, ...payload },
    }) as unknown as EventDraft;
  return {
    workspace,
    task,
    conversation,
    otherConversation,
    runId,
    draft,
    get connection() {
      return connection;
    },
    get store() {
      return store;
    },
    get runtime() {
      return runtime;
    },
    get timeline() {
      return timeline;
    },
    get history() {
      return history;
    },
    get conversations() {
      return conversations;
    },
    async start() {
      await runtime.start();
      rpc = await client(installId);
      return rpc;
    },
    async restart() {
      rpc?.socket.destroy();
      await runtime.stop();
      connection.raw.close();
      connection = await openDatabaseAsync({ path: databasePath, fileMustExist: true });
      workspaces = new SqliteWorkspaceStore(connection.raw);
      conversations = new SqliteConversationStore(connection.raw);
      store = new SqliteEventCheckpointStore(connection.raw);
      messages = new SqliteMessageStore(connection.raw);
      timeline = new SqliteAssistantTimelineStore(connection.raw);
      history = new ConversationHistoryReadService({ databasePath, store, messageStore: messages });
      runtime = create();
      await runtime.start();
      rpc = await client(installId);
      return rpc;
    },
    async close() {
      rpc?.socket.destroy();
      await runtime.stop();
      connection.raw.close();
      const resolved = realpathSync(directory);
      if (
        lstatSync(directory).isSymbolicLink() ||
        dirname(resolved) !== realpathSync(tmpdir()) ||
        !basename(resolved).startsWith('sync-think-content-rpc-')
      )
        throw new Error('Unexpected RPC fixture cleanup path');
      rmSync(resolved, { recursive: true, force: true });
    },
  };
}

describe('full content over an actual Runtime pipe and readonly Worker', () => {
  it('delivers unknown oversized fields without skipping an event and reads the filtered source after restart', async () => {
    const test = await fixture();
    const detail = 'unknown vendor detail🙂'.repeat(60000);
    const payload = {
      toolName: 'custom_tool',
      toolCallId: 'custom-call',
      vendorDetail: detail,
      result: { ok: false, exitCode: 7 },
      run: {
        ...createDemoRun(test.runId, test.task.threadId, 'PRIVATE_RUN_INPUT', { modelId: 'model' }),
        assistantText: 'PRIVATE_RUN_BODY',
      },
    };
    test.store.commitTransition({
      events: [
        test.draft('started', 'run.started', {}),
        test.draft('unknown-large', 'tool.completed', payload),
      ],
    });
    try {
      let rpc = await test.start();
      const replay = await rpc.request('runtime.subscribeEvents', { afterCursor: 0 });
      const event = (replay.payload.replayedEvents as import('@sync-think/shared').Event[]).find(
        (entry) => entry.id === 'unknown-large',
      );
      expect(event).toBeDefined();
      expect(event!.payload).toMatchObject({
        toolName: 'custom_tool',
        toolCallId: 'custom-call',
        result: { ok: false, exitCode: 7 },
      });
      const reference = event!.displayPayloadRef!.reference;
      const live = test.store.commitTransition({
        events: [test.draft('unknown-live', 'tool.completed', payload)],
      }).events[0];
      (test.runtime as unknown as { publishEvent(event: typeof live): void }).publishEvent(live);
      await vi.waitFor(() =>
        expect(
          rpc.frames.some(
            (frame) =>
              frame.type === 'runtime.event' &&
              (frame.payload.event as { id?: string })?.id === 'unknown-live',
          ),
        ).toBe(true),
      );
      const firstResponse = await rpc.request('conversation.readContent', {
        conversationId: test.conversation.id,
        reference,
      });
      const first = (firstResponse.payload as unknown as ConversationReadContentResponse).content;
      expect(first.text).toContain('unknown vendor detail');
      const expected = JSON.stringify(
        {
          threadId: test.task.threadId,
          toolName: 'custom_tool',
          toolCallId: 'custom-call',
          vendorDetail: detail,
          result: { ok: false, exitCode: 7 },
          run: {
            runId: test.runId,
            threadId: test.task.threadId,
            modelId: 'model',
            providerModelId: 'model',
            agentVersionId: 'agent-default-conversation',
            resolutionSource: 'agentDefault',
          },
        },
        null,
        2,
      );
      expect(first.utf16Length).toBe(expected.length);
      const processResponse = await rpc.request('conversation.getRunProcess', {
        runId: test.runId,
        conversationId: test.conversation.id,
      });
      const processView = (
        processResponse.payload as unknown as import('@sync-think/protocol').ConversationGetRunProcessResponse
      ).process;
      expect(processView.steps[0]?.detailsRef?.utf16Length).toBe(first.utf16Length);
      expect(processView.steps[0]?.detailsRef?.utf8Bytes).toBe(first.utf8Bytes);
      const rejected = await rpc.request('conversation.readContent', {
        conversationId: test.otherConversation.id,
        reference,
      });
      expect(rejected.error?.message).toContain('content.not-found');
      test.store.commitTransition({
        events: [test.draft('unknown-finished', 'run.completed', {})],
      });
      rpc = await test.restart();
      const tail = await rpc.request('conversation.readContent', {
        conversationId: test.conversation.id,
        reference,
        offset: expected.length - 512,
        version: first.version,
      });
      expect(tail.error).toBeUndefined();
      expect((tail.payload as unknown as ConversationReadContentResponse).content.text).toBe(
        expected.slice(-512),
      );
    } finally {
      await test.close();
    }
  });
  it('rejects a conversation rebind while a file directory read is in flight', async () => {
    const test = await fixture();
    let finish!: (page: import('@sync-think/protocol').ConversationFileChangesPage) => void;
    const read = vi.spyOn(test.history, 'listFileChanges').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    try {
      const rpc = await test.start();
      const pending = rpc.request('conversation.listFileChanges', {
        conversationId: test.conversation.id,
        offset: 0,
      });
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      test.connection.raw
        .prepare('UPDATE conversation SET task_id = ? WHERE id = ?')
        .run(test.conversations.get(test.otherConversation.id)!.taskId, test.conversation.id);
      finish({ items: [], offset: 0, total: 0, version: 'a'.repeat(64) });
      expect((await pending).error?.message).toContain('content.scope-changed');
    } finally {
      read.mockRestore();
      await test.close();
    }
  });
  it('paginates the whole conversation with durable write order and restart-stable provenance', async () => {
    const test = await fixture();
    const secondRun = 'second-run' as RunId;
    const otherRun = 'unrelated-run' as RunId;
    const event = (id: string, runId: RunId, path: string, text: string) => ({
      ...test.draft(id, 'tool.completed', {
        toolName: 'write_file',
        toolCallId: id,
        arguments: { path, content: text },
        result: { created: true },
      }),
      runId,
    });
    test.store.commitTransition({
      events: [
        test.draft('first-start', 'run.started', {}),
        ...Array.from({ length: 65 }, (_, index) =>
          event('old-' + index, test.runId, 'old-' + index + '.txt', 'old content'),
        ),
        { ...test.draft('second-start', 'run.started', {}), runId: secondRun },
        ...Array.from({ length: 65 }, (_, index) =>
          event('new-' + index, secondRun, 'new-' + index + '.txt', 'new content'),
        ),
        event('second-shared', secondRun, 'shared.txt', 'second run'),
        event('late-first-write', test.runId, 'shared.txt', 'first run wrote last'),
        { ...test.draft('late-second-completed', 'run.completed', {}), runId: secondRun },
        {
          ...event('other-file', otherRun, 'secret.txt', 'other'),
          taskId: undefined,
          payload: {
            toolName: 'write_file',
            toolCallId: 'other-file',
            arguments: { path: 'secret.txt', content: 'other' },
          },
        },
      ],
    });
    try {
      let rpc = await test.start();
      const first = await rpc.request('conversation.listFileChanges', {
        conversationId: test.conversation.id,
        offset: 0,
      });
      expect(first.kind).toBe('response');
      const directory = first.payload as import('@sync-think/protocol').ConversationFileChangesPage;
      expect(directory.total).toBe(131);
      expect(directory.items).toHaveLength(40);
      const all = [...directory.items];
      rpc = await test.restart();
      for (let offset = directory.nextOffset; offset !== undefined;) {
        const response = await rpc.request('conversation.listFileChanges', {
          conversationId: test.conversation.id,
          offset,
          version: directory.version,
        });
        expect(response.kind).toBe('response');
        const page = response.payload as import('@sync-think/protocol').ConversationFileChangesPage;
        all.push(...page.items);
        offset = page.nextOffset;
      }
      expect(new Set(all.map((item) => item.path)).size).toBe(131);
      const shared = all.find((item) => item.path === 'shared.txt')!;
      expect(shared.runId).toBe(test.runId);
      expect(shared.contentRef?.reference.id).toBe('late-first-write');
      expect(shared.content).toBeUndefined();
      expect(all.some((item) => item.path === 'secret.txt')).toBe(false);
      const foreign = await rpc.request('conversation.listFileChanges', {
        conversationId: test.otherConversation.id,
        offset: 0,
        version: directory.version,
      });
      expect(foreign.error?.message).toContain('version-changed');
      test.store.commitTransition({
        events: [event('fresh-write', secondRun, 'fresh.txt', 'fresh')],
      });
      const stale = await rpc.request('conversation.listFileChanges', {
        conversationId: test.conversation.id,
        offset: 40,
        version: directory.version,
      });
      expect(stale.error?.message).toContain('version-changed');
      const refreshed = await rpc.request('conversation.listFileChanges', {
        conversationId: test.conversation.id,
        offset: 0,
      });
      expect(
        (refreshed.payload as import('@sync-think/protocol').ConversationFileChangesPage).total,
      ).toBe(132);
    } finally {
      await test.close();
    }
  });
  it('reads all process collections through bounded scoped pages across restart', async () => {
    const test = await fixture();
    test.store.commitTransition({
      events: [
        test.draft('started', 'run.started', {}),
        ...Array.from({ length: 120 }, (_, index) => [
          test.draft(`command-${index}`, 'tool.requested', {
            toolName: 'run_command',
            toolCallId: `command-call-${index}`,
            arguments: { command: `echo ${index}` },
          }),
          test.draft(
            `command-result-${index}`,
            index % 30 === 0 ? 'tool.failed' : 'tool.completed',
            {
              toolName: 'run_command',
              toolCallId: `command-call-${index}`,
              result: { ok: index % 30 !== 0 },
            },
          ),
          test.draft(`file-${index}`, 'tool.requested', {
            toolName: 'write_file',
            toolCallId: `file-call-${index}`,
            arguments: { path: `file-${index}.txt`, content: `new ${index}` },
          }),
          test.draft(`file-result-${index}`, 'tool.completed', {
            toolName: 'write_file',
            toolCallId: `file-call-${index}`,
            previousContent: `old ${index}`,
            result: { ok: true },
          }),
        ]).flat(),
      ],
    });
    try {
      let rpc = await test.start();
      const initial = await rpc.request('conversation.getRunProcess', { runId: test.runId });
      expect(initial.error).toBeUndefined();
      const first = initial.payload.process as import('@sync-think/protocol').RunProcessView;
      expect(first.pages?.steps.total).toBe(240);
      expect(first.pages?.fileChanges.total).toBe(120);
      expect(first.errorCount).toBe(4);
      const payload = {
        runId: test.runId,
        conversationId: test.conversation.id,
        page: { section: 'fileChanges', offset: 40, version: first.pages!.version },
      };
      const second = await rpc.request('conversation.getRunProcess', payload);
      expect(second.error).toBeUndefined();
      expect(
        (second.payload.process as import('@sync-think/protocol').RunProcessView).fileChanges[0]
          .path,
      ).toBe('file-40.txt');
      expect(
        (
          await rpc.request('conversation.getRunProcess', {
            ...payload,
            conversationId: test.otherConversation.id,
          })
        ).error?.message,
      ).toContain('content.not-found');
      expect(
        (
          await rpc.request('conversation.getRunProcess', {
            ...payload,
            page: { ...payload.page, limit: 41 },
          })
        ).error,
      ).toBeTruthy();
      rpc = await test.restart();
      const last = await rpc.request('conversation.getRunProcess', {
        ...payload,
        page: { ...payload.page, offset: 80 },
      });
      expect(last.error).toBeUndefined();
      const final = last.payload.process as import('@sync-think/protocol').RunProcessView;
      expect(final.fileChanges.at(-1)?.path).toBe('file-119.txt');
      expect(final.pages?.fileChanges.nextOffset).toBeUndefined();
      test.store.commitTransition({
        events: [
          test.draft('late', 'tool.requested', {
            toolCallId: 'late-call',
            toolName: 'run_command',
            arguments: { command: 'echo late' },
          }),
        ],
      });
      expect((await rpc.request('conversation.getRunProcess', payload)).error?.message).toContain(
        'history.version-changed',
      );
    } finally {
      await test.close();
    }
  });

  it('reads a bounded file-change process and versioned diff pages across a real Runtime restart', async () => {
    const test = await fixture();
    const beforeText = 'old'.repeat(400000);
    const afterText = 'new'.repeat(400000);
    test.store.commitTransition({
      events: [
        test.draft('started', 'run.started', {}),
        test.draft('file-request', 'tool.requested', {
          toolName: 'write_file',
          toolCallId: 'file-call',
          argumentsJson: JSON.stringify({ path: 'file.txt', content: afterText }),
        }),
        test.draft('file-complete', 'tool.completed', {
          toolName: 'write_file',
          toolCallId: 'file-call',
          previousContent: beforeText,
          result: { ok: true },
        }),
      ],
    });
    try {
      let rpc = await test.start();
      const process = await rpc.request('conversation.getRunProcess', { runId: test.runId });
      expect(process.error).toBeUndefined();
      const changes = (process.payload.process as import('@sync-think/protocol').RunProcessView)
        .fileChanges;
      expect(changes[0].content).toBeUndefined();
      expect(changes[0].previousContent).toBeUndefined();
      expect(changes[0].contentRef).toBeTruthy();
      expect(changes[0].previousContentRef).toBeTruthy();
      const payload = {
        conversationId: test.conversation.id,
        before: { reference: changes[0].previousContentRef!.reference },
        after: { reference: changes[0].contentRef!.reference },
        limit: 1,
      };
      const first = await rpc.request('conversation.readFileDiff', payload);
      expect(first.error).toBeUndefined();
      const diff = first.payload.diff as import('@sync-think/shared').FileDiffPage;
      expect(diff).toMatchObject({ nextOffset: 1, totalRows: 2, added: 1, removed: 1 });
      expect(diff.rows[0]).toMatchObject({ kind: 'del', truncated: true, oldOffset: 0 });
      expect(
        (
          await rpc.request('conversation.readFileDiff', {
            ...payload,
            conversationId: test.otherConversation.id,
          })
        ).error?.message,
      ).toContain('content.not-found');
      expect(
        (await rpc.request('conversation.readFileDiff', { ...payload, limit: 161 })).error,
      ).toBeTruthy();
      rpc = await test.restart();
      const next = await rpc.request('conversation.readFileDiff', {
        ...payload,
        offset: diff.nextOffset,
        version: diff.version,
      });
      expect(next.error).toBeUndefined();
      expect(
        (next.payload.diff as import('@sync-think/shared').FileDiffPage).rows[0],
      ).toMatchObject({ kind: 'add', text: afterText.slice(0, 512), truncated: true });
      const original = await rpc.request('conversation.readContent', {
        conversationId: test.conversation.id,
        reference: changes[0].contentRef!.reference,
        offset: afterText.length - 300,
        version: diff.afterVersion,
      });
      expect(original.error).toBeUndefined();
      expect((original.payload as unknown as ConversationReadContentResponse).content.text).toBe(
        afterText.slice(-300),
      );
    } finally {
      await test.close();
    }
  });
  it('delivers a formerly oversized event in replay and live delivery, then reads the exact original after restart', async () => {
    const test = await fixture();
    const output = '完整工具结果🙂\n'.repeat(160000);
    const events = test.store.commitTransition({
      events: [
        test.draft('started', 'run.started', {}),
        test.draft('large-output', 'tool.completed', {
          toolName: 'read_file',
          toolCallId: 'call-a',
          result: output,
        }),
      ],
    }).events;
    try {
      expect(events.find((event) => event.id === 'large-output')?.payload.result).toBe(output);
      let rpc = await test.start();
      const subscribed = await rpc.request('runtime.subscribeEvents', { afterCursor: 0 });
      expect(subscribed.error).toBeUndefined();
      const replayed = subscribed.payload.replayedEvents as typeof events;
      const reference = (
        replayed.find((event) => event.id === 'large-output')!.payload.resultRef as DeferredContent
      ).reference;
      expect(reference).toEqual({ source: 'event', id: 'large-output', path: ['result'] });
      const liveEvent = test.store.commitTransition({
        events: [
          test.draft('live-output', 'tool.completed', {
            toolName: 'read_file',
            toolCallId: 'call-b',
            result: output,
          }),
        ],
      }).events[0];
      (test.runtime as unknown as { publishEvent(event: typeof liveEvent): void }).publishEvent(
        liveEvent,
      );
      await vi.waitFor(() =>
        expect(
          rpc.frames.some(
            (frame) =>
              frame.type === 'runtime.event' &&
              (frame.payload.event as { id?: string })?.id === 'live-output',
          ),
        ).toBe(true),
      );
      const before = await rpc.request('conversation.readContent', {
        conversationId: test.conversation.id,
        reference,
      });
      expect(before.error).toBeUndefined();
      const first = (before.payload as unknown as ConversationReadContentResponse).content;
      expect(output.startsWith(first.text)).toBe(true);
      const rejected = await rpc.request('conversation.readContent', {
        conversationId: test.otherConversation.id,
        reference,
      });
      expect(rejected.error?.message).toContain('content.not-found');
      rpc = await test.restart();
      const tailOffset = output.length - 500;
      const tail = await rpc.request('conversation.readContent', {
        conversationId: test.conversation.id,
        reference,
        offset: tailOffset,
        version: first.version,
      });
      expect(tail.error).toBeUndefined();
      expect((tail.payload as unknown as ConversationReadContentResponse).content.text).toBe(
        output.slice(tailOffset),
      );
    } finally {
      await test.close();
    }
  });

  it('keeps a full page of supported large messages and an oversized timeline readable through small previews', async () => {
    const test = await fixture();
    const output = 'result '.repeat(200000);
    test.store.commitTransition({ events: [test.draft('started', 'run.started', {})] });
    test.timeline.upsertSegments(test.runId, [
      {
        id: 'segment-a',
        sequence: 1,
        value: {
          id: 'segment-a',
          sequence: 1,
          kind: 'tool',
          toolCallId: 'call-a',
          name: 'read_file',
          status: 'completed',
          output,
        },
      },
    ]);
    const messageOutput = output.slice(0, 220000);
    for (let sequence = 1; sequence <= 10; sequence += 1) {
      new SqliteMessageStore(test.connection.raw).append({
        id: `large-message-${sequence}` as never,
        threadId: test.task.threadId,
        runId: test.runId,
        role: 'assistant',
        sequence,
        blocks: [
          { type: 'tool-result', text: messageOutput },
          { type: 'text', text: 'Final answer stays complete' },
        ],
        createdAt: '2026-09-05T14:00:00Z',
      });
    }
    try {
      const rpc = await test.start();
      const page = await rpc.request('conversation.listMessages', {
        conversationId: test.conversation.id,
      });
      expect(page.error).toBeUndefined();
      expect((page.payload as unknown as ConversationListMessagesResponse).messages).toHaveLength(
        10,
      );
      const message = (page.payload as unknown as ConversationListMessagesResponse).messages[0];
      expect(message.blocks[0].text!.length).toBeLessThan(3000);
      expect(message.blocks[1].text).toBe('Final answer stays complete');
      const reference = message.blocks[0].contentRef!.reference;
      const detail = await rpc.request('conversation.readContent', {
        conversationId: test.conversation.id,
        reference,
        offset: messageOutput.length - 100,
      });
      expect((detail.payload as unknown as ConversationReadContentResponse).content.text).toBe(
        messageOutput.slice(-100),
      );
      const timeline = await rpc.request('conversation.listRunTimeline', { runId: test.runId });
      expect(timeline.error).toBeUndefined();
      const timelineRef = (timeline.payload.segments as Array<{ outputRef: DeferredContent }>)[0]
        .outputRef.reference;
      expect(timelineRef.source).toBe('timeline');
      const timelineDetail = await rpc.request('conversation.readContent', {
        conversationId: test.conversation.id,
        reference: timelineRef,
        offset: output.length - 100,
      });
      expect(
        (timelineDetail.payload as unknown as ConversationReadContentResponse).content.text,
      ).toBe(output.slice(-100));
    } finally {
      await test.close();
    }
  });

  it('rejects a conversation rebind while a content read is in flight', async () => {
    const test = await fixture();
    test.store.commitTransition({
      events: [
        test.draft('started', 'run.started', {}),
        test.draft('output', 'tool.completed', { result: 'exact' }),
      ],
    });
    const reference: ContentReference = { source: 'event', id: 'output', path: ['result'] };
    const original = test.history.readContent.bind(test.history);
    vi.spyOn(test.history, 'readContent').mockImplementation(async (...args) => {
      const content = await original(...args);
      const other = test.conversations.get(test.otherConversation.id)!;
      test.connection.raw
        .prepare('UPDATE conversation SET task_id = ? WHERE id = ?')
        .run(other.taskId!, test.conversation.id);
      return content;
    });
    try {
      const rpc = await test.start();
      const response = await rpc.request('conversation.readContent', {
        conversationId: test.conversation.id,
        reference,
      });
      expect(response.error?.message).toContain('content.scope-changed');
      expect(response.payload).not.toHaveProperty('content');
    } finally {
      await test.close();
    }
  });
});

it('keeps oversized prose readable in live frames, reconnect snapshots and durable messages after restart', async () => {
  const test = await fixture();
  const text = '完整回答🙂'.repeat(200000) + 'END_OF_PROSE';
  const segment = {
    id: 'prose-answer',
    sequence: 1,
    kind: 'text' as const,
    phase: 'final_answer' as const,
    status: 'completed' as const,
    text,
  };
  test.store.commitTransition({ events: [test.draft('prose-start', 'run.started', {})] });
  try {
    const rpc = await test.start();
    await rpc.request('conversation.subscribeTransientStream', { threadId: test.task.threadId });
    const internal = test.runtime as unknown as {
      publishTransientFrame(input: object): { streamSequence: number };
      updateTransientTextSnapshot(input: object): void;
      persistAssistantFinalMessage(
        runId: RunId,
        run: ReturnType<typeof createDemoRun>,
        payload: object,
      ): void;
    };
    const frame = internal.publishTransientFrame({
      threadId: test.task.threadId,
      runId: test.runId,
      kind: 'text',
      textDelta: text,
      assistantTimeline: [segment],
      occurredAt: '2026-09-05T00:00:00Z',
    });
    await vi.waitFor(() =>
      expect(rpc.frames.some((entry) => entry.type === 'conversation.transientFrame')).toBe(true),
    );
    const delivered = rpc.frames.find((entry) => entry.type === 'conversation.transientFrame')!;
    expect(Buffer.byteLength(JSON.stringify(delivered))).toBeLessThan(128 * 1024);
    expect(delivered.payload).toMatchObject({
      frame: {
        kind: 'process',
        assistantTimeline: [
          {
            id: segment.id,
            textRef: {
              reference: { source: 'timeline', id: segment.id, path: ['text'] },
              utf16Length: text.length,
            },
          },
        ],
      },
    });
    expect((delivered.payload as { frame: object }).frame).not.toHaveProperty('textDelta');
    internal.updateTransientTextSnapshot({
      threadId: test.task.threadId,
      runId: test.runId,
      streamSequence: frame.streamSequence,
      text,
      assistantTimeline: [segment],
      updatedAt: '2026-09-05T00:00:00Z',
    });
    const reconnect = await rpc.request('conversation.subscribeTransientStream', {
      threadId: test.task.threadId,
    });
    expect(reconnect.error).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(reconnect))).toBeLessThan(128 * 1024);
    const run = {
      ...createDemoRun(test.runId, test.task.threadId, 'prompt', { modelId: 'model' }),
      assistantText: text,
      assistantTimeline: [segment],
    };
    internal.persistAssistantFinalMessage(test.runId, run, { assistantText: text });
    const page = await rpc.request('conversation.listMessages', {
      conversationId: test.conversation.id,
    });
    const message = (page.payload as unknown as ConversationListMessagesResponse).messages[0];
    const reference = message.blocks.find((block) => block.type === 'text')?.contentRef?.reference;
    expect(reference).toMatchObject({ source: 'timeline', id: segment.id, path: ['text'] });
    const first = await rpc.request('conversation.readContent', {
      conversationId: test.conversation.id,
      reference,
    });
    const chunk = (first.payload as unknown as ConversationReadContentResponse).content;
    expect(chunk.utf16Length).toBe(text.length);
    const denied = await rpc.request('conversation.readContent', {
      conversationId: test.otherConversation.id,
      reference,
    });
    expect(denied.error).toBeDefined();
    test.store.commitTransition({ events: [test.draft('prose-end', 'run.completed', {})] });
    const restarted = await test.restart();
    const tail = await restarted.request('conversation.readContent', {
      conversationId: test.conversation.id,
      reference,
      offset: text.length - 12,
      version: chunk.version,
    });
    expect((tail.payload as unknown as ConversationReadContentResponse).content.text).toBe(
      'END_OF_PROSE',
    );
  } finally {
    await test.close();
  }
});

it.each(['terminal', 'canonical'])(
  'restores old %s prose through actual history RPC and readonly Worker across restart',
  async (source) => {
    const test = await fixture();
    const text = '旧版完整回答🙂'.repeat(180000) + 'END_OF_LEGACY';
    const segment = {
      id: 'old-answer',
      sequence: 1,
      kind: 'text' as const,
      phase: 'final_answer' as const,
      status: 'completed' as const,
      text,
    };
    test.store.commitTransition({
      events: [
        test.draft('old-start', 'run.started', {}),
        test.draft('old-terminal', 'run.completed', { assistantText: text }),
      ],
    });
    if (source === 'canonical')
      test.timeline.upsertSegments(test.runId, [
        { id: segment.id, sequence: segment.sequence, value: segment },
      ]);
    const current =
      source === 'canonical'
        ? assistantTimelineToMessageBlocks([segment], test.runId)
        : assistantTextFallbackMessageBlocks(text);
    const blocks = JSON.parse(JSON.stringify(current), (key, value) =>
      ['contentRef', 'textRef', 'outputRef', 'argumentsRef'].includes(key) ? undefined : value,
    );
    const stored = new SqliteMessageStore(test.connection.raw).append({
      id: ('asst-' + test.runId) as import('@sync-think/shared').MessageId,
      threadId: test.task.threadId,
      runId: test.runId,
      role: 'assistant',
      sequence: 1,
      createdAt: '2026-09-05T14:00:01.000Z',
      blocks,
    });
    try {
      let rpc = await test.start();
      const page = await rpc.request('conversation.listMessages', {
        conversationId: test.conversation.id,
      });
      expect(page.error).toBeUndefined();
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(64 * 1024);
      const message = (page.payload as unknown as ConversationListMessagesResponse).messages[0];
      const reference = message.blocks.find((block) => block.type === 'text')?.contentRef
        ?.reference;
      expect(reference?.source).toBe(source === 'canonical' ? 'timeline' : 'event-prose');
      const first = await rpc.request('conversation.readContent', {
        conversationId: test.conversation.id,
        reference,
      });
      expect(first.error).toBeUndefined();
      const chunk = (first.payload as unknown as ConversationReadContentResponse).content;
      expect(chunk.utf16Length).toBe(text.length);
      rpc = await test.restart();
      const tail = await rpc.request('conversation.readContent', {
        conversationId: test.conversation.id,
        reference,
        offset: text.length - 13,
        version: chunk.version,
      });
      expect((tail.payload as unknown as ConversationReadContentResponse).content.text).toBe(
        'END_OF_LEGACY',
      );
      const denied = await rpc.request('conversation.readContent', {
        conversationId: test.otherConversation.id,
        reference,
      });
      expect(denied.error?.message).toContain('content.not-found');
      expect(new SqliteMessageStore(test.connection.raw).getMessage(stored.id)?.blocks).toEqual(
        stored.blocks,
      );
      if (source === 'canonical')
        test.timeline.upsertSegments(test.runId, [
          {
            id: segment.id,
            sequence: segment.sequence,
            value: { ...segment, text: text + 'changed' },
          },
        ]);
      else
        test.connection.raw
          .prepare('UPDATE event SET payload_json = ? WHERE id = ?')
          .run(
            JSON.stringify({ threadId: test.task.threadId, assistantText: text + 'changed' }),
            'old-terminal',
          );
      const changed = await rpc.request('conversation.readContent', {
        conversationId: test.conversation.id,
        reference,
        version: chunk.version,
      });
      expect(changed.error?.message).toContain('content.version-changed');
    } finally {
      await test.close();
    }
  },
);

describe('native task history over a real pipe and readonly Worker', () => {
  it('restores a prior run after an empty turn and restart, pages descriptions, and rejects wrong scope and stale versions', async () => {
    const test = await fixture();
    const items = Array.from({ length: 45 }, (_, index) => ({
      step: '原生任务' + index + '\n完整原生说明' + index,
      status: index === 0 ? 'in_progress' : 'pending',
    }));
    const requestPayload = {
      toolName: 'update_plan',
      toolCallId: 'native-plan',
      arguments: { plan: items },
    };
    test.store.commitTransition({
      events: [
        test.draft('native-start', 'run.started', { kernelId: 'codex' }),
        test.draft('native-request', 'tool.requested', requestPayload),
        test.draft('native-result', 'tool.completed', {
          toolCallId: 'native-plan',
          structuredResult: { ok: true },
        }),
        test.draft('native-end', 'run.completed', {}),
        {
          ...test.draft('next-start', 'run.started', { kernelId: 'codex' }),
          runId: 'next-run' as RunId,
        },
        { ...test.draft('next-end', 'run.completed', {}), runId: 'next-run' as RunId },
      ],
    });
    try {
      let rpc = await test.start();
      const mainRead = vi.spyOn(test.store, 'getTaskPlanHistory').mockImplementation(() => {
        throw new Error('main-thread history read');
      });
      const firstResponse = await rpc.request('conversation.taskPlanHistory', {
        conversationId: test.conversation.id,
      });
      expect(firstResponse.error).toBeUndefined();
      const first =
        firstResponse.payload as unknown as import('@sync-think/protocol').TaskPlanHistoryPage;
      expect(first.selected).toMatchObject({
        runId: test.runId,
        status: 'completed',
        total: 45,
        offset: 0,
        nextOffset: 40,
      });
      expect(first.selected?.items).toHaveLength(40);
      expect(first.selected?.items[0]).toEqual({
        title: '原生任务0',
        description: '完整原生说明0',
        status: 'in_progress',
      });
      expect(encodeFrame(firstResponse).length).toBeLessThan(256 * 1024);
      expect(mainRead).not.toHaveBeenCalled();
      const latest = await rpc.request('conversation.listMessages', {
        conversationId: test.conversation.id,
        limit: 1,
      });
      expect(
        (latest.payload as unknown as ConversationListMessagesResponse).taskPlan?.items,
      ).toBeNull();
      const denied = await rpc.request('conversation.taskPlanHistory', {
        conversationId: test.otherConversation.id,
        runId: test.runId,
      });
      expect(denied.error?.message).toContain('history.plan-not-found');
      rpc = await test.restart();
      const tail = await rpc.request('conversation.taskPlanHistory', {
        conversationId: test.conversation.id,
        runId: test.runId,
        offset: 40,
        version: first.selected!.version,
      });
      expect(tail.error).toBeUndefined();
      expect(
        (
          tail.payload as unknown as import('@sync-think/protocol').TaskPlanHistoryPage
        ).selected?.items.at(-1)?.description,
      ).toBe('完整原生说明44');
      test.connection.raw.prepare('UPDATE event SET payload_json = ? WHERE id = ?').run(
        JSON.stringify({
          threadId: test.task.threadId,
          ...requestPayload,
          arguments: { plan: [...items, { step: '新增任务', status: 'pending' }] },
        }),
        'native-request',
      );
      const changed = await rpc.request('conversation.taskPlanHistory', {
        conversationId: test.conversation.id,
        runId: test.runId,
        offset: 40,
        version: first.selected!.version,
      });
      expect(changed.error?.message).toContain('history.version-changed');
      const malformed = await rpc.request('conversation.taskPlanHistory', {
        conversationId: test.conversation.id,
        threadId: 'foreign',
      });
      expect(malformed.error).toBeDefined();
    } finally {
      await test.close();
    }
  });

  it('keeps health responsive and rejects a conversation rebound during a history read', async () => {
    const test = await fixture();
    let finish: (page: import('@sync-think/protocol').TaskPlanHistoryPage) => void = () => {};
    vi.spyOn(test.history, 'readTaskPlanHistory').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    try {
      const rpc = await test.start();
      const pending = rpc.request('conversation.taskPlanHistory', {
        conversationId: test.conversation.id,
      });
      await vi.waitFor(() => expect(test.history.readTaskPlanHistory).toHaveBeenCalledTimes(1));
      const health = await rpc.request('runtime.healthcheck', {});
      expect(health.payload.ok).toBe(true);
      const otherTaskId = test.conversations.get(test.otherConversation.id)!.taskId!;
      test.connection.raw
        .prepare('UPDATE conversation SET task_id = ? WHERE id = ?')
        .run(otherTaskId, test.conversation.id);
      finish({ runs: [] });
      expect((await pending).error?.message).toContain('content.scope-changed');
    } finally {
      finish({ runs: [] });
      await test.close();
    }
  });
});
