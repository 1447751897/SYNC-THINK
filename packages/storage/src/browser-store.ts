import { createHash, randomUUID } from 'node:crypto';
import {
  BROWSER_RECORDING_MAX_LOCATOR_CHARS,
  BROWSER_RECORDING_MAX_STEP_BYTES,
  BROWSER_RECORDING_MAX_STEPS,
  BROWSER_RECORDING_MAX_TEXT_CHARS,
  BROWSER_RECORDING_MAX_URL_CHARS,
  type BrowserRecordingLocator,
  type BrowserRecordingStatus,
  type BrowserRecordingStepInput,
  type BrowserRecordingStepRecord,
  type BrowserRecordingStopReason,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

const MAX_JSON_BYTES = 256 * 1024;
const ID_RE = /^\S{1,256}$/;
const ORIGIN_ACTION_ALL = '*';

export type BrowserCommandStatus =
  'requested' | 'approved' | 'running' | 'completed' | 'failed' | 'waiting_user';
export type BrowserGrantScopeType = 'user' | 'workspace' | 'agent-version' | 'workflow' | 'run';
export type BrowserGrantDecision = 'allow' | 'deny';

export interface BrowserCommandResult {
  output: unknown;
}

export interface BrowserCommandRecord {
  id: string;
  idempotencyKey: string;
  workspaceId: string;
  runId: string;
  ownerId: string;
  profileId: string;
  leaseId?: string;
  pageId?: string;
  toolName: string;
  action: string;
  targetOrigin: string;
  requestDigest: string;
  sanitizedArgs: Record<string, unknown>;
  state: BrowserCommandStatus;
  result?: BrowserCommandResult;
  errorCode?: string;
  failureClass?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface BrowserOriginGrantRecord {
  id: string;
  scopeType: BrowserGrantScopeType;
  scopeId: string;
  origin: string;
  action: string;
  decision: BrowserGrantDecision;
  approvalId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface BrowserGrantScope {
  scopeType: BrowserGrantScopeType;
  scopeId: string;
}

export interface BrowserProfileRecord {
  id: string;
  name: string;
  revision: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  deletedAt?: string;
  siteCount: number;
}

export type BrowserSiteSessionState = 'data_present' | 'verified' | 'reauth_required';

export interface BrowserSiteSessionRecord {
  profileId: string;
  siteKey: string;
  origins: string[];
  state: BrowserSiteSessionState;
  cookieCount: number;
  storageBytes: number;
  storageTypes: string[];
  lastSeenAt?: string;
  lastVerifiedAt?: string;
  lastCheckedAt: string;
  updatedAt: string;
}

export interface BrowserRecordingRecord {
  id: string;
  profileId: string;
  ownerId: string;
  leaseId?: string;
  pageId?: string;
  status: BrowserRecordingStatus;
  revision: number;
  startUrl?: string;
  currentUrl?: string;
  stepCount: number;
  stopReason?: BrowserRecordingStopReason;
  errorCode?: string;
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
  updatedAt: string;
}

interface BrowserCommandRow {
  id: string;
  idempotency_key: string;
  workspace_id: string;
  run_id: string;
  owner_id: string;
  profile_id: string;
  lease_id: string | null;
  page_id: string | null;
  tool_name: string;
  action: string;
  target_origin: string;
  request_digest: string;
  sanitized_args_json: string;
  state: string;
  result_json: string | null;
  error_code: string | null;
  failure_class: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface BrowserGrantRow {
  id: string;
  scope_type: string;
  scope_id: string;
  origin: string;
  action: string;
  decision: string;
  approval_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

interface BrowserProfileRow {
  id: string;
  name: string;
  revision: number;
  is_default: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  deleted_at: string | null;
  site_count: number;
}

interface BrowserSiteSessionRow {
  profile_id: string;
  site_key: string;
  origins_json: string;
  state: string;
  cookie_count: number;
  storage_bytes: number;
  storage_types_json: string;
  last_seen_at: string | null;
  last_verified_at: string | null;
  last_checked_at: string;
  updated_at: string;
}

interface BrowserRecordingRow {
  id: string;
  profile_id: string;
  owner_id: string;
  lease_id: string | null;
  page_id: string | null;
  status: string;
  revision: number;
  start_url: string | null;
  current_url: string | null;
  step_count: number;
  stop_reason: string | null;
  error_code: string | null;
  created_at: string;
  started_at: string | null;
  stopped_at: string | null;
  updated_at: string;
}

interface BrowserRecordingStepRow {
  recording_id: string;
  sequence: number;
  kind: string;
  payload_json: string;
  recorded_at: string;
  updated_at: string;
}

export class SqliteBrowserStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  listProfiles(): BrowserProfileRecord[] {
    const rows = this.raw
      .prepare(
        `${profileSelect()}
         WHERE p.deleted_at IS NULL
         ORDER BY p.is_default DESC, p.created_at ASC, p.id ASC`,
      )
      .all() as BrowserProfileRow[];
    return rows.map(mapProfile);
  }

  listDeletedProfiles(): BrowserProfileRecord[] {
    const rows = this.raw
      .prepare(
        `${profileSelect()}
         WHERE p.deleted_at IS NOT NULL AND p.is_default = 0
         ORDER BY p.deleted_at ASC, p.id ASC`,
      )
      .all() as BrowserProfileRow[];
    return rows.map(mapProfile);
  }

  getProfile(id: string): BrowserProfileRecord | undefined {
    const profileId = normalizeId(id, 'browser.profile_id_invalid');
    const row = this.raw
      .prepare(`${profileSelect()} WHERE p.id = ? AND p.deleted_at IS NULL`)
      .get(profileId) as BrowserProfileRow | undefined;
    return row ? mapProfile(row) : undefined;
  }

  createProfile(input: { id: string; name: string; now?: string }): BrowserProfileRecord {
    const id = normalizeId(input.id, 'browser.profile_id_invalid');
    const name = normalizeProfileName(input.name);
    const now = normalizeNow(input.now);
    try {
      this.raw
        .prepare(
          `INSERT INTO browser_profile (
             id, name, revision, is_default, created_at, updated_at, last_used_at, deleted_at
           ) VALUES (?, ?, 1, 0, ?, ?, NULL, NULL)`,
        )
        .run(id, name, now, now);
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error('browser.profile_id_conflict');
      throw error;
    }
    return this.getRequiredProfile(id);
  }

  renameProfile(input: {
    id: string;
    name: string;
    expectedRevision: number;
    now?: string;
  }): BrowserProfileRecord {
    const id = normalizeId(input.id, 'browser.profile_id_invalid');
    const name = normalizeProfileName(input.name);
    const revision = normalizeRevision(input.expectedRevision);
    const now = normalizeNow(input.now);
    const result = this.raw
      .prepare(
        `UPDATE browser_profile
         SET name = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL AND revision = ?`,
      )
      .run(name, now, id, revision);
    if (result.changes !== 1) this.throwProfileMutationError(id, revision);
    return this.getRequiredProfile(id);
  }

  softDeleteProfile(input: {
    id: string;
    expectedRevision: number;
    now?: string;
  }): BrowserProfileRecord {
    const id = normalizeId(input.id, 'browser.profile_id_invalid');
    if (id === 'default') throw new Error('browser.default_profile_immutable');
    const revision = normalizeRevision(input.expectedRevision);
    const now = normalizeNow(input.now);
    return this.raw
      .transaction(() => {
        if (this.hasActiveProfileRecording(id) || this.hasActiveProfileCommands(id)) {
          throw new Error('browser.profile_in_use');
        }
        const result = this.raw
          .prepare(
            `UPDATE browser_profile
           SET revision = revision + 1, updated_at = ?, deleted_at = ?
           WHERE id = ? AND deleted_at IS NULL AND revision = ?`,
          )
          .run(now, now, id, revision);
        if (result.changes !== 1) this.throwProfileMutationError(id, revision);
        this.raw.prepare('DELETE FROM browser_site_session WHERE profile_id = ?').run(id);
        return this.getRequiredProfile(id, true);
      })
      .immediate();
  }

  listSiteSessions(profileId: string): BrowserSiteSessionRecord[] {
    const id = normalizeId(profileId, 'browser.profile_id_invalid');
    this.getRequiredProfile(id);
    const rows = this.raw
      .prepare(`${siteSessionSelect()} WHERE profile_id = ? ORDER BY site_key ASC`)
      .all(id) as BrowserSiteSessionRow[];
    return rows.map(mapSiteSession);
  }

  replaceSiteSessions(input: {
    profileId: string;
    checkedAt: string;
    sessions: ReadonlyArray<{
      siteKey: string;
      origins: readonly string[];
      state: BrowserSiteSessionState;
      cookieCount: number;
      storageBytes: number;
      storageTypes: readonly string[];
      lastSeenAt?: string;
      lastVerifiedAt?: string;
    }>;
  }): BrowserSiteSessionRecord[] {
    const profileId = normalizeId(input.profileId, 'browser.profile_id_invalid');
    this.getRequiredProfile(profileId);
    const checkedAt = normalizeNow(input.checkedAt);
    const sessions = input.sessions.map((session) => normalizeSiteSession(session, checkedAt));
    const seen = new Set<string>();
    for (const session of sessions) {
      if (seen.has(session.siteKey)) throw new Error('browser.site_session_duplicate');
      seen.add(session.siteKey);
    }
    this.raw
      .transaction(() => {
        this.raw.prepare('DELETE FROM browser_site_session WHERE profile_id = ?').run(profileId);
        const insert = this.raw.prepare(
          `INSERT INTO browser_site_session (
           profile_id, site_key, origins_json, state, cookie_count, storage_bytes,
           storage_types_json, last_seen_at, last_verified_at, last_checked_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const session of sessions) {
          insert.run(
            profileId,
            session.siteKey,
            JSON.stringify(session.origins),
            session.state,
            session.cookieCount,
            session.storageBytes,
            JSON.stringify(session.storageTypes),
            session.lastSeenAt ?? null,
            session.lastVerifiedAt ?? null,
            checkedAt,
            checkedAt,
          );
        }
        this.raw
          .prepare('UPDATE browser_profile SET last_used_at = ?, updated_at = ? WHERE id = ?')
          .run(checkedAt, checkedAt, profileId);
      })
      .immediate();
    return this.listSiteSessions(profileId);
  }

  markSiteSessionVerified(input: {
    profileId: string;
    siteKey: string;
    origin: string;
    verifiedAt?: string;
  }): BrowserSiteSessionRecord {
    const profileId = normalizeId(input.profileId, 'browser.profile_id_invalid');
    this.getRequiredProfile(profileId);
    const siteKey = normalizeSiteKey(input.siteKey);
    const origin = normalizeOrigin(input.origin);
    const verifiedAt = normalizeNow(input.verifiedAt);
    const existing = this.raw
      .prepare(`${siteSessionSelect()} WHERE profile_id = ? AND site_key = ?`)
      .get(profileId, siteKey) as BrowserSiteSessionRow | undefined;
    const origins = existing
      ? [...new Set([...parseStringArray(existing.origins_json), origin])].sort()
      : [origin];
    this.raw
      .prepare(
        `INSERT INTO browser_site_session (
           profile_id, site_key, origins_json, state, cookie_count, storage_bytes,
           storage_types_json, last_seen_at, last_verified_at, last_checked_at, updated_at
         ) VALUES (?, ?, ?, 'verified', 0, 0, '[]', ?, ?, ?, ?)
         ON CONFLICT(profile_id, site_key) DO UPDATE SET
           origins_json = excluded.origins_json,
           state = 'verified',
           last_seen_at = excluded.last_seen_at,
           last_verified_at = excluded.last_verified_at,
           last_checked_at = excluded.last_checked_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        profileId,
        siteKey,
        JSON.stringify(origins),
        verifiedAt,
        verifiedAt,
        verifiedAt,
        verifiedAt,
      );
    return this.getRequiredSiteSession(profileId, siteKey);
  }

  removeSiteSession(profileId: string, siteKey: string): void {
    const id = normalizeId(profileId, 'browser.profile_id_invalid');
    const key = normalizeSiteKey(siteKey);
    this.raw
      .prepare('DELETE FROM browser_site_session WHERE profile_id = ? AND site_key = ?')
      .run(id, key);
  }

  listKnownOrigins(profileId: string): Array<{ origin: string; lastSeenAt: string }> {
    const id = normalizeId(profileId, 'browser.profile_id_invalid');
    this.getRequiredProfile(id);
    const rows = this.raw
      .prepare(
        `SELECT origin, MAX(last_seen_at) AS last_seen_at FROM (
           SELECT target_origin AS origin, updated_at AS last_seen_at
           FROM browser_command WHERE profile_id = ?
           UNION ALL
           SELECT je.value AS origin, COALESCE(s.last_seen_at, s.updated_at) AS last_seen_at
           FROM browser_site_session s, json_each(s.origins_json) je
           WHERE s.profile_id = ?
         ) GROUP BY origin ORDER BY origin ASC`,
      )
      .all(id, id) as Array<{ origin: string; last_seen_at: string }>;
    return rows.map((row) => ({
      origin: normalizeOrigin(row.origin),
      lastSeenAt: row.last_seen_at,
    }));
  }

  hasActiveProfileCommands(profileId: string): boolean {
    const id = normalizeId(profileId, 'browser.profile_id_invalid');
    const row = this.raw
      .prepare(
        `SELECT 1 AS present FROM browser_command
         WHERE profile_id = ? AND state IN ('requested', 'approved', 'running', 'waiting_user')
         LIMIT 1`,
      )
      .get(id) as { present: number } | undefined;
    return row?.present === 1;
  }

  hasActiveProfileRecording(profileId: string): boolean {
    const id = normalizeId(profileId, 'browser.profile_id_invalid');
    const row = this.raw
      .prepare(
        `SELECT 1 AS present FROM browser_recording
         WHERE profile_id = ? AND status IN ('starting', 'recording', 'stopping')
         LIMIT 1`,
      )
      .get(id) as { present: number } | undefined;
    return row?.present === 1;
  }

  createRecording(input: {
    id?: string;
    profileId: string;
    ownerId: string;
    expectedProfileRevision: number;
    startUrl?: string;
    now?: string;
  }): BrowserRecordingRecord {
    const id = normalizeId(input.id ?? randomUUID(), 'browser.recording_id_invalid');
    const profileId = normalizeId(input.profileId, 'browser.profile_id_invalid');
    const ownerId = normalizeId(input.ownerId, 'browser.recording_owner_id_invalid');
    const expectedRevision = normalizeRevision(input.expectedProfileRevision);
    const startUrl = input.startUrl ? normalizeRecordingUrl(input.startUrl) : undefined;
    const now = normalizeNow(input.now);
    try {
      return this.raw
        .transaction(() => {
          const profile = this.raw
            .prepare(
              `SELECT revision FROM browser_profile
               WHERE id = ? AND deleted_at IS NULL`,
            )
            .get(profileId) as { revision: number } | undefined;
          if (!profile) throw new Error('browser.profile_not_found');
          if (profile.revision !== expectedRevision) {
            throw new Error('browser.profile_revision_conflict');
          }
          if (this.hasActiveProfileCommands(profileId)) {
            throw new Error('browser.profile_in_use');
          }
          this.raw
            .prepare(
              `INSERT INTO browser_recording (
                 id, profile_id, owner_id, lease_id, page_id, status, revision,
                 start_url, current_url, step_count, stop_reason, error_code,
                 created_at, started_at, stopped_at, updated_at
               ) VALUES (?, ?, ?, NULL, NULL, 'starting', 1, ?, NULL, 0, NULL, NULL,
                 ?, NULL, NULL, ?)`,
            )
            .run(id, profileId, ownerId, startUrl ?? null, now, now);
          return this.getRequiredRecording(id);
        })
        .immediate();
    } catch (error) {
      const message = String(error);
      if (message.includes('browser_recording.profile_id')) {
        throw new Error('browser.recording_profile_in_use');
      }
      if (message.includes('browser_recording.id')) {
        throw new Error('browser.recording_id_conflict');
      }
      throw error;
    }
  }

  markRecordingStarted(input: {
    id: string;
    leaseId: string;
    pageId: string;
    currentUrl?: string;
    now?: string;
  }): BrowserRecordingRecord {
    const id = normalizeId(input.id, 'browser.recording_id_invalid');
    const leaseId = normalizeId(input.leaseId, 'browser.recording_lease_id_invalid');
    const pageId = normalizeId(input.pageId, 'browser.recording_page_id_invalid');
    const currentUrl = input.currentUrl ? normalizeRecordingUrl(input.currentUrl) : undefined;
    const now = normalizeNow(input.now);
    return this.raw
      .transaction(() => {
        const existing = this.getRequiredRecording(id);
        if (existing.status === 'recording') {
          if (existing.leaseId !== leaseId || existing.pageId !== pageId) {
            throw new Error('browser.recording_lease_mismatch');
          }
          return existing;
        }
        if (existing.status !== 'starting') throw new Error('browser.recording_state_conflict');
        const updated = this.raw
          .prepare(
            `UPDATE browser_recording
             SET lease_id = ?, page_id = ?, status = 'recording', revision = revision + 1,
                 current_url = COALESCE(?, current_url), started_at = ?, updated_at = ?
             WHERE id = ? AND status = 'starting'`,
          )
          .run(leaseId, pageId, currentUrl ?? null, now, now, id);
        if (updated.changes !== 1) throw new Error('browser.recording_state_conflict');
        return this.getRequiredRecording(id);
      })
      .immediate();
  }

  getRecording(id: string): BrowserRecordingRecord | undefined {
    const recordingId = normalizeId(id, 'browser.recording_id_invalid');
    const row = this.raw.prepare(`${recordingSelect()} WHERE id = ?`).get(recordingId) as
      BrowserRecordingRow | undefined;
    return row ? mapRecording(row) : undefined;
  }

  listRecordings(profileId: string, options: { limit?: number } = {}): BrowserRecordingRecord[] {
    const id = normalizeId(profileId, 'browser.profile_id_invalid');
    this.getRequiredProfile(id);
    const limit = normalizePageLimit(options.limit, 20);
    const rows = this.raw
      .prepare(
        `${recordingSelect()} WHERE profile_id = ?
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(id, limit) as BrowserRecordingRow[];
    return rows.map(mapRecording);
  }

  listActiveRecordings(): BrowserRecordingRecord[] {
    const rows = this.raw
      .prepare(
        `${recordingSelect()}
         WHERE status IN ('starting', 'recording', 'stopping')
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as BrowserRecordingRow[];
    return rows.map(mapRecording);
  }

  appendRecordingStep(input: {
    recordingId: string;
    step: BrowserRecordingStepInput;
    recordedAt?: string;
  }): BrowserRecordingStepRecord {
    const recordingId = normalizeId(input.recordingId, 'browser.recording_id_invalid');
    const step = normalizeRecordingStep(input.step);
    const payloadJson = boundedRecordingStepJson(step);
    const recordedAt = normalizeNow(input.recordedAt);
    return this.raw
      .transaction(() => {
        const recording = this.getRequiredRecording(recordingId);
        if (recording.status !== 'recording' && recording.status !== 'stopping') {
          throw new Error('browser.recording_not_active');
        }
        if (recording.stepCount >= BROWSER_RECORDING_MAX_STEPS) {
          throw new Error('browser.recording_step_limit_reached');
        }
        const sequence = recording.stepCount + 1;
        this.raw
          .prepare(
            `INSERT INTO browser_recording_step (
               recording_id, sequence, kind, payload_json, recorded_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(recordingId, sequence, step.kind, payloadJson, recordedAt, recordedAt);
        const currentUrl = recordingStepResultUrl(step);
        const updated = this.raw
          .prepare(
            `UPDATE browser_recording
             SET step_count = ?, revision = revision + 1,
                 current_url = COALESCE(?, current_url), updated_at = ?
             WHERE id = ? AND status IN ('recording', 'stopping') AND step_count = ?`,
          )
          .run(sequence, currentUrl ?? null, recordedAt, recordingId, recording.stepCount);
        if (updated.changes !== 1) throw new Error('browser.recording_step_conflict');
        return this.getRequiredRecordingStep(recordingId, sequence);
      })
      .immediate();
  }

  replaceLastRecordingStep(input: {
    recordingId: string;
    step: BrowserRecordingStepInput;
    recordedAt?: string;
  }): BrowserRecordingStepRecord {
    const recordingId = normalizeId(input.recordingId, 'browser.recording_id_invalid');
    const step = normalizeRecordingStep(input.step);
    const payloadJson = boundedRecordingStepJson(step);
    const recordedAt = normalizeNow(input.recordedAt);
    return this.raw
      .transaction(() => {
        const recording = this.getRequiredRecording(recordingId);
        if (recording.status !== 'recording' && recording.status !== 'stopping') {
          throw new Error('browser.recording_not_active');
        }
        if (recording.stepCount < 1) throw new Error('browser.recording_step_not_found');
        const existing = this.getRequiredRecordingStep(recordingId, recording.stepCount);
        if (!canReplaceRecordingStep(existing.step, step)) {
          throw new Error('browser.recording_step_replace_mismatch');
        }
        this.raw
          .prepare(
            `UPDATE browser_recording_step
             SET kind = ?, payload_json = ?, recorded_at = ?, updated_at = ?
             WHERE recording_id = ? AND sequence = ?`,
          )
          .run(step.kind, payloadJson, recordedAt, recordedAt, recordingId, recording.stepCount);
        const currentUrl = recordingStepResultUrl(step);
        this.raw
          .prepare(
            `UPDATE browser_recording
             SET revision = revision + 1, current_url = COALESCE(?, current_url), updated_at = ?
             WHERE id = ? AND status IN ('recording', 'stopping')`,
          )
          .run(currentUrl ?? null, recordedAt, recordingId);
        return this.getRequiredRecordingStep(recordingId, recording.stepCount);
      })
      .immediate();
  }

  listRecordingSteps(
    recordingId: string,
    options: { afterSequence?: number; limit?: number } = {},
  ): BrowserRecordingStepRecord[] {
    const id = normalizeId(recordingId, 'browser.recording_id_invalid');
    this.getRequiredRecording(id);
    const afterSequence = normalizeAfterSequence(options.afterSequence);
    const limit = normalizePageLimit(options.limit, BROWSER_RECORDING_MAX_STEPS);
    const rows = this.raw
      .prepare(
        `${recordingStepSelect()}
         WHERE recording_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?`,
      )
      .all(id, afterSequence, limit) as BrowserRecordingStepRow[];
    return rows.map(mapRecordingStep);
  }

  beginRecordingStop(
    id: string,
    input: { stopReason: BrowserRecordingStopReason; now?: string },
  ): BrowserRecordingRecord {
    const recordingId = normalizeId(id, 'browser.recording_id_invalid');
    const stopReason = normalizeRecordingStopReason(input.stopReason);
    const now = normalizeNow(input.now);
    return this.raw
      .transaction(() => {
        const existing = this.getRequiredRecording(recordingId);
        if (existing.status === 'stopping' || isTerminalRecordingStatus(existing.status)) {
          return existing;
        }
        if (existing.status !== 'starting' && existing.status !== 'recording') {
          throw new Error('browser.recording_state_conflict');
        }
        this.raw
          .prepare(
            `UPDATE browser_recording
             SET status = 'stopping', revision = revision + 1, stop_reason = ?, updated_at = ?
             WHERE id = ? AND status IN ('starting', 'recording')`,
          )
          .run(stopReason, now, recordingId);
        return this.getRequiredRecording(recordingId);
      })
      .immediate();
  }

  finishRecording(
    id: string,
    input: {
      status: 'stopped' | 'failed' | 'interrupted';
      stopReason: BrowserRecordingStopReason;
      errorCode?: string;
      now?: string;
    },
  ): BrowserRecordingRecord {
    const recordingId = normalizeId(id, 'browser.recording_id_invalid');
    const status = input.status;
    const stopReason = normalizeRecordingStopReason(input.stopReason);
    const errorCode = input.errorCode
      ? normalizeId(input.errorCode, 'browser.recording_error_code_invalid')
      : undefined;
    const now = normalizeNow(input.now);
    return this.raw
      .transaction(() => {
        const existing = this.getRequiredRecording(recordingId);
        if (existing.status === status) return existing;
        if (isTerminalRecordingStatus(existing.status)) {
          throw new Error('browser.recording_state_conflict');
        }
        const updated = this.raw
          .prepare(
            `UPDATE browser_recording
             SET status = ?, revision = revision + 1, stop_reason = ?, error_code = ?,
                 stopped_at = ?, updated_at = ?
             WHERE id = ? AND status IN ('starting', 'recording', 'stopping')`,
          )
          .run(status, stopReason, errorCode ?? null, now, now, recordingId);
        if (updated.changes !== 1) throw new Error('browser.recording_state_conflict');
        return this.getRequiredRecording(recordingId);
      })
      .immediate();
  }

  failActiveCommandsForRun(
    runId: string,
    errorCode = 'browser.command-recovery-expired',
    now?: string,
  ): number {
    const normalizedRunId = normalizeId(runId, 'browser.command_run_id_invalid');
    const code = normalizeId(errorCode, 'browser.command_error_code_invalid');
    const at = normalizeNow(now);
    return this.raw
      .prepare(
        `UPDATE browser_command
         SET state = 'failed', error_code = ?, failure_class = 'acceptance',
             updated_at = ?, completed_at = ?
         WHERE run_id = ?
           AND state IN ('requested', 'approved', 'running', 'waiting_user')`,
      )
      .run(code, at, at, normalizedRunId).changes;
  }

  reserveCommand(input: {
    id?: string;
    idempotencyKey: string;
    workspaceId: string;
    runId: string;
    ownerId: string;
    profileId: string;
    leaseId?: string;
    pageId?: string;
    toolName: string;
    action: string;
    targetOrigin: string;
    sanitizedArgs: Record<string, unknown>;
    now?: string;
  }): BrowserCommandRecord & { created: boolean } {
    const normalized = normalizeCommandInput(input);
    const now = normalizeNow(input.now);
    return this.raw
      .transaction(() => {
        const existing = this.getCommandByIdempotencyKey(normalized.idempotencyKey);
        if (existing) {
          assertSameCommand(existing, normalized.requestDigest);
          return { ...existing, created: false };
        }
        const profile = this.raw
          .prepare(
            `SELECT 1 AS present
             FROM browser_profile
             WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(normalized.profileId) as { present: number } | undefined;
        if (profile?.present !== 1) throw new Error('browser.profile_not_found');
        if (this.hasActiveProfileRecording(normalized.profileId)) {
          throw new Error('browser.profile_in_use');
        }
        this.raw
          .prepare(
            `INSERT INTO browser_command (
           id, idempotency_key, workspace_id, run_id, owner_id, profile_id,
           lease_id, page_id, tool_name, action, target_origin, request_digest, sanitized_args_json,
           state, result_json, error_code, failure_class, created_at, updated_at,
           approved_at, started_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', NULL, NULL, NULL, ?, ?, NULL, NULL, NULL)`,
          )
          .run(
            normalized.id,
            normalized.idempotencyKey,
            normalized.workspaceId,
            normalized.runId,
            normalized.ownerId,
            normalized.profileId,
            normalized.leaseId ?? null,
            normalized.pageId ?? null,
            normalized.toolName,
            normalized.action,
            normalized.targetOrigin,
            normalized.requestDigest,
            normalized.sanitizedArgsJson,
            now,
            now,
          );
        return { ...this.getRequiredCommand(normalized.id), created: true };
      })
      .immediate();
  }

  markApproved(id: string, now?: string): BrowserCommandRecord {
    return this.transition(id, ['requested', 'waiting_user'], 'approved', normalizeNow(now), {
      approvedAt: true,
    });
  }

  markRunning(id: string, now?: string): BrowserCommandRecord & { startedNow: boolean } {
    const at = normalizeNow(now);
    return this.raw
      .transaction(() => {
        const existing = this.getRequiredCommand(id);
        if (existing.state === 'running') return { ...existing, startedNow: false };
        if (existing.state !== 'approved') throw new Error('browser.command_not_approved');
        const update = this.raw
          .prepare(
            `UPDATE browser_command
         SET state = 'running', updated_at = ?, started_at = ?
         WHERE id = ? AND state = 'approved'`,
          )
          .run(at, at, id);
        if (update.changes !== 1) throw new Error('browser.command_transition_conflict');
        return { ...this.getRequiredCommand(id), startedNow: true };
      })
      .immediate();
  }

  completeCommand(
    id: string,
    output: unknown,
    lease?: { leaseId: string; pageId: string },
    now?: string,
  ): BrowserCommandRecord {
    const resultJson = boundedJson({ output }, 'browser.command_result_too_large');
    const at = normalizeNow(now);
    const leaseId = lease
      ? normalizeId(lease.leaseId, 'browser.command_lease_id_invalid')
      : undefined;
    const pageId = lease ? normalizeId(lease.pageId, 'browser.command_page_id_invalid') : undefined;
    return this.raw
      .transaction(() => {
        const existing = this.getRequiredCommand(id);
        if (existing.state === 'completed') {
          if (JSON.stringify(existing.result) !== resultJson) {
            throw new Error('browser.command_result_mismatch');
          }
          return existing;
        }
        if (existing.state !== 'running') throw new Error('browser.command_not_running');
        const update = this.raw
          .prepare(
            `UPDATE browser_command
         SET state = 'completed', result_json = ?, lease_id = ?, page_id = ?,
             error_code = NULL, failure_class = NULL, updated_at = ?, completed_at = ?
         WHERE id = ? AND state = 'running'`,
          )
          .run(resultJson, leaseId ?? null, pageId ?? null, at, at, id);
        if (update.changes !== 1) throw new Error('browser.command_transition_conflict');
        return this.getRequiredCommand(id);
      })
      .immediate();
  }

  failCommand(
    id: string,
    error: { code: string; failureClass: string },
    now?: string,
  ): BrowserCommandRecord {
    const code = normalizeId(error.code, 'browser.command_error_code_invalid');
    const failureClass = normalizeId(error.failureClass, 'browser.command_failure_class_invalid');
    const at = normalizeNow(now);
    return this.raw
      .transaction(() => {
        const existing = this.getRequiredCommand(id);
        if (existing.state === 'completed') throw new Error('browser.command_already_completed');
        if (existing.state === 'failed') return existing;
        const update = this.raw
          .prepare(
            `UPDATE browser_command
         SET state = 'failed', error_code = ?, failure_class = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND state IN ('requested', 'approved', 'running', 'waiting_user')`,
          )
          .run(code, failureClass, at, at, id);
        if (update.changes !== 1) throw new Error('browser.command_transition_conflict');
        return this.getRequiredCommand(id);
      })
      .immediate();
  }

  markWaitingUser(
    id: string,
    errorCode = 'browser.command-inspection-required',
    now?: string,
  ): BrowserCommandRecord {
    const code = normalizeId(errorCode, 'browser.command_error_code_invalid');
    const at = normalizeNow(now);
    return this.raw
      .transaction(() => {
        const existing = this.getRequiredCommand(id);
        if (existing.state === 'waiting_user') return existing;
        if (!['requested', 'approved', 'running'].includes(existing.state)) {
          throw new Error('browser.command_cannot_wait');
        }
        const update = this.raw
          .prepare(
            `UPDATE browser_command
         SET state = 'waiting_user', error_code = ?, failure_class = 'permission', updated_at = ?
         WHERE id = ? AND state IN ('requested', 'approved', 'running')`,
          )
          .run(code, at, id);
        if (update.changes !== 1) throw new Error('browser.command_transition_conflict');
        return this.getRequiredCommand(id);
      })
      .immediate();
  }

  recoverUnknownInFlight(now?: string): number {
    const at = normalizeNow(now);
    return this.raw
      .prepare(
        `UPDATE browser_command
       SET state = 'waiting_user', error_code = 'browser.command-inspection-required',
           failure_class = 'permission', updated_at = ?
       WHERE state = 'running'`,
      )
      .run(at).changes;
  }

  getCommand(id: string): BrowserCommandRecord | undefined {
    const row = this.raw.prepare(`${commandSelect()} WHERE id = ?`).get(id) as
      BrowserCommandRow | undefined;
    return row ? mapCommand(row) : undefined;
  }

  getCommandByIdempotencyKey(idempotencyKey: string): BrowserCommandRecord | undefined {
    const key = normalizeId(idempotencyKey, 'browser.command_idempotency_key_invalid');
    const row = this.raw.prepare(`${commandSelect()} WHERE idempotency_key = ?`).get(key) as
      BrowserCommandRow | undefined;
    return row ? mapCommand(row) : undefined;
  }

  getLastCompletedCommand(input: {
    workspaceId: string;
    runId: string;
    ownerId: string;
    profileId: string;
  }): BrowserCommandRecord | undefined {
    const workspaceId = normalizeId(input.workspaceId, 'browser.command_workspace_id_invalid');
    const runId = normalizeId(input.runId, 'browser.command_run_id_invalid');
    const ownerId = normalizeId(input.ownerId, 'browser.command_owner_id_invalid');
    const profileId = normalizeId(input.profileId, 'browser.command_profile_id_invalid');
    const row = this.raw
      .prepare(
        `${commandSelect()}
       WHERE workspace_id = ? AND run_id = ? AND owner_id = ? AND profile_id = ?
         AND state = 'completed' AND tool_name <> 'browser_handoff'
         AND lease_id IS NOT NULL AND page_id IS NOT NULL
       ORDER BY completed_at DESC, id DESC
       LIMIT 1`,
      )
      .get(workspaceId, runId, ownerId, profileId) as BrowserCommandRow | undefined;
    return row ? mapCommand(row) : undefined;
  }

  markHandoffWaiting(
    id: string,
    lease: { leaseId: string; pageId: string },
    now?: string,
  ): BrowserCommandRecord {
    const leaseId = normalizeId(lease.leaseId, 'browser.command_lease_id_invalid');
    const pageId = normalizeId(lease.pageId, 'browser.command_page_id_invalid');
    const at = normalizeNow(now);
    return this.raw
      .transaction(() => {
        const existing = this.getRequiredCommand(id);
        if (existing.toolName !== 'browser_handoff' || existing.action !== 'handoff') {
          throw new Error('browser.handoff_command_invalid');
        }
        if (existing.state === 'waiting_user') {
          if (existing.leaseId !== leaseId || existing.pageId !== pageId) {
            throw new Error('browser.handoff_lease_mismatch');
          }
          return existing;
        }
        if (existing.state !== 'requested') throw new Error('browser.handoff_transition_invalid');
        if (existing.leaseId !== leaseId || existing.pageId !== pageId) {
          throw new Error('browser.handoff_lease_mismatch');
        }
        const update = this.raw
          .prepare(
            `UPDATE browser_command
         SET state = 'waiting_user',
             error_code = 'browser.handoff-required', failure_class = 'permission', updated_at = ?
         WHERE id = ? AND state = 'requested'`,
          )
          .run(at, id);
        if (update.changes !== 1) throw new Error('browser.command_transition_conflict');
        return this.getRequiredCommand(id);
      })
      .immediate();
  }

  listWaitingHandoffs(
    input: {
      workspaceId?: string;
      runId?: string;
    } = {},
  ): BrowserCommandRecord[] {
    const clauses = [
      "tool_name = 'browser_handoff'",
      "action = 'handoff'",
      "state = 'waiting_user'",
      "error_code = 'browser.handoff-required'",
    ];
    const args: string[] = [];
    if (input.workspaceId !== undefined) {
      clauses.push('workspace_id = ?');
      args.push(normalizeId(input.workspaceId, 'browser.command_workspace_id_invalid'));
    }
    if (input.runId !== undefined) {
      clauses.push('run_id = ?');
      args.push(normalizeId(input.runId, 'browser.command_run_id_invalid'));
    }
    const rows = this.raw
      .prepare(`${commandSelect()} WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC, id ASC`)
      .all(...args) as BrowserCommandRow[];
    return rows.map(mapCommand);
  }

  getLastCompletedOrigin(input: {
    workspaceId: string;
    ownerId: string;
    profileId: string;
  }): string | undefined {
    const workspaceId = normalizeId(input.workspaceId, 'browser.command_workspace_id_invalid');
    const ownerId = normalizeId(input.ownerId, 'browser.command_owner_id_invalid');
    const profileId = normalizeId(input.profileId, 'browser.command_profile_id_invalid');
    const row = this.raw
      .prepare(
        `SELECT target_origin
       FROM browser_command
       WHERE workspace_id = ? AND owner_id = ? AND profile_id = ?
         AND state = 'completed'
       ORDER BY completed_at DESC, id DESC
       LIMIT 1`,
      )
      .get(workspaceId, ownerId, profileId) as { target_origin: string } | undefined;
    return row?.target_origin;
  }

  upsertOriginGrant(input: {
    id?: string;
    scopeType: BrowserGrantScopeType;
    scopeId: string;
    origin: string;
    action?: string;
    decision: BrowserGrantDecision;
    approvalId?: string;
    expiresAt?: string;
    revokedAt?: string;
    now?: string;
  }): BrowserOriginGrantRecord {
    const id = normalizeId(input.id ?? randomUUID(), 'browser.grant_id_invalid');
    const scopeType = normalizeScopeType(input.scopeType);
    const scopeId = normalizeId(input.scopeId, 'browser.grant_scope_id_invalid');
    const origin = normalizeOrigin(input.origin);
    const action = normalizeAction(input.action ?? ORIGIN_ACTION_ALL);
    const decision = normalizeDecision(input.decision);
    const approvalId = input.approvalId
      ? normalizeId(input.approvalId, 'browser.grant_approval_id_invalid')
      : undefined;
    const now = normalizeNow(input.now);
    const expiresAt = input.expiresAt ? normalizeNow(input.expiresAt) : undefined;
    const revokedAt = input.revokedAt ? normalizeNow(input.revokedAt) : undefined;
    this.raw
      .prepare(
        `INSERT INTO browser_origin_grant (
         id, scope_type, scope_id, origin, action, decision, approval_id,
         created_at, updated_at, expires_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope_type, scope_id, origin, action) DO UPDATE SET
         decision = excluded.decision,
         approval_id = excluded.approval_id,
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at,
         revoked_at = excluded.revoked_at`,
      )
      .run(
        id,
        scopeType,
        scopeId,
        origin,
        action,
        decision,
        approvalId ?? null,
        now,
        now,
        expiresAt ?? null,
        revokedAt ?? null,
      );
    return this.getRequiredGrant(scopeType, scopeId, origin, action);
  }

  resolveOriginDecision(input: {
    scopes: readonly BrowserGrantScope[];
    origin: string;
    action: string;
    now?: string;
  }): { decision: BrowserGrantDecision | 'none'; matches: BrowserOriginGrantRecord[] } {
    const origin = normalizeOrigin(input.origin);
    const action = normalizeAction(input.action);
    const now = normalizeNow(input.now);
    const matches: BrowserOriginGrantRecord[] = [];
    for (const scope of input.scopes) {
      const scopeType = normalizeScopeType(scope.scopeType);
      const scopeId = normalizeId(scope.scopeId, 'browser.grant_scope_id_invalid');
      const rows = this.raw
        .prepare(
          `${grantSelect()}
         WHERE scope_type = ? AND scope_id = ? AND origin = ? AND action IN (?, '*')`,
        )
        .all(scopeType, scopeId, origin, action) as BrowserGrantRow[];
      for (const row of rows) {
        const grant = mapGrant(row);
        if (grant.revokedAt) continue;
        if (grant.expiresAt && grant.expiresAt <= now) continue;
        matches.push(grant);
      }
    }
    if (matches.some((grant) => grant.decision === 'deny')) return { decision: 'deny', matches };
    if (matches.some((grant) => grant.decision === 'allow')) return { decision: 'allow', matches };
    return { decision: 'none', matches: [] };
  }

  private transition(
    id: string,
    fromStates: BrowserCommandStatus[],
    toState: BrowserCommandStatus,
    now: string,
    options: { approvedAt?: boolean } = {},
  ): BrowserCommandRecord {
    return this.raw
      .transaction(() => {
        const existing = this.getRequiredCommand(id);
        if (existing.state === toState) return existing;
        if (!fromStates.includes(existing.state))
          throw new Error('browser.command_transition_invalid');
        const placeholders = fromStates.map(() => '?').join(', ');
        const update = this.raw
          .prepare(
            `UPDATE browser_command
         SET state = ?, updated_at = ?, approved_at = ${options.approvedAt ? '?' : 'approved_at'}
         WHERE id = ? AND state IN (${placeholders})`,
          )
          .run(toState, now, ...(options.approvedAt ? [now] : []), id, ...fromStates);
        if (update.changes !== 1) throw new Error('browser.command_transition_conflict');
        return this.getRequiredCommand(id);
      })
      .immediate();
  }

  private getRequiredRecording(id: string): BrowserRecordingRecord {
    const row = this.raw.prepare(`${recordingSelect()} WHERE id = ?`).get(id) as
      BrowserRecordingRow | undefined;
    if (!row) throw new Error('browser.recording_not_found');
    return mapRecording(row);
  }

  private getRequiredRecordingStep(
    recordingId: string,
    sequence: number,
  ): BrowserRecordingStepRecord {
    const row = this.raw
      .prepare(`${recordingStepSelect()} WHERE recording_id = ? AND sequence = ?`)
      .get(recordingId, sequence) as BrowserRecordingStepRow | undefined;
    if (!row) throw new Error('browser.recording_step_not_found');
    return mapRecordingStep(row);
  }

  private getRequiredProfile(id: string, includeDeleted = false): BrowserProfileRecord {
    const row = this.raw
      .prepare(
        `${profileSelect()} WHERE p.id = ?${includeDeleted ? '' : ' AND p.deleted_at IS NULL'}`,
      )
      .get(id) as BrowserProfileRow | undefined;
    if (!row) throw new Error('browser.profile_not_found');
    return mapProfile(row);
  }

  private getRequiredSiteSession(profileId: string, siteKey: string): BrowserSiteSessionRecord {
    const row = this.raw
      .prepare(`${siteSessionSelect()} WHERE profile_id = ? AND site_key = ?`)
      .get(profileId, siteKey) as BrowserSiteSessionRow | undefined;
    if (!row) throw new Error('browser.site_session_not_found');
    return mapSiteSession(row);
  }

  private throwProfileMutationError(id: string, expectedRevision: number): never {
    const current = this.raw
      .prepare('SELECT revision, deleted_at FROM browser_profile WHERE id = ?')
      .get(id) as { revision: number; deleted_at: string | null } | undefined;
    if (!current || current.deleted_at) throw new Error('browser.profile_not_found');
    if (current.revision !== expectedRevision) throw new Error('browser.profile_revision_conflict');
    throw new Error('browser.profile_update_failed');
  }

  private getRequiredCommand(id: string): BrowserCommandRecord {
    const normalized = normalizeId(id, 'browser.command_id_invalid');
    const command = this.getCommand(normalized);
    if (!command) throw new Error('browser.command_not_found');
    return command;
  }

  private getRequiredGrant(
    scopeType: BrowserGrantScopeType,
    scopeId: string,
    origin: string,
    action: string,
  ): BrowserOriginGrantRecord {
    const row = this.raw
      .prepare(
        `${grantSelect()} WHERE scope_type = ? AND scope_id = ? AND origin = ? AND action = ?`,
      )
      .get(scopeType, scopeId, origin, action) as BrowserGrantRow | undefined;
    if (!row) throw new Error('browser.grant_not_found');
    return mapGrant(row);
  }
}

function normalizeCommandInput(input: {
  id?: string;
  idempotencyKey: string;
  workspaceId: string;
  runId: string;
  ownerId: string;
  profileId: string;
  leaseId?: string;
  pageId?: string;
  toolName: string;
  action: string;
  targetOrigin: string;
  sanitizedArgs: Record<string, unknown>;
}) {
  const id = normalizeId(input.id ?? randomUUID(), 'browser.command_id_invalid');
  const idempotencyKey = normalizeId(
    input.idempotencyKey,
    'browser.command_idempotency_key_invalid',
  );
  const workspaceId = normalizeId(input.workspaceId, 'browser.command_workspace_id_invalid');
  const runId = normalizeId(input.runId, 'browser.command_run_id_invalid');
  const ownerId = normalizeId(input.ownerId, 'browser.command_owner_id_invalid');
  const profileId = normalizeId(input.profileId, 'browser.command_profile_id_invalid');
  const leaseId = input.leaseId
    ? normalizeId(input.leaseId, 'browser.command_lease_id_invalid')
    : undefined;
  const pageId = input.pageId
    ? normalizeId(input.pageId, 'browser.command_page_id_invalid')
    : undefined;
  if ((leaseId === undefined) !== (pageId === undefined)) {
    throw new Error('browser.command_lease_identity_incomplete');
  }
  const toolName = normalizeId(input.toolName, 'browser.command_tool_name_invalid');
  const action = normalizeAction(input.action);
  const targetOrigin = normalizeOrigin(input.targetOrigin);
  const sanitizedArgsJson = boundedJson(input.sanitizedArgs, 'browser.command_args_too_large');
  const requestDigest = createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId,
        runId,
        ownerId,
        profileId,
        leaseId,
        pageId,
        toolName,
        action,
        targetOrigin,
        sanitizedArgs: JSON.parse(sanitizedArgsJson),
      }),
    )
    .digest('hex');
  return {
    id,
    idempotencyKey,
    workspaceId,
    runId,
    ownerId,
    profileId,
    leaseId,
    pageId,
    toolName,
    action,
    targetOrigin,
    sanitizedArgsJson,
    requestDigest,
  };
}

function normalizeId(value: string, code: string): string {
  const normalized = String(value ?? '').trim();
  if (!ID_RE.test(normalized)) throw new Error(code);
  return normalized;
}

function normalizeProfileName(value: string): string {
  const name = String(value ?? '').trim();
  if (!name || name.length > 80 || hasAsciiControlCharacter(name)) {
    throw new Error('browser.profile_name_invalid');
  }
  return name;
}

function normalizeRecordingUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(String(value ?? '').trim());
  } catch {
    throw new Error('browser.recording_url_invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('browser.recording_url_invalid');
  }
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  const sanitized = parsed.toString();
  if (sanitized.length > BROWSER_RECORDING_MAX_URL_CHARS) {
    throw new Error('browser.recording_url_too_long');
  }
  return sanitized;
}

function normalizeRecordingStep(input: BrowserRecordingStepInput): BrowserRecordingStepInput {
  const step = requireObject(input, 'browser.recording_step_invalid');
  const kind = step.kind;
  if (typeof kind !== 'string') throw new Error('browser.recording_step_invalid');
  switch (kind) {
    case 'navigate':
      assertExactObjectKeys(step, ['kind', 'url']);
      return { kind, url: normalizeRecordingUrl(requireString(step.url)) };
    case 'click': {
      assertExactObjectKeys(step, ['kind', 'locator', 'resultUrl']);
      return {
        kind,
        locator: normalizeRecordingLocator(step.locator),
        ...(step.resultUrl === undefined
          ? {}
          : { resultUrl: normalizeRecordingUrl(requireString(step.resultUrl)) }),
      };
    }
    case 'fill':
    case 'select':
      assertExactObjectKeys(step, ['kind', 'locator', 'value']);
      return {
        kind,
        locator: normalizeRecordingLocator(step.locator),
        value: normalizeRecordingInputValue(step.value),
      };
    case 'check':
      assertExactObjectKeys(step, ['kind', 'locator', 'checked']);
      if (typeof step.checked !== 'boolean') throw new Error('browser.recording_step_invalid');
      return { kind, locator: normalizeRecordingLocator(step.locator), checked: step.checked };
    case 'press':
      assertExactObjectKeys(step, ['kind', 'locator', 'key', 'resultUrl']);
      if (step.key !== 'Enter') throw new Error('browser.recording_step_invalid');
      return {
        kind,
        locator: normalizeRecordingLocator(step.locator),
        key: 'Enter',
        ...(step.resultUrl === undefined
          ? {}
          : { resultUrl: normalizeRecordingUrl(requireString(step.resultUrl)) }),
      };
    default:
      throw new Error('browser.recording_step_invalid');
  }
}

function normalizeRecordingLocator(value: unknown): BrowserRecordingLocator {
  const locator = requireObject(value, 'browser.recording_locator_invalid');
  const strategy = locator.strategy;
  if (strategy === 'role') {
    assertExactObjectKeys(locator, ['strategy', 'role', 'name']);
    const role = requireBoundedLocatorText(locator.role, 'browser.recording_locator_invalid');
    if (!/^[a-z][a-z0-9-]{0,63}$/u.test(role)) {
      throw new Error('browser.recording_locator_invalid');
    }
    return {
      strategy,
      role,
      ...(locator.name === undefined
        ? {}
        : {
            name: requireBoundedLocatorText(locator.name, 'browser.recording_locator_invalid'),
          }),
    };
  }
  if (['test-id', 'label', 'placeholder', 'id', 'name', 'css'].includes(String(strategy))) {
    assertExactObjectKeys(locator, ['strategy', 'value']);
    return {
      strategy: strategy as 'test-id' | 'label' | 'placeholder' | 'id' | 'name' | 'css',
      value: requireBoundedLocatorText(locator.value, 'browser.recording_locator_invalid'),
    };
  }
  throw new Error('browser.recording_locator_invalid');
}

function normalizeRecordingInputValue(value: unknown) {
  const input = requireObject(value, 'browser.recording_value_invalid');
  if (input.kind === 'secret') {
    assertExactObjectKeys(input, ['kind']);
    return { kind: 'secret' as const };
  }
  if (input.kind === 'literal') {
    assertExactObjectKeys(input, ['kind', 'value']);
    const text = requireString(input.value);
    if (
      text.length > BROWSER_RECORDING_MAX_TEXT_CHARS ||
      [...text].some((character) => {
        const code = character.charCodeAt(0);
        return (code < 0x20 && !['\t', '\n', '\r'].includes(character)) || code === 0x7f;
      })
    ) {
      throw new Error('browser.recording_value_invalid');
    }
    return { kind: 'literal' as const, value: text };
  }
  throw new Error('browser.recording_value_invalid');
}

function requireObject(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('browser.recording_step_invalid');
  return value;
}

function requireBoundedLocatorText(value: unknown, code: string): string {
  if (typeof value !== 'string') throw new Error(code);
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > BROWSER_RECORDING_MAX_LOCATOR_CHARS ||
    hasAsciiControlCharacter(normalized)
  ) {
    throw new Error(code);
  }
  return normalized;
}

function assertExactObjectKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error('browser.recording_step_invalid');
  }
}

function boundedRecordingStepJson(step: BrowserRecordingStepInput): string {
  const json = JSON.stringify(step);
  if (Buffer.byteLength(json, 'utf8') > BROWSER_RECORDING_MAX_STEP_BYTES) {
    throw new Error('browser.recording_step_too_large');
  }
  return json;
}

function recordingStepResultUrl(step: BrowserRecordingStepInput): string | undefined {
  if (step.kind === 'navigate') return step.url;
  if (step.kind === 'click' || step.kind === 'press') return step.resultUrl;
  return undefined;
}

function canReplaceRecordingStep(
  existing: BrowserRecordingStepInput,
  replacement: BrowserRecordingStepInput,
): boolean {
  if (existing.kind !== replacement.kind) return false;
  if (existing.kind === 'navigate' && replacement.kind === 'navigate') return true;
  if ('locator' in existing && 'locator' in replacement) {
    return JSON.stringify(existing.locator) === JSON.stringify(replacement.locator);
  }
  return false;
}

function normalizeRecordingStopReason(
  value: BrowserRecordingStopReason,
): BrowserRecordingStopReason {
  if (
    [
      'user',
      'step_limit',
      'page_closed',
      'browser_closed',
      'runtime_restarted',
      'start_failed',
      'capture_failed',
    ].includes(value)
  ) {
    return value;
  }
  throw new Error('browser.recording_stop_reason_invalid');
}

function isTerminalRecordingStatus(status: BrowserRecordingStatus): boolean {
  return status === 'stopped' || status === 'failed' || status === 'interrupted';
}

function normalizeAfterSequence(value?: number): number {
  const sequence = value ?? 0;
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > BROWSER_RECORDING_MAX_STEPS) {
    throw new Error('browser.recording_after_sequence_invalid');
  }
  return sequence;
}

