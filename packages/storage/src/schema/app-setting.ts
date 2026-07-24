import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 0026: generic app-level KV settings (JSON values).
 * Known keys: 'vision-fallback' → {enabled, modelId}; 'plan-act' → {enabled, planModelId, actModelId}.
 */
export const appSetting = sqliteTable('app_setting', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export type AppSettingRow = typeof appSetting.$inferSelect;
