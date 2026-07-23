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
import { idColumn, tsColumns } from './ids.js';

/**
 * Global teams — MUTABLE model (2026-07-22 decision).
 *
 * Teams are first-class global assets (no workspace_id). Editing a team is a
 * plain UPDATE: no version chain, no revision tables, no active pointer. The
 * only history kept is a roster snapshot taken when a team RUN starts
 * (team_run.roster_snapshot_json), so an in-flight run keeps the lineup it
 * started with and finished runs stay explainable after later edits.
 *
 * Members reference the mutable agent identity (agent.id), not a pinned
 * version — editing an Agent immediately applies to every team it belongs to.
 *
 * Members carry NO permission/approval columns: the permission mode lives only
 * on the conversation Compose (ask / workspace / full-access). Agents and team
 * members configure capability, never a second permission door.
 */

// ─── global team ────────────────────────────────────────────────────────────
export const team = sqliteTable('team', {
  id: idColumn('id'),
  name: text('name').notNull(),
  avatar: text('avatar').notNull().default(''),
  /** Team mission / global instructions handed to the coordinator. */
  mission: text('mission').notNull().default(''),
  strategy: text('strategy').notNull().default('serial'),
  /** Optional PM-style member that may approve breakdown cards (never bypasses permission mode). */
  coordinatorAgentId: text('coordinator_agent_id'),
  ...tsColumns(),
}, (t) => ({
  strategyCheck: check('team_strategy_check', sql`${t.strategy} IN ('serial','parallel')`),
}));
export type TeamRow = typeof team.$inferSelect;

// ─── team roster ────────────────────────────────────────────────────────────
export const teamMember = sqliteTable(
  'team_member',
  {
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    /** Mutable agent identity — latest agent definition always applies. */
    agentId: text('agent_id').notNull(),
    memberOrder: integer('member_order').notNull(),
    role: text('role').notNull().default('member'),
    /** This member's assignment within THIS team, e.g. 「改前端代码」. */
    title: text('title').notNull().default(''),
    dependsOnJson: text('depends_on_json').notNull().default('[]'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.agentId] }),
    byTeamOrder: uniqueIndex('team_member_team_order_uidx').on(t.teamId, t.memberOrder),
    byAgent: index('team_member_agent_idx').on(t.agentId),
    orderCheck: check('team_member_order_check', sql`${t.memberOrder} >= 0`),
  }),
);
export type TeamMemberRow = typeof teamMember.$inferSelect;

// ─── team run (execution instance; owns the roster snapshot) ────────────────
export const teamRun = sqliteTable(
  'team_run',
  {
    id: idColumn('id'),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'restrict' }),
    conversationId: text('conversation_id').notNull(),
    status: text('status').notNull().default('running'),
    /**
     * Frozen copy of team + roster at start time ({ name, mission, strategy,
     * coordinatorAgentId, members:[...] }). An in-flight run never re-reads the
     * mutable team; edits only affect the NEXT run.
     */
    rosterSnapshotJson: text('roster_snapshot_json').notNull(),
    ...tsColumns(),
  },
  (t) => ({
    byTeam: index('team_run_team_idx').on(t.teamId),
    byConversation: index('team_run_conversation_idx').on(t.conversationId),
    statusCheck: check(
      'team_run_status_check',
      sql`${t.status} IN ('running','completed','failed','cancelled')`,
    ),
    snapshotJsonCheck: check('team_run_snapshot_json_check', sql`json_valid(${t.rosterSnapshotJson})`),
  }),
);
export type TeamRunRow = typeof teamRun.$inferSelect;
