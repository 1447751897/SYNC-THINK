import type {
  AgentId,
  AgentVersionId,
  ApprovalMode,
  GroupCollaborationMode,
  GroupDefinition,
  GroupId,
  GroupKind,
  GroupMember,
  GroupTaskBinding,
  GroupVisualIdentity,
  TaskId,
} from '@sync-think/shared';
import { ulid } from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

const DEFAULT_VISUAL_IDENTITY: GroupVisualIdentity = {
  icon: 'users',
  color: '#1faa74',
};

export interface GroupMemberInput {
  agentVersionId: AgentVersionId | string;
  responsibility: string;
}

export interface CreateGroupInput {
  id?: GroupId;
  name: string;
  description?: string;
  kind: GroupKind;
  visualIdentity?: GroupVisualIdentity;
  leadAgentVersionId: AgentVersionId;
  approvalMode?: ApprovalMode;
  collaborationMode?: GroupCollaborationMode;
  maxConcurrency?: number;
  members: GroupMemberInput[];
  now?: string;
}

export interface UpdateGroupInput {
  groupId: GroupId | string;
  expectedVersion: number;
  name?: string;
  description?: string;
  kind?: GroupKind;
  visualIdentity?: GroupVisualIdentity;
  leadAgentVersionId?: AgentVersionId;
  approvalMode?: ApprovalMode;
  collaborationMode?: GroupCollaborationMode;
  maxConcurrency?: number;
  members?: GroupMemberInput[];
  now?: string;
}

interface GroupRow {
  id: string;
  name: string;
  description: string;
  kind: string;
  visual_identity_json: string;
  lead_agent_version_id: string;
  approval_mode: string;
  collaboration_mode: string;
  max_concurrency: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface GroupMemberRow {
  agent_version_id: string;
  responsibility: string;
  sort_order: number;
  created_at: string;
}

interface GroupTaskRow {
  group_id: string;
  task_id: string;
  created_at: string;
}

function requireText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} must not be empty`);
  if (trimmed.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`);
  return trimmed;
}

