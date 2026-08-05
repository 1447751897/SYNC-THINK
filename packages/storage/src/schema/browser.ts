import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const browserProfile = sqliteTable(
  'browser_profile',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    revision: integer('revision').notNull().default(1),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastUsedAt: text('last_used_at'),
    deletedAt: text('deleted_at'),
  },
  (t) => ({
    active: index('browser_profile_active_idx').on(t.deletedAt, t.isDefault, t.createdAt),
    singleDefault: uniqueIndex('browser_profile_single_default_uidx')
      .on(t.isDefault)
      .where(sql`${t.isDefault} = 1`),
    revisionCheck: check('browser_profile_revision_check', sql`${t.revision} >= 1`),
    defaultCheck: check('browser_profile_default_check', sql`${t.isDefault} IN (0, 1)`),
  }),
);

export const browserSiteSession = sqliteTable(
  'browser_site_session',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => browserProfile.id, { onDelete: 'restrict' }),
    siteKey: text('site_key').notNull(),
    originsJson: text('origins_json').notNull(),
    state: text('state').notNull(),
    cookieCount: integer('cookie_count').notNull(),
    storageBytes: integer('storage_bytes').notNull(),
    storageTypesJson: text('storage_types_json').notNull(),
    lastSeenAt: text('last_seen_at'),
    lastVerifiedAt: text('last_verified_at'),
    lastCheckedAt: text('last_checked_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    primaryKey: primaryKey({ columns: [t.profileId, t.siteKey] }),
    byProfile: index('browser_site_session_profile_idx').on(t.profileId, t.updatedAt),
    originsJsonCheck: check(
      'browser_site_session_origins_json_check',
      sql`json_valid(${t.originsJson})`,
    ),
    storageTypesJsonCheck: check(
      'browser_site_session_storage_types_json_check',
      sql`json_valid(${t.storageTypesJson})`,
    ),
    stateCheck: check(
      'browser_site_session_state_check',
      sql`${t.state} IN ('data_present', 'verified', 'reauth_required')`,
    ),
    cookieCountCheck: check('browser_site_session_cookie_count_check', sql`${t.cookieCount} >= 0`),
    storageBytesCheck: check(
      'browser_site_session_storage_bytes_check',
      sql`${t.storageBytes} >= 0`,
    ),
  }),
);

export const browserRecording = sqliteTable(
  'browser_recording',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => browserProfile.id, { onDelete: 'restrict' }),
    ownerId: text('owner_id').notNull(),
    leaseId: text('lease_id'),
    pageId: text('page_id'),
    status: text('status').notNull(),
    revision: integer('revision').notNull().default(1),
    startUrl: text('start_url'),
    currentUrl: text('current_url'),
    stepCount: integer('step_count').notNull().default(0),
    stopReason: text('stop_reason'),
    errorCode: text('error_code'),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    stoppedAt: text('stopped_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    byProfileState: index('browser_recording_profile_state_idx').on(
      t.profileId,
      t.status,
      t.updatedAt,
    ),
    oneActiveProfile: uniqueIndex('browser_recording_one_active_profile_uidx')
      .on(t.profileId)
      .where(sql`${t.status} IN ('starting', 'recording', 'stopping')`),
    statusCheck: check(
      'browser_recording_status_check',
      sql`${t.status} IN ('starting', 'recording', 'stopping', 'stopped', 'failed', 'interrupted')`,
    ),
    revisionCheck: check('browser_recording_revision_check', sql`${t.revision} >= 1`),
    stepCountCheck: check(
      'browser_recording_step_count_check',
      sql`${t.stepCount} BETWEEN 0 AND 200`,
    ),
    leasePairCheck: check(
      'browser_recording_lease_pair_check',
      sql`(${t.leaseId} IS NULL AND ${t.pageId} IS NULL) OR (${t.leaseId} IS NOT NULL AND ${t.pageId} IS NOT NULL)`,
    ),
    stopReasonCheck: check(
      'browser_recording_stop_reason_check',
      sql`${t.stopReason} IS NULL OR ${t.stopReason} IN ('user', 'step_limit', 'page_closed', 'browser_closed', 'runtime_restarted', 'start_failed', 'capture_failed')`,
    ),
  }),
);

export const browserRecordingStep = sqliteTable(
  'browser_recording_step',
  {
    recordingId: text('recording_id')
      .notNull()
      .references(() => browserRecording.id, { onDelete: 'restrict' }),
    sequence: integer('sequence').notNull(),
    kind: text('kind').notNull(),
    payloadJson: text('payload_json').notNull(),
    recordedAt: text('recorded_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    primaryKey: primaryKey({ columns: [t.recordingId, t.sequence] }),
    sequenceCheck: check(
      'browser_recording_step_sequence_check',
      sql`${t.sequence} BETWEEN 1 AND 200`,
    ),
    kindCheck: check(
      'browser_recording_step_kind_check',
      sql`${t.kind} IN ('navigate', 'click', 'fill', 'select', 'check', 'press')`,
    ),
    payloadJsonCheck: check(
      'browser_recording_step_payload_json_check',
      sql`json_valid(${t.payloadJson})`,
    ),
    payloadSizeCheck: check(
      'browser_recording_step_payload_size_check',
      sql`length(CAST(${t.payloadJson} AS BLOB)) <= 16384`,
    ),
  }),
);

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
    byProfileState: index('browser_command_profile_state_idx').on(
      t.profileId,
      t.state,
      t.updatedAt,
    ),
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
    lookup: index('browser_origin_grant_lookup_idx').on(t.origin, t.scopeType, t.scopeId, t.action),
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
