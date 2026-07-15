import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  type Frame,
  type PlanApproveResponse,
  type PlanListRevisionsResponse,
  type RunGetGraphResponse,
} from '@sync-think/protocol';
import type {
  AgentVersionId,
  ArtifactVersion,
  Event,
  PlanId,
  PlanRevisionId,
  PlanStepDraft,
  ReviewOutcome,
  RunId,
  StepId,
  TaskId,
  WorkspaceId,
} from '@sync-think/shared';
import {
  openDatabaseAsync,
  SqliteAgentStore,
  SqliteEventCheckpointStore,
  SqliteOrchestrationStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPersistentRuntime, type PersistentRuntimeSession } from '../src/persistence.js';
import type {
  StepExecutionContext,
  StepExecutionResult,
  StepExecutor,
} from '../src/orchestration/step-executor.js';

const EXPECTED_SEQUENCE = ['design', 'image', 'reviewer-0', 'rework-1', 'reviewer-1'] as const;
const DESIGN_V1_CONTENT = 'M2 deterministic design candidate v1\n';
const DESIGN_V2_CONTENT = 'M2 deterministic design candidate v2 after review\n';
const PROVIDER_SECRET_CANARY = 'M2_FAKE_API_KEY_CANARY_2026_07_14_DO_NOT_EXPORT';
const CRITERIA = [
  'The design candidate is reviewable.',
  'The candidate preserves exact version lineage.',
] as const;
const cleanupDirs: string[] = [];

type RemovePath = (
  path: string,
  options: {
    recursive: boolean;
    force: boolean;
    maxRetries: number;
    retryDelay: number;
  },
) => void;

function removeTestPath(path: string, recursive: boolean, remove: RemovePath = rmSync): void {
  remove(path, {
    recursive,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    removeTestPath(dir, true);
  }
});

function createTestLocation(): {
  dir: string;
  dbPath: string;
  secureStoreKeyPath: string;
} {
  const configuredQaDir = process.env.SYNC_THINK_M2_QA_DIR?.trim();
  if (configuredQaDir) {
    const dir = resolve(configuredQaDir);
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, 'm2-exit-demo.sqlite');
    for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
      removeTestPath(path, false);
    }
    return {
      dir,
      dbPath,
      secureStoreKeyPath: join(dir, 'm2-exit-demo-secure-key.bin'),
    };
  }

  const dir = mkdtempSync(join(tmpdir(), 'sync-think-m2-exit-'));
  cleanupDirs.push(dir);
  return {
    dir,
    dbPath: join(dir, 'sync-think.db'),
    secureStoreKeyPath: join(dir, 'secure-store-key.bin'),
  };
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolveDeferred) => {
    resolvePromise = resolveDeferred;
  });
  return { promise, resolve: resolvePromise };
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 8_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
}

function createFrameReader(socket: Socket) {
  const queued: Frame[] = [];
  const waiters: Array<{
    resolve: (frame: Frame) => void;
    reject: (error: unknown) => void;
    timer: NodeJS.Timeout;
  }> = [];
  let pending: Buffer = Buffer.alloc(0);

  const rejectWaiters = (error: unknown) => {
    while (waiters.length > 0) {
      const waiter = waiters.shift()!;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  };
  socket.on('data', (chunk: Buffer) => {
    try {
      const decoded = decodeFrames(Buffer.concat([pending, chunk]));
      pending = decoded.remaining;
      for (const frame of decoded.frames) {
        const waiter = waiters.shift();
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve(frame);
        } else {
          queued.push(frame);
        }
      }
    } catch (error) {
      rejectWaiters(error);
    }
  });
  socket.on('error', rejectWaiters);
  socket.on('close', () => rejectWaiters(new Error('pipe closed before a response arrived')));

  return {
    read(timeoutMs = 8_000): Promise<Frame> {
      const frame = queued.shift();
      if (frame) return Promise.resolve(frame);
      return new Promise((resolveFrame, reject) => {
        const waiter = {
          resolve: resolveFrame,
          reject,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            reject(new Error('Timed out waiting for a pipe response'));
          }, timeoutMs),
        };
        waiters.push(waiter);
      });
    },
  };
}

type FrameReader = ReturnType<typeof createFrameReader>;

async function send(
  socket: Socket,
  reader: FrameReader,
  id: string,
  type: string,
  payload: unknown,
): Promise<Frame> {
  const response = reader.read();
  socket.write(encodeFrame({ id, kind: 'request', type, payload }));
  const frame = await response;
  expect(frame).toMatchObject({ id, kind: 'response', type });
  return frame;
}

async function command<T>(
  socket: Socket,
  reader: FrameReader,
  id: string,
  type: string,
  payload: unknown,
): Promise<T> {
  const response = await send(socket, reader, id, type, payload);
  expect(response.error).toBeUndefined();
  return response.payload as T;
}

const PIPE_FEATURES = [
  'runtime.subscribeEvents',
  'runtime.continueEventReplay',
  'runtime.unsubscribeEvents',
  'workspace.create',
  'task.create',
  'task.setParticipationMode',
  'agent.get',
  'agent.create',
  'provider.create',
  'plan.draft',
  'plan.revise',
  'plan.listRevisions',
  'plan.approve',
  'run.getGraph',
  'artifact.list',
  'artifact.getVersion',
  'artifact.compare',
];

