import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AgentVersionId,
  ArtifactVersion,
  ReviewOutcome,
  StepId,
  TaskId,
  WorkspaceId,
} from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteOrchestrationStore,
  type BetterSQLite3Raw,
} from '@sync-think/storage';
import { Scheduler } from '../src/orchestration/scheduler.js';
import type {
  StepExecutionContext,
  StepExecutionResult,
  StepExecutor,
} from '../src/orchestration/step-executor.js';

const dirs: string[] = [];
const workspaceId = 'workspace-review-runtime' as WorkspaceId;
const taskId = 'task-review-runtime' as TaskId;
const targetAgent = 'agent-version-review-target' as AgentVersionId;
const reviewerAgent = 'agent-version-reviewer' as AgentVersionId;
const backupAgent = 'agent-version-reviewer-backup' as AgentVersionId;

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seed(raw: BetterSQLite3Raw): void {
  raw
    .prepare(
      `INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
     VALUES (?, 'D:\\review-runtime', 'Review runtime', 't0', 't0')`,
    )
    .run(workspaceId);
  raw
    .prepare(
      `INSERT INTO task (
       id, workspace_id, title, goal, status, participation_mode,
       acceptance_criteria_json, version, created_at, updated_at
     ) VALUES (?, ?, 'Review runtime', 'Bound rework', 'active', 'automatic',
       '["criterion-one","criterion-two"]', 0, 't0', 't0')`,
    )
    .run(taskId, workspaceId);
  const insertAgent = raw.prepare(
    `INSERT INTO agent_version (
       id, agent_id, version, name, role, developer_instructions, input_contract,
       output_contract, default_model_id, default_credential_group_id,
       pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
       memory_scope, skill_version_ids_json, mcp_server_ids_json, policy_id,
       approval_mode, review_behavior_json, created_at
     ) VALUES (?, ?, 1, ?, ?, '', '', '', ?, ?, NULL, 1, '[]', 'task',
       '[]', '[]', NULL, 'request', ?, 't0')`,
  );
  insertAgent.run(
    targetAgent,
    'agent-review-target',
    'Target',
    'worker',
    'model-target',
    'group-target',
    '{"role":"none","maxIterations":0,"onLimitReached":"pause"}',
  );
  insertAgent.run(
    reviewerAgent,
    'agent-reviewer',
    'Reviewer',
    'reviewer',
    'model-reviewer',
    'group-reviewer',
    '{"role":"reviewer","maxIterations":1,"onLimitReached":"pause"}',
  );
  insertAgent.run(
    backupAgent,
    'agent-reviewer-backup',
    'Backup',
    'reviewer',
    'model-backup',
    'group-backup',
    '{"role":"reviewer","maxIterations":0,"onLimitReached":"pause"}',
  );
}

