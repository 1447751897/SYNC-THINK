import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { idColumn, tsColumns } from './ids.js';

export const workspace = sqliteTable('workspace', {
  id: idColumn('id'),
  folderPath: text('folder_path'),
  name: text('name').notNull(),
  policyId: text('policy_id'),
  uiPrefsJson: text('ui_prefs_json'),
  /** Project default Codex three-mode for new root tasks. */
  defaultExecutionMode: text('default_execution_mode').notNull().default('workspace'),
  ...tsColumns(),
});
export type WorkspaceRow = typeof workspace.$inferSelect;