async function connectAndHello(installId: string): Promise<{
  socket: Socket;
  reader: FrameReader;
}> {
  const socket = connect(pipePathPortable(installId));
  await withTimeout(
    new Promise<void>((resolveConnection, reject) => {
      socket.once('connect', resolveConnection);
      socket.once('error', reject);
    }),
    'named-pipe connection',
  );
  const reader = createFrameReader(socket);
  const hello = await send(socket, reader, 'hello', '__hello', {
    protocolVersion: 2,
    appVersion: '0.0.1',
    installId,
    nonce: randomBytes(8).toString('hex'),
    features: PIPE_FEATURES,
  });
  expect(hello.payload).toMatchObject({ ok: true });
  return { socket, reader };
}

interface AuditReplayPage {
  streamId: string;
  replayedEvents: Event[];
  nextCursor: number;
  replayComplete: boolean;
}

type SendAuditCommand = (id: string, type: string, payload: unknown) => Promise<unknown>;

function parseAuditReplayPage(value: unknown): AuditReplayPage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Audit replay returned an invalid page');
  }
  const page = value as Record<string, unknown>;
  if (
    typeof page.streamId !== 'string' ||
    page.streamId.length === 0 ||
    !Array.isArray(page.replayedEvents) ||
    !Number.isSafeInteger(page.nextCursor) ||
    (page.nextCursor as number) < 0 ||
    typeof page.replayComplete !== 'boolean'
  ) {
    throw new Error('Audit replay returned an invalid page');
  }
  return page as unknown as AuditReplayPage;
}

async function collectAuditPages(
  sendAuditCommand: SendAuditCommand,
  options: { timeoutMs?: number; maxPages?: number } = {},
): Promise<Event[]> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const maxPages = options.maxPages ?? 64;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('Audit replay deadline must be a positive integer');
  }
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new Error('Audit replay page limit must be a positive integer');
  }

  const deadline = Date.now() + timeoutMs;
  const sendBeforeDeadline = async (
    id: string,
    type: string,
    payload: unknown,
  ): Promise<unknown> => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error('Audit replay total deadline exceeded');
    return withTimeout(
      Promise.resolve().then(() => sendAuditCommand(id, type, payload)),
      `audit replay deadline during ${type}`,
      remainingMs,
    );
  };

  const events: Event[] = [];
  let streamId: string | undefined;
  let primaryError: unknown;
  try {
    let page = parseAuditReplayPage(
      await sendBeforeDeadline('audit-subscribe', 'runtime.subscribeEvents', { afterCursor: 0 }),
    );
    streamId = page.streamId;
    let previousCursor = 0;
    let pageNumber = 1;
    while (true) {
      if (page.streamId !== streamId) throw new Error('Audit replay stream changed mid-replay');
      if (page.nextCursor <= previousCursor) {
        throw new Error(
          `Audit replay cursor did not strictly advance: ${previousCursor} -> ${page.nextCursor}`,
        );
      }
      events.push(...page.replayedEvents);
      if (page.replayComplete) return events;
      if (pageNumber >= maxPages) {
        throw new Error(`Audit replay page limit ${maxPages} exceeded`);
      }
      previousCursor = page.nextCursor;
      pageNumber += 1;
      page = parseAuditReplayPage(
        await sendBeforeDeadline(`audit-page-${pageNumber}`, 'runtime.continueEventReplay', {
          streamId,
          afterCursor: previousCursor,
        }),
      );
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (streamId) {
      try {
        await sendBeforeDeadline('audit-unsubscribe', 'runtime.unsubscribeEvents', { streamId });
      } catch (error) {
        if (primaryError === undefined) throw error;
      }
    }
  }
}

async function collectAudit(socket: Socket, reader: FrameReader): Promise<Event[]> {
  return collectAuditPages((id, type, payload) => command(socket, reader, id, type, payload));
}

function planStep(
  id: string,
  title: string,
  instructions: string,
  agentVersionId: AgentVersionId,
): PlanStepDraft {
  return {
    id: id as StepId,
    title,
    instructions,
    agentVersionId,
    dependsOn: [],
  };
}

async function createAgent(
  socket: Socket,
  reader: FrameReader,
  input: {
    agentId: string;
    name: string;
    role: string;
    defaultModelId: string;
    reviewBehavior?: {
      role: 'reviewer' | 'executor-reviewer';
      maxIterations: number;
      onLimitReached: 'pause' | 'abort' | 'reassign';
    };
  },
): Promise<AgentVersionId> {
  const response = await command<{ agent: { agentVersionId: AgentVersionId } }>(
    socket,
    reader,
    `create-${input.agentId}`,
    'agent.create',
    {
      ...input,
      developerInstructions: `Execute the deterministic M2 ${input.role} contract.`,
      inputContract: 'Exact persisted task, plan, artifact, and evidence inputs.',
      outputContract: 'A deterministic structured result.',
      fallbackModelIds: [],
      pauseOnFailure: true,
      memoryScope: 'task',
      skillVersionIds: [],
      mcpServerIds: [],
      approvalMode: 'request',
      ...(input.reviewBehavior ? { reviewBehavior: input.reviewBehavior } : {}),
    },
  );
  return response.agent.agentVersionId;
}

