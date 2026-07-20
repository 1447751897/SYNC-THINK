import type { AgentVersionId, GroupId, TaskId } from './ids.js';
import type { ApprovalMode } from './enums.js';

export type GroupKind = 'fixed' | 'temporary';
export type GroupCollaborationMode = 'parallel' | 'sequential';

export interface GroupVisualIdentity {
  icon: string;
  color: string;
  avatarPath?: string;
}

export interface GroupMember {
  agentVersionId: AgentVersionId;
  responsibility: string;
  sortOrder: number;
  createdAt: string;
}

export interface GroupDefinition {
  id: GroupId;
  name: string;
  description: string;
  kind: GroupKind;
  visualIdentity: GroupVisualIdentity;
  leadAgentVersionId: AgentVersionId;
  approvalMode: ApprovalMode;
  collaborationMode: GroupCollaborationMode;
  maxConcurrency: number;
  version: number;
  members: GroupMember[];
  createdAt: string;
  updatedAt: string;
}

export interface GroupTaskBinding {
  groupId: GroupId;
  taskId: TaskId;
  createdAt: string;
}
