import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqliteMessageStore,
} from '@sync-think/storage';
import { Runtime } from '../src/runtime.js';
import { FakeProvider, type ProviderAdapter } from '@sync-think/adapters';

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    const target = realpathSync(dir);
    if (
      dirname(target).toLowerCase() !== realpathSync(tmpdir()).toLowerCase() ||
      !basename(target).startsWith('sync-think-approval-recovery-')
    )
      throw new Error('Unexpected fixture cleanup path');
    rmSync(target, { recursive: true, force: true });
  }
});

function frameInbox(socket: Socket) {
  const waiters = new Map<string, (frame: Frame) => void>();
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.get(frame.id);
      if (waiter) {
        waiters.delete(frame.id);
        waiter(frame);
      }
    }
  });
  return {
    send(frame: Frame): Promise<Frame> {
      const response = new Promise<Frame>((resolve) => waiters.set(frame.id, resolve));
      socket.write(encodeFrame(frame));
      return response;
    },
  };
}

async function connectAndHello(
  installId: string,
  feature: string,
): Promise<{
  socket: Socket;
  inbox: ReturnType<typeof frameInbox>;
}> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const inbox = frameInbox(socket);
  await inbox.send({
    id: `hello-${feature}`,
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: '0.0.1',
      installId,
      nonce: `nonce-${feature}`,
      features: [feature],
    },
  });
  return { socket, inbox };
}

async function openFixture(demoProvider?: ProviderAdapter) {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-approval-recovery-'));
  tempDirs.push(root);
  const dbPath = join(root, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const stateStore = new SqliteEventCheckpointStore(connection.raw);
  const installId = `approval-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workspaceId = 'workspace-approval-recovery' as WorkspaceId;
  const runId = 'run-approval-recovery' as RunId;
  const threadId = 'thread-approval-recovery';
  const approvalId = 'kappr-durable-1';
  connection.raw
    .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
    .run(threadId, 'task-approval-recovery', '2026-08-31T00:00:00.000Z');
  const messageStore = new SqliteMessageStore(connection.raw);
  messageStore.append({
    id: 'request-message' as never,
    threadId: threadId as never,
    runId,
    role: 'user',
    sequence: 1,
    blocks: [{ type: 'text', text: '请检查并修改该文件' }],
    createdAt: '2026-08-31T00:00:00.000Z',
  });
  stateStore.commitTransition({
    events: [
      {
        id: 'approval-requested-1' as never,
        workspaceId,
        runId,
        category: 'approval',
        type: 'tool.approval_requested',
        occurredAt: '2026-08-31T00:00:00.000Z',
        payload: {
          approvalId,
          threadId,
          runId,
          toolCallId: 'desktop-call-1',
          toolName: 'desktop_set_value',
          arguments: { valueLength: 12 },
          title: 'desktop_set_value',
          detail: '需要你的批准',
          allowedScopes: ['once'],
        },
      },
      ...Array.from({ length: 2_100 }, (_, index) => ({
        id: `noise-${index}` as never,
        workspaceId,
        category: 'system' as const,
        type: 'noise.event',
        occurredAt: `2026-08-31T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
        payload: { index },
      })),
    ],
  });
  const runtime = new Runtime({
    demoProvider,
    installId,
    allowNoToken: true,
    stateStore,
    messageStore,
    workspaceId,
    checkpointRunId: `runtime-${installId}` as RunId,
  });
  await runtime.start();
  return { connection, stateStore, runtime, installId, workspaceId, runId, threadId, approvalId };
}

