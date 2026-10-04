import type { AutomationAcceptanceChecks } from '@sync-think/shared';
/** Actor-filtered, live dependency inventory. No fixture defaults or discovery side effects. */
export type AutomationOutput = 'spreadsheet' | 'presentation';
export interface AutomationOutcome {
  status: 'success' | 'failed' | 'blocked';
  reason: string;
  runId: string;
  reportedAt: string;
}
export interface AutomationArtifactExportArgs {
  readonly format: AutomationOutput;
  readonly fileName: string;
  readonly title: string;
  readonly columns?: readonly string[];
  readonly rows?: readonly (readonly (string | number)[])[];
  readonly slides?: readonly { readonly title: string; readonly bullets: readonly string[] }[];
}
export type AutomationCapability = AutomationOutput | 'gmail.send';
export type AutomationTarget =
  | { readonly kind: 'model'; readonly modelId: string }
  | { readonly kind: 'agent'; readonly agentId: string }
  | { readonly kind: 'team'; readonly teamId: string };

export interface AutomationConfiguration {
  readonly executionMode?: 'ask' | 'workspace' | 'full-access';
  readonly browser?: {
    readonly profileId: string;
    readonly workflowTaskId?: string;
    readonly variables?: Readonly<Record<string, string>>;
  };
  readonly requiredMcpServerIds?: readonly string[];
  readonly outputs?: readonly AutomationOutput[];
  readonly delivery?: {
    readonly kind: 'gmail';
    readonly mcpServerId: string;
    readonly toolName?: string;
    readonly recipient: string;
  };
  readonly acceptance?: string;
  readonly acceptanceChecks?: AutomationAcceptanceChecks;
}

/** Structurally accepts ScheduledTask without requiring the shared contract change. */
export interface AutomationTaskInput {
  readonly id: string;
  readonly name: string;
  readonly instruction: string;
  readonly timeZone?: string;
  readonly target: AutomationTarget;
  readonly workspaceId?: string;
  readonly skillVersionIds?: readonly string[];
  readonly automation?: AutomationConfiguration;
}

export interface AutomationModelDependency {
  readonly id: string;
  /** Includes enabled provider, usable credentials, kernel support and model availability. */
  readonly available: boolean;
  readonly reason?: string;
}
export interface AutomationAgentDependency {
  readonly id: string;
  /** False for archived/disabled/out-of-scope agents. */
  readonly available: boolean;
  readonly modelId: string;
  readonly fallbackModelIds?: readonly string[];
  readonly reason?: string;
}
export interface AutomationTeamDependency {
  readonly id: string;
  readonly available: boolean;
  readonly memberAgentIds: readonly string[];
  readonly coordinatorAgentId?: string;
  readonly reason?: string;
}
export interface AutomationToolDependency {
  readonly name: string;
  /** Must already be filtered for the actual actor, kernel and permission policy. */
  readonly available: boolean;
  /** Explicit adapter classification, not inference from arbitrary tool-name substrings. */
  readonly capabilities?: readonly AutomationCapability[];
}
export interface AutomationMcpDependency {
  readonly id: string;
  readonly registered: boolean;
  readonly connected: boolean;
  readonly available?: boolean;
  readonly connector?: 'gmail' | 'other';
  readonly tools: readonly AutomationToolDependency[];
  readonly reason?: string;
}
export interface AutomationSkillDependency {
  readonly id: string;
  /** Includes enabled, approved and injectable for this actor/kernel. */
  readonly available: boolean;
  readonly outputs?: readonly AutomationOutput[];
  readonly requiredToolNames?: readonly string[];
  readonly reason?: string;
}
export interface AutomationBrowserProfileDependency {
  readonly id: string;
  readonly available: boolean;
  readonly loginState?: 'ready' | 'required' | 'unknown';
  readonly approvalState?: 'ready' | 'required' | 'pending';
}
export interface AutomationBrowserWorkflowDependency {
  readonly id: string;
  readonly workspaceId?: string;
  readonly profileId: string;
  readonly enabled: boolean;
  readonly publishedVersionId?: string;
  /** Resolve the actual immutable version; omit when the version record is missing. */
  readonly publishedVersion?: {
    readonly id: string;
    readonly requiredVariables: readonly string[];
  };
  readonly approvalState?: 'ready' | 'required' | 'pending';
}
export interface AutomationPendingInput {
  readonly kind: 'login' | 'approval';
  readonly key: string;
  readonly reason: string;
  readonly taskId?: string;
  readonly profileId?: string;
  readonly workflowTaskId?: string;
}
export interface AutomationReadinessDependencies {
  /** Frozen triggering time supplied by the scheduler, never read from the wall clock here. */
  readonly firedAt: string;
  readonly runId?: string;
  readonly defaultWorkspaceId?: string;
  readonly workspaces: readonly { readonly id: string; readonly available: boolean }[];
  readonly models: readonly AutomationModelDependency[];
  readonly agents: readonly AutomationAgentDependency[];
  readonly teams: readonly AutomationTeamDependency[];
  readonly browserAvailable?: boolean;
  readonly browserWorkflowReplayAvailable?: boolean;
  readonly browserProfiles?: readonly AutomationBrowserProfileDependency[];
  readonly browserWorkflows?: readonly AutomationBrowserWorkflowDependency[];
  readonly mcpServers?: readonly AutomationMcpDependency[];
  readonly tools?: readonly AutomationToolDependency[];
  readonly skills?: readonly AutomationSkillDependency[];
  readonly pendingInputs?: readonly AutomationPendingInput[];
}

