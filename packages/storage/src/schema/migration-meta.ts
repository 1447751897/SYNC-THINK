import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Tracks applied migrations + migration backups (§20 / §6).
export const migrationRecord = sqliteTable('migration_record', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  appliedAt: text('applied_at').notNull(),
});
export type MigrationRecordRow = typeof migrationRecord.$inferSelect;
