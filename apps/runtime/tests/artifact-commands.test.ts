import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import {
  ulid,
  type AgentVersionId,
  type RunId,
  type StepId,
  type TaskId,
} from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteArtifactStore,
  SqliteEventCheckpointStore,
  SqliteOrchestrationStore,
  SqliteUnitOfWork,
  SqliteWorkspaceStore,
  type BetterSQLite3Raw,
} from '@sync-think/storage';
import { afterEach, describe, expect, it } from 'vitest';
import { Runtime, type RuntimeStateStore } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createFrameReader(socket: Socket) {
  const queued: Frame[] = [];
  const waiters: Array<{ resolve: (frame: Frame) => void; reject: (error: unknown) => void }> = [];
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    try {
      const decoded = decodeFrames(Buffer.concat([pending, chunk]));
      pending = decoded.remaining;
      for (const frame of decoded.frames) {
        const waiter = waiters.shift();
        if (waiter) waiter.resolve(frame);
        else queued.push(frame);
      }
    } catch (error) {
      while (waiters.length > 0) waiters.shift()!.reject(error);
    }
  });
  socket.on('error', (error) => {
    while (waiters.length > 0) waiters.shift()!.reject(error);
  });
  return {
    read(): Promise<Frame> {
      const frame = queued.shift();
      if (frame) return Promise.resolve(frame);
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
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
  const response = reader.read();
  socket.write(encodeFrame({ id, kind: 'request', type, payload }));
  return response;
}

async function connectAndHello(installId: string) {
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
      'artifact.list',
      'artifact.getVersion',
      'artifact.compare',
      'artifact.selectVersion',
      'artifact.merge',
      'artifact.listConflicts',
      'artifact.resolveConflict',
      'run.resume',
    ],
  });
  expect(hello.payload).toMatchObject({ ok: true });
  return { socket, reader };
}

function seedAgentVersion(raw: BetterSQLite3Raw): AgentVersionId {
  const id = ulid() as AgentVersionId;
  raw.prepare(
    `INSERT INTO agent_version (
       id, agent_id, version, name, role, developer_instructions, input_contract,
       output_contract, default_model_id, default_credential_group_id,
       pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
       memory_scope, skill_version_ids_json, mcp_server_ids_json, policy_id,
       approval_mode, created_at
     ) VALUES (?, ?, 1, 'Artifact worker', 'worker', '', '', '', ?, ?, NULL, 1, '[]', 'task', '[]', '[]', NULL, 'request', ?)`,
  ).run(id, ulid(), ulid(), ulid(), new Date().toISOString());
  return id;
}