describe('durable chat tool approval recovery', () => {
  it('expires a durable orphan during a scoped query without scanning unrelated history', async () => {
    const fixture = await openFixture();
    const globalReads = vi.spyOn(fixture.stateStore, 'listEventPage').mockImplementation(() => {
      throw new Error('Online approval reads must not scan global history');
    });
    const approvalReads = vi.spyOn(fixture.stateStore, 'listToolApprovalEvents');
    const { socket, inbox } = await connectAndHello(
      fixture.installId,
      'conversation.listPendingToolApprovals',
    );
    try {
      const response = await inbox.send({
        id: 'list-pending',
        kind: 'request',
        type: 'conversation.listPendingToolApprovals',
        payload: { threadId: fixture.threadId },
      });
      expect(response.error).toBeUndefined();
      expect(response.payload).toMatchObject({
        approvals: [],
        expiredCount: 1,
        expired: [
          {
            approvalId: fixture.approvalId,
            status: 'expired',
            reason: 'stale-approval',
            requestMessageId: 'request-message',
            runId: fixture.runId,
            threadId: fixture.threadId,
          },
        ],
      });
      expect(globalReads).not.toHaveBeenCalled();
      expect(approvalReads).toHaveBeenCalledWith({ threadId: fixture.threadId });
      const decisions = fixture.stateStore
        .listToolApprovalEvents({ approvalId: fixture.approvalId })
        .filter((event) => event.type === 'tool.approval_decided');
      expect(decisions).toHaveLength(1);
      expect(decisions[0]?.payload).toMatchObject({ decision: 'deny', reason: 'stale-approval' });
      const repeated = await inbox.send({
        id: 'list-again',
        kind: 'request',
        type: 'conversation.listPendingToolApprovals',
        payload: { threadId: fixture.threadId },
      });
      expect(repeated.payload).toEqual(response.payload);
      expect(
        fixture.stateStore
          .listToolApprovalEvents({ approvalId: fixture.approvalId })
          .filter((event) => event.type === 'tool.approval_decided'),
      ).toHaveLength(1);
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('decides a durable orphan exactly once after Runtime restart', async () => {
    const fixture = await openFixture();
    const globalReads = vi.spyOn(fixture.stateStore, 'listEventPage').mockImplementation(() => {
      throw new Error('Online approval decisions must not scan global history');
    });
    try {
      const { socket, inbox } = await connectAndHello(
        fixture.installId,
        'conversation.decideToolApproval',
      );
      const first = await inbox.send({
        id: 'decide-first',
        kind: 'request',
        type: 'conversation.decideToolApproval',
        payload: { approvalId: fixture.approvalId, decision: 'deny' },
      });
      expect(first.error).toBeUndefined();
      expect(first.payload).toMatchObject({
        approvalId: fixture.approvalId,
        decision: 'deny',
      });

      const second = await inbox.send({
        id: 'decide-second',
        kind: 'request',
        type: 'conversation.decideToolApproval',
        payload: { approvalId: fixture.approvalId, decision: 'deny' },
      });
      expect(second.error).toBeUndefined();
      expect(second.payload).toMatchObject({
        approvalId: fixture.approvalId,
        decision: 'deny',
      });
      expect(globalReads).not.toHaveBeenCalled();
      socket.destroy();
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('does not expire an approval from another thread or acknowledge a failed durable write', async () => {
    const fixture = await openFixture();
    const { socket, inbox } = await connectAndHello(
      fixture.installId,
      'conversation.listPendingToolApprovals',
    );
    try {
      const unrelated = await inbox.send({
        id: 'other-thread',
        kind: 'request',
        type: 'conversation.listPendingToolApprovals',
        payload: { threadId: 'different-thread' },
      });
      expect(unrelated.payload).toEqual({ approvals: [] });
      expect(
        fixture.stateStore.listToolApprovalEvents({ approvalId: fixture.approvalId }),
      ).toHaveLength(1);
      vi.spyOn(fixture.stateStore, 'commitTransition').mockImplementation(() => {
        throw new Error('disk write failed');
      });
      const failed = await inbox.send({
        id: 'expiry-write-failure',
        kind: 'request',
        type: 'conversation.listPendingToolApprovals',
        payload: { threadId: fixture.threadId },
      });
      expect(failed.error).toBeDefined();
      expect(
        fixture.stateStore.listToolApprovalEvents({ approvalId: fixture.approvalId }),
      ).toHaveLength(1);
    } finally {
      socket.destroy();
      vi.restoreAllMocks();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });
});

describe('expired approval response contract', () => {
  it('reports a durable expired outcome on both the first and repeated click', async () => {
    const fixture = await openFixture();
    const { socket, inbox } = await connectAndHello(
      fixture.installId,
      'conversation.decideToolApproval',
    );
    try {
      for (const requestId of ['first-expired-click', 'repeat-expired-click']) {
        const response = await inbox.send({
          id: requestId,
          kind: 'request',
          type: 'conversation.decideToolApproval',
          payload: { approvalId: fixture.approvalId, decision: 'approve', scope: 'session' },
        });
        expect(response.error).toBeUndefined();
        expect(response.payload).toMatchObject({
          approvalId: fixture.approvalId,
          decision: 'deny',
          scope: 'once',
          outcome: 'expired',
          reason: 'stale-approval',
          runId: fixture.runId,
        });
      }
      expect(
        fixture.stateStore.listToolApprovalEvents({ approvalId: fixture.approvalId }),
      ).toHaveLength(2);
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('bounds recent expired summaries while preserving the count and not exposing arguments', async () => {
    const fixture = await openFixture();
    const { socket, inbox } = await connectAndHello(
      fixture.installId,
      'conversation.listPendingToolApprovals',
    );
    try {
      const original = fixture.stateStore.listToolApprovalEvents({
        approvalId: fixture.approvalId,
      })[0]!;
      fixture.stateStore.commitTransition({
        events: Array.from({ length: 25 }, (_, index) => ({
          ...original,
          id: ('extra-request-' + index) as never,
          occurredAt: '2026-09-06T00:00:00.000Z',
          payload: {
            ...original.payload,
            approvalId: 'extra-approval-' + index,
            arguments: { secret: 'must-not-leak' },
            title: '大标题'.repeat(1000),
            detail: '大说明'.repeat(1000),
          },
        })),
      });
      const response = await inbox.send({
        id: 'bounded-expiry',
        kind: 'request',
        type: 'conversation.listPendingToolApprovals',
        payload: { threadId: fixture.threadId },
      });
      expect(response.error).toBeUndefined();
      const result = response.payload as {
        expired: unknown[];
        expiredCount: number;
        approvals: unknown[];
      };
      expect(result.approvals).toEqual([]);
      expect(result.expired).toHaveLength(20);
      expect(result.expiredCount).toBe(26);
      expect(JSON.stringify(result)).not.toContain('must-not-leak');
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(64 * 1024);
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('keeps an explicit user denial distinct from expiration', async () => {
    const fixture = await openFixture();
    const { socket, inbox } = await connectAndHello(
      fixture.installId,
      'conversation.listPendingToolApprovals',
    );
    try {
      fixture.stateStore.commitTransition({
        events: [
          {
            id: 'manual-deny' as never,
            workspaceId: fixture.workspaceId,
            runId: fixture.runId,
            category: 'approval',
            type: 'tool.approval_decided',
            occurredAt: '2026-09-06T00:00:00.000Z',
            payload: {
              approvalId: fixture.approvalId,
              threadId: fixture.threadId,
              decision: 'deny',
              reason: 'user-denied',
            },
          },
        ],
      });
      const response = await inbox.send({
        id: 'no-expired-deny',
        kind: 'request',
        type: 'conversation.listPendingToolApprovals',
        payload: { threadId: fixture.threadId },
      });
      expect(response.payload).toEqual({ approvals: [] });
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });
});

describe('new user request run ownership', () => {
  it('persists the source user message with the allocated run inside the append transaction', async () => {
    const fixture = await openFixture(new FakeProvider({ chunksPerWord: 1 }));
    const { socket, inbox } = await connectAndHello(fixture.installId, 'task.appendMessage');
    try {
      const response = await inbox.send({
        id: 'append-bound-request',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: fixture.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: 'new request',
          kernelId: 'native',
        },
      });
      expect(response.error).toBeUndefined();
      const { messageId, streamId } = response.payload as { messageId: string; streamId: RunId };
      expect(streamId).toBeTruthy();
      const messages = new SqliteMessageStore(fixture.connection.raw);
      expect(messages.getMessage(messageId as never)?.runId).toBe(streamId);
      expect(messages.findRunUserMessageId(fixture.threadId as never, streamId)).toBe(messageId);
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });
});
