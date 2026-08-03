import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteAgentContextStore } from './agent-context-store.js';

describe('SqliteAgentContextStore', () => {
  it('reuses a thread, creates epochs, and chains model changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-agent-context-'));
    const dbPath = join(dir, 'test.db');
    try {
      await runMigrations(dbPath);
      const { raw } = await openDatabaseAsync({ path: dbPath });
      raw.prepare(`INSERT INTO workspace (id, folder_path, name, created_at, updated_at) VALUES ('ws-1', 'D:/workspace', 'Workspace', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`).run();
      raw.prepare(`INSERT INTO task (id, workspace_id, title, goal, status, participation_mode, acceptance_criteria_json, version, created_at, updated_at) VALUES ('task-1', 'ws-1', 'Task', 'Goal', 'active', 'collaboration', '[]', 0, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`).run();
      raw.prepare(`INSERT INTO agent_version (id, agent_id, version, name, role, developer_instructions, input_contract, output_contract, default_model_id, default_credential_group_id, created_at) VALUES ('av-1', 'agent-1', 1, 'Frontend', 'frontend', '', '', 'model-1', 'model-1', 'credential-group-1', '2026-08-01T00:00:00.000Z')`).run();
      const store = new SqliteAgentContextStore(raw);
      const thread = store.getOrCreateThread({ taskId: 'task-1' as never, agentVersionId: 'av-1' as never, workstreamKey: 'step:step-1', role: 'frontend', now: '2026-08-01T00:00:01.000Z' });
      const same = store.getOrCreateThread({ taskId: 'task-1' as never, agentVersionId: 'av-1' as never, workstreamKey: 'step:step-1', role: 'frontend', now: '2026-08-01T00:00:02.000Z' });
      expect(same.id).toBe(thread.id);
      const epoch1 = store.getOrCreateEpoch({ agentContextThreadId: thread.id, providerId: 'provider-a', modelId: 'model-1', reasoningEffort: 'medium', contextWindow: 128000, now: '2026-08-01T00:00:03.000Z' });
      const epoch1Again = store.getOrCreateEpoch({ agentContextThreadId: thread.id, providerId: 'provider-a', modelId: 'model-1', reasoningEffort: 'medium', contextWindow: 128000, now: '2026-08-01T00:00:04.000Z' });
      expect(epoch1Again.id).toBe(epoch1.id);
      const epoch2 = store.getOrCreateEpoch({ agentContextThreadId: thread.id, providerId: 'provider-b', modelId: 'model-2', reasoningEffort: 'high', contextWindow: 200000, now: '2026-08-01T00:00:05.000Z' });
      expect(epoch2.parentEpochId).toBe(epoch1.id);
      expect(store.getEpoch(epoch1.id)?.status).toBe('closed');
      expect(store.getActiveEpoch(thread.id)?.id).toBe(epoch2.id);
      raw.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