function seedRun(raw: BetterSQLite3Raw, taskId: TaskId, agentVersionId: AgentVersionId) {
  const planId = ulid();
  const planRevisionId = ulid();
  const runId = ulid() as RunId;
  const leftStepId = `step-left-${runId}` as StepId;
  const rightStepId = `step-right-${runId}` as StepId;
  const stepId = `step-merge-${runId}` as StepId;
  const now = new Date().toISOString();
  raw.prepare('INSERT INTO plan (id, task_id, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(planId, taskId, now, now);
  const planSteps = [
    { id: leftStepId, kind: 'execution', dependsOn: [] },
    { id: rightStepId, kind: 'execution', dependsOn: [] },
    { id: stepId, kind: 'merge', dependsOn: [leftStepId, rightStepId] },
  ].map((step, index) => ({
    ...step,
    title: `Artifact Step ${index + 1}`,
    instructions: `Complete Artifact Step ${index + 1}`,
    agentVersionId,
  }));
  raw.prepare(
    `INSERT INTO plan_revision (
       id, plan_id, revision, title, steps_json, diff_json, state, created_at, approved_at
     ) VALUES (?, ?, 1, 'Artifact plan', ?, ?, 'approved', ?, ?)`,
  ).run(
    planRevisionId,
    planId,
    JSON.stringify(planSteps),
    '{"added":[],"removed":[],"changed":[]}',
    now,
    now,
  );
  raw.prepare(
    `INSERT INTO run (id, task_id, plan_revision_id, state, created_at, updated_at)
     VALUES (?, ?, ?, 'running', ?, ?)`,
  ).run(runId, taskId, planRevisionId, now, now);
  const insertStep = raw.prepare(
    `INSERT INTO step (
       id, run_id, kind, plan_order, title, instructions, agent_version_id, state,
       retries, execution_attempt,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, '', ?, ?, 0, 0, ?, ?)`,
  );
  insertStep.run(leftStepId, runId, 'execution', 0, 'Left producer', agentVersionId, 'completed', now, now);
  insertStep.run(rightStepId, runId, 'execution', 1, 'Right producer', agentVersionId, 'completed', now, now);
  insertStep.run(stepId, runId, 'merge', 2, 'Merge artifact', agentVersionId, 'ready', now, now);
  raw.prepare(
    'INSERT INTO step_dependency (run_id, step_id, depends_on_step_id) VALUES (?, ?, ?)',
  ).run(runId, stepId, leftStepId);
  raw.prepare(
    'INSERT INTO step_dependency (run_id, step_id, depends_on_step_id) VALUES (?, ?, ?)',
  ).run(runId, stepId, rightStepId);
  return { runId, stepId, executionStepId: leftStepId, leftStepId, rightStepId };
}

async function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-artifact-runtime-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const artifactStore = new SqliteArtifactStore(connection.raw);
  const persistedState = new SqliteEventCheckpointStore(connection.raw);
  const workspace = workspaceStore.createWorkspace({ folderPath: dir, name: 'Artifacts' });
  const task = workspaceStore.createTask({
    workspaceId: workspace.id,
    title: 'Artifact task',
    goal: 'Compare and merge immutable versions',
  });
  const agentVersionId = seedAgentVersion(connection.raw);
  const seededRun = seedRun(connection.raw, task.taskId, agentVersionId);
  const artifact = artifactStore.createArtifact({
    workspaceId: workspace.id,
    taskId: task.taskId,
    runId: seededRun.runId,
    name: 'draft.txt',
  });
  return {
    raw: connection.raw,
    workspaceStore,
    artifactStore,
    persistedState,
    workspace,
    task,
    artifact,
    agentVersionId,
    ...seededRun,
    close: () => connection.raw.close(),
  };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

function createRuntime(fixture: Fixture, stateStore: RuntimeStateStore = fixture.persistedState) {
  const installId = `artifact-${randomBytes(5).toString('hex')}`;
  const runtime = new Runtime({
    installId,
    allowNoToken: true,
    workspaceId: fixture.workspace.id,
    workspaceStore: fixture.workspaceStore,
    artifactStore: fixture.artifactStore,
    orchestrationStore: new SqliteOrchestrationStore(fixture.raw),
    stateStore,
    unitOfWork: new SqliteUnitOfWork(fixture.raw),
  });
  return { runtime, installId };
}

function createTextVersion(
  fixture: Fixture,
  content: string,
  parentVersionIds: readonly import('@sync-think/shared').ArtifactVersionId[] = [],
  sourceStepId: StepId = fixture.leftStepId,
) {
  return fixture.artifactStore.createVersion({
    artifactId: fixture.artifact.id,
    sourceStepId,
    content,
    mimeType: 'text/plain',
    status: 'candidate',
    parentVersionIds,
  });
}

function scope(fixture: Fixture) {
  return {
    workspaceId: fixture.workspace.id,
    taskId: fixture.task.taskId,
    runId: fixture.runId,
  };
}

describe('artifact query commands', () => {
  it('returns stable comparisons and rejects cross-task reads and strict-parser violations', async () => {
    const fixture = await createFixture();
    const left = createTextVersion(fixture, 'alpha\nleft\nomega');
    const right = createTextVersion(fixture, 'alpha\nright\nomega');
    const otherTask = fixture.workspaceStore.createTask({
      workspaceId: fixture.workspace.id,
      title: 'Other task',
      goal: 'Must not read the first task',
    });
    const otherRun = seedRun(fixture.raw, otherTask.taskId, fixture.agentVersionId);
    const { runtime, installId } = createRuntime(fixture);
    await runtime.start();
    const client = await connectAndHello(installId);
    try {
      const listed = await send(client.socket, client.reader, 'list', 'artifact.list', scope(fixture));
      expect(listed.error).toBeUndefined();
      expect((listed.payload as { artifacts: unknown[] }).artifacts).toHaveLength(1);
      const listedVersion = (
        listed.payload as { artifacts: Array<{ versions: Array<Record<string, unknown>> }> }
      ).artifacts[0]!.versions[0]!;
      expect(listedVersion).not.toHaveProperty('content');
      expect(listedVersion).toMatchObject({ hasInlineContent: true });

      const comparePayload = {
        ...scope(fixture),
        leftVersionId: left.id,
        rightVersionId: right.id,
      };
      const first = await send(client.socket, client.reader, 'compare-1', 'artifact.compare', comparePayload);
      const second = await send(client.socket, client.reader, 'compare-2', 'artifact.compare', comparePayload);
      expect(first.error).toBeUndefined();
      expect(second.payload).toEqual(first.payload);

      const crossTask = await send(client.socket, client.reader, 'cross-task', 'artifact.getVersion', {
        workspaceId: fixture.workspace.id,
        taskId: otherTask.taskId,
        runId: otherRun.runId,
        artifactVersionId: left.id,
      });
      expect(crossTask.error).toMatchObject({ code: 'protocol.unexpected_request' });
      const unknownField = await send(client.socket, client.reader, 'unknown', 'artifact.list', {
        ...scope(fixture),
        extra: true,
      });
      expect(unknownField.error).toMatchObject({ code: 'protocol.frame_malformed' });
      const invalidId = await send(client.socket, client.reader, 'invalid-id', 'artifact.getVersion', {
        ...scope(fixture),
        artifactVersionId: 'not-an-id',
      });
      expect(invalidId.error).toMatchObject({ code: 'protocol.frame_malformed' });
    } finally {
      client.socket.destroy();
      await runtime.stop();
      fixture.close();
    }
  });

  it('strictly paginates summary-only lists and keeps escaping-heavy queries frame-safe', async () => {
    const fixture = await createFixture();
    const controlLeft = createTextVersion(fixture, '\u0000'.repeat(48 * 1024));
    const controlRight = createTextVersion(fixture, '\u0001'.repeat(48 * 1024));
    for (let index = 0; index < 4; index += 1) {
      const artifact = fixture.artifactStore.createArtifact({
        workspaceId: fixture.workspace.id,
        taskId: fixture.task.taskId,
        runId: fixture.runId,
        name: `page-${index}.txt`,
        now: `page-${index}`,
      });
      fixture.artifactStore.createVersion({
        artifactId: artifact.id,
        sourceStepId: fixture.stepId,
        contentRef: `D:\\artifacts\\page-${index}.txt`,
        contentHash: 'a'.repeat(64),
        mimeType: 'text/plain',
        status: 'candidate',
      });
    }
    const { runtime, installId } = createRuntime(fixture);
    await runtime.start();
    const client = await connectAndHello(installId);
    try {
      const first = await send(client.socket, client.reader, 'page-1', 'artifact.list', {
        ...scope(fixture),
        limit: 2,
      });
      expect(first.error).toBeUndefined();
      expect(first.payload).toMatchObject({
        artifacts: expect.any(Array),
        nextCursor: expect.any(String),
      });
      const firstPayload = first.payload as {
        artifacts: Array<{ versions: Array<Record<string, unknown>> }>;
        nextCursor: string;
      };
      expect(firstPayload.artifacts).toHaveLength(2);
      for (const item of firstPayload.artifacts) {
        for (const version of item.versions) {
          expect(version).not.toHaveProperty('content');
          expect(version).not.toHaveProperty('contentRef');
          expect(version).not.toHaveProperty('metadata');
          expect(version).toMatchObject({
            hasInlineContent: expect.any(Boolean),
            hasContentRef: expect.any(Boolean),
          });
        }
      }
      const second = await send(client.socket, client.reader, 'page-2', 'artifact.list', {
        ...scope(fixture),
        limit: 2,
        cursor: firstPayload.nextCursor,
      });
      expect(second.error).toBeUndefined();
      expect((second.payload as { artifacts: unknown[] }).artifacts).toHaveLength(2);

      for (const limit of [0, -1, 9, 1.5]) {
        const invalid = await send(client.socket, client.reader, `bad-limit-${limit}`, 'artifact.list', {
          ...scope(fixture),
          limit,
        });
        expect(invalid.error).toMatchObject({ code: 'protocol.frame_malformed' });
      }

      const get = await send(client.socket, client.reader, 'escaped-get', 'artifact.getVersion', {
        ...scope(fixture),
        artifactVersionId: controlLeft.id,
      });
      expect(get.error).toBeUndefined();
      expect((get.payload as { version: { content: string } }).version.content).toHaveLength(
        48 * 1024,
      );
      const compare = await send(client.socket, client.reader, 'escaped-compare', 'artifact.compare', {
        ...scope(fixture),
        leftVersionId: controlLeft.id,
        rightVersionId: controlRight.id,
      });
      expect(compare.error).toBeUndefined();
      expect(compare.payload).toMatchObject({
        comparison: { kind: 'text', equal: false },
      });
    } finally {
      client.socket.destroy();
      await runtime.stop();
      fixture.close();
    }
  });
});

describe('artifact mutation commands', () => {
  it('rejects an execution Step as the merge source even when it belongs to the owning Run', async () => {
    const fixture = await createFixture();
    const base = createTextVersion(fixture, 'base');
    const left = createTextVersion(fixture, 'left', [base.id]);
    const right = createTextVersion(fixture, 'base', [base.id], fixture.rightStepId);
    const { runtime, installId } = createRuntime(fixture);
    await runtime.start();
    const client = await connectAndHello(installId);
    try {
      const response = await send(client.socket, client.reader, 'merge-execution-source', 'artifact.merge', {
        ...scope(fixture),
        artifactId: fixture.artifact.id,
        baseVersionId: base.id,
        leftVersionId: left.id,
        rightVersionId: right.id,
        sourceStepId: fixture.executionStepId,
        operationId: ulid(),
        expectedTaskVersion: 0,
      });

      expect(response.error).toMatchObject({
        code: 'protocol.unexpected_request',
        message: expect.stringMatching(/merge Step/i),
      });
      expect(fixture.workspaceStore.getTask(fixture.task.taskId)?.version).toBe(0);
    } finally {
      client.socket.destroy();
      await runtime.stop();
      fixture.close();
    }
  });

  it('selects with an append-only record and idempotently replays without changing history', async () => {
    const fixture = await createFixture();
    const version = createTextVersion(fixture, 'candidate content');
    const { runtime, installId } = createRuntime(fixture);
    await runtime.start();
    const client = await connectAndHello(installId);
    try {
      const payload = {
        ...scope(fixture),
        artifactId: fixture.artifact.id,
        artifactVersionId: version.id,
        operationId: ulid(),
        expectedTaskVersion: 0,
      };
      const selected = await send(client.socket, client.reader, 'select', 'artifact.selectVersion', payload);
      const replay = await send(client.socket, client.reader, 'select-replay', 'artifact.selectVersion', payload);
      expect(selected.error).toBeUndefined();
      expect(replay.payload).toEqual(selected.payload);
      expect(fixture.workspaceStore.getTask(fixture.task.taskId)?.version).toBe(1);
      expect(fixture.artifactStore.getVersion(version.id)).toEqual(version);
      expect(fixture.artifactStore.listSelections(fixture.artifact.id)).toHaveLength(1);
      const events = fixture.persistedState.listEvents(fixture.workspace.id, 0);
      expect(events.map((event) => event.type)).toEqual(['artifact.selected']);
      expect(events[0]!.payload).not.toHaveProperty('content');
    } finally {
      client.socket.destroy();
      await runtime.stop();
      fixture.close();
    }
  });

  it('creates a clean immutable merge with two parents and no content in its event', async () => {
    const fixture = await createFixture();
    const base = createTextVersion(fixture, 'base');
    const left = createTextVersion(fixture, 'left', [base.id]);
    const right = createTextVersion(fixture, 'base', [base.id], fixture.rightStepId);
    const { runtime, installId } = createRuntime(fixture);
    await runtime.start();
    const client = await connectAndHello(installId);
    try {
      const mergePayload = {
        ...scope(fixture),
        artifactId: fixture.artifact.id,
        baseVersionId: base.id,
        leftVersionId: left.id,
        rightVersionId: right.id,
        sourceStepId: fixture.stepId,
        operationId: ulid(),
        expectedTaskVersion: 0,
      };
      const merged = await send(
        client.socket,
        client.reader,
        'merge',
        'artifact.merge',
        mergePayload,
      );
      expect(merged.error).toBeUndefined();
      expect(merged.payload).toMatchObject({ status: 'clean', taskVersion: 1 });
      expect((merged.payload as { version: Record<string, unknown> }).version).not.toHaveProperty(
        'content',
      );
      expect((merged.payload as { version: Record<string, unknown> }).version).not.toHaveProperty(
        'contentRef',
      );
      expect((merged.payload as { version: Record<string, unknown> }).version).not.toHaveProperty(
        'metadata',
      );
      expect((merged.payload as { version: Record<string, unknown> }).version).toMatchObject({
        hasInlineContent: true,
        hasContentRef: false,
      });
      const versionId = (merged.payload as { version: { id: string } }).version.id;
      expect(fixture.artifactStore.getVersion(versionId as never)).toMatchObject({
        content: 'left',
        version: 4,
        status: 'merged',
        parentVersionIds: [left.id, right.id],
      });
      expect(fixture.artifactStore.getVersion(base.id)?.content).toBe('base');
      expect(
        new SqliteOrchestrationStore(fixture.raw).getGraph(fixture.runId)?.steps.find(
          (step) => step.id === fixture.stepId,
        ),
      ).toMatchObject({ kind: 'merge', state: 'completed' });
      expect(new SqliteOrchestrationStore(fixture.raw).getGraph(fixture.runId)?.run.state).toBe(
        'completed',
      );

      const replay = await send(
        client.socket,
        client.reader,
        'merge-replay',
        'artifact.merge',
        mergePayload,
      );
      expect(replay.payload).toEqual(merged.payload);
      expect(fixture.artifactStore.listVersions(fixture.artifact.id)).toHaveLength(4);
      const events = fixture.persistedState.listEvents(fixture.workspace.id, 0);
      expect(events.map((event) => event.type)).toEqual([
        'artifact.merged',
        'step.completed',
        'run.completed',
      ]);
      expect(events[0]!.payload).not.toHaveProperty('content');
    } finally {
      client.socket.destroy();
      await runtime.stop();
      fixture.close();
    }
  });

  it('atomically rolls back a conflict pause/event/checkpoint and retries without duplicates', async () => {
    const fixture = await createFixture();
    const base = createTextVersion(fixture, 'base');
    const left = createTextVersion(fixture, 'left', [base.id]);
    const right = createTextVersion(fixture, 'right', [base.id], fixture.rightStepId);
    let failCommit = true;
    const stateStore: RuntimeStateStore = {
      commitTransition(input) {
        const committed = fixture.persistedState.commitTransition(input);
        if (failCommit) throw new Error('forced event/checkpoint failure');
        return committed;
      },
      listEvents: (workspaceId, afterSequence) =>
        fixture.persistedState.listEvents(workspaceId, afterSequence),
      listAllEvents: (afterSequence) => fixture.persistedState.listAllEvents(afterSequence),
      loadLatestCheckpoint: (id) => fixture.persistedState.loadLatestCheckpoint(id),
    };
    const { runtime, installId } = createRuntime(fixture, stateStore);
    await runtime.start();
    const client = await connectAndHello(installId);
    const payload = {
      ...scope(fixture),
      artifactId: fixture.artifact.id,
      baseVersionId: base.id,
      leftVersionId: left.id,
      rightVersionId: right.id,
      sourceStepId: fixture.stepId,
      operationId: ulid(),
      expectedTaskVersion: 0,
    };
    try {
      const failed = await send(client.socket, client.reader, 'conflict-fail', 'artifact.merge', payload);
      expect(failed.error).toMatchObject({ code: 'storage.write_failed' });
      expect(fixture.workspaceStore.getTask(fixture.task.taskId)?.version).toBe(0);
      expect(fixture.artifactStore.listMergeConflicts(fixture.artifact.id)).toEqual([]);
      expect(fixture.raw.prepare('SELECT state FROM run WHERE id = ?').get(fixture.runId)).toEqual({ state: 'running' });
      expect(fixture.persistedState.listEvents(fixture.workspace.id, 0)).toEqual([]);
      expect((fixture.raw.prepare('SELECT COUNT(*) AS count FROM checkpoint').get() as { count: number }).count).toBe(0);

      failCommit = false;
      const retried = await send(client.socket, client.reader, 'conflict-retry', 'artifact.merge', payload);
      const replay = await send(client.socket, client.reader, 'conflict-replay', 'artifact.merge', payload);
      expect(retried.error).toBeUndefined();
      expect(retried.payload).toMatchObject({ status: 'conflict', taskVersion: 1, runState: 'paused' });
      expect(replay.payload).toEqual(retried.payload);
      expect(fixture.artifactStore.listMergeConflicts(fixture.artifact.id)).toHaveLength(1);
      expect(fixture.raw.prepare('SELECT state FROM run WHERE id = ?').get(fixture.runId)).toEqual({ state: 'paused' });
      expect(fixture.persistedState.listEvents(fixture.workspace.id, 0).map((event) => event.type)).toEqual([
        'artifact.merge-conflicted',
        'run.paused',
      ]);
      expect((fixture.raw.prepare('SELECT COUNT(*) AS count FROM checkpoint').get() as { count: number }).count).toBe(1);
    } finally {
      client.socket.destroy();
      await runtime.stop();
      fixture.close();
    }
  });

  it('blocks Resume until an append-only conflict resolution completes the explicit merge Step', async () => {
    const fixture = await createFixture();
    const base = createTextVersion(fixture, 'base');
    const left = createTextVersion(fixture, 'left', [base.id]);
    const right = createTextVersion(fixture, 'right', [base.id], fixture.rightStepId);
    const { runtime, installId } = createRuntime(fixture);
    await runtime.start();
    const client = await connectAndHello(installId);
    try {
      const merged = await send(client.socket, client.reader, 'resolve-conflict-merge', 'artifact.merge', {
        ...scope(fixture),
        artifactId: fixture.artifact.id,
        baseVersionId: base.id,
        leftVersionId: left.id,
        rightVersionId: right.id,
        sourceStepId: fixture.stepId,
        operationId: ulid(),
        expectedTaskVersion: 0,
      });
      expect(merged.payload).toMatchObject({ status: 'conflict', taskVersion: 1 });
      const conflictId = (merged.payload as { conflict: { id: string } }).conflict.id;

      const blockedResume = await send(client.socket, client.reader, 'resolve-conflict-resume-blocked', 'run.resume', {
        ...scope(fixture),
        expectedTaskVersion: 1,
      });
      expect(blockedResume.error).toMatchObject({
        code: 'run.invalid_state',
        message: expect.stringContaining('run.merge_conflict_unresolved'),
      });
      expect(fixture.workspaceStore.getTask(fixture.task.taskId)?.version).toBe(1);

      const listed = await send(
        client.socket,
        client.reader,
        'resolve-conflict-list',
        'artifact.listConflicts',
        scope(fixture),
      );
      expect(listed.payload).toMatchObject({
        conflicts: [
          {
            conflict: { id: conflictId, sourceStepId: fixture.stepId },
          },
        ],
      });
      expect(
        (listed.payload as { conflicts: Array<Record<string, unknown>> }).conflicts[0],
      ).not.toHaveProperty('resolution');

      const resolutionOperationId = ulid();
      const resolved = await send(
        client.socket,
        client.reader,
        'resolve-conflict-manual',
        'artifact.resolveConflict',
        {
          ...scope(fixture),
          conflictId,
          strategy: 'manual',
          content: 'left\nright',
          operationId: resolutionOperationId,
          expectedTaskVersion: 1,
        },
      );
      expect(resolved.error).toBeUndefined();
      expect(resolved.payload).toMatchObject({
        resolution: { conflictId, strategy: 'manual', operationId: resolutionOperationId },
        version: {
          sourceStepId: fixture.stepId,
          status: 'merged',
          parentVersionIds: [left.id, right.id],
        },
        runState: 'paused',
        taskVersion: 2,
      });
      expect(
        new SqliteOrchestrationStore(fixture.raw).getGraph(fixture.runId)?.steps.find(
          (step) => step.id === fixture.stepId,
        ),
      ).toMatchObject({ kind: 'merge', state: 'completed' });

      const replay = await send(
        client.socket,
        client.reader,
        'resolve-conflict-manual-replay',
        'artifact.resolveConflict',
        {
          ...scope(fixture),
          conflictId,
          strategy: 'manual',
          content: 'left\nright',
          operationId: resolutionOperationId,
          expectedTaskVersion: 1,
        },
      );
      expect(replay.payload).toEqual(resolved.payload);

      const resumed = await send(client.socket, client.reader, 'resolve-conflict-resume', 'run.resume', {
        ...scope(fixture),
        expectedTaskVersion: 2,
      });
      expect(resumed.error).toBeUndefined();
      expect(resumed.payload).toMatchObject({ run: { state: 'completed' }, taskVersion: 3 });
      expect(
        fixture.raw.prepare('SELECT COUNT(*) AS count FROM artifact_merge_conflict_resolution').get(),
      ).toEqual({ count: 1 });
      expect(fixture.persistedState.listEvents(fixture.workspace.id, 0).map((event) => event.type)).toEqual(
        expect.arrayContaining([
          'artifact.merge-conflicted',
          'artifact.merge-conflict-resolved',
          'step.completed',
          'run.completed',
        ]),
      );
    } finally {
      client.socket.destroy();
      await runtime.stop();
      fixture.close();
    }
  });

  it('rejects same-version and cross-Run merges before changing task state', async () => {
    const fixture = await createFixture();
    const base = createTextVersion(fixture, 'base');
    const left = createTextVersion(fixture, 'left', [base.id]);
    const otherTask = fixture.workspaceStore.createTask({
      workspaceId: fixture.workspace.id,
      title: 'Other merge task',
      goal: 'Own another Run',
    });
    const otherRun = seedRun(fixture.raw, otherTask.taskId, fixture.agentVersionId);
    const otherArtifact = fixture.artifactStore.createArtifact({
      workspaceId: fixture.workspace.id,
      taskId: otherTask.taskId,
      runId: otherRun.runId,
      name: 'other.txt',
    });
    const otherVersion = fixture.artifactStore.createVersion({
      artifactId: otherArtifact.id,
      sourceStepId: otherRun.stepId,
      content: 'other',
      mimeType: 'text/plain',
      status: 'candidate',
    });
    const { runtime, installId } = createRuntime(fixture);
    await runtime.start();
    const client = await connectAndHello(installId);
    const common = {
      ...scope(fixture),
      artifactId: fixture.artifact.id,
      baseVersionId: base.id,
      leftVersionId: left.id,
      sourceStepId: fixture.stepId,
      expectedTaskVersion: 0,
    };
    try {
      const same = await send(client.socket, client.reader, 'same', 'artifact.merge', {
        ...common,
        rightVersionId: left.id,
        operationId: ulid(),
      });
      const crossRun = await send(client.socket, client.reader, 'cross-run', 'artifact.merge', {
        ...common,
        rightVersionId: otherVersion.id,
        operationId: ulid(),
      });
      expect(same.error).toMatchObject({ code: 'protocol.frame_malformed' });
      expect(crossRun.error).toMatchObject({ code: 'protocol.unexpected_request' });
      expect(fixture.workspaceStore.getTask(fixture.task.taskId)?.version).toBe(0);
      expect(fixture.persistedState.listEvents(fixture.workspace.id, 0)).toEqual([]);
    } finally {
      client.socket.destroy();
      await runtime.stop();
      fixture.close();
    }
  });

  it('rejects invalid ancestry and non-mergeable Run state before OCC or events', async () => {
    const fixture = await createFixture();
    const base = createTextVersion(fixture, 'base');
    const unrelatedLeft = createTextVersion(fixture, 'left');
    const right = createTextVersion(fixture, 'base', [base.id], fixture.rightStepId);
    const { runtime, installId } = createRuntime(fixture);
    await runtime.start();
    const client = await connectAndHello(installId);
    const mergePayload = {
      ...scope(fixture),
      artifactId: fixture.artifact.id,
      baseVersionId: base.id,
      leftVersionId: unrelatedLeft.id,
      rightVersionId: right.id,
      sourceStepId: fixture.stepId,
      operationId: ulid(),
      expectedTaskVersion: 0,
    };
    try {
      const invalidAncestry = await send(
        client.socket,
        client.reader,
        'invalid-ancestry',
        'artifact.merge',
        mergePayload,
      );
      expect(invalidAncestry.error).toMatchObject({ code: 'protocol.unexpected_request' });
      expect(fixture.workspaceStore.getTask(fixture.task.taskId)?.version).toBe(0);

      fixture.raw.prepare('UPDATE run SET state = ? WHERE id = ?').run('queued', fixture.runId);
      const validLeft = createTextVersion(fixture, 'valid-left', [base.id]);
      const deniedState = await send(client.socket, client.reader, 'denied-state', 'artifact.merge', {
        ...mergePayload,
        leftVersionId: validLeft.id,
        operationId: ulid(),
      });
      expect(deniedState.error).toMatchObject({ code: 'protocol.unexpected_request' });
      expect(fixture.workspaceStore.getTask(fixture.task.taskId)?.version).toBe(0);
      expect(fixture.persistedState.listEvents(fixture.workspace.id, 0)).toEqual([]);
      expect(fixture.artifactStore.listMergeConflicts(fixture.artifact.id)).toEqual([]);
    } finally {
      client.socket.destroy();
      await runtime.stop();
      fixture.close();
    }
  });

  it('rejects replay of a legacy conflict with unknown source Step before OCC or events', async () => {
    const fixture = await createFixture();
    const base = createTextVersion(fixture, 'base');
    const left = createTextVersion(fixture, 'left', [base.id]);
    const right = createTextVersion(fixture, 'right', [base.id], fixture.rightStepId);
    const conflictId = ulid();
    const operationId = ulid();
    fixture.raw.prepare('DROP TRIGGER artifact_merge_conflict_ownership_insert').run();
    fixture.raw.prepare(
      `INSERT INTO artifact_merge_conflict (
         id, operation_id, artifact_id, run_id, source_step_id,
         base_version_id, left_version_id, right_version_id, status,
         summary_json, expected_task_version, resulting_task_version, created_at
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'open', ?, 0, 1, 'legacy-now')`,
    ).run(
      conflictId,
      operationId,
      fixture.artifact.id,
      fixture.runId,
      base.id,
      left.id,
      right.id,
      JSON.stringify({
        baseHash: base.contentHash,
        leftHash: left.contentHash,
        rightHash: right.contentHash,
      }),
    );
    fixture.raw.prepare('UPDATE run SET state = ? WHERE id = ?').run('paused', fixture.runId);

    const { runtime, installId } = createRuntime(fixture);
    await runtime.start();
    const client = await connectAndHello(installId);
    try {
      const conflicts = fixture.artifactStore.listMergeConflicts(fixture.artifact.id);
      expect(conflicts).toEqual([
        expect.objectContaining({
          id: conflictId,
          legacySourceStepUnknown: true,
        }),
      ]);
      expect(conflicts[0]).not.toHaveProperty('sourceStepId');
      const replay = await send(client.socket, client.reader, 'legacy-replay', 'artifact.merge', {
        ...scope(fixture),
        artifactId: fixture.artifact.id,
        baseVersionId: base.id,
        leftVersionId: left.id,
        rightVersionId: right.id,
        sourceStepId: fixture.stepId,
        operationId,
        expectedTaskVersion: 0,
      });
      expect(replay.error).toMatchObject({
        code: 'protocol.unexpected_request',
        message: expect.stringContaining('artifact.legacy_conflict_step_unknown'),
      });
      expect(fixture.workspaceStore.getTask(fixture.task.taskId)?.version).toBe(0);
      expect(fixture.persistedState.listEvents(fixture.workspace.id, 0)).toEqual([]);
      expect((fixture.raw.prepare('SELECT COUNT(*) AS count FROM checkpoint').get() as { count: number }).count).toBe(0);
    } finally {
      client.socket.destroy();
      await runtime.stop();
      fixture.close();
    }
  });
});
