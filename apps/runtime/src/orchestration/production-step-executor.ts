import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import { resolveCredentialRef } from '@sync-think/core';
import {
  MAX_INLINE_ARTIFACT_CONTENT_BYTES,
  isReviewOutcomeConsistent,
  type ArtifactVersionStatus,
  type FailureClass,
  type JsonValue,
  type ProtocolFamily,
  type ReviewOutcome,
} from '@sync-think/shared';
import type { SecureStore } from '@sync-think/secure-store';
import type {
  SqliteAgentStore,
  SqliteOrchestrationStore,
  ProductionExecutionResult,
  SqliteProductionExecutionStore,
  SqliteProviderStore,
  StepArtifactVersionOutput,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import {
  StepExecutionError,
  type StepExecutionContext,
  type StepExecutionResult,
  type StepExecutor,
} from './step-executor.js';

export interface ProductionStepExecutorOptions {
  agentStore: SqliteAgentStore;
  providerStore: SqliteProviderStore;
  workspaceStore: SqliteWorkspaceStore;
  orchestrationStore: SqliteOrchestrationStore;
  executionStore: SqliteProductionExecutionStore;
  secureStore: SecureStore;
  adaptersByProtocol?: Partial<Record<ProtocolFamily, ProviderAdapter>>;
  fallbackAdapter?: ProviderAdapter;
}

const ABORTED = Symbol('step-execution-aborted');
const SECRET_ECHO_FAILURE = 'Production Provider response contained credential secret';

export function createProductionStepExecutor(options: ProductionStepExecutorOptions): StepExecutor {
  return {
    async execute(context) {
      try {
        return await executeProviderStep(options, context);
      } catch (error) {
        if (context.signal.aborted) {
          releaseApprovalReservation(options.executionStore, context);
          return {};
        }
        if (error instanceof StepExecutionError) throw error;
        throw new StepExecutionError(
          error instanceof Error ? error.message : 'Production Step execution failed',
          failureClassOf(error),
        );
      }
    },
  };
}

async function executeProviderStep(
  options: ProductionStepExecutorOptions,
  context: StepExecutionContext,
): Promise<StepExecutionResult> {
  assertNotAborted(context.signal);
  const fence = executionFence(context);
  const completedReservation = options.executionStore.getCompletedProviderExecution({
    ...fence,
    idempotencyKey: context.idempotencyKey,
  });
  if (completedReservation) {
    return materializeExecutionResult(context, completedReservation.result!);
  }

  const agent = options.agentStore.getVersion(context.step.agentVersionId);
  if (!agent) {
    throw unavailable(`Exact AgentVersion is unavailable: ${context.step.agentVersionId}`);
  }
  const modelId = context.step.modelOverrideId ?? agent.defaultModelId;
  const model = options.providerStore.getModel(modelId);
  if (!model) throw unavailable(`Configured model is unavailable: ${modelId}`);
  const provider = options.providerStore.getProvider(model.providerId);
  if (!provider) throw unavailable(`Configured provider is unavailable: ${model.providerId}`);

  const adapter =
    options.adaptersByProtocol?.[model.protocol] ??
    (options.fallbackAdapter?.protocol === model.protocol ? options.fallbackAdapter : undefined);
  if (!adapter) {
    throw unavailable(`No production adapter is configured for protocol ${model.protocol}`);
  }

  const credential = resolveCredentialRef({
    pinnedCredentialRefId: agent.pinnedCredentialRefId,
    defaultCredentialGroupId: agent.defaultCredentialGroupId,
    providerId: model.providerId,
    getCredentialRef: (id) => options.providerStore.getCredentialRef(id),
    getFirstCredentialInGroup: (groupId) =>
      options.providerStore.getFirstCredentialInGroup(groupId),
    getPrimaryCredentialRef: (providerId) =>
      options.providerStore.getPrimaryCredentialRef(providerId),
    getProviderIdForCredentialGroup: (groupId) =>
      options.providerStore.getProviderIdForCredentialGroup(groupId),
  });
  if (credential.status !== 'resolved' || !credential.credential) {
    throw new StepExecutionError(
      `No credential is available for configured model (${credential.reason ?? 'missing'})`,
      'auth',
    );
  }
  const storeHandle = options.providerStore.getCredentialStoreHandle(credential.credential.id);
  if (!storeHandle) throw new StepExecutionError('Credential handle is unavailable', 'auth');
  const apiKey = await options.secureStore.retrieveSecret(storeHandle);
  if (!apiKey.trim()) throw new StepExecutionError('Credential secret is empty', 'auth');
  assertNotAborted(context.signal);

  const reservation = options.executionStore.reserveProviderExecution({
    ...fence,
    idempotencyKey: context.idempotencyKey,
  });
  if (reservation.state === 'completed') {
    return materializeExecutionResult(context, reservation.result!);
  }
  if (!reservation.created) {
    throw new StepExecutionError(
      'Provider execution outcome is unknown; external retry is blocked',
      'acceptance',
    );
  }

  const request: ProviderCallRequest = {
    protocol: model.protocol,
    baseUrl: provider.baseUrl,
    modelId: model.providerModelId,
    apiKey,
    idempotencyKey: context.idempotencyKey,
    signal: context.signal,
    systemPrompt: buildSystemPrompt(agent),
    messages: [{ role: 'user', content: buildStepPrompt(context) }],
    stream: true,
  };
  let output: string | typeof ABORTED;
  try {
    output = await collectProviderOutput(adapter.call(request), context.signal);
  } catch (error) {
    if (error instanceof Error && error.message.includes(apiKey)) {
      throw providerSecretEchoError();
    }
    throw error;
  }
  if (output === ABORTED) {
    releaseApprovalReservation(options.executionStore, context);
    return {};
  }
  if (!output.trim()) {
    throw new StepExecutionError(
      'Production adapter returned no persistable Step output',
      'acceptance',
    );
  }
  if (output.includes(apiKey)) throw providerSecretEchoError();
  if (Buffer.byteLength(output, 'utf8') > MAX_INLINE_ARTIFACT_CONTENT_BYTES) {
    throw new StepExecutionError(
      'Production adapter output exceeds the inline artifact limit',
      'acceptance',
    );
  }

  const candidateResult: ProductionExecutionResult = {
    outputVersions: [
      {
        artifactName:
          context.reviewContext?.kind === 'reviewer'
            ? `Review outcome ${context.step.id}`
            : `Step output ${context.step.id}`,
        content: output,
        mimeType: context.reviewContext?.kind === 'reviewer' ? 'application/json' : 'text/plain',
        status: 'candidate',
        metadata: {
          agentVersionId: context.step.agentVersionId,
          modelId,
          providerId: model.providerId,
          executionKind: context.reviewContext?.kind ?? 'ordinary',
        },
      },
    ],
  };
  const validatedResult = materializeExecutionResult(context, candidateResult);
  assertNotAborted(context.signal);
  options.executionStore.completeProviderExecution({
    ...fence,
    idempotencyKey: context.idempotencyKey,
    result: candidateResult,
  });
  return validatedResult;
}

function providerSecretEchoError(): StepExecutionError {
  return new StepExecutionError(SECRET_ECHO_FAILURE, 'protocol');
}

function buildSystemPrompt(agent: ReturnType<SqliteAgentStore['getRequiredAgentVersion']>): string {
  return [
    agent.developerInstructions,
    `Input contract: ${agent.inputContract}`,
    `Output contract: ${agent.outputContract}`,
  ].join('\n\n');
}

function buildStepPrompt(context: StepExecutionContext): string {
  if (context.reviewContext?.kind === 'reviewer') {
    const assignment = {
      gateId: context.reviewContext.gateId,
      targetStepId: context.reviewContext.targetStepId,
      iteration: context.reviewContext.iteration,
      criteria: context.reviewContext.criteria.map((criterion) => ({
        id: criterion.id,
        description: criterion.description,
      })),
      reviewedArtifacts: context.reviewContext.reviewedArtifactVersions.map((version) => ({
        artifactVersionId: version.id,
        artifactId: version.artifactId,
        version: version.version,
        mimeType: version.mimeType,
        content: version.content ?? null,
        contentRef: version.contentRef ?? null,
      })),
    };
    return [
      `Step: ${context.step.title}`,
      context.step.instructions,
      'Review only the exact persisted assignment below.',
      JSON.stringify(assignment, null, 2),
      'Return only one JSON object with exactly these fields:',
      '{"verdict":"accept|reject","explanation":"...","criteria":[{"criterionId":"exact id","verdict":"pass|fail","explanation":"..."}],"reviewedArtifactVersionIds":["exact assigned id"]}',
    ].join('\n\n');
  }
  if (context.reviewContext?.kind === 'rework') {
    const reviewedArtifacts = context.reviewContext.evidence.reviewedArtifactVersionIds.map(
      (versionId) => {
        const version = context.artifactVersions.find((candidate) => candidate.id === versionId);
        return {
          artifactVersionId: versionId,
          artifactId: version?.artifactId ?? null,
          version: version?.version ?? null,
          content: version?.content ?? null,
          contentRef: version?.contentRef ?? null,
        };
      },
    );
    const outputInstruction =
      context.reviewContext.evidence.reviewedArtifactVersionIds.length === 1
        ? 'Return the complete revised artifact content. A structured revisions object is also accepted.'
        : [
            'Return only one JSON object with this shape:',
            '{"revisions":[{"parentArtifactVersionId":"exact assigned id","content":"complete revised content","mimeType":"optional","status":"candidate","metadata":{}}]}',
            'Include only artifacts that require revision; omitted assigned artifacts remain unchanged.',
          ].join('\n');
    return [
      `Step: ${context.step.title}`,
      context.step.instructions,
      'Immutable ReviewEvidence:',
      JSON.stringify(context.reviewContext.evidence, null, 2),
      'Exact artifact versions to revise:',
      JSON.stringify(reviewedArtifacts, null, 2),
      outputInstruction,
    ].join('\n\n');
  }
  const inputs = context.artifactVersions
    .map((version) => {
      if (typeof version.content !== 'string') {
        return `Artifact ${version.artifactId}@${version.version}: [content reference omitted]`;
      }
      return `Artifact ${version.artifactId}@${version.version}:\n${version.content}`;
    })
    .join('\n\n');
  return [
    `Step: ${context.step.title}`,
    context.step.instructions,
    inputs ? `Dependency artifacts:\n${inputs}` : 'Dependency artifacts: none',
  ].join('\n\n');
}

function materializeExecutionResult(
  context: StepExecutionContext,
  result: ProductionExecutionResult,
): StepExecutionResult {
  if (result.outputVersions.length !== 1) {
    throw new StepExecutionError(
      'Production reservation has an invalid output count',
      'acceptance',
    );
  }
  const output = result.outputVersions[0]!;
  if (context.reviewContext?.kind === 'reviewer') {
    return { reviewOutcome: parseReviewOutcome(output.content, context) };
  }
  if (context.reviewContext?.kind === 'rework') {
    return { outputVersions: materializeReworkOutputs(context, output) };
  }
  return { outputVersions: result.outputVersions };
}

function materializeReworkOutputs(
  context: StepExecutionContext,
  output: ProductionExecutionResult['outputVersions'][number],
): readonly StepArtifactVersionOutput[] {
  if (context.reviewContext?.kind !== 'rework') {
    throw new StepExecutionError('Persisted rework context is unavailable', 'acceptance');
  }
  const reviewedIds = context.reviewContext.evidence.reviewedArtifactVersionIds;
  const structured = parseStructuredReworkRevisions(output.content, context, output.metadata);
  if (structured) return structured;
  if (reviewedIds.length !== 1) {
    throw new StepExecutionError(
      'Production multi-artifact rework requires structured revisions JSON',
      'acceptance',
    );
  }
  const parent = context.artifactVersions.find((version) => version.id === reviewedIds[0]);
  if (!parent) {
    throw new StepExecutionError(
      'Exact reviewed ArtifactVersion is unavailable to production rework',
      'acceptance',
    );
  }
  return [
    {
      artifactId: parent.artifactId,
      content: output.content,
      mimeType: output.mimeType,
      status: output.status,
      parentVersionIds: [parent.id],
      ...(output.metadata ? { metadata: output.metadata } : {}),
    },
  ];
}

function parseStructuredReworkRevisions(
  content: string,
  context: StepExecutionContext,
  executionMetadata?: Record<string, JsonValue>,
): readonly StepArtifactVersionOutput[] | undefined {
  if (context.reviewContext?.kind !== 'rework') return undefined;
  const requiresStructure = context.reviewContext.evidence.reviewedArtifactVersionIds.length !== 1;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    if (requiresStructure) {
      throw new StepExecutionError(
        'Production rework returned invalid revisions JSON',
        'acceptance',
      );
    }
    return undefined;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !Object.prototype.hasOwnProperty.call(parsed, 'revisions')
  ) {
    if (requiresStructure) {
      throw new StepExecutionError(
        'Production rework returned an invalid revisions shape',
        'acceptance',
      );
    }
    return undefined;
  }
  if (!isRecordWithOnlyKeys(parsed, ['revisions']) || !Array.isArray(parsed.revisions)) {
    throw new StepExecutionError(
      'Production rework returned an invalid revisions shape',
      'acceptance',
    );
  }
  if (parsed.revisions.length === 0) {
    throw new StepExecutionError('Production rework returned no revisions', 'acceptance');
  }

  const reviewedIds = new Set(context.reviewContext.evidence.reviewedArtifactVersionIds);
  const revisedParents = new Set<string>();
  return parsed.revisions.map((value): StepArtifactVersionOutput => {
    if (
      !isRecordWithAllowedKeys(
        value,
        ['parentArtifactVersionId', 'content'],
        ['mimeType', 'status', 'metadata'],
      )
    ) {
      throw new StepExecutionError('Production rework revision shape is invalid', 'acceptance');
    }
    const parentId = value.parentArtifactVersionId;
    if (
      typeof parentId !== 'string' ||
      !reviewedIds.has(parentId as never) ||
      revisedParents.has(parentId)
    ) {
      throw new StepExecutionError(
        'Production rework changed the exact parent assignment',
        'acceptance',
      );
    }
    revisedParents.add(parentId);
    const parent = context.artifactVersions.find((version) => version.id === parentId);
    if (!parent) {
      throw new StepExecutionError(
        'Exact reviewed ArtifactVersion is unavailable to production rework',
        'acceptance',
      );
    }
    if (
      typeof value.content !== 'string' ||
      value.content.length === 0 ||
      Buffer.byteLength(value.content, 'utf8') > MAX_INLINE_ARTIFACT_CONTENT_BYTES
    ) {
      throw new StepExecutionError('Production rework revision content is invalid', 'acceptance');
    }
    const mimeType = value.mimeType === undefined ? parent.mimeType : value.mimeType;
    if (typeof mimeType !== 'string' || !mimeType.trim() || mimeType.length > 256) {
      throw new StepExecutionError('Production rework revision MIME type is invalid', 'acceptance');
    }
    const status = value.status === undefined ? 'candidate' : value.status;
    if (!isReviewVisibleArtifactStatus(status)) {
      throw new StepExecutionError('Production rework revision status is invalid', 'acceptance');
    }
    const revisionMetadata =
      value.metadata === undefined ? undefined : jsonMetadata(value.metadata);
    const metadata = {
      ...(revisionMetadata ?? {}),
      ...(executionMetadata ?? {}),
    };
    return {
      artifactId: parent.artifactId,
      content: value.content,
      mimeType: mimeType.trim(),
      status,
      parentVersionIds: [parent.id],
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
  });
}

function isRecordWithAllowedKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.has(key));
}

