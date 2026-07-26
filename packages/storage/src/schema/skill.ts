import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { idColumn } from './ids.js';

// SkillVersion — immutable normalized Skill Manifest (§9.2 / §11 SkillVersion).
// Installing a skill does not grant every Agent access; Agents use explicit allowlists.
export const skillVersion = sqliteTable(
  'skill_version',
  {
    id: idColumn('id'),
    /** Stable skill family id (same name across versions shares skillId). */
    skillId: text('skill_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    version: text('version').notNull(),
    /** Source text of the imported SKILL.md (no script execution). */
    sourceMd: text('source_md').notNull(),
    body: text('body').notNull(),
    allowedToolsJson: text('allowed_tools_json').notNull().default('[]'),
    contentFingerprint: text('content_fingerprint').notNull(),
    hasScripts: integer('has_scripts', { mode: 'boolean' }).notNull().default(false),
    warningsJson: text('warnings_json').notNull().default('[]'),
    /** Reversible uninstall marker. Archived versions stay for audit/history. */
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    bySkill: index('skill_version_skill_idx').on(t.skillId),
    byName: index('skill_version_name_idx').on(t.name),
    byFingerprint: index('skill_version_fp_idx').on(t.contentFingerprint),
  }),
);
export type SkillVersionRow = typeof skillVersion.$inferSelect;