function normalizePageLimit(value: number | undefined, fallback: number): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > BROWSER_RECORDING_MAX_STEPS) {
    throw new Error('browser.recording_limit_invalid');
  }
  return limit;
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function normalizeRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error('browser.profile_revision_invalid');
  return value;
}

function normalizeSiteKey(value: string): string {
  const candidate = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '');
  if (!candidate || candidate.length > 253 || candidate.includes('/') || candidate.includes(':')) {
    throw new Error('browser.site_key_invalid');
  }
  let hostname: string;
  try {
    hostname = new URL(`https://${candidate}`).hostname.toLowerCase();
  } catch {
    throw new Error('browser.site_key_invalid');
  }
  if (hostname !== candidate) throw new Error('browser.site_key_invalid');
  return hostname;
}

function normalizeSiteSession(
  input: {
    siteKey: string;
    origins: readonly string[];
    state: BrowserSiteSessionState;
    cookieCount: number;
    storageBytes: number;
    storageTypes: readonly string[];
    lastSeenAt?: string;
    lastVerifiedAt?: string;
  },
  checkedAt: string,
) {
  if (!['data_present', 'verified', 'reauth_required'].includes(input.state)) {
    throw new Error('browser.site_session_state_invalid');
  }
  const origins = [...new Set(input.origins.map((origin) => normalizeOrigin(origin)))].sort();
  if (origins.length > 64) throw new Error('browser.site_session_origins_too_many');
  const storageTypes = [
    ...new Set(
      input.storageTypes.map((type) => {
        const normalized = String(type ?? '')
          .trim()
          .toLowerCase();
        if (!/^[a-z][a-z0-9_-]{0,63}$/.test(normalized)) {
          throw new Error('browser.site_session_storage_type_invalid');
        }
        return normalized;
      }),
    ),
  ].sort();
  if (storageTypes.length > 32) throw new Error('browser.site_session_storage_types_too_many');
  return {
    siteKey: normalizeSiteKey(input.siteKey),
    origins,
    state: input.state,
    cookieCount: normalizeNonNegativeInteger(
      input.cookieCount,
      'browser.site_session_cookie_count_invalid',
    ),
    storageBytes: normalizeNonNegativeInteger(
      input.storageBytes,
      'browser.site_session_storage_bytes_invalid',
    ),
    storageTypes,
    ...(input.lastSeenAt ? { lastSeenAt: normalizeNow(input.lastSeenAt) } : {}),
    ...(input.lastVerifiedAt ? { lastVerifiedAt: normalizeNow(input.lastVerifiedAt) } : {}),
    checkedAt,
  };
}

