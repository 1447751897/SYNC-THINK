import { sql } from 'drizzle-orm';
import {
  check,
  type AnySQLiteColumn,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { idColumn } from './ids.js';
import { agentVersion } from './provider.js';
import { task } from './task.js';
import { workspace } from './workspace.js';

export const plan = sqliteTable(
  'plan',
  {
    id: idColumn('id'),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'restrict' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    byTask: index('plan_task_idx').on(t.taskId),
  }),
);

export const planRevision = sqliteTable(
  'plan_revision',
  {
    id: idColumn('id'),
    planId: text('plan_id')
      .notNull()
      .references(() => plan.id, { onDelete: 'restrict' }),
    revision: integer('revision').notNull(),
    title: text('title').notNull(),
    stepsJson: text('steps_json').notNull().default('[]'),
    diffJson: text('diff_json').notNull(),
    state: text('state').notNull().default('draft'),
    createdAt: text('created_at').notNull(),
    approvedAt: text('approved_at'),
  },
  (t) => ({
    byPlanRevision: uniqueIndex('plan_revision_plan_revision_uidx').on(t.planId, t.revision),
    byPlanState: index('plan_revision_plan_state_idx').on(t.planId, t.state),
    stateCheck: check(
      'plan_revision_state_check',
      sql`${t.state} IN ('draft', 'approved', 'superseded')`,
    ),
  }),
);

export const run = sqliteTable(
  'run',
  {
    id: idColumn('id'),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'restrict' }),
    planRevisionId: text('plan_revision_id')
      .notNull()
      .references(() => planRevision.id, { onDelete: 'restrict' }),
    workflowVersionId: text('workflow_version_id'),
    state: text('state').notNull().default('queued'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    byPlanRevision: uniqueIndex('run_plan_revision_uidx').on(t.planRevisionId),
    byTaskState: index('run_task_state_idx').on(t.taskId, t.state),
    stateCheck: check(
      'run_state_check',
      sql`${t.state} IN (
        'conversation', 'planDraft', 'awaitingPlanApproval', 'queued', 'running',
        'awaitingToolApproval', 'reviewing', 'revising', 'completed', 'paused',
        'blocked', 'failed', 'cancelled'
      )`,
    ),
  }),
);

export const step = sqliteTable(
  'step',
  {
    id: text('id').notNull(),
    runId: text('run_id')
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('execution'),
    planOrder: integer('plan_order').notNull(),
    title: text('title').notNull(),
    instructions: text('instructions').notNull(),
    agentVersionId: text('agent_version_id')
      .notNull()
      .references(() => agentVersion.id, { onDelete: 'restrict' }),
    modelOverrideId: text('model_override_id'),
    imageGenerationConfigJson: text('image_generation_config_json'),
    state: text('state').notNull().default('pending'),
    retries: integer('retries').notNull().default(0),
    retryOfStepId: text('retry_of_step_id'),
    idempotencyKey: text('idempotency_key'),
    executionOwnerId: text('execution_owner_id'),
    leaseExpiresAt: text('lease_expires_at'),
    executionAttempt: integer('execution_attempt').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    primaryKey: primaryKey({ columns: [t.runId, t.id] }),
    byRunOrder: uniqueIndex('step_run_order_uidx').on(t.runId, t.planOrder),
    byRunState: index('step_run_state_idx').on(t.runId, t.state),
    byExecutionLease: index('step_execution_lease_idx').on(t.state, t.leaseExpiresAt),
    byAgentVersion: index('step_agent_version_idx').on(t.agentVersionId),
    idempotencyKeyUnique: uniqueIndex('step_idempotency_key_uidx')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    idempotencyKeyCheck: check(
      'step_idempotency_key_check',
      sql`${t.idempotencyKey} IS NULL OR (length(trim(${t.idempotencyKey})) > 0 AND length(${t.idempotencyKey}) <= 256)`,
    ),
    stateCheck: check(
      'step_state_check',
      sql`${t.state} IN (
        'pending', 'ready', 'running', 'awaitingApproval', 'completed',
        'failed', 'skipped', 'cancelled'
      )`,
    ),
    kindCheck: check('step_kind_check', sql`${t.kind} IN ('execution', 'merge')`),
  }),
);

