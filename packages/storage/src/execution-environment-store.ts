import {
  ulid,
  type BrowserIdentity,
  type BrowserIdentityId,
  type ExecutionProfile,
  type ExecutionProfileId,
  type ProjectResource,
  type ProjectResourceId,
  type ProjectResourceType,
  type RunId,
  type TaskExecutionContext,
  type TaskExecutionMode,
  type TaskExecutionState,
  type TaskId,
  type WorkspaceId,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';
import { canonicalizeWorkspacePath } from './path-allowlist.js';

interface ResourceRow {
  id: string;
  workspace_id: string;
  resource_type: string;
  local_path: string | null;
  repository_url: string | null;
  default_ref: string | null;
  created_at: string;
  updated_at: string;
}

interface ProfileRow {
  id: string;
  workspace_id: string | null;
  name: string;
  mode: string;
  default_ref: string | null;
  setup_commands_json: string;
  include_patterns_json: string;
  retention_days: number;
  browser_identity_id: string | null;
  created_at: string;
  updated_at: string;
}

interface BrowserIdentityRow {
  id: string;
  name: string;
  profile_path: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

interface TaskContextRow {
  task_id: string;
  resource_id: string | null;
  execution_profile_id: string | null;
  browser_identity_id: string | null;
  mode: string;
  state: string;
  source_path: string | null;
  execution_path: string | null;
  base_ref: string | null;
  head_ref: string | null;
  lease_owner_run_id: string | null;
  blocked_reason: string | null;
  cleanup_after: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnsureWorkspaceExecutionInput {
  workspaceId: WorkspaceId;
  folderPath?: string;
  browserProfilePath: string;
  now?: string;
}

export interface ConfigureProjectResourceInput {
  workspaceId: WorkspaceId;
  type: ProjectResourceType;
  localPath?: string;
  repositoryUrl?: string;
  defaultRef?: string;
  now?: string;
}

export interface CreateTaskExecutionContextInput {
  taskId: TaskId;
  workspaceId: WorkspaceId;
  parentTaskId?: TaskId;
  now?: string;
}

export interface CreateBrowserIdentityInput {
  id: BrowserIdentityId;
  name: string;
  profilePath: string;
  isDefault?: boolean;
  now?: string;
}

function requiredText(value: string | undefined, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
}

function parseStringArray(value: string, field: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${field} is invalid`);
  }
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error(`${field} is invalid`);
  }
  return parsed;
}

function parseMode(value: string): TaskExecutionMode {
  if (value === 'none' || value === 'local_serial' || value === 'managed_worktree') return value;
  throw new Error(`Invalid task execution mode: ${value}`);
}

function parseState(value: string): TaskExecutionState {
  if (
    value === 'pending' ||
    value === 'ready' ||
    value === 'blocked' ||
    value === 'cleanup_pending' ||
    value === 'retained' ||
    value === 'cleaned'
  ) {
    return value;
  }
  throw new Error(`Invalid task execution state: ${value}`);
}

export class SqliteExecutionEnvironmentStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  ensureWorkspaceDefaults(input: EnsureWorkspaceExecutionInput): {
    profile: ExecutionProfile;
    browserIdentity: BrowserIdentity;
    resource?: ProjectResource;
  } {
    const now = input.now ?? new Date().toISOString();
    const browserIdentity = this.ensureDefaultBrowserIdentity(input.browserProfilePath, now);
    let resource = this.mergeLatestGitBindingIntoPrimary(input.workspaceId, now);
    if (!resource && input.folderPath) {
      resource = this.configureResource({
        workspaceId: input.workspaceId,
        type: 'local_directory',
        localPath: input.folderPath,
        now,
      });
    }
    let profile = this.getWorkspaceProfile(input.workspaceId);
    if (!profile) {
      const id = ulid() as ExecutionProfileId;
      this.raw
        .prepare(
          `INSERT INTO execution_profile (
             id, workspace_id, name, mode, default_ref, setup_commands_json,
             include_patterns_json, retention_days, browser_identity_id, created_at, updated_at
           ) VALUES (?, ?, ?, 'auto', NULL, '[]', '[]', 7, ?, ?, ?)`,
        )
        .run(id, input.workspaceId, '默认运行配置', browserIdentity.id, now, now);
      profile = this.getRequiredProfile(id);
    } else if (!profile.browserIdentityId) {
      this.raw
        .prepare('UPDATE execution_profile SET browser_identity_id = ?, updated_at = ? WHERE id = ?')
        .run(browserIdentity.id, now, profile.id);
      profile = this.getRequiredProfile(profile.id);
    }
    return { profile, browserIdentity, ...(resource ? { resource } : {}) };
  }

  configureResource(input: ConfigureProjectResourceInput): ProjectResource {
    const now = input.now ?? new Date().toISOString();
    const localPath = input.localPath ? canonicalizeWorkspacePath(input.localPath) : undefined;
    const repositoryUrl = input.repositoryUrl?.trim() || undefined;
    if (input.type === 'local_directory' && (!localPath || repositoryUrl)) {
      throw new Error('local_directory requires exactly one localPath');
    }
    if (input.type === 'git_repository' && !localPath && !repositoryUrl) {
      throw new Error('git_repository requires localPath or repositoryUrl');
    }
    if (input.type === 'git_repository' && repositoryUrl) {
      const primary = this.getPrimaryResource(input.workspaceId);
      if (primary) {
        this.raw
          .prepare(
            `UPDATE project_resource
             SET resource_type = 'git_repository',
                 local_path = COALESCE(?, local_path),
                 repository_url = ?,
                 default_ref = COALESCE(?, default_ref),
                 updated_at = ?
             WHERE id = ?`,
          )
          .run(
            localPath ?? null,
            repositoryUrl,
            input.defaultRef?.trim() || null,
            now,
            primary.id,
          );
        return this.getRequiredResource(primary.id);
      }
    }
    const existing = this.raw
      .prepare(
        `SELECT id FROM project_resource
         WHERE workspace_id = ? AND resource_type = ?
           AND COALESCE(local_path, '') = COALESCE(?, '')
           AND COALESCE(repository_url, '') = COALESCE(?, '')`,
      )
      .get(input.workspaceId, input.type, localPath ?? null, repositoryUrl ?? null) as
      | { id: string }
      | undefined;
    if (existing) return this.getRequiredResource(existing.id as ProjectResourceId);
    const id = ulid() as ProjectResourceId;
    this.raw
      .prepare(
        `INSERT INTO project_resource (
           id, workspace_id, resource_type, local_path, repository_url,
           default_ref, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.type,
        localPath ?? null,
        repositoryUrl ?? null,
        input.defaultRef?.trim() || null,
        now,
        now,
      );
    return this.getRequiredResource(id);
  }

  promoteResourceToGit(resourceId: ProjectResourceId, defaultRef?: string, now?: string): ProjectResource {
    const updatedAt = now ?? new Date().toISOString();
    this.raw
      .prepare(
        `UPDATE project_resource
         SET resource_type = 'git_repository', default_ref = COALESCE(?, default_ref), updated_at = ?
         WHERE id = ? AND local_path IS NOT NULL`,
      )
      .run(defaultRef?.trim() || null, updatedAt, resourceId);
    return this.getRequiredResource(resourceId);
  }

  getPrimaryResource(workspaceId: WorkspaceId): ProjectResource | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, workspace_id, resource_type, local_path, repository_url,
                default_ref, created_at, updated_at
         FROM project_resource WHERE workspace_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1`,
      )
      .get(workspaceId) as ResourceRow | undefined;
    return row ? mapResource(row) : undefined;
  }

  getRequiredResource(id: ProjectResourceId): ProjectResource {
    const row = this.raw
      .prepare(
        `SELECT id, workspace_id, resource_type, local_path, repository_url,
                default_ref, created_at, updated_at FROM project_resource WHERE id = ?`,
      )
      .get(id) as ResourceRow | undefined;
    if (!row) throw new Error(`ProjectResource not found: ${id}`);
    return mapResource(row);
  }

  getWorkspaceProfile(workspaceId: WorkspaceId): ExecutionProfile | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, workspace_id, name, mode, default_ref, setup_commands_json,
                include_patterns_json, retention_days, browser_identity_id, created_at, updated_at
         FROM execution_profile WHERE workspace_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1`,
      )
      .get(workspaceId) as ProfileRow | undefined;
    return row ? mapProfile(row) : undefined;
  }

  getRequiredProfile(id: ExecutionProfileId): ExecutionProfile {
    const row = this.raw
      .prepare(
        `SELECT id, workspace_id, name, mode, default_ref, setup_commands_json,
                include_patterns_json, retention_days, browser_identity_id, created_at, updated_at
         FROM execution_profile WHERE id = ?`,
      )
      .get(id) as ProfileRow | undefined;
    if (!row) throw new Error(`ExecutionProfile not found: ${id}`);
    return mapProfile(row);
  }

  listBrowserIdentities(): BrowserIdentity[] {
    const rows = this.raw
      .prepare(
        `SELECT id, name, profile_path, is_default, created_at, updated_at
         FROM browser_identity ORDER BY is_default DESC, created_at ASC, rowid ASC`,
      )
      .all() as BrowserIdentityRow[];
    return rows.map(mapBrowserIdentity);
  }

  getBrowserIdentity(id: BrowserIdentityId): BrowserIdentity | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, name, profile_path, is_default, created_at, updated_at
         FROM browser_identity WHERE id = ?`,
      )
      .get(id) as BrowserIdentityRow | undefined;
    return row ? mapBrowserIdentity(row) : undefined;
  }

  createBrowserIdentity(input: CreateBrowserIdentityInput): BrowserIdentity {
    const now = input.now ?? new Date().toISOString();
    const name = requiredText(input.name, 'name');
    const profilePath = canonicalizeWorkspacePath(input.profilePath);
    const create = this.raw.transaction(() => {
      const priorDefault = input.isDefault
        ? this.listBrowserIdentities().find((identity) => identity.isDefault)
        : undefined;
      if (input.isDefault) {
        this.raw.prepare('UPDATE browser_identity SET is_default = 0 WHERE is_default = 1').run();
      }
      this.raw
        .prepare(
          `INSERT INTO browser_identity (id, name, profile_path, is_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.id, name, profilePath, input.isDefault ? 1 : 0, now, now);
      if (input.isDefault && priorDefault) {
        this.raw
          .prepare('UPDATE execution_profile SET browser_identity_id = ?, updated_at = ? WHERE browser_identity_id = ?')
          .run(input.id, now, priorDefault.id);
      }
    });
    create();
    return this.getBrowserIdentity(input.id)!;
  }

  updateBrowserIdentity(
    id: BrowserIdentityId,
    input: { name?: string; makeDefault?: boolean; now?: string },
  ): BrowserIdentity {
    const existing = this.getBrowserIdentity(id);
    if (!existing) throw new Error(`BrowserIdentity not found: ${id}`);
    const now = input.now ?? new Date().toISOString();
    const name = input.name === undefined ? existing.name : requiredText(input.name, 'name');
    const update = this.raw.transaction(() => {
      const priorDefault = input.makeDefault
        ? this.listBrowserIdentities().find((identity) => identity.isDefault)
        : undefined;
      if (input.makeDefault) {
        this.raw.prepare('UPDATE browser_identity SET is_default = 0 WHERE is_default = 1').run();
      }
      this.raw
        .prepare(
          `UPDATE browser_identity
           SET name = ?, is_default = CASE WHEN ? THEN 1 ELSE is_default END, updated_at = ?
           WHERE id = ?`,
        )
        .run(name, input.makeDefault ? 1 : 0, now, id);
      if (input.makeDefault && priorDefault && priorDefault.id !== id) {
        this.raw
          .prepare('UPDATE execution_profile SET browser_identity_id = ?, updated_at = ? WHERE browser_identity_id = ?')
          .run(id, now, priorDefault.id);
      }
    });
    update();
    return this.getBrowserIdentity(id)!;
  }

  deleteBrowserIdentity(id: BrowserIdentityId): void {
    const existing = this.getBrowserIdentity(id);
    if (!existing) throw new Error(`BrowserIdentity not found: ${id}`);
    if (existing.isDefault) throw new Error('browser_identity.default_cannot_delete');
    const profileUse = this.raw
      .prepare('SELECT id FROM execution_profile WHERE browser_identity_id = ? LIMIT 1')
      .get(id);
    const taskUse = this.raw
      .prepare('SELECT task_id FROM task_execution_context WHERE browser_identity_id = ? LIMIT 1')
      .get(id);
    if (profileUse || taskUse) throw new Error('browser_identity.in_use');
    this.raw.prepare('DELETE FROM browser_identity WHERE id = ?').run(id);
  }

  setTaskBrowserIdentity(taskId: TaskId, browserIdentityId: BrowserIdentityId): TaskExecutionContext {
    if (!this.getBrowserIdentity(browserIdentityId)) {
      throw new Error(`BrowserIdentity not found: ${browserIdentityId}`);
    }
    const result = this.raw
      .prepare(
        `UPDATE task_execution_context SET browser_identity_id = ?, updated_at = ? WHERE task_id = ?`,
      )
      .run(browserIdentityId, new Date().toISOString(), taskId);
    if (result.changes !== 1) throw new Error(`TaskExecutionContext not found: ${taskId}`);
    return this.getRequiredTaskContext(taskId);
  }

  createTaskContext(input: CreateTaskExecutionContextInput): TaskExecutionContext {
    const existing = this.getTaskContext(input.taskId);
    if (existing) return existing;
    const now = input.now ?? new Date().toISOString();
    const resource = this.getPrimaryResource(input.workspaceId);
    const profile = this.getWorkspaceProfile(input.workspaceId);
    const parent = input.parentTaskId ? this.getTaskContext(input.parentTaskId) : undefined;
    this.raw
      .prepare(
        `INSERT INTO task_execution_context (
           task_id, resource_id, execution_profile_id, browser_identity_id, mode, state,
           source_path, execution_path, base_ref, head_ref, lease_owner_run_id,
           blocked_reason, cleanup_after, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'none', 'pending', ?, NULL, ?, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        input.taskId,
        resource?.id ?? null,
        profile?.id ?? null,
        parent?.browserIdentityId ?? profile?.browserIdentityId ?? null,
        parent?.executionPath ?? resource?.localPath ?? null,
        profile?.defaultRef ?? resource?.defaultRef ?? null,
        now,
        now,
      );
    return this.getRequiredTaskContext(input.taskId);
  }

  getTaskContext(taskId: TaskId): TaskExecutionContext | undefined {
    const row = this.raw
      .prepare(`${TASK_CONTEXT_SELECT} WHERE task_id = ?`)
      .get(taskId) as TaskContextRow | undefined;
    return row ? mapTaskContext(row) : undefined;
  }

  getRequiredTaskContext(taskId: TaskId): TaskExecutionContext {
    const context = this.getTaskContext(taskId);
    if (!context) throw new Error(`TaskExecutionContext not found: ${taskId}`);
    return context;
  }

  markTaskReady(input: {
    taskId: TaskId;
    mode: Exclude<TaskExecutionMode, 'none'>;
    sourcePath: string;
    executionPath: string;
    baseRef?: string;
    headRef?: string;
    now?: string;
  }): TaskExecutionContext {
    const now = input.now ?? new Date().toISOString();
    this.raw
      .prepare(
        `UPDATE task_execution_context
         SET mode = ?, state = 'ready', source_path = ?, execution_path = ?,
             base_ref = ?, head_ref = ?, blocked_reason = NULL, updated_at = ?
         WHERE task_id = ?`,
      )
      .run(
        input.mode,
        input.sourcePath,
        input.executionPath,
        input.baseRef ?? null,
        input.headRef ?? null,
        now,
        input.taskId,
      );
    return this.getRequiredTaskContext(input.taskId);
  }

  markTaskBlocked(taskId: TaskId, reason: string, now?: string): TaskExecutionContext {
    this.raw
      .prepare(
        `UPDATE task_execution_context
         SET state = 'blocked', blocked_reason = ?, updated_at = ? WHERE task_id = ?`,
      )
      .run(requiredText(reason, 'reason'), now ?? new Date().toISOString(), taskId);
    return this.getRequiredTaskContext(taskId);
  }

  acquireWriteLease(taskId: TaskId, runId: RunId, now?: string): TaskExecutionContext {
    const current = this.getRequiredTaskContext(taskId);
    if (!current.executionPath || current.state === 'cleaned') {
      throw new Error('task.execution_location_unavailable');
    }
    if (current.leaseOwnerRunId && current.leaseOwnerRunId !== runId) {
      throw new Error('task.execution_lease_busy');
    }
    if (current.mode === 'local_serial') {
      const busy = this.raw
        .prepare(
          `SELECT task_id FROM task_execution_context
           WHERE execution_path = ? AND task_id <> ? AND lease_owner_run_id IS NOT NULL LIMIT 1`,
        )
        .get(current.executionPath, taskId) as { task_id: string } | undefined;
      if (busy) throw new Error(`task.execution_directory_busy:${busy.task_id}`);
    }
    this.raw
      .prepare(
        `UPDATE task_execution_context
         SET lease_owner_run_id = ?, state = 'ready', blocked_reason = NULL, updated_at = ?
         WHERE task_id = ?`,
      )
      .run(runId, now ?? new Date().toISOString(), taskId);
    return this.getRequiredTaskContext(taskId);
  }

  releaseWriteLease(taskId: TaskId, runId: RunId, now?: string): TaskExecutionContext {
    this.raw
      .prepare(
        `UPDATE task_execution_context SET lease_owner_run_id = NULL, updated_at = ?
         WHERE task_id = ? AND lease_owner_run_id = ?`,
      )
      .run(now ?? new Date().toISOString(), taskId, runId);
    return this.getRequiredTaskContext(taskId);
  }

  scheduleCleanup(taskId: TaskId, retentionDays = 7, now = new Date()): TaskExecutionContext {
    const cleanupAfter = new Date(now.getTime() + retentionDays * 86_400_000).toISOString();
    this.raw
      .prepare(
        `UPDATE task_execution_context
         SET state = CASE WHEN mode = 'managed_worktree' THEN 'cleanup_pending' ELSE state END,
             cleanup_after = CASE WHEN mode = 'managed_worktree' THEN ? ELSE cleanup_after END,
             updated_at = ? WHERE task_id = ?`,
      )
      .run(cleanupAfter, now.toISOString(), taskId);
    return this.getRequiredTaskContext(taskId);
  }

  listCleanupCandidates(now = new Date()): TaskExecutionContext[] {
    const rows = this.raw
      .prepare(`${TASK_CONTEXT_SELECT} WHERE state IN ('cleanup_pending', 'retained') AND cleanup_after <= ?`)
      .all(now.toISOString()) as TaskContextRow[];
    return rows.map(mapTaskContext);
  }

  markCleanupResult(taskId: TaskId, state: 'retained' | 'cleaned', reason?: string): TaskExecutionContext {
    this.raw
      .prepare(
        `UPDATE task_execution_context
         SET state = ?, blocked_reason = ?, updated_at = ? WHERE task_id = ?`,
      )
      .run(state, reason?.trim() || null, new Date().toISOString(), taskId);
    return this.getRequiredTaskContext(taskId);
  }

  private ensureDefaultBrowserIdentity(profilePath: string, now: string): BrowserIdentity {
    const existing = this.listBrowserIdentities().find((identity) => identity.isDefault);
    if (existing) return existing;
    const id = ulid() as BrowserIdentityId;
    this.raw
      .prepare(
        `INSERT INTO browser_identity (id, name, profile_path, is_default, created_at, updated_at)
         VALUES (?, '默认浏览器身份', ?, 1, ?, ?)`,
      )
      .run(id, canonicalizeWorkspacePath(profilePath), now, now);
    return this.listBrowserIdentities().find((identity) => identity.id === id)!;
  }

  private mergeLatestGitBindingIntoPrimary(
    workspaceId: WorkspaceId,
    now: string,
  ): ProjectResource | undefined {
    const primary = this.getPrimaryResource(workspaceId);
    if (!primary || primary.repositoryUrl) return primary;
    const remote = this.raw
      .prepare(
        `SELECT repository_url, default_ref
         FROM project_resource
         WHERE workspace_id = ? AND repository_url IS NOT NULL
         ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
      )
      .get(workspaceId) as Pick<ResourceRow, 'repository_url' | 'default_ref'> | undefined;
    if (!remote?.repository_url) return primary;
    this.raw
      .prepare(
        `UPDATE project_resource
         SET resource_type = 'git_repository', repository_url = ?,
             default_ref = COALESCE(?, default_ref), updated_at = ?
         WHERE id = ?`,
      )
      .run(remote.repository_url, remote.default_ref, now, primary.id);
    return this.getRequiredResource(primary.id);
  }
}

