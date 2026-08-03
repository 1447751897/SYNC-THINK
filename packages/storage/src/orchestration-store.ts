import { createHash } from 'node:crypto';
import {
  MAX_REVIEW_ITERATIONS,
  isImageGenerationConfig,
  isReviewOutcomeConsistent,
  nextReviewAction,
  normalizeAcceptanceCriteria,
  ulid,
  type AcceptanceCriterion,
  type AcceptanceGate,
  type AcceptanceGateId,
  type AgentVersionId,
  type ArtifactId,
  type ArtifactVersion,
  type ArtifactVersionId,
  type ArtifactVersionStatus,
  type Event,
  type FailureClass,
  type ImageGenerationConfig,
  type JsonValue,
  type ModelId,
  type PlanDiff,
  type PlanId,
  type PlanRevision,
  type PlanRevisionId,
  type PlanRevisionState,
  type PlanStepChange,
  type PlanStepChangedField,
  type PlanStepDraft,
  type Run,
  type RunId,
  type RunState,
  type ReviewEvidence,
  type ReviewLimitAction,
  type ReviewOutcome,
  type ReviewStepExecutionContext,
  type Step,
  type StepId,
  type StepState,
  type TaskId,
  type WorkflowVersionId,
  type WorkspaceId,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';
import { SqliteArtifactStore } from './artifact-store.js';
import { scrubDiagnosticText } from './memory-store.js';
import {
  SqliteEventCheckpointStore,
  type EventDraft,
  type EventDraftBatch,
} from './runtime-state-store.js';

export interface CreatePlanDraftInput {
  taskId: TaskId;
  title: string;
  steps: readonly PlanStepDraft[];
  now?: string;
}

export interface RevisePlanInput {
  planId: PlanId;
  expectedRevision: number;
  title?: string;
  steps: readonly PlanStepDraft[];
  now?: string;
}

export interface ApprovePlanInput {
  planId: PlanId;
  revision: number;
  now?: string;
}

export interface StoredStep extends Step {
  planOrder: number;
  title: string;
  instructions: string;
  modelOverrideId?: ModelId;
  executionOwnerId?: string;
  leaseExpiresAt?: string;
  executionAttempt: number;
}

export interface StepDependencyRecord {
  runId: RunId;
  stepId: StepId;
  dependsOnStepId: StepId;
}

export interface RunGraph {
  run: Run;
  steps: StoredStep[];
  dependencies: StepDependencyRecord[];
}

export interface ClaimReadyStepsInput {
  runId: RunId;
  stepIds: readonly StepId[];
  ownerId: string;
  leaseExpiresAt: string;
  now?: string;
}

export interface ClaimReadyStepsResult {
  graph: RunGraph;
  claimedSteps: StoredStep[];
  artifactVersionsByStep: ReadonlyMap<StepId, ArtifactVersion[]>;
}

export type PrepareReviewStepForExecutionResult =
  | { status: 'ready'; graph: RunGraph; context?: ReviewStepExecutionContext }
  | {
      status: 'image-selection-required';
      graph: RunGraph;
      artifactIds: ArtifactId[];
      candidateVersionIds: ArtifactVersionId[];
    };

export const MAX_STEP_SNAPSHOT_VERSIONS = 32;
export const MAX_STEP_SNAPSHOT_INLINE_BYTES = 256 * 1024;
const LEGACY_TERMINAL_EXECUTION_OWNER = 'migration:0014:legacy-terminal';

export interface RefreshStepLeaseInput {
  runId: RunId;
  stepId: StepId;
  ownerId: string;
  executionAttempt: number;
  leaseExpiresAt: string;
  now?: string;
}

interface StepArtifactVersionOutputBase {
  content?: string;
  contentRef?: string;
  contentHash?: string;
  mimeType: string;
  status: ArtifactVersionStatus;
  parentVersionIds?: readonly import('@sync-think/shared').ArtifactVersionId[];
  metadata?: Record<string, JsonValue>;
  /** Groups multiple outputs into immutable versions of one newly-created Artifact. */
  artifactGroupKey?: string;
}

export type StepArtifactVersionOutput = StepArtifactVersionOutputBase &
  ({ artifactId: ArtifactId; artifactName?: never } | { artifactName: string; artifactId?: never });

export interface CompleteStepInput {
  runId: RunId;
  stepId: StepId;
  idempotencyKey: string;
  ownerId: string;
  executionAttempt: number;
  outputVersions?: readonly StepArtifactVersionOutput[];
  now?: string;
}

export interface CompleteStepResult {
  graph: RunGraph;
  outputVersions: ArtifactVersion[];
  replayed: boolean;
}

export interface CompleteMergeStepInput {
  runId: RunId;
  stepId: StepId;
  now?: string;
}

export interface CreateAcceptanceGateInput {
  id: AcceptanceGateId;
  runId: RunId;
  targetStepId: StepId;
  reviewerAgentVersionId: AgentVersionId;
  initialReviewerStepId?: StepId;
  backupAgentVersionId?: AgentVersionId;
  maxIterations: number;
  onLimitReached: ReviewLimitAction;
  criteria: ReadonlyArray<{ id: string; description: string }>;
  now?: string;
}

export interface CompleteReviewStepInput {
  runId: RunId;
  stepId: StepId;
  idempotencyKey: string;
  ownerId: string;
  executionAttempt: number;
  reviewerAgentVersionId: AgentVersionId;
  outcome: ReviewOutcome;
  now?: string;
}

export interface CompleteReviewStepResult {
  graph: RunGraph;
  evidence: ReviewEvidence;
  replayed: boolean;
}

export interface FailStepInput {
  runId: RunId;
  stepId: StepId;
  idempotencyKey: string;
  ownerId: string;
  executionAttempt: number;
  failureClass: FailureClass;
  failureCode: string;
  summary: string;
  partialOutputVersions?: readonly StepArtifactVersionOutput[];
  now?: string;
}

export interface FailStepResult {
  graph: RunGraph;
  partialOutputVersions: ArtifactVersion[];
  replayed: boolean;
}

export interface AwaitStepApprovalInput {
  runId: RunId;
  stepId: StepId;
  approvalId: string;
  actionDigest: string;
  ownerId?: string;
  executionAttempt?: number;
  now?: string;
}

export interface ResolveStepApprovalInput {
  runId: RunId;
  stepId: StepId;
  approvalId: string;
  actionDigest: string;
  decision: 'approved' | 'rejected';
  decidedBy: 'human' | 'delegate';
  delegateAgentVersionId?: AgentVersionId;
  now?: string;
}

interface PlanRevisionDbRow {
  id: string;
  plan_id: string;
  task_id: string;
  revision: number;
  title: string;
  steps_json: string;
  diff_json: string;
  state: string;
  created_at: string;
  approved_at: string | null;
}

interface RunDbRow {
  id: string;
  task_id: string;
  plan_revision_id: string;
  workflow_version_id: string | null;
  state: string;
  created_at: string;
  updated_at: string;
}

interface StepDbRow {
  id: string;
  run_id: string;
  kind: string;
  plan_order: number;
  title: string;
  instructions: string;
  agent_version_id: string;
  model_override_id: string | null;
  image_generation_config_json: string | null;
  state: string;
  retries: number;
  retry_of_step_id: string | null;
  idempotency_key: string | null;
  execution_owner_id: string | null;
  lease_expires_at: string | null;
  execution_attempt: number;
  created_at: string;
  updated_at: string;
}

interface AcceptanceGateDbRow {
  id: string;
  run_id: string;
  target_step_id: string;
  reviewer_agent_version_id: string;
  backup_agent_version_id: string | null;
  max_iterations: number;
  on_limit_reached: string;
  state: string;
  reassigned: number;
  created_at: string;
  resolved_at: string | null;
}

interface AcceptanceGateStepDbRow {
  gate_id: string;
  run_id: string;
  step_id: string;
  role: 'reviewer' | 'rework';
  iteration: number;
  derivation: 'initial' | 'rework' | 'reassign';
  source_evidence_id: string | null;
}

interface ReviewEvidenceDbRow {
  id: string;
  gate_id: string;
  run_id: string;
  target_step_id: string;
  reviewer_step_id: string;
  reviewer_agent_version_id: string;
  iteration: number;
  verdict: 'accept' | 'reject';
  explanation: string;
  created_at: string;
}

const PLAN_REVISION_COLUMNS = `
  revision_row.id, revision_row.plan_id, plan_row.task_id, revision_row.revision,
  revision_row.title, revision_row.steps_json, revision_row.diff_json,
  revision_row.state, revision_row.created_at, revision_row.approved_at
`;

const RUN_COLUMNS = `
  id, task_id, plan_revision_id, workflow_version_id, state, created_at, updated_at
`;

const STEP_COLUMNS = `
  id, run_id, kind, plan_order, title, instructions, agent_version_id, model_override_id,
  image_generation_config_json, state, retries, retry_of_step_id, idempotency_key, execution_owner_id,
  lease_expires_at, execution_attempt, created_at, updated_at
`;

export type OrchestrationDataErrorCode =
  | 'plan.invalid_input'
  | 'plan.invalid_steps_json'
  | 'plan.invalid_diff_json'
  | 'plan.invalid_revision_state'
  | 'run.invalid_state'
  | 'step.invalid_state'
  | 'step.invalid_image_generation_config'
  | 'step.invalid_idempotency_key';

export class OrchestrationDataError extends Error {
  override readonly name = 'OrchestrationDataError';

  constructor(
    readonly code: OrchestrationDataErrorCode,
    readonly path: string,
    detail?: string,
  ) {
    super(`${code}: ${path}${detail ? ` (${detail})` : ''}`);
  }
}

export type OrchestrationDomainErrorCode =
  | 'review.verdict_invalid'
  | 'review.explanation_invalid'
  | 'review.criteria_mismatch'
  | 'review.criterion_id_invalid'
  | 'review.criterion_verdict_invalid'
  | 'review.criterion_explanation_invalid'
  | 'review.verdict_criteria_mismatch'
  | 'review.artifact_scope_mismatch';

export class OrchestrationDomainError extends Error {
  override readonly name = 'OrchestrationDomainError';
  readonly failureClass = 'acceptance' as const;

  constructor(readonly code: OrchestrationDomainErrorCode) {
    super(code);
  }
}

export function isOrchestrationDomainError(error: unknown): error is OrchestrationDomainError {
  return error instanceof OrchestrationDomainError;
}

export class StepSnapshotLimitError extends Error {
  override readonly name = 'StepSnapshotLimitError';
  readonly code = 'step.snapshot_limit_exceeded';
  readonly failureClass = 'acceptance' as const;

  constructor(
    readonly stepId: StepId,
    readonly limit: 'versions' | 'inline_bytes',
  ) {
    super(`step.snapshot_limit_exceeded: ${stepId}:${limit}`);
  }
}

export function isStepSnapshotLimitError(error: unknown): error is StepSnapshotLimitError {
  return error instanceof StepSnapshotLimitError;
}

export class StepFenceMismatchError extends Error {
  override readonly name = 'StepFenceMismatchError';
  readonly code = 'step.fence_mismatch';

  constructor(readonly stepId: StepId) {
    super(`step.fence_mismatch: ${stepId}`);
  }
}

export function isStepFenceMismatchError(error: unknown): error is StepFenceMismatchError {
  return error instanceof StepFenceMismatchError;
}

const PLAN_STEP_CHANGED_FIELDS = new Set<PlanStepChangedField>([
  'kind',
  'title',
  'instructions',
  'agentVersionId',
  'modelOverrideId',
  'imageGeneration',
  'dependsOn',
  'planOrder',
]);

const RUN_STATES = new Set<RunState>([
  'conversation',
  'planDraft',
  'awaitingPlanApproval',
  'queued',
  'running',
  'awaitingToolApproval',
  'reviewing',
  'revising',
  'completed',
  'paused',
  'blocked',
  'failed',
  'cancelled',
]);

const STEP_STATES = new Set<StepState>([
  'pending',
  'ready',
  'running',
  'awaitingApproval',
  'completed',
  'failed',
  'skipped',
  'cancelled',
]);

function requireText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`plan.${field}_required`);
  return text;
}

function requireRevision(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`plan.${field}_invalid`);
  return value;
}

function cloneStep(step: PlanStepDraft): PlanStepDraft {
  return {
    ...step,
    ...(step.imageGeneration ? { imageGeneration: { ...step.imageGeneration } } : {}),
    dependsOn: [...step.dependsOn],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function persistedString(value: unknown, code: OrchestrationDataErrorCode, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OrchestrationDataError(code, path, 'expected non-empty string');
  }
  return value.trim();
}

function persistedIdempotencyKey(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
    throw new OrchestrationDataError(
      'step.invalid_idempotency_key',
      'step.idempotencyKey',
      'expected a non-empty string of at most 256 characters',
    );
  }
  return value;
}

function stableStepIdempotencyKey(runId: RunId, stepId: StepId): string {
  return createHash('sha256')
    .update(JSON.stringify([runId, stepId]))
    .digest('hex');
}

function stableDerivedReviewStepId(
  gateId: AcceptanceGateId,
  role: 'reviewer' | 'rework',
  iteration: number,
  derivation: 'initial' | 'rework' | 'reassign',
): StepId {
  const digest = createHash('sha256')
    .update(JSON.stringify([gateId, role, iteration, derivation]))
    .digest('hex')
    .slice(0, 26);
  return `review-${digest}` as StepId;
}

function reviewText(value: unknown, code: string, maxLength = 4_000): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) throw new Error(code);
  return text;
}

function reviewOutcomeText(
  value: unknown,
  code: OrchestrationDomainErrorCode,
  maxLength = 4_000,
): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) throw new OrchestrationDomainError(code);
  return text;
}

function mapAcceptanceGate(
  row: AcceptanceGateDbRow,
  criteria: AcceptanceCriterion[],
): AcceptanceGate {
  if (
    row.on_limit_reached !== 'pause' &&
    row.on_limit_reached !== 'abort' &&
    row.on_limit_reached !== 'reassign'
  ) {
    throw new Error(`review.gate_invalid_limit_action: ${row.id}`);
  }
  if (row.state !== 'active' && row.state !== 'accepted' && row.state !== 'limit-reached') {
    throw new Error(`review.gate_invalid_state: ${row.id}`);
  }
  if (
    !Number.isSafeInteger(row.max_iterations) ||
    row.max_iterations < 0 ||
    row.max_iterations > MAX_REVIEW_ITERATIONS
  ) {
    throw new Error('review.max_iterations_invalid');
  }
  if (row.reassigned !== 0 && row.reassigned !== 1) {
    throw new Error(`review.gate_invalid_reassigned: ${row.id}`);
  }
  return {
    id: row.id as AcceptanceGateId,
    runId: row.run_id as RunId,
    targetStepId: row.target_step_id as StepId,
    reviewerAgentVersionId: row.reviewer_agent_version_id as AgentVersionId,
    ...(row.backup_agent_version_id
      ? { backupAgentVersionId: row.backup_agent_version_id as AgentVersionId }
      : {}),
    maxIterations: row.max_iterations,
    onLimitReached: row.on_limit_reached,
    state: row.state,
    reassigned: row.reassigned === 1,
    criteria,
    createdAt: row.created_at,
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
  };
}

function executionOwnerId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw new Error('step.execution_owner_invalid');
  }
  if (value === LEGACY_TERMINAL_EXECUTION_OWNER) {
    throw new Error('step.execution_owner_reserved');
  }
  return value;
}

function executionAttempt(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error('step.execution_attempt_invalid');
  }
  return value as number;
}

function isCanonicalIsoInstant(value: unknown): value is string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(value ?? ''))) {
    return false;
  }
  const timestamp = Date.parse(value as string);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function persistedPlanOrder(
  value: unknown,
  code: OrchestrationDataErrorCode,
  path: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new OrchestrationDataError(code, path, 'expected non-negative integer');
  }
  return value as number;
}

function decodeImageGenerationConfig(
  value: unknown,
  code: OrchestrationDataErrorCode,
  path: string,
): ImageGenerationConfig {
  if (!isImageGenerationConfig(value)) {
    throw new OrchestrationDataError(code, path, 'expected exact size, quality, and count fields');
  }
  return { ...value };
}

function decodePlanStep(
  value: unknown,
  code: OrchestrationDataErrorCode,
  path: string,
): PlanStepDraft {
  if (!isRecord(value)) {
    throw new OrchestrationDataError(code, path, 'expected object');
  }
  const modelOverrideId =
    value.modelOverrideId === undefined
      ? undefined
      : (persistedString(value.modelOverrideId, code, `${path}.modelOverrideId`) as ModelId);
  const kind = value.kind ?? 'execution';
  if (kind !== 'execution' && kind !== 'merge') {
    throw new OrchestrationDataError(code, `${path}.kind`, 'expected execution or merge');
  }
  const imageGeneration =
    value.imageGeneration === undefined
      ? undefined
      : decodeImageGenerationConfig(value.imageGeneration, code, `${path}.imageGeneration`);
  if (kind === 'merge' && imageGeneration) {
    throw new OrchestrationDataError(
      code,
      `${path}.imageGeneration`,
      'merge steps cannot generate images',
    );
  }
  if (!Array.isArray(value.dependsOn)) {
    throw new OrchestrationDataError(code, `${path}.dependsOn`, 'expected array');
  }
  return {
    id: persistedString(value.id, code, `${path}.id`) as StepId,
    kind,
    title: persistedString(value.title, code, `${path}.title`),
    instructions: persistedString(value.instructions, code, `${path}.instructions`),
    agentVersionId: persistedString(
      value.agentVersionId,
      code,
      `${path}.agentVersionId`,
    ) as AgentVersionId,
    ...(modelOverrideId ? { modelOverrideId } : {}),
    ...(imageGeneration ? { imageGeneration } : {}),
    dependsOn: value.dependsOn.map(
      (dependencyId, index) =>
        persistedString(dependencyId, code, `${path}.dependsOn[${index}]`) as StepId,
    ),
  };
}