function isReviewVisibleArtifactStatus(value: unknown): value is ArtifactVersionStatus {
  return value === 'candidate' || value === 'selected' || value === 'merged';
}

function jsonMetadata(value: unknown): Record<string, JsonValue> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new StepExecutionError('Production rework revision metadata is invalid', 'acceptance');
  }
  const metadata = value as Record<string, unknown>;
  if (!Object.values(metadata).every((entry) => isJsonValue(entry))) {
    throw new StepExecutionError('Production rework revision metadata is invalid', 'acceptance');
  }
  return metadata as Record<string, JsonValue>;
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1));
  if (typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).every((entry) =>
    isJsonValue(entry, depth + 1),
  );
}

function parseReviewOutcome(content: string, context: StepExecutionContext): ReviewOutcome {
  if (context.reviewContext?.kind !== 'reviewer') {
    throw new StepExecutionError('Persisted reviewer context is unavailable', 'acceptance');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new StepExecutionError('Production reviewer returned invalid JSON', 'acceptance');
  }
  if (
    !isRecordWithOnlyKeys(parsed, [
      'verdict',
      'explanation',
      'criteria',
      'reviewedArtifactVersionIds',
    ])
  ) {
    throw new StepExecutionError(
      'Production reviewer returned an invalid outcome shape',
      'acceptance',
    );
  }
  if (parsed.verdict !== 'accept' && parsed.verdict !== 'reject') {
    throw new StepExecutionError('Production reviewer returned an invalid verdict', 'acceptance');
  }
  const explanation = boundedReviewText(parsed.explanation, 'review explanation');
  if (!Array.isArray(parsed.criteria)) {
    throw new StepExecutionError('Production reviewer criteria are invalid', 'acceptance');
  }
  const byId = new Map<string, ReviewOutcome['criteria'][number]>();
  for (const value of parsed.criteria) {
    if (!isRecordWithOnlyKeys(value, ['criterionId', 'verdict', 'explanation'])) {
      throw new StepExecutionError('Production reviewer criterion shape is invalid', 'acceptance');
    }
    if (typeof value.criterionId !== 'string' || byId.has(value.criterionId)) {
      throw new StepExecutionError(
        'Production reviewer criterion identity is invalid',
        'acceptance',
      );
    }
    if (value.verdict !== 'pass' && value.verdict !== 'fail') {
      throw new StepExecutionError(
        'Production reviewer criterion verdict is invalid',
        'acceptance',
      );
    }
    byId.set(value.criterionId, {
      criterionId: value.criterionId,
      verdict: value.verdict,
      explanation: boundedReviewText(value.explanation, 'criterion explanation'),
    });
  }
  const criteria = context.reviewContext.criteria.map((criterion) => {
    const result = byId.get(criterion.id);
    if (!result) {
      throw new StepExecutionError('Production reviewer omitted an exact criterion', 'acceptance');
    }
    return result;
  });
  if (criteria.length !== byId.size || !Array.isArray(parsed.reviewedArtifactVersionIds)) {
    throw new StepExecutionError(
      'Production reviewer assignment does not match criteria',
      'acceptance',
    );
  }
  const expectedVersionIds = context.reviewContext.reviewedArtifactVersions.map(
    (version) => version.id,
  );
  if (
    parsed.reviewedArtifactVersionIds.length !== expectedVersionIds.length ||
    parsed.reviewedArtifactVersionIds.some((id, index) => id !== expectedVersionIds[index])
  ) {
    throw new StepExecutionError(
      'Production reviewer changed the exact ArtifactVersion assignment',
      'acceptance',
    );
  }
  const outcome: ReviewOutcome = {
    verdict: parsed.verdict,
    explanation,
    criteria,
    reviewedArtifactVersionIds: expectedVersionIds,
  };
  if (!isReviewOutcomeConsistent(outcome)) {
    throw new StepExecutionError(
      'Production reviewer verdict contradicts criterion outcomes',
      'acceptance',
    );
  }
  return outcome;
}

function isRecordWithOnlyKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function boundedReviewText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 4_000) {
    throw new StepExecutionError(`Production reviewer ${label} is invalid`, 'acceptance');
  }
  return text;
}

async function collectProviderOutput(
  stream: AsyncIterable<AdapterEvent>,
  signal: AbortSignal,
): Promise<string | typeof ABORTED> {
  const iterator = stream[Symbol.asyncIterator]();
  let output = '';
  let finished = false;
  try {
    while (true) {
      const next = await nextWithAbort(iterator, signal);
      if (next === ABORTED) return ABORTED;
      if (next.done) break;
      const event = next.value;
      if (event.type === 'text-delta') {
        output += event.text;
        if (Buffer.byteLength(output, 'utf8') > MAX_INLINE_ARTIFACT_CONTENT_BYTES) {
          throw new StepExecutionError(
            'Production adapter output exceeds the inline artifact limit',
            'acceptance',
          );
        }
      } else if (event.type === 'error') {
        throw new StepExecutionError(event.message, event.failureClass);
      } else if (event.type === 'tool-call' || event.type === 'tool-result') {
        throw new StepExecutionError(
          'Production provider requested a tool but no Step tool adapter is configured',
          'permission',
        );
      } else if (event.type === 'image-ready') {
        throw new StepExecutionError(
          'Production provider returned an image but no Step image artifact adapter is configured',
          'acceptance',
        );
      } else if (event.type === 'finished') {
        if (event.reason === 'tool-requests') {
          throw new StepExecutionError(
            'Production provider requires a Step tool adapter',
            'permission',
          );
        }
        finished = true;
        break;
      }
    }
  } finally {
    await closeAdapterIterator(iterator);
  }
  if (!finished) {
    throw new StepExecutionError('Production adapter stream ended without completion', 'protocol');
  }
  return output.trim();
}

