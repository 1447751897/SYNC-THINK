import type { BetterSQLite3Raw } from './connection.js';
import { ulid } from '@sync-think/shared';
import type { SkillId, SkillVersionId } from '@sync-think/shared';

export interface SkillVersionRecord {
  id: SkillVersionId;
  skillId: SkillId;
  name: string;
  description: string;
  version: string;
  sourceMd: string;
  body: string;
  allowedTools: string[];
  contentFingerprint: string;
  hasScripts: boolean;
  warnings: string[];
  createdAt: string;
}

export interface ImportSkillVersionInput {
  name: string;
  description: string;
  version: string;
  sourceMd: string;
  body: string;
  allowedTools?: readonly string[];
  contentFingerprint: string;
  hasScripts?: boolean;
  warnings?: readonly string[];
  /** When re-importing a known family, keep skillId stable. */
  skillId?: SkillId;
  id?: SkillVersionId;
  now?: string;
}

interface SkillVersionRow {
  id: string;
  skill_id: string;
  name: string;
  description: string;
  version: string;
  source_md: string;
  body: string;
  allowed_tools_json: string;
  content_fingerprint: string;
  has_scripts: number;
  warnings_json: string;
  created_at: string;
}

function parseJsonArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  } catch {
    return [];
  }
}

function mapRow(row: SkillVersionRow): SkillVersionRecord {
  return {
    id: row.id as SkillVersionId,
    skillId: row.skill_id as SkillId,
    name: row.name,
    description: row.description,
    version: row.version,
    sourceMd: row.source_md,
    body: row.body,
    allowedTools: parseJsonArray(row.allowed_tools_json),
    contentFingerprint: row.content_fingerprint,
    hasScripts: row.has_scripts === 1,
    warnings: parseJsonArray(row.warnings_json),
    createdAt: row.created_at,
  };
}

function slugSkillId(name: string): SkillId {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return (`skill-${slug || 'unnamed'}`) as SkillId;
}

/**
 * SQLite-backed Skill library. Import is parse-only at the store boundary —
 * callers must never execute scripts from sourceMd/body (§9.2).
 */
export class SqliteSkillStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  getVersion(id: SkillVersionId | string): SkillVersionRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, skill_id, name, description, version, source_md, body,
                allowed_tools_json, content_fingerprint, has_scripts, warnings_json, created_at
         FROM skill_version WHERE id = ?`,
      )
      .get(String(id)) as SkillVersionRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  findByFingerprint(fingerprint: string): SkillVersionRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, skill_id, name, description, version, source_md, body,
                allowed_tools_json, content_fingerprint, has_scripts, warnings_json, created_at
         FROM skill_version WHERE content_fingerprint = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(String(fingerprint)) as SkillVersionRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  /**
   * Latest version for a skill name (created_at DESC), optionally excluding a fingerprint.
   * Used for permission diffs when importing a new version of the same skill.
   */
  findLatestByName(name: string, options?: { excludeFingerprint?: string }): SkillVersionRecord | undefined {
    const n = String(name ?? '').trim();
    if (!n) return undefined;
    const exclude = options?.excludeFingerprint ? String(options.excludeFingerprint) : '';
    if (exclude) {
      const row = this.raw
        .prepare(
          `SELECT id, skill_id, name, description, version, source_md, body,
                  allowed_tools_json, content_fingerprint, has_scripts, warnings_json, created_at
           FROM skill_version
           WHERE name = ? AND content_fingerprint != ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(n, exclude) as SkillVersionRow | undefined;
      return row ? mapRow(row) : undefined;
    }
    const row = this.raw
      .prepare(
        `SELECT id, skill_id, name, description, version, source_md, body,
                allowed_tools_json, content_fingerprint, has_scripts, warnings_json, created_at
         FROM skill_version
         WHERE name = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(n) as SkillVersionRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  listVersions(limit = 100): SkillVersionRecord[] {
    const rows = this.raw
      .prepare(
        `SELECT id, skill_id, name, description, version, source_md, body,
                allowed_tools_json, content_fingerprint, has_scripts, warnings_json, created_at
         FROM skill_version
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.min(500, limit))) as SkillVersionRow[];
    return rows.map(mapRow);
  }

  /**
   * Import a normalized Skill Manifest version.
   * Content-addressed: identical fingerprint returns the existing row (idempotent).
   */
  importVersion(input: ImportSkillVersionInput): SkillVersionRecord {
    const name = String(input.name ?? '').trim();
    if (!name) throw new Error('skill name must not be empty');
    const fingerprint = String(input.contentFingerprint ?? '').trim();
    if (!fingerprint) throw new Error('contentFingerprint must not be empty');

    const existing = this.findByFingerprint(fingerprint);
    if (existing) return existing;

    const sameName = this.raw
      .prepare(
        `SELECT skill_id FROM skill_version WHERE name = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(name) as { skill_id: string } | undefined;

    const skillId =
      (input.skillId as string | undefined)?.trim() ||
      sameName?.skill_id ||
      slugSkillId(name);
    const id = (input.id ?? ulid()) as SkillVersionId;
    const now = input.now ?? new Date().toISOString();
    const version = String(input.version ?? '0.0.0').trim() || '0.0.0';
    const description = String(input.description ?? name).trim() || name;
    const allowedTools = [...(input.allowedTools ?? [])].map((t) => t.trim()).filter(Boolean);
    const warnings = [...(input.warnings ?? [])].map((w) => w.trim()).filter(Boolean);
    const hasScripts = input.hasScripts ? 1 : 0;

    this.raw
      .prepare(
        `INSERT INTO skill_version (
           id, skill_id, name, description, version, source_md, body,
           allowed_tools_json, content_fingerprint, has_scripts, warnings_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        skillId,
        name,
        description,
        version,
        String(input.sourceMd ?? ''),
        String(input.body ?? ''),
        JSON.stringify(allowedTools),
        fingerprint,
        hasScripts,
        JSON.stringify(warnings),
        now,
      );

    const created = this.getVersion(id);
    if (!created) throw new Error('Failed to import skill version');
    return created;
  }
}
