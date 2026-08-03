import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AcceptanceCriteriaValidationError } from '@sync-think/shared';
import type {
  AgentVersionId,
  ArtifactVersion,
  ReviewOutcome,
  StepId,
  TaskId,
  WorkspaceId,
} from '@sync-think/shared';
import { openDatabaseAsync, type BetterSQLite3Raw } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteArtifactStore } from './artifact-store.js';
import { SqliteOrchestrationStore, type StoredStep } from './orchestration-store.js';

const dirs: string[] = [];
const workspaceId = 'workspace-review' as WorkspaceId;
const taskId = 'task-review' as TaskId;
const targetAgent = 'agent-version-target' as AgentVersionId;
const reviewerAgent = 'agent-version-reviewer' as AgentVersionId;
const backupAgent = 'agent-version-backup' as AgentVersionId;

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seed(raw: BetterSQLite3Raw): void {
  raw
    .prepare(
      `INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
     VALUES (?, 'D:\\review', 'Review', 't0', 't0')`,
    )
    .run(workspaceId);
  raw
    .prepare(
      `INSERT INTO task (
       id, workspace_id, title, goal, status, participation_mode,
       acceptance_criteria_json, version, created_at, updated_at
     ) VALUES (?, ?, 'Review', 'Bounded review', 'active', 'automatic',
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
    'agent-target',
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
    'agent-backup',
    'Backup reviewer',
    'reviewer',
    'model-backup',
    'group-backup',
    '{"role":"reviewer","maxIterations":0,"onLimitReached":"pause"}',
  );
}

async function fixture(onLimitReached: 'pause' | 'abort' | 'reassign' = 'pause') {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-review-store-'));
  dirs.push(dir);
  const path = join(dir, 'sync-think.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  try {
    seed(connection.raw);
    const store = new SqliteOrchestrationStore(connection.raw);
    const draft = store.createPlanDraft({
      taskId,
      title: 'Review plan',
      steps: [
        {
          id: 'target-step' as StepId,
          title: 'Target',
          instructions: 'Produce v1',
          agentVersionId: targetAgent,
          dependsOn: [],
        },
      ],
      now: '2026-07-14T00:00:00.000Z',
    });
    const graph = store.approvePlan({
      planId: draft.planId,
      revision: 1,
      now: '2026-07-14T00:00:01.000Z',
    });
    const gate = store.createAcceptanceGate({
      id: 'gate-review' as never,
      runId: graph.run.id,
      targetStepId: 'target-step' as StepId,
      reviewerAgentVersionId: reviewerAgent,
      ...(onLimitReached === 'reassign' ? { backupAgentVersionId: backupAgent } : {}),
      maxIterations: 1,
      onLimitReached,
      criteria: [
        { id: 'criterion-one', description: 'First criterion' },
        { id: 'criterion-two', description: 'Second criterion' },
      ],
      now: '2026-07-14T00:00:02.000Z',
    });
    return { ...connection, store, graph, gate };
  } catch (error) {
    connection.raw.close();
    throw error;
  }
}

function claim(
  store: SqliteOrchestrationStore,
  runId: import('@sync-think/shared').RunId,
  stepId: StepId,
  ownerId: string,
  now: string,
): StoredStep {
  return store.claimReadySteps({
    runId,
    stepIds: [stepId],
    ownerId,
    leaseExpiresAt: '9999-12-31T23:59:59.999Z',
    now,
  }).claimedSteps[0]!;
}

function reviewOutcome(
  verdict: 'accept' | 'reject',
  version: ArtifactVersion,
  explanation = `${verdict} explanation`,
): ReviewOutcome {
  return {
    verdict,
    explanation,
    criteria: [
      {
        criterionId: 'criterion-one',
        verdict: verdict === 'accept' ? 'pass' : 'fail',
        explanation,
      },
      { criterionId: 'criterion-two', verdict: 'pass', explanation: 'criterion two checked' },
    ],
    reviewedArtifactVersionIds: [version.id],
  };
}

function completeTarget(f: Awaited<ReturnType<typeof fixture>>): ArtifactVersion {
  const target = claim(
    f.store,
    f.graph.run.id,
    'target-step' as StepId,
    'owner-target',
    '2026-07-14T00:00:03.000Z',
  );
  return f.store.completeStep({
    runId: f.graph.run.id,
    stepId: target.id,
    idempotencyKey: target.idempotencyKey!,
    ownerId: 'owner-target',
    executionAttempt: target.executionAttempt,
    outputVersions: [
      {
        artifactName: 'review.txt',
        content: 'version one',
        mimeType: 'text/plain',
        status: 'candidate',
      },
    ],
    now: '2026-07-14T00:00:04.000Z',
  }).outputVersions[0]!;
}

function completeImageCandidates(
  f: Awaited<ReturnType<typeof fixture>>,
  count: number,
): ArtifactVersion[] {
  const target = claim(
    f.store,
    f.graph.run.id,
    'target-step' as StepId,
    'owner-image-target',
    '2026-07-14T00:00:03.000Z',
  );
  return f.store.completeStep({
    runId: f.graph.run.id,
    stepId: target.id,
    idempotencyKey: target.idempotencyKey!,
    ownerId: 'owner-image-target',
    executionAttempt: target.executionAttempt,
    outputVersions: Array.from({ length: count }, (_, index) => ({
      artifactName: 'generated-images',
      artifactGroupKey: 'generated-image-candidates',
      contentRef: join('D:\\runtime-images', `candidate-${index + 1}.png`),
      contentHash: String(index + 1).repeat(64),
      mimeType: 'image/png',
      status: 'candidate' as const,
    })),
    now: '2026-07-14T00:00:04.000Z',
  }).outputVersions;
}

function reviewerStep(f: Awaited<ReturnType<typeof fixture>>, iteration: number): StoredStep {
  const graph = f.store.getGraph(f.graph.run.id)!;
  const step = graph.steps.find((candidate) => {
    const context = f.store.getReviewStepContext(f.graph.run.id, candidate.id);
    return context?.kind === 'reviewer' && context.iteration === iteration;
  });
  if (!step) throw new Error(`Reviewer iteration ${iteration} not found`);
  return step;
}

function rejectInitialReview(f: Awaited<ReturnType<typeof fixture>>): {
  version: ArtifactVersion;
  evidenceId: string;
  reworkStep: StoredStep;
} {
  const version = completeTarget(f);
  const reviewer = claim(
    f.store,
    f.graph.run.id,
    reviewerStep(f, 0).id,
    'owner-reviewer-corruption',
    '2026-07-14T00:00:05.000Z',
  );
  const rejected = f.store.completeReviewStep({
    runId: f.graph.run.id,
    stepId: reviewer.id,
    idempotencyKey: reviewer.idempotencyKey!,
    ownerId: 'owner-reviewer-corruption',
    executionAttempt: reviewer.executionAttempt,
    reviewerAgentVersionId: reviewerAgent,
    outcome: reviewOutcome('reject', version),
    now: '2026-07-14T00:00:06.000Z',
  });
  const reworkStep = rejected.graph.steps.find(
    (step) => f.store.getReviewStepContext(f.graph.run.id, step.id)?.kind === 'rework',
  );
  if (!reworkStep) throw new Error('Rework Step missing');
  return { version, evidenceId: rejected.evidence.id, reworkStep };
}

describe('SqliteOrchestrationStore reviewer/rework', () => {
  it('pauses before claiming a multi-candidate image Reviewer until one assigned version is selected', async () => {
    const f = await fixture();
    try {
      const versions = completeImageCandidates(f, 2);
      const step = reviewerStep(f, 0);

      const prepared = f.store.prepareReviewStepForExecution(
        f.graph.run.id,
        step.id,
        '2026-07-14T00:00:05.000Z',
      );

      expect(prepared).toMatchObject({
        status: 'image-selection-required',
        artifactIds: [versions[0]!.artifactId],
      });
      expect(prepared.graph.run.state).toBe('paused');
      expect(prepared.graph.steps.find((candidate) => candidate.id === step.id)?.state).toBe(
        'ready',
      );
      const context = f.store.getReviewStepContext(f.graph.run.id, step.id);
      expect(context?.kind).toBe('reviewer');
      if (context?.kind !== 'reviewer') throw new Error('Reviewer context missing');
      expect(context.reviewedArtifactVersions.map((version) => version.id)).toHaveLength(2);
      expect(context.reviewedArtifactVersions.map((version) => version.id)).toEqual(
        expect.arrayContaining(versions.map((version) => version.id)),
      );
      expect(
        f.raw
          .prepare(
            "SELECT COUNT(*) AS count FROM event WHERE type = 'review.image-selection-required'",
          )
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      f.raw.close();
    }
  });

  it('freezes the durable selected image version and ignores later selection changes for that Reviewer', async () => {
    const f = await fixture();
    try {
      const versions = completeImageCandidates(f, 2);
      const step = reviewerStep(f, 0);
      const artifacts = new SqliteArtifactStore(f.raw);
      artifacts.selectVersion({
        operationId: 'select-review-image-1',
        artifactId: versions[0]!.artifactId,
        versionId: versions[0]!.id,
        expectedTaskVersion: 0,
        resultingTaskVersion: 1,
        now: '2026-07-14T00:00:05.000Z',
      });

      const prepared = f.store.prepareReviewStepForExecution(
        f.graph.run.id,
        step.id,
        '2026-07-14T00:00:06.000Z',
      );
      expect(prepared.status).toBe('ready');
      expect(f.store.getReviewStepContext(f.graph.run.id, step.id)).toMatchObject({
        kind: 'reviewer',
        reviewedArtifactVersions: [{ id: versions[0]!.id }],
      });
      expect(() =>
        f.raw
          .prepare(
            `UPDATE review_step_artifact_selection SET selected_version_id = ?
             WHERE run_id = ? AND reviewer_step_id = ?`,
          )
          .run(versions[1]!.id, f.graph.run.id, step.id),
      ).toThrow('review.image_selection_immutable');
      expect(() =>
        f.raw
          .prepare(
            `DELETE FROM review_step_artifact_selection
             WHERE run_id = ? AND reviewer_step_id = ?`,
          )
          .run(f.graph.run.id, step.id),
      ).toThrow('review.image_selection_immutable');

      artifacts.selectVersion({
        operationId: 'select-review-image-2',
        artifactId: versions[1]!.artifactId,
        versionId: versions[1]!.id,
        expectedTaskVersion: 1,
        resultingTaskVersion: 2,
        now: '2026-07-14T00:00:07.000Z',
      });
      expect(f.store.getReviewStepContext(f.graph.run.id, step.id)).toMatchObject({
        kind: 'reviewer',
        reviewedArtifactVersions: [{ id: versions[0]!.id }],
      });
      expect(
        f.raw
          .prepare(
            "SELECT COUNT(*) AS count FROM event WHERE type = 'review.image-selection-frozen'",
          )
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      f.raw.close();
    }
  });

  it('lets a single image candidate proceed without an explicit selection', async () => {
    const f = await fixture();
    try {
      const [version] = completeImageCandidates(f, 1);
      const step = reviewerStep(f, 0);
      const prepared = f.store.prepareReviewStepForExecution(
        f.graph.run.id,
        step.id,
        '2026-07-14T00:00:05.000Z',
      );

      expect(prepared.status).toBe('ready');
      expect(prepared.graph.run.state).toBe('reviewing');
      expect(f.store.getReviewStepContext(f.graph.run.id, step.id)).toMatchObject({
        kind: 'reviewer',
        reviewedArtifactVersions: [{ id: version!.id }],
      });
    } finally {
      f.raw.close();
    }
  });
  it('rejects reviewer completion at the persisted lease expiry without evidence or transitions', async () => {
    const f = await fixture();
    try {
      const version = completeTarget(f);
      const reviewer = f.store.claimReadySteps({
        runId: f.graph.run.id,
        stepIds: [reviewerStep(f, 0).id],
        ownerId: 'expired-reviewer-owner',
        leaseExpiresAt: '2026-07-14T00:10:00.000Z',
        now: '2026-07-14T00:00:05.000Z',
      }).claimedSteps[0]!;
      const eventsBefore = f.raw.prepare('SELECT * FROM event ORDER BY rowid ASC').all();
      const checkpointsBefore = f.raw.prepare('SELECT * FROM checkpoint ORDER BY rowid ASC').all();
      const artifactCountBefore = f.raw.prepare('SELECT COUNT(*) AS count FROM artifact').get();
      const versionCountBefore = f.raw
        .prepare('SELECT COUNT(*) AS count FROM artifact_version')
        .get();

      let thrown: unknown;
      try {
        f.store.completeReviewStep({
          runId: f.graph.run.id,
          stepId: reviewer.id,
          idempotencyKey: reviewer.idempotencyKey!,
          ownerId: 'expired-reviewer-owner',
          executionAttempt: reviewer.executionAttempt,
          reviewerAgentVersionId: reviewerAgent,
          outcome: reviewOutcome('accept', version),
          now: '2026-07-14T00:10:00.000Z',
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({
        name: 'StepFenceMismatchError',
        code: 'step.fence_mismatch',
      });
      expect(f.store.getGraph(f.graph.run.id)).toMatchObject({
        run: { state: 'reviewing' },
        steps: expect.arrayContaining([
          expect.objectContaining({
            id: reviewer.id,
            state: 'running',
            leaseExpiresAt: '2026-07-14T00:10:00.000Z',
          }),
        ]),
      });
      expect(f.store.getAcceptanceGate(f.gate.id)).toMatchObject({ state: 'active' });
      expect(f.store.listReviewEvidence(f.gate.id)).toEqual([]);
      expect(f.raw.prepare('SELECT COUNT(*) AS count FROM artifact').get()).toEqual(
        artifactCountBefore,
      );
      expect(f.raw.prepare('SELECT COUNT(*) AS count FROM artifact_version').get()).toEqual(
        versionCountBefore,
      );
      expect(f.raw.prepare('SELECT * FROM event ORDER BY rowid ASC').all()).toEqual(eventsBefore);
      expect(f.raw.prepare('SELECT * FROM checkpoint ORDER BY rowid ASC').all()).toEqual(
        checkpointsBefore,
      );
    } finally {
      f.raw.close();
    }
  });

  it.each([
    {
      name: 'more than 64 criteria',
      code: 'acceptance_criteria.too_many',
      corrupt(raw: BetterSQLite3Raw) {
        const insert = raw.prepare(
          `INSERT INTO acceptance_criterion (gate_id, id, description, plan_order)
           VALUES ('gate-review', ?, ?, ?)`,
        );
        for (let index = 2; index < 65; index += 1) {
          insert.run(`criterion-${index}`, `Criterion ${index}`, index);
        }
      },
    },
    {
      name: 'a criterion above 4000 UTF-8 bytes',
      code: 'acceptance_criteria.item_too_large',
      corrupt(raw: BetterSQLite3Raw) {
        raw
          .prepare(
            `UPDATE acceptance_criterion SET description = ?
             WHERE gate_id = 'gate-review' AND id = 'criterion-one'`,
          )
          .run('\u754c'.repeat(1_334));
      },
    },
    {
      name: 'criteria above 64KiB in total',
      code: 'acceptance_criteria.total_too_large',
      corrupt(raw: BetterSQLite3Raw) {
        const insert = raw.prepare(
          `INSERT INTO acceptance_criterion (gate_id, id, description, plan_order)
           VALUES ('gate-review', ?, ?, ?)`,
        );
        raw
          .prepare(
            `UPDATE acceptance_criterion SET description = ?
             WHERE gate_id = 'gate-review'`,
          )
          .run('x'.repeat(4_000));
        for (let index = 2; index < 17; index += 1) {
          insert.run(`criterion-${index}`, 'x'.repeat(4_000), index);
        }
      },
    },
    {
      name: 'a whitespace-only criterion',
      code: 'acceptance_criteria.empty',
      corrupt(raw: BetterSQLite3Raw) {
        raw.exec('PRAGMA ignore_check_constraints = ON');
        raw
          .prepare(
            `UPDATE acceptance_criterion SET description = '   '
             WHERE gate_id = 'gate-review' AND id = 'criterion-one'`,
          )
          .run();
        raw.exec('PRAGMA ignore_check_constraints = OFF');
      },
    },
    {
      name: 'no criteria',
      code: 'acceptance_criteria.required',
      corrupt(raw: BetterSQLite3Raw) {
        raw.prepare("DELETE FROM acceptance_criterion WHERE gate_id = 'gate-review'").run();
      },
    },
  ] as const)('fails closed when persisted Gate has $name', async ({ code, corrupt }) => {
    const f = await fixture();
    try {
      completeTarget(f);
      const reviewerStepId = reviewerStep(f, 0).id;
      f.raw.exec(`
        DROP TRIGGER acceptance_criterion_update_guard;
        DROP TRIGGER acceptance_criterion_delete_guard;
        DROP TRIGGER IF EXISTS acceptance_criterion_bounds_insert_guard;
        DROP TRIGGER IF EXISTS acceptance_criterion_bounds_update_guard;
      `);
      corrupt(f.raw);

      for (const read of [
        () => f.store.getAcceptanceGate(f.gate.id),
        () => f.store.getReviewStepContext(f.graph.run.id, reviewerStepId),
      ]) {
        expect(read).toThrowError(AcceptanceCriteriaValidationError);
        expect(read).toThrow(code);
      }
    } finally {
      f.raw.close();
    }
  });

  it('rejects Gate maxIterations above the authoritative limit', async () => {
    const f = await fixture();
    try {
      expect(() =>
        f.store.createAcceptanceGate({
          id: f.gate.id,
          runId: f.graph.run.id,
          targetStepId: f.gate.targetStepId,
          reviewerAgentVersionId: reviewerAgent,
          maxIterations: 101,
          onLimitReached: 'pause',
          criteria: f.gate.criteria,
        }),
      ).toThrow('review.max_iterations_invalid');
    } finally {
      f.raw.close();
    }
  });

  it('fails closed when a persisted Gate maxIterations exceeds the authoritative limit', async () => {
    const f = await fixture();
    try {
      completeTarget(f);
      const reviewerStepId = reviewerStep(f, 0).id;
      f.raw.exec(`
        DROP TRIGGER acceptance_gate_identity_guard;
        DROP TRIGGER IF EXISTS acceptance_gate_max_iterations_update_guard;
      `);
      f.raw.prepare('UPDATE acceptance_gate SET max_iterations = 101 WHERE id = ?').run(f.gate.id);

      expect(() => f.store.getAcceptanceGate(f.gate.id)).toThrow('review.max_iterations_invalid');
      expect(() => f.store.getReviewStepContext(f.graph.run.id, reviewerStepId)).toThrow(
        'review.max_iterations_invalid',
      );
    } finally {
      f.raw.close();
    }
  });

  it('rejects a reviewer iteration above Gate max before persisting Evidence', async () => {
    const f = await fixture();
    try {
      const { version: v1, reworkStep } = rejectInitialReview(f);
      const rework = claim(
        f.store,
        f.graph.run.id,
        reworkStep.id,
        'owner-rework-invalid-iteration',
        '2026-07-14T00:00:07.000Z',
      );
      const v2 = f.store.completeStep({
        runId: f.graph.run.id,
        stepId: rework.id,
        idempotencyKey: rework.idempotencyKey!,
        ownerId: 'owner-rework-invalid-iteration',
        executionAttempt: rework.executionAttempt,
        outputVersions: [
          {
            artifactId: v1.artifactId,
            content: 'version two',
            mimeType: v1.mimeType,
            status: 'candidate',
            parentVersionIds: [v1.id],
          },
        ],
        now: '2026-07-14T00:00:08.000Z',
      }).outputVersions[0]!;
      const reviewer = claim(
        f.store,
        f.graph.run.id,
        reviewerStep(f, 1).id,
        'owner-reviewer-invalid-iteration',
        '2026-07-14T00:00:09.000Z',
      );
      f.raw.exec('DROP TRIGGER acceptance_gate_identity_guard');
      f.raw.prepare('UPDATE acceptance_gate SET max_iterations = 0 WHERE id = ?').run(f.gate.id);
      const evidenceBefore = f.store.listReviewEvidence(f.gate.id);

      expect(() =>
        f.store.completeReviewStep({
          runId: f.graph.run.id,
          stepId: reviewer.id,
          idempotencyKey: reviewer.idempotencyKey!,
          ownerId: 'owner-reviewer-invalid-iteration',
          executionAttempt: reviewer.executionAttempt,
          reviewerAgentVersionId: reviewerAgent,
          outcome: reviewOutcome('reject', v2),
          now: '2026-07-14T00:00:10.000Z',
        }),
      ).toThrow('review.iteration_invalid');
      expect(f.store.listReviewEvidence(f.gate.id)).toEqual(evidenceBefore);
      expect(
        f.store.getGraph(f.graph.run.id)?.steps.find((step) => step.id === reviewer.id),
      ).toMatchObject({ state: 'running' });
      expect(f.store.getAcceptanceGate(f.gate.id)).toMatchObject({ state: 'active' });
    } finally {
      f.raw.close();
    }
  });

  it('enforces shared acceptance criteria bounds on direct Gate creation', async () => {
    const f = await fixture();
    try {
      const order = (
        f.raw
          .prepare('SELECT COALESCE(MAX(plan_order), -1) + 1 AS value FROM step WHERE run_id = ?')
          .get(f.graph.run.id) as { value: number }
      ).value;
      f.raw
        .prepare(
          `INSERT INTO step (
             id, run_id, plan_order, title, instructions, agent_version_id,
             model_override_id, state, retries, retry_of_step_id, idempotency_key,
             execution_owner_id, lease_expires_at, execution_attempt, created_at, updated_at
           ) VALUES ('criteria-target', ?, ?, 'Criteria target', '', ?, NULL,
             'pending', 0, NULL, NULL, NULL, NULL, 0, 't0', 't0')`,
        )
        .run(f.graph.run.id, order, targetAgent);
      const create = (criteria: Array<{ id: string; description: string }>) =>
        f.store.createAcceptanceGate({
          id: 'gate-criteria-bounds' as never,
          runId: f.graph.run.id,
          targetStepId: 'criteria-target' as StepId,
          reviewerAgentVersionId: reviewerAgent,
          maxIterations: 1,
          onLimitReached: 'pause',
          criteria,
        });
      expect(() =>
        create(
          Array.from({ length: 65 }, (_, index) => ({
            id: `criterion-${index}`,
            description: `criterion ${index}`,
          })),
        ),
      ).toThrow('acceptance_criteria.too_many');
      expect(() => create([{ id: 'oversized', description: 'x'.repeat(4_001) }])).toThrow(
        'acceptance_criteria.item_too_large',
      );
      expect(() =>
        create(
          Array.from({ length: 17 }, (_, index) => ({
            id: `total-${index}`,
            description: 'x'.repeat(4_000),
          })),
        ),
      ).toThrow('acceptance_criteria.total_too_large');
      expect(() => create([{ id: 'blank', description: '   ' }])).toThrow(
        'acceptance_criteria.empty',
      );
      expect(() => create([])).toThrow('acceptance_criteria.required');

      const valid = create(
        Array.from({ length: 64 }, (_, index) => ({
          id: `valid-${index}`,
          description: `  ${'x'.repeat(1_000)}  `,
        })),
      );
      expect(valid.criteria).toHaveLength(64);
      expect(valid.criteria.every((criterion) => criterion.description.length === 1_000)).toBe(
        true,
      );
    } finally {
      f.raw.close();
    }
  });

  it('fails closed on corrupt source Evidence during context and rework snapshot reads', async () => {
    const f = await fixture();
    try {
      const { reworkStep } = rejectInitialReview(f);
      f.raw.exec(`
        DROP TRIGGER acceptance_gate_step_update_guard;
        DROP TRIGGER IF EXISTS acceptance_gate_step_source_evidence_update_guard;
      `);
      f.raw
        .prepare(
          `UPDATE acceptance_gate_step SET iteration = 2
           WHERE run_id = ? AND step_id = ?`,
        )
        .run(f.graph.run.id, reworkStep.id);

      expect(() => f.store.getReviewStepContext(f.graph.run.id, reworkStep.id)).toThrow(
        'review.source_evidence_mismatch',
      );
      expect(() =>
        f.store.claimReadySteps({
          runId: f.graph.run.id,
          stepIds: [reworkStep.id],
          ownerId: 'owner-corrupt-snapshot',
          leaseExpiresAt: '9999-12-31T23:59:59.999Z',
          now: '2026-07-14T00:00:07.000Z',
        }),
      ).toThrow('review.source_evidence_mismatch');
      expect(f.store.listRunArtifactVersions(f.graph.run.id)).toHaveLength(1);
    } finally {
      f.raw.close();
    }
  });

  it('fails closed on corrupt source Evidence before persisting rework output lineage', async () => {
    const f = await fixture();
    try {
      const { version, reworkStep } = rejectInitialReview(f);
      const running = claim(
        f.store,
        f.graph.run.id,
        reworkStep.id,
        'owner-corrupt-output',
        '2026-07-14T00:00:07.000Z',
      );
      f.raw.exec(`
        DROP TRIGGER acceptance_gate_step_update_guard;
        DROP TRIGGER IF EXISTS acceptance_gate_step_source_evidence_update_guard;
      `);
      f.raw
        .prepare(
          `UPDATE acceptance_gate_step SET iteration = 2
           WHERE run_id = ? AND step_id = ?`,
        )
        .run(f.graph.run.id, running.id);

      expect(() =>
        f.store.completeStep({
          runId: f.graph.run.id,
          stepId: running.id,
          idempotencyKey: running.idempotencyKey!,
          ownerId: 'owner-corrupt-output',
          executionAttempt: running.executionAttempt,
          outputVersions: [
            {
              artifactId: version.artifactId,
              content: 'must not persist',
              mimeType: version.mimeType,
              status: 'candidate',
              parentVersionIds: [version.id],
            },
          ],
          now: '2026-07-14T00:00:08.000Z',
        }),
      ).toThrow('review.source_evidence_mismatch');
      expect(f.store.listRunArtifactVersions(f.graph.run.id)).toHaveLength(1);
    } finally {
      f.raw.close();
    }
  });

  it('rejects cross-Gate inserts, cross-Run sources, and incorrect source iterations in SQLite', async () => {
    const f = await fixture();
    try {
      const gateARejected = rejectInitialReview(f);
      const insertStep = (id: string, runId: string, agentVersionId: AgentVersionId): void => {
        const order = (
          f.raw
            .prepare('SELECT COALESCE(MAX(plan_order), -1) + 1 AS value FROM step WHERE run_id = ?')
            .get(runId) as { value: number }
        ).value;
        f.raw
          .prepare(
            `INSERT INTO step (
               id, run_id, plan_order, title, instructions, agent_version_id,
               model_override_id, state, retries, retry_of_step_id, idempotency_key,
               execution_owner_id, lease_expires_at, execution_attempt, created_at, updated_at
             ) VALUES (?, ?, ?, ?, '', ?, NULL, 'pending', 0, NULL, NULL, NULL, NULL, 0, 't0', 't0')`,
          )
          .run(id, runId, order, id, agentVersionId);
      };
      const completeAndReject = (
        store: SqliteOrchestrationStore,
        runId: import('@sync-think/shared').RunId,
        targetStepId: StepId,
        gateId: string,
        ownerSuffix: string,
      ): string => {
        const target = claim(
          store,
          runId,
          targetStepId,
          `owner-target-${ownerSuffix}`,
          '2026-07-14T00:10:00.000Z',
        );
        const version = store.completeStep({
          runId,
          stepId: target.id,
          idempotencyKey: target.idempotencyKey!,
          ownerId: `owner-target-${ownerSuffix}`,
          executionAttempt: target.executionAttempt,
          outputVersions: [
            {
              artifactName: `${ownerSuffix}.txt`,
              content: ownerSuffix,
              mimeType: 'text/plain',
              status: 'candidate',
            },
          ],
          now: '2026-07-14T00:10:01.000Z',
        }).outputVersions[0]!;
        const reviewer = store
          .getGraph(runId)!
          .steps.find((step) => store.getReviewStepContext(runId, step.id)?.gateId === gateId)!;
        const running = claim(
          store,
          runId,
          reviewer.id,
          `owner-reviewer-${ownerSuffix}`,
          '2026-07-14T00:10:02.000Z',
        );
        return store.completeReviewStep({
          runId,
          stepId: running.id,
          idempotencyKey: running.idempotencyKey!,
          ownerId: `owner-reviewer-${ownerSuffix}`,
          executionAttempt: running.executionAttempt,
          reviewerAgentVersionId: reviewerAgent,
          outcome: reviewOutcome('reject', version),
          now: '2026-07-14T00:10:03.000Z',
        }).evidence.id;
      };

      insertStep('target-step-b', f.graph.run.id, targetAgent);
      const gateB = f.store.createAcceptanceGate({
        id: 'gate-review-b' as never,
        runId: f.graph.run.id,
        targetStepId: 'target-step-b' as StepId,
        reviewerAgentVersionId: reviewerAgent,
        maxIterations: 1,
        onLimitReached: 'pause',
        criteria: [
          { id: 'criterion-one', description: 'First criterion' },
          { id: 'criterion-two', description: 'Second criterion' },
        ],
      });
      const gateBEvidence = completeAndReject(
        f.store,
        f.graph.run.id,
        'target-step-b' as StepId,
        gateB.id,
        'gate-b',
      );

      const runCDraft = f.store.createPlanDraft({
        taskId,
        title: 'Cross-run source evidence',
        steps: [
          {
            id: 'target-step-c' as StepId,
            title: 'Target C',
            instructions: 'Produce C',
            agentVersionId: targetAgent,
            dependsOn: [],
          },
        ],
      });
      const runC = f.store.approvePlan({ planId: runCDraft.planId, revision: 1 });
      const gateC = f.store.createAcceptanceGate({
        id: 'gate-review-c' as never,
        runId: runC.run.id,
        targetStepId: 'target-step-c' as StepId,
        reviewerAgentVersionId: reviewerAgent,
        maxIterations: 1,
        onLimitReached: 'pause',
        criteria: [
          { id: 'criterion-one', description: 'First criterion' },
          { id: 'criterion-two', description: 'Second criterion' },
        ],
      });
      const gateCEvidence = completeAndReject(
        f.store,
        runC.run.id,
        'target-step-c' as StepId,
        gateC.id,
        'gate-c',
      );

      insertStep('cross-gate-reviewer', f.graph.run.id, reviewerAgent);
      f.raw.exec('SAVEPOINT cross_gate_insert');
      try {
        expect(() =>
          f.raw
            .prepare(
              `INSERT INTO acceptance_gate_step (
                 gate_id, run_id, step_id, role, iteration, derivation, source_evidence_id
               ) VALUES (?, ?, 'cross-gate-reviewer', 'reviewer', 1, 'rework', ?)`,
            )
            .run(f.gate.id, f.graph.run.id, gateBEvidence),
        ).toThrow('review.source_evidence_mismatch');
      } finally {
        f.raw.exec('ROLLBACK TO cross_gate_insert; RELEASE cross_gate_insert');
      }

      f.raw.exec('DROP TRIGGER acceptance_gate_step_update_guard');
      const expectUpdateRejected = (sql: string, ...values: unknown[]): void => {
        f.raw.exec('SAVEPOINT invalid_source_update');
        try {
          expect(() => f.raw.prepare(sql).run(...values)).toThrow(
            'review.source_evidence_mismatch',
          );
        } finally {
          f.raw.exec('ROLLBACK TO invalid_source_update; RELEASE invalid_source_update');
        }
      };
      expectUpdateRejected(
        `UPDATE acceptance_gate_step SET source_evidence_id = ?
         WHERE run_id = ? AND step_id = ?`,
        gateCEvidence,
        f.graph.run.id,
        gateARejected.reworkStep.id,
      );
      expectUpdateRejected(
        `UPDATE acceptance_gate_step SET iteration = 2
         WHERE run_id = ? AND step_id = ?`,
        f.graph.run.id,
        gateARejected.reworkStep.id,
      );
    } finally {
      f.raw.close();
    }
  });

  it('resumes ordinary DAG work when an active Gate target is still pending', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-review-pending-target-'));
    dirs.push(dir);
    const path = join(dir, 'sync-think.db');
    await runMigrations(path);
    const connection = await openDatabaseAsync({ path });
    try {
      seed(connection.raw);
      const store = new SqliteOrchestrationStore(connection.raw);
      const draft = store.createPlanDraft({
        taskId,
        title: 'Pending gated target',
        steps: [
          {
            id: 'prerequisite-step' as StepId,
            title: 'Prerequisite',
            instructions: 'Prepare the gated target input',
            agentVersionId: targetAgent,
            dependsOn: [],
          },
          {
            id: 'pending-target-step' as StepId,
            title: 'Pending target',
            instructions: 'Produce the gated output',
            agentVersionId: targetAgent,
            dependsOn: ['prerequisite-step' as StepId],
          },
        ],
        now: '2026-07-14T00:20:00.000Z',
      });
      const graph = store.approvePlan({
        planId: draft.planId,
        revision: 1,
        now: '2026-07-14T00:20:01.000Z',
      });
      const gate = store.createAcceptanceGate({
        id: 'gate-pending-target' as never,
        runId: graph.run.id,
        targetStepId: 'pending-target-step' as StepId,
        reviewerAgentVersionId: reviewerAgent,
        maxIterations: 1,
        onLimitReached: 'pause',
        criteria: [{ id: 'criterion-pending', description: 'Review the pending target' }],
        now: '2026-07-14T00:20:02.000Z',
      });
      expect(store.getGraph(graph.run.id)).toMatchObject({
        steps: [
          { id: 'prerequisite-step', state: 'pending' },
          { id: 'pending-target-step', state: 'pending' },
        ],
      });

      expect(store.pauseRun(graph.run.id, '2026-07-14T00:20:03.000Z').run.state).toBe('paused');
      const resumed = store.resumeRun(graph.run.id, '2026-07-14T00:20:04.000Z');
      expect(resumed.run.state).toBe('queued');
      expect(
        connection.raw
          .prepare(
            "SELECT type FROM event WHERE run_id = ? AND category = 'run' ORDER BY sequence DESC LIMIT 1",
          )
          .get(graph.run.id),
      ).toEqual({ type: 'run.queued' });
      const runEventCount = connection.raw
        .prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND category = 'run'")
        .get(graph.run.id);
      expect(store.resumeRun(graph.run.id, '2026-07-14T00:20:05.000Z').run.state).toBe('queued');
      expect(
        connection.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND category = 'run'")
          .get(graph.run.id),
      ).toEqual(runEventCount);

      const prerequisite = claim(
        store,
        graph.run.id,
        'prerequisite-step' as StepId,
        'owner-prerequisite',
        '2026-07-14T00:20:06.000Z',
      );
      store.completeStep({
        runId: graph.run.id,
        stepId: prerequisite.id,
        idempotencyKey: prerequisite.idempotencyKey!,
        ownerId: 'owner-prerequisite',
        executionAttempt: prerequisite.executionAttempt,
        now: '2026-07-14T00:20:07.000Z',
      });
      const target = claim(
        store,
        graph.run.id,
        'pending-target-step' as StepId,
        'owner-pending-target',
        '2026-07-14T00:20:08.000Z',
      );
      const completed = store.completeStep({
        runId: graph.run.id,
        stepId: target.id,
        idempotencyKey: target.idempotencyKey!,
        ownerId: 'owner-pending-target',
        executionAttempt: target.executionAttempt,
        outputVersions: [
          {
            artifactName: 'pending-target.txt',
            content: 'gated output',
            mimeType: 'text/plain',
            status: 'candidate',
          },
        ],
        now: '2026-07-14T00:20:09.000Z',
      });
      expect(completed.graph.run.state).toBe('reviewing');
      const reviewer = completed.graph.steps.find(
        (step) => store.getReviewStepContext(graph.run.id, step.id)?.gateId === gate.id,
      )!;
      connection.raw
        .prepare("UPDATE step SET state = 'failed' WHERE run_id = ? AND id = ?")
        .run(graph.run.id, reviewer.id);
      expect(store.pauseRun(graph.run.id, '2026-07-14T00:20:10.000Z').run.state).toBe('paused');
      expect(store.resumeRun(graph.run.id, '2026-07-14T00:20:11.000Z').run.state).toBe('paused');
    } finally {
      connection.raw.close();
    }
  });

  it('keeps resume paused when any unresolved Gate is limit-reached regardless of ordering', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-review-limit-ordering-'));
    dirs.push(dir);
    const path = join(dir, 'sync-think.db');
    await runMigrations(path);
    const connection = await openDatabaseAsync({ path });
    try {
      seed(connection.raw);
      const store = new SqliteOrchestrationStore(connection.raw);
      const draft = store.createPlanDraft({
        taskId,
        title: 'Ordered unresolved Gates',
        steps: [
          {
            id: 'earlier-active-target' as StepId,
            title: 'Earlier active target',
            instructions: 'Produce the earlier target',
            agentVersionId: targetAgent,
            dependsOn: [],
          },
          {
            id: 'later-limit-target' as StepId,
            title: 'Later limit target',
            instructions: 'Produce the later target',
            agentVersionId: targetAgent,
            dependsOn: [],
          },
        ],
        now: '2026-07-14T00:30:00.000Z',
      });
      const graph = store.approvePlan({
        planId: draft.planId,
        revision: 1,
        now: '2026-07-14T00:30:01.000Z',
      });
      const earlierGate = store.createAcceptanceGate({
        id: 'gate-earlier-active' as never,
        runId: graph.run.id,
        targetStepId: 'earlier-active-target' as StepId,
        reviewerAgentVersionId: reviewerAgent,
        maxIterations: 1,
        onLimitReached: 'pause',
        criteria: [
          { id: 'criterion-one', description: 'First criterion' },
          { id: 'criterion-two', description: 'Second criterion' },
        ],
        now: '2026-07-14T00:30:02.000Z',
      });
      const laterGate = store.createAcceptanceGate({
        id: 'gate-later-limit' as never,
        runId: graph.run.id,
        targetStepId: 'later-limit-target' as StepId,
        reviewerAgentVersionId: reviewerAgent,
        maxIterations: 0,
        onLimitReached: 'pause',
        criteria: [
          { id: 'criterion-one', description: 'First criterion' },
          { id: 'criterion-two', description: 'Second criterion' },
        ],
        now: '2026-07-14T00:30:03.000Z',
      });
      const complete = (stepId: StepId, ownerId: string, content: string) => {
        const running = claim(store, graph.run.id, stepId, ownerId, '2026-07-14T00:30:04.000Z');
        return store.completeStep({
          runId: graph.run.id,
          stepId,
          idempotencyKey: running.idempotencyKey!,
          ownerId,
          executionAttempt: running.executionAttempt,
          outputVersions: [
            {
              artifactName: `${stepId}.txt`,
              content,
              mimeType: 'text/plain',
              status: 'candidate',
            },
          ],
          now: '2026-07-14T00:30:05.000Z',
        }).outputVersions[0]!;
      };
      complete('earlier-active-target' as StepId, 'owner-earlier-target', 'earlier output');
      const laterVersion = complete(
        'later-limit-target' as StepId,
        'owner-later-target',
        'later output',
      );
      const laterReviewer = store
        .getGraph(graph.run.id)!
        .steps.find(
          (step) => store.getReviewStepContext(graph.run.id, step.id)?.gateId === laterGate.id,
        )!;
      const running = claim(
        store,
        graph.run.id,
        laterReviewer.id,
        'owner-later-limit',
        '2026-07-14T00:30:06.000Z',
      );
      expect(
        store.completeReviewStep({
          runId: graph.run.id,
          stepId: running.id,
          idempotencyKey: running.idempotencyKey!,
          ownerId: 'owner-later-limit',
          executionAttempt: running.executionAttempt,
          reviewerAgentVersionId: reviewerAgent,
          outcome: reviewOutcome('reject', laterVersion),
          now: '2026-07-14T00:30:07.000Z',
        }).graph.run.state,
      ).toBe('paused');
      expect(store.getAcceptanceGate(earlierGate.id)).toMatchObject({ state: 'active' });
      expect(store.getAcceptanceGate(laterGate.id)).toMatchObject({ state: 'limit-reached' });

      const runEventCount = connection.raw
        .prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND category = 'run'")
        .get(graph.run.id);
      expect(store.resumeRun(graph.run.id, '2026-07-14T00:30:08.000Z').run.state).toBe('paused');
      expect(store.resumeRun(graph.run.id, '2026-07-14T00:30:09.000Z').run.state).toBe('paused');
      expect(
        connection.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND category = 'run'")
          .get(graph.run.id),
      ).toEqual(runEventCount);
    } finally {
      connection.raw.close();
    }
  });

  it('rejects Gate creation for a terminal Run or an already-terminal target Step', async () => {
    const f = await fixture();
    try {
      const createRun = (title: string, stepIds: readonly StepId[]) => {
        const draft = f.store.createPlanDraft({
          taskId,
          title,
          steps: stepIds.map((id) => ({
            id,
            title: id,
            instructions: `Execute ${id}`,
            agentVersionId: targetAgent,
            dependsOn: [],
          })),
          now: '2026-07-14T00:10:00.000Z',
        });
        return f.store.approvePlan({
          planId: draft.planId,
          revision: 1,
          now: '2026-07-14T00:10:01.000Z',
        });
      };
      const createLateGate = (
        id: string,
        runId: import('@sync-think/shared').RunId,
        targetStepId: StepId,
      ) =>
        f.store.createAcceptanceGate({
          id: id as never,
          runId,
          targetStepId,
          reviewerAgentVersionId: reviewerAgent,
          maxIterations: 1,
          onLimitReached: 'pause',
          criteria: [{ id: 'criterion-late', description: 'Must not be persisted' }],
          now: '2026-07-14T00:10:05.000Z',
        });

      const cancelled = createRun('Cancelled before Gate', ['cancelled-target' as StepId]);
      f.store.cancelRun(cancelled.run.id, '2026-07-14T00:10:02.000Z');
      expect(() =>
        createLateGate('gate-terminal-run', cancelled.run.id, 'cancelled-target' as StepId),
      ).toThrow('review.gate_run_terminal');

      const late = createRun('Completed target before Gate', [
        'completed-target' as StepId,
        'unfinished-sibling' as StepId,
      ]);
      const target = claim(
        f.store,
        late.run.id,
        'completed-target' as StepId,
        'owner-late-target',
        '2026-07-14T00:10:02.000Z',
      );
      f.store.completeStep({
        runId: late.run.id,
        stepId: target.id,
        idempotencyKey: target.idempotencyKey!,
        ownerId: 'owner-late-target',
        executionAttempt: target.executionAttempt,
        outputVersions: [
          {
            artifactName: 'late.txt',
            content: 'completed before Gate',
            mimeType: 'text/plain',
            status: 'candidate',
          },
        ],
        now: '2026-07-14T00:10:03.000Z',
      });
      expect(f.store.getRun(late.run.id)).toMatchObject({ state: 'running' });
      expect(() =>
        createLateGate('gate-terminal-target', late.run.id, 'completed-target' as StepId),
      ).toThrow('review.gate_target_terminal');
      expect(
        f.raw
          .prepare(
            `SELECT COUNT(*) AS count FROM acceptance_gate
           WHERE id IN ('gate-terminal-run', 'gate-terminal-target')`,
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      f.raw.close();
    }
  });

  it('rejects a Gate whose exact backup is the primary reviewer', async () => {
    const f = await fixture();
    try {
      const draft = f.store.createPlanDraft({
        taskId,
        title: 'Invalid identical backup',
        steps: [
          {
            id: 'identical-backup-target' as StepId,
            title: 'Identical backup target',
            instructions: 'Produce output',
            agentVersionId: targetAgent,
            dependsOn: [],
          },
        ],
        now: '2026-07-14T00:11:00.000Z',
      });
      const graph = f.store.approvePlan({
        planId: draft.planId,
        revision: 1,
        now: '2026-07-14T00:11:01.000Z',
      });
      expect(() =>
        f.store.createAcceptanceGate({
          id: 'gate-identical-backup' as never,
          runId: graph.run.id,
          targetStepId: 'identical-backup-target' as StepId,
          reviewerAgentVersionId: reviewerAgent,
          backupAgentVersionId: reviewerAgent,
          maxIterations: 0,
          onLimitReached: 'reassign',
          criteria: [{ id: 'criterion-identical', description: 'Must reject identical backup' }],
        }),
      ).toThrow('review.backup_reviewer_same_as_primary');
      expect(
        f.raw
          .prepare('SELECT COUNT(*) AS count FROM acceptance_gate WHERE run_id = ?')
          .get(graph.run.id),
      ).toEqual({ count: 0 });
    } finally {
      f.raw.close();
    }
  });

  it.each(['target', 'rework', 'reviewer-reject', 'reviewer-accept'] as const)(
    'keeps a user pause stable across a late %s transition until explicit resume',
    async (lateTransition) => {
      const f = await fixture();
      try {
        if (lateTransition === 'target') {
          const target = claim(
            f.store,
            f.graph.run.id,
            'target-step' as StepId,
            'owner-paused-target',
            '2026-07-14T00:00:03.000Z',
          );
          f.store.pauseRun(f.graph.run.id, '2026-07-14T00:00:04.000Z');
          const completed = f.store.completeStep({
            runId: f.graph.run.id,
            stepId: target.id,
            idempotencyKey: target.idempotencyKey!,
            ownerId: 'owner-paused-target',
            executionAttempt: target.executionAttempt,
            outputVersions: [
              {
                artifactName: 'paused-target.txt',
                content: 'paused target output',
                mimeType: 'text/plain',
                status: 'candidate',
              },
            ],
            now: '2026-07-14T00:00:05.000Z',
          });
          expect(completed.graph.run.state).toBe('paused');
          expect(f.store.resumeRun(f.graph.run.id).run.state).toBe('reviewing');
          expect(
            f.raw
              .prepare(
                "SELECT type FROM event WHERE run_id = ? AND category = 'run' ORDER BY sequence DESC LIMIT 1",
              )
              .get(f.graph.run.id),
          ).toEqual({ type: 'run.reviewing' });
          return;
        }

        const v1 = completeTarget(f);
        const reviewer0 = claim(
          f.store,
          f.graph.run.id,
          reviewerStep(f, 0).id,
          `owner-${lateTransition}-reviewer`,
          '2026-07-14T00:00:05.000Z',
        );
        if (lateTransition === 'reviewer-accept' || lateTransition === 'reviewer-reject') {
          f.store.pauseRun(f.graph.run.id, '2026-07-14T00:00:06.000Z');
          const reviewed = f.store.completeReviewStep({
            runId: f.graph.run.id,
            stepId: reviewer0.id,
            idempotencyKey: reviewer0.idempotencyKey!,
            ownerId: `owner-${lateTransition}-reviewer`,
            executionAttempt: reviewer0.executionAttempt,
            reviewerAgentVersionId: reviewerAgent,
            outcome: reviewOutcome(lateTransition === 'reviewer-accept' ? 'accept' : 'reject', v1),
            now: '2026-07-14T00:00:07.000Z',
          });
          expect(reviewed.graph.run.state).toBe('paused');
          const expectedState = lateTransition === 'reviewer-accept' ? 'completed' : 'revising';
          expect(f.store.resumeRun(f.graph.run.id).run.state).toBe(expectedState);
          expect(
            f.raw
              .prepare(
                "SELECT type FROM event WHERE run_id = ? AND category = 'run' ORDER BY sequence DESC LIMIT 1",
              )
              .get(f.graph.run.id),
          ).toEqual({ type: `run.${expectedState}` });
          return;
        }

        const rejected = f.store.completeReviewStep({
          runId: f.graph.run.id,
          stepId: reviewer0.id,
          idempotencyKey: reviewer0.idempotencyKey!,
          ownerId: 'owner-rework-reviewer',
          executionAttempt: reviewer0.executionAttempt,
          reviewerAgentVersionId: reviewerAgent,
          outcome: reviewOutcome('reject', v1),
          now: '2026-07-14T00:00:06.000Z',
        });
        const reworkStep = rejected.graph.steps.find(
          (step) => f.store.getReviewStepContext(f.graph.run.id, step.id)?.kind === 'rework',
        )!;
        const rework = claim(
          f.store,
          f.graph.run.id,
          reworkStep.id,
          'owner-paused-rework',
          '2026-07-14T00:00:07.000Z',
        );
        f.store.pauseRun(f.graph.run.id, '2026-07-14T00:00:08.000Z');
        const completed = f.store.completeStep({
          runId: f.graph.run.id,
          stepId: rework.id,
          idempotencyKey: rework.idempotencyKey!,
          ownerId: 'owner-paused-rework',
          executionAttempt: rework.executionAttempt,
          outputVersions: [
            {
              artifactId: v1.artifactId,
              content: 'paused rework output',
              mimeType: 'text/plain',
              status: 'candidate',
              parentVersionIds: [v1.id],
            },
          ],
          now: '2026-07-14T00:00:09.000Z',
        });
        expect(completed.graph.run.state).toBe('paused');
        expect(f.store.resumeRun(f.graph.run.id).run.state).toBe('reviewing');
        expect(
          f.raw
            .prepare(
              "SELECT type FROM event WHERE run_id = ? AND category = 'run' ORDER BY sequence DESC LIMIT 1",
            )
            .get(f.graph.run.id),
        ).toEqual({ type: 'run.reviewing' });
      } finally {
        f.raw.close();
      }
    },
  );

  it('does not let one accepted Gate complete a Run while another Gate is unresolved and paused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-review-multi-gate-'));
    dirs.push(dir);
    const path = join(dir, 'sync-think.db');
    await runMigrations(path);
    const connection = await openDatabaseAsync({ path });
    try {
      seed(connection.raw);
      const store = new SqliteOrchestrationStore(connection.raw);
      const draft = store.createPlanDraft({
        taskId,
        title: 'Two gated targets',
        steps: [
          {
            id: 'target-a' as StepId,
            title: 'Target A',
            instructions: 'Produce A',
            agentVersionId: targetAgent,
            dependsOn: [],
          },
          {
            id: 'target-b' as StepId,
            title: 'Target B',
            instructions: 'Produce B',
            agentVersionId: targetAgent,
            dependsOn: [],
          },
        ],
        now: '2026-07-14T00:00:00.000Z',
      });
      const graph = store.approvePlan({
        planId: draft.planId,
        revision: 1,
        now: '2026-07-14T00:00:01.000Z',
      });
      const createGate = (id: string, targetStepId: StepId, maxIterations: number) =>
        store.createAcceptanceGate({
          id: id as never,
          runId: graph.run.id,
          targetStepId,
          reviewerAgentVersionId: reviewerAgent,
          maxIterations,
          onLimitReached: 'pause',
          criteria: [
            { id: 'criterion-one', description: 'First criterion' },
            { id: 'criterion-two', description: 'Second criterion' },
          ],
          now: '2026-07-14T00:00:02.000Z',
        });
      const gateA = createGate('gate-a', 'target-a' as StepId, 0);
      const gateB = createGate('gate-b', 'target-b' as StepId, 1);
      const complete = (stepId: StepId, ownerId: string, content: string) => {
        const running = claim(store, graph.run.id, stepId, ownerId, '2026-07-14T00:00:03.000Z');
        return store.completeStep({
          runId: graph.run.id,
          stepId,
          idempotencyKey: running.idempotencyKey!,
          ownerId,
          executionAttempt: running.executionAttempt,
          outputVersions: [
            {
              artifactName: `${stepId}.txt`,
              content,
              mimeType: 'text/plain',
              status: 'candidate',
            },
          ],
          now: '2026-07-14T00:00:04.000Z',
        }).outputVersions[0]!;
      };
      const versionA = complete('target-a' as StepId, 'owner-target-a', 'version A');
      const versionB = complete('target-b' as StepId, 'owner-target-b', 'version B');
      const findReviewer = (gateId: string) =>
        store
          .getGraph(graph.run.id)!
          .steps.find(
            (step) => store.getReviewStepContext(graph.run.id, step.id)?.gateId === gateId,
          )!;
      const reviewerA = claim(
        store,
        graph.run.id,
        findReviewer(gateA.id).id,
        'owner-reviewer-a',
        '2026-07-14T00:00:05.000Z',
      );
      const reviewerB = claim(
        store,
        graph.run.id,
        findReviewer(gateB.id).id,
        'owner-reviewer-b',
        '2026-07-14T00:00:05.000Z',
      );
      expect(
        store.completeReviewStep({
          runId: graph.run.id,
          stepId: reviewerA.id,
          idempotencyKey: reviewerA.idempotencyKey!,
          ownerId: 'owner-reviewer-a',
          executionAttempt: reviewerA.executionAttempt,
          reviewerAgentVersionId: reviewerAgent,
          outcome: reviewOutcome('reject', versionA),
          now: '2026-07-14T00:00:06.000Z',
        }).graph.run.state,
      ).toBe('paused');

      const acceptedB = store.completeReviewStep({
        runId: graph.run.id,
        stepId: reviewerB.id,
        idempotencyKey: reviewerB.idempotencyKey!,
        ownerId: 'owner-reviewer-b',
        executionAttempt: reviewerB.executionAttempt,
        reviewerAgentVersionId: reviewerAgent,
        outcome: reviewOutcome('accept', versionB),
        now: '2026-07-14T00:00:07.000Z',
      });
      expect(acceptedB.graph.run.state).toBe('paused');
      expect(store.getAcceptanceGate(gateA.id)).toMatchObject({ state: 'limit-reached' });
      expect(store.getAcceptanceGate(gateB.id)).toMatchObject({ state: 'accepted' });
      expect(
        connection.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'run.completed'")
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      connection.raw.close();
    }
  });

  it('rejects a gated target output that is not review-visible before persisting anything', async () => {
    const f = await fixture();
    try {
      const target = claim(
        f.store,
        f.graph.run.id,
        'target-step' as StepId,
        'owner-target-invisible',
        '2026-07-14T00:00:03.000Z',
      );
      const checkpointBefore = (
        f.raw
          .prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?')
          .get(f.graph.run.id) as { count: number }
      ).count;
      expect(() =>
        f.store.completeStep({
          runId: f.graph.run.id,
          stepId: target.id,
          idempotencyKey: target.idempotencyKey!,
          ownerId: 'owner-target-invisible',
          executionAttempt: target.executionAttempt,
          outputVersions: [
            {
              artifactName: 'invisible.txt',
              content: 'must not be reviewed',
              mimeType: 'text/plain',
              status: 'rejected',
            },
          ],
          now: '2026-07-14T00:00:04.000Z',
        }),
      ).toThrow('review.target_output_status_invalid');
      expect(f.store.getGraph(f.graph.run.id)).toMatchObject({
        run: { state: 'running' },
        steps: [{ id: 'target-step', state: 'running' }],
      });
      expect(f.raw.prepare('SELECT COUNT(*) AS count FROM artifact').get()).toEqual({ count: 0 });
      expect(
        f.raw
          .prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?')
          .get(f.graph.run.id),
      ).toEqual({ count: checkpointBefore });
    } finally {
      f.raw.close();
    }
  });

  it('holds Run completion and derives one ordinary reviewer with exact artifacts', async () => {
    const f = await fixture();
    try {
      const v1 = completeTarget(f);
      const graph = f.store.getGraph(f.graph.run.id)!;
      expect(graph.run.state).toBe('reviewing');
      expect(graph.steps).toHaveLength(2);
      expect(graph.steps[0]).toMatchObject({ id: 'target-step', state: 'completed' });
      const reviewer = reviewerStep(f, 0);
      expect(reviewer).toMatchObject({ state: 'ready', agentVersionId: reviewerAgent });
      expect(f.store.getReviewStepContext(f.graph.run.id, reviewer.id)).toMatchObject({
        kind: 'reviewer',
        gateId: f.gate.id,
        targetStepId: 'target-step',
        iteration: 0,
        criteria: [{ id: 'criterion-one' }, { id: 'criterion-two' }],
        reviewedArtifactVersions: [{ id: v1.id }],
      });
      expect(
        f.raw.prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'run.completed'").get(),
      ).toEqual({ count: 0 });
    } finally {
      f.raw.close();
    }
  });

  it('records immutable reject evidence once and derives exactly one rework Step', async () => {
    const f = await fixture();
    try {
      const v1 = completeTarget(f);
      const reviewer = reviewerStep(f, 0);
      const running = claim(
        f.store,
        f.graph.run.id,
        reviewer.id,
        'owner-reviewer',
        '2026-07-14T00:00:05.000Z',
      );
      const input = {
        runId: f.graph.run.id,
        stepId: running.id,
        idempotencyKey: running.idempotencyKey!,
        ownerId: 'owner-reviewer',
        executionAttempt: running.executionAttempt,
        reviewerAgentVersionId: reviewerAgent,
        outcome: reviewOutcome('reject', v1),
        now: '2026-07-14T00:00:06.000Z',
      };
      const rejected = f.store.completeReviewStep(input);
      expect(rejected.replayed).toBe(false);
      expect(rejected.evidence).toMatchObject({
        gateId: f.gate.id,
        reviewerStepId: running.id,
        reviewerAgentVersionId: reviewerAgent,
        iteration: 0,
        verdict: 'reject',
        reviewedArtifactVersionIds: [v1.id],
      });
      expect(rejected.graph.run.state).toBe('revising');
      const rework = rejected.graph.steps.find(
        (step) => f.store.getReviewStepContext(f.graph.run.id, step.id)?.kind === 'rework',
      )!;
      expect(rework).toMatchObject({ state: 'ready', agentVersionId: targetAgent });
      expect(f.store.getReviewStepContext(f.graph.run.id, rework.id)).toMatchObject({
        kind: 'rework',
        iteration: 1,
        evidence: { id: rejected.evidence.id, verdict: 'reject' },
      });

      expect(f.store.completeReviewStep(input)).toMatchObject({ replayed: true });
      expect(() =>
        f.store.completeReviewStep({
          ...input,
          outcome: reviewOutcome('accept', v1, 'conflicting replay'),
        }),
      ).toThrow('review.verdict_conflict');
      expect(() => f.store.completeReviewStep({ ...input, ownerId: 'stale-owner' })).toThrow(
        'step.fence_mismatch',
      );
      expect(f.store.listReviewEvidence(f.gate.id)).toHaveLength(1);
      expect(() =>
        f.raw
          .prepare("UPDATE review_evidence SET explanation = 'mutated' WHERE id = ?")
          .run(rejected.evidence.id),
      ).toThrow('review.evidence_immutable');
      expect(() =>
        f.raw.prepare('DELETE FROM review_evidence WHERE id = ?').run(rejected.evidence.id),
      ).toThrow('review.evidence_immutable');
      expect(
        f.raw
          .prepare("SELECT COUNT(*) AS count FROM acceptance_gate_step WHERE role = 'rework'")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      f.raw.close();
    }
  });

  it('requires rework v2, preserves v1, and pauses exactly once on the second reject', async () => {
    const f = await fixture();
    try {
      const v1 = completeTarget(f);
      const reviewer0 = claim(
        f.store,
        f.graph.run.id,
        reviewerStep(f, 0).id,
        'owner-reviewer-0',
        '2026-07-14T00:00:05.000Z',
      );
      const first = f.store.completeReviewStep({
        runId: f.graph.run.id,
        stepId: reviewer0.id,
        idempotencyKey: reviewer0.idempotencyKey!,
        ownerId: 'owner-reviewer-0',
        executionAttempt: reviewer0.executionAttempt,
        reviewerAgentVersionId: reviewerAgent,
        outcome: reviewOutcome('reject', v1),
        now: '2026-07-14T00:00:06.000Z',
      });
      const reworkStep = first.graph.steps.find(
        (step) => f.store.getReviewStepContext(f.graph.run.id, step.id)?.kind === 'rework',
      )!;
      const rework = claim(
        f.store,
        f.graph.run.id,
        reworkStep.id,
        'owner-rework',
        '2026-07-14T00:00:07.000Z',
      );
      expect(() =>
        f.store.completeStep({
          runId: f.graph.run.id,
          stepId: rework.id,
          idempotencyKey: rework.idempotencyKey!,
          ownerId: 'owner-rework',
          executionAttempt: rework.executionAttempt,
          now: '2026-07-14T00:00:08.000Z',
        }),
      ).toThrow('review.rework_output_required');
      const reworked = f.store.completeStep({
        runId: f.graph.run.id,
        stepId: rework.id,
        idempotencyKey: rework.idempotencyKey!,
        ownerId: 'owner-rework',
        executionAttempt: rework.executionAttempt,
        outputVersions: [
          {
            artifactId: v1.artifactId,
            content: 'version two',
            mimeType: 'text/plain',
            status: 'candidate',
            parentVersionIds: [v1.id],
          },
        ],
        now: '2026-07-14T00:00:08.000Z',
      });
      const v2 = reworked.outputVersions[0]!;
      expect(v2).toMatchObject({ artifactId: v1.artifactId, version: 2 });
      expect(f.store.listRunArtifactVersions(f.graph.run.id).map((version) => version.id)).toEqual([
        v1.id,
        v2.id,
      ]);

      const reviewer1 = claim(
        f.store,
        f.graph.run.id,
        reviewerStep(f, 1).id,
        'owner-reviewer-1',
        '2026-07-14T00:00:09.000Z',
      );
      const secondInput = {
        runId: f.graph.run.id,
        stepId: reviewer1.id,
        idempotencyKey: reviewer1.idempotencyKey!,
        ownerId: 'owner-reviewer-1',
        executionAttempt: reviewer1.executionAttempt,
        reviewerAgentVersionId: reviewerAgent,
        outcome: reviewOutcome('reject', v2, 'second rejection'),
        now: '2026-07-14T00:00:10.000Z',
      };
      expect(f.store.completeReviewStep(secondInput).graph.run.state).toBe('paused');
      expect(f.store.completeReviewStep(secondInput)).toMatchObject({ replayed: true });
      expect(f.store.resumeRun(f.graph.run.id).run.state).toBe('paused');
      expect(
        f.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'review.limit-reached'")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      f.raw.close();
    }
  });

  it('rolls evidence, Step derivation, events, and checkpoint back together', async () => {
    const f = await fixture();
    try {
      const v1 = completeTarget(f);
      const reviewer = claim(
        f.store,
        f.graph.run.id,
        reviewerStep(f, 0).id,
        'owner-reviewer-rollback',
        '2026-07-14T00:00:05.000Z',
      );
      const checkpointBefore = (
        f.raw
          .prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?')
          .get(f.graph.run.id) as {
          count: number;
        }
      ).count;
      f.raw.exec(`
        CREATE TRIGGER fail_review_evidence_event
        BEFORE INSERT ON event
        WHEN NEW.type = 'review.evidence-recorded'
        BEGIN
          SELECT RAISE(ABORT, 'injected review event failure');
        END;
      `);
      const input = {
        runId: f.graph.run.id,
        stepId: reviewer.id,
        idempotencyKey: reviewer.idempotencyKey!,
        ownerId: 'owner-reviewer-rollback',
        executionAttempt: reviewer.executionAttempt,
        reviewerAgentVersionId: reviewerAgent,
        outcome: reviewOutcome('reject', v1),
        now: '2026-07-14T00:00:06.000Z',
      };
      expect(() => f.store.completeReviewStep(input)).toThrow('injected review event failure');
      expect(f.store.listReviewEvidence(f.gate.id)).toEqual([]);
      expect(f.store.getGraph(f.graph.run.id)).toMatchObject({
        run: { state: 'reviewing' },
        steps: [{ state: 'completed' }, { id: reviewer.id, state: 'running' }],
      });
      expect(
        f.raw
          .prepare("SELECT COUNT(*) AS count FROM acceptance_gate_step WHERE role = 'rework'")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        f.raw
          .prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?')
          .get(f.graph.run.id),
      ).toEqual({ count: checkpointBefore });
      f.raw.exec('DROP TRIGGER fail_review_evidence_event');
      expect(f.store.completeReviewStep(input).graph.run.state).toBe('revising');
    } finally {
      f.raw.close();
    }
  });

  it('rejects a wrong reviewer, cross-Run Step, and unassigned ArtifactVersion atomically', async () => {
    const f = await fixture();
    try {
      const v1 = completeTarget(f);
      const reviewer = claim(
        f.store,
        f.graph.run.id,
        reviewerStep(f, 0).id,
        'owner-reviewer-scope',
        '2026-07-14T00:00:05.000Z',
      );

      const foreignDraft = f.store.createPlanDraft({
        taskId,
        title: 'Foreign plan',
        steps: [
          {
            id: 'foreign-step' as StepId,
            title: 'Foreign',
            instructions: 'Produce foreign output',
            agentVersionId: targetAgent,
            dependsOn: [],
          },
        ],
        now: '2026-07-14T00:00:06.000Z',
      });
      const foreignGraph = f.store.approvePlan({
        planId: foreignDraft.planId,
        revision: 1,
        now: '2026-07-14T00:00:07.000Z',
      });
      const foreign = claim(
        f.store,
        foreignGraph.run.id,
        'foreign-step' as StepId,
        'owner-foreign',
        '2026-07-14T00:00:08.000Z',
      );
      const foreignVersion = f.store.completeStep({
        runId: foreignGraph.run.id,
        stepId: foreign.id,
        idempotencyKey: foreign.idempotencyKey!,
        ownerId: 'owner-foreign',
        executionAttempt: foreign.executionAttempt,
        outputVersions: [
          {
            artifactName: 'foreign.txt',
            content: 'foreign output',
            mimeType: 'text/plain',
            status: 'candidate',
          },
        ],
        now: '2026-07-14T00:00:09.000Z',
      }).outputVersions[0]!;
      const checkpointBefore = (
        f.raw
          .prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?')
          .get(f.graph.run.id) as { count: number }
      ).count;
      const valid = {
        runId: f.graph.run.id,
        stepId: reviewer.id,
        idempotencyKey: reviewer.idempotencyKey!,
        ownerId: 'owner-reviewer-scope',
        executionAttempt: reviewer.executionAttempt,
        reviewerAgentVersionId: reviewerAgent,
        outcome: reviewOutcome('accept', v1),
        now: '2026-07-14T00:00:10.000Z',
      };

      expect(() =>
        f.store.completeReviewStep({
          ...valid,
          reviewerAgentVersionId: targetAgent,
        }),
      ).toThrow('review.reviewer_agent_mismatch');
      expect(() =>
        f.store.completeReviewStep({
          ...valid,
          outcome: reviewOutcome('accept', foreignVersion),
        }),
      ).toThrow('review.artifact_scope_mismatch');
      expect(() =>
        f.store.completeReviewStep({
          ...valid,
          runId: foreignGraph.run.id,
        }),
      ).toThrow('Step not found');
      expect(f.store.listReviewEvidence(f.gate.id)).toEqual([]);
      expect(
        f.store.getGraph(f.graph.run.id)!.steps.find((step) => step.id === reviewer.id)?.state,
      ).toBe('running');
      expect(
        f.raw
          .prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?')
          .get(f.graph.run.id),
      ).toEqual({ count: checkpointBefore });
    } finally {
      f.raw.close();
    }
  });
});
