import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdapterEvent, ProviderAdapter } from '@sync-think/adapters';
import { SecureStore, XorDevBackend } from '@sync-think/secure-store';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteAgentStore,
  SqliteOrchestrationStore,
  SqliteProductionExecutionStore,
  SqliteProviderStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import { openPersistentRuntime } from '../persistence.js';
import { Scheduler } from './scheduler.js';
import { createProductionStepExecutor } from './production-step-executor.js';

const dirs: string[] = [];
const PRODUCTION_SECRET_CANARY = 'sk-production-secret-canary-Q1-7f4d9c2a';
const SECRET_ECHO_FAILURE = 'Production Provider response contained credential secret';

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function seedProductionRun(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  const keyPath = join(dir, 'secure', 'key.bin');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const secureStore = new SecureStore(new XorDevBackend(keyPath));
  const handle = await secureStore.storeSecret(PRODUCTION_SECRET_CANARY);
  const providerStore = new SqliteProviderStore(connection.raw);
  const provider = providerStore.createProvider({
    name: 'Production provider',
    baseUrl: 'https://provider.example/v1',
    protocol: 'openai-chat',
    supportsDiscovery: false,
    storeHandle: handle,
  });
  const model = providerStore.upsertModels({
    providerId: provider.provider.id,
    protocol: 'openai-chat',
    models: [{ providerModelId: 'production-model' }],
  })[0]!;
  connection.raw
    .prepare(
      `INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
     VALUES ('workspace-production', 'D:\\production', 'Production', 't0', 't0')`,
    )
    .run();
  connection.raw
    .prepare(
      `INSERT INTO task (
       id, workspace_id, title, goal, status, participation_mode,
       acceptance_criteria_json, version, created_at, updated_at
     ) VALUES ('task-production', 'workspace-production', 'Production', 'Execute once',
       'active', 'automatic', '[]', 0, 't0', 't0')`,
    )
    .run();
  connection.raw
    .prepare(
      "INSERT INTO thread (id, task_id, created_at) VALUES ('thread-production', 'task-production', 't0')",
    )
    .run();
  const agent = new SqliteAgentStore(connection.raw).createAgent({
    name: 'Production worker',
    role: 'worker',
    developerInstructions: 'Complete the step.',
    inputContract: 'step instructions',
    outputContract: 'text artifact',
    defaultModelId: model.id,
    defaultCredentialGroupId: provider.credentialGroup.id,
  });
  const orchestration = new SqliteOrchestrationStore(connection.raw);
  const draft = orchestration.createPlanDraft({
    taskId: 'task-production' as never,
    title: 'Production run',
    steps: [
      {
        id: 'production-step' as never,
        title: 'Production step',
        instructions: 'Call the provider exactly once',
        agentVersionId: agent.id,
        dependsOn: [],
      },
    ],
    now: '2026-07-14T00:00:00.000Z',
  });
  const graph = orchestration.approvePlan({
    planId: draft.planId,
    revision: 1,
    now: '2026-07-14T00:00:00.000Z',
  });
  return {
    dir,
    dbPath,
    keyPath,
    connection,
    secureStore,
    providerStore,
    orchestration,
    graph,
    agent,
  };
}

function productionExecutor(
  fixture: Awaited<ReturnType<typeof seedProductionRun>>,
  adapter: ProviderAdapter,
) {
  return createProductionStepExecutor({
    agentStore: new SqliteAgentStore(fixture.connection.raw),
    providerStore: fixture.providerStore,
    workspaceStore: new SqliteWorkspaceStore(fixture.connection.raw),
    orchestrationStore: fixture.orchestration,
    executionStore: new SqliteProductionExecutionStore(fixture.connection.raw),
    secureStore: fixture.secureStore,
    adaptersByProtocol: { 'openai-chat': adapter },
  });
}

function expectSecretAbsentFromPersistence(
  fixture: Awaited<ReturnType<typeof seedProductionRun>>,
): void {
  const events = fixture.connection.raw
    .prepare('SELECT type, payload_json FROM event ORDER BY rowid ASC')
    .all();
  const reservations = fixture.connection.raw
    .prepare(
      `SELECT state, result_json AS resultJson
       FROM provider_execution_reservation ORDER BY rowid ASC`,
    )
    .all();
  expect(JSON.stringify({ events, reservations })).not.toContain(PRODUCTION_SECRET_CANARY);
  expect(fixture.connection.raw.serialize().includes(Buffer.from(PRODUCTION_SECRET_CANARY))).toBe(
    false,
  );
  const failed = events
    .filter((event): event is { type: string; payload_json: string } =>
      Boolean(event && typeof event === 'object' && 'type' in event && 'payload_json' in event),
    )
    .reverse()
    .find((event) => event.type === 'step.failed');
  expect(failed).toBeDefined();
  expect(JSON.parse(failed!.payload_json)).toMatchObject({
    failureClass: 'protocol',
    code: 'step.executor.protocol',
    summary: SECRET_ECHO_FAILURE,
  });
}