function rejection(context: StepExecutionContext): ReviewOutcome {
  if (context.reviewContext?.kind !== 'reviewer') {
    throw new Error('M2 reviewer context is missing');
  }
  return {
    verdict: 'reject',
    explanation: `Deterministic rejection at iteration ${context.reviewContext.iteration}.`,
    criteria: context.reviewContext.criteria.map((criterion, index) => ({
      criterionId: criterion.id,
      verdict: index === 0 ? 'fail' : 'pass',
      explanation: `Exact check for ${criterion.id} at iteration ${context.reviewContext!.iteration}.`,
    })),
    reviewedArtifactVersionIds: context.reviewContext.reviewedArtifactVersions.map(
      (version) => version.id,
    ),
  };
}

function containsSecretLike(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === 'string') {
    return (
      /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i.test(value) ||
      /\b(?:sk|rk|pk)[-_][A-Za-z0-9_-]{12,}\b/.test(value) ||
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(value) ||
      /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\b/.test(value) ||
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)
    );
  }
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => containsSecretLike(entry, seen));

  const secretKeys = new Set([
    'apikey',
    'token',
    'apitoken',
    'accesstoken',
    'refreshtoken',
    'password',
    'secret',
    'clientsecret',
    'authorization',
    'privatekey',
  ]);
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return secretKeys.has(normalizedKey) || containsSecretLike(entry, seen);
  });
}

function duplicateTerminalEventCount(events: readonly Event[]): number {
  const terminalTypes = new Set([
    'step.completed',
    'step.failed',
    'step.cancelled',
    'run.completed',
    'run.failed',
    'run.cancelled',
    'run.paused',
    'review.limit-reached',
  ]);
  const keys = events
    .filter((event) => terminalTypes.has(event.type))
    .map((event) => {
      const gateId = typeof event.payload.gateId === 'string' ? event.payload.gateId : '';
      return [event.type, event.runId ?? '', event.stepId ?? '', gateId].join(':');
    });
  return keys.length - new Set(keys).size;
}

interface ExitSummaryCounts {
  artifactVersionCount: number;
  evidenceCount: number;
  limitEventCount: number;
  duplicateTerminalEventCount: number;
  secretLikeEvidence: boolean;
  restartStable: boolean;
}

function buildExitSummary(sequence: readonly string[], counts: ExitSummaryCounts) {
  return { sequence: [...sequence], ...counts };
}

interface PersistedSnapshot {
  graph: NonNullable<ReturnType<SqliteOrchestrationStore['getGraph']>>;
  revisions: ReturnType<SqliteOrchestrationStore['listPlanRevisions']>;
  evidence: ReturnType<SqliteOrchestrationStore['listReviewEvidence']>;
  gate: NonNullable<ReturnType<SqliteOrchestrationStore['getAcceptanceGate']>>;
  artifactVersions: ArtifactVersion[];
  agentVersionIds: AgentVersionId[];
  task: NonNullable<ReturnType<SqliteWorkspaceStore['getTask']>>;
  events: Event[];
  checkpoints: Array<{
    id: string;
    runId: string;
    lastEventSequence: number;
    state: Record<string, unknown>;
  }>;
}

async function readPersistedSnapshot(input: {
  dbPath: string;
  runId: RunId;
  planId: PlanId;
  taskId: TaskId;
  agentVersionIds: AgentVersionId[];
}): Promise<PersistedSnapshot> {
  const connection = await openDatabaseAsync({ path: input.dbPath });
  try {
    const orchestration = new SqliteOrchestrationStore(connection.raw);
    const graph = orchestration.getGraph(input.runId);
    const gateRows = connection.raw
      .prepare('SELECT id FROM acceptance_gate WHERE run_id = ? ORDER BY created_at ASC, id ASC')
      .all(input.runId) as Array<{ id: string }>;
    if (gateRows.length !== 1) {
      throw new Error(
        `M2 persisted snapshot expected one automatic Gate, found ${gateRows.length}`,
      );
    }
    const gate = orchestration.getAcceptanceGate(gateRows[0]!.id as never);
    const task = new SqliteWorkspaceStore(connection.raw).getTask(input.taskId);
    if (!graph || !gate || !task) throw new Error('M2 persisted snapshot is incomplete');
    const agentStore = new SqliteAgentStore(connection.raw);
    const agentVersionIds = input.agentVersionIds.map(
      (agentVersionId) => agentStore.getRequiredAgentVersion(agentVersionId).id,
    );
    const checkpointRows = connection.raw
      .prepare(
        `SELECT id, run_id AS runId, last_event_sequence AS lastEventSequence,
           state_json AS stateJson
         FROM checkpoint ORDER BY rowid ASC`,
      )
      .all() as Array<{
      id: string;
      runId: string;
      lastEventSequence: number;
      stateJson: string;
    }>;
    return {
      graph,
      revisions: orchestration.listPlanRevisions(input.planId),
      evidence: orchestration.listReviewEvidence(gate.id),
      gate,
      artifactVersions: orchestration.listRunArtifactVersions(input.runId),
      agentVersionIds,
      task,
      events: new SqliteEventCheckpointStore(connection.raw).listAllEvents(0),
      checkpoints: checkpointRows.map(({ stateJson, ...row }) => ({
        ...row,
        state: JSON.parse(stateJson) as Record<string, unknown>,
      })),
    };
  } finally {
    connection.raw.close();
  }
}

