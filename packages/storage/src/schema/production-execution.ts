import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { step } from './orchestration.js';
import { agentVersion } from './provider.js';

export const providerExecutionReservation = sqliteTable(
  'provider_execution_reservation',
  {
    idempotencyKey: text('idempotency_key').primaryKey(),
    runId: text('run_id').notNull(),
    stepId: text('step_id').notNull(),
    agentVersionId: text('agent_version_id')
      .notNull()
      .references(() => agentVersion.id, { onDelete: 'restrict' }),
    executionOwnerId: text('execution_owner_id').notNull(),
    executionAttempt: integer('execution_attempt').notNull(),
    state: text('state').notNull(),
    resultJson: text('result_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
  },
  (t) => ({
    stepForeignKey: foreignKey({
      columns: [t.runId, t.stepId],
      foreignColumns: [step.runId, step.id],
    }).onDelete('restrict'),
    byStep: index('provider_execution_reservation_step_idx').on(t.runId, t.stepId),
    stateCheck: check(
      'provider_execution_reservation_state_check',
      sql`${t.state} IN ('started', 'released', 'completed')`,
    ),
    resultCheck: check(
      'provider_execution_reservation_result_check',
      sql`(${t.state} IN ('started', 'released') AND ${t.resultJson} IS NULL AND ${t.completedAt} IS NULL)
        OR (${t.state} = 'completed' AND ${t.resultJson} IS NOT NULL AND ${t.completedAt} IS NOT NULL)`,
    ),
  }),
);

export const providerExecutionCheckpoint = sqliteTable('provider_execution_checkpoint', {
  idempotencyKey: text('idempotency_key')
    .primaryKey()
    .references(() => providerExecutionReservation.idempotencyKey, { onDelete: 'restrict' }),
  checkpointJson: text('checkpoint_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const mcpActionExecutionIntent = sqliteTable(
  'mcp_action_execution_intent',
  {
    runId: text('run_id').notNull(),
    stepId: text('step_id').notNull(),
    agentVersionId: text('agent_version_id')
      .notNull()
      .references(() => agentVersion.id, { onDelete: 'restrict' }),
    executionOwnerId: text('execution_owner_id').notNull(),
    executionAttempt: integer('execution_attempt').notNull(),
    actionDigest: text('action_digest').notNull(),
    state: text('state').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
  },
  (t) => ({
    primaryKey: primaryKey({ columns: [t.runId, t.stepId, t.actionDigest] }),
    stepForeignKey: foreignKey({
      columns: [t.runId, t.stepId],
      foreignColumns: [step.runId, step.id],
    }).onDelete('restrict'),
    byState: index('mcp_action_execution_intent_state_idx').on(t.state, t.updatedAt),
    stateCheck: check(
      'mcp_action_execution_intent_state_check',
      sql`${t.state} IN ('intent', 'started', 'completed')`,
    ),
  }),
);
