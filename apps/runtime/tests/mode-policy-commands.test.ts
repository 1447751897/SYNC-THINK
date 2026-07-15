import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  type Frame,
} from '@sync-think/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistentRuntime } from '../src/persistence.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createFrameReader(socket: Socket) {
  const queued: Frame[] = [];
  const waiters: Array<{
    count: number;
    resolve: (frames: Frame[]) => void;
    reject: (error: unknown) => void;
  }> = [];
  let pending = Buffer.alloc(0);

  const drain = () => {
    while (waiters.length > 0 && queued.length >= waiters[0]!.count) {
      const waiter = waiters.shift()!;
      waiter.resolve(queued.splice(0, waiter.count));
    }
  };

  socket.on('data', (chunk: Buffer) => {
    try {
      const decoded = decodeFrames(Buffer.concat([pending, chunk]));
      pending = decoded.remaining;
      queued.push(...decoded.frames);
      drain();
    } catch (error) {
      while (waiters.length > 0) waiters.shift()!.reject(error);
    }
  });
  socket.on('error', (error) => {
    while (waiters.length > 0) waiters.shift()!.reject(error);
  });
  socket.on('close', () => {
    while (waiters.length > 0) {
      waiters.shift()!.reject(new Error('socket closed before the requested frame arrived'));
    }
  });

  return {
    read(count: number): Promise<Frame[]> {
      if (queued.length >= count) return Promise.resolve(queued.splice(0, count));
      return new Promise((resolve, reject) => waiters.push({ count, resolve, reject }));
    },
  };
}

async function send(
  socket: Socket,
  reader: ReturnType<typeof createFrameReader>,
  id: string,
  type: string,
  payload: unknown,
): Promise<Frame> {
  const response = reader.read(1);
  socket.write(encodeFrame({ id, kind: 'request', type, payload }));
  return (await response)[0]!;
}