describe('M2 exit evidence secret detection', () => {
  it.each([
    ['token key', { token: 'plain-secret-value' }],
    ['apiToken key', { apiToken: 'plain-secret-value' }],
    ['apiKey key', { apiKey: 'plain-secret-value' }],
    ['accessToken key', { accessToken: 'plain-secret-value' }],
    ['GitHub token value', { value: 'ghp_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' }],
    [
      'bare JWT value',
      {
        value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJtMi1jYW5hcnkifQ.signature-canary',
      },
    ],
  ])('detects %s', (_label, value) => {
    expect(containsSecretLike(value)).toBe(true);
  });

  it.each([
    ['tokenEstimate', { tokenEstimate: 4_096 }],
    ['tokenizer', { tokenizer: 'cl100k_base' }],
    ['idempotency key', { idempotencyKey: 'step-safe-key' }],
    ['API key hint', { apiKeyHint: 'configured' }],
    ['ordinary dotted text', { value: 'release.2026.07' }],
  ])('does not flag %s', (_label, value) => {
    expect(containsSecretLike(value)).toBe(false);
  });
});

describe('M2 audit replay bounds', () => {
  it('rejects a replay cursor that does not strictly advance', async () => {
    const sendAuditCommand = async (_id: string, type: string): Promise<unknown> => {
      if (type === 'runtime.subscribeEvents') {
        return {
          streamId: 'stream-stalled',
          replayedEvents: [],
          nextCursor: 1,
          replayComplete: false,
        };
      }
      if (type === 'runtime.continueEventReplay') {
        return {
          streamId: 'stream-stalled',
          replayedEvents: [],
          nextCursor: 1,
          replayComplete: false,
        };
      }
      return {};
    };

    await expect(
      collectAuditPages(sendAuditCommand, { timeoutMs: 1_000, maxPages: 4 }),
    ).rejects.toThrow(/cursor.*advance/i);
  });

  it('rejects replay beyond the configured page bound', async () => {
    let cursor = 0;
    const sendAuditCommand = async (_id: string, type: string): Promise<unknown> => {
      if (type === 'runtime.unsubscribeEvents') return {};
      cursor += 1;
      return {
        streamId: 'stream-unbounded',
        replayedEvents: [],
        nextCursor: cursor,
        replayComplete: false,
      };
    };

    await expect(
      collectAuditPages(sendAuditCommand, { timeoutMs: 1_000, maxPages: 2 }),
    ).rejects.toThrow(/page limit.*2/i);
  });

  it('rejects when the total replay deadline expires', async () => {
    const sendAuditCommand = () => new Promise<never>(() => undefined);
    await expect(
      collectAuditPages(sendAuditCommand, { timeoutMs: 20, maxPages: 4 }),
    ).rejects.toThrow(/deadline/i);
  });
});

