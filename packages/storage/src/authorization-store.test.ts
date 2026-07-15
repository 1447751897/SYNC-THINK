import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AgentVersionId,
  McpServerId,
  SkillVersionId,
} from '@sync-think/shared';
import { openDatabaseAsync, type BetterSQLite3Raw } from './connection.js';
import {
  SqliteAuthorizationStore,
  type AuthorizationScopeRef,
} from './authorization-store.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];
const agentVersionId = 'agent-version-authorization' as AgentVersionId;
const otherAgentVersionId = 'agent-version-authorization-other' as AgentVersionId;
const skillVersionId = 'skill-version-authorization' as SkillVersionId;
const serverId = 'mcp-authorization' as McpServerId;
const otherServerId = 'mcp-authorization-other' as McpServerId;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-authorization-store-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

function installAuthorizationSchemaForStoreTest(raw: BetterSQLite3Raw): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS authorization_grant_version (
      id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'workspace', 'project', 'task', 'run')),
      scope_id TEXT NOT NULL,
      agent_version_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK (target_type IN ('skill', 'mcp')),
      skill_version_id TEXT,
      mcp_server_id TEXT,
      tools_json TEXT,
      revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
      created_at TEXT NOT NULL,
      CONSTRAINT authorization_grant_target_check CHECK (
        (target_type = 'skill' AND skill_version_id IS NOT NULL AND mcp_server_id IS NULL AND tools_json IS NULL)
        OR (target_type = 'mcp' AND skill_version_id IS NULL AND mcp_server_id IS NOT NULL)
      ),
      FOREIGN KEY (agent_version_id) REFERENCES agent_version(id) ON DELETE RESTRICT,
      FOREIGN KEY (skill_version_id) REFERENCES skill_version(id) ON DELETE RESTRICT,
      FOREIGN KEY (mcp_server_id) REFERENCES mcp_server(id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS authorization_grant_version_uidx
      ON authorization_grant_version(grant_id, version);
    CREATE INDEX IF NOT EXISTS authorization_grant_scope_idx
      ON authorization_grant_version(scope_type, scope_id);
    CREATE INDEX IF NOT EXISTS authorization_grant_agent_idx
      ON authorization_grant_version(agent_version_id);
  `);
}

function seedExactTargets(raw: BetterSQLite3Raw): void {
  const insertAgent = raw.prepare(
    `INSERT INTO agent_version (
       id, agent_id, version, name, role, developer_instructions, input_contract,
       output_contract, default_model_id, default_credential_group_id,
       pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
       memory_scope, skill_version_ids_json, mcp_server_ids_json, policy_id,
       approval_mode, created_at
     ) VALUES (?, ?, 1, ?, 'worker', '', '', '', ?, ?, NULL, 1, '[]', 'task',
       '[]', '[]', NULL, 'request', 't0')`,
  );
  insertAgent.run(
    agentVersionId,
    'agent-authorization',
    'Authorization Agent',
    'model-authorization',
    'group-authorization',
  );
  insertAgent.run(
    otherAgentVersionId,
    'agent-authorization-other',
    'Other Agent',
    'model-authorization',
    'group-authorization',
  );
  raw.prepare(
    `INSERT INTO skill_version (
       id, skill_id, name, description, version, source_md, body,
       allowed_tools_json, content_fingerprint, has_scripts, warnings_json, created_at
     ) VALUES (?, 'skill-authorization', 'authorization-skill', '', '1.0.0', '', '',
       '[]', 'authorization-fingerprint', 0, '[]', 't0')`,
  ).run(skillVersionId);
  const insertServer = raw.prepare(
    `INSERT INTO mcp_server (
       id, name, transport, endpoint, tools_json, trusted, max_output_bytes,
       timeout_ms, notes, created_at, updated_at
     ) VALUES (?, ?, 'local-stdio', '', '[]', 0, 65536, 15000, '', 't0', 't0')`,
  );
  insertServer.run(serverId, 'Authorization MCP');
  insertServer.run(otherServerId, 'Other MCP');
}

async function openStore() {
  const dbPath = makeDbPath();
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  installAuthorizationSchemaForStoreTest(connection.raw);
  seedExactTargets(connection.raw);
  return {
    dbPath,
    raw: connection.raw,
    store: new SqliteAuthorizationStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

describe('authorization migration contract', () => {
  it('installs authorization_grant_version through the normal migration path', async () => {
    const dbPath = makeDbPath();
    await runMigrations(dbPath);
    const { raw } = await openDatabaseAsync({ path: dbPath });
    try {
      expect(
        raw
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get('authorization_grant_version'),
      ).toEqual({ name: 'authorization_grant_version' });
    } finally {
      raw.close();
    }
  });
});

describe('SqliteAuthorizationStore', () => {
  it('appends immutable versions while preserving exact history', async () => {
    const { store, close } = await openStore();
    try {
      const first = store.grant({
        grantId: 'grant-project-mcp',
        scope: 'project',
        scopeId: 'project-alpha',
        agentVersionId,
        target: 'mcp',
        serverId,
        tools: [' read_file ', 'read_file'],
        now: 't1',
      });
      const second = store.grant({
        grantId: first.grantId,
        scope: 'project',
        scopeId: 'project-alpha',
        agentVersionId,
        target: 'mcp',
        serverId,
        tools: ['write_file', 'read_file'],
        now: 't2',
      });

      expect(first).toMatchObject({ version: 1, tools: ['read_file'], revoked: false });
      expect(second).toMatchObject({
        version: 2,
        tools: ['read_file', 'write_file'],
        revoked: false,
      });
      expect(second.id).not.toBe(first.id);
      expect(store.getVersion(first.id)).toEqual(first);
      expect(store.listVersions(first.grantId)).toEqual([first, second]);
    } finally {
      close();
    }
  });

  it('revokes by appending one latest version and makes replay idempotent', async () => {
    const { store, close } = await openStore();
    try {
      const granted = store.grant({
        grantId: 'grant-task-skill',
        scope: 'task',
        scopeId: 'task-alpha',
        agentVersionId,
        target: 'skill',
        skillVersionId,
        now: 't1',
      });
      const revoked = store.revoke({ grantId: granted.grantId, now: 't2' });
      const replay = store.revoke({ grantId: granted.grantId, now: 't3' });

      expect(revoked).toMatchObject({ version: 2, revoked: true });
      expect(replay).toEqual(revoked);
      expect(store.listVersions(granted.grantId)).toEqual([granted, revoked]);
      expect(
        store.listApplicable([{ scope: 'task', scopeId: 'task-alpha' }]),
      ).toEqual([revoked]);
    } finally {
      close();
    }
  });

  it('returns only latest grants in validated user-to-run scope order', async () => {
    const { store, close } = await openStore();
    try {
      const scopes: AuthorizationScopeRef[] = [
        { scope: 'user', scopeId: 'user-local' },
        { scope: 'workspace', scopeId: 'workspace-alpha' },
        { scope: 'project', scopeId: 'project-alpha' },
        { scope: 'task', scopeId: 'task-alpha' },
        { scope: 'run', scopeId: 'run-alpha' },
      ];
      for (const [index, scope] of scopes.entries()) {
        store.grant({
          grantId: `grant-${scope.scope}`,
          ...scope,
          agentVersionId,
          target: 'mcp',
          serverId,
          now: `t${index}`,
        });
      }
      store.grant({
        grantId: 'grant-unrelated',
        scope: 'project',
        scopeId: 'project-other',
        agentVersionId,
        target: 'mcp',
        serverId,
        now: 't9',
      });

      expect(store.listApplicable(scopes).map((grant) => grant.scope)).toEqual([
        'user',
        'workspace',
        'project',
        'task',
        'run',
      ]);
      expect(() => store.listApplicable([scopes[2]!, scopes[1]!])).toThrow(
        'authorization.scope_chain_invalid',
      );
      expect(store.listApplicable([])).toEqual([]);
    } finally {
      close();
    }
  });

  it('rejects scope, AgentVersion, and target identity changes for one grant', async () => {
    const { store, close } = await openStore();
    try {
      const input = {
        grantId: 'grant-fixed-identity',
        scope: 'project' as const,
        scopeId: 'project-alpha',
        agentVersionId,
        target: 'mcp' as const,
        serverId,
      };
      store.grant(input);

      expect(() =>
        store.grant({ ...input, scopeId: 'project-other' }),
      ).toThrow('authorization.grant_identity_mismatch');
      expect(() =>
        store.grant({ ...input, agentVersionId: otherAgentVersionId }),
      ).toThrow('authorization.grant_identity_mismatch');
      expect(() =>
        store.grant({ ...input, serverId: otherServerId }),
      ).toThrow('authorization.grant_identity_mismatch');
      expect(() =>
        store.grant({ ...input, agentVersionId: 'missing-agent-version' as AgentVersionId }),
      ).toThrow(/AgentVersion not found/);
    } finally {
      close();
    }
  });

  it('round-trips unrestricted MCP and exact Skill targets and fails closed on bad JSON', async () => {
    const { raw, store, close } = await openStore();
    try {
      const unrestricted = store.grant({
        grantId: 'grant-run-mcp',
        scope: 'run',
        scopeId: 'run-alpha',
        agentVersionId,
        target: 'mcp',
        serverId,
      });
      const skill = store.grant({
        grantId: 'grant-run-skill',
        scope: 'run',
        scopeId: 'run-alpha',
        agentVersionId,
        target: 'skill',
        skillVersionId,
      });
      expect(unrestricted).not.toHaveProperty('tools');
      expect(skill).toMatchObject({ target: 'skill', skillVersionId });

      expect(() =>
        raw.prepare('UPDATE authorization_grant_version SET tools_json = ? WHERE id = ?').run(
          '{broken',
          unrestricted.id,
        ),
      ).toThrow('authorization grants are append-only');
      raw.exec('DROP TRIGGER authorization_grant_append_only_update');
      raw.pragma('ignore_check_constraints = ON');
      raw.prepare('UPDATE authorization_grant_version SET tools_json = ? WHERE id = ?').run(
        '{broken',
        unrestricted.id,
      );
      raw.pragma('ignore_check_constraints = OFF');
      expect(() => store.getVersion(unrestricted.id)).toThrow(
        'authorization.tools_json_invalid',
      );
    } finally {
      close();
    }
  });
});
