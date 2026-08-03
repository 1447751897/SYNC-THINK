import { sql } from 'drizzle-orm';
import { check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const desktopCommand = sqliteTable(
  'desktop_command',
  {
    id: text('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    workspaceId: text('workspace_id').notNull(),
    runId: text('run_id').notNull(),
    ownerId: text('owner_id').notNull(),
    toolName: text('tool_name').notNull(),
    action: text('action').notNull(),
    targetIdentity: text('target_identity').notNull(),
    requestDigest: text('request_digest').notNull(),
    sanitizedArgsJson: text('sanitized_args_json').notNull(),
    state: text('state').notNull(),
    resultJson: text('result_json'),
    errorCode: text('error_code'),
    failureClass: text('failure_class'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    approvedAt: text('approved_at'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
  },
  (t) => ({
    idempotency: uniqueIndex('desktop_command_idempotency_uidx').on(t.idempotencyKey),
    byOwner: index('desktop_command_owner_idx').on(t.workspaceId, t.ownerId, t.updatedAt),
    byState: index('desktop_command_state_idx').on(t.state, t.updatedAt),
    stateCheck: check(
      'desktop_command_state_check',
      sql`${t.state} IN ('requested', 'approved', 'running', 'completed', 'failed', 'waiting_user')`,
    ),
  }),
);