describe('M2 test harness guarantees', () => {
  it('configures Windows cleanup retries and propagates the final failure', () => {
    const cleanupFailure = new Error('cleanup-final-failure');
    let receivedOptions: Record<string, unknown> | undefined;
    expect(() =>
      removeTestPath('unused-test-path', true, (_path, options) => {
        receivedOptions = options;
        throw cleanupFailure;
      }),
    ).toThrow(cleanupFailure);
    expect(receivedOptions).toMatchObject({
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });

  it('builds the marker sequence from actual executor calls', () => {
    expect(
      buildExitSummary(['actual-design', 'actual-review'], {
        artifactVersionCount: 2,
        evidenceCount: 2,
        limitEventCount: 1,
        duplicateTerminalEventCount: 0,
        secretLikeEvidence: false,
        restartStable: true,
      }).sequence,
    ).toEqual(['actual-design', 'actual-review']);
  });
});

describe('M2 exit demo', () => {
  it('persists the exact review-limit sequence and restores it once after Runtime restart', async () => {
    const location = createTestLocation();
    const installId = `m2-exit-${randomBytes(6).toString('hex')}`;
    const calls: string[] = [];
    const completedInitialSteps: string[] = [];
    const initialContexts = new Map<string, StepExecutionContext>();
    const reviewerContexts: StepExecutionContext[] = [];
    const reworkContexts: StepExecutionContext[] = [];
    const designEntered = deferred<StepExecutionContext>();
    const imageEntered = deferred<StepExecutionContext>();
    const releaseInitialSteps = deferred<void>();
    let designArtifactId: string | undefined;
    let designV1Id: string | undefined;

    const executor: StepExecutor = {
      async execute(context): Promise<StepExecutionResult> {
        if (!context.reviewContext) {
          const semantic = context.step.id === 'design' ? 'design' : 'image';
          calls.push(semantic);
          initialContexts.set(semantic, context);
          if (semantic === 'design') designEntered.resolve(context);
          else imageEntered.resolve(context);
          await releaseInitialSteps.promise;
          completedInitialSteps.push(semantic);
          return semantic === 'design'
            ? {
                outputVersions: [
                  {
                    artifactName: 'm2-design.md',
                    content: DESIGN_V1_CONTENT,
                    mimeType: 'text/markdown',
                    status: 'candidate',
                  },
                ],
              }
            : {};
        }

        if (context.reviewContext.kind === 'reviewer') {
          calls.push(`reviewer-${context.reviewContext.iteration}`);
          reviewerContexts.push(context);
          const reviewed = context.reviewContext.reviewedArtifactVersions[0];
          if (!reviewed) throw new Error('Reviewer received no exact ArtifactVersion');
          if (context.reviewContext.iteration === 0) {
            designArtifactId = reviewed.artifactId;
            designV1Id = reviewed.id;
          }
          return { reviewOutcome: rejection(context) };
        }

        calls.push(`rework-${context.reviewContext.iteration}`);
        reworkContexts.push(context);
        const reviewedVersionId = context.reviewContext.evidence.reviewedArtifactVersionIds[0];
        const parent = context.artifactVersions.find((version) => version.id === reviewedVersionId);
        if (!parent) throw new Error('Rework received no exact rejected ArtifactVersion');
        return {
          outputVersions: [
            {
              artifactId: parent.artifactId,
              parentVersionIds: [parent.id],
              content: DESIGN_V2_CONTENT,
              mimeType: 'text/markdown',
              status: 'candidate',
            },
          ],
        };
      },
    };

    let firstSession: PersistentRuntimeSession | undefined;
    let firstSocket: Socket | undefined;
    let secondSession: PersistentRuntimeSession | undefined;
    let secondSocket: Socket | undefined;
    let recoveryWarningSpy: ReturnType<typeof vi.spyOn> | undefined;
    const orchestrationRecoveryWarnings: string[] = [];
    const restartExecutions: StepExecutionContext[] = [];
    try {
      firstSession = await openPersistentRuntime({
        dbPath: location.dbPath,
        secureStoreKeyPath: location.secureStoreKeyPath,
        installId,
        allowNoToken: true,
        stepExecutor: executor,
      });
      await firstSession.runtime.start();
      const firstClient = await connectAndHello(installId);
      firstSocket = firstClient.socket;

      const workspace = await command<{ workspaceId: WorkspaceId }>(
        firstClient.socket,
        firstClient.reader,
        'workspace-create',
        'workspace.create',
        { folderPath: join(location.dir, 'workspace'), name: 'M2 Exit Workspace' },
      );
      const task = await command<{
        taskId: TaskId;
        taskVersion: number;
        participationMode: string;
      }>(firstClient.socket, firstClient.reader, 'task-create', 'task.create', {
        workspaceId: workspace.workspaceId,
        title: 'M2 Exit Demo',
        goal: 'Prove bounded reviewer rework and restart recovery.',
        acceptanceCriteria: [...CRITERIA],
      });
      expect(task).toMatchObject({ taskVersion: 0, participationMode: 'conversation' });

      const provider = await command<{ secretStored: boolean; provider: { name: string } }>(
        firstClient.socket,
        firstClient.reader,
        'provider-secret-canary',
        'provider.create',
        {
          name: 'M2 Secret Canary Provider',
          baseUrl: 'https://m2-secret-canary.invalid/v1',
          protocol: 'openai-chat',
          apiKey: PROVIDER_SECRET_CANARY,
          supportsDiscovery: false,
          credentialGroupName: 'm2-canary-group',
          credentialLabel: 'm2-canary-credential',
        },
      );
      expect(provider).toMatchObject({
        secretStored: true,
        provider: { name: 'M2 Secret Canary Provider' },
      });
      expect(JSON.stringify(provider)).not.toContain(PROVIDER_SECRET_CANARY);

      const mode = await command<{ task: { taskVersion: number; participationMode: string } }>(
        firstClient.socket,
        firstClient.reader,
        'mode-collaboration',
        'task.setParticipationMode',
        { taskId: task.taskId, mode: 'collaboration', expectedTaskVersion: 0 },
      );
      expect(mode.task).toMatchObject({ taskVersion: 1, participationMode: 'collaboration' });

      const defaultAgent = await command<{
        agent: { defaultModelId: string };
      }>(firstClient.socket, firstClient.reader, 'agent-default', 'agent.get', {});
      const designAgentVersionId = await createAgent(firstClient.socket, firstClient.reader, {
        agentId: 'agent-m2-design',
        name: 'M2 Design',
        role: 'designer',
        defaultModelId: defaultAgent.agent.defaultModelId,
      });
      const imageAgentVersionId = await createAgent(firstClient.socket, firstClient.reader, {
        agentId: 'agent-m2-image-stub',
        name: 'M2 Image Stub',
        role: 'image-stub',
        defaultModelId: defaultAgent.agent.defaultModelId,
      });
      const reviewerAgentVersionId = await createAgent(firstClient.socket, firstClient.reader, {
        agentId: 'agent-m2-reviewer',
        name: 'M2 Reviewer',
        role: 'reviewer',
        defaultModelId: defaultAgent.agent.defaultModelId,
        reviewBehavior: {
          role: 'reviewer',
          maxIterations: 1,
          onLimitReached: 'pause',
        },
      });
      const exactAgentVersionIds = [
        designAgentVersionId,
        imageAgentVersionId,
        reviewerAgentVersionId,
      ];

      const v1Steps = [
        planStep(
          'design',
          'Design candidate',
          'Produce the first immutable candidate.',
          designAgentVersionId,
        ),
        planStep(
          'image',
          'Image stub',
          'Produce an isolated deterministic image stub.',
          imageAgentVersionId,
        ),
        {
          ...planStep(
            'planned-reviewer',
            'Review design candidate',
            'Review the exact design ArtifactVersions against persisted acceptance criteria.',
            reviewerAgentVersionId,
          ),
          dependsOn: ['design' as StepId],
        },
      ];
      const v1 = await command<{
        id: PlanRevisionId;
        planId: PlanId;
        revision: number;
        taskVersion: number;
        steps: PlanStepDraft[];
      }>(firstClient.socket, firstClient.reader, 'plan-v1', 'plan.draft', {
        taskId: task.taskId,
        expectedTaskVersion: 1,
        title: 'M2 exit plan v1',
        steps: v1Steps,
      });
      expect(v1).toMatchObject({ revision: 1, taskVersion: 2, steps: v1Steps });

      const v2Steps = [
        planStep(
          'design',
          'Design candidate v2 plan',
          'Produce the approved immutable candidate with exact lineage.',
          designAgentVersionId,
        ),
        planStep(
          'image',
          'Image stub',
          'Produce an isolated deterministic image stub.',
          imageAgentVersionId,
        ),
        {
          ...planStep(
            'planned-reviewer',
            'Review design candidate',
            'Review the exact design ArtifactVersions against persisted acceptance criteria.',
            reviewerAgentVersionId,
          ),
          dependsOn: ['design' as StepId],
        },
      ];
      const v2 = await command<{
        id: PlanRevisionId;
        planId: PlanId;
        revision: number;
        steps: PlanStepDraft[];
      }>(firstClient.socket, firstClient.reader, 'plan-v2', 'plan.revise', {
        planId: v1.planId,
        expectedRevision: 1,
        title: 'M2 exit plan v2 approved',
        steps: v2Steps,
      });
      expect(v2).toMatchObject({ revision: 2, steps: v2Steps });

      const approved = await command<PlanApproveResponse>(
        firstClient.socket,
        firstClient.reader,
        'plan-approve-v2',
        'plan.approve',
        { planId: v1.planId, revision: 2 },
      );
      const runId = approved.run.id;
      expect(approved.run).toMatchObject({ planRevisionId: v2.id, state: 'queued' });
      expect(approved.steps.map((step) => [step.id, step.agentVersionId])).toEqual([
        ['design', designAgentVersionId],
        ['image', imageAgentVersionId],
        ['planned-reviewer', reviewerAgentVersionId],
      ]);

      await withTimeout(
        Promise.all([designEntered.promise, imageEntered.promise]),
        'parallel design/image entry',
      );
      expect(calls).toEqual(['design', 'image']);
      expect(completedInitialSteps).toEqual([]);
      const designContext = initialContexts.get('design')!;
      const imageContext = initialContexts.get('image')!;
      expect(designContext.artifactVersions).not.toBe(imageContext.artifactVersions);
      expect(designContext.artifactVersions).toEqual([]);
      expect(imageContext.artifactVersions).toEqual([]);
      expect(Object.isFrozen(designContext.artifactVersions)).toBe(true);
      expect(Object.isFrozen(imageContext.artifactVersions)).toBe(true);

      const gateConnection = await openDatabaseAsync({ path: location.dbPath });
      try {
        expect(
          gateConnection.raw
            .prepare('SELECT id, state FROM step WHERE run_id = ? ORDER BY plan_order ASC')
            .all(runId),
        ).toMatchObject([
          { id: 'design', state: 'running' },
          { id: 'image', state: 'running' },
          { id: 'planned-reviewer', state: 'pending' },
        ]);
        expect(
          gateConnection.raw.prepare('SELECT COUNT(*) AS count FROM artifact_version').get(),
        ).toEqual({ count: 0 });
        const automaticGates = gateConnection.raw
          .prepare(
            `SELECT id, target_step_id AS targetStepId,
               reviewer_agent_version_id AS reviewerAgentVersionId,
               max_iterations AS maxIterations, on_limit_reached AS onLimitReached
             FROM acceptance_gate WHERE run_id = ?`,
          )
          .all(runId);
        expect(automaticGates).toEqual([
          expect.objectContaining({
            id: expect.stringMatching(/^auto-gate-[a-f0-9]{64}$/),
            targetStepId: 'design',
            reviewerAgentVersionId,
            maxIterations: 1,
            onLimitReached: 'pause',
          }),
        ]);
        expect(
          gateConnection.raw
            .prepare(
              `SELECT gate_step.step_id AS stepId, gate_step.role,
                 gate_step.iteration, gate_step.derivation
               FROM acceptance_gate_step AS gate_step
               JOIN acceptance_gate AS gate_row ON gate_row.id = gate_step.gate_id
               WHERE gate_row.run_id = ?`,
            )
            .all(runId),
        ).toEqual([
          {
            stepId: 'planned-reviewer',
            role: 'reviewer',
            iteration: 0,
            derivation: 'initial',
          },
        ]);
      } finally {
        gateConnection.raw.close();
      }

      releaseInitialSteps.resolve();
      await waitFor(async () => {
        const connection = await openDatabaseAsync({ path: location.dbPath });
        try {
          return (
            new SqliteOrchestrationStore(connection.raw).getGraph(runId)?.run.state === 'paused'
          );
        } finally {
          connection.raw.close();
        }
      }, 'review limit pause');

      const beforeRestart = await readPersistedSnapshot({
        dbPath: location.dbPath,
        runId,
        planId: v1.planId,
        taskId: task.taskId,
        agentVersionIds: exactAgentVersionIds,
      });
      expect(calls).toEqual(EXPECTED_SEQUENCE);
      expect(completedInitialSteps).toHaveLength(2);
      expect(beforeRestart.graph.run).toMatchObject({
        state: 'paused',
        planRevisionId: v2.id,
      });
      expect(beforeRestart.gate).toMatchObject({
        state: 'limit-reached',
        maxIterations: 1,
        reviewerAgentVersionId,
        criteria: CRITERIA.map((description, planOrder) => ({
          id: expect.stringMatching(/^criterion-\d+-[a-f0-9]{16}$/),
          description,
          planOrder,
        })),
      });
      const gateCriteria = beforeRestart.gate.criteria;
      expect(beforeRestart.revisions).toMatchObject([
        { id: v1.id, revision: 1, title: 'M2 exit plan v1', steps: v1Steps },
        { id: v2.id, revision: 2, title: 'M2 exit plan v2 approved', steps: v2Steps },
      ]);
      expect(beforeRestart.agentVersionIds).toEqual(exactAgentVersionIds);
      expect(beforeRestart.task).toMatchObject({
        participationMode: 'collaboration',
        acceptanceCriteria: [...CRITERIA],
      });

      const artifactVersions = [...beforeRestart.artifactVersions].sort(
        (left, right) => left.version - right.version,
      );
      expect(artifactVersions).toMatchObject([
        {
          artifactId: designArtifactId,
          id: designV1Id,
          version: 1,
          content: DESIGN_V1_CONTENT,
          status: 'candidate',
          parentVersionIds: [],
          sourceStepId: 'design',
        },
        {
          artifactId: designArtifactId,
          version: 2,
          content: DESIGN_V2_CONTENT,
          status: 'candidate',
          parentVersionIds: [designV1Id],
        },
      ]);
      const designV2 = artifactVersions[1]!;
      expect(reviewerContexts).toHaveLength(2);
      expect(
        reviewerContexts.map((context) => {
          if (context.reviewContext?.kind !== 'reviewer') throw new Error('reviewer context lost');
          return {
            iteration: context.reviewContext.iteration,
            criteria: context.reviewContext.criteria,
            versionIds: context.reviewContext.reviewedArtifactVersions.map((version) => version.id),
            agentVersionId: context.step.agentVersionId,
          };
        }),
      ).toEqual([
        {
          iteration: 0,
          criteria: gateCriteria,
          versionIds: [designV1Id],
          agentVersionId: reviewerAgentVersionId,
        },
        {
          iteration: 1,
          criteria: gateCriteria,
          versionIds: [designV2.id],
          agentVersionId: reviewerAgentVersionId,
        },
      ]);
      expect(reworkContexts).toHaveLength(1);
      expect(reworkContexts[0]?.step.agentVersionId).toBe(designAgentVersionId);
      expect(designV2.sourceStepId).toBe(reworkContexts[0]?.step.id);
      expect(reworkContexts[0]?.reviewContext).toMatchObject({
        kind: 'rework',
        iteration: 1,
        evidence: {
          iteration: 0,
          reviewerAgentVersionId,
          reviewedArtifactVersionIds: [designV1Id],
        },
      });
      expect(beforeRestart.evidence).toMatchObject([
        {
          iteration: 0,
          verdict: 'reject',
          targetStepId: 'design',
          reviewerAgentVersionId,
          reviewedArtifactVersionIds: [designV1Id],
          criteria: gateCriteria.map((criterion) => ({
            criterionId: criterion.id,
            explanation: expect.any(String),
          })),
        },
        {
          iteration: 1,
          verdict: 'reject',
          targetStepId: 'design',
          reviewerAgentVersionId,
          reviewedArtifactVersionIds: [designV2.id],
          criteria: gateCriteria.map((criterion) => ({
            criterionId: criterion.id,
            explanation: expect.any(String),
          })),
        },
      ]);

      const limitEventCount = beforeRestart.events.filter(
        (event) => event.type === 'review.limit-reached',
      ).length;
      const duplicateTerminalCount = duplicateTerminalEventCount(beforeRestart.events);
      expect(limitEventCount).toBe(1);
      expect(duplicateTerminalCount).toBe(0);
      expect(new Set(beforeRestart.events.map((event) => event.id)).size).toBe(
        beforeRestart.events.length,
      );
      expect(new Set(beforeRestart.events.map((event) => event.sequence)).size).toBe(
        beforeRestart.events.length,
      );
      expect(new Set(beforeRestart.checkpoints.map((checkpoint) => checkpoint.id)).size).toBe(
        beforeRestart.checkpoints.length,
      );
      expect(
        new Set(
          beforeRestart.checkpoints.map(
            (checkpoint) => `${checkpoint.runId}:${checkpoint.lastEventSequence}`,
          ),
        ).size,
      ).toBe(beforeRestart.checkpoints.length);

      firstClient.socket.destroy();
      firstSocket = undefined;
      await firstSession.close();
      firstSession = undefined;

      const originalWarn = console.warn;
      recoveryWarningSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        const message = args.map((value) => String(value)).join(' ');
        if (/orchestration.*recovery.*failed/i.test(message)) {
          orchestrationRecoveryWarnings.push(message);
        }
        Reflect.apply(originalWarn, console, args);
      });
      secondSession = await openPersistentRuntime({
        dbPath: location.dbPath,
        secureStoreKeyPath: location.secureStoreKeyPath,
        installId,
        allowNoToken: true,
        stepExecutor: {
          async execute(context) {
            restartExecutions.push(context);
            return {};
          },
        },
      });
      await secondSession.runtime.start();
      const secondClient = await connectAndHello(installId);
      secondSocket = secondClient.socket;

      const graphAfterRestart = await command<RunGetGraphResponse>(
        secondClient.socket,
        secondClient.reader,
        'graph-after-restart',
        'run.getGraph',
        { workspaceId: workspace.workspaceId, taskId: task.taskId, runId },
      );
      const revisionsAfterRestart = await command<PlanListRevisionsResponse>(
        secondClient.socket,
        secondClient.reader,
        'revisions-after-restart',
        'plan.listRevisions',
        { planId: v1.planId },
      );
      const artifactsAfterRestart = await command<{
        artifacts: Array<{
          artifact: { id: string };
          versions: Array<{ id: string; version: number; parentVersionIds: string[] }>;
        }>;
      }>(secondClient.socket, secondClient.reader, 'artifacts-after-restart', 'artifact.list', {
        workspaceId: workspace.workspaceId,
        taskId: task.taskId,
        runId,
      });
      const comparison = await command<{
        artifactId: string;
        leftVersionId: string;
        rightVersionId: string;
        comparison: { kind: string; equal: boolean };
      }>(secondClient.socket, secondClient.reader, 'compare-after-restart', 'artifact.compare', {
        workspaceId: workspace.workspaceId,
        taskId: task.taskId,
        runId,
        leftVersionId: artifactVersions[0]!.id,
        rightVersionId: artifactVersions[1]!.id,
      });
      const auditAfterRestart = await collectAudit(secondClient.socket, secondClient.reader);

      secondClient.socket.destroy();
      secondSocket = undefined;
      await secondSession.close();
      secondSession = undefined;
      recoveryWarningSpy.mockRestore();
      recoveryWarningSpy = undefined;

      expect(secondSession).toBeUndefined();
      expect(orchestrationRecoveryWarnings).toEqual([]);

      const afterRestart = await readPersistedSnapshot({
        dbPath: location.dbPath,
        runId,
        planId: v1.planId,
        taskId: task.taskId,
        agentVersionIds: exactAgentVersionIds,
      });
      expect(restartExecutions).toEqual([]);
      expect(graphAfterRestart).toEqual(beforeRestart.graph);
      expect(graphAfterRestart.run.state).toBe('paused');
      expect(revisionsAfterRestart.revisions).toEqual(beforeRestart.revisions);
      expect(artifactsAfterRestart.artifacts).toHaveLength(1);
      expect(
        artifactsAfterRestart.artifacts[0]!.versions.map((version) => version.version).sort(
          (left, right) => left - right,
        ),
      ).toEqual([1, 2]);
      expect(comparison).toMatchObject({
        artifactId: designArtifactId,
        leftVersionId: artifactVersions[0]!.id,
        rightVersionId: artifactVersions[1]!.id,
        comparison: { kind: 'text', equal: false },
      });
      expect(afterRestart).toEqual(beforeRestart);
      expect(auditAfterRestart).toEqual(afterRestart.events);

      const exportBundle = {
        graph: graphAfterRestart,
        evidence: afterRestart.evidence,
        revisions: revisionsAfterRestart.revisions,
        audit: auditAfterRestart,
      };
      const exportBundleJson = JSON.stringify(exportBundle);
      expect(exportBundleJson).not.toContain(PROVIDER_SECRET_CANARY);
      const secretLikeEvidence = containsSecretLike(exportBundle);
      const restartStable =
        restartExecutions.length === 0 &&
        afterRestart.events.length === beforeRestart.events.length &&
        afterRestart.checkpoints.length === beforeRestart.checkpoints.length &&
        JSON.stringify(afterRestart.events) === JSON.stringify(beforeRestart.events) &&
        JSON.stringify(afterRestart.checkpoints) === JSON.stringify(beforeRestart.checkpoints);
      expect(secretLikeEvidence).toBe(false);
      expect(restartStable).toBe(true);

      const summary = buildExitSummary(calls, {
        artifactVersionCount: afterRestart.artifactVersions.length,
        evidenceCount: afterRestart.evidence.length,
        limitEventCount,
        duplicateTerminalEventCount: duplicateTerminalCount,
        secretLikeEvidence,
        restartStable,
      });
      expect(summary).toEqual({
        sequence: [...EXPECTED_SEQUENCE],
        artifactVersionCount: 2,
        evidenceCount: 2,
        limitEventCount: 1,
        duplicateTerminalEventCount: 0,
        secretLikeEvidence: false,
        restartStable: true,
      });
      console.log(`M2_EXIT_SUMMARY=${JSON.stringify(summary)}`);
    } finally {
      releaseInitialSteps.resolve();
      firstSocket?.destroy();
      secondSocket?.destroy();
      await firstSession?.close();
      await secondSession?.close();
      recoveryWarningSpy?.mockRestore();
    }
  }, 30_000);
});