function optionalText(value: unknown, field: string, maxLength: number): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`);
  return trimmed;
}

function normalizeKind(value: unknown): GroupKind {
  if (value !== 'fixed' && value !== 'temporary') throw new Error('group kind is invalid');
  return value;
}

function normalizeApprovalMode(value: unknown): ApprovalMode {
  if (value !== 'request' && value !== 'delegate' && value !== 'full' && value !== 'custom') {
    throw new Error('group approvalMode is invalid');
  }
  return value;
}

function normalizeCollaborationMode(value: unknown): GroupCollaborationMode {
  if (value !== 'parallel' && value !== 'sequential') {
    throw new Error('group collaborationMode is invalid');
  }
  return value;
}

function normalizeConcurrency(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 16) {
    throw new Error('group maxConcurrency must be an integer between 1 and 16');
  }
  return value as number;
}

function normalizeVisualIdentity(value: GroupVisualIdentity | undefined): GroupVisualIdentity {
  const next = value ?? DEFAULT_VISUAL_IDENTITY;
  const icon = requireText(next.icon, 'visualIdentity.icon', 64);
  const color = requireText(next.color, 'visualIdentity.color', 64);
  const avatarPath = next.avatarPath?.trim();
  if (avatarPath && avatarPath.length > 4096) {
    throw new Error('visualIdentity.avatarPath exceeds 4096 characters');
  }
  return { icon, color, ...(avatarPath ? { avatarPath } : {}) };
}

function normalizeMembers(
  members: readonly GroupMemberInput[],
  leadAgentVersionId: AgentVersionId | string,
): Array<{ agentVersionId: AgentVersionId; responsibility: string }> {
  if (!Array.isArray(members) || members.length < 1 || members.length > 32) {
    throw new Error('group members must contain between 1 and 32 entries');
  }
  const seen = new Set<string>();
  const result: Array<{ agentVersionId: AgentVersionId; responsibility: string }> = [];
  for (const [index, member] of members.entries()) {
    const id = requireText(member.agentVersionId, `members[${index}].agentVersionId`, 256);
    if (seen.has(id)) throw new Error(`duplicate group member: ${id}`);
    seen.add(id);
    result.push({
      agentVersionId: id as AgentVersionId,
      responsibility: requireText(member.responsibility, `members[${index}].responsibility`, 2000),
    });
  }
  if (!seen.has(String(leadAgentVersionId))) {
    throw new Error('group lead must also be a member');
  }
  return result;
}

function parseVisualIdentity(raw: string): GroupVisualIdentity {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('group visual identity is invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('group visual identity must be an object');
  }
  return normalizeVisualIdentity(parsed as GroupVisualIdentity);
}

export class SqliteGroupStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  get(groupId: GroupId | string): GroupDefinition | undefined {
    const row = this.raw.prepare('SELECT * FROM agent_group WHERE id = ?').get(String(groupId)) as
      | GroupRow
      | undefined;
    if (!row) return undefined;
    return this.mapGroup(row);
  }

  list(input: { kind?: GroupKind; limit?: number } = {}): GroupDefinition[] {
    const limit = Math.max(1, Math.min(500, input.limit ?? 100));
    const rows = input.kind
      ? (this.raw
          .prepare('SELECT * FROM agent_group WHERE kind = ? ORDER BY updated_at DESC, id ASC LIMIT ?')
          .all(normalizeKind(input.kind), limit) as GroupRow[])
      : (this.raw
          .prepare('SELECT * FROM agent_group ORDER BY updated_at DESC, id ASC LIMIT ?')
          .all(limit) as GroupRow[]);
    return rows.map((row) => this.mapGroup(row));
  }

  create(input: CreateGroupInput): GroupDefinition {
    const id = input.id ?? (`group-${ulid().toLowerCase()}` as GroupId);
    const name = requireText(input.name, 'group.name', 256);
    const description = optionalText(input.description, 'group.description', 4000);
    const kind = normalizeKind(input.kind);
    const leadAgentVersionId = requireText(
      input.leadAgentVersionId,
      'group.leadAgentVersionId',
      256,
    ) as AgentVersionId;
    const approvalMode = normalizeApprovalMode(input.approvalMode ?? 'full');
    const collaborationMode = normalizeCollaborationMode(input.collaborationMode ?? 'parallel');
    const maxConcurrency = normalizeConcurrency(input.maxConcurrency ?? 3);
    const visualIdentity = normalizeVisualIdentity(input.visualIdentity);
    const members = normalizeMembers(input.members, leadAgentVersionId);
    const now = input.now ?? new Date().toISOString();

    const create = this.raw.transaction(() => {
      this.assertAgentVersionsExist(members.map((member) => member.agentVersionId));
      this.raw
        .prepare(
          `INSERT INTO agent_group (
            id, name, description, kind, visual_identity_json, lead_agent_version_id,
            approval_mode, collaboration_mode, max_concurrency, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          id,
          name,
          description,
          kind,
          JSON.stringify(visualIdentity),
          leadAgentVersionId,
          approvalMode,
          collaborationMode,
          maxConcurrency,
          now,
          now,
        );
      this.replaceMembers(id, members, now);
    });
    create.immediate();
    const created = this.get(id);
    if (!created) throw new Error(`Group not found after create: ${id}`);
    return created;
  }

  update(input: UpdateGroupInput): GroupDefinition {
    const groupId = requireText(input.groupId, 'groupId', 256) as GroupId;
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error('group expectedVersion must be a positive integer');
    }
    const current = this.get(groupId);
    if (!current) throw new Error(`Group not found: ${groupId}`);
    if (current.version !== input.expectedVersion) {
      throw new Error(
        `Group version conflict: expected ${input.expectedVersion}, actual ${current.version}`,
      );
    }

    const leadAgentVersionId = (input.leadAgentVersionId ??
      current.leadAgentVersionId) as AgentVersionId;
    const members = normalizeMembers(input.members ?? current.members, leadAgentVersionId);
    const now = input.now ?? new Date().toISOString();
    const nextVersion = current.version + 1;
    const update = this.raw.transaction(() => {
      this.assertAgentVersionsExist(members.map((member) => member.agentVersionId));
      const result = this.raw
        .prepare(
          `UPDATE agent_group SET
            name = ?, description = ?, kind = ?, visual_identity_json = ?,
            lead_agent_version_id = ?, approval_mode = ?, collaboration_mode = ?,
            max_concurrency = ?, version = ?, updated_at = ?
          WHERE id = ? AND version = ?`,
        )
        .run(
          input.name === undefined ? current.name : requireText(input.name, 'group.name', 256),
          input.description === undefined
            ? current.description
            : optionalText(input.description, 'group.description', 4000),
          input.kind === undefined ? current.kind : normalizeKind(input.kind),
          JSON.stringify(
            input.visualIdentity === undefined
              ? current.visualIdentity
              : normalizeVisualIdentity(input.visualIdentity),
          ),
          leadAgentVersionId,
          input.approvalMode === undefined
            ? current.approvalMode
            : normalizeApprovalMode(input.approvalMode),
          input.collaborationMode === undefined
            ? current.collaborationMode
            : normalizeCollaborationMode(input.collaborationMode),
          input.maxConcurrency === undefined
            ? current.maxConcurrency
            : normalizeConcurrency(input.maxConcurrency),
          nextVersion,
          now,
          groupId,
          input.expectedVersion,
        );
      if (result.changes !== 1) {
        const latest = this.get(groupId);
        throw new Error(
          `Group version conflict: expected ${input.expectedVersion}, actual ${latest?.version ?? 'missing'}`,
        );
      }
      if (input.members !== undefined || input.leadAgentVersionId !== undefined) {
        this.replaceMembers(groupId, members, now);
      }
    });
    update.immediate();
    const updated = this.get(groupId);
    if (!updated) throw new Error(`Group not found after update: ${groupId}`);
    return updated;
  }

  attachTask(groupId: GroupId | string, taskId: TaskId | string, now?: string): GroupTaskBinding {
    const group = this.get(groupId);
    if (!group) throw new Error(`Group not found: ${String(groupId)}`);
    const task = this.raw.prepare('SELECT id FROM task WHERE id = ?').get(String(taskId));
    if (!task) throw new Error(`Task not found: ${String(taskId)}`);
    const createdAt = now ?? new Date().toISOString();
    this.raw
      .prepare('INSERT INTO group_task (task_id, group_id, created_at) VALUES (?, ?, ?)')
      .run(String(taskId), String(groupId), createdAt);
    return { groupId: group.id, taskId: String(taskId) as TaskId, createdAt };
  }

  getForTask(taskId: TaskId | string): GroupDefinition | undefined {
    const row = this.raw
      .prepare('SELECT group_id FROM group_task WHERE task_id = ?')
      .get(String(taskId)) as { group_id: string } | undefined;
    return row ? this.get(row.group_id) : undefined;
  }

  listTaskBindings(groupId: GroupId | string): GroupTaskBinding[] {
    const rows = this.raw
      .prepare('SELECT group_id, task_id, created_at FROM group_task WHERE group_id = ? ORDER BY created_at DESC')
      .all(String(groupId)) as GroupTaskRow[];
    return rows.map((row) => ({
      groupId: row.group_id as GroupId,
      taskId: row.task_id as TaskId,
      createdAt: row.created_at,
    }));
  }

  followLatestAgentVersion(
    agentId: AgentId | string,
    agentVersionId: AgentVersionId | string,
    now = new Date().toISOString(),
  ): GroupDefinition[] {
    const stableAgentId = requireText(agentId, 'agentId', 256);
    const latestVersionId = requireText(agentVersionId, 'agentVersionId', 256) as AgentVersionId;
    const latest = this.raw
      .prepare('SELECT agent_id FROM agent_version WHERE id = ?')
      .get(latestVersionId) as { agent_id: string } | undefined;
    if (!latest || latest.agent_id !== stableAgentId) {
      throw new Error('AgentVersion does not belong to the requested Agent');
    }
    const groupRows = this.raw
      .prepare(
        `SELECT DISTINCT gm.group_id
         FROM agent_group_member gm
         INNER JOIN agent_version av ON av.id = gm.agent_version_id
         WHERE av.agent_id = ?`,
      )
      .all(stableAgentId) as Array<{ group_id: string }>;
    const changedIds: string[] = [];
    const follow = this.raw.transaction(() => {
      for (const row of groupRows) {
        const current = this.get(row.group_id);
        if (!current) continue;
        const stableIdForVersion = this.raw.prepare(
          'SELECT agent_id FROM agent_version WHERE id = ?',
        );
        const seenAgentIds = new Set<string>();
        const members: Array<{ agentVersionId: AgentVersionId; responsibility: string }> = [];
        let changed = false;
        for (const member of current.members) {
          const memberAgentId = (
            stableIdForVersion.get(member.agentVersionId) as { agent_id: string } | undefined
          )?.agent_id;
          if (memberAgentId && seenAgentIds.has(memberAgentId)) {
            changed = true;
            continue;
          }
          if (memberAgentId) seenAgentIds.add(memberAgentId);
          const nextVersionId =
            memberAgentId === stableAgentId ? latestVersionId : member.agentVersionId;
          if (nextVersionId !== member.agentVersionId) changed = true;
          members.push({ agentVersionId: nextVersionId, responsibility: member.responsibility });
        }
        const leadAgentId = (
          stableIdForVersion.get(current.leadAgentVersionId) as { agent_id: string } | undefined
        )?.agent_id;
        const leadAgentVersionId =
          leadAgentId === stableAgentId ? latestVersionId : current.leadAgentVersionId;
        if (leadAgentVersionId !== current.leadAgentVersionId) changed = true;
        if (!changed) continue;

        this.replaceMembers(current.id, members, now);
        this.raw
          .prepare(
            `UPDATE agent_group
             SET lead_agent_version_id = ?, version = version + 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(leadAgentVersionId, now, current.id);
        changedIds.push(String(current.id));
      }
    });
    follow.immediate();
    return changedIds.flatMap((groupId) => {
      const group = this.get(groupId);
      return group ? [group] : [];
    });
  }

  private mapGroup(row: GroupRow): GroupDefinition {
    const memberRows = this.raw
      .prepare(
        `SELECT agent_version_id, responsibility, sort_order, created_at
         FROM agent_group_member
         WHERE group_id = ?
         ORDER BY sort_order ASC, agent_version_id ASC`,
      )
      .all(row.id) as GroupMemberRow[];
    const members: GroupMember[] = memberRows.map((member) => ({
      agentVersionId: member.agent_version_id as AgentVersionId,
      responsibility: member.responsibility,
      sortOrder: member.sort_order,
      createdAt: member.created_at,
    }));
    if (!members.some((member) => member.agentVersionId === row.lead_agent_version_id)) {
      throw new Error(`Stored group lead is not a member: ${row.id}`);
    }
    return {
      id: row.id as GroupId,
      name: row.name,
      description: row.description,
      kind: normalizeKind(row.kind),
      visualIdentity: parseVisualIdentity(row.visual_identity_json),
      leadAgentVersionId: row.lead_agent_version_id as AgentVersionId,
      approvalMode: normalizeApprovalMode(row.approval_mode),
      collaborationMode: normalizeCollaborationMode(row.collaboration_mode),
      maxConcurrency: normalizeConcurrency(row.max_concurrency),
      version: row.version,
      members,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private assertAgentVersionsExist(agentVersionIds: readonly AgentVersionId[]): void {
    const get = this.raw.prepare('SELECT id FROM agent_version WHERE id = ?');
    for (const agentVersionId of agentVersionIds) {
      if (!get.get(agentVersionId)) throw new Error(`AgentVersion not found: ${agentVersionId}`);
    }
  }

  private replaceMembers(
    groupId: GroupId,
    members: readonly { agentVersionId: AgentVersionId; responsibility: string }[],
    now: string,
  ): void {
    this.raw.prepare('DELETE FROM agent_group_member WHERE group_id = ?').run(groupId);
    const insert = this.raw.prepare(
      `INSERT INTO agent_group_member (
        group_id, agent_version_id, responsibility, sort_order, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    );
    members.forEach((member, index) => {
      insert.run(groupId, member.agentVersionId, member.responsibility, index, now);
    });
  }
}