async function fixture(
  options: {
    maxIterations?: number;
    onLimitReached?: 'pause' | 'abort' | 'reassign';
    backup?: boolean;
    withChild?: boolean;
    withPlannedReviewerChild?: boolean;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-review-runtime-'));
  dirs.push(dir);
  const path = join(dir, 'sync-think.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  seed(connection.raw);
  const store = new SqliteOrchestrationStore(connection.raw);
  const draft = store.createPlanDraft({
    taskId,
    title: 'Review plan',
    steps: [
      {
        id: 'target-step' as StepId,
        title: 'Target',
        instructions: 'Produce the candidate',
        agentVersionId: targetAgent,
        dependsOn: [],
      },
      ...(options.withChild
        ? [
            {
              id: 'child-step' as StepId,
              title: 'Child',
              instructions: 'Consume only accepted target evidence',
              agentVersionId: targetAgent,
              dependsOn: ['target-step' as StepId],
            },
          ]
        : []),
      ...(options.withPlannedReviewerChild
        ? [
            {
              id: 'planned-reviewer-step' as StepId,
              title: 'Planned reviewer',
              instructions: 'Review the exact target evidence',
              agentVersionId: reviewerAgent,
              dependsOn: ['target-step' as StepId],
            },
            {
              id: 'child-step' as StepId,
              title: 'Child',
              instructions: 'Consume only accepted target evidence',
              agentVersionId: targetAgent,
              dependsOn: ['planned-reviewer-step' as StepId],
            },
          ]
        : []),
    ],
    now: '2026-07-14T00:00:00.000Z',
  });
  const graph = store.approvePlan({
    planId: draft.planId,
    revision: 1,
    now: '2026-07-14T00:00:01.000Z',
  });
  const gate = store.createAcceptanceGate({
    id: 'gate-review-runtime' as never,
    runId: graph.run.id,
    targetStepId: 'target-step' as StepId,
    reviewerAgentVersionId: reviewerAgent,
    ...(options.withPlannedReviewerChild
      ? { initialReviewerStepId: 'planned-reviewer-step' as StepId }
      : {}),
    ...(options.backup ? { backupAgentVersionId: backupAgent } : {}),
    maxIterations: options.maxIterations ?? 1,
    onLimitReached: options.onLimitReached ?? 'pause',
    criteria: [
      { id: 'criterion-one', description: 'First criterion' },
      { id: 'criterion-two', description: 'Second criterion' },
    ],
    now: '2026-07-14T00:00:02.000Z',
  });
  return { ...connection, store, graph, gate };
}

function outcome(context: StepExecutionContext, verdict: 'accept' | 'reject'): ReviewOutcome {
  if (context.reviewContext?.kind !== 'reviewer') throw new Error('review context missing');
  return {
    verdict,
    explanation: `${verdict} at iteration ${context.reviewContext.iteration}`,
    criteria: context.reviewContext.criteria.map((criterion, index) => ({
      criterionId: criterion.id,
      verdict: verdict === 'reject' && index === 0 ? 'fail' : 'pass',
      explanation: `checked ${criterion.id}`,
    })),
    reviewedArtifactVersionIds: context.reviewContext.reviewedArtifactVersions.map(
      (version) => version.id,
    ),
  };
}

function targetOutput(content = 'version one'): StepExecutionResult {
  return {
    outputVersions: [
      {
        artifactName: 'review.txt',
        content,
        mimeType: 'text/plain',
        status: 'candidate',
      },
    ],
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Scheduler reviewer/rework', () => {
  it('blocks a transitive child behind a planned reviewer until final acceptance', async () => {
    const f = await fixture({ withPlannedReviewerChild: true });
    const calls: string[] = [];
    let childSnapshot: readonly ArtifactVersion[] = [];
    const scheduler = new Scheduler({
      store: f.store,
      executor: {
        async execute(context) {
          if (context.step.id === ('target-step' as StepId)) {
            calls.push('target');
            return targetOutput('version one');
          }
          if (!context.reviewContext) {
            calls.push('child');
            childSnapshot = context.artifactVersions;
            return targetOutput('child output');
          }
          if (context.reviewContext.kind === 'reviewer') {
            calls.push(
              context.reviewContext.iteration === 0
                ? 'planned-reviewer-0'
                : `reviewer-${context.reviewContext.iteration}`,
            );
            return {
              reviewOutcome: outcome(
                context,
                context.reviewContext.iteration === 0 ? 'reject' : 'accept',
              ),
            };
          }

          calls.push(`rework-${context.reviewContext.iteration}`);
          const parentId = context.reviewContext.evidence.reviewedArtifactVersionIds[0]!;
          const parent = context.artifactVersions.find((version) => version.id === parentId);
          if (!parent) throw new Error(`Missing rework parent ${parentId}`);
          return {
            outputVersions: [
              {
                artifactId: parent.artifactId,
                content: 'version two',
                mimeType: parent.mimeType,
                status: 'candidate',
                parentVersionIds: [parent.id],
              },
            ],
          };
        },
      },
      ownerId: 'scheduler-review-transitive-gated-child',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('completed');
      expect(calls).toEqual(['target', 'planned-reviewer-0', 'rework-1', 'reviewer-1', 'child']);

      const versions = f.store.listRunArtifactVersions(f.graph.run.id);
      const rejectedV1 = versions.find((version) => version.content === 'version one')!;
      const acceptedV2 = versions.find((version) => version.content === 'version two')!;
      expect(childSnapshot.map((version) => version.id)).toEqual([acceptedV2.id]);
      expect(childSnapshot.map((version) => version.id)).not.toContain(rejectedV1.id);
    } finally {
      await scheduler.shutdown();
      f.raw.close();
    }
  });

  it('blocks an ordinary successor until acceptance and snapshots only final accepted evidence', async () => {
    const f = await fixture({ withChild: true });
    const calls: string[] = [];
    let childSnapshot: readonly ArtifactVersion[] = [];
    const scheduler = new Scheduler({
      store: f.store,
      executor: {
        async execute(context) {
          if (context.step.id === ('target-step' as StepId)) {
            calls.push('target');
            return targetOutput('version one');
          }
          if (!context.reviewContext) {
            calls.push('child');
            childSnapshot = context.artifactVersions;
            return targetOutput('child output');
          }
          if (context.reviewContext.kind === 'reviewer') {
            calls.push(`reviewer-${context.reviewContext.iteration}`);
            return {
              reviewOutcome: outcome(
                context,
                context.reviewContext.iteration === 0 ? 'reject' : 'accept',
              ),
            };
          }

          calls.push(`rework-${context.reviewContext.iteration}`);
          const parentId = context.reviewContext.evidence.reviewedArtifactVersionIds[0]!;
          const parent = context.artifactVersions.find((version) => version.id === parentId);
          if (!parent) throw new Error(`Missing rework parent ${parentId}`);
          return {
            outputVersions: [
              {
                artifactId: parent.artifactId,
                content: 'version two',
                mimeType: parent.mimeType,
                status: 'candidate',
                parentVersionIds: [parent.id],
              },
            ],
          };
        },
      },
      ownerId: 'scheduler-review-gated-successor',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('completed');
      expect(calls).toEqual(['target', 'reviewer-0', 'rework-1', 'reviewer-1', 'child']);

      const targetVersions = f.store
        .listRunArtifactVersions(f.graph.run.id)
        .filter((version) => version.sourceStepId !== ('child-step' as StepId));
      expect(targetVersions).toMatchObject([
        { version: 1, content: 'version one' },
        { version: 2, content: 'version two', parentVersionIds: [targetVersions[0]?.id] },
      ]);
      expect(childSnapshot.map((version) => version.id)).toEqual([targetVersions[1]!.id]);
      expect(childSnapshot.map((version) => version.id)).not.toContain(targetVersions[0]!.id);
    } finally {
      await scheduler.shutdown();
      f.raw.close();
    }
  });

  it.each([
    {
      name: 'accept with a failed criterion',
      verdict: 'accept' as const,
      criterionVerdicts: ['fail', 'pass'] as const,
    },
    {
      name: 'reject with every criterion passing',
      verdict: 'reject' as const,
      criterionVerdicts: ['pass', 'pass'] as const,
    },
  ])(
    'fails closed before evidence persistence for $name',
    async ({ verdict, criterionVerdicts }) => {
      const f = await fixture();
      const scheduler = new Scheduler({
        store: f.store,
        executor: {
          async execute(context) {
            if (!context.reviewContext) return targetOutput();
            if (context.reviewContext.kind !== 'reviewer') {
              throw new Error('Contradictory outcome must not derive rework');
            }
            return {
              reviewOutcome: {
                verdict,
                explanation: 'Contradictory aggregate and criterion verdicts.',
                criteria: context.reviewContext.criteria.map((criterion, index) => ({
                  criterionId: criterion.id,
                  verdict: criterionVerdicts[index]!,
                  explanation: `Checked ${criterion.id}`,
                })),
                reviewedArtifactVersionIds: context.reviewContext.reviewedArtifactVersions.map(
                  (version) => version.id,
                ),
              },
            };
          },
        },
        ownerId: `scheduler-review-contradiction-${verdict}`,
        now: () => '2026-07-14T01:00:00.000Z',
      });
      try {
        const result = await scheduler.runUntilIdle(f.graph.run.id);
        expect(result.graph.run.state).toBe('failed');
        expect(result.graph.steps.at(-1)?.state).toBe('failed');
        expect(f.store.getAcceptanceGate(f.gate.id)?.state).toBe('active');
        expect(f.store.listReviewEvidence(f.gate.id)).toEqual([]);
        expect(
          f.raw
            .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'review.evidence-recorded'")
            .get(),
        ).toEqual({ count: 0 });
        const failedEvent = f.raw
          .prepare(
            "SELECT payload_json FROM event WHERE type = 'step.failed' ORDER BY rowid DESC LIMIT 1",
          )
          .get() as { payload_json: string };
        expect(JSON.parse(failedEvent.payload_json)).toMatchObject({
          failureClass: 'acceptance',
          code: 'review.verdict_criteria_mismatch',
        });
      } finally {
        await scheduler.shutdown();
        f.raw.close();
      }
    },
  );

  it('holds completion until the persisted reviewer accepts', async () => {
    const f = await fixture();
    const calls: StepExecutionContext[] = [];
    const executor: StepExecutor = {
      async execute(context) {
        calls.push(context);
        if (!context.reviewContext) return targetOutput();
        expect(context.reviewContext.kind).toBe('reviewer');
        expect(Object.isFrozen(context.reviewContext)).toBe(true);
        return { reviewOutcome: outcome(context, 'accept') };
      },
    };
    const scheduler = new Scheduler({
      store: f.store,
      executor,
      ownerId: 'scheduler-review-accept',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    try {
      const targetTick = await scheduler.tick(f.graph.run.id);
      expect(targetTick.graph.run.state).toBe('reviewing');
      expect(targetTick.graph.steps).toHaveLength(2);
      expect(
        f.raw.prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'run.completed'").get(),
      ).toEqual({ count: 0 });
      expect(f.store.pauseRun(f.graph.run.id).run.state).toBe('paused');
      expect(f.store.resumeRun(f.graph.run.id).run.state).toBe('reviewing');
      expect(
        f.raw.prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'run.completed'").get(),
      ).toEqual({ count: 0 });

      const completed = await scheduler.runUntilIdle(f.graph.run.id);
      expect(completed.graph.run.state).toBe('completed');
      expect(calls.map((context) => context.reviewContext?.kind ?? 'target')).toEqual([
        'target',
        'reviewer',
      ]);
      expect(f.store.listReviewEvidence(f.gate.id)).toMatchObject([
        { verdict: 'accept', iteration: 0 },
      ]);
      expect(
        f.raw.prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'run.completed'").get(),
      ).toEqual({ count: 1 });
    } finally {
      await scheduler.shutdown();
      f.raw.close();
    }
  });

  it('fails and cleans up a claimed reviewer when persisted context initialization throws', async () => {
    const f = await fixture();
    const originalGetReviewStepContext = f.store.getReviewStepContext.bind(f.store);
    f.store.getReviewStepContext = (runId, stepId) => {
      if (stepId !== ('target-step' as StepId)) {
        throw new Error('review.context_initialization_failed');
      }
      return originalGetReviewStepContext(runId, stepId);
    };
    let executorCalls = 0;
    let heartbeatStarts = 0;
    let heartbeatStops = 0;
    const scheduler = new Scheduler({
      store: f.store,
      executor: {
        async execute() {
          executorCalls += 1;
          return targetOutput();
        },
      },
      ownerId: 'scheduler-review-context-initialization-failure',
      now: () => '2026-07-14T01:00:00.000Z',
      heartbeatIntervalMs: 1,
      wait: (_delayMs, signal) =>
        new Promise<void>((resolve) => {
          heartbeatStarts += 1;
          const stop = () => {
            heartbeatStops += 1;
            resolve();
          };
          if (signal.aborted) stop();
          else signal.addEventListener('abort', stop, { once: true });
        }),
    });
    try {
      expect((await scheduler.tick(f.graph.run.id)).graph.run.state).toBe('reviewing');
      const failed = await scheduler.tick(f.graph.run.id);
      expect(failed.graph.run.state).toBe('failed');
      expect(executorCalls).toBe(1);
      expect(failed.graph.steps.at(-1)).toMatchObject({
        state: 'failed',
        leaseExpiresAt: undefined,
      });
      expect(heartbeatStarts).toBe(2);
      expect(heartbeatStops).toBe(heartbeatStarts);
      expect((scheduler as unknown as { active: Map<string, AbortController> }).active.size).toBe(
        0,
      );
      const failedEvent = f.raw
        .prepare(
          "SELECT payload_json FROM event WHERE type = 'step.failed' ORDER BY rowid DESC LIMIT 1",
        )
        .get() as { payload_json: string };
      expect(JSON.parse(failedEvent.payload_json)).toMatchObject({
        failureClass: 'unknown',
        code: 'step.executor.unknown',
      });

      const shutdownResult = await Promise.race([
        scheduler.shutdown().then(() => 'shutdown'),
        new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 250)),
      ]);
      expect(shutdownResult).toBe('shutdown');
    } finally {
      await scheduler.shutdown();
      f.raw.close();
    }
  });

  it('keeps a user pause stable when an active reviewer accepts late', async () => {
    const f = await fixture();
    const reviewerEntered = deferred();
    const releaseReviewer = deferred();
    const scheduler = new Scheduler({
      store: f.store,
      executor: {
        async execute(context) {
          if (!context.reviewContext) return targetOutput();
          expect(context.reviewContext.kind).toBe('reviewer');
          reviewerEntered.resolve();
          await releaseReviewer.promise;
          return { reviewOutcome: outcome(context, 'accept') };
        },
      },
      ownerId: 'scheduler-review-late-accept-pause',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    try {
      expect((await scheduler.tick(f.graph.run.id)).graph.run.state).toBe('reviewing');

      const drain = scheduler.runUntilIdle(f.graph.run.id);
      await reviewerEntered.promise;
      expect(scheduler.pause(f.graph.run.id).run.state).toBe('paused');

      releaseReviewer.resolve();
      expect((await drain).graph.run.state).toBe('paused');
      expect(f.store.listReviewEvidence(f.gate.id)).toMatchObject([
        { iteration: 0, verdict: 'accept' },
      ]);
      expect(
        f.raw.prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'run.completed'").get(),
      ).toEqual({ count: 0 });

      expect(scheduler.resume(f.graph.run.id).run.state).toBe('completed');
      expect(
        f.raw.prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'run.completed'").get(),
      ).toEqual({ count: 1 });
    } finally {
      releaseReviewer.resolve();
      await scheduler.shutdown();
      f.raw.close();
    }
  });

  it('applies a late abort-limit verdict even when the user paused the Run', async () => {
    const f = await fixture({ maxIterations: 0, onLimitReached: 'abort' });
    const reviewerEntered = deferred();
    const releaseReviewer = deferred();
    const scheduler = new Scheduler({
      store: f.store,
      executor: {
        async execute(context) {
          if (!context.reviewContext) return targetOutput();
          expect(context.reviewContext.kind).toBe('reviewer');
          reviewerEntered.resolve();
          await releaseReviewer.promise;
          return { reviewOutcome: outcome(context, 'reject') };
        },
      },
      ownerId: 'scheduler-review-late-abort-pause',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    try {
      expect((await scheduler.tick(f.graph.run.id)).graph.run.state).toBe('reviewing');

      const drain = scheduler.runUntilIdle(f.graph.run.id);
      await reviewerEntered.promise;
      expect(scheduler.pause(f.graph.run.id).run.state).toBe('paused');

      releaseReviewer.resolve();
      expect((await drain).graph.run.state).toBe('failed');
      expect(f.store.getAcceptanceGate(f.gate.id)).toMatchObject({ state: 'limit-reached' });
      expect(f.store.resumeRun(f.graph.run.id).run.state).toBe('failed');
      expect(
        f.raw.prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'run.failed'").get(),
      ).toEqual({ count: 1 });
      expect(
        f.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'review.limit-reached'")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      releaseReviewer.resolve();
      await scheduler.shutdown();
      f.raw.close();
    }
  });

  it('derives exactly one rework, preserves v1, creates v2, then pauses at maxIterations=1', async () => {
    const f = await fixture();
    const calls: string[] = [];
    const executor: StepExecutor = {
      async execute(context) {
        if (!context.reviewContext) {
          calls.push('target');
          return targetOutput();
        }
        if (context.reviewContext.kind === 'reviewer') {
          calls.push(`reviewer-${context.reviewContext.iteration}`);
          expect(context.artifactVersions.map((version) => version.id)).toEqual(
            context.reviewContext.reviewedArtifactVersions.map((version) => version.id),
          );
          return { reviewOutcome: outcome(context, 'reject') };
        }
        calls.push(`rework-${context.reviewContext.iteration}`);
        const reviewedId = context.reviewContext.evidence.reviewedArtifactVersionIds[0]!;
        const prior = context.artifactVersions.find((version) => version.id === reviewedId);
        if (!prior) throw new Error('reviewed version missing from rework snapshot');
        return {
          outputVersions: [
            {
              artifactId: prior.artifactId,
              content: 'version two',
              mimeType: 'text/plain',
              status: 'candidate',
              parentVersionIds: [prior.id],
            },
          ],
        };
      },
    };
    const scheduler = new Scheduler({
      store: f.store,
      executor,
      ownerId: 'scheduler-review-rework',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('paused');
      expect(calls).toEqual(['target', 'reviewer-0', 'rework-1', 'reviewer-1']);
      expect(result.graph.steps).toHaveLength(4);
      expect(f.store.listRunArtifactVersions(f.graph.run.id)).toMatchObject([
        { version: 1, content: 'version one' },
        { version: 2, content: 'version two' },
      ]);
      expect(f.store.listReviewEvidence(f.gate.id)).toMatchObject([
        { iteration: 0, verdict: 'reject', reviewerAgentVersionId: reviewerAgent },
        { iteration: 1, verdict: 'reject', reviewerAgentVersionId: reviewerAgent },
      ]);
      expect(
        f.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'review.limit-reached'")
          .get(),
      ).toEqual({ count: 1 });
      expect(f.store.resumeRun(f.graph.run.id).run.state).toBe('paused');
    } finally {
      await scheduler.shutdown();
      f.raw.close();
    }
  });

  it('reaches a configured high iteration limit using only each mapped exact snapshot', async () => {
    const maxIterations = 32;
    const f = await fixture({ maxIterations, onLimitReached: 'pause' });
    const reviewerIterations: number[] = [];
    const reworkIterations: number[] = [];
    const scheduler = new Scheduler({
      store: f.store,
      executor: {
        async execute(context) {
          if (!context.reviewContext) return targetOutput();
          if (context.reviewContext.kind === 'reviewer') {
            reviewerIterations.push(context.reviewContext.iteration);
            expect(context.artifactVersions.map((version) => version.id)).toEqual(
              context.reviewContext.reviewedArtifactVersions.map((version) => version.id),
            );
            expect(context.artifactVersions).toHaveLength(1);
            return { reviewOutcome: outcome(context, 'reject') };
          }

          reworkIterations.push(context.reviewContext.iteration);
          expect(context.artifactVersions.map((version) => version.id)).toEqual(
            context.reviewContext.evidence.reviewedArtifactVersionIds,
          );
          const parent = context.artifactVersions[0];
          if (!parent) throw new Error('exact rework parent missing');
          return {
            outputVersions: [
              {
                artifactId: parent.artifactId,
                content: `version ${context.reviewContext.iteration + 1}`,
                mimeType: parent.mimeType,
                status: 'candidate',
                parentVersionIds: [parent.id],
              },
            ],
          };
        },
      },
      ownerId: 'scheduler-review-high-iteration-limit',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('paused');
      expect(f.store.getAcceptanceGate(f.gate.id)).toMatchObject({ state: 'limit-reached' });
      expect(reviewerIterations).toEqual(
        Array.from({ length: maxIterations + 1 }, (_, iteration) => iteration),
      );
      expect(reworkIterations).toEqual(
        Array.from({ length: maxIterations }, (_, index) => index + 1),
      );
      expect(f.store.listReviewEvidence(f.gate.id)).toHaveLength(maxIterations + 1);
      expect(
        f.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'review.limit-reached'")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      await scheduler.shutdown();
      f.raw.close();
    }
  });

  it('carries unchanged exact artifacts into review after a partial multi-artifact rework', async () => {
    const f = await fixture();
    const reviewerAssignments: string[][] = [];
    const scheduler = new Scheduler({
      store: f.store,
      executor: {
        async execute(context) {
          if (!context.reviewContext) {
            return {
              outputVersions: [
                {
                  artifactName: 'design.txt',
                  content: 'design v1',
                  mimeType: 'text/plain',
                  status: 'candidate',
                },
                {
                  artifactName: 'notes.txt',
                  content: 'notes v1',
                  mimeType: 'text/plain',
                  status: 'candidate',
                },
              ],
            };
          }
          if (context.reviewContext.kind === 'reviewer') {
            reviewerAssignments.push(
              context.reviewContext.reviewedArtifactVersions.map((version) => version.id),
            );
            return {
              reviewOutcome: outcome(
                context,
                context.reviewContext.iteration === 0 ? 'reject' : 'accept',
              ),
            };
          }

          const parentId = context.reviewContext.evidence.reviewedArtifactVersionIds[0]!;
          const parent = context.artifactVersions.find((version) => version.id === parentId);
          if (!parent) throw new Error(`Missing rework parent ${parentId}`);
          return {
            outputVersions: [
              {
                artifactId: parent.artifactId,
                content: 'design v2',
                mimeType: parent.mimeType,
                status: 'candidate',
                parentVersionIds: [parent.id],
              },
            ],
          };
        },
      },
      ownerId: 'scheduler-review-partial-multi-artifact',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('completed');
      expect(reviewerAssignments.map((ids) => ids.length)).toEqual([2, 2]);

      const versions = f.store.listRunArtifactVersions(f.graph.run.id);
      expect(versions).toHaveLength(3);
      const versionsByArtifact = new Map<string, ArtifactVersion[]>();
      for (const version of versions) {
        const artifactVersions = versionsByArtifact.get(version.artifactId) ?? [];
        artifactVersions.push(version);
        versionsByArtifact.set(version.artifactId, artifactVersions);
      }
      const unchangedVersions = [...versionsByArtifact.values()].find(
        (artifactVersions) => artifactVersions.length === 1,
      );
      const reworkedVersions = [...versionsByArtifact.values()].find(
        (artifactVersions) => artifactVersions.length === 2,
      );
      expect(unchangedVersions).toHaveLength(1);
      expect(reworkedVersions).toHaveLength(2);
      expect(reviewerAssignments[1]).toContain(unchangedVersions![0]!.id);
      expect(reviewerAssignments[1]).toContain(reworkedVersions![1]!.id);
      expect(reviewerAssignments[1]).not.toContain(reworkedVersions![0]!.id);
    } finally {
      await scheduler.shutdown();
      f.raw.close();
    }
  });

  it('fails rather than cancels the Run for an abort limit action', async () => {
    const f = await fixture({ maxIterations: 0, onLimitReached: 'abort' });
    const scheduler = new Scheduler({
      store: f.store,
      executor: {
        async execute(context) {
          return context.reviewContext?.kind === 'reviewer'
            ? { reviewOutcome: outcome(context, 'reject') }
            : targetOutput();
        },
      },
      ownerId: 'scheduler-review-abort',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('failed');
      expect(
        f.raw.prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'run.cancelled'").get(),
      ).toEqual({ count: 0 });
      expect(
        f.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'review.limit-reached'")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      await scheduler.shutdown();
      f.raw.close();
    }
  });

  it('reassigns once to the exact backup reviewer and fail-closed pauses without a backup', async () => {
    const withBackup = await fixture({
      maxIterations: 0,
      onLimitReached: 'reassign',
      backup: true,
    });
    const reviewerAgents: AgentVersionId[] = [];
    const scheduler = new Scheduler({
      store: withBackup.store,
      executor: {
        async execute(context) {
          if (context.reviewContext?.kind === 'reviewer') {
            reviewerAgents.push(context.step.agentVersionId);
            return {
              reviewOutcome: outcome(
                context,
                context.step.agentVersionId === backupAgent ? 'accept' : 'reject',
              ),
            };
          }
          return targetOutput();
        },
      },
      ownerId: 'scheduler-review-reassign',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    try {
      expect((await scheduler.runUntilIdle(withBackup.graph.run.id)).graph.run.state).toBe(
        'completed',
      );
      expect(reviewerAgents).toEqual([reviewerAgent, backupAgent]);
      expect(
        withBackup.raw
          .prepare(
            "SELECT COUNT(*) AS count FROM acceptance_gate_step WHERE derivation = 'reassign'",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(
        withBackup.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'review.limit-reached'")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      await scheduler.shutdown();
      withBackup.raw.close();
    }

    const withoutBackup = await fixture({ maxIterations: 0, onLimitReached: 'reassign' });
    const noBackupScheduler = new Scheduler({
      store: withoutBackup.store,
      executor: {
        async execute(context) {
          return context.reviewContext?.kind === 'reviewer'
            ? { reviewOutcome: outcome(context, 'reject') }
            : targetOutput();
        },
      },
      ownerId: 'scheduler-review-no-backup',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    try {
      expect(
        (await noBackupScheduler.runUntilIdle(withoutBackup.graph.run.id)).graph.run.state,
      ).toBe('paused');
      expect(
        withoutBackup.raw
          .prepare(
            "SELECT COUNT(*) AS count FROM acceptance_gate_step WHERE derivation = 'reassign'",
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      await noBackupScheduler.shutdown();
      withoutBackup.raw.close();
    }
  });

  it('does not reassign again when the one backup reviewer also rejects', async () => {
    const f = await fixture({ maxIterations: 0, onLimitReached: 'reassign', backup: true });
    const scheduler = new Scheduler({
      store: f.store,
      executor: {
        async execute(context) {
          return context.reviewContext?.kind === 'reviewer'
            ? { reviewOutcome: outcome(context, 'reject') }
            : targetOutput();
        },
      },
      ownerId: 'scheduler-review-reassign-exhausted',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('paused');
      expect(f.store.listReviewEvidence(f.gate.id)).toHaveLength(2);
      expect(
        f.raw
          .prepare(
            "SELECT COUNT(*) AS count FROM acceptance_gate_step WHERE derivation = 'reassign'",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(
        f.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'review.limit-reached'")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      await scheduler.shutdown();
      f.raw.close();
    }
  });

  it('lets only one of two live Schedulers claim and decide the same reviewer', async () => {
    const f = await fixture();
    const targetScheduler = new Scheduler({
      store: f.store,
      executor: {
        async execute() {
          return targetOutput();
        },
      },
      ownerId: 'scheduler-review-target-only',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    await targetScheduler.tick(f.graph.run.id);
    await targetScheduler.shutdown();

    const entered = deferred();
    const release = deferred();
    let reviewerCalls = 0;
    const executor: StepExecutor = {
      async execute(context) {
        reviewerCalls += 1;
        entered.resolve();
        await release.promise;
        return { reviewOutcome: outcome(context, 'accept') };
      },
    };
    const first = new Scheduler({
      store: f.store,
      executor,
      ownerId: 'scheduler-review-racer-a',
      now: () => '2026-07-14T01:00:01.000Z',
    });
    const second = new Scheduler({
      store: f.store,
      executor,
      ownerId: 'scheduler-review-racer-b',
      now: () => '2026-07-14T01:00:01.000Z',
    });
    try {
      const firstDrain = first.runUntilIdle(f.graph.run.id);
      await entered.promise;
      const secondDrain = await second.runUntilIdle(f.graph.run.id);
      expect(secondDrain.startedStepIds).toEqual([]);
      expect(reviewerCalls).toBe(1);
      release.resolve();
      expect((await firstDrain).graph.run.state).toBe('completed');
      expect(reviewerCalls).toBe(1);
      expect(f.store.listReviewEvidence(f.gate.id)).toHaveLength(1);
      expect(
        f.raw.prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'run.completed'").get(),
      ).toEqual({ count: 1 });
    } finally {
      release.resolve();
      await Promise.all([first.shutdown(), second.shutdown()]);
      f.raw.close();
    }
  });

  it('recovers a leased reviewer as the same Step/key and records one Evidence', async () => {
    const f = await fixture();
    const targetScheduler = new Scheduler({
      store: f.store,
      executor: {
        async execute() {
          return targetOutput();
        },
      },
      ownerId: 'scheduler-before-review-crash',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    await targetScheduler.tick(f.graph.run.id);
    await targetScheduler.shutdown();
    const reviewer = f.store
      .getGraph(f.graph.run.id)!
      .steps.find(
        (step) => f.store.getReviewStepContext(f.graph.run.id, step.id)?.kind === 'reviewer',
      )!;
    const claimed = f.store.claimReadySteps({
      runId: f.graph.run.id,
      stepIds: [reviewer.id],
      ownerId: 'dead-review-owner',
      leaseExpiresAt: '2026-07-14T01:00:10.000Z',
      now: '2026-07-14T01:00:01.000Z',
    }).claimedSteps[0]!;

    const recoveredContexts: StepExecutionContext[] = [];
    const recoveryScheduler = new Scheduler({
      store: f.store,
      executor: {
        async execute(context) {
          recoveredContexts.push(context);
          return { reviewOutcome: outcome(context, 'accept') };
        },
      },
      ownerId: 'scheduler-after-review-crash',
      now: () => '2026-07-14T01:00:11.000Z',
    });
    try {
      const recovered = await recoveryScheduler.recover(f.graph.run.id);
      expect(recovered.graph.run.state).toBe('completed');
      expect(recoveredContexts).toHaveLength(1);
      expect(recoveredContexts[0]!.step).toMatchObject({
        id: claimed.id,
        idempotencyKey: claimed.idempotencyKey,
        executionAttempt: 2,
      });
      expect(f.store.listReviewEvidence(f.gate.id)).toHaveLength(1);
    } finally {
      await recoveryScheduler.shutdown();
      f.raw.close();
    }
  });

  it('recovers a leased rework with the same Step/key and immutable prior Evidence', async () => {
    const f = await fixture();
    const initialScheduler = new Scheduler({
      store: f.store,
      executor: {
        async execute(context) {
          return context.reviewContext?.kind === 'reviewer'
            ? { reviewOutcome: outcome(context, 'reject') }
            : targetOutput();
        },
      },
      ownerId: 'scheduler-before-rework-crash',
      now: () => '2026-07-14T01:00:00.000Z',
    });
    await initialScheduler.tick(f.graph.run.id);
    await initialScheduler.tick(f.graph.run.id);
    await initialScheduler.shutdown();
    const evidenceBefore = structuredClone(f.store.listReviewEvidence(f.gate.id)[0]!);
    const reworkStep = f.store
      .getGraph(f.graph.run.id)!
      .steps.find(
        (step) => f.store.getReviewStepContext(f.graph.run.id, step.id)?.kind === 'rework',
      )!;
    const claimed = f.store.claimReadySteps({
      runId: f.graph.run.id,
      stepIds: [reworkStep.id],
      ownerId: 'dead-rework-owner',
      leaseExpiresAt: '2026-07-14T01:00:10.000Z',
      now: '2026-07-14T01:00:01.000Z',
    }).claimedSteps[0]!;

    const recoveredContexts: StepExecutionContext[] = [];
    const recoveryScheduler = new Scheduler({
      store: f.store,
      executor: {
        async execute(context) {
          recoveredContexts.push(context);
          if (context.reviewContext?.kind === 'rework') {
            const reviewedId = context.reviewContext.evidence.reviewedArtifactVersionIds[0]!;
            const prior = context.artifactVersions.find((version) => version.id === reviewedId)!;
            return {
              outputVersions: [
                {
                  artifactId: prior.artifactId,
                  content: 'recovered version two',
                  mimeType: 'text/plain',
                  status: 'candidate',
                  parentVersionIds: [prior.id],
                },
              ],
            };
          }
          return { reviewOutcome: outcome(context, 'accept') };
        },
      },
      ownerId: 'scheduler-after-rework-crash',
      now: () => '2026-07-14T01:00:11.000Z',
    });
    try {
      const recovered = await recoveryScheduler.recover(f.graph.run.id);
      expect(recovered.graph.run.state).toBe('completed');
      expect(recoveredContexts[0]!.step).toMatchObject({
        id: claimed.id,
        idempotencyKey: claimed.idempotencyKey,
        executionAttempt: 2,
      });
      expect(recoveredContexts[0]!.reviewContext).toMatchObject({
        kind: 'rework',
        evidence: evidenceBefore,
      });
      expect(f.store.listReviewEvidence(f.gate.id)[0]).toEqual(evidenceBefore);
      expect(f.store.listRunArtifactVersions(f.graph.run.id)).toMatchObject([
        { version: 1, content: 'version one' },
        { version: 2, content: 'recovered version two' },
      ]);
    } finally {
      await recoveryScheduler.shutdown();
      f.raw.close();
    }
  });
});
