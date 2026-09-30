import type { AgentId, TeamId } from './ids.js';

/** Reusable team configuration, independent of conversations and execution snapshots. */
export type TeamStrategy = 'serial' | 'parallel';

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
