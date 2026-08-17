import type { AgentId, ConversationId, ModelId, TaskId, TeamId, WorkspaceId } from './ids.js';
import type { InteractionMode } from './chat-plan.js';

// ─── Mutable global Agent / Team model (2026-07-22) ─────────────────────────
// Agents/teams are global, mutable assets. Permission is NOT configured here:
// the conversation-level three-mode knob is the only permission surface.

export type TeamStrategy = 'serial' | 'parallel';
export type TeamRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type ConversationTrack = 'model' | 'agent' | 'team';

export interface GlobalAgent {
  id: AgentId;
  name: string;
  avatar: string;
  persona: string;
  description: string;
  defaultModelId: ModelId;
  fallbackModelIds: ModelId[];
  skillIds: string[];
  mcpServerIds: string[];
  reasoningEffort: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  agentId: AgentId;
  memberOrder: number;
  role: string;
  title: string;
  dependsOn: AgentId[];
}

export interface Team {
  id: TeamId;
  name: string;
  avatar: string;
  mission: string;
  strategy: TeamStrategy;
  coordinatorAgentId?: AgentId;
  members: TeamMember[];
  createdAt: string;
  updatedAt: string;
}

/** Frozen team definition captured when a run starts. */
export interface TeamRosterSnapshot {
  name: string;
  mission: string;
  strategy: TeamStrategy;
  coordinatorAgentId?: AgentId;
  members: TeamMember[];
}

export interface TeamRun {
  id: string;
  teamId: TeamId;
  conversationId: ConversationId;
  status: TeamRunStatus;
  rosterSnapshot: TeamRosterSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: ConversationId;
  track: ConversationTrack;
  targetRef: string;
  workspaceId?: WorkspaceId;
  title: string;
  pinnedAt?: string;
  archivedAt?: string;
  /** The ONLY permission knob: 'read-only' (ask) | 'workspace' | 'full-access'. */
  executionMode: string;
  /**
   * Interaction work mode: 'execute' (default) runs the conversation directly;
   * 'plan' makes the kernel analyse read-only and submit an approvable plan
   * before any side-effecting execution happens. Independent of executionMode.
   */
  interactionMode: InteractionMode;
  lastMessageAt?: string;
  /**
   * Task backing this conversation's message thread.
   * Undefined until the first message lazily creates and binds a task.
   */
  taskId?: TaskId;
  createdAt: string;
  updatedAt: string;
}