function normalizeNonNegativeInteger(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function normalizeAction(value: string): string {
  return normalizeId(value, 'browser.action_invalid');
}

function normalizeScopeType(value: string): BrowserGrantScopeType {
  if (['user', 'workspace', 'agent-version', 'workflow', 'run'].includes(value)) {
    return value as BrowserGrantScopeType;
  }
  throw new Error('browser.grant_scope_type_invalid');
}

function normalizeDecision(value: string): BrowserGrantDecision {
  if (value === 'allow' || value === 'deny') return value;
  throw new Error('browser.grant_decision_invalid');
}

function normalizeOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(String(value ?? '').trim());
  } catch {
    throw new Error('browser.origin_invalid');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin === 'null') {
    throw new Error('browser.origin_invalid');
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('browser.origin_invalid');
  }
  return parsed.origin.toLowerCase();
}

function normalizeNow(value?: string): string {
  const now = value ?? new Date().toISOString();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(now) ||
    !Number.isFinite(Date.parse(now))
  ) {
    throw new Error('browser.timestamp_invalid');
  }
  return now;
}

function boundedJson(value: unknown, tooLargeCode: string): string {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new Error('browser.json_invalid');
  }
  if (typeof json !== 'string') throw new Error('browser.json_invalid');
  if (Buffer.byteLength(json, 'utf8') > MAX_JSON_BYTES) throw new Error(tooLargeCode);
  return json;
}

