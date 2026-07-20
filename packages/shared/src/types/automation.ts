import type {
  AgentVersionId,
  AutomationExecutionId,
  AutomationId,
  GroupId,
  TaskId,
  WorkspaceId,
} from './ids.js';
import type { ApprovalMode } from './enums.js';

export type AutomationConcurrencyPolicy = 'skip' | 'queue' | 'parallel';
export type AutomationTriggerSource = 'schedule' | 'webhook' | 'manual';
export type AutomationExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export type AutomationTarget =
  | { type: 'agent'; agentVersionId: AgentVersionId }
  | { type: 'group'; groupId: GroupId };

export type AutomationTrigger =
  | { type: 'cron'; expression: string }
  | { type: 'webhook'; path: string };

export interface AutomationDefinition {
  id: AutomationId;
  name: string;
  workspaceId: WorkspaceId;
  target: AutomationTarget;
  instruction: string;
  approvalMode: ApprovalMode;
  trigger: AutomationTrigger;
  timezone: string;
  concurrencyPolicy: AutomationConcurrencyPolicy;
  maxConcurrency: number;
  maxRetries: number;
  enabled: boolean;
  webhookSecretConfigured: boolean;
  version: number;
  lastTriggeredAt?: string;
  nextTriggerAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationExecution {
  id: AutomationExecutionId;
  automationId: AutomationId;
  triggerId: string;
  source: AutomationTriggerSource;
  status: AutomationExecutionStatus;
  attempt: number;
  taskId?: TaskId;
  inputDigest: string;
  errorSummary?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}