function prepareReviewerAssignment(
  fixture: Awaited<ReturnType<typeof seedProductionRun>>,
  targetOutputs: Array<{
    artifactName: string;
    content: string;
    mimeType: string;
    status: 'candidate';
  }> = [
    {
      artifactName: 'review-target.txt',
      content: 'review target',
      mimeType: 'text/plain',
      status: 'candidate',
    },
  ],
) {
  const reviewer = new SqliteAgentStore(fixture.connection.raw).createAgent({
    name: 'Production validation reviewer',
    role: 'reviewer',
    developerInstructions: 'Return the required JSON review outcome.',
    inputContract: 'exact criteria and artifact versions',
    outputContract: 'structured review outcome JSON',
    defaultModelId: fixture.agent.defaultModelId,
    defaultCredentialGroupId: fixture.agent.defaultCredentialGroupId,
  });
  const gate = fixture.orchestration.createAcceptanceGate({
    id: 'gate-production-validation' as never,
    runId: fixture.graph.run.id,
    targetStepId: 'production-step' as never,
    reviewerAgentVersionId: reviewer.id,
    maxIterations: 1,
    onLimitReached: 'pause',
    criteria: [{ id: 'criterion-production-validation', description: 'Output is complete' }],
  });
  const target = fixture.orchestration.claimReadySteps({
    runId: fixture.graph.run.id,
    stepIds: ['production-step' as never],
    ownerId: 'production-validation-target',
    leaseExpiresAt: '9999-12-31T23:59:59.999Z',
  }).claimedSteps[0]!;
  const completed = fixture.orchestration.completeStep({
    runId: fixture.graph.run.id,
    stepId: target.id,
    idempotencyKey: target.idempotencyKey!,
    ownerId: target.executionOwnerId!,
    executionAttempt: target.executionAttempt,
    outputVersions: targetOutputs,
  });
  const reviewerStep = completed.graph.steps.find(
    (step) =>
      fixture.orchestration.getReviewStepContext(fixture.graph.run.id, step.id)?.kind ===
      'reviewer',
  )!;
  const context = fixture.orchestration.getReviewStepContext(
    fixture.graph.run.id,
    reviewerStep.id,
  );
  if (context?.kind !== 'reviewer') throw new Error('Reviewer assignment missing');
  return { reviewer, gate, reviewerStep, context };
}

function expectLatestReservationUncompleted(
  fixture: Awaited<ReturnType<typeof seedProductionRun>>,
): void {
  expect(
    fixture.connection.raw
      .prepare(
        `SELECT state, result_json AS resultJson
         FROM provider_execution_reservation ORDER BY rowid DESC LIMIT 1`,
      )
      .get(),
  ).toEqual({ state: 'started', resultJson: null });
}

