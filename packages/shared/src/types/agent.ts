import type {
  AgentId,
  AgentVersionId,
  ModelId,
  CredentialGroupId,
  CredentialRefId,
  SkillVersionId,
  McpServerId,
  PolicyId,
} from './ids.js';
import type { ApprovalMode } from './enums.js';

export type MemoryScope = 'task' | 'project' | 'global';

export interface AgentVisualIdentity {
  icon: string;
  color: string;
  avatarPath?: string;
}

export interface AgentPermissions {
  file: string[];
  command: string[];
  browser: string[];
  desktop: string[];
  network: string[];
}

/** Explicit category denial used to distinguish user settings from legacy empty defaults. */
export const AGENT_PERMISSION_DISABLED = '__sync_think_disabled__';

export function isLegacyAgentPermissions(permissions: AgentPermissions): boolean {
  return (
    permissions.file.length === 0 &&
    permissions.command.length === 0 &&
    permissions.browser.length === 0 &&
    permissions.desktop.length === 0 &&
    permissions.network.length === 0
  );
}

export function isAgentPermissionCategoryEnabled(
  values: readonly string[] | undefined,
  legacyDefault = false,
): boolean {
  return (
    legacyDefault ||
    Boolean(values?.some((value) => value !== AGENT_PERMISSION_DISABLED))
  );
}

export const MAX_REVIEW_ITERATIONS = 100;

export interface AgentReviewBehavior {
  role: 'none' | 'reviewer' | 'executor-reviewer';
  maxIterations: number;
  onLimitReached: 'pause' | 'abort' | 'reassign';
  backupAgentVersionId?: AgentVersionId;
}

export interface AgentArtifactRules {
  retainVersions: boolean;
  requireReview: boolean;
  defaultStatus: 'candidate' | 'final';
}

// AgentVersion is immutable; editing creates a new version. Historical runs
// reference the exact version used (§8).
export interface AgentVersion {
  id: AgentVersionId;
  agentId: AgentId;
  version: number;
  name: string;
  description: string;
  visualIdentity: AgentVisualIdentity;
  role: string;
  developerInstructions: string;
  inputContract: string;
  outputContract: string;
  /** Maximum number of tasks this Agent may run concurrently. */
  maxConcurrency: number;
  /** Persistent default model — remains until user changes it (§5.3). */
  defaultModelId: ModelId;
  defaultCredentialGroupId: CredentialGroupId;
  /** Optional exact credential pin; runtime cannot switch when pinned (§5.4). */
  pinnedCredentialRefId?: CredentialRefId;
  /** Failure policy when no fallback configured (§5.3). */
  pauseOnFailure: boolean;
  /** Ordered fallback chain; runtime uses only if user configured. */
  fallbackModelIds: ModelId[];
  memoryScope: MemoryScope;
  /** Skill allowlist — installing a skill does not make it available to every Agent. */
  skillVersionIds: SkillVersionId[];
  mcpServerIds: McpServerId[];
  mcpToolAllowlist: string[];
  permissions: AgentPermissions;
  policyId?: PolicyId;
  approvalMode: ApprovalMode;
  reviewBehavior: AgentReviewBehavior;
  artifactRules: AgentArtifactRules;
  createdAt: string;
}

// Rework limits §5.5.