const TASK_CONTEXT_SELECT = `
  SELECT task_id, resource_id, execution_profile_id, browser_identity_id, mode, state,
         source_path, execution_path, base_ref, head_ref, lease_owner_run_id,
         blocked_reason, cleanup_after, created_at, updated_at
  FROM task_execution_context
`;

function mapResource(row: ResourceRow): ProjectResource {
  if (row.resource_type !== 'local_directory' && row.resource_type !== 'git_repository') {
    throw new Error(`Invalid project resource type: ${row.resource_type}`);
  }
  return {
    id: row.id as ProjectResourceId,
    workspaceId: row.workspace_id as WorkspaceId,
    type: row.resource_type,
    ...(row.local_path ? { localPath: row.local_path } : {}),
    ...(row.repository_url ? { repositoryUrl: row.repository_url } : {}),
    ...(row.default_ref ? { defaultRef: row.default_ref } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProfile(row: ProfileRow): ExecutionProfile {
  if (row.mode !== 'auto' && row.mode !== 'local' && row.mode !== 'managed_worktree') {
    throw new Error(`Invalid execution profile mode: ${row.mode}`);
  }
  return {
    id: row.id as ExecutionProfileId,
    ...(row.workspace_id ? { workspaceId: row.workspace_id as WorkspaceId } : {}),
    name: row.name,
    mode: row.mode,
    ...(row.default_ref ? { defaultRef: row.default_ref } : {}),
    setupCommands: parseStringArray(row.setup_commands_json, 'setup_commands_json'),
    includePatterns: parseStringArray(row.include_patterns_json, 'include_patterns_json'),
    retentionDays: row.retention_days,
    ...(row.browser_identity_id
      ? { browserIdentityId: row.browser_identity_id as BrowserIdentityId }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBrowserIdentity(row: BrowserIdentityRow): BrowserIdentity {
  return {
    id: row.id as BrowserIdentityId,
    name: row.name,
    profilePath: row.profile_path,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTaskContext(row: TaskContextRow): TaskExecutionContext {
  return {
    taskId: row.task_id as TaskId,
    ...(row.resource_id ? { resourceId: row.resource_id as ProjectResourceId } : {}),
    ...(row.execution_profile_id
      ? { executionProfileId: row.execution_profile_id as ExecutionProfileId }
      : {}),
    ...(row.browser_identity_id
      ? { browserIdentityId: row.browser_identity_id as BrowserIdentityId }
      : {}),
    mode: parseMode(row.mode),
    state: parseState(row.state),
    ...(row.source_path ? { sourcePath: row.source_path } : {}),
    ...(row.execution_path ? { executionPath: row.execution_path } : {}),
    ...(row.base_ref ? { baseRef: row.base_ref } : {}),
    ...(row.head_ref ? { headRef: row.head_ref } : {}),
    ...(row.lease_owner_run_id ? { leaseOwnerRunId: row.lease_owner_run_id as RunId } : {}),
    ...(row.blocked_reason ? { blockedReason: row.blocked_reason } : {}),
    ...(row.cleanup_after ? { cleanupAfter: row.cleanup_after } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
