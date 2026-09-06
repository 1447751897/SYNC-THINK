import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { idColumn } from './ids.js';

// Append-only execution fact and audit log. Reconstructs Run state with
// checkpoint table on restart (§20 rules 1-7). Sequence is monotonic per
// workspace so subscribers can backpressure via cursor.
export const event = sqliteTable(
  'event',
  {
    id: idColumn('id'),
    workspaceId: text('workspace_id').notNull(),
    taskId: text('task_id'),
    runId: text('run_id'),
    stepId: text('step_id'),
    messageId: text('message_id'),
    category: text('category').notNull(),
    type: text('type').notNull(),
    sequence: integer('sequence').notNull(),
    occurredAt: text('occurred_at').notNull(),
    payloadJson: text('payload_json').notNull(),
  },
  (t) => ({
    byWorkspaceSeq: index('event_ws_seq_idx').on(t.workspaceId, t.sequence),
    byRun: index('event_run_idx').on(t.runId),
    byRunCursor: index('event_run_cursor_idx').on(t.runId, t.sequence, t.id),
    byConversationStart: index('event_conversation_start_idx')
      .on(
        t.workspaceId,
        sql`COALESCE(json_extract(${t.payloadJson}, '$.threadId'), json_extract(${t.payloadJson}, '$.run.threadId'))`,
        t.runId,
      )
      .where(sql`${t.type} = 'run.started'`),
    byTask: index('event_task_idx').on(t.taskId),
    byTaskCursor: index('event_task_cursor_idx').on(t.taskId, t.sequence, t.id),
    byToolApprovalThread: index('event_tool_approval_thread_idx')
      .on(sql`json_extract(${t.payloadJson}, '$.threadId')`, t.sequence, t.id)
      .where(sql`${t.type} IN ('tool.approval_requested', 'tool.approval_decided')`),
    byToolApprovalId: index('event_tool_approval_id_idx')
      .on(sql`COALESCE(json_extract(${t.payloadJson}, '$.approvalId'), ${t.id})`, t.sequence, t.id)
      .where(sql`${t.type} IN ('tool.approval_requested', 'tool.approval_decided')`),
  }),
);
export type EventRow = typeof event.$inferSelect;