function assertStepGraph(
  steps: readonly PlanStepDraft[],
  persistedCode?: OrchestrationDataErrorCode,
): void {
  const ids = new Set<StepId>();
  const indexById = new Map<StepId, number>();
  for (const [index, step] of steps.entries()) {
    if (ids.has(step.id)) {
      if (persistedCode) {
        throw new OrchestrationDataError(persistedCode, `steps[${index}].id`, 'duplicate step id');
      }
      throw new Error(`plan.duplicate_step_id: ${step.id}`);
    }
    ids.add(step.id);
    indexById.set(step.id, index);
  }
  for (const [stepIndex, step] of steps.entries()) {
    if (step.kind === 'merge' && step.dependsOn.length < 2) {
      const path = `steps[${stepIndex}].dependsOn`;
      if (persistedCode) {
        throw new OrchestrationDataError(
          persistedCode,
          path,
          'merge Step requires at least two producer dependencies',
        );
      }
      throw new Error(`plan.merge_dependencies_required: ${step.id}`);
    }
    const dependencies = new Set<StepId>();
    for (const [dependencyIndex, dependencyId] of step.dependsOn.entries()) {
      const path = `steps[${stepIndex}].dependsOn[${dependencyIndex}]`;
      if (dependencyId === step.id) {
        if (persistedCode) throw new OrchestrationDataError(persistedCode, path, 'self dependency');
        throw new Error(`plan.self_dependency: ${step.id}`);
      }
      if (dependencies.has(dependencyId)) {
        if (persistedCode) {
          throw new OrchestrationDataError(persistedCode, path, 'duplicate dependency');
        }
        throw new Error(`plan.duplicate_dependency: ${step.id} -> ${dependencyId}`);
      }
      if (!ids.has(dependencyId)) {
        if (persistedCode) {
          throw new OrchestrationDataError(persistedCode, path, 'missing dependency');
        }
        throw new Error(`plan.missing_dependency: ${step.id} -> ${dependencyId}`);
      }
      dependencies.add(dependencyId);
    }
  }

  const dependenciesById = new Map(steps.map((step) => [step.id, step.dependsOn]));
  const visiting = new Set<StepId>();
  const visited = new Set<StepId>();
  const visit = (stepId: StepId): void => {
    if (visiting.has(stepId)) {
      if (persistedCode) {
        throw new OrchestrationDataError(
          persistedCode,
          `steps[${indexById.get(stepId) ?? 0}].dependsOn`,
          'cycle',
        );
      }
      throw new Error(`plan.cycle: ${stepId}`);
    }
    if (visited.has(stepId)) return;
    visiting.add(stepId);
    for (const dependencyId of dependenciesById.get(stepId) ?? []) visit(dependencyId);
    visiting.delete(stepId);
    visited.add(stepId);
  };
  for (const step of steps) visit(step.id);
}

function assertValidSteps(steps: readonly PlanStepDraft[]): PlanStepDraft[] {
  if (!Array.isArray(steps)) {
    throw new OrchestrationDataError('plan.invalid_input', 'steps', 'expected array');
  }
  if (steps.length === 0) throw new Error('plan.steps_required');
  const cloned = steps.map((step, index) =>
    decodePlanStep(step, 'plan.invalid_input', `steps[${index}]`),
  );
  assertStepGraph(cloned);
  return cloned;
}

function sameDependencies(left: readonly StepId[], right: readonly StepId[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}

function getChangedFields(
  before: PlanStepDraft,
  after: PlanStepDraft,
  beforePlanOrder: number,
  afterPlanOrder: number,
): PlanStepChangedField[] {
  const fields: PlanStepChangedField[] = [];
  if ((before.kind ?? 'execution') !== (after.kind ?? 'execution')) fields.push('kind');
  if (before.title !== after.title) fields.push('title');
  if (before.instructions !== after.instructions) fields.push('instructions');
  if (before.agentVersionId !== after.agentVersionId) fields.push('agentVersionId');
  if (before.modelOverrideId !== after.modelOverrideId) fields.push('modelOverrideId');
  if (
    JSON.stringify(before.imageGeneration ?? null) !== JSON.stringify(after.imageGeneration ?? null)
  ) {
    fields.push('imageGeneration');
  }
  if (!sameDependencies(before.dependsOn, after.dependsOn)) fields.push('dependsOn');
  if (beforePlanOrder !== afterPlanOrder) fields.push('planOrder');
  return fields;
}

function diffPlanSteps(
  previous: readonly PlanStepDraft[],
  next: readonly PlanStepDraft[],
): PlanDiff {
  const previousById = new Map(previous.map((step, index) => [step.id, { step, index }]));
  const nextById = new Map(next.map((step, index) => [step.id, { step, index }]));
  const added = next.filter((step) => !previousById.has(step.id)).map(cloneStep);
  const removed = previous.filter((step) => !nextById.has(step.id)).map(cloneStep);
  const changed: PlanStepChange[] = [];

  for (const [afterPlanOrder, after] of next.entries()) {
    const prior = previousById.get(after.id);
    if (!prior) continue;
    const fields = getChangedFields(prior.step, after, prior.index, afterPlanOrder);
    if (fields.length > 0) {
      changed.push({
        id: after.id,
        before: cloneStep(prior.step),
        after: cloneStep(after),
        changedFields: fields,
        beforePlanOrder: prior.index,
        afterPlanOrder,
      });
    }
  }
  return { added, removed, changed };
}

function parseJson(raw: string, code: OrchestrationDataErrorCode, path: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new OrchestrationDataError(code, path, 'invalid JSON');
  }
}

function parseSteps(raw: string): PlanStepDraft[] {
  const code = 'plan.invalid_steps_json';
  const parsed = parseJson(raw, code, 'steps');
  if (!Array.isArray(parsed)) throw new OrchestrationDataError(code, 'steps', 'expected array');
  const steps = parsed.map((step, index) => decodePlanStep(step, code, `steps[${index}]`));
  assertStepGraph(steps, code);
  return steps;
}

function parseDiff(raw: string): PlanDiff {
  const code = 'plan.invalid_diff_json';
  const parsed = parseJson(raw, code, 'diff');
  if (!isRecord(parsed)) throw new OrchestrationDataError(code, 'diff', 'expected object');
  const decodeStepArray = (field: 'added' | 'removed'): PlanStepDraft[] => {
    const value = parsed[field];
    const path = `diff.${field}`;
    if (!Array.isArray(value)) throw new OrchestrationDataError(code, path, 'expected array');
    const steps = value.map((step, index) => decodePlanStep(step, code, `${path}[${index}]`));
    const seen = new Set<StepId>();
    for (const [index, step] of steps.entries()) {
      if (seen.has(step.id)) {
        throw new OrchestrationDataError(code, `${path}[${index}].id`, 'duplicate step id');
      }
      seen.add(step.id);
    }
    return steps;
  };
  const added = decodeStepArray('added');
  const removed = decodeStepArray('removed');
  if (!Array.isArray(parsed.changed)) {
    throw new OrchestrationDataError(code, 'diff.changed', 'expected array');
  }
  const changed = parsed.changed.map((value, index): PlanStepChange => {
    const path = `diff.changed[${index}]`;
    if (!isRecord(value)) throw new OrchestrationDataError(code, path, 'expected object');
    const id = persistedString(value.id, code, `${path}.id`) as StepId;
    const before = decodePlanStep(value.before, code, `${path}.before`);
    const after = decodePlanStep(value.after, code, `${path}.after`);
    if (before.id !== id) {
      throw new OrchestrationDataError(code, `${path}.before.id`, 'must match change id');
    }
    if (after.id !== id) {
      throw new OrchestrationDataError(code, `${path}.after.id`, 'must match change id');
    }
    if (!Array.isArray(value.changedFields)) {
      throw new OrchestrationDataError(code, `${path}.changedFields`, 'expected array');
    }
    const changedFields = value.changedFields.map((field, fieldIndex) => {
      if (
        typeof field !== 'string' ||
        !PLAN_STEP_CHANGED_FIELDS.has(field as PlanStepChangedField)
      ) {
        throw new OrchestrationDataError(
          code,
          `${path}.changedFields[${fieldIndex}]`,
          'unsupported field',
        );
      }
      return field as PlanStepChangedField;
    });
    if (changedFields.length === 0 || new Set(changedFields).size !== changedFields.length) {
      throw new OrchestrationDataError(
        code,
        `${path}.changedFields`,
        'must be non-empty and unique',
      );
    }
    const beforePlanOrder = persistedPlanOrder(
      value.beforePlanOrder,
      code,
      `${path}.beforePlanOrder`,
    );
    const afterPlanOrder = persistedPlanOrder(value.afterPlanOrder, code, `${path}.afterPlanOrder`);
    const actualFields = getChangedFields(before, after, beforePlanOrder, afterPlanOrder);
    if (
      actualFields.length !== changedFields.length ||
      actualFields.some((field) => !changedFields.includes(field))
    ) {
      throw new OrchestrationDataError(
        code,
        `${path}.changedFields`,
        'does not match before/after',
      );
    }
    return {
      id,
      before,
      after,
      changedFields,
      beforePlanOrder,
      afterPlanOrder,
    };
  });
  const ids = new Set<StepId>();
  for (const [section, entries] of [
    ['added', added],
    ['removed', removed],
    ['changed', changed],
  ] as const) {
    for (const [index, entry] of entries.entries()) {
      if (ids.has(entry.id)) {
        throw new OrchestrationDataError(
          code,
          `diff.${section}[${index}].id`,
          'step id appears in multiple diff sections',
        );
      }
      ids.add(entry.id);
    }
  }
  return { added, removed, changed };
}

function asRevisionState(value: string): PlanRevisionState {
  if (value === 'draft' || value === 'approved' || value === 'superseded') return value;
  throw new OrchestrationDataError('plan.invalid_revision_state', 'planRevision.state', value);
}

function asRunState(value: string): RunState {
  if (RUN_STATES.has(value as RunState)) return value as RunState;
  throw new OrchestrationDataError('run.invalid_state', 'run.state', value);
}

function asStepState(value: string): StepState {
  if (STEP_STATES.has(value as StepState)) return value as StepState;
  throw new OrchestrationDataError('step.invalid_state', 'step.state', value);
}

function mapPlanRevision(row: PlanRevisionDbRow): PlanRevision {
  return {
    id: row.id as PlanRevisionId,
    planId: row.plan_id as PlanId,
    taskId: row.task_id as TaskId,
    revision: row.revision,
    title: row.title,
    steps: parseSteps(row.steps_json),
    diffFromPrevious: parseDiff(row.diff_json),
    state: asRevisionState(row.state),
    createdAt: row.created_at,
    approvedAt: row.approved_at ?? undefined,
  };
}

