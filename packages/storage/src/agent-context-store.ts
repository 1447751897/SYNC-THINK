import { ulid, type AgentContextThreadId, type AgentVersionId, type ContextEpochId, type TaskId } from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

export type AgentContextThreadStatus = 'active' | 'closed';
export type ContextEpochStatus = 'active' | 'closed';

export interface AgentContextThreadRecord {
  id: AgentContextThreadId;
  taskId: TaskId;
  agentVersionId: AgentVersionId;
  workstreamKey: string;
  role: string;
  status: AgentContextThreadStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ContextEpochRecord {
  id: ContextEpochId;
  agentContextThreadId: AgentContextThreadId;
  providerId: string;
  modelId: string;
  reasoningEffort?: string;
  contextWindow?: number;
  parentEpochId?: ContextEpochId;
  status: ContextEpochStatus;
  startedAt: string;
  closedAt?: string;
}

export interface GetOrCreateAgentContextThreadInput {
  taskId: TaskId;
  agentVersionId: AgentVersionId;
  workstreamKey: string;
  role: string;
  now?: string;
}

export interface GetOrCreateContextEpochInput {
  agentContextThreadId: AgentContextThreadId;
  providerId: string;
  modelId: string;
  reasoningEffort?: string;
  contextWindow?: number;
  now?: string;
}

interface ThreadRow {
  id: string; task_id: string; agent_version_id: string; workstream_key: string; role: string;
  status: string; created_at: string; updated_at: string;
}
interface EpochRow {
  id: string; agent_context_thread_id: string; provider_id: string; model_id: string;
  reasoning_effort: string | null; context_window: number | null; parent_epoch_id: string | null;
  status: string; started_at: string; closed_at: string | null;
}

function threadFromRow(row: ThreadRow): AgentContextThreadRecord {
  return { id: row.id as AgentContextThreadId, taskId: row.task_id as TaskId, agentVersionId: row.agent_version_id as AgentVersionId, workstreamKey: row.workstream_key, role: row.role, status: row.status as AgentContextThreadStatus, createdAt: row.created_at, updatedAt: row.updated_at };
}
function epochFromRow(row: EpochRow): ContextEpochRecord {
  return { id: row.id as ContextEpochId, agentContextThreadId: row.agent_context_thread_id as AgentContextThreadId, providerId: row.provider_id, modelId: row.model_id, ...(row.reasoning_effort ? { reasoningEffort: row.reasoning_effort } : {}), ...(row.context_window !== null ? { contextWindow: row.context_window } : {}), ...(row.parent_epoch_id ? { parentEpochId: row.parent_epoch_id as ContextEpochId } : {}), status: row.status as ContextEpochStatus, startedAt: row.started_at, ...(row.closed_at ? { closedAt: row.closed_at } : {}) };
}

export class SqliteAgentContextStore {
  constructor(private readonly db: BetterSQLite3Raw) {}

  getThread(id: AgentContextThreadId): AgentContextThreadRecord | undefined {
    const row = this.db.prepare('SELECT * FROM agent_context_thread WHERE id = ?').get(id) as ThreadRow | undefined;
    return row ? threadFromRow(row) : undefined;
  }

  listThreads(taskId: TaskId): AgentContextThreadRecord[] {
    const rows = this.db.prepare('SELECT * FROM agent_context_thread WHERE task_id = ? ORDER BY created_at, id').all(taskId) as ThreadRow[];
    return rows.map(threadFromRow);
  }

  getOrCreateThread(input: GetOrCreateAgentContextThreadInput): AgentContextThreadRecord {
    const workstreamKey = input.workstreamKey.trim();
    const role = input.role.trim();
    if (!workstreamKey || !role) throw new Error('agent_context_thread_scope_invalid');
    const existing = this.db.prepare('SELECT * FROM agent_context_thread WHERE task_id = ? AND agent_version_id = ? AND workstream_key = ?').get(input.taskId, input.agentVersionId, workstreamKey) as ThreadRow | undefined;
    if (existing) return threadFromRow(existing);
    const now = input.now ?? new Date().toISOString();
    const id = ulid() as AgentContextThreadId;
    try {
      this.db.prepare(`INSERT INTO agent_context_thread (id, task_id, agent_version_id, workstream_key, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)` ).run(id, input.taskId, input.agentVersionId, workstreamKey, role, now, now);
    } catch (error) {
      const race = this.db.prepare('SELECT * FROM agent_context_thread WHERE task_id = ? AND agent_version_id = ? AND workstream_key = ?').get(input.taskId, input.agentVersionId, workstreamKey) as ThreadRow | undefined;
      if (race) return threadFromRow(race);
      throw error;
    }
    return this.getThread(id)!;
  }

  closeThread(id: AgentContextThreadId, now = new Date().toISOString()): AgentContextThreadRecord | undefined {
    this.db.prepare("UPDATE agent_context_thread SET status = 'closed', updated_at = ? WHERE id = ?").run(now, id);
    return this.getThread(id);
  }

  getActiveEpoch(threadId: AgentContextThreadId): ContextEpochRecord | undefined {
    const row = this.db.prepare("SELECT * FROM context_epoch WHERE agent_context_thread_id = ? AND status = 'active'").get(threadId) as EpochRow | undefined;
    return row ? epochFromRow(row) : undefined;
  }

  listEpochs(threadId: AgentContextThreadId): ContextEpochRecord[] {
    const rows = this.db.prepare('SELECT * FROM context_epoch WHERE agent_context_thread_id = ? ORDER BY started_at, id').all(threadId) as EpochRow[];
    return rows.map(epochFromRow);
  }

  getOrCreateEpoch(input: GetOrCreateContextEpochInput): ContextEpochRecord {
    const now = input.now ?? new Date().toISOString();
    const active = this.getActiveEpoch(input.agentContextThreadId);
    if (active && active.providerId === input.providerId && active.modelId === input.modelId && active.reasoningEffort === input.reasoningEffort && active.contextWindow === input.contextWindow) return active;
    const transaction = this.db.transaction(() => {
      const current = this.getActiveEpoch(input.agentContextThreadId);
      if (current) this.db.prepare("UPDATE context_epoch SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'active'").run(now, current.id);
      const id = ulid() as ContextEpochId;
      this.db.prepare(`INSERT INTO context_epoch (id, agent_context_thread_id, provider_id, model_id, reasoning_effort, context_window, parent_epoch_id, status, started_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL)`).run(id, input.agentContextThreadId, input.providerId, input.modelId, input.reasoningEffort ?? null, input.contextWindow ?? null, current?.id ?? null, now);
      return id;
    });
    const id = transaction() as ContextEpochId;
    return this.getEpoch(id)!;
  }

  getEpoch(id: ContextEpochId): ContextEpochRecord | undefined {
    const row = this.db.prepare('SELECT * FROM context_epoch WHERE id = ?').get(id) as EpochRow | undefined;
    return row ? epochFromRow(row) : undefined;
  }

  closeEpoch(id: ContextEpochId, now = new Date().toISOString()): ContextEpochRecord | undefined {
    this.db.prepare("UPDATE context_epoch SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'active'").run(now, id);
    return this.getEpoch(id);
  }
}
