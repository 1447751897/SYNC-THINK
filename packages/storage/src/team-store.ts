import type { AgentId, ConversationId, TeamId } from '@sync-think/shared';
import { ulid } from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

/**
 * Mutable global Team store (2026-07-22 model). Editing a team is a plain
 * UPDATE. The ONLY history kept is the roster snapshot frozen into team_run
 * when a run starts: an in-flight run keeps the lineup it started with, and a
 * finished run stays explainable after later edits. Edits affect the NEXT run.
 *
 * Members carry NO permission columns — permission is the conversation-level
 * three-mode knob only.
 */

export type TeamStrategy = 'serial' | 'parallel';
export type TeamRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface TeamMemberRecord {
  agentId: AgentId;
  memberOrder: number;
  role: string;
  title: string;
  dependsOn: AgentId[];
}

export interface TeamRecord {
  id: TeamId;
  name: string;
  avatar: string;
  mission: string;
  strategy: TeamStrategy;
  coordinatorAgentId?: AgentId;
  members: TeamMemberRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface TeamMemberInput {
  agentId: AgentId;
  role?: string;
  title?: string;
  dependsOn?: AgentId[];
}

export interface CreateTeamInput {
  name: string;
  avatar?: string;
  mission?: string;
  strategy?: TeamStrategy;
  coordinatorAgentId?: AgentId;
  members?: TeamMemberInput[];
  id?: TeamId;
  now?: string;
}

export interface UpdateTeamInput {
  teamId: TeamId;
  name?: string;
  avatar?: string;
  mission?: string;
  strategy?: TeamStrategy;
  coordinatorAgentId?: AgentId | null;
  /** Full replacement roster; omit to keep the current roster untouched. */
  members?: TeamMemberInput[];
  now?: string;
}

export interface TeamRunRecord {
  id: string;
  teamId: TeamId;
  conversationId: ConversationId;
  status: TeamRunStatus;
  /** Frozen team + roster at start time. */
  rosterSnapshot: TeamRosterSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface TeamRosterSnapshot {
  name: string;
  mission: string;
  strategy: TeamStrategy;
  coordinatorAgentId?: AgentId;
  members: TeamMemberRecord[];
}

interface TeamDbRow {
  id: string;
  name: string;
  avatar: string;
  mission: string;
  strategy: string;
  coordinator_agent_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TeamMemberDbRow {
  team_id: string;
  agent_id: string;
  member_order: number;
  role: string;
  title: string;
  depends_on_json: string;
}

interface TeamRunDbRow {
  id: string;
  team_id: string;
  conversation_id: string;
  status: string;
  roster_snapshot_json: string;
  created_at: string;
  updated_at: string;
}

function parseDependsOn(raw: string): AgentId[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value)
      ? (value.filter((v): v is string => typeof v === 'string') as AgentId[])
      : [];
  } catch {
    return [];
  }
}

function mapMember(row: TeamMemberDbRow): TeamMemberRecord {
  return {
    agentId: row.agent_id as AgentId,
    memberOrder: row.member_order,
    role: row.role,
    title: row.title,
    dependsOn: parseDependsOn(row.depends_on_json),
  };
}

function validateMembers(members: TeamMemberInput[]): void {
  const ids = new Set<string>();
  for (const m of members) {
    if (ids.has(m.agentId)) throw new Error(`duplicate team member: ${m.agentId}`);
    ids.add(m.agentId);
  }
  for (const m of members) {
    for (const dep of m.dependsOn ?? []) {
      if (!ids.has(dep)) throw new Error(`member ${m.agentId} depends on non-member ${dep}`);
      if (dep === m.agentId) throw new Error(`member ${m.agentId} depends on itself`);
    }
  }
}

export class SqliteTeamStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  create(input: CreateTeamInput): TeamRecord {
    const name = input.name.trim();
    if (!name) throw new Error('team name must not be empty');
    const members = input.members ?? [];
    validateMembers(members);
    this.assertAgentsExist(members.map((m) => m.agentId));
    if (input.coordinatorAgentId && !members.some((m) => m.agentId === input.coordinatorAgentId)) {
      throw new Error('coordinatorAgentId must be a team member');
    }
    const now = input.now ?? new Date().toISOString();
    const id = (input.id ?? (`team-${ulid()}` as TeamId)) as TeamId;
    const insert = this.raw.transaction(() => {
      this.raw
        .prepare(
          `INSERT INTO team (id, name, avatar, mission, strategy, coordinator_agent_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          name,
          input.avatar ?? '',
          input.mission ?? '',
          input.strategy ?? 'serial',
          input.coordinatorAgentId ?? null,
          now,
          now,
        );
      this.insertMembers(id, members, now);
    });
    insert();
    const created = this.get(id);
    if (!created) throw new Error('team insert failed');
    return created;
  }

  get(teamId: TeamId | string): TeamRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, name, avatar, mission, strategy, coordinator_agent_id, created_at, updated_at
         FROM team WHERE id = ?`,
      )
      .get(teamId) as TeamDbRow | undefined;
    if (!row) return undefined;
    const memberRows = this.raw
      .prepare(
        `SELECT team_id, agent_id, member_order, role, title, depends_on_json
         FROM team_member WHERE team_id = ? ORDER BY member_order`,
      )
      .all(teamId) as TeamMemberDbRow[];
    return {
      id: row.id as TeamId,
      name: row.name,
      avatar: row.avatar,
      mission: row.mission,
      strategy: row.strategy as TeamStrategy,
      coordinatorAgentId: row.coordinator_agent_id
        ? (row.coordinator_agent_id as AgentId)
        : undefined,
      members: memberRows.map(mapMember),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  list(): TeamRecord[] {
    const rows = this.raw
      .prepare('SELECT id FROM team ORDER BY name COLLATE NOCASE')
      .all() as { id: string }[];
    return rows
      .map((r) => this.get(r.id))
      .filter((t): t is TeamRecord => t !== undefined);
  }

  update(input: UpdateTeamInput): TeamRecord {
    const current = this.get(input.teamId);
    if (!current) throw new Error(`team not found: ${input.teamId}`);
    const now = input.now ?? new Date().toISOString();
    const name = input.name === undefined ? current.name : input.name.trim();
    if (!name) throw new Error('team name must not be empty');

    const nextMembers: TeamMemberInput[] =
      input.members ??
      current.members.map((m) => ({
        agentId: m.agentId,
        role: m.role,
        title: m.title,
        dependsOn: m.dependsOn,
      }));
    validateMembers(nextMembers);
    if (input.members) this.assertAgentsExist(nextMembers.map((m) => m.agentId));

    const coordinator =
      input.coordinatorAgentId === undefined
        ? (current.coordinatorAgentId ?? null)
        : input.coordinatorAgentId;
    if (coordinator && !nextMembers.some((m) => m.agentId === coordinator)) {
      throw new Error('coordinatorAgentId must be a team member');
    }

    const apply = this.raw.transaction(() => {
      this.raw
        .prepare(
          `UPDATE team SET name = ?, avatar = ?, mission = ?, strategy = ?,
             coordinator_agent_id = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          name,
          input.avatar ?? current.avatar,
          input.mission ?? current.mission,
          input.strategy ?? current.strategy,
          coordinator,
          now,
          input.teamId,
        );
      if (input.members) {
        this.raw.prepare('DELETE FROM team_member WHERE team_id = ?').run(input.teamId);
        this.insertMembers(input.teamId, nextMembers, now);
      }
    });
    apply();
    const updated = this.get(input.teamId);
    if (!updated) throw new Error('team update failed');
    return updated;
  }

  /** Hard delete; refuses while any run of this team is still running. */
  delete(teamId: TeamId): void {
    const running = this.raw
      .prepare("SELECT id FROM team_run WHERE team_id = ? AND status = 'running' LIMIT 1")
      .get(teamId) as { id: string } | undefined;
    if (running) throw new Error(`team has a running run (${running.id}); stop it first`);
    // Historical runs keep their snapshot but the FK is RESTRICT — detach them
    // is not allowed by design; a team with history must be archived by
    // convention (rename) rather than deleted. Only teams without runs delete.
    const anyRun = this.raw
      .prepare('SELECT id FROM team_run WHERE team_id = ? LIMIT 1')
      .get(teamId) as { id: string } | undefined;
    if (anyRun) throw new Error('team has historical runs; it cannot be hard-deleted');
    this.raw.prepare('DELETE FROM team WHERE id = ?').run(teamId);
  }

  /** Freeze the current team definition into a new run. */
  startRun(input: { teamId: TeamId; conversationId: ConversationId; now?: string }): TeamRunRecord {
    const teamRecord = this.get(input.teamId);
    if (!teamRecord) throw new Error(`team not found: ${input.teamId}`);
    if (teamRecord.members.length === 0) throw new Error('cannot start a run for an empty team');
    const now = input.now ?? new Date().toISOString();
    const id = `teamrun-${ulid()}`;
    const snapshot: TeamRosterSnapshot = {
      name: teamRecord.name,
      mission: teamRecord.mission,
      strategy: teamRecord.strategy,
      coordinatorAgentId: teamRecord.coordinatorAgentId,
      members: teamRecord.members,
    };
    this.raw
      .prepare(
        `INSERT INTO team_run (id, team_id, conversation_id, status, roster_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 'running', ?, ?, ?)`,
      )
      .run(id, input.teamId, input.conversationId, JSON.stringify(snapshot), now, now);
    const run = this.getRun(id);
    if (!run) throw new Error('team run insert failed');
    return run;
  }

  getRun(runId: string): TeamRunRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, team_id, conversation_id, status, roster_snapshot_json, created_at, updated_at
         FROM team_run WHERE id = ?`,
      )
      .get(runId) as TeamRunDbRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      teamId: row.team_id as TeamId,
      conversationId: row.conversation_id as ConversationId,
      status: row.status as TeamRunStatus,
      rosterSnapshot: JSON.parse(row.roster_snapshot_json) as TeamRosterSnapshot,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  setRunStatus(runId: string, status: TeamRunStatus, now?: string): TeamRunRecord {
    const result = this.raw
      .prepare('UPDATE team_run SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now ?? new Date().toISOString(), runId);
    if (result.changes === 0) throw new Error(`team run not found: ${runId}`);
    const run = this.getRun(runId);
    if (!run) throw new Error('team run update failed');
    return run;
  }

  private insertMembers(teamId: TeamId, members: TeamMemberInput[], now: string): void {
    const stmt = this.raw.prepare(
      `INSERT INTO team_member (team_id, agent_id, member_order, role, title, depends_on_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    members.forEach((m, i) => {
      stmt.run(
        teamId,
        m.agentId,
        i,
        m.role ?? 'member',
        m.title ?? '',
        JSON.stringify(m.dependsOn ?? []),
        now,
      );
    });
  }

  private assertAgentsExist(agentIds: AgentId[]): void {
    const stmt = this.raw.prepare('SELECT id FROM agent WHERE id = ? AND archived = 0');
    for (const agentId of agentIds) {
      if (!stmt.get(agentId)) throw new Error(`agent not found or archived: ${agentId}`);
    }
  }
}
