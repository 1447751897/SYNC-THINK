import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { idColumn, tsColumns } from './ids.js';

/**
 * Conversations as first-class citizens (2026-07-22 decision).
 *
 * A conversation is the user-facing chat unit shown in「最近对话」. It carries
 * its own track (model-direct / agent / team) and target, replacing the old
 * "everything hangs off a task" projection. Tasks/runs attach to a
 * conversation, not the other way around.
 *
 * Pinning lives here (DB truth, cross-device) — replaces the local UI-pref
 * pinning shipped as an interim measure.
 */
export const conversation = sqliteTable(
  'conversation',
  {
    id: idColumn('id'),
    /** 'model' | 'agent' | 'team' — which sidebar group this belongs to. */
    track: text('track').notNull(),
    /** modelId / agentId / teamId matching the track. */
    targetRef: text('target_ref').notNull(),
    /** Project (= workspace) this conversation happened in; null = 未归类. */
    workspaceId: text('workspace_id'),
    title: text('title').notNull().default(''),
    pinnedAt: text('pinned_at'),
    archivedAt: text('archived_at'),
    /** Permission mode chosen on this conversation's Compose (the ONLY permission knob). */
    executionMode: text('execution_mode').notNull().default('workspace'),
    /**
     * Interaction work mode: 'execute' (default) | 'plan'. Independent of the
     * executionMode permission knob.
     */
    interactionMode: text('interaction_mode').notNull().default('execute'),
    /**
     * Lazily-bound task backing this conversation's message thread. Null until
     * the first message creates a task (P1.1). One task per conversation.
     */
    taskId: text('task_id'),
    lastMessageAt: text('last_message_at'),
    ...tsColumns(),
  },
  (t) => ({
    trackCheck: check('conversation_track_check', sql`${t.track} IN ('model','agent','team')`),
    byWorkspace: index('conversation_workspace_idx').on(t.workspaceId),
    byTrackRecency: index('conversation_track_recency_idx').on(t.track, t.lastMessageAt),
    byTarget: index('conversation_target_idx').on(t.targetRef),
  }),
);
export type ConversationRow = typeof conversation.$inferSelect;

/**
 * Conversation-level plan (chat planning mode). One active plan per
 * conversation; revisions accumulate in conversation_plan_revision. The plan is
 * a model-submitted, human-approved execution outline — distinct from the
 * multi-agent orchestration `plan` (orchestration.ts).
 */
export const conversationPlan = sqliteTable(
  'conversation_plan',
  {
    id: idColumn('id'),
    /** One plan per conversation. */
    conversationId: text('conversation_id').notNull().unique(),
    currentRevision: integer('current_revision').notNull().default(0),
    /** 'draft' | 'approved' | 'cancelled'. */
    state: text('state').notNull().default('draft'),
    ...tsColumns(),
  },
  (t) => ({
    stateCheck: check(
      'conversation_plan_state_check',
      sql`${t.state} IN ('draft','approved','cancelled')`,
    ),
  }),
);

export const conversationPlanRevision = sqliteTable(
  'conversation_plan_revision',
  {
    id: idColumn('id'),
    planId: text('plan_id').notNull(),
    revision: integer('revision').notNull(),
    /** ChatPlanSubmission JSON. */
    planJson: text('plan_json').notNull().default('{}'),
    /** 'draft' | 'approved' | 'cancelled'. */
    state: text('state').notNull().default('draft'),
    approvedAt: text('approved_at'),
    ...tsColumns(),
  },
  (t) => ({
    byPlan: index('conversation_plan_revision_plan_idx').on(t.planId),
    uniqueRevision: uniqueIndex('conversation_plan_revision_uidx').on(t.planId, t.revision),
    stateCheck: check(
      'conversation_plan_revision_state_check',
      sql`${t.state} IN ('draft','approved','cancelled')`,
    ),
  }),
);

export type ConversationPlanRow = typeof conversationPlan.$inferSelect;
export type ConversationPlanRevisionRow = typeof conversationPlanRevision.$inferSelect;