function assertSameCommand(existing: BrowserCommandRecord, requestDigest: string): void {
  if (existing.requestDigest !== requestDigest)
    throw new Error('browser.command_idempotency_mismatch');
}

function commandSelect(): string {
  return `SELECT id, idempotency_key, workspace_id, run_id, owner_id, profile_id,
    lease_id, page_id, tool_name, action, target_origin, request_digest, sanitized_args_json, state,
    result_json, error_code, failure_class, created_at, updated_at, approved_at,
    started_at, completed_at FROM browser_command`;
}

function profileSelect(): string {
  return `SELECT p.id, p.name, p.revision, p.is_default, p.created_at, p.updated_at,
    p.last_used_at, p.deleted_at,
    (SELECT COUNT(*) FROM browser_site_session s WHERE s.profile_id = p.id) AS site_count
    FROM browser_profile p`;
}

function siteSessionSelect(): string {
  return `SELECT profile_id, site_key, origins_json, state, cookie_count, storage_bytes,
    storage_types_json, last_seen_at, last_verified_at, last_checked_at, updated_at
    FROM browser_site_session`;
}

function recordingSelect(): string {
  return `SELECT id, profile_id, owner_id, lease_id, page_id, status, revision,
    start_url, current_url, step_count, stop_reason, error_code, created_at,
    started_at, stopped_at, updated_at FROM browser_recording`;
}

