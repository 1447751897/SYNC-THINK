import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { SqliteCapabilityStore } from './capability-store.js';
import { SqliteMcpStore } from './mcp-store.js';
import { MIGRATIONS, runMigrations } from './scripts/migrate.js';
import { SqliteSkillStore } from './skill-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-capability-store-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

async function openStores() {
  const dbPath = makeDbPath();
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  connection.raw
    .prepare(
      `INSERT INTO workspace (id, folder_path, name, policy_id, ui_prefs_json, created_at, updated_at)
       VALUES (?, NULL, ?, NULL, NULL, ?, ?)`,
    )
    .run('workspace-alpha', 'Alpha', '2026-08-09T01:00:00.000Z', '2026-08-09T01:00:00.000Z');
  return {
    raw: connection.raw,
    capabilityStore: new SqliteCapabilityStore(connection.raw),
    skillStore: new SqliteSkillStore(connection.raw),
    mcpStore: new SqliteMcpStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

describe('SqliteCapabilityStore', () => {
  it('keeps workspace activation while global enablement temporarily blocks effective use', async () => {
    const { capabilityStore, skillStore, mcpStore, close } = await openStores();
    try {
      const skill = skillStore.importVersion({
        name: 'workspace-skill',
        description: 'Workspace gated skill',
        version: '1.0.0',
        sourceMd: '# Workspace skill',
        body: 'Workspace skill',
        contentFingerprint: 'workspace-skill-v1',
      });
      const mcp = mcpStore.register({
        name: 'workspace-mcp',
        endpoint: 'stdio://workspace-mcp',
        tools: [{ name: 'inspect', description: 'Inspect' }],
      });

      capabilityStore.setWorkspaceActivation({
        capabilityType: 'skill',
        capabilityId: skill.id,
        workspaceId: 'workspace-alpha',
        active: true,
      });
      capabilityStore.setWorkspaceActivation({
        capabilityType: 'mcp',
        capabilityId: mcp.id,
        workspaceId: 'workspace-alpha',
        active: true,
      });

      expect(
        capabilityStore.resolveEffectiveSkillVersionIds('workspace-alpha', [skill.id]),
      ).toEqual([skill.id]);
      // MCP is global: enabled alone makes it effective (workspace activation
      // is no longer consulted for MCP).
      expect(capabilityStore.resolveEffectiveMcpServerIds('workspace-alpha', [mcp.id])).toEqual([
        mcp.id,
      ]);

      skillStore.setEnabled(skill.id, false);
      mcpStore.setEnabled(mcp.id, false);
      expect(
        capabilityStore.resolveEffectiveSkillVersionIds('workspace-alpha', [skill.id]),
      ).toEqual([]);
      expect(capabilityStore.resolveEffectiveMcpServerIds('workspace-alpha', [mcp.id])).toEqual([]);

      expect(
        capabilityStore.getWorkspaceActivation('skill', skill.id, 'workspace-alpha'),
      ).toMatchObject({ active: true });
      expect(
        capabilityStore.getWorkspaceActivation('mcp', mcp.id, 'workspace-alpha'),
      ).toMatchObject({ active: true });

      skillStore.setEnabled(skill.id, true);
      mcpStore.setEnabled(mcp.id, true);
      expect(
        capabilityStore.resolveEffectiveSkillVersionIds('workspace-alpha', [skill.id]),
      ).toEqual([skill.id]);
      expect(capabilityStore.resolveEffectiveMcpServerIds('workspace-alpha', [mcp.id])).toEqual([
        mcp.id,
      ]);

      // MCP remains effective in another workspace that never activated it.
      expect(capabilityStore.resolveEffectiveMcpServerIds('workspace-beta', [mcp.id])).toEqual([
        mcp.id,
      ]);
    } finally {
      close();
    }
  });

  it('aggregates the latest 45 days across success, failure and cancellation', async () => {
    const { capabilityStore, skillStore, close } = await openStores();
    try {
      const skill = skillStore.importVersion({
        name: 'usage-skill',
        description: 'Usage tracked skill',
        version: '1.0.0',
        sourceMd: '# Usage skill',
        body: 'Usage skill',
        contentFingerprint: 'usage-skill-v1',
      });
      const append = (
        outcome: 'success' | 'failed' | 'cancelled',
        contextTokens: number,
        occurredAt: string,
      ) =>
        capabilityStore.appendUsageEvent({
          capabilityType: 'skill',
          capabilityId: skill.id,
          workspaceId: 'workspace-alpha',
          agentId: 'agent-alpha',
          agentVersionId: 'agent-version-alpha',
          runId: `run-${outcome}-${occurredAt}`,
          outcome,
          contextTokens,
          occurredAt,
        });

      append('success', 100, '2026-07-01T00:00:00.000Z');
      append('failed', 50, '2026-08-01T00:00:00.000Z');
      append('cancelled', 25, '2026-08-08T00:00:00.000Z');
      append('success', 999, '2026-06-01T00:00:00.000Z');

      expect(
        capabilityStore.summarizeUsage({
          capabilityType: 'skill',
          capabilityIds: [skill.id],
          workspaceId: 'workspace-alpha',
          now: '2026-08-09T00:00:00.000Z',
        }),
      ).toEqual([
        {
          capabilityType: 'skill',
          capabilityId: skill.id,
          callCount: 3,
          successCount: 1,
          failedCount: 1,
          cancelledCount: 1,
          problemCount: 1,
          contextTokens: 175,
          lastUsedAt: '2026-08-08T00:00:00.000Z',
        },
      ]);
    } finally {
      close();
    }
  });

  it('deduplicates usage events by a stable idempotency id', async () => {
    const { capabilityStore, skillStore, close } = await openStores();
    try {
      const skill = skillStore.importVersion({
        name: 'idempotent-usage-skill',
        description: 'Idempotent usage tracking',
        version: '1.0.0',
        sourceMd: '# Idempotent usage',
        body: 'Idempotent usage',
        contentFingerprint: 'idempotent-usage-skill-v1',
      });
      const input = {
        id: 'run-alpha:skill:context',
        capabilityType: 'skill' as const,
        capabilityId: skill.id,
        workspaceId: 'workspace-alpha',
        runId: 'run-alpha',
        outcome: 'success' as const,
        contextTokens: 120,
        occurredAt: '2026-08-09T00:00:00.000Z',
      };

      expect(capabilityStore.appendUsageEvent(input)).toEqual(
        capabilityStore.appendUsageEvent({
          ...input,
          contextTokens: 999,
          outcome: 'failed',
        }),
      );
      expect(
        capabilityStore.summarizeUsage({
          capabilityType: 'skill',
          capabilityIds: [skill.id],
          workspaceId: 'workspace-alpha',
          now: '2026-08-09T01:00:00.000Z',
        }),
      ).toMatchObject([
        {
          callCount: 1,
          successCount: 1,
          failedCount: 0,
          contextTokens: 120,
        },
      ]);
    } finally {
      close();
    }
  });

  it('creates a local derivative without overwriting its market source', async () => {
    const { skillStore, close } = await openStores();
    try {
      const market = skillStore.importVersion({
        name: 'market-skill',
        description: 'Market original',
        version: '1.0.0',
        sourceMd: '# Market original',
        body: 'Market original',
        contentFingerprint: 'market-skill-v1',
        originType: 'market',
        originRef: 'market://skills/market-skill',
      });
      const derived = skillStore.importVersion({
        name: 'market-skill-local',
        description: 'Local derivative',
        version: '1.0.1-local',
        sourceMd: '# Local derivative',
        body: 'Local derivative',
        contentFingerprint: 'market-skill-local-v1',
        originType: 'derived',
        originRef: 'market://skills/market-skill',
        derivedFromSkillVersionId: market.id,
      });

      expect(skillStore.getVersion(market.id)).toMatchObject({
        originType: 'market',
        sourceMd: '# Market original',
      });
      expect(derived).toMatchObject({
        originType: 'derived',
        originRef: 'market://skills/market-skill',
        derivedFromSkillVersionId: market.id,
      });
    } finally {
      close();
    }
  });

  it('saves an editable publish draft and reports the market channel as unavailable', async () => {
    const { capabilityStore, skillStore, close } = await openStores();
    try {
      const skill = skillStore.importVersion({
        name: 'publishable-skill',
        description: 'Publishable',
        version: '1.0.0',
        sourceMd: '# Publishable',
        body: 'Publishable',
        contentFingerprint: 'publishable-skill-v1',
      });
      const saved = capabilityStore.saveSkillPublishDraft({
        skillVersionId: skill.id,
        skillId: skill.skillId,
        displayName: '可发布 Skill',
        description: '第一版说明',
        skillMd: skill.sourceMd,
        category: '开发工具',
        version: '1.0.0',
        icon: 'sparkles',
        attachments: [{ name: 'README.md', size: 128 }],
        now: '2026-08-09T02:00:00.000Z',
      });
      const updated = capabilityStore.saveSkillPublishDraft({
        ...saved,
        description: '更新后的说明',
        now: '2026-08-09T03:00:00.000Z',
      });

      expect(capabilityStore.getSkillPublishDraft(updated.id)).toMatchObject({
        description: '更新后的说明',
        attachments: [{ name: 'README.md', size: 128 }],
        updatedAt: '2026-08-09T03:00:00.000Z',
      });
      expect(capabilityStore.submitSkillPublishDraft(updated.id)).toEqual({
        submitted: false,
        reason: 'channel-unavailable',
        message: '市场发布渠道暂未开放',
      });
    } finally {
      close();
    }
  });

  it('generates a read-only organize report without changing capability state', async () => {
    const { capabilityStore, skillStore, close } = await openStores();
    try {
      const highContext = skillStore.importVersion({
        name: 'high-context',
        description: 'High context',
        version: '1.0.0',
        sourceMd: '# High context',
        body: 'High context',
        contentFingerprint: 'high-context-v1',
      });
      const unused = skillStore.importVersion({
        name: 'unused',
        description: 'Unused',
        version: '1.0.0',
        sourceMd: '# Unused',
        body: 'Unused',
        contentFingerprint: 'unused-v1',
      });
      capabilityStore.setWorkspaceActivation({
        capabilityType: 'skill',
        capabilityId: highContext.id,
        workspaceId: 'workspace-alpha',
        active: true,
      });
      capabilityStore.appendUsageEvent({
        capabilityType: 'skill',
        capabilityId: highContext.id,
        workspaceId: 'workspace-alpha',
        outcome: 'failed',
        contextTokens: 900,
        occurredAt: '2026-08-08T00:00:00.000Z',
      });

      const report = capabilityStore.generateOrganizeReport({
        workspaceId: 'workspace-alpha',
        contextBudgetTokens: 1_000,
        now: '2026-08-09T00:00:00.000Z',
      });
      expect(report.categories).toMatchObject({
        unused: expect.arrayContaining([unused.id]),
        inactive: expect.arrayContaining([unused.id]),
        problematic: [highContext.id],
        contextWarning: [highContext.id],
        highContext: [highContext.id],
      });
      expect(skillStore.getVersion(highContext.id)?.enabled).toBe(true);
      expect(skillStore.getVersion(unused.id)?.enabled).toBe(true);
    } finally {
      close();
    }
  });

  it('returns the latest organize report for a workspace', async () => {
    const { capabilityStore, close } = await openStores();
    try {
      capabilityStore.generateOrganizeReport({
        workspaceId: 'workspace-alpha',
        contextBudgetTokens: 1_000,
        now: '2026-08-08T00:00:00.000Z',
      });
      const latest = capabilityStore.generateOrganizeReport({
        workspaceId: 'workspace-alpha',
        contextBudgetTokens: 2_000,
        now: '2026-08-09T00:00:00.000Z',
      });

      expect(capabilityStore.getLatestOrganizeReport('workspace-alpha')).toEqual(latest);
      expect(capabilityStore.getLatestOrganizeReport('workspace-missing')).toBeUndefined();
    } finally {
      close();
    }
  });
});

describe('0040 capability governance migration', () => {
  it('enables historical capabilities and creates governance tables', async () => {
    const dbPath = makeDbPath();
    const start = MIGRATIONS.findIndex(
      (migration) => migration.name === '0039_capability_enablement',
    );
    expect(start).toBeGreaterThanOrEqual(0);
    const trailing = MIGRATIONS.splice(start);
    try {
      await runMigrations(dbPath);
      const before = await openDatabaseAsync({ path: dbPath });
      try {
        before.raw
          .prepare(
            `INSERT INTO skill_version (
               id, skill_id, name, description, version, source_md, body,
               allowed_tools_json, content_fingerprint, has_scripts, warnings_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, 0, '[]', ?)`,
          )
          .run(
            'skill-version-history',
            'skill-history',
            'history',
            'history',
            '1.0.0',
            '# history',
            'history',
            'history-fingerprint',
            '2026-07-01T00:00:00.000Z',
          );
        before.raw
          .prepare(
            `INSERT INTO mcp_server (
               id, name, transport, endpoint, tools_json, trusted,
               max_output_bytes, timeout_ms, notes, created_at, updated_at
             ) VALUES (?, ?, 'local-stdio', ?, '[]', 0, 65536, 15000, '', ?, ?)`,
          )
          .run(
            'mcp-history',
            'history',
            'stdio://history',
            '2026-07-01T00:00:00.000Z',
            '2026-07-01T00:00:00.000Z',
          );
      } finally {
        before.raw.close();
      }
    } finally {
      MIGRATIONS.push(...trailing);
    }

    expect((await runMigrations(dbPath)).applied).toEqual([
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
    ]);
    const after = await openDatabaseAsync({ path: dbPath });
    try {
      expect(
        after.raw
          .prepare('SELECT enabled FROM skill_version WHERE id = ?')
          .get('skill-version-history'),
      ).toEqual({ enabled: 1 });
      expect(
        after.raw.prepare('SELECT enabled FROM mcp_server WHERE id = ?').get('mcp-history'),
      ).toEqual({ enabled: 1 });
      const tables = after.raw
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table'
             AND name IN (
               'capability_workspace_activation',
               'capability_usage_event',
               'skill_publish_draft',
               'capability_organize_report'
             )
           ORDER BY name`,
        )
        .all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual([
        'capability_organize_report',
        'capability_usage_event',
        'capability_workspace_activation',
        'skill_publish_draft',
      ]);
    } finally {
      after.raw.close();
    }
  });
});