describe('production Step execution reservations', () => {
  it('fails closed before persisting ordinary Provider output that echoes the current secret', async () => {
    const f = await seedProductionRun('sync-think-production-secret-ordinary-');
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        expect(request.apiKey).toBe(PRODUCTION_SECRET_CANARY);
        yield {
          type: 'text-delta',
          text: `ordinary output echoed ${PRODUCTION_SECRET_CANARY}`,
        };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const scheduler = new Scheduler({
      store: f.orchestration,
      executor: productionExecutor(f, adapter),
      ownerId: 'production-secret-ordinary',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('failed');
      expect(result.graph.steps).toMatchObject([{ state: 'failed' }]);
      expect(f.connection.raw.prepare('SELECT COUNT(*) AS count FROM artifact').get()).toEqual({
        count: 0,
      });
      expect(
        f.connection.raw
          .prepare(
            `SELECT state, result_json AS resultJson
             FROM provider_execution_reservation ORDER BY rowid DESC LIMIT 1`,
          )
          .get(),
      ).toEqual({ state: 'started', resultJson: null });
      expectSecretAbsentFromPersistence(f);
    } finally {
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('fails closed before persisting reviewer JSON that echoes the current secret', async () => {
    const f = await seedProductionRun('sync-think-production-secret-reviewer-');
    const reviewer = new SqliteAgentStore(f.connection.raw).createAgent({
      name: 'Production secret reviewer',
      role: 'reviewer',
      developerInstructions: 'Return the required JSON review outcome.',
      inputContract: 'exact acceptance criteria and ArtifactVersions',
      outputContract: 'structured review outcome JSON',
      defaultModelId: f.agent.defaultModelId,
      defaultCredentialGroupId: f.agent.defaultCredentialGroupId,
    });
    const gate = f.orchestration.createAcceptanceGate({
      id: 'gate-production-secret-review' as never,
      runId: f.graph.run.id,
      targetStepId: 'production-step' as never,
      reviewerAgentVersionId: reviewer.id,
      maxIterations: 1,
      onLimitReached: 'pause',
      criteria: [{ id: 'criterion-secret-review', description: 'Output is complete' }],
    });
    let providerCalls = 0;
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(): AsyncIterable<AdapterEvent> {
        providerCalls += 1;
        if (providerCalls === 1) {
          yield { type: 'text-delta', text: 'safe target artifact' };
        } else {
          const graph = f.orchestration.getGraph(f.graph.run.id)!;
          const running = graph.steps.find((step) => step.state === 'running')!;
          const context = f.orchestration.getReviewStepContext(graph.run.id, running.id);
          if (context?.kind !== 'reviewer') throw new Error('Reviewer context missing');
          yield {
            type: 'text-delta',
            text: JSON.stringify({
              verdict: 'accept',
              explanation: `secret echo ${PRODUCTION_SECRET_CANARY}`,
              criteria: context.criteria.map((criterion) => ({
                criterionId: criterion.id,
                verdict: 'pass',
                explanation: 'criterion passed',
              })),
              reviewedArtifactVersionIds: context.reviewedArtifactVersions.map(
                (version) => version.id,
              ),
            }),
          };
        }
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const scheduler = new Scheduler({
      store: f.orchestration,
      executor: productionExecutor(f, adapter),
      ownerId: 'production-secret-reviewer',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('failed');
      expect(result.graph.steps.at(-1)).toMatchObject({ state: 'failed' });
      expect(providerCalls).toBe(2);
      expect(f.orchestration.listReviewEvidence(gate.id)).toEqual([]);
      expect(f.orchestration.listRunArtifactVersions(f.graph.run.id)).toMatchObject([
        { content: 'safe target artifact' },
      ]);
      expect(
        f.connection.raw
          .prepare(
            `SELECT state, result_json AS resultJson
             FROM provider_execution_reservation ORDER BY rowid DESC LIMIT 1`,
          )
          .get(),
      ).toEqual({ state: 'started', resultJson: null });
      expectSecretAbsentFromPersistence(f);
    } finally {
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it.each(['call', 'collect'] as const)(
    'scrubs the current secret when adapter %s throws it',
    async (failurePoint) => {
      const f = await seedProductionRun(`sync-think-production-secret-${failurePoint}-`);
      async function* collectFailure(): AsyncIterable<AdapterEvent> {
        throw new Error(`collect failure echoed ${PRODUCTION_SECRET_CANARY}`);
      }
      const adapter: ProviderAdapter = {
        protocol: 'openai-chat',
        async discoverModels() {
          return [];
        },
        call(): AsyncIterable<AdapterEvent> {
          if (failurePoint === 'call') {
            throw new Error(`call failure echoed ${PRODUCTION_SECRET_CANARY}`);
          }
          return collectFailure();
        },
      };
      const scheduler = new Scheduler({
        store: f.orchestration,
        executor: productionExecutor(f, adapter),
        ownerId: `production-secret-${failurePoint}`,
      });
      try {
        const result = await scheduler.runUntilIdle(f.graph.run.id);
        expect(result.graph.run.state).toBe('failed');
        expect(result.graph.steps).toMatchObject([{ state: 'failed' }]);
        expect(f.connection.raw.prepare('SELECT COUNT(*) AS count FROM artifact').get()).toEqual({
          count: 0,
        });
        expectSecretAbsentFromPersistence(f);
      } finally {
        await scheduler.shutdown();
        f.secureStore.shutdown();
        f.connection.raw.close();
      }
    },
  );

  it('fails a production reviewer closed when the Provider returns prose instead of a structured verdict', async () => {
    const f = await seedProductionRun('sync-think-production-reviewer-fail-closed-');
    const reviewer = new SqliteAgentStore(f.connection.raw).createAgent({
      name: 'Production reviewer',
      role: 'reviewer',
      developerInstructions: 'Review the assigned artifact.',
      inputContract: 'acceptance criteria and exact artifact versions',
      outputContract: 'structured review outcome',
      defaultModelId: f.agent.defaultModelId,
      defaultCredentialGroupId: f.agent.defaultCredentialGroupId,
    });
    const gate = f.orchestration.createAcceptanceGate({
      id: 'gate-production-review' as never,
      runId: f.graph.run.id,
      targetStepId: 'production-step' as never,
      reviewerAgentVersionId: reviewer.id,
      maxIterations: 1,
      onLimitReached: 'pause',
      criteria: [{ id: 'criterion-production', description: 'Output is complete' }],
    });
    let providerCalls = 0;
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(): AsyncIterable<AdapterEvent> {
        providerCalls += 1;
        yield {
          type: 'text-delta',
          text: providerCalls === 1 ? 'target artifact' : 'Looks good, accept it.',
        };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const scheduler = new Scheduler({
      store: f.orchestration,
      executor: productionExecutor(f, adapter),
      ownerId: 'production-reviewer-fail-closed',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('failed');
      expect(result.graph.steps.at(-1)).toMatchObject({
        agentVersionId: reviewer.id,
        state: 'failed',
      });
      expect(providerCalls).toBe(2);
      expect(f.orchestration.listReviewEvidence(gate.id)).toEqual([]);
      expect(f.connection.raw.prepare('SELECT COUNT(*) AS count FROM artifact').get()).toEqual({
        count: 1,
      });
      expectLatestReservationUncompleted(f);
      expect(
        f.connection.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'run.completed'")
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it.each(['criteria', 'artifact'] as const)(
    'does not complete a reviewer reservation with an invalid %s assignment',
    async (invalidAssignment) => {
      const f = await seedProductionRun(`sync-think-production-reviewer-${invalidAssignment}-`);
      const assignment = prepareReviewerAssignment(f);
      const adapter: ProviderAdapter = {
        protocol: 'openai-chat',
        async discoverModels() {
          return [];
        },
        async *call(): AsyncIterable<AdapterEvent> {
          yield {
            type: 'text-delta',
            text: JSON.stringify({
              verdict: 'accept',
              explanation: 'Invalid assignment must fail before reservation completion.',
              criteria: [
                {
                  criterionId:
                    invalidAssignment === 'criteria'
                      ? 'criterion-outside-assignment'
                      : assignment.context.criteria[0]!.id,
                  verdict: 'pass',
                  explanation: 'checked',
                },
              ],
              reviewedArtifactVersionIds:
                invalidAssignment === 'artifact'
                  ? ['artifact-version-outside-assignment']
                  : assignment.context.reviewedArtifactVersions.map((version) => version.id),
            }),
          };
          yield { type: 'finished', reason: 'stop' };
        },
      };
      const scheduler = new Scheduler({
        store: f.orchestration,
        executor: productionExecutor(f, adapter),
        ownerId: `production-reviewer-invalid-${invalidAssignment}`,
      });
      try {
        const result = await scheduler.runUntilIdle(f.graph.run.id);
        expect(result.graph.run.state).toBe('failed');
        expectLatestReservationUncompleted(f);
        expect(f.orchestration.listReviewEvidence(assignment.gate.id)).toEqual([]);
        expect(f.orchestration.listRunArtifactVersions(f.graph.run.id)).toHaveLength(1);
      } finally {
        await scheduler.shutdown();
        f.secureStore.shutdown();
        f.connection.raw.close();
      }
    },
  );

  it('does not complete a reviewer reservation with a contradictory verdict', async () => {
    const f = await seedProductionRun('sync-think-production-reviewer-contradiction-');
    const assignment = prepareReviewerAssignment(f);
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(): AsyncIterable<AdapterEvent> {
        yield {
          type: 'text-delta',
          text: JSON.stringify({
            verdict: 'accept',
            explanation: 'This verdict contradicts the failed criterion.',
            criteria: assignment.context.criteria.map((criterion) => ({
              criterionId: criterion.id,
              verdict: 'fail',
              explanation: 'The assigned output is incomplete.',
            })),
            reviewedArtifactVersionIds: assignment.context.reviewedArtifactVersions.map(
              (version) => version.id,
            ),
          }),
        };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const scheduler = new Scheduler({
      store: f.orchestration,
      executor: productionExecutor(f, adapter),
      ownerId: 'production-reviewer-contradiction',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('failed');
      expectLatestReservationUncompleted(f);
      expect(f.orchestration.listReviewEvidence(assignment.gate.id)).toEqual([]);
      expect(f.orchestration.listRunArtifactVersions(f.graph.run.id)).toHaveLength(1);
    } finally {
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('does not complete a reservation for invalid structured rework', async () => {
    const f = await seedProductionRun('sync-think-production-invalid-structured-rework-');
    const assignment = prepareReviewerAssignment(f, [
      {
        artifactName: 'design.md',
        content: 'design v1',
        mimeType: 'text/markdown',
        status: 'candidate',
      },
      {
        artifactName: 'notes.txt',
        content: 'notes v1',
        mimeType: 'text/plain',
        status: 'candidate',
      },
    ]);
    const reviewer = f.orchestration.claimReadySteps({
      runId: f.graph.run.id,
      stepIds: [assignment.reviewerStep.id],
      ownerId: 'production-invalid-rework-reviewer',
      leaseExpiresAt: '9999-12-31T23:59:59.999Z',
    }).claimedSteps[0]!;
    f.orchestration.completeReviewStep({
      runId: f.graph.run.id,
      stepId: reviewer.id,
      idempotencyKey: reviewer.idempotencyKey!,
      ownerId: reviewer.executionOwnerId!,
      executionAttempt: reviewer.executionAttempt,
      reviewerAgentVersionId: assignment.reviewer.id,
      outcome: {
        verdict: 'reject',
        explanation: 'Revision required.',
        criteria: [
          {
            criterionId: assignment.context.criteria[0]!.id,
            verdict: 'fail',
            explanation: 'Revise one artifact.',
          },
        ],
        reviewedArtifactVersionIds: assignment.context.reviewedArtifactVersions.map(
          (version) => version.id,
        ),
      },
    });
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(): AsyncIterable<AdapterEvent> {
        yield {
          type: 'text-delta',
          text: JSON.stringify({
            revisions: [
              {
                parentArtifactVersionId: 'artifact-version-outside-assignment',
                content: 'invalid revision',
              },
            ],
          }),
        };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const scheduler = new Scheduler({
      store: f.orchestration,
      executor: productionExecutor(f, adapter),
      ownerId: 'production-invalid-structured-rework',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('failed');
      expectLatestReservationUncompleted(f);
      expect(f.orchestration.listReviewEvidence(assignment.gate.id)).toHaveLength(1);
      expect(f.orchestration.listRunArtifactVersions(f.graph.run.id)).toHaveLength(2);
    } finally {
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('executes production reviewer JSON and rework against exact persisted criteria and artifacts', async () => {
    const f = await seedProductionRun('sync-think-production-reviewer-success-');
    const reviewer = new SqliteAgentStore(f.connection.raw).createAgent({
      name: 'Production reviewer success',
      role: 'reviewer',
      developerInstructions: 'Return the required JSON review outcome.',
      inputContract: 'exact acceptance criteria and artifact versions',
      outputContract: 'structured review outcome JSON',
      defaultModelId: f.agent.defaultModelId,
      defaultCredentialGroupId: f.agent.defaultCredentialGroupId,
    });
    const gate = f.orchestration.createAcceptanceGate({
      id: 'gate-production-review-success' as never,
      runId: f.graph.run.id,
      targetStepId: 'production-step' as never,
      reviewerAgentVersionId: reviewer.id,
      maxIterations: 1,
      onLimitReached: 'pause',
      criteria: [{ id: 'criterion-production', description: 'Output is complete' }],
    });
    const roles: string[] = [];
    const prompts: string[] = [];
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        const graph = f.orchestration.getGraph(f.graph.run.id)!;
        const running = graph.steps.find((step) => step.state === 'running')!;
        const context = f.orchestration.getReviewStepContext(graph.run.id, running.id);
        const prompt = request.messages[0]?.content;
        prompts.push(typeof prompt === 'string' ? prompt : JSON.stringify(prompt));
        if (!context) {
          roles.push('target');
          yield { type: 'text-delta', text: 'production version one' };
        } else if (context.kind === 'rework') {
          roles.push(`rework-${context.iteration}`);
          yield { type: 'text-delta', text: 'production version two' };
        } else {
          roles.push(`reviewer-${context.iteration}`);
          const verdict = context.iteration === 0 ? 'reject' : 'accept';
          yield {
            type: 'text-delta',
            text: JSON.stringify({
              verdict,
              explanation: `${verdict} production review`,
              criteria: context.criteria.map((criterion) => ({
                criterionId: criterion.id,
                verdict: verdict === 'accept' ? 'pass' : 'fail',
                explanation: `checked ${criterion.id}`,
              })),
              reviewedArtifactVersionIds: context.reviewedArtifactVersions.map(
                (version) => version.id,
              ),
            }),
          };
        }
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const scheduler = new Scheduler({
      store: f.orchestration,
      executor: productionExecutor(f, adapter),
      ownerId: 'production-reviewer-success',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('completed');
      expect(roles).toEqual(['target', 'reviewer-0', 'rework-1', 'reviewer-1']);
      const versions = f.orchestration.listRunArtifactVersions(f.graph.run.id);
      expect(versions).toMatchObject([
        { version: 1, content: 'production version one' },
        {
          artifactId: versions[0]!.artifactId,
          version: 2,
          content: 'production version two',
          parentVersionIds: [versions[0]!.id],
        },
      ]);
      expect(f.orchestration.listReviewEvidence(gate.id)).toMatchObject([
        { iteration: 0, verdict: 'reject', reviewedArtifactVersionIds: [versions[0]!.id] },
        { iteration: 1, verdict: 'accept', reviewedArtifactVersionIds: [versions[1]!.id] },
      ]);
      expect(prompts[1]).toContain('criterion-production');
      expect(prompts[1]).toContain(versions[0]!.id);
      expect(prompts[2]).toContain(f.orchestration.listReviewEvidence(gate.id)[0]!.id);
    } finally {
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('does not persist finished Provider output when execution aborts during iterator cleanup', async () => {
    const f = await seedProductionRun('sync-think-provider-cleanup-abort-');
    const cleanupEntered = deferred();
    const releaseCleanup = deferred();
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(): AsyncIterable<AdapterEvent> {
        try {
          yield { type: 'text-delta', text: 'valid finished output' };
          yield { type: 'finished', reason: 'stop' };
        } finally {
          cleanupEntered.resolve();
          await releaseCleanup.promise;
        }
      },
    };
    const scheduler = new Scheduler({
      store: f.orchestration,
      executor: productionExecutor(f, adapter),
      ownerId: 'production-cleanup-abort',
    });
    try {
      const execution = scheduler.tick(f.graph.run.id);
      await cleanupEntered.promise;
      scheduler.abortActiveRun(f.graph.run.id);
      releaseCleanup.resolve();
      await execution;

      expectLatestReservationUncompleted(f);
      for (const table of ['artifact', 'artifact_version', 'review_evidence']) {
        expect(
          f.connection.raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(),
          `${table} must remain empty`,
        ).toEqual({ count: 0 });
      }
    } finally {
      releaseCleanup.resolve();
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('parses structured partial revisions for multiple exact ArtifactVersions', async () => {
    const f = await seedProductionRun('sync-think-production-multi-artifact-rework-');
    const reviewer = new SqliteAgentStore(f.connection.raw).createAgent({
      name: 'Production multi-artifact reviewer',
      role: 'reviewer',
      developerInstructions: 'Return the required JSON review outcome.',
      inputContract: 'exact acceptance criteria and ArtifactVersions',
      outputContract: 'structured review outcome JSON',
      defaultModelId: f.agent.defaultModelId,
      defaultCredentialGroupId: f.agent.defaultCredentialGroupId,
    });
    const gate = f.orchestration.createAcceptanceGate({
      id: 'gate-production-multi-rework' as never,
      runId: f.graph.run.id,
      targetStepId: 'production-step' as never,
      reviewerAgentVersionId: reviewer.id,
      maxIterations: 1,
      onLimitReached: 'pause',
      criteria: [{ id: 'criterion-production-multi', description: 'All artifacts are complete' }],
    });

    const targetClaim = f.orchestration.claimReadySteps({
      runId: f.graph.run.id,
      stepIds: ['production-step' as never],
      ownerId: 'production-multi-target-owner',
      leaseExpiresAt: '2099-07-14T00:00:10.000Z',
      now: '2099-07-14T00:00:01.000Z',
    }).claimedSteps[0]!;
    const targetCompletion = f.orchestration.completeStep({
      runId: f.graph.run.id,
      stepId: targetClaim.id,
      idempotencyKey: targetClaim.idempotencyKey!,
      ownerId: targetClaim.executionOwnerId!,
      executionAttempt: targetClaim.executionAttempt,
      outputVersions: [
        {
          artifactName: 'design.md',
          content: 'design v1',
          mimeType: 'text/markdown',
          status: 'candidate',
        },
        {
          artifactName: 'notes.txt',
          content: 'notes v1',
          mimeType: 'text/plain',
          status: 'candidate',
        },
      ],
      now: '2099-07-14T00:00:02.000Z',
    });
    const initialReviewer = targetCompletion.graph.steps.find(
      (step) => f.orchestration.getReviewStepContext(f.graph.run.id, step.id)?.kind === 'reviewer',
    )!;
    const reviewerClaim = f.orchestration.claimReadySteps({
      runId: f.graph.run.id,
      stepIds: [initialReviewer.id],
      ownerId: 'production-multi-reviewer-owner',
      leaseExpiresAt: '2099-07-14T00:00:20.000Z',
      now: '2099-07-14T00:00:11.000Z',
    }).claimedSteps[0]!;
    const initialReviewContext = f.orchestration.getReviewStepContext(
      f.graph.run.id,
      reviewerClaim.id,
    );
    if (initialReviewContext?.kind !== 'reviewer') throw new Error('Initial reviewer missing');
    f.orchestration.completeReviewStep({
      runId: f.graph.run.id,
      stepId: reviewerClaim.id,
      idempotencyKey: reviewerClaim.idempotencyKey!,
      ownerId: reviewerClaim.executionOwnerId!,
      executionAttempt: reviewerClaim.executionAttempt,
      reviewerAgentVersionId: reviewer.id,
      outcome: {
        verdict: 'reject',
        explanation: 'Design requires revision.',
        criteria: [
          {
            criterionId: 'criterion-production-multi',
            verdict: 'fail',
            explanation: 'Only the design needs revision.',
          },
        ],
        reviewedArtifactVersionIds: initialReviewContext.reviewedArtifactVersions.map(
          (version) => version.id,
        ),
      },
      now: '2099-07-14T00:00:12.000Z',
    });

    const roles: string[] = [];
    const prompts: string[] = [];
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        const graph = f.orchestration.getGraph(f.graph.run.id)!;
        const running = graph.steps.find((step) => step.state === 'running')!;
        const context = f.orchestration.getReviewStepContext(graph.run.id, running.id);
        const prompt = request.messages[0]?.content;
        prompts.push(typeof prompt === 'string' ? prompt : JSON.stringify(prompt));
        if (context?.kind === 'rework') {
          roles.push('rework-1');
          const versions = f.orchestration.listRunArtifactVersions(f.graph.run.id);
          const designParent = context.evidence.reviewedArtifactVersionIds
            .map((id) => versions.find((version) => version.id === id))
            .find((version) => version?.content === 'design v1');
          if (!designParent) throw new Error('Exact design parent missing');
          yield {
            type: 'text-delta',
            text: JSON.stringify({
              revisions: [
                {
                  parentArtifactVersionId: designParent.id,
                  content: 'design v2',
                  mimeType: 'text/markdown',
                  status: 'candidate',
                  metadata: { revisionReason: 'criterion-production-multi' },
                },
              ],
            }),
          };
        } else if (context?.kind === 'reviewer') {
          roles.push('reviewer-1');
          yield {
            type: 'text-delta',
            text: JSON.stringify({
              verdict: 'accept',
              explanation: 'The revised set is complete.',
              criteria: context.criteria.map((criterion) => ({
                criterionId: criterion.id,
                verdict: 'pass',
                explanation: `checked ${criterion.id}`,
              })),
              reviewedArtifactVersionIds: context.reviewedArtifactVersions.map(
                (version) => version.id,
              ),
            }),
          };
        } else {
          throw new Error('Unexpected production execution role');
        }
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const scheduler = new Scheduler({
      store: f.orchestration,
      executor: productionExecutor(f, adapter),
      ownerId: 'production-multi-artifact-rework',
      now: () => '2099-07-14T00:00:30.000Z',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('completed');
      expect(roles).toEqual(['rework-1', 'reviewer-1']);
      expect(prompts[0]).toContain('parentArtifactVersionId');

      const versions = f.orchestration.listRunArtifactVersions(f.graph.run.id);
      const designV1 = versions.find((version) => version.content === 'design v1')!;
      const notesV1 = versions.find((version) => version.content === 'notes v1')!;
      const designV2 = versions.find((version) => version.content === 'design v2')!;
      expect(versions).toHaveLength(3);
      expect(designV2).toMatchObject({
        artifactId: designV1.artifactId,
        parentVersionIds: [designV1.id],
        mimeType: 'text/markdown',
        status: 'candidate',
        metadata: expect.objectContaining({ revisionReason: 'criterion-production-multi' }),
      });
      const evidence = f.orchestration.listReviewEvidence(gate.id);
      expect(evidence[1]).toMatchObject({
        verdict: 'accept',
        reviewedArtifactVersionIds: expect.arrayContaining([designV2.id, notesV1.id]),
      });
      expect(evidence[1]!.reviewedArtifactVersionIds).not.toContain(designV1.id);
      expect(evidence[1]!.reviewedArtifactVersionIds).toHaveLength(2);
    } finally {
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('replays a completed reservation after recovery without a second Provider call', async () => {
    const f = await seedProductionRun('sync-think-provider-reservation-replay-');
    let providerCalls = 0;
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(): AsyncIterable<AdapterEvent> {
        providerCalls += 1;
        yield { type: 'text-delta', text: 'reserved provider output' };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    try {
      const firstClaim = f.orchestration.claimReadySteps({
        runId: f.graph.run.id,
        stepIds: ['production-step' as never],
        ownerId: 'owner-before-crash',
        leaseExpiresAt: '2099-07-14T00:00:10.000Z',
        now: '2099-07-14T00:00:01.000Z',
      }).claimedSteps[0]!;
      const executor = productionExecutor(f, adapter);
      await executor.execute({
        runId: f.graph.run.id,
        step: firstClaim,
        idempotencyKey: firstClaim.idempotencyKey!,
        artifactVersions: [],
        signal: new AbortController().signal,
      });
      expect(providerCalls).toBe(1);
      expect(
        new SqliteProductionExecutionStore(f.connection.raw).getProviderExecution(
          firstClaim.idempotencyKey!,
        ),
      ).toMatchObject({ state: 'completed' });

      f.orchestration.recoverRun(f.graph.run.id, '2099-07-14T00:00:11.000Z');
      const replayExecutor = createProductionStepExecutor({
        agentStore: new SqliteAgentStore(f.connection.raw),
        providerStore: f.providerStore,
        workspaceStore: new SqliteWorkspaceStore(f.connection.raw),
        orchestrationStore: f.orchestration,
        executionStore: new SqliteProductionExecutionStore(f.connection.raw),
        secureStore: {
          async retrieveSecret() {
            throw new Error('live credential is unavailable during completed replay');
          },
        } as unknown as SecureStore,
        adaptersByProtocol: {},
      });
      const scheduler = new Scheduler({
        store: f.orchestration,
        executor: replayExecutor,
        ownerId: 'owner-after-crash',
        now: () => '2099-07-14T00:00:12.000Z',
      });
      const recovered = await scheduler.tick(f.graph.run.id);
      expect(recovered.graph.run.state).toBe('completed');
      expect(providerCalls).toBe(1);
      expect(f.connection.raw.prepare('SELECT COUNT(*) AS count FROM artifact').get()).toEqual({
        count: 1,
      });
      expect(
        f.connection.raw.prepare('SELECT COUNT(*) AS count FROM artifact_version').get(),
      ).toEqual({ count: 1 });
      await scheduler.shutdown();
    } finally {
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('fails a recovered started/unknown reservation without calling the Provider again', async () => {
    const f = await seedProductionRun('sync-think-provider-reservation-unknown-');
    let providerCalls = 1;
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(): AsyncIterable<AdapterEvent> {
        providerCalls += 1;
        yield { type: 'finished', reason: 'stop' };
      },
    };
    try {
      const firstClaim = f.orchestration.claimReadySteps({
        runId: f.graph.run.id,
        stepIds: ['production-step' as never],
        ownerId: 'owner-before-crash',
        leaseExpiresAt: '2099-07-14T00:00:10.000Z',
        now: '2099-07-14T00:00:01.000Z',
      }).claimedSteps[0]!;
      new SqliteProductionExecutionStore(f.connection.raw).reserveProviderExecution({
        idempotencyKey: firstClaim.idempotencyKey!,
        runId: f.graph.run.id,
        stepId: firstClaim.id,
        agentVersionId: firstClaim.agentVersionId,
        ownerId: 'owner-before-crash',
        executionAttempt: firstClaim.executionAttempt,
      });
      f.orchestration.recoverRun(f.graph.run.id, '2099-07-14T00:00:11.000Z');
      const scheduler = new Scheduler({
        store: f.orchestration,
        executor: productionExecutor(f, adapter),
        ownerId: 'owner-after-crash',
        now: () => '2099-07-14T00:00:12.000Z',
      });
      const recovered = await scheduler.tick(f.graph.run.id);
      expect(recovered.graph.run.state).toBe('failed');
      expect(recovered.graph.steps[0]).toMatchObject({ state: 'failed' });
      expect(providerCalls).toBe(1);
      expect(f.connection.raw.prepare('SELECT COUNT(*) AS count FROM artifact').get()).toEqual({
        count: 0,
      });
      await scheduler.shutdown();
    } finally {
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('waits for Provider abort cleanup before persistent Runtime close resolves', async () => {
    const f = await seedProductionRun('sync-think-provider-close-cleanup-');
    f.connection.raw.close();
    f.secureStore.shutdown();
    const entered = deferred();
    const cleanupEntered = deferred();
    const releaseCleanup = deferred();
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        entered.resolve();
        try {
          await new Promise<void>((resolve) => {
            if (request.signal.aborted) resolve();
            else request.signal.addEventListener('abort', () => resolve(), { once: true });
          });
        } finally {
          cleanupEntered.resolve();
          await releaseCleanup.promise;
        }
      },
    };
    const session = await openPersistentRuntime({
      dbPath: f.dbPath,
      secureStoreKeyPath: f.keyPath,
      installId: `production-close-${Date.now()}`,
      allowNoToken: true,
      discoveryByProtocol: { 'openai-chat': adapter },
    });
    await session.runtime.start();
    await entered.promise;
    let closed = false;
    const closing = session.close().then(() => {
      closed = true;
    });
    await cleanupEntered.promise;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(closed).toBe(false);
    releaseCleanup.resolve();
    await closing;
    expect(closed).toBe(true);
  });
});