function recordingStepSelect(): string {
  return `SELECT recording_id, sequence, kind, payload_json, recorded_at, updated_at
    FROM browser_recording_step`;
}

function grantSelect(): string {
  return `SELECT id, scope_type, scope_id, origin, action, decision, approval_id,
    created_at, updated_at, expires_at, revoked_at FROM browser_origin_grant`;
}

function mapCommand(row: BrowserCommandRow): BrowserCommandRecord {
  const state = row.state as BrowserCommandStatus;
  const result = row.result_json
    ? (JSON.parse(row.result_json) as BrowserCommandResult)
    : undefined;
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    workspaceId: row.workspace_id,
    runId: row.run_id,
    ownerId: row.owner_id,
    profileId: row.profile_id,
    ...(row.lease_id ? { leaseId: row.lease_id } : {}),
    ...(row.page_id ? { pageId: row.page_id } : {}),
    toolName: row.tool_name,
    action: row.action,
    targetOrigin: row.target_origin,
    requestDigest: row.request_digest,
    sanitizedArgs: JSON.parse(row.sanitized_args_json) as Record<string, unknown>,
    state,
    ...(result ? { result } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.failure_class ? { failureClass: row.failure_class } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.approved_at ? { approvedAt: row.approved_at } : {}),
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function mapProfile(row: BrowserProfileRow): BrowserProfileRecord {
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {}),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    siteCount: row.site_count,
  };
}

