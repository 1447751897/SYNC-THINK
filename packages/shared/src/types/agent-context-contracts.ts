import type { AgentContextThreadId, AgentVersionId, ContextEpochId, TaskId } from './ids.js';

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
