import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  type Frame,
  type PlanApproveResponse,
  type RunGetGraphResponse,
} from '@sync-think/protocol';
import type { AgentVersionId, PlanStepDraft, StepId, WorkspaceId } from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteAgentStore,
  SqliteEventCheckpointStore,
  SqliteOrchestrationStore,
  SqliteUnitOfWork,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import { afterEach, describe, expect, it } from 'vitest';
import ts from 'typescript';
import { openPersistentRuntime } from '../src/persistence.js';
import type { StepExecutionContext, StepExecutor } from '../src/orchestration/step-executor.js';
import { Runtime, type RuntimeStateStore } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly retain a better-sqlite3 file handle after a failed test.
    }
  }
});

interface PlanRevisionWire {
  id: string;
  planId: string;
  taskId: string;
  revision: number;
  title: string;
  steps: PlanStepDraft[];
  state: 'draft' | 'approved' | 'superseded';
  approvedAt?: string;
  taskVersion?: number;
}

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
      'runtime.healthcheck',
      'runtime.subscribeEvents',
      'workspace.create',
      'task.create',
      'task.setParticipationMode',
      'policy.save',
      'agent.get',
      'plan.draft',
      'plan.revise',
      'plan.listRevisions',
      'plan.approve',
      'run.getGraph',
    ],
  });
  expect(hello.payload).toMatchObject({ ok: true });
  return { socket, reader, hello };
}

async function startPersistentFixture(prefix: string, stepExecutor?: StepExecutor) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  const installId = `plan-${randomBytes(5).toString('hex')}`;
  const dbPath = join(dir, 'sync-think.db');
  const session = await openPersistentRuntime({
    dbPath,
    secureStoreKeyPath: join(dir, 'secure-store-key.bin'),
    installId,
    allowNoToken: true,
    stepExecutor,
  });
  await session.runtime.start();
  const connected = await connectAndHello(installId);
  let closed = false;
  return {
    dir,
    dbPath,
    installId,
    ...connected,
    async close() {
      if (closed) return;
      closed = true;
      connected.socket.destroy();
      await session.close();
    },
  };
}

async function createTask(
  fixture: Awaited<ReturnType<typeof startPersistentFixture>>,
  suffix: string,
  acceptanceCriteria: string[] = [],
) {
  const workspace = await send(
    fixture.socket,
    fixture.reader,
    `workspace-${suffix}`,
    'workspace.create',
    {
      folderPath: join(fixture.dir, `workspace-${suffix}`),
      name: `Workspace ${suffix}`,
    },
  );
  expect(workspace.error).toBeUndefined();
  const workspaceId = (workspace.payload as { workspaceId: string }).workspaceId;
  const task = await send(fixture.socket, fixture.reader, `task-${suffix}`, 'task.create', {
    workspaceId,
    title: `Task ${suffix}`,
    goal: `Exercise plan protocol ${suffix}`,
    acceptanceCriteria,
  });
  expect(task.error).toBeUndefined();
  return {
    workspaceId,
    ...(task.payload as { taskId: string; threadId: string; taskVersion: number }),
  };
}

async function enterCollaboration(
  fixture: Awaited<ReturnType<typeof startPersistentFixture>>,
  taskId: string,
) {
  const response = await send(
    fixture.socket,
    fixture.reader,
    'mode-collaboration',
    'task.setParticipationMode',
    { taskId, mode: 'collaboration', expectedTaskVersion: 0 },
  );
  expect(response.error).toBeUndefined();
  expect(response.payload).toMatchObject({
    task: { taskId, participationMode: 'collaboration', taskVersion: 1 },
  });
}

async function seedAgentVersion(
  fixture: Awaited<ReturnType<typeof startPersistentFixture>>,
): Promise<string> {
  const response = await send(fixture.socket, fixture.reader, 'agent-get', 'agent.get', {});
  expect(response.error).toBeUndefined();
  return (response.payload as { agent: { agentVersionId: string } }).agent.agentVersionId;
}

async function createReviewerAgentVersion(
  fixture: Awaited<ReturnType<typeof startPersistentFixture>>,
  suffix: string,
): Promise<string> {
  const defaultAgent = await send(
    fixture.socket,
    fixture.reader,
    `reviewer-default-${suffix}`,
    'agent.get',
    {},
  );
  const defaultModelId = (defaultAgent.payload as { agent: { defaultModelId: string } }).agent
    .defaultModelId;
  const response = await send(
    fixture.socket,
    fixture.reader,
    `reviewer-create-${suffix}`,
    'agent.create',
    {
      agentId: `agent-reviewer-dependencies-${suffix}`,
      name: `Reviewer dependencies ${suffix}`,
      role: 'reviewer',
      developerInstructions: 'Review one exact target.',
      inputContract: 'criteria and exact ArtifactVersions',
      outputContract: 'structured ReviewOutcome',
      defaultModelId,
      fallbackModelIds: [],
      pauseOnFailure: true,
      memoryScope: 'task',
      skillVersionIds: [],
      mcpServerIds: [],
      approvalMode: 'request',
      reviewBehavior: {
        role: 'reviewer',
        maxIterations: 1,
        onLimitReached: 'pause',
      },
    },
  );
  expect(response.error).toBeUndefined();
  return (response.payload as { agent: { agentVersionId: string } }).agent.agentVersionId;
}

function step(
  id: string,
  agentVersionId: string,
  overrides: Partial<PlanStepDraft> = {},
): PlanStepDraft {
  return {
    id: id as StepId,
    title: `Step ${id}`,
    instructions: `Complete ${id}`,
    agentVersionId: agentVersionId as AgentVersionId,
    dependsOn: [],
    ...overrides,
  };
}

