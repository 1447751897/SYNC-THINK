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
  archivedAt?: string;
  createdAt: string;
}

export type SkillVersionMetadataRecord = Omit<SkillVersionRecord, 'sourceMd' | 'body'>;

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

export interface DeleteSkillVersionResult {
  deleted: boolean;
  blockers: {
    globalAgentIds: string[];
    activeLegacyAgentVersionIds: string[];
    authorizationGrantVersionIds: string[];
    pendingApprovalIds: string[];
  };
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
  archived_at: string | null;
  created_at: string;
}

type SkillVersionMetadataRow = Omit<SkillVersionRow, 'source_md' | 'body'>;

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
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at,
  };
}

function mapMetadataRow(row: SkillVersionMetadataRow): SkillVersionMetadataRecord {
  return {
    id: row.id as SkillVersionId,
    skillId: row.skill_id as SkillId,
    name: row.name,
    description: row.description,
    version: row.version,
    allowedTools: parseJsonArray(row.allowed_tools_json),
    contentFingerprint: row.content_fingerprint,
    hasScripts: row.has_scripts === 1,
    warnings: parseJsonArray(row.warnings_json),
    archivedAt: row.archived_at ?? undefined,
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
                allowed_tools_json, content_fingerprint, has_scripts, warnings_json, archived_at, created_at
         FROM skill_version WHERE id = ?`,
      )
      .get(String(id)) as SkillVersionRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  getVersionMetadata(id: SkillVersionId | string): SkillVersionMetadataRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, skill_id, name, description, version,
                allowed_tools_json, content_fingerprint, has_scripts, warnings_json,
                archived_at, created_at
         FROM skill_version WHERE id = ?`,
      )
      .get(String(id)) as SkillVersionMetadataRow | undefined;
    return row ? mapMetadataRow(row) : undefined;
  }

  findByFingerprint(fingerprint: string): SkillVersionRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, skill_id, name, description, version, source_md, body,
                allowed_tools_json, content_fingerprint, has_scripts, warnings_json, archived_at, created_at
         FROM skill_version WHERE content_fingerprint = ? AND archived_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
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
                  allowed_tools_json, content_fingerprint, has_scripts, warnings_json, archived_at, created_at
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
                allowed_tools_json, content_fingerprint, has_scripts, warnings_json, archived_at, created_at
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
                allowed_tools_json, content_fingerprint, has_scripts, warnings_json, archived_at, created_at
         FROM skill_version
         WHERE archived_at IS NULL
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.min(500, limit))) as SkillVersionRow[];
    return rows.map(mapRow);
  }

  /** Metadata-only catalog query used by pickers; full SKILL.md stays lazy. */
  listVersionMetadata(limit = 100): SkillVersionMetadataRecord[] {
    const rows = this.raw
      .prepare(
        `SELECT id, skill_id, name, description, version,
                allowed_tools_json, content_fingerprint, has_scripts, warnings_json,
                archived_at, created_at
         FROM skill_version
         WHERE archived_at IS NULL
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.min(500, limit))) as SkillVersionMetadataRow[];
    return rows.map(mapMetadataRow);
  }

  /** Metadata-only exact lookup for small immutable Agent allowlists. */
  listVersionMetadataByIds(
    skillVersionIds: readonly (SkillVersionId | string)[],
  ): SkillVersionMetadataRecord[] {
    const orderedIds: string[] = [];
    const seen = new Set<string>();
    for (const raw of skillVersionIds) {
      const id = String(raw ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      orderedIds.push(id);
      if (orderedIds.length === 500) break;
    }
    if (orderedIds.length === 0) return [];
    const placeholders = orderedIds.map(() => '?').join(', ');
    const rows = this.raw
      .prepare(
        `SELECT id, skill_id, name, description, version,
                allowed_tools_json, content_fingerprint, has_scripts, warnings_json,
                archived_at, created_at
         FROM skill_version
         WHERE archived_at IS NULL AND id IN (${placeholders})`,
      )
      .all(...orderedIds) as SkillVersionMetadataRow[];
    const byId = new Map(rows.map((row) => [row.id, mapMetadataRow(row)] as const));
    return orderedIds
      .map((id) => byId.get(id))
      .filter((row): row is SkillVersionMetadataRecord => Boolean(row));
  }

  hasPendingPermissionApproval(skillVersionId: SkillVersionId | string): boolean {
    const id = String(skillVersionId ?? '').trim();
    if (!id) return false;
    const row = this.raw
      .prepare(
        `SELECT id FROM approval_request
         WHERE state = 'pending'
           AND kind = 'skill-permission'
           AND json_extract(metadata_json, '$.skillVersionId') = ?
         LIMIT 1`,
      )
      .get(id) as { id: string } | undefined;
    return Boolean(row);
  }

  isPermissionApproved(skillVersionId: SkillVersionId | string): boolean {
    const id = String(skillVersionId ?? '').trim();
    if (!id) return false;
    const rows = this.raw
      .prepare(
        `SELECT state FROM approval_request
         WHERE kind = 'skill-permission'
           AND json_extract(metadata_json, '$.skillVersionId') = ?
         ORDER BY created_at DESC`,
      )
      .all(id) as Array<{ state: string }>;
    return rows.length === 0 || rows[0]?.state === 'approved';
  }

  /**
   * Remove an exact immutable version only when nothing still references it.
   * Agent allowlists are JSON columns without foreign keys, so the mutable
   * global Agent source of truth must be checked explicitly before DELETE.
   * Historical legacy Agent versions are intentionally retained as audit
   * snapshots and do not keep a Skill installed after the active binding is
   * removed. Authorization grants and pending permission approvals remain
   * live references and therefore block deletion.
   */
  deleteVersion(id: SkillVersionId | string): DeleteSkillVersionResult {
    const skillVersionId = String(id ?? '').trim();
    const empty = {
      globalAgentIds: [] as string[],
      activeLegacyAgentVersionIds: [] as string[],
      authorizationGrantVersionIds: [] as string[],
      pendingApprovalIds: [] as string[],
    };
    if (!skillVersionId || !this.getVersion(skillVersionId) || this.getVersion(skillVersionId)?.archivedAt) {
      return { deleted: false, blockers: empty };
    }

    const containsId = (raw: unknown): boolean => {
      if (typeof raw !== 'string') return false;
      return parseJsonArray(raw).includes(skillVersionId);
    };
    const globalAgentIds = (
      this.raw.prepare(`SELECT id, skill_ids_json FROM agent`).all() as Array<{
        id: string;
        skill_ids_json: string;
      }>
    )
      .filter((row) => containsId(row.skill_ids_json))
      .map((row) => row.id);
    const activeLegacyAgentVersionIds = (
      this.raw
        .prepare(
          `SELECT av.id, av.skill_version_ids_json
           FROM agent_version av
           WHERE av.version = (
             SELECT MAX(latest.version)
             FROM agent_version latest
             WHERE latest.agent_id = av.agent_id
           )`,
        )
        .all() as Array<{ id: string; skill_version_ids_json: string }>
    )
      .filter((row) => containsId(row.skill_version_ids_json))
      .map((row) => row.id);
    const authorizationGrantVersionIds = (
      this.raw
        .prepare(
          `SELECT id FROM authorization_grant_version WHERE skill_version_id = ? ORDER BY created_at DESC`,
        )
        .all(skillVersionId) as Array<{ id: string }>
    ).map((row) => row.id);
    const pendingApprovalIds = (
      this.raw
        .prepare(
          `SELECT id FROM approval_request
           WHERE state = 'pending'
             AND kind = 'skill-permission'
             AND json_extract(metadata_json, '$.skillVersionId') = ?
           ORDER BY created_at DESC`,
        )
        .all(skillVersionId) as Array<{ id: string }>
    ).map((row) => row.id);
    const blockers = {
      globalAgentIds,
      activeLegacyAgentVersionIds,
      authorizationGrantVersionIds,
      pendingApprovalIds,
    };
    if (
      globalAgentIds.length > 0 ||
      activeLegacyAgentVersionIds.length > 0 ||
      authorizationGrantVersionIds.length > 0 ||
      pendingApprovalIds.length > 0
    ) {
      return { deleted: false, blockers };
    }

    const now = new Date().toISOString();
    const result = this.raw
      .prepare(`UPDATE skill_version SET archived_at = ? WHERE id = ? AND archived_at IS NULL`)
      .run(now, skillVersionId);
    return { deleted: result.changes > 0, blockers };
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

    const archived = this.raw
      .prepare(
        `SELECT id, skill_id, name, description, version, source_md, body,
                allowed_tools_json, content_fingerprint, has_scripts, warnings_json, archived_at, created_at
         FROM skill_version
         WHERE content_fingerprint = ? AND archived_at IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(fingerprint) as SkillVersionRow | undefined;
    if (archived) {
      this.raw.prepare(`UPDATE skill_version SET archived_at = NULL WHERE id = ?`).run(archived.id);
      return { ...mapRow(archived), archivedAt: undefined };
    }

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
