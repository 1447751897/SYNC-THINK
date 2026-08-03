import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import type { ImageGenerationConfig } from '@sync-think/shared';
import { SecureStore, XorDevBackend } from '@sync-think/secure-store';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteAgentStore,
  SqliteApprovalStore,
  SqliteArtifactStore,
  SqliteBrowserStore,
  SqliteOrchestrationStore,
  SqliteProductionExecutionStore,
  SqliteProviderStore,
  SqliteSkillStore,
  SqliteWorkspaceStore,
  SqliteUnitOfWork,
  type StepArtifactVersionOutput,
} from '@sync-think/storage';
import { openPersistentRuntime } from '../persistence.js';
import { Scheduler } from './scheduler.js';
import { GeneratedImageStore } from './generated-image-store.js';
import type {
  BrowserHostLike,
  BrowserWorker,
  BrowserWorkerInput,
  WorkerEvent,
  WorkerToken,
} from '@sync-think/workers';
import { RuntimeBrowserController } from '../browser/runtime-browser-controller.js';
import {
  createProductionStepExecutor,
  type ProductionStepExecutorOptions,
} from './production-step-executor.js';

const dirs: string[] = [];
const PRODUCTION_SECRET_CANARY = 'sk-production-secret-canary-Q1-7f4d9c2a';
const SECRET_ECHO_FAILURE = 'Production Provider response contained credential secret';

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function seedProductionRun(
  prefix: string,
  protocol: 'openai-chat' | 'openai-images' = 'openai-chat',
  imageGeneration?: ImageGenerationConfig,
) {
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
    protocol,
    supportsDiscovery: false,
    storeHandle: handle,
  });
  const model = providerStore.upsertModels({
    providerId: provider.provider.id,
    protocol,
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
        ...(imageGeneration ? { imageGeneration: { ...imageGeneration } } : {}),
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
  overrides: Partial<ProductionStepExecutorOptions> = {},
) {
  return createProductionStepExecutor({
    agentStore: new SqliteAgentStore(fixture.connection.raw),
    providerStore: fixture.providerStore,
    workspaceStore: new SqliteWorkspaceStore(fixture.connection.raw),
    orchestrationStore: fixture.orchestration,
    executionStore: new SqliteProductionExecutionStore(fixture.connection.raw),
    skillStore: new SqliteSkillStore(fixture.connection.raw),
    secureStore: fixture.secureStore,
    adaptersByProtocol: { 'openai-chat': adapter },
    ...overrides,
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
  targetOutputs: StepArtifactVersionOutput[] = [
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
  const context = fixture.orchestration.getReviewStepContext(fixture.graph.run.id, reviewerStep.id);
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
  it('materializes generated image files as candidate ArtifactVersions through Scheduler', async () => {
    const f = await seedProductionRun('sync-think-production-image-artifact-', 'openai-images');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);
    let providerCalls = 0;
    const adapter: ProviderAdapter = {
      protocol: 'openai-images',
      async discoverModels() {
        return [];
      },
      call(): AsyncIterable<AdapterEvent> {
        throw new Error('conversation call must not run for images');
      },
      async generateImages(request) {
        providerCalls += 1;
        expect(request).toMatchObject({ size: 'auto', quality: 'auto', count: 1 });
        return { images: [{ bytes: png, mimeType: 'image/png' }] };
      },
    };
    const generatedRoot = join(f.dir, 'runtime-data', 'artifacts', 'generated-images');
    const executor = productionExecutor(f, adapter, {
      adaptersByProtocol: { 'openai-images': adapter },
      generatedImageStore: new GeneratedImageStore(generatedRoot),
    });
    const scheduler = new Scheduler({
      store: f.orchestration,
      executor,
      ownerId: 'owner-image-artifact',
      now: () => '2099-07-14T00:00:01.000Z',
    });
    try {
      const tick = await scheduler.tick(f.graph.run.id);

      expect(tick.graph.run.state).toBe('completed');
      expect(providerCalls).toBe(1);
      const version = f.connection.raw
        .prepare(
          `SELECT content, content_ref AS contentRef, content_hash AS contentHash,
                  mime_type AS mimeType, status
           FROM artifact_version`,
        )
        .get() as {
        content: string | null;
        contentRef: string;
        contentHash: string;
        mimeType: string;
        status: string;
      };
      expect(version).toMatchObject({
        content: null,
        mimeType: 'image/png',
        status: 'candidate',
      });
      expect(version.contentRef.startsWith(generatedRoot)).toBe(true);
      expect(readFileSync(version.contentRef)).toEqual(png);
      expect(version.contentHash).toBe(
        await import('node:crypto').then(({ createHash }) =>
          createHash('sha256').update(png).digest('hex'),
        ),
      );
    } finally {
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('sends an exact Runtime-verified image as an in-memory multimodal Reviewer request', async () => {
    const f = await seedProductionRun('sync-think-production-image-reviewer-');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 21, 22, 23]);
    const generatedRoot = join(f.dir, 'runtime-data', 'artifacts', 'generated-images');
    const generatedImageStore = new GeneratedImageStore(generatedRoot);
    const stored = (
      await generatedImageStore.store({
        runId: f.graph.run.id,
        stepId: 'production-step',
        idempotencyKey: 'image-reviewer-fixture',
        images: [{ bytes: png, mimeType: 'image/png' }],
      })
    )[0]!;
    const assignment = prepareReviewerAssignment(f, [
      {
        artifactName: 'review-image.png',
        contentRef: stored.contentRef,
        contentHash: stored.contentHash,
        mimeType: stored.mimeType,
        status: 'candidate',
      },
    ]);
    f.connection.raw
      .prepare('UPDATE model SET capabilities_json = \'["text","vision"]\' WHERE id = ?')
      .run(f.agent.defaultModelId);
    let capturedRequest: ProviderCallRequest | undefined;
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        capturedRequest = request;
        yield {
          type: 'text-delta',
          text: JSON.stringify({
            verdict: 'accept',
            explanation: 'The selected image is complete.',
            criteria: assignment.context.criteria.map((criterion) => ({
              criterionId: criterion.id,
              verdict: 'pass',
              explanation: 'The image satisfies the criterion.',
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
      executor: productionExecutor(f, adapter, { generatedImageStore }),
      ownerId: 'production-image-reviewer',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('completed');
      expect(capturedRequest).toBeDefined();
      const content = capturedRequest!.messages[0]!.content;
      expect(Array.isArray(content)).toBe(true);
      if (!Array.isArray(content)) throw new Error('Expected multimodal Reviewer content');
      expect(content).toHaveLength(2);
      expect(content[0]).toMatchObject({ type: 'text' });
      expect(content[1]).toEqual({
        type: 'image',
        imageUrl: `data:image/png;base64,${png.toString('base64')}`,
      });
      expect(content[0]!.text).toContain(assignment.context.reviewedArtifactVersions[0]!.id);
      expect(content[0]!.text).not.toContain(stored.contentRef);
      expect(content[0]!.text).not.toContain(generatedRoot);
    } finally {
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('fails an image Reviewer before Provider reservation when the model lacks vision', async () => {
    const f = await seedProductionRun('sync-think-production-image-reviewer-no-vision-');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 31, 32, 33]);
    const generatedImageStore = new GeneratedImageStore(
      join(f.dir, 'runtime-data', 'artifacts', 'generated-images'),
    );
    const stored = (
      await generatedImageStore.store({
        runId: f.graph.run.id,
        stepId: 'production-step',
        idempotencyKey: 'image-reviewer-no-vision-fixture',
        images: [{ bytes: png, mimeType: 'image/png' }],
      })
    )[0]!;
    prepareReviewerAssignment(f, [
      {
        artifactName: 'review-image.png',
        contentRef: stored.contentRef,
        contentHash: stored.contentHash,
        mimeType: stored.mimeType,
        status: 'candidate',
      },
    ]);
    let providerCalls = 0;
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
    const scheduler = new Scheduler({
      store: f.orchestration,
      executor: productionExecutor(f, adapter, { generatedImageStore }),
      ownerId: 'production-image-reviewer-no-vision',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('failed');
      expect(providerCalls).toBe(0);
      expect(
        f.connection.raw
          .prepare('SELECT COUNT(*) AS count FROM provider_execution_reservation')
          .get(),
      ).toEqual({ count: 0 });
      const failed = f.connection.raw
        .prepare(
          "SELECT payload_json AS payloadJson FROM event WHERE type = 'step.failed' ORDER BY rowid DESC LIMIT 1",
        )
        .get() as { payloadJson: string };
      expect(JSON.parse(failed.payloadJson)).toMatchObject({ failureClass: 'acceptance' });
    } finally {
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('rejects a tampered Reviewer image before Provider reservation', async () => {
    const f = await seedProductionRun('sync-think-production-image-reviewer-tampered-');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 41, 42, 43]);
    const generatedImageStore = new GeneratedImageStore(
      join(f.dir, 'runtime-data', 'artifacts', 'generated-images'),
    );
    const stored = (
      await generatedImageStore.store({
        runId: f.graph.run.id,
        stepId: 'production-step',
        idempotencyKey: 'image-reviewer-tampered-fixture',
        images: [{ bytes: png, mimeType: 'image/png' }],
      })
    )[0]!;
    prepareReviewerAssignment(f, [
      {
        artifactName: 'review-image.png',
        contentRef: stored.contentRef,
        contentHash: stored.contentHash,
        mimeType: stored.mimeType,
        status: 'candidate',
      },
    ]);
    f.connection.raw
      .prepare('UPDATE model SET capabilities_json = \'["text","vision"]\' WHERE id = ?')
      .run(f.agent.defaultModelId);
    writeFileSync(
      stored.contentRef,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 99, 98, 97]),
    );
    let providerCalls = 0;
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
    const scheduler = new Scheduler({
      store: f.orchestration,
      executor: productionExecutor(f, adapter, { generatedImageStore }),
      ownerId: 'production-image-reviewer-tampered',
    });
    try {
      const result = await scheduler.runUntilIdle(f.graph.run.id);
      expect(result.graph.run.state).toBe('failed');
      expect(providerCalls).toBe(0);
      expect(
        f.connection.raw
          .prepare('SELECT COUNT(*) AS count FROM provider_execution_reservation')
          .get(),
      ).toEqual({ count: 0 });
      const failed = f.connection.raw
        .prepare(
          "SELECT payload_json AS payloadJson FROM event WHERE type = 'step.failed' ORDER BY rowid DESC LIMIT 1",
        )
        .get() as { payloadJson: string };
      expect(JSON.parse(failed.payloadJson)).toMatchObject({
        failureClass: 'acceptance',
        summary: expect.stringContaining('generated_image.hash_mismatch'),
      });
    } finally {
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('pauses for image selection and sends only the selected candidate to the Reviewer', async () => {
    const f = await seedProductionRun('sync-think-production-image-reviewer-selection-');
    const pngA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 51, 52, 53]);
    const pngB = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 61, 62, 63]);
    const generatedRoot = join(f.dir, 'runtime-data', 'artifacts', 'generated-images');
    const generatedImageStore = new GeneratedImageStore(generatedRoot);
    const stored = await generatedImageStore.store({
      runId: f.graph.run.id,
      stepId: 'production-step',
      idempotencyKey: 'image-reviewer-selection-fixture',
      images: [
        { bytes: pngA, mimeType: 'image/png' },
        { bytes: pngB, mimeType: 'image/png' },
      ],
    });
    const assignment = prepareReviewerAssignment(
      f,
      stored.map((image) => ({
        artifactName: 'review-image.png',
        artifactGroupKey: 'review-image-candidates',
        contentRef: image.contentRef,
        contentHash: image.contentHash,
        mimeType: image.mimeType,
        status: 'candidate' as const,
      })),
    );
    f.connection.raw
      .prepare('UPDATE model SET capabilities_json = \'["text","vision"]\' WHERE id = ?')
      .run(f.agent.defaultModelId);
    const selected = assignment.context.reviewedArtifactVersions.find(
      (version) => version.contentHash === stored[1]!.contentHash,
    )!;
    let providerCalls = 0;
    let capturedRequest: ProviderCallRequest | undefined;
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        providerCalls += 1;
        capturedRequest = request;
        yield {
          type: 'text-delta',
          text: JSON.stringify({
            verdict: 'accept',
            explanation: 'The selected candidate is complete.',
            criteria: assignment.context.criteria.map((criterion) => ({
              criterionId: criterion.id,
              verdict: 'pass',
              explanation: 'The selected candidate satisfies the criterion.',
            })),
            reviewedArtifactVersionIds: [selected.id],
          }),
        };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const scheduler = new Scheduler({
      store: f.orchestration,
      executor: productionExecutor(f, adapter, { generatedImageStore }),
      ownerId: 'production-image-reviewer-selection',
    });
    try {
      const paused = await scheduler.runUntilIdle(f.graph.run.id);
      expect(paused.graph.run.state).toBe('paused');
      expect(providerCalls).toBe(0);
      expect(paused.graph.steps.find((step) => step.id === assignment.reviewerStep.id)?.state).toBe(
        'ready',
      );

      new SqliteArtifactStore(f.connection.raw).selectVersion({
        operationId: 'select-production-review-image',
        artifactId: selected.artifactId,
        versionId: selected.id,
        expectedTaskVersion: 0,
        resultingTaskVersion: 1,
      });
      scheduler.resume(f.graph.run.id);
      const completed = await scheduler.runUntilIdle(f.graph.run.id);

      expect(completed.graph.run.state).toBe('completed');
      expect(providerCalls).toBe(1);
      const content = capturedRequest!.messages[0]!.content;
      expect(Array.isArray(content)).toBe(true);
      if (!Array.isArray(content)) throw new Error('Expected multimodal Reviewer content');
      expect(content.filter((part) => part.type === 'image')).toEqual([
        { type: 'image', imageUrl: `data:image/png;base64,${pngB.toString('base64')}` },
      ]);
      expect(content[0]!.text).toContain(selected.id);
      expect(content[0]!.text).not.toContain(stored[0]!.contentRef);
      expect(content[0]!.text).not.toContain(stored[1]!.contentRef);
    } finally {
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('runs bounded image reject, rework, reselection, and review-limit pause', async () => {
    const imageGeneration: ImageGenerationConfig = { size: '1024x1024', quality: 'high', count: 2 };
    const f = await seedProductionRun(
      'sync-think-production-image-rework-loop-',
      'openai-images',
      imageGeneration,
    );
    const reviewerHandle = await f.secureStore.storeSecret(PRODUCTION_SECRET_CANARY);
    const reviewerProvider = f.providerStore.createProvider({
      name: 'Production vision reviewer provider',
      baseUrl: 'https://reviewer.example/v1',
      protocol: 'openai-chat',
      supportsDiscovery: false,
      storeHandle: reviewerHandle,
    });
    const reviewerModel = f.providerStore.upsertModels({
      providerId: reviewerProvider.provider.id,
      protocol: 'openai-chat',
      models: [{ providerModelId: 'production-vision-reviewer' }],
    })[0]!;
    f.connection.raw
      .prepare('UPDATE model SET capabilities_json = \'["text","vision"]\' WHERE id = ?')
      .run(reviewerModel.id);
    const reviewer = new SqliteAgentStore(f.connection.raw).createAgent({
      name: 'Production image Reviewer',
      role: 'reviewer',
      developerInstructions: 'Return the required JSON review outcome.',
      inputContract: 'exact image and criteria',
      outputContract: 'structured review outcome JSON',
      defaultModelId: reviewerModel.id,
      defaultCredentialGroupId: reviewerProvider.credentialGroup.id,
    });
    const gate = f.orchestration.createAcceptanceGate({
      id: 'gate-production-image-rework' as never,
      runId: f.graph.run.id,
      targetStepId: 'production-step' as never,
      reviewerAgentVersionId: reviewer.id,
      maxIterations: 1,
      onLimitReached: 'pause',
      criteria: [{ id: 'criterion-production-image', description: 'Image is approved' }],
    });
    const imageBatches = [
      [
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 71, 72, 73]),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 74, 75, 76]),
      ],
      [
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 81, 82, 83]),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 84, 85, 86]),
      ],
    ];
    const imagePrompts: string[] = [];
    let imageCalls = 0;
    const imageAdapter: ProviderAdapter = {
      protocol: 'openai-images',
      async discoverModels() {
        return [];
      },
      call(): AsyncIterable<AdapterEvent> {
        throw new Error('conversation call must not run for image generation');
      },
      async generateImages(request) {
        imagePrompts.push(request.prompt);
        expect(request).toMatchObject(imageGeneration);
        const batch = imageBatches[imageCalls++]!;
        return { images: batch.map((bytes) => ({ bytes, mimeType: 'image/png' as const })) };
      },
    };
    const reviewRequests: ProviderCallRequest[] = [];
    const reviewAdapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        reviewRequests.push(request);
        const graph = f.orchestration.getGraph(f.graph.run.id)!;
        const running = graph.steps.find((step) => step.state === 'running')!;
        const context = f.orchestration.getReviewStepContext(graph.run.id, running.id);
        if (context?.kind !== 'reviewer') throw new Error('Reviewer context missing');
        yield {
          type: 'text-delta',
          text: JSON.stringify({
            verdict: 'reject',
            explanation: `Image revision ${context.iteration + 1} is required.`,
            criteria: context.criteria.map((criterion) => ({
              criterionId: criterion.id,
              verdict: 'fail',
              explanation: 'The image still needs refinement.',
            })),
            reviewedArtifactVersionIds: context.reviewedArtifactVersions.map(
              (version) => version.id,
            ),
          }),
        };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const generatedRoot = join(f.dir, 'runtime-data', 'artifacts', 'generated-images');
    const generatedImageStore = new GeneratedImageStore(generatedRoot);
    const scheduler = new Scheduler({
      store: f.orchestration,
      executor: productionExecutor(f, reviewAdapter, {
        adaptersByProtocol: {
          'openai-chat': reviewAdapter,
          'openai-images': imageAdapter,
        },
        generatedImageStore,
      }),
      ownerId: 'production-image-rework-loop',
    });
    const artifacts = new SqliteArtifactStore(f.connection.raw);
    try {
      const initialPause = await scheduler.runUntilIdle(f.graph.run.id);
      expect(initialPause.graph.run.state).toBe('paused');
      expect(imageCalls).toBe(1);
      expect(reviewRequests).toHaveLength(0);
      const initialVersions = f.orchestration.listRunArtifactVersions(f.graph.run.id);
      expect(initialVersions).toHaveLength(2);
      expect(new Set(initialVersions.map((version) => version.artifactId)).size).toBe(1);
      const initialSelected = initialVersions[1]!;
      artifacts.selectVersion({
        operationId: 'select-production-initial-image',
        artifactId: initialSelected.artifactId,
        versionId: initialSelected.id,
        expectedTaskVersion: 0,
        resultingTaskVersion: 1,
      });

      scheduler.resume(f.graph.run.id);
      const reworkPause = await scheduler.runUntilIdle(f.graph.run.id);
      expect(reworkPause.graph.run.state).toBe('paused');
      expect(imageCalls).toBe(2);
      expect(reviewRequests).toHaveLength(1);
      const reworkStep = reworkPause.graph.steps.find(
        (step) => f.orchestration.getReviewStepContext(f.graph.run.id, step.id)?.kind === 'rework',
      )!;
      expect(reworkStep.imageGeneration).toEqual(imageGeneration);
      const reworkVersions = f.orchestration
        .listRunArtifactVersions(f.graph.run.id)
        .filter((version) => version.parentVersionIds.length > 0);
      expect(reworkVersions).toHaveLength(2);
      expect(
        reworkVersions.every((version) => version.artifactId === initialSelected.artifactId),
      ).toBe(true);
      expect(
        reworkVersions.every((version) => version.parentVersionIds[0] === initialSelected.id),
      ).toBe(true);
      expect(imagePrompts[1]).toContain('Image revision 1 is required.');
      expect(imagePrompts[1]).toContain('criterion-production-image');
      expect(imagePrompts[1]).not.toContain(generatedRoot);
      expect(imagePrompts[1]).not.toContain(initialSelected.contentRef);

      const reworkSelected = reworkVersions[0]!;
      artifacts.selectVersion({
        operationId: 'select-production-reworked-image',
        artifactId: reworkSelected.artifactId,
        versionId: reworkSelected.id,
        expectedTaskVersion: 1,
        resultingTaskVersion: 2,
      });
      scheduler.resume(f.graph.run.id);
      const limited = await scheduler.runUntilIdle(f.graph.run.id);

      expect(limited.graph.run.state).toBe('paused');
      expect(f.orchestration.getAcceptanceGate(gate.id)?.state).toBe('limit-reached');
      expect(imageCalls).toBe(2);
      expect(reviewRequests).toHaveLength(2);
      expect(
        limited.graph.steps.filter(
          (step) =>
            f.orchestration.getReviewStepContext(f.graph.run.id, step.id)?.kind === 'rework',
        ),
      ).toHaveLength(1);
      const secondReviewContent = reviewRequests[1]!.messages[0]!.content;
      expect(Array.isArray(secondReviewContent)).toBe(true);
      if (!Array.isArray(secondReviewContent)) {
        throw new Error('Expected multimodal Reviewer content');
      }
      expect(secondReviewContent.filter((part) => part.type === 'image')).toEqual([
        {
          type: 'image',
          imageUrl: `data:image/png;base64,${imageBatches[1]![0]!.toString('base64')}`,
        },
      ]);
      expect(
        f.connection.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'review.limit-reached'")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('rejects an image Step before Provider reservation when the resolved model is text-only', async () => {
    const f = await seedProductionRun(
      'sync-think-production-image-protocol-fence-',
      'openai-chat',
      { size: 'auto', quality: 'auto', count: 1 },
    );
    let providerCalls = 0;
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call() {
        providerCalls += 1;
        yield { type: 'text-delta', text: 'text output' };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    try {
      const claim = f.orchestration.claimReadySteps({
        runId: f.graph.run.id,
        stepIds: ['production-step' as never],
        ownerId: 'owner-image-protocol-fence',
        leaseExpiresAt: '2099-07-14T00:00:10.000Z',
        now: '2099-07-14T00:00:01.000Z',
      }).claimedSteps[0]!;
      const executor = productionExecutor(f, adapter, {
        adaptersByProtocol: { 'openai-chat': adapter },
      });
      const context = {
        runId: f.graph.run.id,
        step: claim,
        idempotencyKey: claim.idempotencyKey!,
        artifactVersions: [],
        signal: new AbortController().signal,
      };

      await expect(executor.execute(context)).rejects.toMatchObject({
        failureClass: 'acceptance',
        message: 'Image generation Steps require a model with the openai-images protocol',
      });
      expect(providerCalls).toBe(0);
      expect(
        new SqliteProductionExecutionStore(f.connection.raw).getProviderExecution(
          claim.idempotencyKey!,
        ),
      ).toBeUndefined();
    } finally {
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('generates configured image candidates and replays them without a second Provider call', async () => {
    const imageGeneration: ImageGenerationConfig = {
      size: '1536x1024',
      quality: 'high',
      count: 3,
    };
    const f = await seedProductionRun(
      'sync-think-production-image-',
      'openai-images',
      imageGeneration,
    );
    let providerCalls = 0;
    let storeCalls = 0;
    const images = [
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 2]),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 3]),
    ];
    const storedImages = images.map((bytes, index) => ({
      contentRef: join(f.dir, 'artifacts', `generated-${index + 1}.png`),
      contentHash: String.fromCharCode(97 + index).repeat(64),
      mimeType: 'image/png' as const,
      byteLength: bytes.length,
    }));
    const adapter: ProviderAdapter = {
      protocol: 'openai-images',
      async discoverModels() {
        return [];
      },
      call(): AsyncIterable<AdapterEvent> {
        throw new Error('conversation call must not run for images');
      },
      async generateImages(request) {
        providerCalls += 1;
        expect(request).toMatchObject({
          protocol: 'openai-images',
          baseUrl: 'https://provider.example/v1',
          modelId: 'production-model',
          idempotencyKey: expect.any(String),
          prompt: expect.stringContaining('Call the provider exactly once'),
          size: '1536x1024',
          quality: 'high',
          count: 3,
        });
        expect(request.apiKey).toBe(PRODUCTION_SECRET_CANARY);
        return { images: images.map((bytes) => ({ bytes, mimeType: 'image/png' })) };
      },
    };
    try {
      const claim = f.orchestration.claimReadySteps({
        runId: f.graph.run.id,
        stepIds: ['production-step' as never],
        ownerId: 'owner-image',
        leaseExpiresAt: '2099-07-14T00:00:10.000Z',
        now: '2099-07-14T00:00:01.000Z',
      }).claimedSteps[0]!;
      expect(claim.imageGeneration).toEqual(imageGeneration);
      const executor = productionExecutor(f, adapter, {
        adaptersByProtocol: { 'openai-images': adapter },
        generatedImageStore: {
          async store(input) {
            storeCalls += 1;
            expect(input.images.map((image) => image.bytes)).toEqual(images);
            return storedImages;
          },
        },
      });
      const context = {
        runId: f.graph.run.id,
        step: claim,
        idempotencyKey: claim.idempotencyKey!,
        artifactVersions: [],
        signal: new AbortController().signal,
      };

      const first = await executor.execute(context);
      const replay = await executor.execute(context);

      expect(first).toEqual(replay);
      expect(first.outputVersions).toHaveLength(3);
      expect(first.outputVersions).toEqual(
        storedImages.map((stored, index) =>
          expect.objectContaining({
            artifactName: 'Generated image production-step',
            artifactGroupKey: 'image-generation:production-step',
            contentRef: stored.contentRef,
            contentHash: stored.contentHash,
            mimeType: 'image/png',
            status: 'candidate',
            metadata: expect.objectContaining({
              executionKind: 'image-generation',
              generationKind: 'image',
              imageIndex: index,
              imageCount: 3,
              imageSize: '1536x1024',
              imageQuality: 'high',
              requestedImageCount: 3,
              byteLength: images[index]!.length,
            }),
          }),
        ),
      );
      expect(providerCalls).toBe(1);
      expect(storeCalls).toBe(1);
      const reservation = new SqliteProductionExecutionStore(f.connection.raw).getProviderExecution(
        claim.idempotencyKey!,
      );
      expect(reservation).toMatchObject({ state: 'completed' });
      const persisted = JSON.stringify(reservation);
      expect(persisted).not.toContain(PRODUCTION_SECRET_CANARY);
      for (const image of images) expect(persisted).not.toContain(image.toString('base64'));
    } finally {
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });
  it('loads only each automated Step AgentVersion Skills and records the exact IDs', async () => {
    const f = await seedProductionRun('sync-think-production-agent-skills-');
    const skillStore = new SqliteSkillStore(f.connection.raw);
    const skillA = skillStore.importVersion({
      name: 'Agent A Skill',
      description: 'Only Agent A uses this',
      version: '1.0.0',
      sourceMd: 'SKILL_A_SOURCE',
      body: 'SKILL_A_BODY',
      contentFingerprint: 'production-agent-skill-a',
    });
    const skillB = skillStore.importVersion({
      name: 'Agent B Skill',
      description: 'Only Agent B uses this',
      version: '2.0.0',
      sourceMd: 'SKILL_B_SOURCE',
      body: 'SKILL_B_BODY',
      contentFingerprint: 'production-agent-skill-b',
    });
    const agentStore = new SqliteAgentStore(f.connection.raw);
    const agentA = agentStore.createAgent({
      name: 'Team member A',
      role: 'worker',
      developerInstructions: 'Execute as member A.',
      inputContract: 'step instructions',
      outputContract: 'text artifact',
      defaultModelId: f.agent.defaultModelId,
      defaultCredentialGroupId: f.agent.defaultCredentialGroupId,
      skillVersionIds: [skillA.id],
    });
    const agentB = agentStore.createAgent({
      name: 'Team member B',
      role: 'worker',
      developerInstructions: 'Execute as member B.',
      inputContract: 'step instructions',
      outputContract: 'text artifact',
      defaultModelId: f.agent.defaultModelId,
      defaultCredentialGroupId: f.agent.defaultCredentialGroupId,
      skillVersionIds: [skillB.id],
    });
    const plan = f.orchestration.createPlanDraft({
      taskId: 'task-production' as never,
      title: 'Member Skill isolation',
      steps: [
        {
          id: 'member-step-a' as never,
          title: 'Member A',
          instructions: 'Run member A',
          agentVersionId: agentA.id,
          dependsOn: [],
        },
        {
          id: 'member-step-b' as never,
          title: 'Member B',
          instructions: 'Run member B',
          agentVersionId: agentB.id,
          dependsOn: [],
        },
      ],
      now: '2026-07-29T01:00:00.000Z',
    });
    const graph = f.orchestration.approvePlan({
      planId: plan.planId,
      revision: plan.revision,
      now: '2026-07-29T01:00:01.000Z',
    });
    const requests: Parameters<ProviderAdapter['call']>[0][] = [];
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        requests.push(request);
        yield { type: 'text-delta', text: `output-${requests.length}` };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const claimed = f.orchestration.claimReadySteps({
      runId: graph.run.id,
      stepIds: ['member-step-a' as never, 'member-step-b' as never],
      ownerId: 'member-skill-owner',
      leaseExpiresAt: '9999-12-31T23:59:59.999Z',
    }).claimedSteps;

    try {
      const executor = productionExecutor(f, adapter);
      const results = [];
      for (const step of claimed) {
        results.push({
          step,
          result: await executor.execute({
            runId: graph.run.id,
            step,
            idempotencyKey: step.idempotencyKey!,
            artifactVersions: [],
            signal: new AbortController().signal,
          }),
        });
      }

      const requestA = requests.find((request) =>
        (request.systemPrompt ?? '').includes('member A'),
      )!;
      const requestB = requests.find((request) =>
        (request.systemPrompt ?? '').includes('member B'),
      )!;
      expect(requestA.systemPrompt ?? '').toContain('SKILL_A_BODY');
      expect(requestA.systemPrompt ?? '').not.toContain('SKILL_B_BODY');
      expect(requestA.systemPrompt ?? '').not.toContain('SKILL_A_SOURCE');
      expect(requestB.systemPrompt ?? '').toContain('SKILL_B_BODY');
      expect(requestB.systemPrompt ?? '').not.toContain('SKILL_A_BODY');
      expect(requestB.systemPrompt ?? '').not.toContain('SKILL_B_SOURCE');

      const resultA = results.find((entry) => entry.step.agentVersionId === agentA.id)!.result;
      const resultB = results.find((entry) => entry.step.agentVersionId === agentB.id)!.result;
      expect(resultA.outputVersions?.[0]?.metadata).toMatchObject({
        agentVersionId: agentA.id,
        skillVersionIds: [skillA.id],
      });
      expect(resultB.outputVersions?.[0]?.metadata).toMatchObject({
        agentVersionId: agentB.id,
        skillVersionIds: [skillB.id],
      });
    } finally {
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('rejects missing, archived, or unapproved automated Step Skills before Provider calls', async () => {
    const f = await seedProductionRun('sync-think-production-invalid-agent-skills-');
    const skillStore = new SqliteSkillStore(f.connection.raw);
    const archived = skillStore.importVersion({
      name: 'Archived Skill',
      description: '',
      version: '1.0.0',
      sourceMd: 'ARCHIVED_SOURCE',
      body: 'ARCHIVED_BODY',
      contentFingerprint: 'production-archived-skill',
    });
    expect(skillStore.deleteVersion(archived.id).deleted).toBe(true);
    const unapproved = skillStore.importVersion({
      name: 'Unapproved Skill',
      description: '',
      version: '1.0.0',
      sourceMd: 'UNAPPROVED_SOURCE',
      body: 'UNAPPROVED_BODY',
      contentFingerprint: 'production-unapproved-skill',
    });
    new SqliteApprovalStore(f.connection.raw).enqueue({
      workspaceId: 'workspace-production' as never,
      kind: 'skill-permission',
      action: 'skill.permission-upgrade:test',
      metadata: { skillVersionId: unapproved.id },
    });
    const agentStore = new SqliteAgentStore(f.connection.raw);
    const invalidAgents = [
      { label: 'missing', skillVersionId: 'missing-skill-version' },
      { label: 'archived', skillVersionId: archived.id },
      { label: 'unapproved', skillVersionId: unapproved.id },
    ].map(({ label, skillVersionId }) => ({
      label,
      agent: agentStore.createAgent({
        name: `Invalid ${label} Agent`,
        role: 'worker',
        developerInstructions: `Execute ${label}.`,
        inputContract: 'step instructions',
        outputContract: 'text artifact',
        defaultModelId: f.agent.defaultModelId,
        defaultCredentialGroupId: f.agent.defaultCredentialGroupId,
        skillVersionIds: [skillVersionId],
      }),
    }));
    const plan = f.orchestration.createPlanDraft({
      taskId: 'task-production' as never,
      title: 'Invalid member Skills',
      steps: invalidAgents.map(({ label, agent }) => ({
        id: `invalid-${label}-step` as never,
        title: `Invalid ${label}`,
        instructions: `Run ${label}`,
        agentVersionId: agent.id,
        dependsOn: [],
      })),
      now: '2026-07-29T02:00:00.000Z',
    });
    const graph = f.orchestration.approvePlan({
      planId: plan.planId,
      revision: plan.revision,
      now: '2026-07-29T02:00:01.000Z',
    });
    let providerCalls = 0;
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(): AsyncIterable<AdapterEvent> {
        providerCalls += 1;
        yield { type: 'text-delta', text: 'must not run' };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const claimed = f.orchestration.claimReadySteps({
      runId: graph.run.id,
      stepIds: invalidAgents.map(({ label }) => `invalid-${label}-step` as never),
      ownerId: 'invalid-member-skill-owner',
      leaseExpiresAt: '9999-12-31T23:59:59.999Z',
    }).claimedSteps;

    try {
      const executor = productionExecutor(f, adapter);
      for (const step of claimed) {
        await expect(
          executor.execute({
            runId: graph.run.id,
            step,
            idempotencyKey: step.idempotencyKey!,
            artifactVersions: [],
            signal: new AbortController().signal,
          }),
        ).rejects.toThrow(/Skill version/);
      }
      expect(providerCalls).toBe(0);
    } finally {
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('executes approved workspace tools across Provider turns and persists an inspectable trace artifact', async () => {
    const f = await seedProductionRun('sync-think-production-tools-');
    f.connection.raw
      .prepare('UPDATE workspace SET folder_path = ? WHERE id = ?')
      .run(f.dir, 'workspace-production');
    f.connection.raw
      .prepare('UPDATE model SET capabilities_json = ? WHERE id = ?')
      .run(JSON.stringify(['text', 'tool-calling']), f.agent.defaultModelId);
    execFileSync('git', ['init', '--quiet'], { cwd: f.dir });
    execFileSync('git', ['config', 'user.email', 'sync-think@example.invalid'], { cwd: f.dir });
    execFileSync('git', ['config', 'user.name', 'SYNC-THINK Test'], { cwd: f.dir });
    writeFileSync(join(f.dir, 'input.txt'), 'workspace input', 'utf8');
    writeFileSync(join(f.dir, 'tracked.txt'), 'before\n', 'utf8');
    execFileSync('git', ['add', 'input.txt', 'tracked.txt'], { cwd: f.dir });
    execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: f.dir });

    const calls = [
      { name: 'read_file', arguments: { path: 'input.txt' } },
      { name: 'write_file', arguments: { path: 'tracked.txt', content: 'after\n' } },
      {
        name: 'run_command',
        arguments: {
          command: process.execPath,
          args: ['-e', "process.stdout.write('command-ok')"],
        },
      },
      { name: 'git_status', arguments: {} },
      { name: 'git_diff', arguments: { path: 'tracked.txt' } },
    ] as const;
    const requests: Parameters<ProviderAdapter['call']>[0][] = [];
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        requests.push(request);
        const requestNumber = requests.length;
        yield {
          type: 'usage',
          tokensIn: requestNumber * 10,
          tokensOut: requestNumber * 2,
          cachedTokensHit: requestNumber * 3,
          cachedTokensCreated: requestNumber,
          reasoningTokens: requestNumber * 2,
          totalTokens: requestNumber * 12,
        };
        const call = calls[requestNumber - 1];
        if (call) {
          yield {
            type: 'tool-call',
            toolCall: {
              id: `tool-call-${requests.length}`,
              name: call.name,
              argumentsJson: JSON.stringify(call.arguments),
            },
          };
          yield { type: 'finished', reason: 'tool-requests' };
          return;
        }
        yield { type: 'text-delta', text: 'Workspace tools completed successfully.' };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const claimed = f.orchestration.claimReadySteps({
      runId: f.graph.run.id,
      stepIds: ['production-step' as never],
      ownerId: 'production-tool-owner',
      leaseExpiresAt: '9999-12-31T23:59:59.999Z',
    }).claimedSteps[0]!;
    const gatedActions: string[] = [];

    try {
      const result = await productionExecutor(f, adapter).execute({
        runId: f.graph.run.id,
        step: claimed,
        idempotencyKey: claimed.idempotencyKey!,
        artifactVersions: [],
        signal: new AbortController().signal,
        async gateAction(request) {
          gatedActions.push(request.action);
          return { allowed: true, actionDigest: 'a'.repeat(64) };
        },
      });

      expect(requests).toHaveLength(6);
      expect(requests[0]!.tools?.map((tool) => tool.name)).toEqual([
        'read_file',
        'list_files',
        'write_file',
        'run_command',
        'git_status',
        'git_diff',
      ]);
      expect(
        requests
          .slice(1)
          .every((request) => request.messages.some((message) => message.role === 'tool')),
      ).toBe(true);
      expect(gatedActions).toEqual(calls.map((call) => `tool.${call.name}`));
      expect(readFileSync(join(f.dir, 'tracked.txt'), 'utf8')).toBe('after\n');
      expect(result.providerUsages).toHaveLength(6);
      expect(result.providerUsages?.[0]).toMatchObject({
        requestId: requests[0]!.idempotencyKey,
        taskId: 'task-production',
        runId: f.graph.run.id,
        stepId: 'production-step',
        providerId: f.providerStore.getModel(f.agent.defaultModelId)!.providerId,
        modelId: f.agent.defaultModelId,
        providerModelId: 'production-model',
        purpose: 'normal',
        tokensIn: 10,
        tokensOut: 2,
        cachedTokensHit: 3,
        cachedTokensCreated: 1,
        reasoningTokens: 2,
        totalTokens: 12,
      });
      expect(result.providerUsages?.[5]).toMatchObject({
        requestId: requests[5]!.idempotencyKey,
        tokensIn: 60,
        tokensOut: 12,
        totalTokens: 72,
      });
      expect(result.outputVersions).toHaveLength(2);
      expect(result.outputVersions?.[0]).toMatchObject({
        content: 'Workspace tools completed successfully.',
      });
      expect(result.outputVersions?.[1]).toMatchObject({
        mimeType: 'application/json',
        status: 'candidate',
      });
      const trace = JSON.parse(result.outputVersions?.[1]!.content ?? '{}') as {
        calls?: Array<{ name: string; result: string }>;
      };
      expect(trace.calls?.map((entry) => entry.name)).toEqual(calls.map((call) => call.name));
      expect(trace.calls?.find((entry) => entry.name === 'read_file')?.result).toContain(
        'workspace input',
      );
      expect(trace.calls?.find((entry) => entry.name === 'run_command')?.result).toContain(
        'command-ok',
      );
      expect(trace.calls?.find((entry) => entry.name === 'git_diff')?.result).toContain('+after');
      expect(
        new SqliteProductionExecutionStore(f.connection.raw).getProviderExecution(
          claimed.idempotencyKey!,
        ),
      ).toMatchObject({ state: 'completed' });
    } finally {
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  }, 30_000);

  it('executes Browser Worker tools with the frozen AgentVersion permission snapshot and persists Step audit metadata', async () => {
    const f = await seedProductionRun('sync-think-production-browser-tools-');
    f.connection.raw
      .prepare('UPDATE workspace SET folder_path = ? WHERE id = ?')
      .run(f.dir, 'workspace-production');
    f.connection.raw
      .prepare('UPDATE model SET capabilities_json = ? WHERE id = ?')
      .run(JSON.stringify(['text', 'tool-calling']), f.agent.defaultModelId);
    f.connection.raw.prepare('UPDATE agent_version SET permissions_json = ? WHERE id = ?').run(
      JSON.stringify({
        file: [],
        command: [],
        browser: ['https://example.test'],
        desktop: [],
        network: [],
      }),
      f.agent.id,
    );

    const browserCalls: Array<{ input: BrowserWorkerInput; token: WorkerToken }> = [];
    const browserWorker: BrowserWorker = {
      kind: 'browser',
      async *exec(input, token): AsyncIterable<WorkerEvent> {
        browserCalls.push({ input, token });
        yield {
          type: 'completed',
          output: {
            ok: true,
            message: 'Browser action completed',
            profileId: 'default',
            leaseId: `lease:${input.ownerId}`,
            pageId: `page:${input.ownerId}`,
            url: 'https://example.test/dashboard',
            title: 'Dashboard',
          },
        };
      },
    };
    const browserStore = new SqliteBrowserStore(f.connection.raw);
    const browserController = new RuntimeBrowserController({
      worker: browserWorker,
      store: browserStore,
      profileId: 'default',
      fallbackWorkingDir: f.dir,
    });
    const requests: Parameters<ProviderAdapter['call']>[0][] = [];
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        requests.push(request);
        if (requests.length === 1) {
          expect(request.tools?.map((tool) => tool.name)).toEqual(
            expect.arrayContaining([
              'browser_open',
              'browser_click',
              'browser_type',
              'browser_read',
              'browser_screenshot',
            ]),
          );
          yield {
            type: 'tool-call',
            toolCall: {
              id: 'browser-open-call',
              name: 'browser_open',
              argumentsJson: JSON.stringify({ url: 'https://example.test/dashboard' }),
            },
          };
          yield { type: 'finished', reason: 'tool-requests' };
          return;
        }
        yield { type: 'text-delta', text: 'Browser automation completed.' };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const claimed = f.orchestration.claimReadySteps({
      runId: f.graph.run.id,
      stepIds: ['production-step' as never],
      ownerId: 'production-browser-owner',
      leaseExpiresAt: '9999-12-31T23:59:59.999Z',
    }).claimedSteps[0]!;

    try {
      const result = await productionExecutor(f, adapter, { browserController }).execute({
        runId: f.graph.run.id,
        step: claimed,
        idempotencyKey: claimed.idempotencyKey!,
        artifactVersions: [],
        signal: new AbortController().signal,
        gateAction: async () => ({ allowed: true, actionDigest: 'a'.repeat(64) }),
      });

      const expectedOwner = `step:${f.graph.run.id}:production-step:${f.agent.id}`;
      expect(browserCalls).toHaveLength(1);
      expect(browserCalls[0]?.input).toMatchObject({
        ownerId: expectedOwner,
        profileId: 'default',
        allowedSites: ['https://example.test'],
        action: { kind: 'navigate', url: 'https://example.test/dashboard' },
      });
      const command = browserStore.getCommandByIdempotencyKey(
        `browser:${f.graph.run.id}:production-step:browser-open-call`,
      );
      expect(command).toMatchObject({
        state: 'completed',
        ownerId: expectedOwner,
        profileId: 'default',
        leaseId: `lease:${expectedOwner}`,
        targetOrigin: 'https://example.test',
      });
      expect(
        browserStore.resolveOriginDecision({
          scopes: [{ scopeType: 'agent-version', scopeId: f.agent.id }],
          origin: 'https://example.test',
          action: 'navigate',
        }),
      ).toMatchObject({ decision: 'allow' });

      const outputArtifact = result.outputVersions?.find(
        (output) => output.metadata?.executionKind === 'ordinary',
      );
      const traceArtifact = result.outputVersions?.find(
        (output) => output.metadata?.executionKind === 'tool-trace',
      );
      expect(outputArtifact?.metadata).toMatchObject({
        agentVersionId: f.agent.id,
        browserCommands: [
          {
            agentVersionId: f.agent.id,
            stepId: 'production-step',
            ownerId: expectedOwner,
            profileId: 'default',
            leaseId: `lease:${expectedOwner}`,
            origin: 'https://example.test',
            commandId: command?.id,
          },
        ],
      });
      expect(traceArtifact?.metadata).toMatchObject({
        agentVersionId: f.agent.id,
        browserCommands: outputArtifact?.metadata?.browserCommands,
      });
      expect(JSON.parse(traceArtifact?.content ?? '{}')).toMatchObject({
        calls: [
          {
            id: 'browser-open-call',
            name: 'browser_open',
            metadata: {
              agentVersionId: f.agent.id,
              stepId: 'production-step',
              ownerId: expectedOwner,
              profileId: 'default',
              leaseId: `lease:${expectedOwner}`,
              origin: 'https://example.test',
              commandId: command?.id,
            },
          },
        ],
      });
    } finally {
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('resumes a durable browser_handoff checkpoint after Runtime reconstruction without replaying browser_open', async () => {
    const f = await seedProductionRun('sync-think-production-browser-handoff-');
    f.connection.raw
      .prepare('UPDATE workspace SET folder_path = ? WHERE id = ?')
      .run(f.dir, 'workspace-production');
    f.connection.raw
      .prepare('UPDATE model SET capabilities_json = ? WHERE id = ?')
      .run(JSON.stringify(['text', 'tool-calling']), f.agent.defaultModelId);
    f.connection.raw.prepare('UPDATE agent_version SET permissions_json = ? WHERE id = ?').run(
      JSON.stringify({
        file: [],
        command: [],
        browser: ['https://example.test'],
        desktop: [],
        network: [],
      }),
      f.agent.id,
    );

    const expectedOwner = `step:${f.graph.run.id}:production-step:${f.agent.id}`;
    const leaseId = `lease:${expectedOwner}`;
    const pageId = `page:${expectedOwner}`;
    const browserCalls: BrowserWorkerInput[] = [];
    const browserWorker: BrowserWorker = {
      kind: 'browser',
      async *exec(input): AsyncIterable<WorkerEvent> {
        browserCalls.push(input);
        yield {
          type: 'completed',
          output: {
            ok: true,
            message: 'Browser action completed',
            profileId: 'default',
            leaseId,
            pageId,
            url: 'https://example.test/sign-in',
            title: 'Sign in',
          },
        };
      },
    };
    const releasedLeases: string[] = [];
    const leaseHost: Pick<BrowserHostLike, 'inspectLease' | 'releaseLease'> = {
      async inspectLease(requestedLeaseId) {
        expect(requestedLeaseId).toBe(leaseId);
        return { leaseId, pageId, profileId: 'default', ownerId: expectedOwner };
      },
      async releaseLease(requestedLeaseId) {
        releasedLeases.push(requestedLeaseId);
      },
    };
    const browserStore = new SqliteBrowserStore(f.connection.raw);
    const makeController = () =>
      new RuntimeBrowserController({
        worker: browserWorker,
        store: browserStore,
        profileId: 'default',
        fallbackWorkingDir: f.dir,
        leaseHost,
      });

    const requests: Parameters<ProviderAdapter['call']>[0][] = [];
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        requests.push(request);
        if (requests.length === 1) {
          expect(request.tools?.map((tool) => tool.name)).toContain('browser_handoff');
          yield {
            type: 'tool-call',
            toolCall: {
              id: 'handoff-open-call',
              name: 'browser_open',
              argumentsJson: JSON.stringify({ url: 'https://example.test/sign-in' }),
            },
          };
          yield {
            type: 'tool-call',
            toolCall: {
              id: 'handoff-user-call',
              name: 'browser_handoff',
              argumentsJson: JSON.stringify({
                reason: 'login',
                requestedOutcome: 'Sign in and leave the account dashboard visible.',
                onCancel: 'keep-open',
              }),
            },
          };
          yield { type: 'finished', reason: 'tool-requests' };
          return;
        }
        const toolMessages = request.messages.filter((message) => message.role === 'tool');
        expect(toolMessages).toHaveLength(2);
        expect(toolMessages[0]).toMatchObject({ toolCallId: 'handoff-open-call' });
        expect(toolMessages[1]).toMatchObject({ toolCallId: 'handoff-user-call' });
        expect(JSON.parse(String(toolMessages[1]!.content))).toMatchObject({
          ok: true,
          status: 'continued',
          siteOrigin: 'https://example.test',
        });
        yield { type: 'text-delta', text: 'The signed-in browser workflow completed.' };
        yield { type: 'finished', reason: 'stop' };
      },
    };

    const approvalStore = new SqliteApprovalStore(f.connection.raw);
    const schedulerOptions = (browserController: RuntimeBrowserController) => ({
      store: f.orchestration,
      executor: productionExecutor(f, adapter, { browserController }),
      approvalStore,
      unitOfWork: new SqliteUnitOfWork(f.connection.raw),
      approvalPolicy: {
        evaluate() {
          return {
            workspaceId: 'workspace-production' as never,
            taskId: 'task-production' as never,
            gate: 'auto-approve' as const,
            humanOnly: false,
            mode: 'full' as const,
            reason: 'test auto-approves ordinary tools',
            labelZh: '\u6d4b\u8bd5\u81ea\u52a8\u6279\u51c6',
          };
        },
      },
      ownerId: 'production-browser-handoff-owner',
    });
    const firstController = makeController();
    const firstScheduler = new Scheduler(schedulerOptions(firstController));
    let recoveryScheduler: Scheduler | undefined;

    try {
      const waitingGraph = await firstScheduler.tick(f.graph.run.id);
      expect(waitingGraph.graph.run.state).toBe('awaitingToolApproval');
      expect(waitingGraph.graph.steps[0]).toMatchObject({ state: 'awaitingApproval' });
      expect(requests).toHaveLength(1);
      expect(browserCalls).toHaveLength(1);

      const waiting = firstController.listWaitingHandoffs({ runId: f.graph.run.id });
      expect(waiting).toHaveLength(1);
      expect(waiting[0]).toMatchObject({
        runId: f.graph.run.id,
        stepId: 'production-step',
        agentVersionId: f.agent.id,
        siteOrigin: 'https://example.test',
        reason: 'login',
        status: 'waiting_user',
      });
      const approval = approvalStore.list({
        workspaceId: 'workspace-production' as never,
        state: 'pending',
      });
      expect(approval).toHaveLength(1);
      expect(approval[0]).toMatchObject({ action: 'browser.handoff', kind: 'human-only' });
      expect(approval[0]?.metadata.actionDetails).toMatchObject({
        handoffId: waiting[0]!.handoffId,
        revision: 1,
      });

      const checkpointRow = f.connection.raw
        .prepare(
          `SELECT r.state, c.checkpoint_json AS checkpointJson
           FROM provider_execution_reservation r
           JOIN provider_execution_checkpoint c ON c.idempotency_key = r.idempotency_key`,
        )
        .get() as { state: string; checkpointJson: string };
      const checkpoint = JSON.parse(checkpointRow.checkpointJson) as {
        value: {
          trace: Array<{ name: string }>;
          pending: { state: string; toolCall: { name: string } };
        };
      };
      expect(checkpointRow.state).toBe('released');
      expect(checkpoint.value.trace).toMatchObject([{ name: 'browser_open' }]);
      expect(checkpoint.value.pending).toMatchObject({
        state: 'waiting-user',
        toolCall: { name: 'browser_handoff' },
      });

      await firstScheduler.shutdown();
      const recoveredController = makeController();
      recoveryScheduler = new Scheduler(schedulerOptions(recoveredController));
      await expect(
        recoveredController.continueHandoff({
          handoffId: waiting[0]!.handoffId,
          expectedRevision: waiting[0]!.revision,
        }),
      ).resolves.toMatchObject({ status: 'continued', replayed: false });
      recoveryScheduler.decideApproval({
        approvalId: approval[0]!.id,
        decision: 'approved',
        decidedBy: 'human',
      });

      const completed = await recoveryScheduler.runUntilIdle(f.graph.run.id);
      expect(completed.graph.run.state).toBe('completed');
      expect(requests).toHaveLength(2);
      expect(browserCalls).toHaveLength(1);
      expect(releasedLeases).toHaveLength(0);
      expect(browserStore.getCommand(waiting[0]!.handoffId)).toMatchObject({
        state: 'completed',
        toolName: 'browser_handoff',
      });
      expect(f.orchestration.listRunArtifactVersions(f.graph.run.id)).toHaveLength(2);
    } finally {
      await recoveryScheduler?.shutdown();
      await firstScheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('fails safely when a Provider exceeds the bounded tool-call loop', async () => {
    const f = await seedProductionRun('sync-think-production-tool-limit-');
    f.connection.raw
      .prepare('UPDATE workspace SET folder_path = ? WHERE id = ?')
      .run(f.dir, 'workspace-production');
    f.connection.raw
      .prepare('UPDATE model SET capabilities_json = ? WHERE id = ?')
      .run(JSON.stringify(['text', 'tool-calling']), f.agent.defaultModelId);
    let providerCalls = 0;
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(): AsyncIterable<AdapterEvent> {
        providerCalls += 1;
        yield {
          type: 'tool-call',
          toolCall: {
            id: `loop-${providerCalls}`,
            name: 'list_files',
            argumentsJson: '{}',
          },
        };
        yield { type: 'finished', reason: 'tool-requests' };
      },
    };
    const claimed = f.orchestration.claimReadySteps({
      runId: f.graph.run.id,
      stepIds: ['production-step' as never],
      ownerId: 'production-tool-limit-owner',
      leaseExpiresAt: '9999-12-31T23:59:59.999Z',
    }).claimedSteps[0]!;

    try {
      await expect(
        productionExecutor(f, adapter).execute({
          runId: f.graph.run.id,
          step: claimed,
          idempotencyKey: claimed.idempotencyKey!,
          artifactVersions: [],
          signal: new AbortController().signal,
          async gateAction() {
            return { allowed: true, actionDigest: 'b'.repeat(64) };
          },
        }),
      ).rejects.toMatchObject({ failureClass: 'acceptance' });
      expect(providerCalls).toBe(8);
    } finally {
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('resumes one checkpointed tool call after human approval without repeating the Provider request', async () => {
    const f = await seedProductionRun('sync-think-production-tool-approval-');
    f.connection.raw
      .prepare('UPDATE workspace SET folder_path = ? WHERE id = ?')
      .run(f.dir, 'workspace-production');
    f.connection.raw
      .prepare('UPDATE model SET capabilities_json = ? WHERE id = ?')
      .run(JSON.stringify(['text', 'tool-calling']), f.agent.defaultModelId);
    writeFileSync(join(f.dir, 'approved.txt'), 'approved content', 'utf8');
    let providerCalls = 0;
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        providerCalls += 1;
        if (!request.messages.some((message) => message.role === 'tool')) {
          yield {
            type: 'tool-call',
            toolCall: {
              id: 'approval-read-call',
              name: 'read_file',
              argumentsJson: '{"path":"approved.txt"}',
            },
          };
          yield { type: 'finished', reason: 'tool-requests' };
          return;
        }
        yield { type: 'text-delta', text: 'Approved tool result consumed.' };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const approvalStore = new SqliteApprovalStore(f.connection.raw);
    const scheduler = new Scheduler({
      store: f.orchestration,
      executor: productionExecutor(f, adapter),
      approvalStore,
      unitOfWork: new SqliteUnitOfWork(f.connection.raw),
      approvalPolicy: {
        evaluate() {
          return {
            workspaceId: 'workspace-production' as never,
            taskId: 'task-production' as never,
            gate: 'require-human' as const,
            humanOnly: false,
            mode: 'request' as const,
            reason: 'test requires a human',
            labelZh: 'human approval required',
          };
        },
      },
      ownerId: 'production-tool-approval-owner',
    });

    try {
      await scheduler.tick(f.graph.run.id);
      expect(providerCalls).toBe(1);
      expect(f.orchestration.getGraph(f.graph.run.id)!.steps[0]!.state).toBe('awaitingApproval');
      const pending = approvalStore.list({
        workspaceId: 'workspace-production' as never,
        state: 'pending',
      });
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ action: 'tool.read_file' });
      expect(
        f.connection.raw
          .prepare(
            `SELECT r.state, c.checkpoint_json AS checkpointJson
             FROM provider_execution_reservation r
             JOIN provider_execution_checkpoint c ON c.idempotency_key = r.idempotency_key`,
          )
          .get(),
      ).toMatchObject({ state: 'released' });

      scheduler.decideApproval({
        approvalId: pending[0]!.id,
        decision: 'approved',
        decidedBy: 'human',
      });
      const completed = await scheduler.runUntilIdle(f.graph.run.id);
      expect(completed.graph.run.state).toBe('completed');
      expect(providerCalls).toBe(2);
      expect(f.orchestration.listRunArtifactVersions(f.graph.run.id)).toHaveLength(2);
    } finally {
      await scheduler.shutdown();
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

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
        yield* [];
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
        skillStore: new SqliteSkillStore(f.connection.raw),
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

  it('resolves the Agent default model through resolveModelBinding (not a local ?? shortcut)', async () => {
    const f = await seedProductionRun('sync-think-production-binding-default-');
    const requestedModelIds: string[] = [];
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        requestedModelIds.push(request.modelId);
        yield { type: 'text-delta', text: 'binding-default-ok' };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const claimed = f.orchestration.claimReadySteps({
      runId: f.graph.run.id,
      stepIds: ['production-step' as never],
      ownerId: 'production-binding-default',
      leaseExpiresAt: '9999-12-31T23:59:59.999Z',
    }).claimedSteps[0]!;
    try {
      const result = await productionExecutor(f, adapter).execute({
        runId: f.graph.run.id,
        step: claimed,
        idempotencyKey: claimed.idempotencyKey!,
        artifactVersions: [],
        signal: new AbortController().signal,
      });
      expect(requestedModelIds).toEqual(['production-model']);
      expect(result.outputVersions?.[0]).toMatchObject({
        content: 'binding-default-ok',
        metadata: {
          modelId: f.agent.defaultModelId,
          modelResolutionSource: 'agentDefault',
        },
      });
    } finally {
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('walks Agent fallbackModelIds after a retryable Provider failure', async () => {
    const f = await seedProductionRun('sync-think-production-binding-fallback-');
    const fallbackModel = f.providerStore.upsertModels({
      providerId: f.providerStore.listProviders()[0]!.provider.id,
      protocol: 'openai-chat',
      models: [{ providerModelId: 'production-fallback-model' }],
    })[0]!;
    // Rewrite the agent version row so fallback chain is non-empty.
    f.connection.raw
      .prepare(
        `UPDATE agent_version
         SET fallback_model_ids_json = ?, pause_on_failure = 1
         WHERE id = ?`,
      )
      .run(JSON.stringify([fallbackModel.id]), f.agent.id);

    const requestedModelIds: string[] = [];
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        requestedModelIds.push(request.modelId);
        if (request.modelId === 'production-model') {
          throw Object.assign(new Error('primary model rate limited'), {
            failureClass: 'rate-limit',
          });
        }
        yield { type: 'text-delta', text: 'fallback-model-ok' };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const claimed = f.orchestration.claimReadySteps({
      runId: f.graph.run.id,
      stepIds: ['production-step' as never],
      ownerId: 'production-binding-fallback',
      leaseExpiresAt: '9999-12-31T23:59:59.999Z',
    }).claimedSteps[0]!;
    try {
      const result = await productionExecutor(f, adapter).execute({
        runId: f.graph.run.id,
        step: claimed,
        idempotencyKey: claimed.idempotencyKey!,
        artifactVersions: [],
        signal: new AbortController().signal,
      });
      expect(requestedModelIds).toEqual(['production-model', 'production-fallback-model']);
      expect(result.outputVersions?.[0]).toMatchObject({
        content: 'fallback-model-ok',
        metadata: {
          modelId: fallbackModel.id,
          modelResolutionSource: 'agentFallback',
        },
      });
    } finally {
      f.secureStore.shutdown();
      f.connection.raw.close();
    }
  });

  it('pauses (does not hard-swap models) when fallback is exhausted after a retryable failure', async () => {
    const f = await seedProductionRun('sync-think-production-binding-pause-');
    f.connection.raw
      .prepare(
        `UPDATE agent_version
         SET fallback_model_ids_json = '[]', pause_on_failure = 1
         WHERE id = ?`,
      )
      .run(f.agent.id);
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(): AsyncIterable<AdapterEvent> {
        yield* [];
        throw Object.assign(new Error('primary model timeout'), {
          failureClass: 'timeout',
        });
      },
    };
    const claimed = f.orchestration.claimReadySteps({
      runId: f.graph.run.id,
      stepIds: ['production-step' as never],
      ownerId: 'production-binding-pause',
      leaseExpiresAt: '9999-12-31T23:59:59.999Z',
    }).claimedSteps[0]!;
    try {
      await expect(
        productionExecutor(f, adapter).execute({
          runId: f.graph.run.id,
          step: claimed,
          idempotencyKey: claimed.idempotencyKey!,
          artifactVersions: [],
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({
        name: 'StepExecutionError',
        failureClass: 'timeout',
        message: expect.stringContaining('Model binding paused (no_fallback_configured)'),
      });
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
        yield* [];
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