function mapStep(row: StepDbRow, dependsOn: StepId[]): StoredStep {
  if (row.kind !== 'execution' && row.kind !== 'merge') {
    throw new OrchestrationDataError('step.invalid_state', 'step.kind', 'unknown Step kind');
  }
  const imageGeneration = row.image_generation_config_json
    ? decodeImageGenerationConfig(
        parseJson(
          row.image_generation_config_json,
          'step.invalid_image_generation_config',
          'step.imageGeneration',
        ),
        'step.invalid_image_generation_config',
        'step.imageGeneration',
      )
    : undefined;
  if (row.kind === 'merge' && imageGeneration) {
    throw new OrchestrationDataError(
      'step.invalid_image_generation_config',
      'step.imageGeneration',
      'merge steps cannot generate images',
    );
  }
  return {
    id: row.id as StepId,
    runId: row.run_id as RunId,
    kind: row.kind,
    planOrder: row.plan_order,
    title: row.title,
    instructions: row.instructions,
    agentVersionId: row.agent_version_id as AgentVersionId,
    modelOverrideId: (row.model_override_id as ModelId | null) ?? undefined,
    ...(imageGeneration ? { imageGeneration } : {}),
    retryOfStepId: (row.retry_of_step_id as StepId | null) ?? undefined,
    dependsOn,
    state: asStepState(row.state),
    retries: row.retries,
    idempotencyKey: persistedIdempotencyKey(row.idempotency_key),
    executionOwnerId: row.execution_owner_id ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    executionAttempt: row.execution_attempt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isReviewableImageMimeType(value: string): boolean {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp';
}

export class SqliteOrchestrationStore {
  private readonly artifactStore: SqliteArtifactStore;
  private readonly stateStore: SqliteEventCheckpointStore;

  constructor(private readonly raw: BetterSQLite3Raw) {
    this.artifactStore = new SqliteArtifactStore(raw);
    this.stateStore = new SqliteEventCheckpointStore(raw);
  }

  createPlanDraft(input: CreatePlanDraftInput): PlanRevision {
    const task = this.raw.prepare('SELECT id FROM task WHERE id = ?').get(input.taskId);
    if (!task) throw new Error(`Task not found: ${input.taskId}`);
    const title = requireText(input.title, 'title');
    const steps = assertValidSteps(input.steps);
    const now = input.now ?? new Date().toISOString();

    const create = this.raw.transaction(() => {
      const planId = ulid() as PlanId;
      const revisionId = ulid() as PlanRevisionId;
      this.raw
        .prepare('INSERT INTO plan (id, task_id, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(planId, input.taskId, now, now);
      this.raw
        .prepare(
          `INSERT INTO plan_revision (
             id, plan_id, revision, title, steps_json, diff_json, state, created_at
           ) VALUES (?, ?, 1, ?, ?, ?, 'draft', ?)`,
        )
        .run(
          revisionId,
          planId,
          title,
          JSON.stringify(steps),
          JSON.stringify(diffPlanSteps([], steps)),
          now,
        );
      return this.getRequiredPlanRevision(planId, 1);
    });
    return create.immediate();
  }

  revisePlan(input: RevisePlanInput): PlanRevision {
    const expectedRevision = requireRevision(input.expectedRevision, 'expected_revision');
    const steps = assertValidSteps(input.steps);
    const now = input.now ?? new Date().toISOString();
    const revise = this.raw.transaction(() => {
      const latestRow = this.raw
        .prepare('SELECT MAX(revision) AS revision FROM plan_revision WHERE plan_id = ?')
        .get(input.planId) as { revision: number | null };
      if (latestRow.revision === null) throw new Error(`Plan not found: ${input.planId}`);
      if (latestRow.revision !== expectedRevision) {
        throw new Error(
          `plan.stale_revision: expected ${expectedRevision}, current ${latestRow.revision}`,
        );
      }

      const previous = this.getRequiredPlanRevision(input.planId, expectedRevision);
      const revision = expectedRevision + 1;
      const revisionId = ulid() as PlanRevisionId;
      const title = input.title === undefined ? previous.title : requireText(input.title, 'title');
      this.raw
        .prepare(
          `INSERT INTO plan_revision (
             id, plan_id, revision, title, steps_json, diff_json, state, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
        )
        .run(
          revisionId,
          input.planId,
          revision,
          title,
          JSON.stringify(steps),
          JSON.stringify(diffPlanSteps(previous.steps, steps)),
          now,
        );
      this.raw.prepare('UPDATE plan SET updated_at = ? WHERE id = ?').run(now, input.planId);
      return this.getRequiredPlanRevision(input.planId, revision);
    });
    return revise.immediate();
  }

  getPlanRevision(planId: PlanId, revision: number): PlanRevision | undefined {
    const row = this.raw
      .prepare(
        `SELECT ${PLAN_REVISION_COLUMNS}
         FROM plan_revision AS revision_row
         JOIN plan AS plan_row ON plan_row.id = revision_row.plan_id
         WHERE revision_row.plan_id = ? AND revision_row.revision = ?`,
      )
      .get(planId, revision) as PlanRevisionDbRow | undefined;
    return row ? mapPlanRevision(row) : undefined;
  }

  getPlanRevisionById(planRevisionId: PlanRevisionId): PlanRevision | undefined {
    const row = this.raw
      .prepare(
        `SELECT ${PLAN_REVISION_COLUMNS}
         FROM plan_revision AS revision_row
         JOIN plan AS plan_row ON plan_row.id = revision_row.plan_id
         WHERE revision_row.id = ?`,
      )
      .get(planRevisionId) as PlanRevisionDbRow | undefined;
    return row ? mapPlanRevision(row) : undefined;
  }

  listPlanRevisions(planId: PlanId): PlanRevision[] {
    const rows = this.raw
      .prepare(
        `SELECT ${PLAN_REVISION_COLUMNS}
         FROM plan_revision AS revision_row
         JOIN plan AS plan_row ON plan_row.id = revision_row.plan_id
         WHERE revision_row.plan_id = ?
         ORDER BY revision_row.revision ASC`,
      )
      .all(planId) as PlanRevisionDbRow[];
    return rows.map(mapPlanRevision);
  }

  approvePlan(input: ApprovePlanInput): RunGraph {
    const revisionNumber = requireRevision(input.revision, 'revision');
    const now = input.now ?? new Date().toISOString();
    const approve = this.raw.transaction(() => {
      const revision = this.getRequiredPlanRevision(input.planId, revisionNumber);
      if (revision.state === 'approved') {
        const existingRunId = this.getRunIdForPlanRevision(revision.id);
        if (!existingRunId) throw new Error(`plan.approved_run_missing: ${revision.id}`);
        return this.getRequiredGraph(existingRunId);
      }
      if (revision.state !== 'draft') {
        throw new Error(`plan.revision_not_approvable: ${revision.state}`);
      }

      const steps = assertValidSteps(revision.steps);
      for (const agentVersionId of new Set(steps.map((step) => step.agentVersionId))) {
        const exact = this.raw
          .prepare('SELECT id FROM agent_version WHERE id = ?')
          .get(agentVersionId);
        if (!exact) throw new Error(`AgentVersion not found: ${agentVersionId}`);
      }

      const runId = ulid() as RunId;
      const update = this.raw
        .prepare(
          `UPDATE plan_revision
           SET state = 'approved', approved_at = ?
           WHERE id = ? AND state = 'draft'`,
        )
        .run(now, revision.id);
      if (update.changes !== 1) throw new Error(`plan.approval_conflict: ${revision.id}`);
      this.raw
        .prepare(
          `INSERT INTO run (
             id, task_id, plan_revision_id, state, created_at, updated_at
           ) VALUES (?, ?, ?, 'queued', ?, ?)`,
        )
        .run(runId, revision.taskId, revision.id, now, now);

      const insertStep = this.raw.prepare(
        `INSERT INTO step (
           id, run_id, kind, plan_order, title, instructions, agent_version_id,
           model_override_id, image_generation_config_json, state, retries, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      );
      for (const [planOrder, step] of steps.entries()) {
        insertStep.run(
          step.id,
          runId,
          step.kind ?? 'execution',
          planOrder,
          step.title,
          step.instructions,
          step.agentVersionId,
          step.modelOverrideId ?? null,
          step.imageGeneration ? JSON.stringify(step.imageGeneration) : null,
          now,
          now,
        );
      }

      const insertDependency = this.raw.prepare(
        `INSERT INTO step_dependency (run_id, step_id, depends_on_step_id)
         VALUES (?, ?, ?)`,
      );
      for (const step of steps) {
        for (const dependencyId of step.dependsOn) {
          insertDependency.run(runId, step.id, dependencyId);
        }
      }
      return this.getRequiredGraph(runId);
    });
    return approve.immediate();
  }

  hasApprovedPlan(taskId: TaskId): boolean {
    const row = this.raw
      .prepare(
        `SELECT 1
         FROM plan_revision AS revision_row
         JOIN plan AS plan_row ON plan_row.id = revision_row.plan_id
         JOIN run AS run_row ON run_row.plan_revision_id = revision_row.id
         WHERE plan_row.task_id = ? AND revision_row.state = 'approved'
         LIMIT 1`,
      )
      .get(taskId);
    return Boolean(row);
  }

  getRun(runId: RunId): Run | undefined {
    const row = this.raw.prepare(`SELECT ${RUN_COLUMNS} FROM run WHERE id = ?`).get(runId) as
      RunDbRow | undefined;
    if (!row) return undefined;
    const stepIds = this.raw
      .prepare('SELECT id FROM step WHERE run_id = ? ORDER BY plan_order ASC')
      .all(runId)
      .map((entry) => (entry as { id: string }).id as StepId);
    return {
      id: row.id as RunId,
      taskId: row.task_id as TaskId,
      state: asRunState(row.state),
      planRevisionId: row.plan_revision_id as PlanRevisionId,
      workflowVersionId: (row.workflow_version_id as WorkflowVersionId | null) ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      stepIds,
    };
  }

  listRecoverableRunIds(): RunId[] {
    return this.raw
      .prepare(
        `SELECT id FROM run
         WHERE state IN ('queued', 'running', 'reviewing', 'revising', 'paused')
         ORDER BY created_at ASC, id ASC`,
      )
      .all()
      .map((row) => (row as { id: string }).id as RunId);
  }

  getGraph(runId: RunId): RunGraph | undefined {
    const run = this.getRun(runId);
    if (!run) return undefined;
    const dependencies = this.listDependencies(runId);
    const dependenciesByStep = new Map<StepId, StepId[]>();
    for (const dependency of dependencies) {
      const current = dependenciesByStep.get(dependency.stepId) ?? [];
      current.push(dependency.dependsOnStepId);
      dependenciesByStep.set(dependency.stepId, current);
    }
    const rows = this.raw
      .prepare(`SELECT ${STEP_COLUMNS} FROM step WHERE run_id = ? ORDER BY plan_order ASC`)
      .all(runId) as StepDbRow[];
    return {
      run,
      steps: rows.map((row) => mapStep(row, dependenciesByStep.get(row.id as StepId) ?? [])),
      dependencies,
    };
  }

  listRunArtifactVersions(runId: RunId): ArtifactVersion[] {
    const rows = this.raw
      .prepare(
        `SELECT artifact_version.id
         FROM artifact_version
         JOIN artifact ON artifact.id = artifact_version.artifact_id
         WHERE artifact.run_id = ?
         ORDER BY artifact.created_at ASC, artifact.id ASC,
           artifact_version.version ASC, artifact_version.id ASC`,
      )
      .all(runId) as Array<{ id: string }>;
    return rows.map((row) => {
      const version = this.artifactStore.getVersion(
        row.id as import('@sync-think/shared').ArtifactVersionId,
      );
      if (!version) throw new Error(`ArtifactVersion not found: ${row.id}`);
      return version;
    });
  }

  createAcceptanceGate(input: CreateAcceptanceGateInput): AcceptanceGate {
    const id = reviewText(input.id, 'review.gate_id_invalid', 256) as AcceptanceGateId;
    if (
      !Number.isSafeInteger(input.maxIterations) ||
      input.maxIterations < 0 ||
      input.maxIterations > MAX_REVIEW_ITERATIONS
    ) {
      throw new Error('review.max_iterations_invalid');
    }
    if (
      input.onLimitReached !== 'pause' &&
      input.onLimitReached !== 'abort' &&
      input.onLimitReached !== 'reassign'
    ) {
      throw new Error('review.limit_action_invalid');
    }
    const normalizedDescriptions = normalizeAcceptanceCriteria(
      Array.isArray(input.criteria)
        ? input.criteria.map((criterion) =>
            criterion && typeof criterion === 'object' ? criterion.description : undefined,
          )
        : input.criteria,
      { requireNonEmpty: true },
    );
    const criterionIds = new Set<string>();
    const criteria = input.criteria.map((criterion, planOrder) => {
      const criterionId = reviewText(criterion.id, 'review.criterion_id_invalid', 256);
      if (criterionIds.has(criterionId)) throw new Error('review.criterion_duplicate');
      criterionIds.add(criterionId);
      return {
        id: criterionId,
        description: normalizedDescriptions[planOrder]!,
        planOrder,
      } satisfies AcceptanceCriterion;
    });
    const now = input.now ?? new Date().toISOString();

    return this.raw
      .transaction(() => {
        const graph = this.getRequiredGraph(input.runId);
        if (
          graph.run.state === 'completed' ||
          graph.run.state === 'failed' ||
          graph.run.state === 'cancelled'
        ) {
          throw new Error(`review.gate_run_terminal: ${graph.run.state}`);
        }
        const target = graph.steps.find((step) => step.id === input.targetStepId);
        if (!target) throw new Error(`review.target_step_scope_mismatch: ${input.targetStepId}`);
        if (
          target.state === 'completed' ||
          target.state === 'failed' ||
          target.state === 'skipped' ||
          target.state === 'cancelled'
        ) {
          throw new Error(`review.gate_target_terminal: ${target.state}`);
        }
        if (this.getReviewStepMapping(input.runId, input.targetStepId)) {
          throw new Error(`review.target_step_invalid: ${input.targetStepId}`);
        }
        if (
          input.backupAgentVersionId &&
          input.backupAgentVersionId === input.reviewerAgentVersionId
        ) {
          throw new Error('review.backup_reviewer_same_as_primary');
        }
        for (const agentVersionId of [input.reviewerAgentVersionId, input.backupAgentVersionId]) {
          if (!agentVersionId) continue;
          const exact = this.raw
            .prepare('SELECT id FROM agent_version WHERE id = ?')
            .get(agentVersionId);
          if (!exact) throw new Error(`AgentVersion not found: ${agentVersionId}`);
        }
        if (input.backupAgentVersionId) {
          const backup = this.raw
            .prepare('SELECT review_behavior_json FROM agent_version WHERE id = ?')
            .get(input.backupAgentVersionId) as { review_behavior_json: string } | undefined;
          let backupRole: unknown;
          try {
            backupRole = backup
              ? (JSON.parse(backup.review_behavior_json) as { role?: unknown }).role
              : undefined;
          } catch {
            backupRole = undefined;
          }
          if (backupRole !== 'reviewer' && backupRole !== 'executor-reviewer') {
            throw new Error('review.backup_reviewer_invalid');
          }
        }

        const existingById = this.getAcceptanceGate(id);
        const existingByTarget = this.getAcceptanceGateForTarget(input.runId, input.targetStepId);
        const existing = existingById ?? existingByTarget;
        const initialReviewer = input.initialReviewerStepId
          ? graph.steps.find((step) => step.id === input.initialReviewerStepId)
          : undefined;
        if (input.initialReviewerStepId) {
          if (!initialReviewer) {
            throw new Error(
              `review.initial_reviewer_scope_mismatch: ${input.initialReviewerStepId}`,
            );
          }
          if (
            initialReviewer.id === input.targetStepId ||
            initialReviewer.agentVersionId !== input.reviewerAgentVersionId ||
            initialReviewer.dependsOn.length !== 1 ||
            initialReviewer.dependsOn[0] !== input.targetStepId
          ) {
            throw new Error(`review.initial_reviewer_invalid: ${input.initialReviewerStepId}`);
          }
          const mapped = this.getReviewStepMapping(input.runId, initialReviewer.id);
          if (
            mapped &&
            (mapped.gate_id !== existing?.id ||
              mapped.role !== 'reviewer' ||
              mapped.iteration !== 0 ||
              mapped.derivation !== 'initial')
          ) {
            throw new Error(`review.initial_reviewer_conflict: ${input.initialReviewerStepId}`);
          }
          if (!existing && initialReviewer.state !== 'pending') {
            throw new Error(`review.initial_reviewer_not_pending: ${input.initialReviewerStepId}`);
          }
        }
        if (existing) {
          const mappedInitialReviewer = this.raw
            .prepare(
              `SELECT step_id FROM acceptance_gate_step
               WHERE gate_id = ? AND role = 'reviewer' AND iteration = 0 AND derivation = 'initial'`,
            )
            .get(existing.id) as { step_id: string } | undefined;
          const same =
            existing.id === id &&
            existing.runId === input.runId &&
            existing.targetStepId === input.targetStepId &&
            existing.reviewerAgentVersionId === input.reviewerAgentVersionId &&
            existing.backupAgentVersionId === input.backupAgentVersionId &&
            existing.maxIterations === input.maxIterations &&
            existing.onLimitReached === input.onLimitReached &&
            mappedInitialReviewer?.step_id === input.initialReviewerStepId &&
            existing.criteria.length === criteria.length &&
            existing.criteria.every(
              (criterion, index) =>
                criterion.id === criteria[index]?.id &&
                criterion.description === criteria[index]?.description,
            );
          if (!same) throw new Error('review.gate_conflict');
          return existing;
        }

        this.raw
          .prepare(
            `INSERT INTO acceptance_gate (
             id, run_id, target_step_id, reviewer_agent_version_id,
             backup_agent_version_id, max_iterations, on_limit_reached,
             state, reassigned, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, ?)`,
          )
          .run(
            id,
            input.runId,
            input.targetStepId,
            input.reviewerAgentVersionId,
            input.backupAgentVersionId ?? null,
            input.maxIterations,
            input.onLimitReached,
            now,
          );
        const insertCriterion = this.raw.prepare(
          `INSERT INTO acceptance_criterion (gate_id, id, description, plan_order)
         VALUES (?, ?, ?, ?)`,
        );
        for (const criterion of criteria) {
          insertCriterion.run(id, criterion.id, criterion.description, criterion.planOrder);
        }
        if (initialReviewer) {
          this.raw
            .prepare(
              `INSERT INTO acceptance_gate_step (
                 gate_id, run_id, step_id, role, iteration, derivation, source_evidence_id
               ) VALUES (?, ?, ?, 'reviewer', 0, 'initial', NULL)`,
            )
            .run(id, input.runId, initialReviewer.id);
        }
        const scope = this.getRunScope(input.runId);
        this.commitGraphTransition(
          input.runId,
          [
            this.createTransitionEvent(scope, input.runId, 'review', 'review.gate-created', now, {
              gateId: id,
              targetStepId: input.targetStepId,
              reviewerAgentVersionId: input.reviewerAgentVersionId,
              initialReviewerStepId: input.initialReviewerStepId ?? null,
              backupAgentVersionId: input.backupAgentVersionId ?? null,
              maxIterations: input.maxIterations,
              onLimitReached: input.onLimitReached,
              criterionIds: criteria.map((criterion) => criterion.id),
            }),
          ],
          now,
        );
        return this.getRequiredAcceptanceGate(id);
      })
      .immediate();
  }

  getAcceptanceGate(gateId: AcceptanceGateId): AcceptanceGate | undefined {
    const row = this.raw.prepare('SELECT * FROM acceptance_gate WHERE id = ?').get(gateId) as
      AcceptanceGateDbRow | undefined;
    if (!row) return undefined;
    return mapAcceptanceGate(row, this.listAcceptanceCriteria(gateId));
  }

  prepareReviewStepForExecution(
    runId: RunId,
    stepId: StepId,
    now: string = new Date().toISOString(),
  ): PrepareReviewStepForExecutionResult {
    return this.raw
      .transaction((): PrepareReviewStepForExecutionResult => {
        const graph = this.getRequiredGraph(runId);
        const mapping = this.getReviewStepMapping(runId, stepId);
        if (!mapping || mapping.role !== 'reviewer') {
          return { status: 'ready', graph, context: this.readReviewStepContext(runId, stepId) };
        }

        const rows = this.raw
          .prepare(
            `SELECT assigned.artifact_version_id, version_row.artifact_id, version_row.mime_type
             FROM review_step_artifact AS assigned
             JOIN artifact_version AS version_row ON version_row.id = assigned.artifact_version_id
             WHERE assigned.gate_id = ? AND assigned.run_id = ? AND assigned.reviewer_step_id = ?
             ORDER BY version_row.artifact_id ASC, assigned.artifact_version_id ASC`,
          )
          .all(mapping.gate_id, runId, stepId) as Array<{
          artifact_version_id: string;
          artifact_id: string;
          mime_type: string;
        }>;
        const byArtifact = new Map<ArtifactId, typeof rows>();
        for (const row of rows) {
          const artifactId = row.artifact_id as ArtifactId;
          const group = byArtifact.get(artifactId) ?? [];
          group.push(row);
          byArtifact.set(artifactId, group);
        }

        const selectionsToFreeze: Array<{
          artifactId: ArtifactId;
          selectedVersionId: ArtifactVersionId;
          candidateVersionIds: ArtifactVersionId[];
        }> = [];
        const selectionRequired: Array<{
          artifactId: ArtifactId;
          candidateVersionIds: ArtifactVersionId[];
        }> = [];
        for (const [artifactId, group] of byArtifact) {
          if (
            group.length <= 1 ||
            !group.every((row) => isReviewableImageMimeType(row.mime_type))
          ) {
            continue;
          }
          const candidateVersionIds = group.map(
            (row) => row.artifact_version_id as ArtifactVersionId,
          );
          const existingFreeze = this.raw
            .prepare(
              `SELECT selected_version_id FROM review_step_artifact_selection
               WHERE gate_id = ? AND run_id = ? AND reviewer_step_id = ? AND artifact_id = ?`,
            )
            .get(mapping.gate_id, runId, stepId, artifactId) as
            { selected_version_id: string } | undefined;
          if (existingFreeze) {
            if (
              !candidateVersionIds.includes(existingFreeze.selected_version_id as ArtifactVersionId)
            ) {
              throw new Error(`review.image_selection_corrupt: ${stepId}/${artifactId}`);
            }
            continue;
          }
          const latestSelection = this.artifactStore.listSelections(artifactId).at(-1);
          if (
            !latestSelection ||
            !candidateVersionIds.includes(latestSelection.selectedVersionId)
          ) {
            selectionRequired.push({ artifactId, candidateVersionIds });
            continue;
          }
          selectionsToFreeze.push({
            artifactId,
            selectedVersionId: latestSelection.selectedVersionId,
            candidateVersionIds,
          });
        }

        const scope = this.getRunScope(runId);
        if (selectionRequired.length > 0) {
          if (
            graph.run.state !== 'paused' &&
            graph.run.state !== 'completed' &&
            graph.run.state !== 'failed' &&
            graph.run.state !== 'cancelled'
          ) {
            const paused = this.raw
              .prepare(
                `UPDATE run SET state = 'paused', updated_at = ?
                 WHERE id = ? AND state NOT IN ('paused', 'completed', 'failed', 'cancelled')`,
              )
              .run(now, runId);
            if (paused.changes !== 1)
              throw new Error(`review.image_selection_pause_conflict: ${runId}`);
            const artifactIds = selectionRequired.map((entry) => entry.artifactId);
            const candidateVersionIds = selectionRequired.flatMap(
              (entry) => entry.candidateVersionIds,
            );
            const pausedGraph = this.commitGraphTransition(
              runId,
              [
                this.createTransitionEvent(
                  scope,
                  runId,
                  'review',
                  'review.image-selection-required',
                  now,
                  {
                    gateId: mapping.gate_id,
                    reviewerStepId: stepId,
                    artifactIds,
                    candidateVersionIds,
                  },
                  stepId,
                ),
                this.createTransitionEvent(scope, runId, 'run', 'run.paused', now, {
                  from: graph.run.state,
                  to: 'paused',
                  reason: 'review-image-selection-required',
                  gateId: mapping.gate_id,
                  reviewerStepId: stepId,
                  artifactIds,
                }),
              ],
              now,
            );
            return {
              status: 'image-selection-required',
              graph: pausedGraph,
              artifactIds,
              candidateVersionIds,
            };
          }
          return {
            status: 'image-selection-required',
            graph,
            artifactIds: selectionRequired.map((entry) => entry.artifactId),
            candidateVersionIds: selectionRequired.flatMap((entry) => entry.candidateVersionIds),
          };
        }

        if (selectionsToFreeze.length > 0) {
          const insertFreeze = this.raw.prepare(
            `INSERT INTO review_step_artifact_selection (
               gate_id, run_id, reviewer_step_id, artifact_id, selected_version_id, created_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          );
          for (const frozen of selectionsToFreeze) {
            insertFreeze.run(
              mapping.gate_id,
              runId,
              stepId,
              frozen.artifactId,
              frozen.selectedVersionId,
              now,
            );
          }
          const frozenGraph = this.commitGraphTransition(
            runId,
            [
              this.createTransitionEvent(
                scope,
                runId,
                'review',
                'review.image-selection-frozen',
                now,
                {
                  gateId: mapping.gate_id,
                  reviewerStepId: stepId,
                  selections: selectionsToFreeze.map((entry) => ({
                    artifactId: entry.artifactId,
                    selectedVersionId: entry.selectedVersionId,
                    candidateVersionIds: entry.candidateVersionIds,
                  })),
                },
                stepId,
              ),
            ],
            now,
          );
          return {
            status: 'ready',
            graph: frozenGraph,
            context: this.readReviewStepContext(runId, stepId),
          };
        }

        return { status: 'ready', graph, context: this.readReviewStepContext(runId, stepId) };
      })
      .immediate();
  }

  getReviewStepContext(runId: RunId, stepId: StepId): ReviewStepExecutionContext | undefined {
    return this.readReviewStepContext(runId, stepId);
  }

  private readReviewStepContext(
    runId: RunId,
    stepId: StepId,
  ): ReviewStepExecutionContext | undefined {
    const mapping = this.getReviewStepMapping(runId, stepId);
    if (!mapping) return undefined;
    const gate = this.getRequiredAcceptanceGate(mapping.gate_id as AcceptanceGateId);
    if (mapping.role === 'reviewer') {
      const reviewedArtifactVersions = this.listEffectiveReviewerArtifactVersionIds(
        mapping.gate_id,
        runId,
        stepId,
      ).map((artifactVersionId) => {
        const version = this.artifactStore.getVersion(artifactVersionId);
        if (!version) throw new Error(`ArtifactVersion not found: ${artifactVersionId}`);
        return version;
      });
      return {
        kind: 'reviewer',
        gateId: gate.id,
        targetStepId: gate.targetStepId,
        iteration: mapping.iteration,
        criteria: gate.criteria,
        reviewedArtifactVersions,
      };
    }
    if (!mapping.source_evidence_id) throw new Error(`review.rework_evidence_missing: ${stepId}`);
    return {
      kind: 'rework',
      gateId: gate.id,
      targetStepId: gate.targetStepId,
      iteration: mapping.iteration,
      evidence: this.getRequiredReviewEvidence(mapping.source_evidence_id),
    };
  }

  listReviewEvidence(gateId: AcceptanceGateId): ReviewEvidence[] {
    const rows = this.raw
      .prepare(
        `SELECT * FROM review_evidence WHERE gate_id = ?
         ORDER BY iteration ASC, created_at ASC, id ASC`,
      )
      .all(gateId) as ReviewEvidenceDbRow[];
    return rows.map((row) => this.mapReviewEvidence(row));
  }

  claimReadySteps(input: ClaimReadyStepsInput): ClaimReadyStepsResult {
    const now = input.now ?? new Date().toISOString();
    const ownerId = executionOwnerId(input.ownerId);
    if (typeof input.leaseExpiresAt !== 'string' || input.leaseExpiresAt <= now) {
      throw new Error('step.lease_expiry_invalid');
    }
    if (new Set(input.stepIds).size !== input.stepIds.length) {
      throw new Error('step.duplicate_claim_id');
    }

    return this.raw
      .transaction(() => {
        const graph = this.getRequiredGraph(input.runId);
        const artifactVersionsByStep = new Map<StepId, ArtifactVersion[]>();
        if (
          graph.run.state !== 'queued' &&
          graph.run.state !== 'running' &&
          graph.run.state !== 'reviewing' &&
          graph.run.state !== 'revising'
        ) {
          return { graph, claimedSteps: [], artifactVersionsByStep };
        }

        const byId = new Map(graph.steps.map((step) => [step.id, step]));
        const stateById = new Map(graph.steps.map((step) => [step.id, step.state]));
        const requested = input.stepIds
          .map((stepId) => {
            const step = byId.get(stepId);
            if (!step) throw new Error(`Step not found: ${input.runId}/${stepId}`);
            return step;
          })
          .filter(
            (step) =>
              step.kind === 'execution' &&
              (step.state === 'pending' || step.state === 'ready') &&
              this.isStepEligibleForReady(input.runId, step, stateById, graph),
          )
          .sort((left, right) => left.planOrder - right.planOrder);
        if (requested.length === 0) return { graph, claimedSteps: [], artifactVersionsByStep };
        const snapshotFailures: Array<{ step: StoredStep; error: StepSnapshotLimitError }> = [];
        for (const step of requested) {
          try {
            artifactVersionsByStep.set(step.id, this.listStepSnapshotVersions(graph, step));
          } catch (error) {
            if (!isStepSnapshotLimitError(error)) throw error;
            snapshotFailures.push({ step, error });
          }
        }
        if (snapshotFailures.length > 0) {
          const scope = this.getRunScope(input.runId);
          const events: EventDraft[] = [];
          for (const { step, error } of snapshotFailures) {
            const idempotencyKey =
              step.idempotencyKey ?? stableStepIdempotencyKey(input.runId, step.id);
            const failed = this.raw
              .prepare(
                `UPDATE step SET state = 'failed', idempotency_key = ?,
                   execution_owner_id = NULL, lease_expires_at = NULL, updated_at = ?
                 WHERE run_id = ? AND id = ? AND state IN ('pending', 'ready')`,
              )
              .run(idempotencyKey, now, input.runId, step.id);
            if (failed.changes !== 1) throw new Error(`step.snapshot_failure_conflict: ${step.id}`);
            events.push(
              this.createTransitionEvent(
                scope,
                input.runId,
                'step',
                'step.failed',
                now,
                {
                  from: step.state,
                  to: 'failed',
                  failureClass: error.failureClass,
                  code: error.code,
                  summary: error.message,
                  idempotencyKey,
                  artifactVersionIds: [],
                },
                step.id,
              ),
            );
          }
          const failedRun = this.raw
            .prepare(
              `UPDATE run SET state = 'failed', updated_at = ?
               WHERE id = ? AND state NOT IN ('completed', 'failed', 'cancelled')`,
            )
            .run(now, input.runId);
          if (failedRun.changes === 1) {
            events.push(
              this.createTransitionEvent(scope, input.runId, 'run', 'run.failed', now, {
                from: graph.run.state,
                to: 'failed',
                reason: 'step-snapshot-limit-exceeded',
                stepIds: snapshotFailures.map(({ step }) => step.id),
              }),
            );
          }
          artifactVersionsByStep.clear();
          return {
            graph: this.commitGraphTransition(input.runId, events, now),
            claimedSteps: [],
            artifactVersionsByStep,
          };
        }

        const scope = this.getRunScope(input.runId);
        const events: EventDraft[] = [];
        if (graph.run.state === 'queued') {
          const update = this.raw
            .prepare(
              "UPDATE run SET state = 'running', updated_at = ? WHERE id = ? AND state = 'queued'",
            )
            .run(now, input.runId);
          if (update.changes !== 1) throw new Error(`run.claim_conflict: ${input.runId}`);
          events.push(
            this.createTransitionEvent(scope, input.runId, 'run', 'run.running', now, {
              from: 'queued',
              to: 'running',
            }),
          );
        }

        for (const step of requested) {
          if (step.state === 'pending') {
            const readyUpdate = this.raw
              .prepare(
                "UPDATE step SET state = 'ready', updated_at = ? WHERE run_id = ? AND id = ? AND state = 'pending'",
              )
              .run(now, input.runId, step.id);
            if (readyUpdate.changes !== 1) throw new Error(`step.ready_conflict: ${step.id}`);
            events.push(
              this.createTransitionEvent(
                scope,
                input.runId,
                'step',
                'step.ready',
                now,
                {
                  from: 'pending',
                  to: 'ready',
                },
                step.id,
              ),
            );
          }

          const idempotencyKey =
            step.idempotencyKey ?? stableStepIdempotencyKey(input.runId, step.id);
          const started = this.raw
            .prepare(
              `UPDATE step
             SET state = 'running', idempotency_key = ?, execution_owner_id = ?,
               lease_expires_at = ?, execution_attempt = execution_attempt + 1, updated_at = ?
             WHERE run_id = ? AND id = ? AND state = 'ready'`,
            )
            .run(idempotencyKey, ownerId, input.leaseExpiresAt, now, input.runId, step.id);
          if (started.changes !== 1) throw new Error(`step.claim_conflict: ${step.id}`);
          events.push(
            this.createTransitionEvent(
              scope,
              input.runId,
              'step',
              'step.started',
              now,
              {
                from: 'ready',
                to: 'running',
                idempotencyKey,
                executionOwnerId: ownerId,
                executionAttempt: step.executionAttempt + 1,
                leaseExpiresAt: input.leaseExpiresAt,
              },
              step.id,
            ),
          );
        }

        const committedGraph = this.commitGraphTransition(input.runId, events, now);
        const claimedIds = new Set(requested.map((step) => step.id));
        return {
          graph: committedGraph,
          claimedSteps: committedGraph.steps.filter((step) => claimedIds.has(step.id)),
          artifactVersionsByStep,
        };
      })
      .immediate();
  }

  recoverRun(runId: RunId, now: string = new Date().toISOString()): RunGraph {
    return this.raw
      .transaction(() => {
        const graph = this.getRequiredGraph(runId);
        if (
          graph.run.state === 'completed' ||
          graph.run.state === 'failed' ||
          graph.run.state === 'cancelled'
        ) {
          return graph;
        }
        const runningSteps = graph.steps.filter(
          (step) =>
            step.state === 'running' &&
            (step.leaseExpiresAt === undefined || step.leaseExpiresAt <= now),
        );
        if (runningSteps.length === 0) return graph;

        const scope = this.getRunScope(runId);
        const events: EventDraft[] = [];
        for (const step of runningSteps) {
          const update = this.raw
            .prepare(
              `UPDATE step SET state = 'ready', retries = retries + 1,
               execution_owner_id = NULL, lease_expires_at = NULL, updated_at = ?
             WHERE run_id = ? AND id = ? AND state = 'running'
               AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
            )
            .run(now, runId, step.id, now);
          if (update.changes !== 1) throw new Error(`step.recovery_conflict: ${step.id}`);
          events.push(
            this.createTransitionEvent(
              scope,
              runId,
              'step',
              'step.ready',
              now,
              {
                from: 'running',
                to: 'ready',
                reason: 'runtime-recovery',
                idempotencyKey: step.idempotencyKey,
              },
              step.id,
            ),
          );
        }
        return this.commitGraphTransition(runId, events, now);
      })
      .immediate();
  }

  refreshStepLease(input: RefreshStepLeaseInput): boolean {
    const ownerId = executionOwnerId(input.ownerId);
    const attempt = executionAttempt(input.executionAttempt);
    const now = input.now ?? new Date().toISOString();
    if (typeof input.leaseExpiresAt !== 'string' || input.leaseExpiresAt <= now) {
      throw new Error('step.lease_expiry_invalid');
    }
    const refreshed = this.raw
      .prepare(
        `UPDATE step SET lease_expires_at = ?, updated_at = ?
         WHERE run_id = ? AND id = ? AND state = 'running'
           AND execution_owner_id = ? AND execution_attempt = ?
           AND lease_expires_at > ?`,
      )
      .run(input.leaseExpiresAt, now, input.runId, input.stepId, ownerId, attempt, now);
    return refreshed.changes === 1;
  }

  getNextLeaseExpiry(runId: RunId): string | undefined {
    const row = this.raw
      .prepare(
        `SELECT MIN(lease_expires_at) AS lease_expires_at
         FROM step WHERE run_id = ? AND state = 'running' AND lease_expires_at IS NOT NULL`,
      )
      .get(runId) as { lease_expires_at: string | null };
    return row.lease_expires_at ?? undefined;
  }

  completeStep(input: CompleteStepInput): CompleteStepResult {
    const idempotencyKey = persistedIdempotencyKey(input.idempotencyKey);
    if (!idempotencyKey) throw new Error('step.idempotency_key_required');
    const ownerId = executionOwnerId(input.ownerId);
    const attempt = executionAttempt(input.executionAttempt);
    const requestedNow = input.now;

    return this.raw
      .transaction(() => {
        const now = requestedNow ?? new Date().toISOString();
        const graph = this.getRequiredGraph(input.runId);
        const step = graph.steps.find((entry) => entry.id === input.stepId);
        if (!step) throw new Error(`Step not found: ${input.runId}/${input.stepId}`);
        if (step.idempotencyKey !== idempotencyKey) {
          throw new Error(`step.idempotency_key_mismatch: ${input.stepId}`);
        }
        if (step.state === 'completed') {
          const legacyReplay =
            step.executionOwnerId === LEGACY_TERMINAL_EXECUTION_OWNER &&
            step.executionAttempt === 1;
          if (
            !legacyReplay &&
            (step.executionOwnerId !== ownerId || step.executionAttempt !== attempt)
          ) {
            throw new StepFenceMismatchError(input.stepId);
          }
          return {
            graph,
            outputVersions: this.listStepTransitionOutputVersions(
              input.runId,
              input.stepId,
              idempotencyKey,
              'completed',
            ),
            replayed: true,
          };
        }
        if (step.state !== 'running') throw new Error(`step.not_completable: ${step.state}`);
        this.assertLiveStepFence(step, idempotencyKey, ownerId, attempt, now);
        const reviewMapping = this.getReviewStepMapping(input.runId, input.stepId);
        if (reviewMapping?.role === 'reviewer') {
          throw new Error(`review.outcome_required: ${input.stepId}`);
        }
        const targetGate = this.getAcceptanceGateForTarget(input.runId, input.stepId);
        if (targetGate?.state === 'active' && (input.outputVersions?.length ?? 0) === 0) {
          throw new Error('review.target_output_required');
        }
        if (
          targetGate?.state === 'active' &&
          input.outputVersions?.some(
            (output) =>
              output.status !== 'candidate' &&
              output.status !== 'selected' &&
              output.status !== 'merged',
          )
        ) {
          throw new Error('review.target_output_status_invalid');
        }
        if (reviewMapping?.role === 'rework') {
          this.assertValidReworkOutputs(reviewMapping, input.outputVersions ?? []);
        }
        this.assertOutputArtifactScope(input.runId, input.outputVersions ?? []);

        const update = this.raw
          .prepare(
            `UPDATE step SET state = 'completed', lease_expires_at = NULL, updated_at = ?
           WHERE run_id = ? AND id = ? AND state = 'running' AND idempotency_key = ?
             AND execution_owner_id = ? AND execution_attempt = ? AND lease_expires_at > ?`,
          )
          .run(now, input.runId, input.stepId, idempotencyKey, ownerId, attempt, now);
        if (update.changes !== 1) throw new StepFenceMismatchError(input.stepId);

        const outputVersions = this.createStepOutputVersions(
          input.runId,
          input.stepId,
          input.outputVersions ?? [],
          undefined,
          now,
        );
        this.mapStepOutputVersions(
          input.runId,
          input.stepId,
          idempotencyKey,
          'completed',
          outputVersions,
          now,
        );
        const scope = this.getRunScope(input.runId);
        const events: EventDraft[] = [
          this.createTransitionEvent(
            scope,
            input.runId,
            'step',
            'step.completed',
            now,
            {
              from: 'running',
              to: 'completed',
              idempotencyKey,
              artifactVersionIds: outputVersions.map((version) => version.id),
            },
            input.stepId,
          ),
        ];

        if (targetGate?.state === 'active') {
          this.deriveReviewerStep({
            gate: targetGate,
            iteration: 0,
            derivation: 'initial',
            dependsOnStepId: input.stepId,
            artifactVersionIds: outputVersions.map((version) => version.id),
            events,
            now,
          });
          this.transitionRunState(input.runId, 'reviewing', 'review-started', events, now, {
            gateId: targetGate.id,
            targetStepId: targetGate.targetStepId,
            iteration: 0,
          });
        } else if (reviewMapping?.role === 'rework') {
          const gate = this.getRequiredAcceptanceGate(reviewMapping.gate_id as AcceptanceGateId);
          const reviewedArtifactVersionIds = this.reviewerArtifactsAfterRework(
            reviewMapping,
            outputVersions,
          );
          this.deriveReviewerStep({
            gate,
            iteration: reviewMapping.iteration,
            derivation: 'rework',
            dependsOnStepId: input.stepId,
            sourceEvidenceId: reviewMapping.source_evidence_id ?? undefined,
            artifactVersionIds: reviewedArtifactVersionIds,
            events,
            now,
          });
          this.transitionRunState(input.runId, 'reviewing', 'rework-completed', events, now, {
            gateId: gate.id,
            targetStepId: gate.targetStepId,
            iteration: reviewMapping.iteration,
          });
        }

        this.releaseEligiblePendingSteps(input.runId, events, now, 'dependencies-completed');

        const afterReady = this.getRequiredGraph(input.runId);
        if (
          afterReady.run.state !== 'paused' &&
          !this.hasUnresolvedAcceptanceGate(input.runId) &&
          afterReady.steps.every(
            (entry) => entry.state === 'completed' || entry.state === 'skipped',
          )
        ) {
          this.raw
            .prepare(
              "UPDATE run SET state = 'completed', updated_at = ? WHERE id = ? AND state NOT IN ('completed', 'failed', 'cancelled')",
            )
            .run(now, input.runId);
          events.push(
            this.createTransitionEvent(scope, input.runId, 'run', 'run.completed', now, {
              from: afterReady.run.state,
              to: 'completed',
            }),
          );
        } else if (
          afterReady.run.state !== 'paused' &&
          afterReady.steps.some((entry) => entry.state === 'failed') &&
          afterReady.steps.every(
            (entry) =>
              entry.state !== 'running' &&
              entry.state !== 'ready' &&
              entry.state !== 'awaitingApproval',
          )
        ) {
          this.raw
            .prepare(
              "UPDATE run SET state = 'failed', updated_at = ? WHERE id = ? AND state NOT IN ('completed', 'failed', 'cancelled')",
            )
            .run(now, input.runId);
          events.push(
            this.createTransitionEvent(scope, input.runId, 'run', 'run.failed', now, {
              from: afterReady.run.state,
              to: 'failed',
              reason: 'step-failed',
            }),
          );
        }

        return {
          graph: this.commitGraphTransition(input.runId, events, now),
          outputVersions,
          replayed: false,
        };
      })
      .immediate();
  }

  completeMergeStep(input: CompleteMergeStepInput): RunGraph {
    return this.raw
      .transaction(() => {
        const now = input.now ?? new Date().toISOString();
        const graph = this.getRequiredGraph(input.runId);
        const step = graph.steps.find((entry) => entry.id === input.stepId);
        if (!step) throw new Error(`Step not found: ${input.runId}/${input.stepId}`);
        if (step.kind !== 'merge') throw new Error(`step.not_merge_step: ${input.stepId}`);
        if (step.state === 'completed') return graph;
        if (step.state !== 'ready') throw new Error(`step.merge_not_completable: ${step.state}`);
        const stateById = new Map(graph.steps.map((entry) => [entry.id, entry.state]));
        if (!step.dependsOn.every((dependencyId) => stateById.get(dependencyId) === 'completed')) {
          throw new Error(`step.merge_dependencies_incomplete: ${input.stepId}`);
        }
        const mergedOutput = this.raw
          .prepare(
            `SELECT id FROM artifact_version
             WHERE source_run_id = ? AND source_step_id = ? AND status = 'merged'
             ORDER BY version DESC, id DESC LIMIT 1`,
          )
          .get(input.runId, input.stepId) as { id: string } | undefined;
        if (!mergedOutput) throw new Error(`step.merge_output_missing: ${input.stepId}`);

        const update = this.raw
          .prepare(
            `UPDATE step SET state = 'completed', updated_at = ?
             WHERE run_id = ? AND id = ? AND kind = 'merge' AND state = 'ready'`,
          )
          .run(now, input.runId, input.stepId);
        if (update.changes !== 1)
          throw new Error(`step.merge_completion_conflict: ${input.stepId}`);
        const scope = this.getRunScope(input.runId);
        const events: EventDraft[] = [
          this.createTransitionEvent(
            scope,
            input.runId,
            'step',
            'step.completed',
            now,
            {
              from: 'ready',
              to: 'completed',
              kind: 'merge',
              artifactVersionIds: [mergedOutput.id],
            },
            input.stepId,
          ),
        ];
        this.releaseEligiblePendingSteps(input.runId, events, now, 'merge-completed');
        const afterReady = this.getRequiredGraph(input.runId);
        if (
          afterReady.run.state !== 'paused' &&
          !this.hasUnresolvedAcceptanceGate(input.runId) &&
          afterReady.steps.every(
            (entry) => entry.state === 'completed' || entry.state === 'skipped',
          )
        ) {
          const runUpdate = this.raw
            .prepare(
              `UPDATE run SET state = 'completed', updated_at = ?
               WHERE id = ? AND state NOT IN ('completed', 'failed', 'cancelled', 'paused')`,
            )
            .run(now, input.runId);
          if (runUpdate.changes !== 1)
            throw new Error(`run.merge_completion_conflict: ${input.runId}`);
          events.push(
            this.createTransitionEvent(scope, input.runId, 'run', 'run.completed', now, {
              from: afterReady.run.state,
              to: 'completed',
              reason: 'merge-completed',
            }),
          );
        }
        return this.commitGraphTransition(input.runId, events, now);
      })
      .immediate();
  }

  completeReviewStep(input: CompleteReviewStepInput): CompleteReviewStepResult {
    const idempotencyKey = persistedIdempotencyKey(input.idempotencyKey);
    if (!idempotencyKey) throw new Error('step.idempotency_key_required');
    const ownerId = executionOwnerId(input.ownerId);
    const attempt = executionAttempt(input.executionAttempt);
    const requestedNow = input.now;

    return this.raw
      .transaction(() => {
        const now = requestedNow ?? new Date().toISOString();
        const graph = this.getRequiredGraph(input.runId);
        const step = graph.steps.find((entry) => entry.id === input.stepId);
        if (!step) throw new Error(`Step not found: ${input.runId}/${input.stepId}`);
        if (step.idempotencyKey !== idempotencyKey) {
          throw new Error(`step.idempotency_key_mismatch: ${input.stepId}`);
        }
        const mapping = this.getReviewStepMapping(input.runId, input.stepId);
        if (!mapping || mapping.role !== 'reviewer') {
          throw new Error(`review.step_not_reviewer: ${input.stepId}`);
        }
        const gate = this.getRequiredAcceptanceGate(mapping.gate_id as AcceptanceGateId);
        const expectedReviewer =
          mapping.derivation === 'reassign'
            ? gate.backupAgentVersionId
            : gate.reviewerAgentVersionId;
        if (
          !expectedReviewer ||
          input.reviewerAgentVersionId !== expectedReviewer ||
          step.agentVersionId !== expectedReviewer
        ) {
          throw new Error(`review.reviewer_agent_mismatch: ${input.stepId}`);
        }
        if (step.executionOwnerId !== ownerId || step.executionAttempt !== attempt) {
          throw new StepFenceMismatchError(input.stepId);
        }

        const existing = this.getReviewEvidenceForStep(input.runId, input.stepId);
        if (existing) {
          const outcome = this.normalizeReviewOutcome(gate, mapping, input.outcome);
          if (step.state !== 'completed' || !this.reviewEvidenceMatches(existing, outcome)) {
            throw new Error('review.verdict_conflict');
          }
          return { graph, evidence: existing, replayed: true };
        }
        if (step.state !== 'running') throw new Error(`step.not_completable: ${step.state}`);
        if (gate.state !== 'active') throw new Error(`review.gate_not_active: ${gate.state}`);
        this.assertLiveStepFence(step, idempotencyKey, ownerId, attempt, now);
        const outcome = this.normalizeReviewOutcome(gate, mapping, input.outcome);
        const reviewAction = nextReviewAction({
          verdict: outcome.verdict,
          iteration: mapping.iteration,
          maxIterations: gate.maxIterations,
          onLimitReached: gate.onLimitReached,
        });

        const evidenceId = ulid();
        this.raw
          .prepare(
            `INSERT INTO review_evidence (
             id, gate_id, run_id, target_step_id, reviewer_step_id,
             reviewer_agent_version_id, iteration, verdict, explanation, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            evidenceId,
            gate.id,
            input.runId,
            gate.targetStepId,
            input.stepId,
            expectedReviewer,
            mapping.iteration,
            outcome.verdict,
            outcome.explanation,
            now,
          );
        const insertCriterion = this.raw.prepare(
          `INSERT INTO review_evidence_criterion (
           evidence_id, gate_id, criterion_id, verdict, explanation
         ) VALUES (?, ?, ?, ?, ?)`,
        );
        for (const criterion of outcome.criteria) {
          insertCriterion.run(
            evidenceId,
            gate.id,
            criterion.criterionId,
            criterion.verdict,
            criterion.explanation,
          );
        }
        const insertArtifact = this.raw.prepare(
          `INSERT INTO review_evidence_artifact (evidence_id, artifact_version_id)
         VALUES (?, ?)`,
        );
        for (const artifactVersionId of outcome.reviewedArtifactVersionIds) {
          insertArtifact.run(evidenceId, artifactVersionId);
        }

        const completed = this.raw
          .prepare(
            `UPDATE step SET state = 'completed', lease_expires_at = NULL, updated_at = ?
           WHERE run_id = ? AND id = ? AND state = 'running'
             AND idempotency_key = ? AND execution_owner_id = ? AND execution_attempt = ?
             AND lease_expires_at > ?`,
          )
          .run(now, input.runId, input.stepId, idempotencyKey, ownerId, attempt, now);
        if (completed.changes !== 1) throw new StepFenceMismatchError(input.stepId);

        const evidence = this.getRequiredReviewEvidence(evidenceId);
        const scope = this.getRunScope(input.runId);
        const events: EventDraft[] = [
          this.createTransitionEvent(
            scope,
            input.runId,
            'step',
            'step.completed',
            now,
            {
              from: 'running',
              to: 'completed',
              idempotencyKey,
              reviewEvidenceId: evidence.id,
              verdict: evidence.verdict,
            },
            input.stepId,
          ),
          this.createTransitionEvent(
            scope,
            input.runId,
            'review',
            'review.evidence-recorded',
            now,
            {
              evidenceId: evidence.id,
              gateId: gate.id,
              targetStepId: gate.targetStepId,
              reviewerStepId: input.stepId,
              reviewerAgentVersionId: expectedReviewer,
              iteration: mapping.iteration,
              verdict: outcome.verdict,
              explanation: outcome.explanation,
              criteria: outcome.criteria,
              reviewedArtifactVersionIds: outcome.reviewedArtifactVersionIds,
            },
            input.stepId,
          ),
        ];

        if (reviewAction.action === 'complete') {
          const accepted = this.raw
            .prepare(
              `UPDATE acceptance_gate SET state = 'accepted', resolved_at = ?
             WHERE id = ? AND state = 'active'`,
            )
            .run(now, gate.id);
          if (accepted.changes !== 1) throw new Error(`review.gate_conflict: ${gate.id}`);
          events.push(
            this.createTransitionEvent(
              scope,
              input.runId,
              'review',
              'review.accepted',
              now,
              {
                gateId: gate.id,
                evidenceId: evidence.id,
                reviewerStepId: input.stepId,
                iteration: mapping.iteration,
              },
              input.stepId,
            ),
          );
          this.finishAcceptedReview(input.runId, gate, events, now);
        } else if (reviewAction.action === 'rework') {
          const nextIteration = reviewAction.nextIteration;
          this.deriveReworkStep({
            gate,
            iteration: nextIteration,
            dependsOnStepId: input.stepId,
            sourceEvidenceId: evidence.id,
            events,
            now,
          });
          this.transitionRunState(input.runId, 'revising', 'review-rejected', events, now, {
            gateId: gate.id,
            evidenceId: evidence.id,
            iteration: mapping.iteration,
            nextIteration,
          });
        } else {
          this.applyReviewLimit({ gate, mapping, evidence, events, now });
        }

        return {
          graph: this.commitGraphTransition(input.runId, events, now),
          evidence,
          replayed: false,
        };
      })
      .immediate();
  }

  failStep(input: FailStepInput): FailStepResult {
    const idempotencyKey = persistedIdempotencyKey(input.idempotencyKey);
    if (!idempotencyKey) throw new Error('step.idempotency_key_required');
    const ownerId = executionOwnerId(input.ownerId);
    const attempt = executionAttempt(input.executionAttempt);
    const failureCode = /^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.failureCode)
      ? input.failureCode
      : 'step.executor.unknown';
    const summary = scrubDiagnosticText(input.summary || 'Step executor failed', 240);
    const requestedNow = input.now;

    return this.raw
      .transaction(() => {
        const now = requestedNow ?? new Date().toISOString();
        const graph = this.getRequiredGraph(input.runId);
        const step = graph.steps.find((entry) => entry.id === input.stepId);
        if (!step) throw new Error(`Step not found: ${input.runId}/${input.stepId}`);
        if (step.idempotencyKey !== idempotencyKey) {
          throw new Error(`step.idempotency_key_mismatch: ${input.stepId}`);
        }
        if (step.state === 'failed') {
          const legacyReplay =
            step.executionOwnerId === LEGACY_TERMINAL_EXECUTION_OWNER &&
            step.executionAttempt === 1;
          if (
            !legacyReplay &&
            (step.executionOwnerId !== ownerId || step.executionAttempt !== attempt)
          ) {
            throw new StepFenceMismatchError(input.stepId);
          }
          return {
            graph,
            partialOutputVersions: this.listStepTransitionOutputVersions(
              input.runId,
              input.stepId,
              idempotencyKey,
              'failed',
            ),
            replayed: true,
          };
        }
        if (step.state !== 'running') throw new Error(`step.not_failable: ${step.state}`);
        this.assertLiveStepFence(step, idempotencyKey, ownerId, attempt, now);
        this.assertOutputArtifactScope(input.runId, input.partialOutputVersions ?? []);

        const update = this.raw
          .prepare(
            `UPDATE step SET state = 'failed', lease_expires_at = NULL, updated_at = ?
           WHERE run_id = ? AND id = ? AND state = 'running' AND idempotency_key = ?
             AND execution_owner_id = ? AND execution_attempt = ? AND lease_expires_at > ?`,
          )
          .run(now, input.runId, input.stepId, idempotencyKey, ownerId, attempt, now);
        if (update.changes !== 1) throw new StepFenceMismatchError(input.stepId);

        const partialOutputVersions = this.createStepOutputVersions(
          input.runId,
          input.stepId,
          input.partialOutputVersions ?? [],
          'incomplete',
          now,
        );
        this.mapStepOutputVersions(
          input.runId,
          input.stepId,
          idempotencyKey,
          'failed',
          partialOutputVersions,
          now,
        );
        const scope = this.getRunScope(input.runId);
        const events: EventDraft[] = [
          this.createTransitionEvent(
            scope,
            input.runId,
            'step',
            'step.failed',
            now,
            {
              from: 'running',
              to: 'failed',
              failureClass: input.failureClass,
              code: failureCode,
              summary,
              idempotencyKey,
              artifactVersionIds: partialOutputVersions.map((version) => version.id),
            },
            input.stepId,
          ),
        ];

        const afterFailure = this.getRequiredGraph(input.runId);
        if (
          afterFailure.run.state !== 'paused' &&
          afterFailure.steps.every((entry) => entry.state !== 'running' && entry.state !== 'ready')
        ) {
          this.raw
            .prepare(
              "UPDATE run SET state = 'failed', updated_at = ? WHERE id = ? AND state NOT IN ('completed', 'failed', 'cancelled')",
            )
            .run(now, input.runId);
          events.push(
            this.createTransitionEvent(scope, input.runId, 'run', 'run.failed', now, {
              from: afterFailure.run.state,
              to: 'failed',
              reason: 'step-failed',
            }),
          );
        }

        return {
          graph: this.commitGraphTransition(input.runId, events, now),
          partialOutputVersions,
          replayed: false,
        };
      })
      .immediate();
  }

  awaitStepApproval(input: AwaitStepApprovalInput): RunGraph {
    const approvalId = String(input.approvalId ?? '').trim();
    if (!approvalId || approvalId.length > 256) {
      throw new Error('approval.id_invalid');
    }
    if (!/^[a-f0-9]{64}$/.test(input.actionDigest)) {
      throw new Error('approval.action_digest_invalid');
    }
    const now = input.now ?? new Date().toISOString();
    return this.raw
      .transaction(() => {
        let graph = this.getRequiredGraph(input.runId);
        let step = graph.steps.find((candidate) => candidate.id === input.stepId);
        if (!step) throw new Error(`Step not found: ${input.runId}/${input.stepId}`);
        if (step.state === 'awaitingApproval') {
          const binding = this.getStepApprovalBinding(input.runId, input.stepId);
          if (binding?.approvalId === approvalId && binding.actionDigest === input.actionDigest) {
            return graph;
          }
          throw new Error(`step.approval_binding_mismatch: ${input.stepId}`);
        }

        const scope = this.getRunScope(input.runId);
        const events: EventDraft[] = [];
        if (step.state === 'pending') {
          const stateById = new Map(
            graph.steps.map((candidate) => [candidate.id, candidate.state]),
          );
          if (!this.isStepEligibleForReady(input.runId, step, stateById, graph)) {
            throw new Error(`step.not_ready_for_approval: ${step.id}`);
          }
          const ready = this.raw
            .prepare(
              "UPDATE step SET state = 'ready', updated_at = ? WHERE run_id = ? AND id = ? AND state = 'pending'",
            )
            .run(now, input.runId, input.stepId);
          if (ready.changes !== 1) throw new Error(`step.ready_conflict: ${step.id}`);
          events.push(
            this.createTransitionEvent(
              scope,
              input.runId,
              'step',
              'step.ready',
              now,
              { from: 'pending', to: 'ready', reason: 'approval-preflight' },
              input.stepId,
            ),
          );
          graph = this.getRequiredGraph(input.runId);
          step = graph.steps.find((candidate) => candidate.id === input.stepId)!;
        }

        if (step.state !== 'ready' && step.state !== 'running') {
          throw new Error(`step.not_approvable: ${step.state}`);
        }
        if (step.state === 'running') {
          const ownerId = input.ownerId ? executionOwnerId(input.ownerId) : undefined;
          const attempt =
            input.executionAttempt === undefined
              ? undefined
              : executionAttempt(input.executionAttempt);
          if (
            !ownerId ||
            attempt === undefined ||
            step.executionOwnerId !== ownerId ||
            step.executionAttempt !== attempt
          ) {
            throw new StepFenceMismatchError(step.id);
          }
        }

        const update = this.raw
          .prepare(
            `UPDATE step SET state = 'awaitingApproval', execution_owner_id = NULL,
             lease_expires_at = NULL, updated_at = ?
           WHERE run_id = ? AND id = ? AND state = ?`,
          )
          .run(now, input.runId, input.stepId, step.state);
        if (update.changes !== 1) throw new Error(`step.approval_conflict: ${step.id}`);
        events.push(
          this.createTransitionEvent(
            scope,
            input.runId,
            'step',
            'step.awaitingApproval',
            now,
            {
              from: step.state,
              to: 'awaitingApproval',
              approvalId,
              actionDigest: input.actionDigest,
              agentVersionId: step.agentVersionId,
              idempotencyKey: step.idempotencyKey ?? null,
            },
            input.stepId,
          ),
        );

        if (graph.run.state !== 'paused' && graph.run.state !== 'awaitingToolApproval') {
          const runUpdate = this.raw
            .prepare(
              `UPDATE run SET state = 'awaitingToolApproval', updated_at = ?
             WHERE id = ? AND state = ?`,
            )
            .run(now, input.runId, graph.run.state);
          if (runUpdate.changes !== 1) {
            throw new Error(`run.approval_conflict: ${input.runId}`);
          }
          events.push(
            this.createTransitionEvent(scope, input.runId, 'run', 'run.awaitingToolApproval', now, {
              from: graph.run.state,
              to: 'awaitingToolApproval',
              approvalId,
              stepId: input.stepId,
            }),
          );
        }
        return this.commitGraphTransition(input.runId, events, now);
      })
      .immediate();
  }

  resolveStepApproval(input: ResolveStepApprovalInput): RunGraph {
    const approvalId = String(input.approvalId ?? '').trim();
    if (!approvalId || approvalId.length > 256) throw new Error('approval.id_invalid');
    if (!/^[a-f0-9]{64}$/.test(input.actionDigest)) {
      throw new Error('approval.action_digest_invalid');
    }
    if (input.decidedBy === 'delegate' && !input.delegateAgentVersionId) {
      throw new Error('approval.delegate_agent_version_required');
    }
    const now = input.now ?? new Date().toISOString();
    return this.raw
      .transaction(() => {
        const graph = this.getRequiredGraph(input.runId);
        const step = graph.steps.find((candidate) => candidate.id === input.stepId);
        if (!step) throw new Error(`Step not found: ${input.runId}/${input.stepId}`);
        const binding = this.getStepApprovalBinding(input.runId, input.stepId);
        if (
          binding?.approvalId !== approvalId ||
          binding.actionDigest !== input.actionDigest ||
          binding.agentVersionId !== step.agentVersionId
        ) {
          throw new Error(`step.approval_binding_mismatch: ${input.stepId}`);
        }
        if (step.state !== 'awaitingApproval') {
          if (
            this.hasStepApprovalResolution(
              input.runId,
              input.stepId,
              approvalId,
              input.actionDigest,
              input.decision,
            )
          ) {
            return graph;
          }
          throw new Error(`step.not_awaiting_approval: ${step.state}`);
        }

        const scope = this.getRunScope(input.runId);
        const events: EventDraft[] = [];
        const commonPayload = {
          approvalId,
          actionDigest: input.actionDigest,
          decidedBy: input.decidedBy,
          ...(input.delegateAgentVersionId
            ? { delegateAgentVersionId: input.delegateAgentVersionId }
            : {}),
        };
        events.push(
          this.createTransitionEvent(
            scope,
            input.runId,
            'approval',
            'approval.decided',
            now,
            {
              decision: input.decision,
              stepId: input.stepId,
              ...commonPayload,
            },
            input.stepId,
          ),
        );
        if (input.decision === 'approved') {
          const update = this.raw
            .prepare(
              `UPDATE step SET state = 'ready', updated_at = ?
             WHERE run_id = ? AND id = ? AND state = 'awaitingApproval'`,
            )
            .run(now, input.runId, input.stepId);
          if (update.changes !== 1) throw new Error(`step.approval_conflict: ${step.id}`);
          events.push(
            this.createTransitionEvent(
              scope,
              input.runId,
              'step',
              'step.ready',
              now,
              {
                from: 'awaitingApproval',
                to: 'ready',
                reason: 'approval-approved',
                ...commonPayload,
              },
              input.stepId,
            ),
          );
        } else {
          const update = this.raw
            .prepare(
              `UPDATE step SET state = 'failed', updated_at = ?
             WHERE run_id = ? AND id = ? AND state = 'awaitingApproval'`,
            )
            .run(now, input.runId, input.stepId);
          if (update.changes !== 1) throw new Error(`step.approval_conflict: ${step.id}`);
          events.push(
            this.createTransitionEvent(
              scope,
              input.runId,
              'step',
              'step.failed',
              now,
              {
                from: 'awaitingApproval',
                to: 'failed',
                failureClass: 'permission',
                code: 'approval.rejected',
                summary: 'Protected action was rejected',
                ...commonPayload,
              },
              input.stepId,
            ),
          );
        }

        const afterStep = this.getRequiredGraph(input.runId);
        if (afterStep.run.state !== 'paused') {
          const stateById = new Map(
            afterStep.steps.map((candidate) => [candidate.id, candidate.state]),
          );
          const hasAwaiting = afterStep.steps.some(
            (candidate) => candidate.state === 'awaitingApproval',
          );
          const hasRunnable = afterStep.steps.some(
            (candidate) =>
              candidate.state === 'running' ||
              candidate.state === 'ready' ||
              candidate.state === 'awaitingApproval' ||
              (candidate.state === 'pending' &&
                this.isStepEligibleForReady(input.runId, candidate, stateById, afterStep)),
          );
          const target: RunState = hasAwaiting
            ? 'awaitingToolApproval'
            : hasRunnable
              ? 'running'
              : input.decision === 'rejected'
                ? 'failed'
                : 'running';
          if (target !== afterStep.run.state) {
            const runUpdate = this.raw
              .prepare('UPDATE run SET state = ?, updated_at = ? WHERE id = ? AND state = ?')
              .run(target, now, input.runId, afterStep.run.state);
            if (runUpdate.changes !== 1) {
              throw new Error(`run.approval_conflict: ${input.runId}`);
            }
            events.push(
              this.createTransitionEvent(
                scope,
                input.runId,
                'run',
                target === 'failed'
                  ? 'run.failed'
                  : target === 'awaitingToolApproval'
                    ? 'run.awaitingToolApproval'
                    : 'run.running',
                now,
                {
                  from: afterStep.run.state,
                  to: target,
                  reason: input.decision === 'approved' ? 'approval-approved' : 'approval-rejected',
                  approvalId,
                  stepId: input.stepId,
                },
              ),
            );
          }
        }
        return this.commitGraphTransition(input.runId, events, now);
      })
      .immediate();
  }

  pauseRun(runId: RunId, now: string = new Date().toISOString()): RunGraph {
    return this.raw
      .transaction(() => {
        const graph = this.getRequiredGraph(runId);
        if (
          graph.run.state === 'paused' ||
          graph.run.state === 'completed' ||
          graph.run.state === 'failed' ||
          graph.run.state === 'cancelled'
        ) {
          return graph;
        }
        const update = this.raw
          .prepare(
            `UPDATE run SET state = 'paused', updated_at = ?
           WHERE id = ? AND state NOT IN ('paused', 'completed', 'failed', 'cancelled')`,
          )
          .run(now, runId);
        if (update.changes !== 1) throw new Error(`run.pause_conflict: ${runId}`);
        const scope = this.getRunScope(runId);
        return this.commitGraphTransition(
          runId,
          [
            this.createTransitionEvent(scope, runId, 'run', 'run.paused', now, {
              from: graph.run.state,
              to: 'paused',
            }),
          ],
          now,
        );
      })
      .immediate();
  }

  resumeRun(runId: RunId, now: string = new Date().toISOString()): RunGraph {
    return this.raw
      .transaction(() => {
        const graph = this.getRequiredGraph(runId);
        if (
          graph.run.state === 'completed' ||
          graph.run.state === 'failed' ||
          graph.run.state === 'cancelled' ||
          graph.run.state !== 'paused'
        ) {
          return graph;
        }
        if (this.artifactStore.hasUnresolvedMergeConflicts(runId)) {
          throw new Error(`run.merge_conflict_unresolved: ${runId}`);
        }

        const unresolvedGates = this.raw
          .prepare(
            `SELECT gate_row.id, gate_row.state, target_step.state AS target_state
           FROM acceptance_gate AS gate_row
           JOIN step AS target_step
             ON target_step.run_id = gate_row.run_id
            AND target_step.id = gate_row.target_step_id
           WHERE gate_row.run_id = ? AND gate_row.state <> 'accepted'
           ORDER BY gate_row.created_at ASC, gate_row.id ASC`,
          )
          .all(runId) as Array<{
          id: string;
          state: 'active' | 'limit-reached';
          target_state: string;
        }>;
        if (unresolvedGates.some((gate) => gate.state === 'limit-reached')) return graph;
        const activeReviewSteps = this.raw
          .prepare(
            `SELECT gate_step.gate_id, gate_step.role
           FROM acceptance_gate_step AS gate_step
           JOIN acceptance_gate AS gate_row ON gate_row.id = gate_step.gate_id
           JOIN step AS step_row
             ON step_row.run_id = gate_step.run_id AND step_row.id = gate_step.step_id
           WHERE gate_step.run_id = ? AND gate_row.state = 'active'
             AND step_row.state IN ('pending', 'ready', 'running', 'awaitingApproval')
           ORDER BY step_row.plan_order DESC, step_row.id ASC`,
          )
          .all(runId) as Array<{ gate_id: string; role: 'reviewer' | 'rework' }>;
        const gatesWithActiveReview = new Set(activeReviewSteps.map((step) => step.gate_id));
        if (
          unresolvedGates.some(
            (gate) => gate.target_state === 'completed' && !gatesWithActiveReview.has(gate.id),
          )
        ) {
          return graph;
        }
        const activeReviewStep = activeReviewSteps[0];

        const allCompleted = graph.steps.every(
          (step) => step.state === 'completed' || step.state === 'skipped',
        );
        const stateById = new Map(graph.steps.map((step) => [step.id, step.state]));
        const hasAwaitingApproval = graph.steps.some((step) => step.state === 'awaitingApproval');
        const hasRunnableStep = graph.steps.some(
          (step) =>
            step.state === 'running' ||
            step.state === 'ready' ||
            step.state === 'awaitingApproval' ||
            (step.state === 'pending' &&
              this.isStepEligibleForReady(runId, step, stateById, graph)),
        );
        const target = activeReviewStep
          ? activeReviewStep.role === 'reviewer'
            ? 'reviewing'
            : 'revising'
          : allCompleted
            ? 'completed'
            : hasAwaitingApproval
              ? 'awaitingToolApproval'
              : hasRunnableStep
                ? graph.steps.every((step) => step.state === 'pending')
                  ? 'queued'
                  : 'running'
                : 'failed';
        const update = this.raw
          .prepare('UPDATE run SET state = ?, updated_at = ? WHERE id = ? AND state = ?')
          .run(target, now, runId, 'paused');
        if (update.changes !== 1) throw new Error(`run.resume_conflict: ${runId}`);
        const scope = this.getRunScope(runId);
        return this.commitGraphTransition(
          runId,
          [
            this.createTransitionEvent(
              scope,
              runId,
              'run',
              target === 'completed'
                ? 'run.completed'
                : target === 'failed'
                  ? 'run.failed'
                  : target === 'awaitingToolApproval'
                    ? 'run.awaitingToolApproval'
                    : target === 'reviewing'
                      ? 'run.reviewing'
                      : target === 'revising'
                        ? 'run.revising'
                        : target === 'queued'
                          ? 'run.queued'
                          : 'run.running',
              now,
              { from: 'paused', to: target, reason: 'resumed-by-user' },
            ),
          ],
          now,
        );
      })
      .immediate();
  }

  cancelRun(runId: RunId, now: string = new Date().toISOString()): RunGraph {
    return this.raw
      .transaction(() => {
        const graph = this.getRequiredGraph(runId);
        if (
          graph.run.state === 'completed' ||
          graph.run.state === 'failed' ||
          graph.run.state === 'cancelled'
        ) {
          return graph;
        }

        const scope = this.getRunScope(runId);
        const events: EventDraft[] = [];
        for (const step of graph.steps) {
          if (
            step.state === 'completed' ||
            step.state === 'failed' ||
            step.state === 'skipped' ||
            step.state === 'cancelled'
          ) {
            continue;
          }
          const cancelled = this.raw
            .prepare(
              `UPDATE step SET state = 'cancelled', execution_owner_id = NULL,
               lease_expires_at = NULL, updated_at = ?
             WHERE run_id = ? AND id = ?
               AND state IN ('pending', 'ready', 'running', 'awaitingApproval')`,
            )
            .run(now, runId, step.id);
          if (cancelled.changes !== 1) throw new Error(`step.cancel_conflict: ${step.id}`);
          events.push(
            this.createTransitionEvent(
              scope,
              runId,
              'step',
              'step.cancelled',
              now,
              {
                from: step.state,
                to: 'cancelled',
              },
              step.id,
            ),
          );
        }

        const cancelledRun = this.raw
          .prepare(
            `UPDATE run SET state = 'cancelled', updated_at = ?
           WHERE id = ? AND state NOT IN ('completed', 'failed', 'cancelled')`,
          )
          .run(now, runId);
        if (cancelledRun.changes !== 1) throw new Error(`run.cancel_conflict: ${runId}`);
        events.push(
          this.createTransitionEvent(scope, runId, 'run', 'run.cancelled', now, {
            from: graph.run.state,
            to: 'cancelled',
          }),
        );
        return this.commitGraphTransition(runId, events, now);
      })
      .immediate();
  }

  private listAcceptanceCriteria(gateId: AcceptanceGateId): AcceptanceCriterion[] {
    const rows = this.raw
      .prepare(
        `SELECT id, description, plan_order FROM acceptance_criterion
           WHERE gate_id = ? ORDER BY plan_order ASC`,
      )
      .all(gateId) as Array<{ id: string; description: string; plan_order: number }>;
    const descriptions = normalizeAcceptanceCriteria(
      rows.map((row) => row.description),
      { requireNonEmpty: true },
    );
    return rows.map((row, index) => ({
      id: row.id,
      description: descriptions[index]!,
      planOrder: row.plan_order,
    }));
  }

  private getRequiredAcceptanceGate(gateId: AcceptanceGateId): AcceptanceGate {
    const gate = this.getAcceptanceGate(gateId);
    if (!gate) throw new Error(`AcceptanceGate not found: ${gateId}`);
    return gate;
  }

  private getAcceptanceGateForTarget(
    runId: RunId,
    targetStepId: StepId,
  ): AcceptanceGate | undefined {
    const row = this.raw
      .prepare('SELECT id FROM acceptance_gate WHERE run_id = ? AND target_step_id = ?')
      .get(runId, targetStepId) as { id: string } | undefined;
    return row ? this.getRequiredAcceptanceGate(row.id as AcceptanceGateId) : undefined;
  }

  private getReviewStepMapping(runId: RunId, stepId: StepId): AcceptanceGateStepDbRow | undefined {
    const mapping = this.raw
      .prepare(
        `SELECT gate_id, run_id, step_id, role, iteration, derivation, source_evidence_id
         FROM acceptance_gate_step WHERE run_id = ? AND step_id = ?`,
      )
      .get(runId, stepId) as AcceptanceGateStepDbRow | undefined;
    if (mapping) this.assertReviewSourceEvidenceIntegrity(mapping);
    return mapping;
  }

  private assertReviewSourceEvidenceIntegrity(mapping: AcceptanceGateStepDbRow): void {
    if (mapping.derivation === 'initial') {
      if (
        mapping.role !== 'reviewer' ||
        mapping.iteration !== 0 ||
        mapping.source_evidence_id !== null
      ) {
        throw new Error('review.source_evidence_mismatch');
      }
      return;
    }
    if (
      !mapping.source_evidence_id ||
      (mapping.derivation === 'reassign' && mapping.role !== 'reviewer') ||
      (mapping.derivation === 'rework' && mapping.role !== 'reviewer' && mapping.role !== 'rework')
    ) {
      throw new Error('review.source_evidence_mismatch');
    }
    const evidence = this.raw
      .prepare(
        `SELECT gate_id, run_id, iteration, verdict
         FROM review_evidence WHERE id = ?`,
      )
      .get(mapping.source_evidence_id) as
      { gate_id: string; run_id: string; iteration: number; verdict: string } | undefined;
    const expectedIteration =
      mapping.derivation === 'reassign' ? mapping.iteration : mapping.iteration - 1;
    if (
      !evidence ||
      evidence.gate_id !== mapping.gate_id ||
      evidence.run_id !== mapping.run_id ||
      evidence.verdict !== 'reject' ||
      evidence.iteration !== expectedIteration
    ) {
      throw new Error('review.source_evidence_mismatch');
    }
  }

  private mapReviewEvidence(row: ReviewEvidenceDbRow): ReviewEvidence {
    const criteria = (
      this.raw
        .prepare(
          `SELECT evidence_criterion.criterion_id, evidence_criterion.verdict,
             evidence_criterion.explanation
           FROM review_evidence_criterion AS evidence_criterion
           JOIN acceptance_criterion AS criterion
             ON criterion.gate_id = evidence_criterion.gate_id
            AND criterion.id = evidence_criterion.criterion_id
           WHERE evidence_criterion.evidence_id = ?
           ORDER BY criterion.plan_order ASC`,
        )
        .all(row.id) as Array<{
        criterion_id: string;
        verdict: 'pass' | 'fail';
        explanation: string;
      }>
    ).map((criterion) => ({
      criterionId: criterion.criterion_id,
      verdict: criterion.verdict,
      explanation: criterion.explanation,
    }));
    const reviewedArtifactVersionIds = (
      this.raw
        .prepare(
          `SELECT artifact_version_id FROM review_evidence_artifact
           WHERE evidence_id = ? ORDER BY artifact_version_id ASC`,
        )
        .all(row.id) as Array<{ artifact_version_id: string }>
    ).map((artifact) => artifact.artifact_version_id as ArtifactVersionId);
    return {
      id: row.id,
      gateId: row.gate_id as AcceptanceGateId,
      runId: row.run_id as RunId,
      targetStepId: row.target_step_id as StepId,
      reviewerStepId: row.reviewer_step_id as StepId,
      reviewerAgentVersionId: row.reviewer_agent_version_id as AgentVersionId,
      iteration: row.iteration,
      verdict: row.verdict,
      explanation: row.explanation,
      criteria,
      reviewedArtifactVersionIds,
      createdAt: row.created_at,
    };
  }

  private getRequiredReviewEvidence(evidenceId: string): ReviewEvidence {
    const row = this.raw.prepare('SELECT * FROM review_evidence WHERE id = ?').get(evidenceId) as
      ReviewEvidenceDbRow | undefined;
    if (!row) throw new Error(`ReviewEvidence not found: ${evidenceId}`);
    return this.mapReviewEvidence(row);
  }

  private getReviewEvidenceForStep(
    runId: RunId,
    reviewerStepId: StepId,
  ): ReviewEvidence | undefined {
    const row = this.raw
      .prepare('SELECT * FROM review_evidence WHERE run_id = ? AND reviewer_step_id = ?')
      .get(runId, reviewerStepId) as ReviewEvidenceDbRow | undefined;
    return row ? this.mapReviewEvidence(row) : undefined;
  }

  private normalizeReviewOutcome(
    gate: AcceptanceGate,
    mapping: AcceptanceGateStepDbRow,
    value: ReviewOutcome,
  ): ReviewOutcome {
    if (!value || (value.verdict !== 'accept' && value.verdict !== 'reject')) {
      throw new OrchestrationDomainError('review.verdict_invalid');
    }
    const explanation = reviewOutcomeText(value.explanation, 'review.explanation_invalid');
    if (!Array.isArray(value.criteria) || value.criteria.length !== gate.criteria.length) {
      throw new OrchestrationDomainError('review.criteria_mismatch');
    }
    const outcomesById = new Map<string, ReviewOutcome['criteria'][number]>();
    for (const criterion of value.criteria) {
      const criterionId = reviewOutcomeText(
        criterion?.criterionId,
        'review.criterion_id_invalid',
        256,
      );
      if (outcomesById.has(criterionId)) {
        throw new OrchestrationDomainError('review.criteria_mismatch');
      }
      if (criterion.verdict !== 'pass' && criterion.verdict !== 'fail') {
        throw new OrchestrationDomainError('review.criterion_verdict_invalid');
      }
      outcomesById.set(criterionId, {
        criterionId,
        verdict: criterion.verdict,
        explanation: reviewOutcomeText(
          criterion.explanation,
          'review.criterion_explanation_invalid',
        ),
      });
    }
    const criteria = gate.criteria.map((criterion) => {
      const outcome = outcomesById.get(criterion.id);
      if (!outcome) throw new OrchestrationDomainError('review.criteria_mismatch');
      return outcome;
    });
    if (!isReviewOutcomeConsistent({ verdict: value.verdict, criteria })) {
      throw new OrchestrationDomainError('review.verdict_criteria_mismatch');
    }

    if (!Array.isArray(value.reviewedArtifactVersionIds)) {
      throw new OrchestrationDomainError('review.artifact_scope_mismatch');
    }
    const requestedIds = value.reviewedArtifactVersionIds.map(
      (id) => reviewOutcomeText(id, 'review.artifact_scope_mismatch', 256) as ArtifactVersionId,
    );
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new OrchestrationDomainError('review.artifact_scope_mismatch');
    }
    const assignedIds = this.listEffectiveReviewerArtifactVersionIds(
      mapping.gate_id,
      mapping.run_id as RunId,
      mapping.step_id as StepId,
    );
    if (
      assignedIds.length === 0 ||
      assignedIds.length !== requestedIds.length ||
      assignedIds.some((id) => !requestedIds.includes(id))
    ) {
      throw new OrchestrationDomainError('review.artifact_scope_mismatch');
    }
    return {
      verdict: value.verdict,
      explanation,
      criteria,
      reviewedArtifactVersionIds: assignedIds,
    };
  }

  private reviewEvidenceMatches(evidence: ReviewEvidence, outcome: ReviewOutcome): boolean {
    return (
      evidence.verdict === outcome.verdict &&
      evidence.explanation === outcome.explanation &&
      JSON.stringify(evidence.criteria) === JSON.stringify(outcome.criteria) &&
      JSON.stringify(evidence.reviewedArtifactVersionIds) ===
        JSON.stringify(outcome.reviewedArtifactVersionIds)
    );
  }

  private hasUnresolvedAcceptanceGate(runId: RunId): boolean {
    return Boolean(
      this.raw
        .prepare("SELECT 1 FROM acceptance_gate WHERE run_id = ? AND state <> 'accepted' LIMIT 1")
        .get(runId),
    );
  }

  private assertValidReworkOutputs(
    mapping: AcceptanceGateStepDbRow,
    outputs: readonly StepArtifactVersionOutput[],
  ): void {
    if (!mapping.source_evidence_id || outputs.length === 0) {
      throw new Error('review.rework_output_required');
    }
    const evidence = this.getRequiredReviewEvidence(mapping.source_evidence_id);
    const reviewedByArtifact = new Map<ArtifactId, Set<ArtifactVersionId>>();
    for (const versionId of evidence.reviewedArtifactVersionIds) {
      const version = this.artifactStore.getVersion(versionId);
      if (!version) throw new Error(`ArtifactVersion not found: ${versionId}`);
      const versions = reviewedByArtifact.get(version.artifactId) ?? new Set<ArtifactVersionId>();
      versions.add(version.id);
      reviewedByArtifact.set(version.artifactId, versions);
    }
    const outputArtifacts = new Set<ArtifactId>();
    for (const output of outputs) {
      if (!('artifactId' in output) || !output.artifactId) {
        throw new Error('review.rework_output_scope_mismatch');
      }
      const parents = reviewedByArtifact.get(output.artifactId);
      const generatedImageCandidate =
        'contentRef' in output &&
        output.mimeType.startsWith('image/') &&
        output.metadata?.executionKind === 'image-generation' &&
        output.metadata?.generationKind === 'image';
      if (!parents || (outputArtifacts.has(output.artifactId) && !generatedImageCandidate)) {
        throw new Error('review.rework_output_scope_mismatch');
      }
      if (
        output.status !== 'candidate' &&
        output.status !== 'selected' &&
        output.status !== 'merged'
      ) {
        throw new Error('review.rework_output_status_invalid');
      }
      if (
        !output.parentVersionIds?.length ||
        output.parentVersionIds.some((parentId) => !parents.has(parentId))
      ) {
        throw new Error('review.rework_parent_required');
      }
      outputArtifacts.add(output.artifactId);
    }
  }

  private reviewerArtifactsAfterRework(
    mapping: AcceptanceGateStepDbRow,
    outputVersions: readonly ArtifactVersion[],
  ): ArtifactVersionId[] {
    if (!mapping.source_evidence_id) throw new Error('review.rework_output_required');
    const evidence = this.getRequiredReviewEvidence(mapping.source_evidence_id);
    const replacedParentIds = new Set(
      outputVersions.flatMap((version) => version.parentVersionIds),
    );
    return [
      ...evidence.reviewedArtifactVersionIds.filter(
        (versionId) => !replacedParentIds.has(versionId),
      ),
      ...outputVersions.map((version) => version.id),
    ];
  }

  private nextPlanOrder(runId: RunId): number {
    const row = this.raw
      .prepare('SELECT COALESCE(MAX(plan_order), -1) + 1 AS plan_order FROM step WHERE run_id = ?')
      .get(runId) as { plan_order: number };
    return row.plan_order;
  }

  private deriveReviewerStep(input: {
    gate: AcceptanceGate;
    iteration: number;
    derivation: 'initial' | 'rework' | 'reassign';
    dependsOnStepId: StepId;
    sourceEvidenceId?: string;
    artifactVersionIds: readonly ArtifactVersionId[];
    events: EventDraft[];
    now: string;
  }): StepId {
    if (input.artifactVersionIds.length === 0) throw new Error('review.artifact_required');
    const reviewerAgentVersionId =
      input.derivation === 'reassign'
        ? input.gate.backupAgentVersionId
        : input.gate.reviewerAgentVersionId;
    if (!reviewerAgentVersionId) throw new Error('review.backup_reviewer_missing');
    const plannedInitial =
      input.derivation === 'initial'
        ? (this.raw
            .prepare(
              `SELECT * FROM acceptance_gate_step
               WHERE gate_id = ? AND run_id = ? AND role = 'reviewer'
                 AND iteration = 0 AND derivation = 'initial'`,
            )
            .get(input.gate.id, input.gate.runId) as AcceptanceGateStepDbRow | undefined)
        : undefined;
    if (plannedInitial) {
      const stepId = plannedInitial.step_id as StepId;
      const ready = this.raw
        .prepare(
          `UPDATE step SET state = 'ready', updated_at = ?
           WHERE run_id = ? AND id = ? AND state = 'pending' AND agent_version_id = ?`,
        )
        .run(input.now, input.gate.runId, stepId, reviewerAgentVersionId);
      if (ready.changes !== 1) throw new Error(`review.initial_reviewer_not_pending: ${stepId}`);
      const assign = this.raw.prepare(
        `INSERT INTO review_step_artifact (
           gate_id, run_id, reviewer_step_id, artifact_version_id
         ) VALUES (?, ?, ?, ?)`,
      );
      for (const artifactVersionId of [...new Set(input.artifactVersionIds)].sort()) {
        assign.run(input.gate.id, input.gate.runId, stepId, artifactVersionId);
      }
      const scope = this.getRunScope(input.gate.runId);
      input.events.push(
        this.createTransitionEvent(
          scope,
          input.gate.runId,
          'review',
          'review.step-derived',
          input.now,
          {
            gateId: input.gate.id,
            role: 'reviewer',
            derivation: 'initial',
            iteration: 0,
            reviewerAgentVersionId,
            sourceEvidenceId: null,
            artifactVersionIds: input.artifactVersionIds,
            planned: true,
          },
          stepId,
        ),
        this.createTransitionEvent(
          scope,
          input.gate.runId,
          'step',
          'step.ready',
          input.now,
          {
            from: 'pending',
            to: 'ready',
            reason: 'planned-reviewer-assigned',
            gateId: input.gate.id,
            iteration: 0,
          },
          stepId,
        ),
      );
      return stepId;
    }
    const stepId = stableDerivedReviewStepId(
      input.gate.id,
      'reviewer',
      input.iteration,
      input.derivation,
    );
    this.raw
      .prepare(
        `INSERT INTO step (
           id, run_id, plan_order, title, instructions, agent_version_id,
           image_generation_config_json, state, retries, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', 0, ?, ?)`,
      )
      .run(
        stepId,
        input.gate.runId,
        this.nextPlanOrder(input.gate.runId),
        `Review iteration ${input.iteration}`,
        'Evaluate the assigned artifact versions against the persisted acceptance criteria.',
        reviewerAgentVersionId,
        null,
        input.now,
        input.now,
      );
    this.raw
      .prepare('INSERT INTO step_dependency (run_id, step_id, depends_on_step_id) VALUES (?, ?, ?)')
      .run(input.gate.runId, stepId, input.dependsOnStepId);
    this.raw
      .prepare(
        `INSERT INTO acceptance_gate_step (
           gate_id, run_id, step_id, role, iteration, derivation, source_evidence_id
         ) VALUES (?, ?, ?, 'reviewer', ?, ?, ?)`,
      )
      .run(
        input.gate.id,
        input.gate.runId,
        stepId,
        input.iteration,
        input.derivation,
        input.sourceEvidenceId ?? null,
      );
    const assign = this.raw.prepare(
      `INSERT INTO review_step_artifact (
         gate_id, run_id, reviewer_step_id, artifact_version_id
       ) VALUES (?, ?, ?, ?)`,
    );
    for (const artifactVersionId of [...new Set(input.artifactVersionIds)].sort()) {
      assign.run(input.gate.id, input.gate.runId, stepId, artifactVersionId);
    }
    const scope = this.getRunScope(input.gate.runId);
    input.events.push(
      this.createTransitionEvent(
        scope,
        input.gate.runId,
        'review',
        'review.step-derived',
        input.now,
        {
          gateId: input.gate.id,
          role: 'reviewer',
          derivation: input.derivation,
          iteration: input.iteration,
          reviewerAgentVersionId,
          sourceEvidenceId: input.sourceEvidenceId ?? null,
          artifactVersionIds: input.artifactVersionIds,
        },
        stepId,
      ),
      this.createTransitionEvent(
        scope,
        input.gate.runId,
        'step',
        'step.ready',
        input.now,
        {
          from: 'derived',
          to: 'ready',
          reason: 'review-step-derived',
          gateId: input.gate.id,
          iteration: input.iteration,
        },
        stepId,
      ),
    );
    return stepId;
  }

  private deriveReworkStep(input: {
    gate: AcceptanceGate;
    iteration: number;
    dependsOnStepId: StepId;
    sourceEvidenceId: string;
    events: EventDraft[];
    now: string;
  }): StepId {
    const target = this.getRequiredGraph(input.gate.runId).steps.find(
      (step) => step.id === input.gate.targetStepId,
    );
    if (!target) throw new Error(`review.target_step_scope_mismatch: ${input.gate.targetStepId}`);
    const stepId = stableDerivedReviewStepId(input.gate.id, 'rework', input.iteration, 'rework');
    this.raw
      .prepare(
        `INSERT INTO step (
           id, run_id, plan_order, title, instructions, agent_version_id,
           image_generation_config_json, state, retries, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', 0, ?, ?)`,
      )
      .run(
        stepId,
        input.gate.runId,
        this.nextPlanOrder(input.gate.runId),
        `Rework iteration ${input.iteration}`,
        'Produce a new artifact version that addresses the persisted review evidence.',
        target.agentVersionId,
        target.imageGeneration ? JSON.stringify(target.imageGeneration) : null,
        input.now,
        input.now,
      );
    this.raw
      .prepare('INSERT INTO step_dependency (run_id, step_id, depends_on_step_id) VALUES (?, ?, ?)')
      .run(input.gate.runId, stepId, input.dependsOnStepId);
    this.raw
      .prepare(
        `INSERT INTO acceptance_gate_step (
           gate_id, run_id, step_id, role, iteration, derivation, source_evidence_id
         ) VALUES (?, ?, ?, 'rework', ?, 'rework', ?)`,
      )
      .run(input.gate.id, input.gate.runId, stepId, input.iteration, input.sourceEvidenceId);
    const scope = this.getRunScope(input.gate.runId);
    input.events.push(
      this.createTransitionEvent(
        scope,
        input.gate.runId,
        'review',
        'review.step-derived',
        input.now,
        {
          gateId: input.gate.id,
          role: 'rework',
          derivation: 'rework',
          iteration: input.iteration,
          agentVersionId: target.agentVersionId,
          sourceEvidenceId: input.sourceEvidenceId,
        },
        stepId,
      ),
      this.createTransitionEvent(
        scope,
        input.gate.runId,
        'step',
        'step.ready',
        input.now,
        {
          from: 'derived',
          to: 'ready',
          reason: 'review-rework-derived',
          gateId: input.gate.id,
          iteration: input.iteration,
        },
        stepId,
      ),
    );
    return stepId;
  }

  private transitionRunState(
    runId: RunId,
    target: RunState,
    reason: string,
    events: EventDraft[],
    now: string,
    details: Record<string, unknown> = {},
    options: { allowFromPaused?: boolean } = {},
  ): void {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.state === target) return;
    if (run.state === 'paused' && !options.allowFromPaused) return;
    if (run.state === 'completed' || run.state === 'failed' || run.state === 'cancelled') {
      throw new Error(`review.run_terminal: ${run.state}`);
    }
    const update = this.raw
      .prepare('UPDATE run SET state = ?, updated_at = ? WHERE id = ? AND state = ?')
      .run(target, now, runId, run.state);
    if (update.changes !== 1) throw new Error(`run.review_conflict: ${runId}`);
    const eventType: Record<string, string> = {
      reviewing: 'run.reviewing',
      revising: 'run.revising',
      running: 'run.running',
      awaitingToolApproval: 'run.awaitingToolApproval',
      paused: 'run.paused',
      completed: 'run.completed',
      failed: 'run.failed',
    };
    const type = eventType[target];
    if (!type) throw new Error(`review.run_state_unsupported: ${target}`);
    events.push(
      this.createTransitionEvent(this.getRunScope(runId), runId, 'run', type, now, {
        from: run.state,
        to: target,
        reason,
        ...details,
      }),
    );
  }

  private isStepEligibleForReady(
    runId: RunId,
    step: StoredStep,
    stateById: ReadonlyMap<StepId, StoredStep['state']>,
    currentGraph?: RunGraph,
  ): boolean {
    if (!step.dependsOn.every((dependencyId) => stateById.get(dependencyId) === 'completed')) {
      return false;
    }
    const graph = currentGraph ?? this.getRequiredGraph(runId);
    const byId = new Map(graph.steps.map((candidate) => [candidate.id, candidate]));
    const ancestors = new Set<StepId>();
    const visit = (stepId: StepId): void => {
      const candidate = byId.get(stepId);
      if (!candidate) throw new Error(`step.ready_missing_dependency: ${stepId}`);
      for (const dependencyId of candidate.dependsOn) {
        if (ancestors.has(dependencyId)) continue;
        ancestors.add(dependencyId);
        visit(dependencyId);
      }
    };
    for (const dependencyId of step.dependsOn) {
      if (ancestors.has(dependencyId)) continue;
      ancestors.add(dependencyId);
      visit(dependencyId);
    }

    const mapping = this.getReviewStepMapping(runId, step.id);
    const unresolvedGateRows = this.raw
      .prepare(
        `SELECT gate_row.id, gate_row.target_step_id, gate_step.step_id AS internal_step_id
         FROM acceptance_gate AS gate_row
         LEFT JOIN acceptance_gate_step AS gate_step ON gate_step.gate_id = gate_row.id
         WHERE gate_row.run_id = ? AND gate_row.state <> 'accepted'
         ORDER BY gate_row.created_at ASC, gate_row.id ASC`,
      )
      .all(runId) as Array<{
      id: string;
      target_step_id: string;
      internal_step_id: string | null;
    }>;
    const gates = new Map<string, { targetStepId: StepId; internalStepIds: Set<StepId> }>();
    for (const row of unresolvedGateRows) {
      const gate = gates.get(row.id) ?? {
        targetStepId: row.target_step_id as StepId,
        internalStepIds: new Set<StepId>(),
      };
      if (row.internal_step_id) gate.internalStepIds.add(row.internal_step_id as StepId);
      gates.set(row.id, gate);
    }
    for (const [gateId, gate] of gates) {
      if (mapping?.gate_id === gateId) continue;
      if (ancestors.has(gate.targetStepId)) return false;
      for (const internalStepId of gate.internalStepIds) {
        if (ancestors.has(internalStepId)) return false;
      }
    }
    return true;
  }

  private releaseEligiblePendingSteps(
    runId: RunId,
    events: EventDraft[],
    now: string,
    reason: string,
  ): void {
    const graph = this.getRequiredGraph(runId);
    const stateById = new Map(graph.steps.map((step) => [step.id, step.state]));
    const scope = this.getRunScope(runId);
    for (const step of graph.steps) {
      if (step.state !== 'pending' || !this.isStepEligibleForReady(runId, step, stateById, graph)) {
        continue;
      }
      const ready = this.raw
        .prepare(
          "UPDATE step SET state = 'ready', updated_at = ? WHERE run_id = ? AND id = ? AND state = 'pending'",
        )
        .run(now, runId, step.id);
      if (ready.changes !== 1) throw new Error(`step.ready_conflict: ${step.id}`);
      events.push(
        this.createTransitionEvent(
          scope,
          runId,
          'step',
          'step.ready',
          now,
          { from: 'pending', to: 'ready', reason },
          step.id,
        ),
      );
    }
  }

  private finishAcceptedReview(
    runId: RunId,
    gate: AcceptanceGate,
    events: EventDraft[],
    now: string,
  ): void {
    this.releaseEligiblePendingSteps(runId, events, now, 'review-accepted');
    if (this.hasUnresolvedAcceptanceGate(runId)) return;
    const graph = this.getRequiredGraph(runId);
    const stateById = new Map(graph.steps.map((step) => [step.id, step.state]));
    const allCompleted = graph.steps.every(
      (step) => step.state === 'completed' || step.state === 'skipped',
    );
    const hasAwaiting = graph.steps.some((step) => step.state === 'awaitingApproval');
    const hasRunnable = graph.steps.some(
      (step) =>
        step.state === 'running' ||
        step.state === 'ready' ||
        (step.state === 'pending' && this.isStepEligibleForReady(runId, step, stateById, graph)),
    );
    const target: RunState = allCompleted
      ? 'completed'
      : hasAwaiting
        ? 'awaitingToolApproval'
        : hasRunnable
          ? 'running'
          : 'failed';
    this.transitionRunState(runId, target, 'review-accepted', events, now, {
      gateId: gate.id,
      targetStepId: gate.targetStepId,
    });
  }

  private applyReviewLimit(input: {
    gate: AcceptanceGate;
    mapping: AcceptanceGateStepDbRow;
    evidence: ReviewEvidence;
    events: EventDraft[];
    now: string;
  }): void {
    const { gate, mapping, evidence, events, now } = input;
    const scope = this.getRunScope(gate.runId);
    if (!this.hasReviewLimitEvent(gate.runId, gate.id)) {
      events.push(
        this.createTransitionEvent(
          scope,
          gate.runId,
          'review',
          'review.limit-reached',
          now,
          {
            gateId: gate.id,
            evidenceId: evidence.id,
            reviewerStepId: mapping.step_id,
            reviewerAgentVersionId: evidence.reviewerAgentVersionId,
            iteration: mapping.iteration,
            maxIterations: gate.maxIterations,
            onLimitReached: gate.onLimitReached,
          },
          mapping.step_id as StepId,
        ),
      );
    }

    if (gate.onLimitReached === 'reassign' && !gate.reassigned && gate.backupAgentVersionId) {
      const reassigned = this.raw
        .prepare(
          `UPDATE acceptance_gate SET reassigned = 1
           WHERE id = ? AND state = 'active' AND reassigned = 0`,
        )
        .run(gate.id);
      if (reassigned.changes !== 1) throw new Error(`review.reassign_conflict: ${gate.id}`);
      const stepId = this.deriveReviewerStep({
        gate: { ...gate, reassigned: true },
        iteration: mapping.iteration,
        derivation: 'reassign',
        dependsOnStepId: mapping.step_id as StepId,
        sourceEvidenceId: evidence.id,
        artifactVersionIds: evidence.reviewedArtifactVersionIds,
        events,
        now,
      });
      events.push(
        this.createTransitionEvent(
          scope,
          gate.runId,
          'review',
          'review.reassigned',
          now,
          {
            gateId: gate.id,
            sourceEvidenceId: evidence.id,
            reviewerStepId: stepId,
            delegateAgentVersionId: gate.backupAgentVersionId,
            backupAgentVersionId: gate.backupAgentVersionId,
          },
          stepId,
        ),
      );
      this.transitionRunState(gate.runId, 'reviewing', 'review-reassigned', events, now, {
        gateId: gate.id,
        reviewerStepId: stepId,
        backupAgentVersionId: gate.backupAgentVersionId,
      });
      return;
    }

    const limited = this.raw
      .prepare(
        `UPDATE acceptance_gate SET state = 'limit-reached', resolved_at = ?
         WHERE id = ? AND state = 'active'`,
      )
      .run(now, gate.id);
    if (limited.changes !== 1) throw new Error(`review.gate_conflict: ${gate.id}`);
    if (gate.onLimitReached === 'reassign') {
      events.push(
        this.createTransitionEvent(
          scope,
          gate.runId,
          'review',
          gate.backupAgentVersionId ? 'review.reassign-exhausted' : 'review.reassign-unavailable',
          now,
          {
            gateId: gate.id,
            evidenceId: evidence.id,
            backupAgentVersionId: gate.backupAgentVersionId ?? null,
          },
          mapping.step_id as StepId,
        ),
      );
    }
    if (gate.onLimitReached === 'abort') {
      this.cancelUnfinishedStepsForReviewAbort(gate.runId, gate.id, events, now);
      this.transitionRunState(
        gate.runId,
        'failed',
        'review-limit-abort',
        events,
        now,
        {
          gateId: gate.id,
          evidenceId: evidence.id,
        },
        { allowFromPaused: true },
      );
      return;
    }
    this.transitionRunState(gate.runId, 'paused', 'review-limit-reached', events, now, {
      gateId: gate.id,
      evidenceId: evidence.id,
      failClosed: gate.onLimitReached === 'reassign',
    });
  }

  private hasReviewLimitEvent(runId: RunId, gateId: AcceptanceGateId): boolean {
    return Boolean(
      this.raw
        .prepare(
          `SELECT 1 FROM event WHERE run_id = ? AND type = 'review.limit-reached'
             AND json_valid(payload_json)
             AND json_extract(payload_json, '$.gateId') = ? LIMIT 1`,
        )
        .get(runId, gateId),
    );
  }

  private cancelUnfinishedStepsForReviewAbort(
    runId: RunId,
    gateId: AcceptanceGateId,
    events: EventDraft[],
    now: string,
  ): void {
    const graph = this.getRequiredGraph(runId);
    const scope = this.getRunScope(runId);
    for (const step of graph.steps) {
      if (
        step.state !== 'pending' &&
        step.state !== 'ready' &&
        step.state !== 'running' &&
        step.state !== 'awaitingApproval'
      ) {
        continue;
      }
      const cancelled = this.raw
        .prepare(
          `UPDATE step SET state = 'cancelled', execution_owner_id = NULL,
             lease_expires_at = NULL, updated_at = ?
           WHERE run_id = ? AND id = ? AND state = ?`,
        )
        .run(now, runId, step.id, step.state);
      if (cancelled.changes !== 1) throw new Error(`step.review_abort_conflict: ${step.id}`);
      events.push(
        this.createTransitionEvent(
          scope,
          runId,
          'step',
          'step.cancelled',
          now,
          { from: step.state, to: 'cancelled', reason: 'review-limit-abort', gateId },
          step.id,
        ),
      );
    }
  }

  private getStepApprovalBinding(
    runId: RunId,
    stepId: StepId,
  ): { approvalId: string; actionDigest: string; agentVersionId: AgentVersionId } | undefined {
    const row = this.raw
      .prepare(
        `SELECT payload_json FROM event
         WHERE run_id = ? AND step_id = ? AND type = 'step.awaitingApproval'
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(runId, stepId) as { payload_json: string } | undefined;
    if (!row) return undefined;
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      throw new Error(`step.approval_binding_invalid: ${stepId}`);
    }
    if (!isRecord(payload)) {
      throw new Error(`step.approval_binding_invalid: ${stepId}`);
    }
    const approvalId = payload.approvalId;
    const actionDigest = payload.actionDigest;
    const agentVersionId = payload.agentVersionId;
    if (
      typeof approvalId !== 'string' ||
      approvalId.length === 0 ||
      typeof actionDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(actionDigest) ||
      typeof agentVersionId !== 'string' ||
      agentVersionId.length === 0
    ) {
      throw new Error(`step.approval_binding_invalid: ${stepId}`);
    }
    return {
      approvalId,
      actionDigest,
      agentVersionId: agentVersionId as AgentVersionId,
    };
  }

  private hasStepApprovalResolution(
    runId: RunId,
    stepId: StepId,
    approvalId: string,
    actionDigest: string,
    decision: 'approved' | 'rejected',
  ): boolean {
    const row = this.raw
      .prepare(
        `SELECT 1 AS found FROM event
         WHERE run_id = ? AND step_id = ? AND type = ?
           AND json_valid(payload_json)
           AND json_extract(payload_json, '$.approvalId') = ?
           AND json_extract(payload_json, '$.actionDigest') = ?
         LIMIT 1`,
      )
      .get(
        runId,
        stepId,
        decision === 'approved' ? 'step.ready' : 'step.failed',
        approvalId,
        actionDigest,
      ) as { found: number } | undefined;
    return row?.found === 1;
  }

  private createTransitionEvent(
    scope: { workspaceId: WorkspaceId; taskId: TaskId },
    runId: RunId,
    category: 'run' | 'step' | 'approval' | 'review',
    type: string,
    occurredAt: string,
    payload: Record<string, unknown>,
    stepId?: StepId,
  ): EventDraft {
    return {
      id: ulid() as Event['id'],
      workspaceId: scope.workspaceId,
      taskId: scope.taskId,
      runId,
      ...(stepId ? { stepId } : {}),
      category,
      type,
      occurredAt,
      payload,
    };
  }

  private commitGraphTransition(
    runId: RunId,
    events: readonly EventDraft[],
    now: string,
  ): RunGraph {
    if (events.length === 0) throw new Error('Orchestration transition requires an event');
    const graph = this.getRequiredGraph(runId);
    this.stateStore.commitTransition({
      events: events as EventDraftBatch,
      checkpoint: {
        id: ulid(),
        runId,
        state: {
          schemaVersion: 1,
          kind: 'orchestration-run',
          graph,
        },
        createdAt: now,
      },
    });
    return graph;
  }

  private getRunScope(runId: RunId): { workspaceId: WorkspaceId; taskId: TaskId } {
    const row = this.raw
      .prepare(
        `SELECT task.workspace_id AS workspace_id, run.task_id AS task_id
         FROM run JOIN task ON task.id = run.task_id WHERE run.id = ?`,
      )
      .get(runId) as { workspace_id: string; task_id: string } | undefined;
    if (!row) throw new Error(`Run not found: ${runId}`);
    return { workspaceId: row.workspace_id as WorkspaceId, taskId: row.task_id as TaskId };
  }

  private assertLiveStepFence(
    step: StoredStep,
    idempotencyKey: string,
    ownerId: string,
    executionAttempt: number,
    now: string,
  ): void {
    if (
      step.state !== 'running' ||
      step.idempotencyKey !== idempotencyKey ||
      step.executionOwnerId !== ownerId ||
      step.executionAttempt !== executionAttempt ||
      !isCanonicalIsoInstant(now) ||
      !isCanonicalIsoInstant(step.leaseExpiresAt) ||
      step.leaseExpiresAt <= now
    ) {
      throw new StepFenceMismatchError(step.id);
    }
  }

  private assertOutputArtifactScope(
    runId: RunId,
    outputs: readonly StepArtifactVersionOutput[],
  ): void {
    const scope = this.getRunScope(runId);
    const statement = this.raw.prepare(
      `SELECT workspace_id, task_id, run_id FROM artifact WHERE id = ?`,
    );
    for (const output of outputs) {
      if (!('artifactId' in output) || output.artifactId === undefined) continue;
      const artifact = statement.get(output.artifactId) as
        { workspace_id: string; task_id: string; run_id: string } | undefined;
      if (
        !artifact ||
        artifact.workspace_id !== scope.workspaceId ||
        artifact.task_id !== scope.taskId ||
        artifact.run_id !== runId
      ) {
        throw new Error(`artifact.scope_mismatch: ${output.artifactId}`);
      }
    }
  }

  private createStepOutputVersions(
    runId: RunId,
    stepId: StepId,
    outputs: readonly StepArtifactVersionOutput[],
    forcedStatus: ArtifactVersionStatus | undefined,
    now: string,
  ): ArtifactVersion[] {
    const groupedArtifacts = new Map<string, { artifactId: ArtifactId; artifactName: string }>();
    return outputs.map((output) => {
      const groupKey = output.artifactGroupKey;
      if (groupKey === undefined) {
        return this.createStepOutputVersion(runId, stepId, output, forcedStatus, now);
      }
      if ('artifactId' in output && output.artifactId !== undefined) {
        throw new Error('artifact.group_existing_artifact_forbidden');
      }
      const normalizedGroupKey = requireText(groupKey, 'artifactGroupKey');
      const existing = groupedArtifacts.get(normalizedGroupKey);
      if (existing && existing.artifactName !== output.artifactName) {
        throw new Error('artifact.group_name_mismatch');
      }
      const groupedOutput: StepArtifactVersionOutput = existing
        ? {
            artifactId: existing.artifactId,
            ...(output.content === undefined ? {} : { content: output.content }),
            ...(output.contentRef === undefined ? {} : { contentRef: output.contentRef }),
            ...(output.contentHash === undefined ? {} : { contentHash: output.contentHash }),
            mimeType: output.mimeType,
            status: output.status,
            ...(output.parentVersionIds === undefined
              ? {}
              : { parentVersionIds: output.parentVersionIds }),
            ...(output.metadata === undefined ? {} : { metadata: output.metadata }),
          }
        : output;
      const version = this.createStepOutputVersion(runId, stepId, groupedOutput, forcedStatus, now);
      if (!existing) {
        groupedArtifacts.set(normalizedGroupKey, {
          artifactId: version.artifactId,
          artifactName: output.artifactName,
        });
      }
      return version;
    });
  }

  private createStepOutputVersion(
    runId: RunId,
    stepId: StepId,
    output: StepArtifactVersionOutput,
    forcedStatus: ArtifactVersionStatus | undefined,
    now: string,
  ): ArtifactVersion {
    const artifactId =
      'artifactId' in output && output.artifactId !== undefined
        ? output.artifactId
        : this.artifactStore.createArtifact({
            ...this.getRunScope(runId),
            runId,
            name: output.artifactName,
            now,
          }).id;
    return this.artifactStore.createVersion({
      artifactId,
      sourceStepId: stepId,
      ...(output.content === undefined ? {} : { content: output.content }),
      ...(output.contentRef === undefined ? {} : { contentRef: output.contentRef }),
      ...(output.contentHash === undefined ? {} : { contentHash: output.contentHash }),
      mimeType: output.mimeType,
      status: forcedStatus ?? output.status,
      ...(output.parentVersionIds === undefined
        ? {}
        : { parentVersionIds: output.parentVersionIds }),
      ...(output.metadata === undefined ? {} : { metadata: output.metadata }),
      now,
    });
  }

  private mapStepOutputVersions(
    runId: RunId,
    stepId: StepId,
    idempotencyKey: string,
    outcome: 'completed' | 'failed',
    versions: readonly ArtifactVersion[],
    now: string,
  ): void {
    const insert = this.raw.prepare(
      `INSERT INTO step_output_artifact (
         run_id, step_id, idempotency_key, outcome, artifact_version_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const version of versions) {
      insert.run(runId, stepId, idempotencyKey, outcome, version.id, now);
    }
  }

  private listEffectiveReviewerArtifactVersionIds(
    gateId: string,
    runId: RunId,
    reviewerStepId: StepId,
  ): ArtifactVersionId[] {
    const rows = this.raw
      .prepare(
        `SELECT assignment.artifact_version_id
         FROM review_step_artifact AS assignment
         JOIN artifact_version AS version_row ON version_row.id = assignment.artifact_version_id
         LEFT JOIN review_step_artifact_selection AS frozen
           ON frozen.gate_id = assignment.gate_id
          AND frozen.run_id = assignment.run_id
          AND frozen.reviewer_step_id = assignment.reviewer_step_id
          AND frozen.artifact_id = version_row.artifact_id
         WHERE assignment.gate_id = ?
           AND assignment.run_id = ?
           AND assignment.reviewer_step_id = ?
           AND (frozen.selected_version_id IS NULL
             OR frozen.selected_version_id = assignment.artifact_version_id)
         ORDER BY assignment.artifact_version_id ASC`,
      )
      .all(gateId, runId, reviewerStepId) as Array<{ artifact_version_id: string }>;
    return rows.map((row) => row.artifact_version_id as ArtifactVersionId);
  }

  private listStepSnapshotVersions(graph: RunGraph, step: StoredStep): ArtifactVersion[] {
    const reviewMapping = this.getReviewStepMapping(graph.run.id, step.id);
    if (reviewMapping) {
      const assignedVersionIds =
        reviewMapping.role === 'reviewer'
          ? this.listEffectiveReviewerArtifactVersionIds(
              reviewMapping.gate_id,
              graph.run.id,
              step.id,
            )
          : reviewMapping.source_evidence_id
            ? this.getRequiredReviewEvidence(reviewMapping.source_evidence_id)
                .reviewedArtifactVersionIds
            : (() => {
                throw new Error(`review.rework_evidence_missing: ${step.id}`);
              })();
      return this.loadExactStepSnapshotVersions(step, assignedVersionIds);
    }

    const byId = new Map(graph.steps.map((entry) => [entry.id, entry]));
    const ancestors = new Set<StepId>();
    const visit = (stepId: StepId): void => {
      const candidate = byId.get(stepId);
      if (!candidate) throw new Error(`step.snapshot_missing_dependency: ${stepId}`);
      for (const dependencyId of candidate.dependsOn) {
        if (ancestors.has(dependencyId)) continue;
        ancestors.add(dependencyId);
        visit(dependencyId);
      }
    };
    visit(step.id);
    if (ancestors.size === 0) return [];

    const ancestorIds = [...ancestors];
    const placeholders = ancestorIds.map(() => '?').join(', ');
    const rows = this.raw
      .prepare(
        `SELECT artifact_version.id
         FROM artifact_version
         JOIN artifact ON artifact.id = artifact_version.artifact_id
         WHERE artifact.run_id = ? AND artifact_version.source_run_id = ?
           AND artifact_version.source_step_id IN (${placeholders})
           AND artifact_version.status IN ('candidate', 'selected', 'merged')
         ORDER BY artifact.created_at ASC, artifact.id ASC,
           artifact_version.version ASC, artifact_version.id ASC`,
      )
      .all(graph.run.id, graph.run.id, ...ancestorIds) as Array<{ id: string }>;
    const historicalVersions = rows.map((row) => {
      const version = this.artifactStore.getVersion(
        row.id as import('@sync-think/shared').ArtifactVersionId,
      );
      if (!version) throw new Error(`ArtifactVersion not found: ${row.id}`);
      return version;
    });

    const acceptedByTarget = new Map<StepId, ArtifactVersion[]>();
    const acceptedGates = this.raw
      .prepare(
        `SELECT id, target_step_id FROM acceptance_gate
         WHERE run_id = ? AND state = 'accepted'
         ORDER BY created_at ASC, id ASC`,
      )
      .all(graph.run.id) as Array<{ id: string; target_step_id: string }>;
    for (const row of acceptedGates) {
      const targetStepId = row.target_step_id as StepId;
      if (!ancestors.has(targetStepId)) continue;
      const acceptedEvidence = this.listReviewEvidence(row.id as AcceptanceGateId)
        .filter((evidence) => evidence.verdict === 'accept')
        .at(-1);
      if (!acceptedEvidence) throw new Error(`review.accepted_evidence_missing: ${row.id}`);
      acceptedByTarget.set(
        targetStepId,
        acceptedEvidence.reviewedArtifactVersionIds.map((versionId) => {
          const version = this.artifactStore.getVersion(versionId);
          if (!version) throw new Error(`ArtifactVersion not found: ${versionId}`);
          return version;
        }),
      );
    }

    const insertedTargets = new Set<StepId>();
    const insertedVersions = new Set<ArtifactVersionId>();
    const versions: ArtifactVersion[] = [];
    const append = (version: ArtifactVersion): void => {
      if (insertedVersions.has(version.id)) return;
      insertedVersions.add(version.id);
      versions.push(version);
    };
    for (const version of historicalVersions) {
      const replacements = acceptedByTarget.get(version.sourceStepId);
      if (!replacements) {
        append(version);
        continue;
      }
      if (insertedTargets.has(version.sourceStepId)) continue;
      insertedTargets.add(version.sourceStepId);
      for (const replacement of replacements) append(replacement);
    }

    return this.assertStepSnapshotLimits(step, versions);
  }

  private loadExactStepSnapshotVersions(
    step: StoredStep,
    versionIds: readonly ArtifactVersionId[],
  ): ArtifactVersion[] {
    const versions = versionIds.map((versionId) => {
      const version = this.artifactStore.getVersion(versionId);
      if (!version) throw new Error(`ArtifactVersion not found: ${versionId}`);
      return version;
    });
    return this.assertStepSnapshotLimits(step, versions);
  }

  private assertStepSnapshotLimits(
    step: StoredStep,
    versions: readonly ArtifactVersion[],
  ): ArtifactVersion[] {
    const inlineBytes = versions.reduce(
      (total, version) =>
        total + (typeof version.content === 'string' ? Buffer.byteLength(version.content) : 0),
      0,
    );
    if (
      versions.length > MAX_STEP_SNAPSHOT_VERSIONS ||
      inlineBytes > MAX_STEP_SNAPSHOT_INLINE_BYTES
    ) {
      const limit = versions.length > MAX_STEP_SNAPSHOT_VERSIONS ? 'versions' : 'inline_bytes';
      throw new StepSnapshotLimitError(step.id, limit);
    }
    return [...versions];
  }

  private listStepTransitionOutputVersions(
    runId: RunId,
    stepId: StepId,
    idempotencyKey: string,
    outcome: 'completed' | 'failed',
  ): ArtifactVersion[] {
    const rows = this.raw
      .prepare(
        `SELECT artifact_version.id
         FROM step_output_artifact
         JOIN artifact_version
           ON artifact_version.id = step_output_artifact.artifact_version_id
         WHERE step_output_artifact.run_id = ?
           AND step_output_artifact.step_id = ?
           AND step_output_artifact.idempotency_key = ?
           AND step_output_artifact.outcome = ?
         ORDER BY artifact_version.created_at ASC, artifact_version.id ASC`,
      )
      .all(runId, stepId, idempotencyKey, outcome) as Array<{ id: string }>;
    return rows.map((row) => {
      const version = this.artifactStore.getVersion(
        row.id as import('@sync-think/shared').ArtifactVersionId,
      );
      if (!version) throw new Error(`ArtifactVersion not found: ${row.id}`);
      return version;
    });
  }

  private getRequiredPlanRevision(planId: PlanId, revision: number): PlanRevision {
    const result = this.getPlanRevision(planId, revision);
    if (!result) throw new Error(`PlanRevision not found: ${planId}@${revision}`);
    return result;
  }

  private getRunIdForPlanRevision(planRevisionId: PlanRevisionId): RunId | undefined {
    const row = this.raw
      .prepare('SELECT id FROM run WHERE plan_revision_id = ?')
      .get(planRevisionId) as { id: string } | undefined;
    return row?.id as RunId | undefined;
  }

  private listDependencies(runId: RunId): StepDependencyRecord[] {
    return this.raw
      .prepare(
        `SELECT dependency.run_id, dependency.step_id, dependency.depends_on_step_id
         FROM step_dependency AS dependency
         JOIN step AS child
           ON child.run_id = dependency.run_id AND child.id = dependency.step_id
         JOIN step AS parent
           ON parent.run_id = dependency.run_id AND parent.id = dependency.depends_on_step_id
         WHERE dependency.run_id = ?
         ORDER BY child.plan_order ASC, parent.plan_order ASC`,
      )
      .all(runId)
      .map((row) => {
        const dependency = row as {
          run_id: string;
          step_id: string;
          depends_on_step_id: string;
        };
        return {
          runId: dependency.run_id as RunId,
          stepId: dependency.step_id as StepId,
          dependsOnStepId: dependency.depends_on_step_id as StepId,
        };
      });
  }

  private getRequiredGraph(runId: RunId): RunGraph {
    const graph = this.getGraph(runId);
    if (!graph) throw new Error(`Run not found: ${runId}`);
    return graph;
  }
}
