import { sql } from 'drizzle-orm';
import { check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const browserCommand = sqliteTable(
  'browser_command',
  {
    id: text('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    workspaceId: text('workspace_id').notNull(),
    runId: text('run_id').notNull(),
    ownerId: text('owner_id').notNull(),
    profileId: text('profile_id').notNull(),
    leaseId: text('lease_id'),
    pageId: text('page_id'),
    toolName: text('tool_name').notNull(),
    action: text('action').notNull(),
    targetOrigin: text('target_origin').notNull(),
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
    idempotency: uniqueIndex('browser_command_idempotency_uidx').on(t.idempotencyKey),
    byOwner: index('browser_command_owner_idx').on(
      t.workspaceId,
      t.ownerId,
      t.profileId,
      t.updatedAt,
    ),
    byState: index('browser_command_state_idx').on(t.state, t.updatedAt),
    stateCheck: check(
      'browser_command_state_check',
      sql`${t.state} IN ('requested', 'approved', 'running', 'completed', 'failed', 'waiting_user')`,
    ),
  }),
);

export const browserOriginGrant = sqliteTable(
  'browser_origin_grant',
  {
    id: text('id').primaryKey(),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    origin: text('origin').notNull(),
    action: text('action').notNull(),
    decision: text('decision').notNull(),
    approvalId: text('approval_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    expiresAt: text('expires_at'),
    revokedAt: text('revoked_at'),
  },
  (t) => ({
    scopeOriginAction: uniqueIndex('browser_origin_grant_scope_uidx').on(
      t.scopeType,
      t.scopeId,
      t.origin,
      t.action,
    ),
    lookup: index('browser_origin_grant_lookup_idx').on(
      t.origin,
      t.scopeType,
      t.scopeId,
      t.action,
    ),
    scopeCheck: check(
      'browser_origin_grant_scope_check',
      sql`${t.scopeType} IN ('user', 'workspace', 'agent-version', 'workflow', 'run')`,
    ),
    decisionCheck: check(
      'browser_origin_grant_decision_check',
      sql`${t.decision} IN ('allow', 'deny')`,
    ),
  }),
);