async function nextWithAbort(
  iterator: AsyncIterator<AdapterEvent>,
  signal: AbortSignal,
): Promise<IteratorResult<AdapterEvent> | typeof ABORTED> {
  if (signal.aborted) return ABORTED;
  let onAbort!: () => void;
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([iterator.next(), aborted]);
    return result;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function closeAdapterIterator(iterator: AsyncIterator<AdapterEvent>): Promise<void> {
  if (!iterator.return) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      iterator.return().then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1_000);
        if (typeof timer === 'object' && 'unref' in timer) timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function executionFence(context: StepExecutionContext) {
  if (!context.step.executionOwnerId || context.step.executionAttempt < 1) {
    throw new StepExecutionError('Production Step execution fence is unavailable', 'acceptance');
  }
  return {
    runId: context.runId,
    stepId: context.step.id,
    agentVersionId: context.step.agentVersionId,
    ownerId: context.step.executionOwnerId,
    executionAttempt: context.step.executionAttempt,
  };
}

function releaseApprovalReservation(
  store: SqliteProductionExecutionStore,
  context: StepExecutionContext,
): void {
  if (
    !(context.signal.reason instanceof Error) ||
    context.signal.reason.message !== 'step.awaiting_approval'
  ) {
    return;
  }
  try {
    store.releaseProviderExecution({
      ...executionFence(context),
      idempotencyKey: context.idempotencyKey,
    });
  } catch {
    // A concurrent completion/cancel keeps the durable record authoritative.
  }
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new StepExecutionError('Step execution was aborted', 'unknown');
}

function unavailable(message: string): StepExecutionError {
  return new StepExecutionError(message, 'acceptance');
}

function failureClassOf(error: unknown): FailureClass {
  if (error && typeof error === 'object' && 'failureClass' in error) {
    const value = (error as { failureClass?: unknown }).failureClass;
    if (
      value === 'transient' ||
      value === 'auth' ||
      value === 'protocol' ||
      value === 'permission' ||
      value === 'acceptance' ||
      value === 'rate-limit' ||
      value === 'timeout' ||
      value === 'unknown'
    ) {
      return value;
    }
  }
  return 'unknown';
}