export type AutomationReadinessIssueCode =
  | 'EXECUTION_MODE_INVALID'
  | 'RUN_TIME_INVALID'
  | 'MODEL_MISSING'
  | 'MODEL_UNAVAILABLE'
  | 'AGENT_MISSING'
  | 'AGENT_UNAVAILABLE'
  | 'AGENT_MODEL_UNAVAILABLE'
  | 'TEAM_MISSING'
  | 'TEAM_UNAVAILABLE'
  | 'TEAM_EMPTY'
  | 'TEAM_COORDINATOR_MISSING'
  | 'TEAM_COORDINATOR_NOT_MEMBER'
  | 'WORKSPACE_MISSING'
  | 'WORKSPACE_UNAVAILABLE'
  | 'BROWSER_UNAVAILABLE'
  | 'BROWSER_PROFILE_MISSING'
  | 'BROWSER_PROFILE_UNAVAILABLE'
  | 'BROWSER_WORKFLOW_MISSING'
  | 'BROWSER_WORKFLOW_UNPUBLISHED'
  | 'BROWSER_WORKFLOW_DISABLED'
  | 'BROWSER_WORKFLOW_WORKSPACE_MISMATCH'
  | 'BROWSER_WORKFLOW_PROFILE_MISMATCH'
  | 'BROWSER_WORKFLOW_REPLAY_UNAVAILABLE'
  | 'BROWSER_VARIABLE_MISSING'
  | 'BROWSER_VARIABLE_INVALID'
  | 'LOGIN_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'MCP_UNREGISTERED'
  | 'MCP_DISCONNECTED'
  | 'MCP_UNAVAILABLE'
  | 'MCP_TOOLS_MISSING'
  | 'GMAIL_SERVER_REQUIRED'
  | 'GMAIL_CONNECTOR_REQUIRED'
  | 'GMAIL_SEND_TOOL_MISSING'
  | 'GMAIL_RECIPIENT_INVALID'
  | 'OUTPUT_CAPABILITY_MISSING'
  | 'SKILL_UNAVAILABLE'
  | 'SKILL_TOOL_MISSING';
export interface AutomationReadinessIssue {
  readonly code: AutomationReadinessIssueCode;
  readonly severity: 'error' | 'waiting_input';
  readonly message: string;
  readonly resourceId?: string;
  /** Persist/reuse this identity instead of spawning another login/approval request each tick. */
  readonly dedupeKey?: string;
}
export interface AutomationFrozenTool {
  readonly name: string;
  readonly mcpServerId?: string;
  readonly capabilities: readonly AutomationCapability[];
}
export interface AutomationRunSnapshot {
  readonly executionMode: 'ask' | 'workspace' | 'full-access';
  readonly taskId: string;
  readonly taskName: string;
  readonly instruction: string;
  readonly target: AutomationTarget;
  readonly firedAt: string;
  readonly timeZone?: string;
  readonly runId?: string;
  readonly workspaceId: string;
  readonly actors: readonly {
    readonly agentId?: string;
    readonly modelId: string;
    readonly coordinator?: boolean;
  }[];
  readonly skillVersionIds: readonly string[];
  readonly tools: readonly AutomationFrozenTool[];
  readonly browser?: {
    readonly profileId: string;
    readonly workflowTaskId?: string;
    readonly workflowVersionId?: string;
    readonly variables: Readonly<Record<string, string>>;
  };
  readonly mcpServers: readonly {
    readonly id: string;
    readonly tools: readonly AutomationFrozenTool[];
  }[];
  readonly outputs: readonly {
    readonly kind: AutomationOutput;
    readonly tools: readonly AutomationFrozenTool[];
    readonly skillVersionIds: readonly string[];
  }[];
  readonly delivery?: {
    readonly kind: 'gmail';
    readonly mcpServerId: string;
    readonly toolName?: string;
    readonly recipient: string;
    readonly sendToolNames: readonly string[];
  };
  readonly acceptance?: string;
  readonly acceptanceChecks?: AutomationAcceptanceChecks;
}
export type AutomationReadinessResult =
  | {
      readonly status: 'ready';
      readonly ready: true;
      readonly issues: readonly AutomationReadinessIssue[];
      readonly reasons: readonly string[];
      readonly snapshot: AutomationRunSnapshot;
    }
  | {
      readonly status: 'blocked' | 'waiting_input';
      readonly ready: false;
      readonly issues: readonly AutomationReadinessIssue[];
      readonly reasons: readonly string[];
    };
export type PreparedAutomationRun =
  | (Extract<AutomationReadinessResult, { ready: true }> & { readonly prompt: string })
  | Extract<AutomationReadinessResult, { ready: false }>;