describe('Plan/Run/Graph pipe protocol', () => {
  it('declares the exact model override snapshot directly on RunGraphStep', () => {
    const commandsPath = new URL('../../../packages/protocol/src/commands.ts', import.meta.url);
    const sourceFile = ts.createSourceFile(
      commandsPath.pathname,
      readFileSync(commandsPath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const runGraphStep = sourceFile.statements.find(
      (statement): statement is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(statement) && statement.name.text === 'RunGraphStep',
    );
    expect(runGraphStep).toBeDefined();
    expect(
      runGraphStep?.members.some(
        (member) =>
          ts.isPropertySignature(member) && member.name.getText(sourceFile) === 'modelOverrideId',
      ),
    ).toBe(true);
  });

  it('creates one stable Gate from the exact planned reviewer before scheduling', async () => {
    let releaseTarget!: () => void;
    let targetEntered!: () => void;
    const targetRelease = new Promise<void>((resolve) => {
      releaseTarget = resolve;
    });
    const targetStarted = new Promise<void>((resolve) => {
      targetEntered = resolve;
    });
    const calls: Array<{ stepId: string; reviewKind?: string; artifactContents: unknown[] }> = [];
    const executor: StepExecutor = {
      async execute(context: StepExecutionContext) {
        calls.push({
          stepId: context.step.id,
          reviewKind: context.reviewContext?.kind,
          artifactContents: context.artifactVersions.map((version) => version.content),
        });
        if (context.step.id === ('target' as StepId)) {
          targetEntered();
          await targetRelease;
          return {
            outputVersions: [
              {
                artifactName: 'target.txt',
                content: 'exact target output',
                mimeType: 'text/plain',
                status: 'candidate',
              },
            ],
          };
        }
        if (context.reviewContext?.kind !== 'reviewer') {
          throw new Error('Planned reviewer did not receive reviewer context');
        }
        return {
          reviewOutcome: {
            verdict: 'accept',
            explanation: 'All exact criteria pass.',
            criteria: context.reviewContext.criteria.map((criterion) => ({
              criterionId: criterion.id,
              verdict: 'pass',
              explanation: `Passed ${criterion.id}`,
            })),
            reviewedArtifactVersionIds: context.reviewContext.reviewedArtifactVersions.map(
              (version) => version.id,
            ),
          },
        };
      },
    };
    const fixture = await startPersistentFixture('sync-think-plan-auto-review-gate-', executor);
    try {
      const criteria = ['Target output is exact.', 'Lineage remains inspectable.'];
      const task = await createTask(fixture, 'auto-review-gate', criteria);
      const targetAgentVersionId = await seedAgentVersion(fixture);
      await enterCollaboration(fixture, task.taskId);

      const defaultAgent = await send(
        fixture.socket,
        fixture.reader,
        'review-default-agent',
        'agent.get',
        {},
      );
      const reviewerResponse = await send(
        fixture.socket,
        fixture.reader,
        'review-agent-create',
        'agent.create',
        {
          agentId: 'agent-plan-reviewer',
          name: 'Plan reviewer',
          role: 'reviewer',
          developerInstructions: 'Review exact assigned artifacts.',
          inputContract: 'criteria plus exact ArtifactVersions',
          outputContract: 'structured ReviewOutcome',
          defaultModelId: (defaultAgent.payload as { agent: { defaultModelId: string } }).agent
            .defaultModelId,
          fallbackModelIds: [],
          pauseOnFailure: true,
          memoryScope: 'task',
          skillVersionIds: [],
          mcpServerIds: [],
          approvalMode: 'request',
          reviewBehavior: {
            role: 'reviewer',
            maxIterations: 2,
            onLimitReached: 'pause',
          },
        },
      );
      expect(reviewerResponse.error).toBeUndefined();
      const reviewerAgentVersionId = (
        reviewerResponse.payload as { agent: { agentVersionId: string } }
      ).agent.agentVersionId;

      const targetStep = step('target', targetAgentVersionId);
      const draftResponse = await send(
        fixture.socket,
        fixture.reader,
        'auto-gate-draft',
        'plan.draft',
        {
          taskId: task.taskId,
          expectedTaskVersion: 1,
          title: 'Auto gate v1',
          steps: [targetStep],
        },
      );
      expect(draftResponse.error).toBeUndefined();
      const draft = draftResponse.payload as unknown as PlanRevisionWire;
      const reviewerStep = step('planned-reviewer', reviewerAgentVersionId, {
        dependsOn: ['target' as StepId],
      });
      const revisedResponse = await send(
        fixture.socket,
        fixture.reader,
        'auto-gate-revise',
        'plan.revise',
        {
          planId: draft.planId,
          expectedRevision: 1,
          title: 'Auto gate v2',
          steps: [targetStep, reviewerStep],
        },
      );
      expect(revisedResponse.error).toBeUndefined();

      const approved = await send(
        fixture.socket,
        fixture.reader,
        'auto-gate-approve',
        'plan.approve',
        {
          planId: draft.planId,
          revision: 2,
        },
      );
      expect(approved.error).toBeUndefined();
      const graph = approved.payload as PlanApproveResponse;
      await targetStarted;

      const inspection = await openDatabaseAsync({ path: fixture.dbPath });
      let gateId: string;
      try {
        const gateRows = inspection.raw
          .prepare(
            'SELECT id, target_step_id, reviewer_agent_version_id, max_iterations FROM acceptance_gate WHERE run_id = ?',
          )
          .all(graph.run.id) as Array<{
          id: string;
          target_step_id: string;
          reviewer_agent_version_id: string;
          max_iterations: number;
        }>;
        expect(gateRows).toEqual([
          expect.objectContaining({
            target_step_id: 'target',
            reviewer_agent_version_id: reviewerAgentVersionId,
            max_iterations: 2,
          }),
        ]);
        gateId = gateRows[0]!.id;
        expect(
          inspection.raw
            .prepare(
              'SELECT step_id, role, iteration, derivation FROM acceptance_gate_step WHERE gate_id = ?',
            )
            .all(gateId),
        ).toEqual([
          {
            step_id: 'planned-reviewer',
            role: 'reviewer',
            iteration: 0,
            derivation: 'initial',
          },
        ]);
        expect(
          inspection.raw
            .prepare('SELECT COUNT(*) AS count FROM step WHERE run_id = ?')
            .get(graph.run.id),
        ).toEqual({ count: 2 });
        const storedGate = new SqliteOrchestrationStore(inspection.raw).getAcceptanceGate(
          gateId as never,
        );
        expect(storedGate?.criteria.map((criterion) => criterion.description)).toEqual(criteria);
      } finally {
        inspection.raw.close();
      }

      releaseTarget();
      let completed: RunGetGraphResponse | undefined;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const response = await send(
          fixture.socket,
          fixture.reader,
          `auto-gate-graph-${attempt}`,
          'run.getGraph',
          { workspaceId: task.workspaceId, taskId: task.taskId, runId: graph.run.id },
        );
        completed = response.payload as RunGetGraphResponse;
        if (completed.run.state === 'completed') break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(completed?.run.state).toBe('completed');
      expect(calls).toEqual([
        { stepId: 'target', reviewKind: undefined, artifactContents: [] },
        {
          stepId: 'planned-reviewer',
          reviewKind: 'reviewer',
          artifactContents: ['exact target output'],
        },
      ]);
      expect(completed?.steps.map((candidate) => candidate.id)).toEqual([
        'target',
        'planned-reviewer',
      ]);

      const repeated = await send(
        fixture.socket,
        fixture.reader,
        'auto-gate-approve-repeat',
        'plan.approve',
        {
          planId: draft.planId,
          revision: 2,
        },
      );
      expect(repeated.error).toBeUndefined();
      const replayInspection = await openDatabaseAsync({ path: fixture.dbPath });
      try {
        expect(
          replayInspection.raw
            .prepare('SELECT id FROM acceptance_gate WHERE run_id = ?')
            .all(graph.run.id),
        ).toEqual([{ id: gateId }]);
        expect(
          replayInspection.raw
            .prepare('SELECT COUNT(*) AS count FROM step WHERE run_id = ?')
            .get(graph.run.id),
        ).toEqual({ count: 2 });
      } finally {
        replayInspection.raw.close();
      }
    } finally {
      releaseTarget();
      await fixture.close();
    }
  });

  it.each([
    { name: 'zero dependencies', targetIds: [], reviewerDependencies: [] },
    {
      name: 'multiple dependencies',
      targetIds: ['review-target-a', 'review-target-b'],
      reviewerDependencies: ['review-target-a', 'review-target-b'],
    },
  ] as const)(
    'rejects reviewer Steps with $name before creating a Run',
    async ({ name, targetIds, reviewerDependencies }) => {
      let executionCount = 0;
      const executor: StepExecutor = {
        async execute() {
          executionCount += 1;
          return {
            outputVersions: [
              {
                artifactName: 'unexpected.txt',
                content: 'must not execute',
                mimeType: 'text/plain',
                status: 'candidate',
              },
            ],
          };
        },
      };
      const suffix = name.replaceAll(' ', '-');
      const fixture = await startPersistentFixture(
        `sync-think-plan-reviewer-dependencies-${suffix}-`,
        executor,
      );
      try {
        const task = await createTask(fixture, `reviewer-dependencies-${suffix}`, [
          'The exact target must pass review.',
        ]);
        await enterCollaboration(fixture, task.taskId);
        const targetAgentVersionId = await seedAgentVersion(fixture);
        const reviewerAgentVersionId = await createReviewerAgentVersion(fixture, suffix);
        const draftResponse = await send(
          fixture.socket,
          fixture.reader,
          `reviewer-dependencies-draft-${suffix}`,
          'plan.draft',
          {
            taskId: task.taskId,
            expectedTaskVersion: 1,
            title: `Invalid reviewer dependencies: ${name}`,
            steps: [
              ...targetIds.map((id) => step(id, targetAgentVersionId)),
              step('invalid-planned-reviewer', reviewerAgentVersionId, {
                dependsOn: reviewerDependencies.map((id) => id as StepId),
              }),
            ],
          },
        );
        expect(draftResponse.error).toBeUndefined();
        const draft = draftResponse.payload as unknown as PlanRevisionWire;

        const approval = await send(
          fixture.socket,
          fixture.reader,
          `reviewer-dependencies-approve-${suffix}`,
          'plan.approve',
          { planId: draft.planId, revision: 1 },
        );
        expect(approval.error).toMatchObject({
          code: 'protocol.unexpected_request',
          message: expect.stringContaining('review.reviewer_dependency_invalid'),
        });
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(executionCount).toBe(0);

        const inspection = await openDatabaseAsync({ path: fixture.dbPath });
        try {
          expect(inspection.raw.prepare('SELECT COUNT(*) AS count FROM run').get()).toEqual({
            count: 0,
          });
          expect(
            inspection.raw.prepare('SELECT COUNT(*) AS count FROM acceptance_gate').get(),
          ).toEqual({ count: 0 });
          expect(inspection.raw.prepare('SELECT COUNT(*) AS count FROM step').get()).toEqual({
            count: 0,
          });
          expect(
            inspection.raw
              .prepare('SELECT state, approved_at AS approvedAt FROM plan_revision WHERE id = ?')
              .get(draft.id),
          ).toEqual({ state: 'draft', approvedAt: null });
          expect(
            inspection.raw
              .prepare(
                `SELECT COUNT(*) AS count FROM event
                 WHERE type IN ('plan.approved', 'run.queued', 'step.created')`,
              )
              .get(),
          ).toEqual({ count: 0 });
        } finally {
          inspection.raw.close();
        }
      } finally {
        await fixture.close();
      }
    },
  );

  it.each([
    {
      name: 'topological input order',
      order: ['target-A', 'reviewer-B', 'reviewer-C'],
    },
    {
      name: 'reviewer-first input order',
      order: ['reviewer-C', 'target-A', 'reviewer-B'],
    },
  ] as const)(
    'transactionally rejects a planned reviewer lineage in $name',
    async ({ name, order }) => {
      let executionCount = 0;
      const executor: StepExecutor = {
        async execute() {
          executionCount += 1;
          return {
            outputVersions: [
              {
                artifactName: 'unexpected.txt',
                content: 'must not execute',
                mimeType: 'text/plain',
                status: 'candidate',
              },
            ],
          };
        },
      };
      const suffix = name.replaceAll(' ', '-');
      const fixture = await startPersistentFixture(
        `sync-think-plan-reviewer-lineage-${suffix}-`,
        executor,
      );
      try {
        const task = await createTask(fixture, `reviewer-lineage-${suffix}`, [
          'The exact target must pass review.',
        ]);
        await enterCollaboration(fixture, task.taskId);
        const targetAgentVersionId = await seedAgentVersion(fixture);
        const reviewerBAgentVersionId = await createReviewerAgentVersion(fixture, `${suffix}-b`);
        const reviewerCAgentVersionId = await createReviewerAgentVersion(fixture, `${suffix}-c`);
        const plannedSteps = [
          step('target-A', targetAgentVersionId),
          step('reviewer-B', reviewerBAgentVersionId, {
            dependsOn: ['target-A' as StepId],
          }),
          step('reviewer-C', reviewerCAgentVersionId, {
            dependsOn: ['reviewer-B' as StepId],
          }),
        ];
        const draftResponse = await send(
          fixture.socket,
          fixture.reader,
          `reviewer-lineage-draft-${suffix}`,
          'plan.draft',
          {
            taskId: task.taskId,
            expectedTaskVersion: 1,
            title: `Invalid reviewer lineage: ${name}`,
            steps: order.map((stepId) => plannedSteps.find((candidate) => candidate.id === stepId)!),
          },
        );
        expect(draftResponse.error).toBeUndefined();
        const draft = draftResponse.payload as unknown as PlanRevisionWire;

        const baselineConnection = await openDatabaseAsync({ path: fixture.dbPath });
        const eventsBefore = baselineConnection.raw
          .prepare('SELECT * FROM event ORDER BY rowid ASC')
          .all();
        const checkpointsBefore = baselineConnection.raw
          .prepare('SELECT * FROM checkpoint ORDER BY rowid ASC')
          .all();
        baselineConnection.raw.close();

        const approval = await send(
          fixture.socket,
          fixture.reader,
          `reviewer-lineage-approve-${suffix}`,
          'plan.approve',
          { planId: draft.planId, revision: 1 },
        );
        expect(approval.error).toMatchObject({
          code: 'protocol.unexpected_request',
          message: expect.stringContaining('review.reviewer_lineage_invalid'),
        });
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(executionCount).toBe(0);

        const inspection = await openDatabaseAsync({ path: fixture.dbPath });
        try {
          for (const table of [
            'run',
            'acceptance_gate',
            'acceptance_gate_step',
            'step',
            'step_dependency',
          ]) {
            expect(
              inspection.raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(),
              `${table} must remain empty`,
            ).toEqual({ count: 0 });
          }
          expect(
            inspection.raw
              .prepare('SELECT state, approved_at AS approvedAt FROM plan_revision WHERE id = ?')
              .get(draft.id),
          ).toEqual({ state: 'draft', approvedAt: null });
          expect(inspection.raw.prepare('SELECT * FROM event ORDER BY rowid ASC').all()).toEqual(
            eventsBefore,
          );
          expect(
            inspection.raw.prepare('SELECT * FROM checkpoint ORDER BY rowid ASC').all(),
          ).toEqual(checkpointsBefore);
        } finally {
          inspection.raw.close();
        }
      } finally {
        await fixture.close();
      }
    },
  );

  it('persists and reassigns to the exact product-configured backup reviewer', async () => {
    let primaryReviewerAgentVersionId = '';
    let backupReviewerAgentVersionId = '';
    const calls: string[] = [];
    const executor: StepExecutor = {
      async execute(context) {
        if (context.step.id === ('target-with-backup' as StepId)) {
          calls.push('target');
          return {
            outputVersions: [
              {
                artifactName: 'target-with-backup.txt',
                content: 'target output for reassignment',
                mimeType: 'text/plain',
                status: 'candidate',
              },
            ],
          };
        }
        if (context.reviewContext?.kind !== 'reviewer') {
          throw new Error('Configured reviewer did not receive reviewer context');
        }
        const isBackup = context.step.agentVersionId === backupReviewerAgentVersionId;
        calls.push(isBackup ? 'backup-reviewer' : 'primary-reviewer');
        const verdict = isBackup ? 'accept' : 'reject';
        return {
          reviewOutcome: {
            verdict,
            explanation: `${verdict} by exact configured reviewer`,
            criteria: context.reviewContext.criteria.map((criterion) => ({
              criterionId: criterion.id,
              verdict: isBackup ? 'pass' : 'fail',
              explanation: `checked ${criterion.id}`,
            })),
            reviewedArtifactVersionIds: context.reviewContext.reviewedArtifactVersions.map(
              (version) => version.id,
            ),
          },
        };
      },
    };
    const fixture = await startPersistentFixture('sync-think-plan-exact-backup-', executor);
    try {
      const task = await createTask(fixture, 'exact-backup', [
        'Exact reviewer reassignment works.',
      ]);
      await enterCollaboration(fixture, task.taskId);
      const targetAgentVersionId = await seedAgentVersion(fixture);
      const defaultAgent = await send(
        fixture.socket,
        fixture.reader,
        'backup-default-agent',
        'agent.get',
        {},
      );
      const defaultModelId = (defaultAgent.payload as { agent: { defaultModelId: string } }).agent
        .defaultModelId;
      const commonAgent = {
        role: 'reviewer',
        developerInstructions: 'Review exact assigned artifacts.',
        inputContract: 'criteria plus exact ArtifactVersions',
        outputContract: 'structured ReviewOutcome',
        defaultModelId,
        fallbackModelIds: [],
        pauseOnFailure: true,
        memoryScope: 'task',
        skillVersionIds: [],
        mcpServerIds: [],
        approvalMode: 'request',
      };
      const backupResponse = await send(
        fixture.socket,
        fixture.reader,
        'backup-reviewer-create',
        'agent.create',
        {
          ...commonAgent,
          agentId: 'agent-plan-backup-reviewer',
          name: 'Plan backup reviewer',
          reviewBehavior: {
            role: 'reviewer',
            maxIterations: 0,
            onLimitReached: 'pause',
          },
        },
      );
      expect(backupResponse.error).toBeUndefined();
      backupReviewerAgentVersionId = (
        backupResponse.payload as { agent: { agentVersionId: string } }
      ).agent.agentVersionId;

      const primaryResponse = await send(
        fixture.socket,
        fixture.reader,
        'primary-reviewer-create',
        'agent.create',
        {
          ...commonAgent,
          agentId: 'agent-plan-primary-reviewer',
          name: 'Plan primary reviewer',
          reviewBehavior: {
            role: 'reviewer',
            maxIterations: 0,
            onLimitReached: 'reassign',
            backupAgentVersionId: backupReviewerAgentVersionId,
          },
        },
      );
      expect(primaryResponse.error).toBeUndefined();
      primaryReviewerAgentVersionId = (
        primaryResponse.payload as { agent: { agentVersionId: string } }
      ).agent.agentVersionId;

      const draftResponse = await send(
        fixture.socket,
        fixture.reader,
        'exact-backup-plan-draft',
        'plan.draft',
        {
          taskId: task.taskId,
          expectedTaskVersion: 1,
          title: 'Exact backup reviewer plan',
          steps: [
            step('target-with-backup', targetAgentVersionId),
            step('planned-primary-reviewer', primaryReviewerAgentVersionId, {
              dependsOn: ['target-with-backup' as StepId],
            }),
          ],
        },
      );
      expect(draftResponse.error).toBeUndefined();
      const draft = draftResponse.payload as unknown as PlanRevisionWire;
      const approval = await send(
        fixture.socket,
        fixture.reader,
        'exact-backup-plan-approve',
        'plan.approve',
        { planId: draft.planId, revision: 1 },
      );
      expect(approval.error).toBeUndefined();
      const graph = approval.payload as PlanApproveResponse;

      let completed: RunGetGraphResponse | undefined;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const response = await send(
          fixture.socket,
          fixture.reader,
          `exact-backup-graph-${attempt}`,
          'run.getGraph',
          { workspaceId: task.workspaceId, taskId: task.taskId, runId: graph.run.id },
        );
        completed = response.payload as RunGetGraphResponse;
        if (completed.run.state === 'completed') break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(completed?.run.state).toBe('completed');
      expect(calls).toEqual(['target', 'primary-reviewer', 'backup-reviewer']);

      const inspection = await openDatabaseAsync({ path: fixture.dbPath });
      try {
        expect(
          inspection.raw
            .prepare(
              `SELECT reviewer_agent_version_id AS reviewerAgentVersionId,
                 backup_agent_version_id AS backupAgentVersionId, state, reassigned
               FROM acceptance_gate WHERE run_id = ?`,
            )
            .all(graph.run.id),
        ).toEqual([
          {
            reviewerAgentVersionId: primaryReviewerAgentVersionId,
            backupAgentVersionId: backupReviewerAgentVersionId,
            state: 'accepted',
            reassigned: 1,
          },
        ]);
        expect(
          inspection.raw
            .prepare(
              `SELECT step_row.agent_version_id AS agentVersionId
               FROM acceptance_gate_step AS gate_step
               JOIN step AS step_row
                 ON step_row.run_id = gate_step.run_id AND step_row.id = gate_step.step_id
               WHERE gate_step.run_id = ? AND gate_step.derivation = 'reassign'`,
            )
            .all(graph.run.id),
        ).toEqual([{ agentVersionId: backupReviewerAgentVersionId }]);
        expect(
          inspection.raw
            .prepare(
              `SELECT reviewer_agent_version_id AS reviewerAgentVersionId
               FROM review_evidence WHERE run_id = ? ORDER BY iteration ASC, rowid ASC`,
            )
            .all(graph.run.id),
        ).toEqual([
          { reviewerAgentVersionId: primaryReviewerAgentVersionId },
          { reviewerAgentVersionId: backupReviewerAgentVersionId },
        ]);
      } finally {
        inspection.raw.close();
      }
    } finally {
      await fixture.close();
    }
  });

  it('fails an approved production Step when no concrete execution adapter is configured', async () => {
    const fixture = await startPersistentFixture('sync-think-plan-production-executor-');
    try {
      const task = await createTask(fixture, 'production-executor');
      const agentVersionId = await seedAgentVersion(fixture);
      await enterCollaboration(fixture, task.taskId);
      const draft = await send(
        fixture.socket,
        fixture.reader,
        'draft-production-executor',
        'plan.draft',
        {
          taskId: task.taskId,
          expectedTaskVersion: 1,
          title: 'Production execution must fail closed',
          steps: [step('production-executor-step', agentVersionId)],
        },
      );
      expect(draft.error).toBeUndefined();

      const approved = await send(
        fixture.socket,
        fixture.reader,
        'approve-production-executor',
        'plan.approve',
        {
          planId: (draft.payload as PlanRevisionWire).planId,
          revision: 1,
        },
      );
      expect(approved.error).toBeUndefined();
      const runId = (approved.payload as PlanApproveResponse).run.id;

      let graph: RunGetGraphResponse | undefined;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const response = await send(
          fixture.socket,
          fixture.reader,
          `graph-production-executor-${attempt}`,
          'run.getGraph',
          { workspaceId: task.workspaceId, taskId: task.taskId, runId },
        );
        graph = response.payload as RunGetGraphResponse;
        if (graph.run.state === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(graph).toMatchObject({
        run: { id: runId, state: 'failed' },
        steps: [{ id: 'production-executor-step', state: 'failed' }],
      });

      const connection = await openDatabaseAsync({ path: fixture.dbPath });
      try {
        expect(
          connection.raw
            .prepare('SELECT COUNT(*) AS count FROM artifact WHERE run_id = ?')
            .get(runId),
        ).toEqual({ count: 0 });
        expect(
          connection.raw
            .prepare(
              "SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'step.completed'",
            )
            .get(runId),
        ).toEqual({ count: 0 });
        expect(
          connection.raw
            .prepare(
              "SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'step.failed'",
            )
            .get(runId),
        ).toEqual({ count: 1 });
      } finally {
        connection.raw.close();
      }
    } finally {
      await fixture.close();
    }
  });

  it('drafts v1 in collaboration, revises immutable history, approves one pinned graph, and unlocks automatic', async () => {
    const fixture = await startPersistentFixture('sync-think-plan-pipe-');
    let closed = false;
    try {
      const task = await createTask(fixture, 'history');
      const agentVersionId = await seedAgentVersion(fixture);

      const conversationDraft = await send(
        fixture.socket,
        fixture.reader,
        'draft-conversation',
        'plan.draft',
        {
          taskId: task.taskId,
          expectedTaskVersion: 0,
          title: 'Conversation draft is forbidden',
          steps: [step('forbidden', agentVersionId)],
        },
      );
      expect(conversationDraft.error).toMatchObject({ code: 'run.invalid_state' });

      await enterCollaboration(fixture, task.taskId);
      const v1Steps = [
        step('research', agentVersionId),
        step('write', agentVersionId, { dependsOn: ['research' as StepId] }),
      ];
      const staleDraft = await send(
        fixture.socket,
        fixture.reader,
        'draft-stale-task',
        'plan.draft',
        {
          taskId: task.taskId,
          expectedTaskVersion: 0,
          title: 'Stale task version',
          steps: v1Steps,
        },
      );
      expect(staleDraft.error).toMatchObject({ code: 'task.version_mismatch' });

      const draftResponse = await send(fixture.socket, fixture.reader, 'draft-v1', 'plan.draft', {
        taskId: task.taskId,
        expectedTaskVersion: 1,
        title: 'Ship Task3B',
        steps: v1Steps,
      });
      expect(draftResponse.error).toBeUndefined();
      const v1 = draftResponse.payload as unknown as PlanRevisionWire;
      expect(v1).toMatchObject({
        taskId: task.taskId,
        taskVersion: 2,
        revision: 1,
        title: 'Ship Task3B',
        state: 'draft',
        steps: v1Steps,
      });

      const v2Steps = [
        step('research', agentVersionId),
        step('write', agentVersionId, {
          instructions: 'Write the approved implementation',
          modelOverrideId: 'model-override-v2',
          dependsOn: ['research' as StepId],
        }),
      ];
      const reviseResponse = await send(
        fixture.socket,
        fixture.reader,
        'revise-v2',
        'plan.revise',
        {
          planId: v1.planId,
          expectedRevision: 1,
          title: 'Ship Task3B safely',
          steps: v2Steps,
        },
      );
      expect(reviseResponse.error).toBeUndefined();
      const v2 = reviseResponse.payload as unknown as PlanRevisionWire;
      expect(v2).toMatchObject({
        planId: v1.planId,
        revision: 2,
        title: 'Ship Task3B safely',
        state: 'draft',
        steps: v2Steps,
      });

      const stale = await send(fixture.socket, fixture.reader, 'revise-stale', 'plan.revise', {
        planId: v1.planId,
        expectedRevision: 1,
        steps: v1Steps,
      });
      expect(stale.error).toMatchObject({ code: 'protocol.unexpected_request' });

      const beforeApproval = await send(
        fixture.socket,
        fixture.reader,
        'list-before-approval',
        'plan.listRevisions',
        { planId: v1.planId },
      );
      expect(beforeApproval.error).toBeUndefined();
      expect(beforeApproval.payload).toMatchObject({
        revisions: [
          { id: v1.id, revision: 1, title: 'Ship Task3B', steps: v1Steps },
          { id: v2.id, revision: 2, title: 'Ship Task3B safely', steps: v2Steps },
        ],
      });

      const approval = await send(fixture.socket, fixture.reader, 'approve-v2', 'plan.approve', {
        planId: v1.planId,
        revision: 2,
      });
      expect(approval.error).toBeUndefined();
      const graph = approval.payload as PlanApproveResponse;
      expect(graph.run).toMatchObject({
        taskId: task.taskId,
        state: 'queued',
        planRevisionId: v2.id,
        stepIds: ['research', 'write'],
      });
      expect(graph.steps).toEqual([
        expect.objectContaining({
          id: 'research',
          runId: graph.run.id,
          planOrder: 0,
          agentVersionId,
          dependsOn: [],
          state: 'pending',
        }),
        expect.objectContaining({
          id: 'write',
          runId: graph.run.id,
          planOrder: 1,
          agentVersionId,
          modelOverrideId: 'model-override-v2',
          dependsOn: ['research'],
          state: 'pending',
        }),
      ]);
      expect(graph.dependencies).toEqual([
        { runId: graph.run.id, stepId: 'write', dependsOnStepId: 'research' },
      ]);

      const repeatedApproval = await send(
        fixture.socket,
        fixture.reader,
        'approve-v2-repeat',
        'plan.approve',
        { planId: v1.planId, revision: 2 },
      );
      expect(repeatedApproval.error).toBeUndefined();
      expect(repeatedApproval.payload).toMatchObject({
        run: {
          id: graph.run.id,
          taskId: task.taskId,
          planRevisionId: v2.id,
          stepIds: ['research', 'write'],
        },
        steps: [
          { id: 'research', agentVersionId, dependsOn: [] },
          {
            id: 'write',
            agentVersionId,
            modelOverrideId: 'model-override-v2',
            dependsOn: ['research'],
          },
        ],
      });

      const v3Response = await send(fixture.socket, fixture.reader, 'revise-v3', 'plan.revise', {
        planId: v1.planId,
        expectedRevision: 2,
        steps: [...v2Steps, step('review', agentVersionId, { dependsOn: ['write' as StepId] })],
      });
      expect(v3Response.error).toBeUndefined();
      const v3 = v3Response.payload as unknown as PlanRevisionWire;
      expect(v3).toMatchObject({ planId: v1.planId, revision: 3, state: 'draft' });

      const graphResponse = await send(fixture.socket, fixture.reader, 'graph-v2', 'run.getGraph', {
        workspaceId: task.workspaceId,
        taskId: task.taskId,
        runId: graph.run.id,
      });
      expect(graphResponse.error).toBeUndefined();
      expect(graphResponse.payload).toEqual(repeatedApproval.payload);
      const returnedGraph = graphResponse.payload as RunGetGraphResponse;
      expect(returnedGraph.steps[1]?.modelOverrideId).toBe('model-override-v2');

      const afterV3 = await send(
        fixture.socket,
        fixture.reader,
        'list-after-v3',
        'plan.listRevisions',
        { planId: v1.planId },
      );
      expect(afterV3.payload).toMatchObject({
        revisions: [
          { id: v1.id, revision: 1, state: 'draft' },
          { id: v2.id, revision: 2, state: 'approved' },
          { id: v3.id, revision: 3, state: 'draft' },
        ],
      });

      const applicablePolicy = await send(
        fixture.socket,
        fixture.reader,
        'policy-automatic',
        'policy.save',
        {
          workspaceId: task.workspaceId,
          scopeType: 'task',
          scopeId: task.taskId,
          approvalMode: 'request',
        },
      );
      expect(applicablePolicy.error).toBeUndefined();

      const automatic = await send(
        fixture.socket,
        fixture.reader,
        'mode-automatic',
        'task.setParticipationMode',
        { taskId: task.taskId, mode: 'automatic', expectedTaskVersion: 2 },
      );
      expect(automatic.error).toBeUndefined();
      expect(automatic.payload).toMatchObject({
        task: { participationMode: 'automatic', taskVersion: 3 },
      });

      const automaticRevise = await send(
        fixture.socket,
        fixture.reader,
        'revise-automatic',
        'plan.revise',
        { planId: v1.planId, expectedRevision: 3, steps: v2Steps },
      );
      expect(automaticRevise.error).toMatchObject({ code: 'run.invalid_state' });

      const healthcheck = await send(
        fixture.socket,
        fixture.reader,
        'health-features',
        'runtime.healthcheck',
        {},
      );
      expect((healthcheck.payload as { features: string[] }).features).toEqual(
        expect.arrayContaining([
          'plan.draft',
          'plan.revise',
          'plan.listRevisions',
          'plan.approve',
          'run.getGraph',
        ]),
      );

      const replay = await send(
        fixture.socket,
        fixture.reader,
        'plan-events',
        'runtime.subscribeEvents',
        { afterCursor: 0 },
      );
      const allEvents = (
        replay.payload as {
          replayedEvents: Array<{
            workspaceId: string;
            taskId?: string;
            runId?: string;
            stepId?: string;
            type: string;
            sequence: number;
            payload: Record<string, unknown>;
          }>;
        }
      ).replayedEvents;
      const orchestrationEvents = allEvents.filter((event) =>
        ['plan.drafted', 'plan.revised', 'plan.approved', 'run.queued', 'step.created'].includes(
          event.type,
        ),
      );
      expect(orchestrationEvents.map((event) => event.type)).toEqual([
        'plan.drafted',
        'plan.revised',
        'plan.approved',
        'run.queued',
        'step.created',
        'step.created',
        'plan.revised',
      ]);
      expect(orchestrationEvents.every((event) => event.workspaceId === task.workspaceId)).toBe(
        true,
      );
      expect(orchestrationEvents.every((event) => event.taskId === task.taskId)).toBe(true);
      expect(
        orchestrationEvents
          .filter((event) => event.type === 'step.created')
          .map((event) => event.stepId),
      ).toEqual(['research', 'write']);
      expect(
        orchestrationEvents.find((event) => event.type === 'plan.approved')?.payload,
      ).toMatchObject({
        planId: v1.planId,
        planRevisionId: v2.id,
        revision: 2,
        runId: graph.run.id,
      });
      expect(
        orchestrationEvents.find((event) => event.type === 'plan.drafted')?.payload,
      ).toMatchObject({
        taskVersion: 2,
      });

      const lastEventSequence = allEvents.at(-1)!.sequence;
      await fixture.close();
      closed = true;
      const connection = await openDatabaseAsync({ path: fixture.dbPath });
      try {
        const stateStore = new SqliteEventCheckpointStore(connection.raw);
        expect(
          stateStore.loadLatestCheckpoint(`runtime-${fixture.installId}` as never),
        ).toMatchObject({
          lastEventSequence,
        });
        expect(
          (connection.raw.prepare('SELECT COUNT(*) AS count FROM run').get() as { count: number })
            .count,
        ).toBe(1);
        expect(
          (connection.raw.prepare('SELECT COUNT(*) AS count FROM plan').get() as { count: number })
            .count,
        ).toBe(1);
        expect(
          (connection.raw.prepare('SELECT COUNT(*) AS count FROM step').get() as { count: number })
            .count,
        ).toBe(2);
        expect(
          (
            connection.raw.prepare('SELECT COUNT(*) AS count FROM step_dependency').get() as {
              count: number;
            }
          ).count,
        ).toBe(1);
      } finally {
        connection.raw.close();
      }
    } finally {
      if (!closed) await fixture.close();
    }
  });

  it('rejects plan approval after the Task leaves collaboration mode without creating a Run', async () => {
    const fixture = await startPersistentFixture('sync-think-plan-approve-mode-boundary-');
    try {
      const task = await createTask(fixture, 'approve-mode-boundary');
      const agentVersionId = await seedAgentVersion(fixture);
      await enterCollaboration(fixture, task.taskId);

      const drafted = await send(
        fixture.socket,
        fixture.reader,
        'approve-mode-boundary-draft',
        'plan.draft',
        {
          taskId: task.taskId,
          expectedTaskVersion: 1,
          title: 'Approval mode boundary',
          steps: [step('execution', agentVersionId)],
        },
      );
      expect(drafted.error).toBeUndefined();
      const revision = drafted.payload as unknown as PlanRevisionWire;

      const conversation = await send(
        fixture.socket,
        fixture.reader,
        'approve-mode-boundary-conversation',
        'task.setParticipationMode',
        {
          taskId: task.taskId,
          mode: 'conversation',
          expectedTaskVersion: revision.taskVersion,
        },
      );
      expect(conversation.error).toBeUndefined();

      const approval = await send(
        fixture.socket,
        fixture.reader,
        'approve-mode-boundary-approve',
        'plan.approve',
        { planId: revision.planId, revision: revision.revision },
      );
      expect(approval.error).toMatchObject({ code: 'run.invalid_state' });

      const inspection = await openDatabaseAsync({ path: fixture.dbPath });
      try {
        expect(
          inspection.raw.prepare('SELECT state, approved_at FROM plan_revision WHERE id = ?').get(revision.id),
        ).toEqual({ state: 'draft', approved_at: null });
        expect(inspection.raw.prepare('SELECT COUNT(*) AS count FROM run').get()).toEqual({ count: 0 });
      } finally {
        inspection.raw.close();
      }
    } finally {
      await fixture.close();
    }
  });

  it('strictly rejects oversized, malformed, and authorization-bearing plan payloads', async () => {
    const fixture = await startPersistentFixture('sync-think-plan-validation-');
    let closed = false;
    try {
      const task = await createTask(fixture, 'validation');
      await enterCollaboration(fixture, task.taskId);
      const agentVersionId = await seedAgentVersion(fixture);
      const validStep = step('valid', agentVersionId);
      const validDraft = {
        taskId: task.taskId,
        expectedTaskVersion: 1,
        title: 'Valid',
        steps: [validStep],
      };
      const tooManySteps = Array.from({ length: 257 }, (_, index) =>
        step(`step-${index}`, agentVersionId),
      );
      const invalidRequests: Array<[string, string, unknown]> = [
        [
          'draft-version-missing',
          'plan.draft',
          {
            taskId: task.taskId,
            title: 'Missing task version',
            steps: [validStep],
          },
        ],
        ['draft-version-negative', 'plan.draft', { ...validDraft, expectedTaskVersion: -1 }],
        ['draft-top-auth', 'plan.draft', { ...validDraft, approved: true }],
        [
          'draft-step-auth',
          'plan.draft',
          { ...validDraft, steps: [{ ...validStep, authorization: 'human' }] },
        ],
        ['draft-title-long', 'plan.draft', { ...validDraft, title: 'x'.repeat(513) }],
        [
          'draft-step-id-long',
          'plan.draft',
          {
            ...validDraft,
            steps: [{ ...validStep, id: 'x'.repeat(257) }],
          },
        ],
        [
          'draft-agent-empty',
          'plan.draft',
          {
            ...validDraft,
            steps: [{ ...validStep, agentVersionId: '  ' }],
          },
        ],
        [
          'draft-instructions-long',
          'plan.draft',
          {
            ...validDraft,
            steps: [{ ...validStep, instructions: 'x'.repeat(20_001) }],
          },
        ],
        [
          'draft-model-long',
          'plan.draft',
          {
            ...validDraft,
            steps: [{ ...validStep, modelOverrideId: 'x'.repeat(257) }],
          },
        ],
        [
          'draft-dependencies-long',
          'plan.draft',
          {
            ...validDraft,
            steps: [{ ...validStep, dependsOn: Array.from({ length: 257 }, () => 'valid') }],
          },
        ],
        ['draft-steps-long', 'plan.draft', { ...validDraft, steps: tooManySteps }],
        [
          'revise-unknown',
          'plan.revise',
          {
            planId: 'plan-validation',
            expectedRevision: 1,
            steps: [validStep],
            approvalToken: 'not-authorized',
          },
        ],
        ['list-unknown', 'plan.listRevisions', { planId: 'plan-validation', includeSecrets: true }],
        [
          'approve-unknown',
          'plan.approve',
          {
            planId: 'plan-validation',
            revision: 1,
            approvedBy: 'client-claim',
          },
        ],
        [
          'graph-unknown',
          'run.getGraph',
          {
            workspaceId: 'workspace-validation',
            taskId: 'task-validation',
            runId: 'run-validation',
            authorization: true,
          },
        ],
      ];

      for (const [id, type, payload] of invalidRequests) {
        const response = await send(fixture.socket, fixture.reader, id, type, payload);
        expect(response.error, `${type} should reject ${id}`).toMatchObject({
          code: 'protocol.frame_malformed',
        });
      }

      await fixture.close();
      closed = true;
      const connection = await openDatabaseAsync({ path: fixture.dbPath });
      try {
        expect(
          (connection.raw.prepare('SELECT COUNT(*) AS count FROM plan').get() as { count: number })
            .count,
        ).toBe(0);
        expect(
          (
            connection.raw.prepare('SELECT COUNT(*) AS count FROM plan_revision').get() as {
              count: number;
            }
          ).count,
        ).toBe(0);
      } finally {
        connection.raw.close();
      }
    } finally {
      if (!closed) await fixture.close();
    }
  });

  it('rolls back missing exact AgentVersion approval and keeps automatic mode locked', async () => {
    const fixture = await startPersistentFixture('sync-think-plan-missing-agent-');
    let closed = false;
    try {
      const task = await createTask(fixture, 'missing-agent');
      await enterCollaboration(fixture, task.taskId);
      const draftResponse = await send(
        fixture.socket,
        fixture.reader,
        'draft-missing-agent',
        'plan.draft',
        {
          taskId: task.taskId,
          expectedTaskVersion: 1,
          title: 'Missing exact version',
          steps: [step('missing', 'agent-version-does-not-exist')],
        },
      );
      expect(draftResponse.error).toBeUndefined();
      const draft = draftResponse.payload as unknown as PlanRevisionWire;

      const approval = await send(
        fixture.socket,
        fixture.reader,
        'approve-missing-agent',
        'plan.approve',
        {
          planId: draft.planId,
          revision: 1,
        },
      );
      expect(approval.error).toMatchObject({ code: 'protocol.unexpected_request' });

      const automatic = await send(
        fixture.socket,
        fixture.reader,
        'mode-no-approved-plan',
        'task.setParticipationMode',
        { taskId: task.taskId, mode: 'automatic', expectedTaskVersion: 2 },
      );
      expect(automatic.error).toMatchObject({ code: 'approval.required' });

      const listed = await send(
        fixture.socket,
        fixture.reader,
        'list-after-failed-approval',
        'plan.listRevisions',
        {
          planId: draft.planId,
        },
      );
      expect(listed.payload).toMatchObject({
        revisions: [{ id: draft.id, revision: 1, state: 'draft' }],
      });

      const replay = await send(
        fixture.socket,
        fixture.reader,
        'events-after-failed-approval',
        'runtime.subscribeEvents',
        { afterCursor: 0 },
      );
      const eventTypes = (
        replay.payload as { replayedEvents: Array<{ type: string }> }
      ).replayedEvents.map((event) => event.type);
      expect(eventTypes).toContain('plan.drafted');
      expect(eventTypes).not.toContain('plan.approved');
      expect(eventTypes).not.toContain('run.queued');
      expect(eventTypes).not.toContain('step.created');

      await fixture.close();
      closed = true;
      const connection = await openDatabaseAsync({ path: fixture.dbPath });
      try {
        expect(
          (connection.raw.prepare('SELECT COUNT(*) AS count FROM run').get() as { count: number })
            .count,
        ).toBe(0);
        expect(
          (connection.raw.prepare('SELECT COUNT(*) AS count FROM step').get() as { count: number })
            .count,
        ).toBe(0);
      } finally {
        connection.raw.close();
      }
    } finally {
      if (!closed) await fixture.close();
    }
  });

  it('rolls back a failed approval transition without advancing events or checkpoint and permits retry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-plan-approve-atomic-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const workspace = workspaceStore.createWorkspace({
      folderPath: join(dir, 'workspace'),
      name: 'Approval atomicity',
    });
    const task = workspaceStore.createTask({
      workspaceId: workspace.id,
      title: 'Atomic approval',
      goal: 'Retry after event persistence failure',
    });
    workspaceStore.setParticipationMode(task.taskId, 'collaboration', 0);
    const persistedState = new SqliteEventCheckpointStore(connection.raw);
    let rejectNextApproval = true;
    const approvalFailingStateStore: RuntimeStateStore = {
      commitTransition(input) {
        const committed = persistedState.commitTransition(input);
        if (
          rejectNextApproval &&
          input.events.some(
            (event) => event.type === 'plan.approved' || event.type === 'run.queued',
          )
        ) {
          rejectNextApproval = false;
          throw new Error('forced approval event failure');
        }
        return committed;
      },
      listEvents(workspaceId, afterSequence) {
        return persistedState.listEvents(workspaceId, afterSequence);
      },
      listAllEvents(afterSequence) {
        return persistedState.listAllEvents(afterSequence);
      },
      loadLatestCheckpoint(runId) {
        return persistedState.loadLatestCheckpoint(runId);
      },
    };
    const installId = `plan-approve-atomic-${randomBytes(5).toString('hex')}`;
    const orchestrationStore = new SqliteOrchestrationStore(connection.raw);
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      workspaceId: workspace.id,
      workspaceStore,
      agentStore: new SqliteAgentStore(connection.raw),
      orchestrationStore,
      stateStore: approvalFailingStateStore,
      unitOfWork: new SqliteUnitOfWork(connection.raw),
    });
    await runtime.start();
    const { socket, reader } = await connectAndHello(installId);

    try {
      const agent = await send(socket, reader, 'approve-atomic-agent', 'agent.get', {});
      const agentVersionId = (agent.payload as { agent: { agentVersionId: string } }).agent
        .agentVersionId;
      const draftResponse = await send(socket, reader, 'approve-atomic-draft', 'plan.draft', {
        taskId: task.taskId,
        expectedTaskVersion: 1,
        title: 'Approval rollback',
        steps: [
          step('prepare', agentVersionId),
          step('finish', agentVersionId, {
            dependsOn: ['prepare' as StepId],
          }),
        ],
      });
      expect(draftResponse.error).toBeUndefined();
      const draft = draftResponse.payload as unknown as PlanRevisionWire;
      const revisedResponse = await send(socket, reader, 'approve-atomic-revise', 'plan.revise', {
        planId: draft.planId,
        expectedRevision: 1,
        title: 'Approval rollback v2',
        steps: draft.steps,
      });
      expect(revisedResponse.error).toBeUndefined();
      const revised = revisedResponse.payload as unknown as PlanRevisionWire;
      const checkpointBefore = persistedState.loadLatestCheckpoint(`runtime-${installId}` as never);
      const eventTypesBefore = persistedState
        .listEvents(workspace.id, 0)
        .map((event) => event.type);

      const failedApproval = await send(socket, reader, 'approve-atomic-fail', 'plan.approve', {
        planId: draft.planId,
        revision: 2,
      });
      expect(failedApproval.error).toMatchObject({ code: 'storage.write_failed' });
      expect(orchestrationStore.getPlanRevision(draft.planId as never, 2)).toMatchObject({
        id: revised.id,
        state: 'draft',
        approvedAt: undefined,
      });
      expect(
        (connection.raw.prepare('SELECT COUNT(*) AS count FROM run').get() as { count: number })
          .count,
      ).toBe(0);
      expect(
        (connection.raw.prepare('SELECT COUNT(*) AS count FROM step').get() as { count: number })
          .count,
      ).toBe(0);
      expect(
        (
          connection.raw.prepare('SELECT COUNT(*) AS count FROM step_dependency').get() as {
            count: number;
          }
        ).count,
      ).toBe(0);
      expect(persistedState.listEvents(workspace.id, 0).map((event) => event.type)).toEqual(
        eventTypesBefore,
      );
      expect(persistedState.listEvents(workspace.id, 0).map((event) => event.type)).not.toEqual(
        expect.arrayContaining(['plan.approved', 'run.queued', 'step.created']),
      );
      expect(persistedState.loadLatestCheckpoint(`runtime-${installId}` as never)).toEqual(
        checkpointBefore,
      );

      const retriedApproval = await send(socket, reader, 'approve-atomic-retry', 'plan.approve', {
        planId: draft.planId,
        revision: 2,
      });
      expect(retriedApproval.error).toBeUndefined();
      expect(retriedApproval.payload).toMatchObject({
        run: { state: 'queued', planRevisionId: revised.id },
        steps: [{ id: 'prepare' }, { id: 'finish' }],
        dependencies: [{ stepId: 'finish', dependsOnStepId: 'prepare' }],
      });
      expect(orchestrationStore.getPlanRevision(draft.planId as never, 2)).toMatchObject({
        id: revised.id,
        state: 'approved',
      });
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });

  it('rolls back plan domain rows, events, and checkpoints when transition persistence fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-plan-atomic-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const workspace = workspaceStore.createWorkspace({
      folderPath: join(dir, 'workspace'),
      name: 'Plan atomicity',
    });
    const task = workspaceStore.createTask({
      workspaceId: workspace.id,
      title: 'Atomic plan',
      goal: 'Roll back plan and event together',
    });
    workspaceStore.setParticipationMode(task.taskId, 'collaboration', 0);
    const persistedState = new SqliteEventCheckpointStore(connection.raw);
    const throwingStateStore: RuntimeStateStore = {
      commitTransition(input) {
        persistedState.commitTransition(input);
        throw new Error('forced plan event failure');
      },
      listEvents(workspaceId, afterSequence) {
        return persistedState.listEvents(workspaceId, afterSequence);
      },
      listAllEvents(afterSequence) {
        return persistedState.listAllEvents(afterSequence);
      },
      loadLatestCheckpoint(runId) {
        return persistedState.loadLatestCheckpoint(runId);
      },
    };
    const installId = `plan-atomic-${randomBytes(5).toString('hex')}`;
    const orchestrationStore = new SqliteOrchestrationStore(connection.raw);
    const runtimeOptions = {
      installId,
      allowNoToken: true,
      workspaceId: workspace.id as WorkspaceId,
      workspaceStore,
      agentStore: new SqliteAgentStore(connection.raw),
      orchestrationStore,
      stateStore: throwingStateStore,
      unitOfWork: new SqliteUnitOfWork(connection.raw),
    };
    const runtime = new Runtime(runtimeOptions);
    await runtime.start();
    const { socket, reader } = await connectAndHello(installId);

    try {
      const response = await send(socket, reader, 'draft-atomic-failure', 'plan.draft', {
        taskId: task.taskId,
        expectedTaskVersion: 1,
        title: 'Must roll back',
        steps: [step('atomic', 'agent-version-not-needed-until-approval')],
      });
      expect(response.error).toMatchObject({ code: 'storage.write_failed' });
      expect(
        (connection.raw.prepare('SELECT COUNT(*) AS count FROM plan').get() as { count: number })
          .count,
      ).toBe(0);
      expect(
        (
          connection.raw.prepare('SELECT COUNT(*) AS count FROM plan_revision').get() as {
            count: number;
          }
        ).count,
      ).toBe(0);
      expect(
        (connection.raw.prepare('SELECT COUNT(*) AS count FROM event').get() as { count: number })
          .count,
      ).toBe(0);
      expect(
        (
          connection.raw.prepare('SELECT COUNT(*) AS count FROM checkpoint').get() as {
            count: number;
          }
        ).count,
      ).toBe(0);
      expect(workspaceStore.getTask(task.taskId)?.version).toBe(1);
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });
});
