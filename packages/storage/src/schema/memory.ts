import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { idColumn } from './ids.js';

// MemoryChange — proposed structured update to durable memory (§10.4).
// Raw chat never becomes durable fact without a versioned change + policy.
export const memoryChange = sqliteTable(
  'memory_change',
  {
    id: idColumn('id'),
    workspaceId: text('workspace_id').notNull(),
    taskId: text('task_id').notNull(),
    targetScope: text('target_scope').notNull().default('task'),
    additionsJson: text('additions_json').notNull().default('[]'),
    modificationsJson: text('modifications_json').notNull().default('[]'),
    deprecationsJson: text('deprecations_json').notNull().default('[]'),
    evidenceRefsJson: text('evidence_refs_json').notNull().default('[]'),
    confidence: real('confidence').notNull().default(0.5),
    unresolvedAmbiguity: text('unresolved_ambiguity'),
    approvalState: text('approval_state').notNull().default('pending'),
    proposedByRunId: text('proposed_by_run_id'),
    createdAt: text('created_at').notNull(),
    decidedAt: text('decided_at'),
  },
  (t) => ({
    byWorkspace: index('memory_change_ws_idx').on(t.workspaceId),
    byTask: index('memory_change_task_idx').on(t.taskId),
    byState: index('memory_change_state_idx').on(t.approvalState),
  }),
);
export type MemoryChangeRow = typeof memoryChange.$inferSelect;

// Approved durable entries (derived from approved MemoryChanges).
export const memoryEntry = sqliteTable(
  'memory_entry',
  {
    id: idColumn('id'),
    workspaceId: text('workspace_id').notNull(),
    taskId: text('task_id'),
    scope: text('scope').notNull(),
    entryKey: text('entry_key').notNull(),
    entryValue: text('entry_value').notNull(),
    sourceChangeId: text('source_change_id'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    byWorkspace: index('memory_entry_ws_idx').on(t.workspaceId),
    byTask: index('memory_entry_task_idx').on(t.taskId),
    byKey: index('memory_entry_key_idx').on(t.workspaceId, t.entryKey),
  }),
);
export type MemoryEntryRow = typeof memoryEntry.$inferSelect;

// Scrubbed diagnostic evidence — never stores plaintext secrets (§7.3 / §19).
export const diagnosticRecord = sqliteTable(
  'diagnostic_record',
  {
    id: idColumn('id'),
    workspaceId: text('workspace_id').notNull(),
    taskId: text('task_id'),
    runId: text('run_id'),
    category: text('category').notNull(),
    failureClass: text('failure_class'),
    summary: text('summary').notNull(),
    detailJson: text('detail_json').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    byWorkspace: index('diagnostic_ws_idx').on(t.workspaceId),
    byRun: index('diagnostic_run_idx').on(t.runId),
    byCreated: index('diagnostic_created_idx').on(t.createdAt),
  }),
);
export type DiagnosticRecordRow = typeof diagnosticRecord.$inferSelect;