async function startFixture(options: {
  hasApprovedPlan?: (taskId: string) => boolean;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-mode-policy-'));
  tempDirs.push(dir);
  const installId = `mode-policy-${randomBytes(5).toString('hex')}`;
  const dbPath = join(dir, 'sync-think.db');
  const secureStoreKeyPath = join(dir, 'secure-store-key.bin');
  const session = await openPersistentRuntime({
    dbPath,
    secureStoreKeyPath,
    installId,
    allowNoToken: true,
    ...options,
  });
  await session.runtime.start();
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const reader = createFrameReader(socket);
  const hello = await send(socket, reader, 'hello', '__hello', {
    protocolVersion: 2,
    appVersion: '0.0.1',
    installId,
    nonce: randomBytes(8).toString('hex'),
    features: [
      'workspace.create',
      'task.create',
      'task.list',
      'task.open',
      'task.search',
      'task.setParticipationMode',
      'policy.save',
      'policy.list',
      'runtime.subscribeEvents',
    ],
  });
  expect(hello.payload).toMatchObject({ ok: true });

  return {
    dir,
    dbPath,
    secureStoreKeyPath,
    installId,
    socket,
    reader,
    async close() {
      socket.destroy();
      await session.close();
    },
  };
}

async function createWorkspaceAndTask(
  fixture: Awaited<ReturnType<typeof startFixture>>,
  suffix: string,
) {
  const workspace = await send(
    fixture.socket,
    fixture.reader,
    `workspace-${suffix}`,
    'workspace.create',
    { folderPath: join(fixture.dir, suffix), name: `Workspace ${suffix}` },
  );
  expect(workspace.error).toBeUndefined();
  const workspaceId = (workspace.payload as { workspaceId: string }).workspaceId;

  const task = await send(fixture.socket, fixture.reader, `task-${suffix}`, 'task.create', {
    workspaceId,
    title: `Task ${suffix}`,
    goal: `Exercise mode policy ${suffix}`,
  });
  expect(task.error).toBeUndefined();
  expect(task.payload).toMatchObject({
    participationMode: 'conversation',
    taskVersion: 0,
  });
  const taskPayload = task.payload as {
    taskId: string;
    threadId: string;
    taskVersion: number;
    participationMode: string;
  };
  return { workspaceId, ...taskPayload };
}

describe('participation mode commands', () => {
  it('rejects a policy without a server-side approved plan', async () => {
    const fixture = await startFixture();
    try {
      const task = await createWorkspaceAndTask(fixture, 'double-gate-policy-only');
      await send(fixture.socket, fixture.reader, 'policy-only-collaboration', 'task.setParticipationMode', {
        taskId: task.taskId,
        mode: 'collaboration',
        expectedTaskVersion: 0,
      });
      const policy = await send(fixture.socket, fixture.reader, 'policy-only-save', 'policy.save', {
        workspaceId: task.workspaceId,
        scopeType: 'task',
        scopeId: task.taskId,
        approvalMode: 'request',
      });
      expect(policy.error).toBeUndefined();
      const automatic = await send(
        fixture.socket,
        fixture.reader,
        'policy-only-automatic',
        'task.setParticipationMode',
        { taskId: task.taskId, mode: 'automatic', expectedTaskVersion: 1 },
      );
      expect(automatic.error).toMatchObject({ code: 'approval.required' });
    } finally {
      await fixture.close();
    }
  });

  it('requires an approved plan and a policy in the target task or workspace scope', async () => {
    const fixture = await startFixture({ hasApprovedPlan: () => true });
    try {
      const target = await createWorkspaceAndTask(fixture, 'double-gate-target');
      const other = await createWorkspaceAndTask(fixture, 'double-gate-other');
      for (const task of [target, other]) {
        const collaboration = await send(
          fixture.socket,
          fixture.reader,
          `mode-collaboration-${task.taskId}`,
          'task.setParticipationMode',
          { taskId: task.taskId, mode: 'collaboration', expectedTaskVersion: 0 },
        );
        expect(collaboration.error).toBeUndefined();
      }

      const planOnly = await send(
        fixture.socket,
        fixture.reader,
        'mode-plan-only',
        'task.setParticipationMode',
        { taskId: target.taskId, mode: 'automatic', expectedTaskVersion: 1 },
      );
      expect(planOnly.error).toMatchObject({ code: 'approval.required' });

      const crossScopePolicy = await send(
        fixture.socket,
        fixture.reader,
        'policy-other-task',
        'policy.save',
        {
          workspaceId: other.workspaceId,
          scopeType: 'task',
          scopeId: other.taskId,
          approvalMode: 'request',
        },
      );
      expect(crossScopePolicy.error).toBeUndefined();
      const crossScope = await send(
        fixture.socket,
        fixture.reader,
        'mode-cross-scope',
        'task.setParticipationMode',
        { taskId: target.taskId, mode: 'automatic', expectedTaskVersion: 1 },
      );
      expect(crossScope.error).toMatchObject({ code: 'approval.required' });

      const applicablePolicy = await send(
        fixture.socket,
        fixture.reader,
        'policy-target-task',
        'policy.save',
        {
          workspaceId: target.workspaceId,
          scopeType: 'task',
          scopeId: target.taskId,
          approvalMode: 'request',
        },
      );
      expect(applicablePolicy.error).toBeUndefined();
      const both = await send(
        fixture.socket,
        fixture.reader,
        'mode-both-gates',
        'task.setParticipationMode',
        { taskId: target.taskId, mode: 'automatic', expectedTaskVersion: 1 },
      );
      expect(both.error).toBeUndefined();
    } finally {
      await fixture.close();
    }
  });

  it('projects mode on every Task summary, versions changes, emits an event, and rejects stale or unsafe requests', async () => {
    const fixture = await startFixture();
    try {
      const task = await createWorkspaceAndTask(fixture, 'guarded');

      const changed = await send(
        fixture.socket,
        fixture.reader,
        'mode-collaboration',
        'task.setParticipationMode',
        {
          taskId: task.taskId,
          mode: 'collaboration',
          expectedTaskVersion: 0,
        },
      );
      expect(changed.error).toBeUndefined();
      expect(changed.payload).toMatchObject({
        task: {
          taskId: task.taskId,
          participationMode: 'collaboration',
          taskVersion: 1,
        },
      });

      const listed = await send(fixture.socket, fixture.reader, 'tasks-list', 'task.list', {
        workspaceId: task.workspaceId,
      });
      expect(listed.payload).toMatchObject({
        tasks: [{ taskId: task.taskId, participationMode: 'collaboration', taskVersion: 1 }],
      });

      const opened = await send(fixture.socket, fixture.reader, 'task-open', 'task.open', {
        taskId: task.taskId,
      });
      expect(opened.payload).toMatchObject({
        task: { participationMode: 'collaboration', taskVersion: 1 },
      });

      const searched = await send(fixture.socket, fixture.reader, 'task-search', 'task.search', {
        workspaceId: task.workspaceId,
        query: 'guarded',
      });
      expect(searched.payload).toMatchObject({
        tasks: [{ taskId: task.taskId, participationMode: 'collaboration', taskVersion: 1 }],
      });

      const stale = await send(
        fixture.socket,
        fixture.reader,
        'mode-stale',
        'task.setParticipationMode',
        { taskId: task.taskId, mode: 'conversation', expectedTaskVersion: 0 },
      );
      expect(stale.error).toMatchObject({ code: 'task.version_mismatch' });

      const noResolver = await send(
        fixture.socket,
        fixture.reader,
        'mode-automatic-no-resolver',
        'task.setParticipationMode',
        { taskId: task.taskId, mode: 'automatic', expectedTaskVersion: 1 },
      );
      expect(noResolver.error).toMatchObject({ code: 'approval.required' });

      const clientClaim = await send(
        fixture.socket,
        fixture.reader,
        'mode-client-approved-plan',
        'task.setParticipationMode',
        {
          taskId: task.taskId,
          mode: 'automatic',
          expectedTaskVersion: 1,
          approvedPlan: true,
        },
      );
      expect(clientClaim.error).toMatchObject({ code: 'protocol.frame_malformed' });

      const replay = await send(
        fixture.socket,
        fixture.reader,
        'mode-events',
        'runtime.subscribeEvents',
        { afterCursor: 0 },
      );
      expect(replay.payload).toMatchObject({
        replayedEvents: [
          {
            workspaceId: task.workspaceId,
            category: 'system',
            type: 'task.participation-mode.changed',
            taskId: task.taskId,
            payload: {
              taskId: task.taskId,
              previousMode: 'conversation',
              participationMode: 'collaboration',
              taskVersion: 1,
            },
          },
        ],
      });
    } finally {
      await fixture.close();
    }
  });

  it('uses only the server-side approved-plan resolver to enter automatic and allows downgrade', async () => {
    const resolvedTaskIds: string[] = [];
    const fixture = await startFixture({
      hasApprovedPlan(taskId) {
        resolvedTaskIds.push(taskId);
        return true;
      },
    });
    try {
      const task = await createWorkspaceAndTask(fixture, 'approved');
      const collaboration = await send(
        fixture.socket,
        fixture.reader,
        'mode-approved-collaboration',
        'task.setParticipationMode',
        { taskId: task.taskId, mode: 'collaboration', expectedTaskVersion: 0 },
      );
      expect(collaboration.error).toBeUndefined();
      const policy = await send(fixture.socket, fixture.reader, 'mode-approved-policy', 'policy.save', {
        workspaceId: task.workspaceId,
        scopeType: 'task',
        scopeId: task.taskId,
        approvalMode: 'request',
      });
      expect(policy.error).toBeUndefined();

      const automatic = await send(
        fixture.socket,
        fixture.reader,
        'mode-approved-automatic',
        'task.setParticipationMode',
        { taskId: task.taskId, mode: 'automatic', expectedTaskVersion: 1 },
      );
      expect(automatic.error).toBeUndefined();
      expect(automatic.payload).toMatchObject({
        task: { participationMode: 'automatic', taskVersion: 2 },
      });
      expect(resolvedTaskIds).toEqual([task.taskId]);

      const conversation = await send(
        fixture.socket,
        fixture.reader,
        'mode-approved-conversation',
        'task.setParticipationMode',
        { taskId: task.taskId, mode: 'conversation', expectedTaskVersion: 2 },
      );
      expect(conversation.error).toBeUndefined();
      expect(conversation.payload).toMatchObject({
        task: { participationMode: 'conversation', taskVersion: 3 },
      });
      expect(resolvedTaskIds).toEqual([task.taskId]);
    } finally {
      await fixture.close();
    }
  });

  it('uses each durable task workspace and replays the global stream after restart', async () => {
    const fixture = await startFixture();
    let firstClosed = false;
    try {
      const taskA = await createWorkspaceAndTask(fixture, 'event-workspace-a');
      const taskB = await createWorkspaceAndTask(fixture, 'event-workspace-b');

      const appended = await send(fixture.socket, fixture.reader, 'event-message-a', 'task.appendMessage', {
        threadId: taskA.threadId,
        expectedTaskVersion: 0,
        role: 'user',
        text: 'workspace A message',
      });
      expect(appended.error).toBeUndefined();
      const modeA = await send(
        fixture.socket,
        fixture.reader,
        'event-mode-a',
        'task.setParticipationMode',
        { taskId: taskA.taskId, mode: 'collaboration', expectedTaskVersion: 1 },
      );
      expect(modeA.error).toBeUndefined();
      const modeB = await send(
        fixture.socket,
        fixture.reader,
        'event-mode-b',
        'task.setParticipationMode',
        { taskId: taskB.taskId, mode: 'collaboration', expectedTaskVersion: 0 },
      );
      expect(modeB.error).toBeUndefined();

      const liveRuntime = await send(
        fixture.socket,
        fixture.reader,
        'event-global-before-restart',
        'runtime.subscribeEvents',
        { afterCursor: 0 },
      );
      const expectedStream = [
        [taskA.workspaceId, 'message.appended', 1],
        [taskA.workspaceId, 'task.participation-mode.changed', 2],
        [taskB.workspaceId, 'task.participation-mode.changed', 3],
      ];
      expect(
        (
          liveRuntime.payload as {
            replayedEvents: Array<{ workspaceId: string; type: string; sequence: number }>;
          }
        ).replayedEvents.map((event) => [event.workspaceId, event.type, event.sequence]),
      ).toEqual(expectedStream);

      await fixture.close();
      firstClosed = true;

      const installId = `mode-policy-restart-${randomBytes(5).toString('hex')}`;
      const reopened = await openPersistentRuntime({
        dbPath: fixture.dbPath,
        secureStoreKeyPath: fixture.secureStoreKeyPath,
        installId,
        allowNoToken: true,
      });
      await reopened.runtime.start();
      const socket = connect(pipePathPortable(installId));
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      const reader = createFrameReader(socket);
      try {
        const hello = await send(socket, reader, 'hello-restart', '__hello', {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: randomBytes(8).toString('hex'),
          features: ['runtime.subscribeEvents'],
        });
        expect(hello.payload).toMatchObject({ ok: true });
        const replay = await send(
          socket,
          reader,
          'event-global-after-restart',
          'runtime.subscribeEvents',
          { afterCursor: 0 },
        );
        expect(
          (
            replay.payload as {
              replayedEvents: Array<{ workspaceId: string; type: string; sequence: number }>;
            }
          ).replayedEvents.map((event) => [event.workspaceId, event.type, event.sequence]),
        ).toEqual(expectedStream);
      } finally {
        socket.destroy();
        await reopened.close();
      }
    } finally {
      if (!firstClosed) await fixture.close();
    }
  });
});

describe('scoped policy commands', () => {
  it('saves immutable versions and resolves the server-built workspace/task chain', async () => {
    const fixture = await startFixture();
    try {
      const task = await createWorkspaceAndTask(fixture, 'policy-chain');
      const save = (id: string, payload: unknown) =>
        send(fixture.socket, fixture.reader, id, 'policy.save', payload);

      const workspaceV1 = await save('policy-workspace-v1', {
        workspaceId: task.workspaceId,
        policyId: 'policy-workspace',
        scopeType: 'workspace',
        scopeId: task.workspaceId,
        approvalMode: 'full',
        rules: [{ action: 'shell.exec', approvalMode: 'full' }],
      });
      expect(workspaceV1.error).toBeUndefined();
      expect(workspaceV1.payload).toMatchObject({
        policy: { policyId: 'policy-workspace', version: 1, approvalMode: 'full' },
      });

      const workspaceV2 = await save('policy-workspace-v2', {
        workspaceId: task.workspaceId,
        policyId: 'policy-workspace',
        scopeType: 'workspace',
        scopeId: task.workspaceId,
        approvalMode: 'request',
        rules: [{ action: 'shell.exec', approvalMode: 'request' }],
      });
      expect(workspaceV2.error).toBeUndefined();
      expect(workspaceV2.payload).toMatchObject({
        policy: { policyId: 'policy-workspace', version: 2, approvalMode: 'request' },
      });
      expect(
        (workspaceV2.payload as { policy: { id: string } }).policy.id,
      ).not.toBe((workspaceV1.payload as { policy: { id: string } }).policy.id);

      const taskV1 = await save('policy-task-v1', {
        workspaceId: task.workspaceId,
        policyId: 'policy-task',
        scopeType: 'task',
        scopeId: task.taskId,
        approvalMode: 'delegate',
        rules: [{ action: 'browser.navigate', approvalMode: 'delegate' }],
      });
      expect(taskV1.error).toBeUndefined();

      const applicable = await send(
        fixture.socket,
        fixture.reader,
        'policy-applicable',
        'policy.list',
        {
          workspaceId: task.workspaceId,
          taskId: task.taskId,
        },
      );
      expect(applicable.error).toBeUndefined();
      expect(applicable.payload).toMatchObject({
        policies: [
          { policyId: 'policy-workspace', version: 2 },
          { policyId: 'policy-task', version: 1 },
        ],
        resolved: {
          approvalMode: 'request',
          rules: [
            { action: 'browser.navigate', approvalMode: 'delegate' },
            { action: 'shell.exec', approvalMode: 'request' },
          ],
        },
      });

      const replay = await send(
        fixture.socket,
        fixture.reader,
        'policy-events',
        'runtime.subscribeEvents',
        { afterCursor: 0, categories: ['approval'] },
      );
      const events = (replay.payload as { replayedEvents: Array<{ type: string }> })
        .replayedEvents;
      expect(events).toHaveLength(3);
      expect(events.every((event) => event.type === 'approval.policy.saved')).toBe(true);
    } finally {
      await fixture.close();
    }
  });

  it.each([
    ['unknown scope', { scopeType: 'organization', scopeId: 'scope-1', approvalMode: 'full' }],
    ['unknown mode', { scopeType: 'task', scopeId: 'task-1', approvalMode: 'silent' }],
    [
      'empty rule action',
      {
        scopeType: 'task',
        scopeId: 'task-1',
        approvalMode: 'custom',
        rules: [{ action: '  ', approvalMode: 'full' }],
      },
    ],
    [
      'unknown rule mode',
      {
        scopeType: 'task',
        scopeId: 'task-1',
        approvalMode: 'custom',
        rules: [{ action: 'shell.exec', approvalMode: 'silent' }],
      },
    ],
    [
      'malformed rule',
      {
        scopeType: 'task',
        scopeId: 'task-1',
        approvalMode: 'custom',
        rules: [{ approvalMode: 'full' }],
      },
    ],
  ])('rejects malformed policy.save payload: %s', async (_name, payload) => {
    const fixture = await startFixture();
    try {
      const response = await send(
        fixture.socket,
        fixture.reader,
        'policy-malformed',
        'policy.save',
        { workspaceId: 'workspace-context', ...payload },
      );
      expect(response.error).toMatchObject({ code: 'protocol.frame_malformed' });
    } finally {
      await fixture.close();
    }
  });

  it('rejects empty policy.list payloads, client scopes, and unknown workspaces', async () => {
    const fixture = await startFixture();
    try {
      const empty = await send(fixture.socket, fixture.reader, 'policy-list-empty', 'policy.list', {});
      expect(empty.error).toMatchObject({ code: 'protocol.frame_malformed' });

      const clientScopes = await send(
        fixture.socket,
        fixture.reader,
        'policy-list-client-scopes',
        'policy.list',
        {
          workspaceId: 'workspace-arbitrary',
          scopes: [{ scopeType: 'workspace', scopeId: 'workspace-other' }],
        },
      );
      expect(clientScopes.error).toMatchObject({ code: 'protocol.frame_malformed' });

      const unknownWorkspace = await send(
        fixture.socket,
        fixture.reader,
        'policy-list-unknown-workspace',
        'policy.list',
        { workspaceId: 'workspace-missing' },
      );
      expect(unknownWorkspace.error).toMatchObject({ code: 'workspace.not_found' });
    } finally {
      await fixture.close();
    }
  });

  it('rejects a task outside the workspace without persisting policy or event', async () => {
    const fixture = await startFixture();
    try {
      const workspaceTask = await createWorkspaceAndTask(fixture, 'policy-workspace-a');
      const otherTask = await createWorkspaceAndTask(fixture, 'policy-workspace-b');
      const response = await send(
        fixture.socket,
        fixture.reader,
        'policy-cross-workspace',
        'policy.save',
        {
          workspaceId: workspaceTask.workspaceId,
          policyId: 'policy-cross-workspace',
          scopeType: 'task',
          scopeId: otherTask.taskId,
          approvalMode: 'full',
          rules: [],
        },
      );
      expect(response.error).toMatchObject({ code: 'task.not_found' });

      const listed = await send(
        fixture.socket,
        fixture.reader,
        'policy-cross-list',
        'policy.list',
        { workspaceId: workspaceTask.workspaceId, taskId: workspaceTask.taskId },
      );
      expect(listed.payload).toMatchObject({ policies: [] });

      const replay = await send(
        fixture.socket,
        fixture.reader,
        'policy-cross-events',
        'runtime.subscribeEvents',
        { afterCursor: 0, categories: ['approval'] },
      );
      expect(replay.payload).toMatchObject({ replayedEvents: [] });
    } finally {
      await fixture.close();
    }
  });
});