function mapSiteSession(row: BrowserSiteSessionRow): BrowserSiteSessionRecord {
  return {
    profileId: row.profile_id,
    siteKey: row.site_key,
    origins: parseStringArray(row.origins_json),
    state: row.state as BrowserSiteSessionState,
    cookieCount: row.cookie_count,
    storageBytes: row.storage_bytes,
    storageTypes: parseStringArray(row.storage_types_json),
    ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : {}),
    ...(row.last_verified_at ? { lastVerifiedAt: row.last_verified_at } : {}),
    lastCheckedAt: row.last_checked_at,
    updatedAt: row.updated_at,
  };
}

function mapRecording(row: BrowserRecordingRow): BrowserRecordingRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    ownerId: row.owner_id,
    ...(row.lease_id ? { leaseId: row.lease_id } : {}),
    ...(row.page_id ? { pageId: row.page_id } : {}),
    status: row.status as BrowserRecordingStatus,
    revision: row.revision,
    ...(row.start_url ? { startUrl: row.start_url } : {}),
    ...(row.current_url ? { currentUrl: row.current_url } : {}),
    stepCount: row.step_count,
    ...(row.stop_reason ? { stopReason: row.stop_reason as BrowserRecordingStopReason } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    createdAt: row.created_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.stopped_at ? { stoppedAt: row.stopped_at } : {}),
    updatedAt: row.updated_at,
  };
}

function mapRecordingStep(row: BrowserRecordingStepRow): BrowserRecordingStepRecord {
  const step = normalizeRecordingStep(JSON.parse(row.payload_json) as BrowserRecordingStepInput);
  if (step.kind !== row.kind) throw new Error('browser.recording_step_kind_mismatch');
  return {
    recordingId: row.recording_id,
    sequence: row.sequence,
    step,
    recordedAt: row.recorded_at,
    updatedAt: row.updated_at,
  };
}

function parseStringArray(json: string): string[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
    throw new Error('browser.site_session_json_invalid');
  }
  return parsed;
}

function mapGrant(row: BrowserGrantRow): BrowserOriginGrantRecord {
  return {
    id: row.id,
    scopeType: row.scope_type as BrowserGrantScopeType,
    scopeId: row.scope_id,
    origin: row.origin,
    action: row.action,
    decision: row.decision as BrowserGrantDecision,
    ...(row.approval_id ? { approvalId: row.approval_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
  };
}
