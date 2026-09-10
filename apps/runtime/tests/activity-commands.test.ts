import { describe, expect, it, afterEach } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { FakeProvider } from '@sync-think/adapters';
import {
  SqliteConversationStore,
  SqliteExternalEventStore,
  SqliteRunIndexStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import {
  deriveTaskTitleFromPrompt,
  type MessageId,
  type ModelId,
  type ThreadId,
} from '@sync-think/shared';
import { openPersistentRuntime } from '../src/persistence.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function connectRuntime(installId: string): Promise<Socket> {
  const sock = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    sock.once('connect', resolve);
    sock.once('error', reject);
  });
  return sock;
}

function createFrameReader(sock: Socket): { read: (count: number) => Promise<Frame[]> } {
  const queued: Frame[] = [];
  const waiters: Array<{
    count: number;
    resolve: (frames: Frame[]) => void;
    reject: (err: unknown) => void;
  }> = [];
  let pending = Buffer.alloc(0);

  const drain = () => {
    while (waiters.length > 0 && queued.length >= waiters[0]!.count) {
      const waiter = waiters.shift()!;
      waiter.resolve(queued.splice(0, waiter.count));
    }
  };

  sock.on('data', (chunk: Buffer) => {
    try {
      const decoded = decodeFrames(Buffer.concat([pending, chunk]));
      pending = decoded.remaining;
      queued.push(...decoded.frames);
      drain();
    } catch (e) {
      while (waiters.length > 0) waiters.shift()!.reject(e);
    }
  });
  sock.on('error', (e) => {
    while (waiters.length > 0) waiters.shift()!.reject(e);
  });
  sock.on('close', () => {
    while (waiters.length > 0) {
      waiters.shift()!.reject(new Error('socket closed before the requested frame arrived'));
    }
  });

  return {
    read(count: number) {
      if (queued.length >= count) return Promise.resolve(queued.splice(0, count));
      return new Promise((resolve, reject) => waiters.push({ count, resolve, reject }));
    },
  };
}

async function writeAndRead(
  sock: Socket,
  reader: ReturnType<typeof createFrameReader>,
  frame: Frame,
): Promise<Frame> {
  const next = reader.read(1);
  sock.write(encodeFrame(frame));
  return (await next)[0]!;
}

async function hello(
  sock: Socket,
  reader: ReturnType<typeof createFrameReader>,
  installId: string,
): Promise<void> {
  const resp = await writeAndRead(sock, reader, {
    id: 'hello',
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: '0.0.1',
      installId,
      nonce: randomBytes(8).toString('hex'),
      features: ['activity.listRuns', 'activity.listExternalEvents', 'activity.retryAnchor'],
    },
  });
  expect(resp.payload).toMatchObject({ ok: true });
}

interface Harness {
  sock: Socket;
  reader: ReturnType<typeof createFrameReader>;
  session: Awaited<ReturnType<typeof openPersistentRuntime>>;
  runIndex: SqliteRunIndexStore;
  externalEvents: SqliteExternalEventStore;
  raw: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } };
  send: (type: string, payload: unknown) => Promise<Frame>;
  close: () => Promise<void>;
}

async function openHarness(label: string): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-activity-'));
  tempDirs.push(dir);
  const installId = `${label}-${randomBytes(4).toString('hex')}`;
  const session = await openPersistentRuntime({
    installId,
    dbPath: join(dir, 'db.sqlite'),
    secureStoreKeyPath: join(dir, 'key.bin'),
    demoProvider: new FakeProvider(),
    allowNoToken: true,
  });
  await session.runtime.start();
  const sock = await connectRuntime(installId);
  const reader = createFrameReader(sock);
  await hello(sock, reader, installId);

  const internals = session.runtime as unknown as {
    runIndexStore: SqliteRunIndexStore;
    externalEventStore: SqliteExternalEventStore;
  };
  // Both stores wrap the same connection the Runtime opened, so reusing one of
  // them keeps the seeded rows in the database the handlers actually read.
  const raw = (internals.runIndexStore as unknown as { raw: Harness['raw'] }).raw;

  let counter = 0;
  return {
    sock,
    reader,
    session,
    runIndex: internals.runIndexStore,
    externalEvents: internals.externalEventStore,
    raw,
    send: (type, payload) =>
      writeAndRead(sock, reader, {
        id: `req-${(counter += 1)}`,
        kind: 'request',
        type,
        payload: payload as Frame['payload'],
      }),
    close: async () => {
      sock.destroy();
      await session.close();
    },
  };
}

function seedRun(
  store: SqliteRunIndexStore,
  overrides: Partial<Parameters<SqliteRunIndexStore['upsert']>[0]> & { runId: string },
): void {
  store.upsert({
    workspaceId: 'ws-1',
    source: 'chat',
    state: 'completed',
    startedAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  } as Parameters<SqliteRunIndexStore['upsert']>[0]);
}

