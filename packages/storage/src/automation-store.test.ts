import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelId } from '@sync-think/shared';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteAgentStore } from './agent-store.js';
import { SqliteWorkspaceStore } from './workspace-store.js';
import { SqliteAutomationStore } from './automation-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('SqliteAutomationStore', () => {
  it('persists definitions, queue history, and soft deletion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-automation-store-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    try {
      const workspace = new SqliteWorkspaceStore(connection.raw).createWorkspace({
        name: '自动化项目',
        now: '2026-07-18T00:00:00.000Z',
      });
      const agent = new SqliteAgentStore(connection.raw).ensureConversationAgent({
        defaultModelId: 'model-automation' as ModelId,
        now: '2026-07-18T00:00:00.000Z',
      });
      const store = new SqliteAutomationStore(connection.raw);
      const automation = store.create({
        name: '每日检查',
        workspaceId: workspace.id,
        target: { type: 'agent', agentVersionId: agent.id },
        instruction: '检查项目状态',
        trigger: { type: 'cron', expression: '0 9 * * 1-5' },
        timezone: 'Asia/Shanghai',
        nextTriggerAt: '2026-07-19T01:00:00.000Z',
        now: '2026-07-18T00:00:00.000Z',
      });
      expect(store.get(automation.id)).toMatchObject({
        name: '每日检查',
        trigger: { type: 'cron', expression: '0 9 * * 1-5' },
        version: 1,
      });

      const task = new SqliteWorkspaceStore(connection.raw).createTask({
        workspaceId: workspace.id,
        title: '自动化任务',
        goal: '检查项目状态',
      });
      const execution = store.createExecution({
        automationId: automation.id,
        triggerId: 'trigger-1',
        source: 'manual',
        status: 'queued',
        attempt: 0,
        taskId: task.taskId,
        inputDigest: 'a'.repeat(64),
        now: '2026-07-18T00:01:00.000Z',
      });
      expect(store.transitionExecution(execution.id, 'running')).toMatchObject({
        status: 'running',
      });
      expect(store.countActive(automation.id)).toBe(1);

      const deleted = store.softDelete(
        automation.id,
        automation.version,
        '2026-07-18T00:02:00.000Z',
      );
      expect(deleted.enabled).toBe(false);
      expect(store.get(automation.id)).toBeUndefined();
      expect(store.listExecutions({ automationId: automation.id })).toHaveLength(1);
    } finally {
      connection.raw.close();
    }
  });
});