export const stepDependency = sqliteTable(
  'step_dependency',
  {
    runId: text('run_id')
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),
    dependsOnStepId: text('depends_on_step_id').notNull(),
  },
  (t) => ({
    primaryKey: primaryKey({ columns: [t.runId, t.stepId, t.dependsOnStepId] }),
    stepForeignKey: foreignKey({
      columns: [t.runId, t.stepId],
      foreignColumns: [step.runId, step.id],
    }).onDelete('cascade'),
    dependencyForeignKey: foreignKey({
      columns: [t.runId, t.dependsOnStepId],
      foreignColumns: [step.runId, step.id],
    }).onDelete('restrict'),
    byDependency: index('step_dependency_run_dependency_idx').on(t.runId, t.dependsOnStepId),
  }),
);

export const artifact = sqliteTable(
  'artifact',
  {
    id: idColumn('id'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'restrict' }),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'restrict' }),
    runId: text('run_id')
      .notNull()
      .references(() => run.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    byRun: index('artifact_run_idx').on(t.runId),
    byTask: index('artifact_task_idx').on(t.taskId),
  }),
);

export const artifactVersion = sqliteTable(
  'artifact_version',
  {
    id: idColumn('id'),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifact.id, { onDelete: 'restrict' }),
    sourceRunId: text('source_run_id').notNull(),
    sourceStepId: text('source_step_id').notNull(),
    status: text('status').notNull(),
    version: integer('version').notNull(),
    content: text('content'),
    contentRef: text('content_ref'),
    contentHash: text('content_hash').notNull(),
    mimeType: text('mime_type').notNull(),
    parentVersionIdsJson: text('parent_version_ids_json').notNull().default('[]'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    operationId: text('operation_id'),
    mergeBaseVersionId: text('merge_base_version_id').references(
      (): AnySQLiteColumn => artifactVersion.id,
      { onDelete: 'restrict' },
    ),
    expectedTaskVersion: integer('expected_task_version'),
    resultingTaskVersion: integer('resulting_task_version'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    byArtifactVersion: uniqueIndex('artifact_version_artifact_version_uidx').on(
      t.artifactId,
      t.version,
    ),
    byOperation: uniqueIndex('artifact_version_operation_uidx').on(t.operationId),
    byArtifact: index('artifact_version_artifact_idx').on(t.artifactId),
    sourceStepForeignKey: foreignKey({
      columns: [t.sourceRunId, t.sourceStepId],
      foreignColumns: [step.runId, step.id],
    }).onDelete('restrict'),
    statusCheck: check(
      'artifact_version_status_check',
      sql`${t.status} IN ('candidate', 'selected', 'rejected', 'incomplete', 'merged')`,
    ),
    versionCheck: check('artifact_version_number_check', sql`${t.version} > 0`),
    contentCheck: check(
      'artifact_version_content_check',
      sql`(${t.content} IS NOT NULL AND ${t.contentRef} IS NULL) OR (${t.content} IS NULL AND ${t.contentRef} IS NOT NULL)`,
    ),
    hashCheck: check(
      'artifact_version_hash_check',
      sql`length(${t.contentHash}) = 64 AND ${t.contentHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    mimeCheck: check(
      'artifact_version_mime_check',
      sql`length(${t.mimeType}) BETWEEN 3 AND 128 AND instr(${t.mimeType}, '/') > 1`,
    ),
    parentJsonCheck: check(
      'artifact_version_parent_json_check',
      sql`json_valid(${t.parentVersionIdsJson})`,
    ),
    metadataJsonCheck: check(
      'artifact_version_metadata_json_check',
      sql`json_valid(${t.metadataJson})`,
    ),
  }),
);

export const stepOutputArtifact = sqliteTable(
  'step_output_artifact',
  {
    runId: text('run_id').notNull(),
    stepId: text('step_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    outcome: text('outcome').notNull(),
    artifactVersionId: text('artifact_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    primaryKey: primaryKey({
      columns: [t.runId, t.stepId, t.idempotencyKey, t.outcome, t.artifactVersionId],
    }),
    stepForeignKey: foreignKey({
      columns: [t.runId, t.stepId],
      foreignColumns: [step.runId, step.id],
    }).onDelete('restrict'),
    artifactVersionUnique: uniqueIndex('step_output_artifact_version_uidx').on(t.artifactVersionId),
    byTransition: index('step_output_artifact_transition_idx').on(
      t.runId,
      t.stepId,
      t.idempotencyKey,
      t.outcome,
    ),
    outcomeCheck: check(
      'step_output_artifact_outcome_check',
      sql`${t.outcome} IN ('completed', 'failed')`,
    ),
  }),
);

export const acceptanceGate = sqliteTable(
  'acceptance_gate',
  {
    id: idColumn('id'),
    runId: text('run_id')
      .notNull()
      .references(() => run.id, { onDelete: 'restrict' }),
    targetStepId: text('target_step_id').notNull(),
    reviewerAgentVersionId: text('reviewer_agent_version_id')
      .notNull()
      .references(() => agentVersion.id, { onDelete: 'restrict' }),
    backupAgentVersionId: text('backup_agent_version_id').references(() => agentVersion.id, {
      onDelete: 'restrict',
    }),
    maxIterations: integer('max_iterations').notNull(),
    onLimitReached: text('on_limit_reached').notNull(),
    state: text('state').notNull().default('active'),
    reassigned: integer('reassigned').notNull().default(0),
    createdAt: text('created_at').notNull(),
    resolvedAt: text('resolved_at'),
  },
  (t) => ({
    byTarget: uniqueIndex('acceptance_gate_run_target_uidx').on(t.runId, t.targetStepId),
    identity: uniqueIndex('acceptance_gate_identity_uidx').on(t.id, t.runId, t.targetStepId),
    targetStepForeignKey: foreignKey({
      columns: [t.runId, t.targetStepId],
      foreignColumns: [step.runId, step.id],
    }).onDelete('restrict'),
    iterationCheck: check('acceptance_gate_iteration_check', sql`${t.maxIterations} >= 0`),
    limitCheck: check(
      'acceptance_gate_limit_check',
      sql`${t.onLimitReached} IN ('pause', 'abort', 'reassign')`,
    ),
    stateCheck: check(
      'acceptance_gate_state_check',
      sql`${t.state} IN ('active', 'accepted', 'limit-reached')`,
    ),
    reassignedCheck: check('acceptance_gate_reassigned_check', sql`${t.reassigned} IN (0, 1)`),
  }),
);

export const acceptanceCriterion = sqliteTable(
  'acceptance_criterion',
  {
    gateId: text('gate_id')
      .notNull()
      .references(() => acceptanceGate.id, { onDelete: 'restrict' }),
    id: text('id').notNull(),
    description: text('description').notNull(),
    planOrder: integer('plan_order').notNull(),
  },
  (t) => ({
    primaryKey: primaryKey({ columns: [t.gateId, t.id] }),
    byOrder: uniqueIndex('acceptance_criterion_gate_order_uidx').on(t.gateId, t.planOrder),
    orderCheck: check('acceptance_criterion_order_check', sql`${t.planOrder} >= 0`),
  }),
);

export const reviewEvidence = sqliteTable(
  'review_evidence',
  {
    id: idColumn('id'),
    gateId: text('gate_id').notNull(),
    runId: text('run_id').notNull(),
    targetStepId: text('target_step_id').notNull(),
    reviewerStepId: text('reviewer_step_id').notNull(),
    reviewerAgentVersionId: text('reviewer_agent_version_id')
      .notNull()
      .references(() => agentVersion.id, { onDelete: 'restrict' }),
    iteration: integer('iteration').notNull(),
    verdict: text('verdict').notNull(),
    explanation: text('explanation').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    byReviewerStep: uniqueIndex('review_evidence_reviewer_step_uidx').on(t.runId, t.reviewerStepId),
    identity: uniqueIndex('review_evidence_identity_uidx').on(t.id, t.gateId),
    gateForeignKey: foreignKey({
      columns: [t.gateId, t.runId, t.targetStepId],
      foreignColumns: [acceptanceGate.id, acceptanceGate.runId, acceptanceGate.targetStepId],
    }).onDelete('restrict'),
    reviewerStepForeignKey: foreignKey({
      columns: [t.runId, t.reviewerStepId],
      foreignColumns: [step.runId, step.id],
    }).onDelete('restrict'),
    iterationCheck: check('review_evidence_iteration_check', sql`${t.iteration} >= 0`),
    verdictCheck: check('review_evidence_verdict_check', sql`${t.verdict} IN ('accept', 'reject')`),
  }),
);

export const reviewEvidenceCriterion = sqliteTable(
  'review_evidence_criterion',
  {
    evidenceId: text('evidence_id').notNull(),
    gateId: text('gate_id').notNull(),
    criterionId: text('criterion_id').notNull(),
    verdict: text('verdict').notNull(),
    explanation: text('explanation').notNull(),
  },
  (t) => ({
    primaryKey: primaryKey({ columns: [t.evidenceId, t.criterionId] }),
    evidenceForeignKey: foreignKey({
      columns: [t.evidenceId, t.gateId],
      foreignColumns: [reviewEvidence.id, reviewEvidence.gateId],
    }).onDelete('restrict'),
    criterionForeignKey: foreignKey({
      columns: [t.gateId, t.criterionId],
      foreignColumns: [acceptanceCriterion.gateId, acceptanceCriterion.id],
    }).onDelete('restrict'),
    verdictCheck: check(
      'review_evidence_criterion_verdict_check',
      sql`${t.verdict} IN ('pass', 'fail')`,
    ),
  }),
);

export const reviewEvidenceArtifact = sqliteTable(
  'review_evidence_artifact',
  {
    evidenceId: text('evidence_id')
      .notNull()
      .references(() => reviewEvidence.id, { onDelete: 'restrict' }),
    artifactVersionId: text('artifact_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
  },
  (t) => ({
    primaryKey: primaryKey({ columns: [t.evidenceId, t.artifactVersionId] }),
  }),
);

export const acceptanceGateStep = sqliteTable(
  'acceptance_gate_step',
  {
    gateId: text('gate_id')
      .notNull()
      .references(() => acceptanceGate.id, { onDelete: 'restrict' }),
    runId: text('run_id').notNull(),
    stepId: text('step_id').notNull(),
    role: text('role').notNull(),
    iteration: integer('iteration').notNull(),
    derivation: text('derivation').notNull(),
    sourceEvidenceId: text('source_evidence_id').references(() => reviewEvidence.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => ({
    primaryKey: primaryKey({ columns: [t.runId, t.stepId] }),
    identity: uniqueIndex('acceptance_gate_step_identity_uidx').on(t.gateId, t.runId, t.stepId),
    derivationUnique: uniqueIndex('acceptance_gate_step_derivation_uidx').on(
      t.gateId,
      t.role,
      t.iteration,
      t.derivation,
    ),
    stepForeignKey: foreignKey({
      columns: [t.runId, t.stepId],
      foreignColumns: [step.runId, step.id],
    }).onDelete('restrict'),
    roleCheck: check('acceptance_gate_step_role_check', sql`${t.role} IN ('reviewer', 'rework')`),
    iterationCheck: check('acceptance_gate_step_iteration_check', sql`${t.iteration} >= 0`),
    derivationCheck: check(
      'acceptance_gate_step_derivation_check',
      sql`${t.derivation} IN ('initial', 'rework', 'reassign')`,
    ),
  }),
);

export const reviewStepArtifact = sqliteTable(
  'review_step_artifact',
  {
    gateId: text('gate_id').notNull(),
    runId: text('run_id').notNull(),
    reviewerStepId: text('reviewer_step_id').notNull(),
    artifactVersionId: text('artifact_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
  },
  (t) => ({
    primaryKey: primaryKey({ columns: [t.runId, t.reviewerStepId, t.artifactVersionId] }),
    reviewerForeignKey: foreignKey({
      columns: [t.gateId, t.runId, t.reviewerStepId],
      foreignColumns: [
        acceptanceGateStep.gateId,
        acceptanceGateStep.runId,
        acceptanceGateStep.stepId,
      ],
    }).onDelete('restrict'),
  }),
);

export const reviewStepArtifactSelection = sqliteTable(
  'review_step_artifact_selection',
  {
    gateId: text('gate_id').notNull(),
    runId: text('run_id').notNull(),
    reviewerStepId: text('reviewer_step_id').notNull(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifact.id, { onDelete: 'restrict' }),
    selectedVersionId: text('selected_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    primaryKey: primaryKey({ columns: [t.runId, t.reviewerStepId, t.artifactId] }),
    reviewerForeignKey: foreignKey({
      columns: [t.gateId, t.runId, t.reviewerStepId],
      foreignColumns: [
        acceptanceGateStep.gateId,
        acceptanceGateStep.runId,
        acceptanceGateStep.stepId,
      ],
    }).onDelete('restrict'),
  }),
);

export const artifactSelection = sqliteTable(
  'artifact_selection',
  {
    id: idColumn('id'),
    operationId: text('operation_id').notNull(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifact.id, { onDelete: 'restrict' }),
    selectedVersionId: text('selected_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
    expectedTaskVersion: integer('expected_task_version').notNull(),
    resultingTaskVersion: integer('resulting_task_version').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    byOperation: uniqueIndex('artifact_selection_operation_uidx').on(t.operationId),
    byArtifact: index('artifact_selection_artifact_idx').on(t.artifactId, t.createdAt),
  }),
);

export const artifactMergeConflict = sqliteTable(
  'artifact_merge_conflict',
  {
    id: idColumn('id'),
    operationId: text('operation_id').notNull(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifact.id, { onDelete: 'restrict' }),
    runId: text('run_id')
      .notNull()
      .references(() => run.id, { onDelete: 'restrict' }),
    // Nullable only for honest migration of legacy 0011 conflicts whose source Step was not stored.
    // The 0012 insert trigger requires this for every new record.
    sourceStepId: text('source_step_id'),
    baseVersionId: text('base_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
    leftVersionId: text('left_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
    rightVersionId: text('right_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('open'),
    summaryJson: text('summary_json').notNull(),
    expectedTaskVersion: integer('expected_task_version').notNull(),
    resultingTaskVersion: integer('resulting_task_version').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    byOperation: uniqueIndex('artifact_merge_conflict_operation_uidx').on(t.operationId),
    byArtifact: index('artifact_merge_conflict_artifact_idx').on(t.artifactId, t.createdAt),
    sourceStepForeignKey: foreignKey({
      columns: [t.runId, t.sourceStepId],
      foreignColumns: [step.runId, step.id],
    }).onDelete('restrict'),
    statusCheck: check('artifact_merge_conflict_status_check', sql`${t.status} = 'open'`),
    summaryJsonCheck: check(
      'artifact_merge_conflict_summary_json_check',
      sql`json_valid(${t.summaryJson})`,
    ),
  }),
);

export const artifactMergeConflictResolution = sqliteTable(
  'artifact_merge_conflict_resolution',
  {
    id: idColumn('id'),
    operationId: text('operation_id').notNull(),
    conflictId: text('conflict_id')
      .notNull()
      .references(() => artifactMergeConflict.id, { onDelete: 'restrict' }),
    resolutionVersionId: text('resolution_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
    strategy: text('strategy').notNull(),
    expectedTaskVersion: integer('expected_task_version').notNull(),
    resultingTaskVersion: integer('resulting_task_version').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    byOperation: uniqueIndex('artifact_conflict_resolution_operation_uidx').on(t.operationId),
    byConflict: uniqueIndex('artifact_conflict_resolution_conflict_uidx').on(t.conflictId),
    byVersion: uniqueIndex('artifact_conflict_resolution_version_uidx').on(t.resolutionVersionId),
    strategyCheck: check(
      'artifact_conflict_resolution_strategy_check',
      sql`${t.strategy} IN ('left', 'right', 'manual')`,
    ),
    taskVersionCheck: check(
      'artifact_conflict_resolution_task_version_check',
      sql`${t.expectedTaskVersion} >= 0 AND ${t.resultingTaskVersion} = ${t.expectedTaskVersion} + 1`,
    ),
  }),
);

export type PlanRow = typeof plan.$inferSelect;
export type PlanRevisionRow = typeof planRevision.$inferSelect;
export type RunRow = typeof run.$inferSelect;
export type StepRow = typeof step.$inferSelect;
export type StepDependencyRow = typeof stepDependency.$inferSelect;
export type ArtifactRow = typeof artifact.$inferSelect;
export type ArtifactVersionRow = typeof artifactVersion.$inferSelect;
export type StepOutputArtifactRow = typeof stepOutputArtifact.$inferSelect;
export type AcceptanceGateRow = typeof acceptanceGate.$inferSelect;
export type AcceptanceCriterionRow = typeof acceptanceCriterion.$inferSelect;
export type ReviewEvidenceRow = typeof reviewEvidence.$inferSelect;
export type ReviewEvidenceCriterionRow = typeof reviewEvidenceCriterion.$inferSelect;
export type ReviewEvidenceArtifactRow = typeof reviewEvidenceArtifact.$inferSelect;
export type AcceptanceGateStepRow = typeof acceptanceGateStep.$inferSelect;
export type ReviewStepArtifactRow = typeof reviewStepArtifact.$inferSelect;
export type ReviewStepArtifactSelectionRow = typeof reviewStepArtifactSelection.$inferSelect;
export type ArtifactSelectionRow = typeof artifactSelection.$inferSelect;
export type ArtifactMergeConflictRow = typeof artifactMergeConflict.$inferSelect;
export type ArtifactMergeConflictResolutionRow =
  typeof artifactMergeConflictResolution.$inferSelect;
