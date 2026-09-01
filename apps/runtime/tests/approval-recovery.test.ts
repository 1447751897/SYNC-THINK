import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import { openDatabaseAsync, runMigrations, SqliteEventCheckpointStore } from '@sync-think/storage';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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

async function openFixture() {
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
    installId,
    allowNoToken: true,
    stateStore,
    workspaceId,
    checkpointRunId: `runtime-${installId}` as RunId,
  });
  await runtime.start();
  return { connection, runtime, installId, workspaceId, runId, threadId, approvalId };
}

describe('durable chat tool approval recovery', () => {
  it('lists a pending approval from durable events after the in-memory event window evicts it', async () => {
    const fixture = await openFixture();
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
      expect(response.payload).toEqual({
        approvals: [
          expect.objectContaining({
            approvalId: fixture.approvalId,
            threadId: fixture.threadId,
            runId: fixture.runId,
            toolName: 'desktop_set_value',
            status: 'pending',
          }),
        ],
      });
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('decides a durable orphan exactly once after Runtime restart', async () => {
    const fixture = await openFixture();
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
      socket.destroy();
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });
});
