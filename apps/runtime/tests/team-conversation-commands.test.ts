import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { FakeProvider } from '@sync-think/adapters';
import { openPersistentRuntime, type PersistentRuntimeSession } from '../src/persistence.js';

const tempDirs: string[] = [];

async function connectRuntime(installId: string): Promise<Socket> {
  const sock = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    sock.once('connect', resolve);
    sock.once('error', reject);
  });
  return sock;
}

function createFrameReader(sock: Socket): {
  read: (count: number) => Promise<Frame[]>;
} {
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
      features: [
        'globalAgent.list',
        'globalAgent.create',
        'globalAgent.update',
        'globalAgent.delete',
        'team.list',
        'team.create',
        'team.update',
        'team.delete',
        'team.startRun',
        'team.setRunStatus',
        'conversation.list',
        'conversation.create',
        'conversation.rename',
        'conversation.setPinned',
        'conversation.setArchived',
        'conversation.setExecutionMode',
        'conversation.upgradeTrack',
        'conversation.delete',
      ],
    },
  });
  expect(resp.payload).toMatchObject({ ok: true });
}

describe('team & conversation commands', () => {
  let session: PersistentRuntimeSession;
  let sock: Socket;
  let reader: ReturnType<typeof createFrameReader>;
  let requestSeq = 0;

  const request = async (type: string, payload: unknown): Promise<Frame> =>
    writeAndRead(sock, reader, { id: `req-${++requestSeq}`, kind: 'request', type, payload });

  // Cross-test state built up sequentially (vitest runs tests in-file in order).
  let researcherId = '';
  let writerId = '';
  let teamId = '';
  let teamConversationId = '';
  let teamRunId = '';
  let modelConvAId = '';
  let modelConvBId = '';

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-team-conv-'));
    tempDirs.push(dir);
    const installId = `test-team-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    session = await openPersistentRuntime({
      installId,
      dbPath: join(dir, 'sync-think.db'),
      secureStoreKeyPath: join(dir, 'secure', 'key.bin'),
      allowNoToken: true,
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();
    sock = await connectRuntime(installId);
    reader = createFrameReader(sock);
    await hello(sock, reader, installId);
  }, 30_000);

  afterAll(async () => {
    sock?.destroy();
    await session?.close();
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may briefly lock better-sqlite3 files after session.close.
      }
    }
  });

  it('creates, lists, and updates global agents', async () => {
    const createdA = await request('globalAgent.create', {
      name: 'Researcher',
      defaultModelId: 'fake-mini',
      persona: 'Digs into sources.',
    });
    expect(createdA.error).toBeUndefined();
    researcherId = (createdA.payload as { agent: { id: string } }).agent.id;

    const createdB = await request('globalAgent.create', {
      name: 'Writer',
      defaultModelId: 'fake-mini',
    });
    expect(createdB.error).toBeUndefined();
    writerId = (createdB.payload as { agent: { id: string } }).agent.id;

    const listed = await request('globalAgent.list', {});
    expect(listed.error).toBeUndefined();
    expect(
      (listed.payload as { agents: Array<{ id: string }> }).agents.map((a) => a.id),
    ).toEqual(expect.arrayContaining([researcherId, writerId]));

    const updated = await request('globalAgent.update', {
      agentId: researcherId,
      persona: 'Digs into sources and cites them.',
    });
    expect(updated.error).toBeUndefined();
    expect((updated.payload as { agent: { persona: string } }).agent.persona).toBe(
      'Digs into sources and cites them.',
    );

    const malformed = await request('globalAgent.create', { name: '', defaultModelId: 'fake-mini' });
    expect(malformed.error).toMatchObject({ code: 'protocol.frame_malformed' });
  });

  it('creates a team with members and refuses deleting a rostered agent', async () => {
    const teamCreated = await request('team.create', {
      name: 'Doc Squad',
      strategy: 'serial',
      members: [
        { agentId: researcherId, role: 'researcher' },
        { agentId: writerId, role: 'writer', dependsOn: [researcherId] },
      ],
    });
    expect(teamCreated.error).toBeUndefined();
    const team = (
      teamCreated.payload as { team: { id: string; members: Array<{ agentId: string }> } }
    ).team;
    teamId = team.id;
    expect(team.members.map((m) => m.agentId)).toEqual([researcherId, writerId]);

    const deleteRefused = await request('globalAgent.delete', { agentId: researcherId });
    expect(deleteRefused.error?.message).toMatch(/member of team/i);

    const teamsListed = await request('team.list', {});
    expect(teamsListed.error).toBeUndefined();
    expect(
      (teamsListed.payload as { teams: Array<{ id: string }> }).teams.map((t) => t.id),
    ).toContain(teamId);
  });

  it('creates a team conversation and starts a run with a frozen roster', async () => {
    const convCreated = await request('conversation.create', {
      track: 'team',
      targetRef: teamId,
      title: 'Team docs run',
    });
    expect(convCreated.error).toBeUndefined();
    const conversation = (
      convCreated.payload as { conversation: { id: string; track: string; targetRef: string } }
    ).conversation;
    teamConversationId = conversation.id;
    expect(conversation).toMatchObject({ track: 'team', targetRef: teamId });

    const runStarted = await request('team.startRun', {
      teamId,
      conversationId: teamConversationId,
    });
    expect(runStarted.error).toBeUndefined();
    const run = (
      runStarted.payload as {
        run: { id: string; status: string; rosterSnapshot: { members: Array<{ agentId: string }> } };
      }
    ).run;
    teamRunId = run.id;
    expect(run.status).toBe('running');
    expect(run.rosterSnapshot.members.map((m) => m.agentId)).toEqual([researcherId, writerId]);
  });

  it('keeps the started roster after a team edit (freeze semantics)', async () => {
    const teamUpdated = await request('team.update', {
      teamId,
      members: [{ agentId: writerId, role: 'solo-writer' }],
    });
    expect(teamUpdated.error).toBeUndefined();
    expect(
      (teamUpdated.payload as { team: { members: Array<{ agentId: string }> } }).team.members.map(
        (m) => m.agentId,
      ),
    ).toEqual([writerId]);

    const runFinished = await request('team.setRunStatus', {
      runId: teamRunId,
      status: 'completed',
    });
    expect(runFinished.error).toBeUndefined();
    const run = (
      runFinished.payload as {
        run: { status: string; rosterSnapshot: { members: Array<{ agentId: string }> } };
      }
    ).run;
    expect(run.status).toBe('completed');
    expect(run.rosterSnapshot.members.map((m) => m.agentId)).toEqual([researcherId, writerId]);
  });

  it('refuses hard-deleting a team with historical runs', async () => {
    const deleteRefused = await request('team.delete', { teamId });
    expect(deleteRefused.error?.message).toMatch(/historical runs/i);
  });

  it('orders pinned conversations first in the list', async () => {
    const first = await request('conversation.create', {
      track: 'model',
      targetRef: 'fake-mini',
      title: 'first chat',
    });
    expect(first.error).toBeUndefined();
    modelConvAId = (first.payload as { conversation: { id: string } }).conversation.id;

    const second = await request('conversation.create', {
      track: 'model',
      targetRef: 'fake-mini',
      title: 'second chat',
    });
    expect(second.error).toBeUndefined();
    modelConvBId = (second.payload as { conversation: { id: string } }).conversation.id;

    const renamed = await request('conversation.rename', {
      conversationId: modelConvAId,
      title: 'pinned chat',
    });
    expect(renamed.error).toBeUndefined();

    const pinned = await request('conversation.setPinned', {
      conversationId: modelConvAId,
      pinned: true,
    });
    expect(pinned.error).toBeUndefined();
    expect(
      (pinned.payload as { conversation: { pinnedAt?: string } }).conversation.pinnedAt,
    ).toBeTruthy();

    const listed = await request('conversation.list', { track: 'model' });
    expect(listed.error).toBeUndefined();
    const ids = (listed.payload as { conversations: Array<{ id: string }> }).conversations.map(
      (c) => c.id,
    );
    expect(ids[0]).toBe(modelConvAId);
    expect(ids).toContain(modelConvBId);
  });

  it('hides archived conversations unless includeArchived is set', async () => {
    const archived = await request('conversation.setArchived', {
      conversationId: modelConvBId,
      archived: true,
    });
    expect(archived.error).toBeUndefined();

    const active = await request('conversation.list', { track: 'model' });
    expect(
      (active.payload as { conversations: Array<{ id: string }> }).conversations.map((c) => c.id),
    ).toEqual([modelConvAId]);

    const all = await request('conversation.list', { track: 'model', includeArchived: true });
    expect(
      (all.payload as { conversations: Array<{ id: string }> }).conversations,
    ).toHaveLength(2);
  });

  it('upgrades only model-direct conversations, once', async () => {
    const upgraded = await request('conversation.upgradeTrack', {
      conversationId: modelConvAId,
      track: 'agent',
      targetRef: writerId,
    });
    expect(upgraded.error).toBeUndefined();
    expect(
      (upgraded.payload as { conversation: { track: string; targetRef: string } }).conversation,
    ).toMatchObject({ track: 'agent', targetRef: writerId });

    const refusedAgain = await request('conversation.upgradeTrack', {
      conversationId: modelConvAId,
      track: 'agent',
      targetRef: writerId,
    });
    expect(refusedAgain.error?.message).toMatch(/only model-direct conversations/i);

    const refusedTeamConv = await request('conversation.upgradeTrack', {
      conversationId: teamConversationId,
      track: 'agent',
      targetRef: writerId,
    });
    expect(refusedTeamConv.error?.message).toMatch(/only model-direct conversations/i);

    const badTrack = await request('conversation.upgradeTrack', {
      conversationId: modelConvAId,
      track: 'model',
      targetRef: 'fake-mini',
    });
    expect(badTrack.error).toMatchObject({ code: 'protocol.frame_malformed' });
  });

  it('sets executionMode and deletes conversations', async () => {
    const modeSet = await request('conversation.setExecutionMode', {
      conversationId: modelConvAId,
      executionMode: 'full-access',
    });
    expect(modeSet.error).toBeUndefined();
    expect(
      (modeSet.payload as { conversation: { executionMode: string } }).conversation.executionMode,
    ).toBe('full-access');

    const deleted = await request('conversation.delete', { conversationId: modelConvBId });
    expect(deleted.error).toBeUndefined();
    const after = await request('conversation.list', { track: 'model', includeArchived: true });
    expect(
      (after.payload as { conversations: Array<{ id: string }> }).conversations.map((c) => c.id),
    ).not.toContain(modelConvBId);
  });
});
