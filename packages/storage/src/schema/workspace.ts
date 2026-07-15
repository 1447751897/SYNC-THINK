import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { idColumn, tsColumns } from './ids.js';

export const workspace = sqliteTable('workspace', {
  id: idColumn('id'),
  folderPath: text('folder_path').notNull(),
  name: text('name').notNull(),
  policyId: text('policy_id'),
  uiPrefsJson: text('ui_prefs_json'),
  ...tsColumns(),
});
export type WorkspaceRow = typeof workspace.$inferSelect;