describe('activity.listRuns', () => {
  it('returns newest-first entries with per-state counts', async () => {
    const h = await openHarness('activity-list');
    try {
      seedRun(h.runIndex, { runId: 'r-1', startedAt: '2026-08-21T00:00:01.000Z' });
      seedRun(h.runIndex, {
        runId: 'r-2',
        state: 'failed',
        startedAt: '2026-08-21T00:00:02.000Z',
        failureClass: 'timeout',
      });
      seedRun(h.runIndex, {
        runId: 'r-3',
        state: 'running',
        startedAt: '2026-08-21T00:00:03.000Z',
      });

      const resp = await h.send('activity.listRuns', {});
      expect(resp.error).toBeUndefined();
      const payload = resp.payload as {
        entries: Array<{ runId: string; state: string }>;
        counts: Record<string, number>;
      };
      expect(payload.entries.map((e) => e.runId)).toEqual(['r-3', 'r-2', 'r-1']);
      expect(payload.counts.completed).toBe(1);
      expect(payload.counts.failed).toBe(1);
      expect(payload.counts.running).toBe(1);
      expect(payload.counts.cancelled).toBe(0);
    } finally {
      await h.close();
    }
  });

  it('keeps counts on the workspace scope while the state filter narrows entries', async () => {
    // Counts drive the filter chips: if they followed the state filter, every
    // chip except the active one would read 0 and the UI could never recover.
    const h = await openHarness('activity-counts');
    try {
      seedRun(h.runIndex, { runId: 'r-ok', startedAt: '2026-08-21T00:00:01.000Z' });
      seedRun(h.runIndex, {
        runId: 'r-bad',
        state: 'failed',
        startedAt: '2026-08-21T00:00:02.000Z',
      });

      const resp = await h.send('activity.listRuns', { states: ['failed'] });
      const payload = resp.payload as {
        entries: Array<{ runId: string }>;
        counts: Record<string, number>;
      };
      expect(payload.entries.map((e) => e.runId)).toEqual(['r-bad']);
      expect(payload.counts.completed).toBe(1);
      expect(payload.counts.failed).toBe(1);
    } finally {
      await h.close();
    }
  });

  it('walks every row exactly once across cursor pages', async () => {
    const h = await openHarness('activity-pages');
    try {
      for (let i = 0; i < 5; i += 1) {
        seedRun(h.runIndex, {
          runId: `r-${i}`,
          startedAt: `2026-08-21T00:00:0${i}.000Z`,
        });
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const resp = await h.send('activity.listRuns', {
          limit: 2,
          ...(cursor ? { cursor } : {}),
        });
        const payload = resp.payload as {
          entries: Array<{ runId: string }>;
          nextCursor?: string;
        };
        seen.push(...payload.entries.map((e) => e.runId));
        cursor = payload.nextCursor;
        if (!cursor) break;
      }
      expect(cursor).toBeUndefined();
      expect(seen).toEqual(['r-4', 'r-3', 'r-2', 'r-1', 'r-0']);
      expect(new Set(seen).size).toBe(5);
    } finally {
      await h.close();
    }
  });

  it('filters by workspace and source', async () => {
    const h = await openHarness('activity-filter');
    try {
      seedRun(h.runIndex, { runId: 'r-a', workspaceId: 'ws-1', source: 'chat' });
      seedRun(h.runIndex, { runId: 'r-b', workspaceId: 'ws-2', source: 'chat' });
      seedRun(h.runIndex, { runId: 'r-c', workspaceId: 'ws-1', source: 'external' });

      const byWorkspace = await h.send('activity.listRuns', { workspaceId: 'ws-2' });
      expect(
        (byWorkspace.payload as { entries: Array<{ runId: string }> }).entries.map((e) => e.runId),
      ).toEqual(['r-b']);

      const bySource = await h.send('activity.listRuns', { sources: ['external'] });
      expect(
        (bySource.payload as { entries: Array<{ runId: string }> }).entries.map((e) => e.runId),
      ).toEqual(['r-c']);
    } finally {
      await h.close();
    }
  });

  it('fills a human title from the conversation instead of leaving the run id', async () => {
    const h = await openHarness('activity-titles');
    try {
      const internals = h.session.runtime as unknown as {
        conversationStore: SqliteConversationStore;
        workspaceStore: SqliteWorkspaceStore;
      };
      const workspace = internals.workspaceStore.createWorkspace({ name: 'activity-titles' });
      const task = internals.workspaceStore.createTask({
        workspaceId: workspace.id,
        title: '新对话',
        goal: 'first message',
      });
      const conversation = internals.conversationStore.create({
        target: { track: 'model', modelId: 'gpt-5' as ModelId },
        workspaceId: workspace.id,
        title: '分析登录流程',
      });
      internals.conversationStore.bindTask(conversation.id, task.taskId);
      seedRun(h.runIndex, {
        runId: 'r-named',
        taskId: task.taskId,
        conversationId: task.threadId,
        startedAt: '2026-08-21T00:00:04.000Z',
      });

      const resp = await h.send('activity.listRuns', {});
      const entry = (resp.payload as { entries: Array<Record<string, string>> }).entries[0]!;
      expect(entry.title).toBe('分析登录流程');
      expect(entry.conversationId).toBe(conversation.id);
      expect(entry.runId).toBe('r-named');
    } finally {
      await h.close();
    }
  });

  it('derives a title from the trigger message when the conversation is still untitled', async () => {
    const h = await openHarness('activity-prompt-title');
    try {
      const prompt = '请帮我分析现有项目，然后修复登录流程并补充测试。';
      const internals = h.session.runtime as unknown as {
        messageStore: {
          append: (message: unknown) => unknown;
          nextSequence: (threadId: ThreadId) => number;
        };
      };
      h.raw
        .prepare('INSERT OR IGNORE INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
        .run('thread-title', 'task-thread-title', '2026-08-21T00:00:00.000Z');
      internals.messageStore.append({
        id: 'msg-title' as MessageId,
        threadId: 'thread-title' as ThreadId,
        role: 'user',
        blocks: [{ type: 'text', text: prompt }],
        createdAt: '2026-08-21T00:00:00.000Z',
        sequence: internals.messageStore.nextSequence('thread-title' as ThreadId),
      });
      seedRun(h.runIndex, {
        runId: 'r-prompt',
        conversationId: 'thread-title',
        triggerMessageId: 'msg-title',
      });

      const resp = await h.send('activity.listRuns', {});
      const entry = (resp.payload as { entries: Array<{ title: string; runId: string }> })
        .entries[0]!;
      expect(entry.title).toBe(deriveTaskTitleFromPrompt(prompt));
      expect(entry.runId).toBe('r-prompt');
    } finally {
      await h.close();
    }
  });

  it('uses a source label when no human title can be resolved', async () => {
    const h = await openHarness('activity-source-title');
    try {
      seedRun(h.runIndex, { runId: 'r-orphan', source: 'scheduled' });
      const resp = await h.send('activity.listRuns', {});
      const entry = (resp.payload as { entries: Array<{ title: string; runId: string }> })
        .entries[0]!;
      expect(entry.title).toBe('定时任务');
      expect(entry.runId).toBe('r-orphan');
    } finally {
      await h.close();
    }
  });
});

describe('activity.listExternalEvents', () => {
  function submitEvent(h: Harness, id: string, dedupeKey: string, createdAt: string) {
    h.externalEvents.submit({
      id,
      dedupeKey,
      source: { kind: 'webhook', name: 'github' },
      instruction: 'internal instruction text',
      target: { kind: 'agent', agentId: 'agent-1' },
      workspaceId: 'ws-1',
      skillVersionIds: [],
      title: `event ${id}`,
      now: createdAt,
    });
  }

  it('never exposes the lease token or the raw instruction', async () => {
    const h = await openHarness('activity-fencing');
    try {
      await submitEvent(h, 'evt-1', 'dedupe-1', '2026-08-21T00:00:01.000Z');
      // Claiming mints a fencing credential on the stored row; the wire view
      // must not carry it into the Renderer.
      const claimed = h.externalEvents.claimNext({
        owner: 'daemon-1',
        token: 'lease-token-secret',
        leaseMs: 60_000,
      });
      expect(claimed?.leaseToken).toBe('lease-token-secret');

      const resp = await h.send('activity.listExternalEvents', {});
      expect(resp.error).toBeUndefined();
      const raw = JSON.stringify(resp.payload);
      expect(raw).not.toContain('lease-token-secret');
      expect(raw).not.toContain('leaseToken');
      expect(raw).not.toContain('internal instruction text');

      const entry = (resp.payload as { entries: Array<Record<string, unknown>> }).entries[0]!;
      expect(entry.id).toBe('evt-1');
      expect(entry.sourceKind).toBe('webhook');
      expect(entry.sourceName).toBe('github');
      expect(entry.state).toBe('leased');
      expect(entry.attemptCount).toBe(1);
    } finally {
      await h.close();
    }
  });

  it('lists newest first and honours the state filter', async () => {
    const h = await openHarness('activity-events');
    try {
      await submitEvent(h, 'evt-old', 'dedupe-old', '2026-08-21T00:00:01.000Z');
      await submitEvent(h, 'evt-new', 'dedupe-new', '2026-08-21T00:00:02.000Z');
      h.externalEvents.claimNext({ owner: 'd', token: 't', leaseMs: 60_000 });

      const all = await h.send('activity.listExternalEvents', {});
      expect((all.payload as { entries: Array<{ id: string }> }).entries.map((e) => e.id)).toEqual([
        'evt-new',
        'evt-old',
      ]);

      const pending = await h.send('activity.listExternalEvents', { states: ['pending'] });
      expect(
        (pending.payload as { entries: Array<{ id: string }> }).entries.map((e) => e.id),
      ).toEqual(['evt-new']);
    } finally {
      await h.close();
    }
  });

  it('clamps the limit to the requested page size', async () => {
    const h = await openHarness('activity-events-limit');
    try {
      for (let i = 0; i < 4; i += 1) {
        await submitEvent(h, `evt-${i}`, `dedupe-${i}`, `2026-08-21T00:00:0${i}.000Z`);
      }
      const resp = await h.send('activity.listExternalEvents', { limit: 2 });
      expect((resp.payload as { entries: unknown[] }).entries).toHaveLength(2);
    } finally {
      await h.close();
    }
  });
});

describe('activity.retryAnchor', () => {
  function seedMessage(h: Harness, id: string, threadId: string, text: string): void {
    const internals = h.session.runtime as unknown as {
      messageStore: {
        append: (message: unknown) => unknown;
        nextSequence: (threadId: ThreadId) => number;
      };
    };
    // Messages are foreign-keyed to `thread`, so the thread row has to exist
    // before the anchor message can be durable.
    h.raw
      .prepare('INSERT OR IGNORE INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run(threadId, `task-${threadId}`, '2026-08-21T00:00:00.000Z');
    const store = internals.messageStore;
    store.append({
      id: id as MessageId,
      threadId: threadId as ThreadId,
      role: 'user',
      blocks: [{ type: 'text', text }],
      createdAt: '2026-08-21T00:00:00.000Z',
      sequence: store.nextSequence(threadId as ThreadId),
    });
  }

  it('resolves the original prompt for a failed run', async () => {
    const h = await openHarness('activity-retry');
    try {
      seedMessage(h, 'msg-1', 'conv-1', 'please rebuild the index');
      seedRun(h.runIndex, {
        runId: 'r-failed',
        state: 'failed',
        conversationId: 'conv-1',
        triggerMessageId: 'msg-1',
      });

      const resp = await h.send('activity.retryAnchor', { runId: 'r-failed' });
      expect(resp.error).toBeUndefined();
      expect(resp.payload).toMatchObject({
        runId: 'r-failed',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        text: 'please rebuild the index',
        retryable: true,
      });
    } finally {
      await h.close();
    }
  });

  it('refuses to retry a run that is still in flight', async () => {
    const h = await openHarness('activity-retry-live');
    try {
      seedMessage(h, 'msg-2', 'conv-2', 'still going');
      seedRun(h.runIndex, {
        runId: 'r-live',
        state: 'running',
        conversationId: 'conv-2',
        triggerMessageId: 'msg-2',
      });

      const resp = await h.send('activity.retryAnchor', { runId: 'r-live' });
      const payload = resp.payload as { retryable: boolean; reason?: string; text?: string };
      expect(payload.retryable).toBe(false);
      expect(payload.reason).toBeTruthy();
      // No prompt is handed back, so a caller cannot replay a live run by mistake.
      expect(payload.text).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it('reports an unretryable run when the anchor message is gone', async () => {
    const h = await openHarness('activity-retry-gone');
    try {
      seedRun(h.runIndex, {
        runId: 'r-orphan',
        state: 'failed',
        conversationId: 'conv-3',
        triggerMessageId: 'msg-missing',
      });

      const resp = await h.send('activity.retryAnchor', { runId: 'r-orphan' });
      const payload = resp.payload as { retryable: boolean; reason?: string };
      expect(payload.retryable).toBe(false);
      expect(payload.reason).toBeTruthy();
    } finally {
      await h.close();
    }
  });

  it('reports an unknown run rather than erroring the frame', async () => {
    const h = await openHarness('activity-retry-unknown');
    try {
      const resp = await h.send('activity.retryAnchor', { runId: 'r-nope' });
      expect(resp.error).toBeUndefined();
      expect(resp.payload).toMatchObject({ runId: 'r-nope', retryable: false });
    } finally {
      await h.close();
    }
  });

  it('rejects a malformed payload', async () => {
    const h = await openHarness('activity-retry-bad');
    try {
      const resp = await h.send('activity.retryAnchor', {});
      expect(resp.error).toBeDefined();
    } finally {
      await h.close();
    }
  });
});
