import type {
  MessageId,
  ThreadId,
  WorkspaceId,
  TaskId,
  RunId,
  StepId,
  AgentVersionId,
  ModelId,
  CredentialRefId,
  ParticipationMode,
  ApprovalMode,
  PlanId,
  PlanRevision,
  PlanStepDraft,
  Run,
  Step,
  Artifact,
  ArtifactComparison,
  ArtifactId,
  ArtifactMergeConflict,
  ArtifactMergeConflictResolution,
  ArtifactMergeConflictResolutionStrategy,
  ArtifactSelection,
  ArtifactVersion,
  ArtifactVersionId,
  ArtifactVersionSummary,
  GroupCollaborationMode,
  GroupDefinition,
  GroupId,
  GroupKind,
  GroupVisualIdentity,
  AutomationConcurrencyPolicy,
  AutomationDefinition,
  AutomationExecution,
  AutomationId,
  AutomationTarget,
  MessageAttachment,
} from '@sync-think/shared';
import { ulid } from '@sync-think/shared';
import type { Feature } from './version.js';

// Command/query separation. Commands carry an `expectedTaskVersion` for
// optimistic concurrency on the shared task state.

export type CommandType =
  | 'runtime.healthcheck'
  | 'workspace.create'
  | 'workspace.bindFolder'
  | 'workspace.bindGitRepository'
  | 'workspace.list'
  | 'task.create'
  | 'task.delegateSubtask'
  | 'task.recordHandoff'
  | 'task.resolveWorktreeIntegration'
  | 'task.setBrowserIdentity'
  | 'task.describeExecutionAccess'
  | 'task.list'
  | 'task.open'
  | 'task.search'
  | 'task.archive'
  | 'task.unarchive'
  | 'task.discardEmpty'
  | 'task.setParticipationMode'
  | 'task.appendMessage'
  | 'runtime.subscribeEvents'
  | 'runtime.continueEventReplay'
  | 'runtime.unsubscribeEvents'
  | 'application.tool.confirm'
  | 'application.tool.reject'
  | 'automation.create'
  | 'automation.update'
  | 'automation.delete'
  | 'automation.get'
  | 'automation.list'
  | 'automation.trigger'
  | 'automation.execution.list'
  | 'context.packet.peek'
  | 'context.packet.amend'
  | 'plan.draft'
  | 'plan.revise'
  | 'plan.listRevisions'
  | 'plan.approve'
  | 'run.getGraph'
  | 'run.pause'
  | 'run.resume'
  | 'run.cancel'
  | 'artifact.list'
  | 'artifact.getVersion'
  | 'artifact.compare'
  | 'artifact.selectVersion'
  | 'artifact.merge'
  | 'artifact.listConflicts'
  | 'artifact.resolveConflict'
  | 'provider.create'
  | 'provider.update'
  | 'provider.list'
  | 'provider.discoverModels'
  | 'provider.addModels'
  | 'provider.probeCapabilities'
  | 'provider.confirmCapabilities'
  | 'provider.previewCcSwitchImport'
  | 'provider.importCcSwitch'
  | 'agent.get'
  | 'agent.updateBinding'
  | 'agent.list'
  | 'agent.create'
  | 'agent.listVersions'
  | 'agent.createVersion'
  | 'group.create'
  | 'group.get'
  | 'group.list'
  | 'group.update'
  | 'group.member.add'
  | 'group.member.remove'
  | 'group.member.updateResponsibility'
  | 'group.setLead'
  | 'group.task.create'
  | 'skill.import'
  | 'skill.list'
  | 'mcp.register'
  | 'mcp.list'
  | 'mcp.policy.probe'
  | 'mcp.tool.request'
  | 'mcp.spawn.probe'
  | 'mcp.tool.call'
  | 'mcp.tools.refresh'
  | 'memory.list'
  | 'memory.propose'
  | 'memory.decide'
  | 'memory.rollback'
  | 'diagnostics.list'
  | 'policy.save'
  | 'policy.list'
  | 'approval.list'
  | 'approval.evaluate'
  | 'approval.enqueue'
  | 'approval.decide'
  | 'browserIdentity.list'
  | 'browserIdentity.create'
  | 'browserIdentity.update'
  | 'browserIdentity.delete';

export interface CommandRequest<T = unknown> {
  /** Routed by type; runtime dispatches by union. */
  type: CommandType;
  payload: T;
  /** Optional opaque correlation id; runtime mirrors into response. */
  requestId: string;
}

export interface CommandResponse<T = unknown> {
  requestId: string;
  ok: boolean;
  data?: T;
  error?: import('@sync-think/shared').AppError;
}

// --- per-command payload shapes ---

export interface HealthcheckPayload {
  /** Empty for Phase 0; later carries negotiated feature masks. */
}

export interface HealthcheckResponse {
  runtimePid: number;
  uptimeMs: number;
  protocolVersion: number;
  features: Feature[];
  inFlightRuns: number;
}

export interface CreateWorkspacePayload {
  folderPath?: string;
  name: string;
  /** Optional allowlisted roots; empty/undefined allows first-folder onboarding. */
  allowedRoots?: string[];
}

export interface CreateWorkspaceResponse {
  workspaceId: WorkspaceId;
  folderPath?: string;
  name: string;
  createdAt: string;
}

export interface BindWorkspaceFolderPayload {
  workspaceId: WorkspaceId;
  folderPath: string;
  /** Optional allowlisted roots; validation and enforcement happen in the Runtime. */
  allowedRoots?: string[];
}

export interface BindWorkspaceFolderResponse {
  workspaceId: WorkspaceId;
  folderPath: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface BindWorkspaceGitRepositoryPayload {
  workspaceId: WorkspaceId;
  repositoryUrl: string;
  defaultRef?: string;
}

export interface BindWorkspaceGitRepositoryResponse {
  workspaceId: WorkspaceId;
  resourceId: string;
  repositoryUrl: string;
  defaultRef?: string;
  resourceType: 'git_repository';
  updatedAt: string;
}

export interface ListWorkspacesPayload {
  /** Reserved for future filters; currently unused. */
}

export interface WorkspaceSummary {
  workspaceId: WorkspaceId;
  folderPath?: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  resourceType?: 'local_directory' | 'git_repository';
  repositoryUrl?: string;
  executionProfileId?: string;
  executionProfileName?: string;
  executionMode?: 'auto' | 'local' | 'managed_worktree';
  defaultRef?: string;
  browserIdentityId?: string;
  browserIdentityName?: string;
}

export interface ListWorkspacesResponse {
  workspaces: WorkspaceSummary[];
}

export interface BrowserIdentitySummary {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListBrowserIdentitiesPayload {}

export interface ListBrowserIdentitiesResponse {
  identities: BrowserIdentitySummary[];
}

export interface CreateBrowserIdentityPayload {
  name: string;
  makeDefault?: boolean;
}

export interface CreateBrowserIdentityResponse {
  identity: BrowserIdentitySummary;
}

export interface UpdateBrowserIdentityPayload {
  id: string;
  name?: string;
  makeDefault?: boolean;
}

export interface UpdateBrowserIdentityResponse {
  identity: BrowserIdentitySummary;
}

export interface DeleteBrowserIdentityPayload {
  id: string;
}

export interface DeleteBrowserIdentityResponse {
  id: string;
  deleted: true;
}

export interface SetTaskBrowserIdentityPayload {
  taskId: TaskId;
  browserIdentityId: string;
}

export interface SetTaskBrowserIdentityResponse {
  taskId: TaskId;
  browserIdentityId: string;
  browserIdentityName: string;
}

export interface DescribeTaskExecutionAccessPayload {
  taskId: TaskId;
  agentVersionId: AgentVersionId;
}

export interface DescribeTaskExecutionAccessResponse {
  taskId: TaskId;
  agentVersionId: AgentVersionId;
  approvalMode: ApprovalMode;
  executionMode: 'none' | 'local_serial' | 'managed_worktree';
  executionState: 'pending' | 'ready' | 'blocked' | 'cleanup_pending' | 'retained' | 'cleaned';
  executionPath?: string;
  baseRef?: string;
  browserIdentityId?: string;
  browserIdentityName?: string;
  effectiveToolNames: string[];
  capabilityCeiling: {
    file: string[];
    command: string[];
    browser: string[];
    desktop: string[];
    network: string[];
  };
}

export interface CreateTaskPayload {
  workspaceId: WorkspaceId;
  title: string;
  goal: string;
  parentTaskId?: TaskId;
  acceptanceCriteria?: string[];
}

export interface CreateTaskResponse {
  taskId: TaskId;
  threadId: ThreadId;
  /** Initial expected version for optimistic concurrency on subsequent commands. */
  taskVersion: number;
  participationMode: ParticipationMode;
  parentTaskId?: TaskId;
  createdAt: string;
}

export interface DelegateSubtaskPayload {
  workspaceId: WorkspaceId;
  parentTaskId: TaskId;
  delegateAgentVersionId: AgentVersionId;
  title: string;
  goal: string;
  requiredEvidence?: string[];
  acceptanceConditions?: string[];
  allowedTools?: string[];
  /** Empty means immediately runnable; non-empty dependencies enforce serial execution. */
  dependsOnTaskIds?: TaskId[];
  /** Runtime-owned attribution injected for in-app Agent calls. */
  delegatingAgentVersionId?: AgentVersionId;
  /** Runtime-owned join key shared by parallel delegations from one parent Run. */
  delegationBatchId?: string;
}

export interface SubtaskPacket {
  goal: string;
  requiredEvidence: string[];
  acceptanceConditions: string[];
  allowedTools: string[];
  handoffHistory: string[];
  dependsOnTaskIds: TaskId[];
  retryLimit: number;
}

export interface DelegateSubtaskResponse extends CreateTaskResponse {
  delegateAgentVersionId: AgentVersionId;
  packet: SubtaskPacket;
  eventId: string;
  reused?: boolean;
}

export interface RecordHandoffPayload {
  taskId: TaskId;
  fromAgentVersionId: AgentVersionId;
  toAgentVersionId: AgentVersionId;
  summary: string;
  evidenceRefs?: string[];
  status?: 'completed' | 'blocked' | 'needs-review';
}

export interface RecordHandoffResponse {
  taskId: TaskId;
  eventId: string;
  recordedAt: string;
}

export interface ResolveWorktreeIntegrationPayload {
  childTaskId: TaskId;
  strategy: 'accept-child' | 'keep-parent';
}

export interface ResolveWorktreeIntegrationResponse {
  childTaskId: TaskId;
  parentTaskId: TaskId;
  integrationStatus: 'integrated' | 'kept-parent';
  integrationCommit?: string;
  changedFiles: string[];
}

export interface ListTasksPayload {
  workspaceId: WorkspaceId;
  /** When true, include status=archived tasks. Default: false. */
  includeArchived?: boolean;
}

export interface ArchiveTaskPayload {
  taskId: TaskId;
  expectedTaskVersion: number;
  /** When true (default), also archive descendant subtasks. */
  cascade?: boolean;
}

export interface ArchiveTaskResponse {
  task: TaskSummary;
  /** Task IDs that were transitioned to archived (includes root). */
  archivedTaskIds: TaskId[];
}

export interface UnarchiveTaskPayload {
  taskId: TaskId;
  expectedTaskVersion: number;
  /** When true (default), also restore descendant subtasks that were archived. */
  cascade?: boolean;
}

export interface UnarchiveTaskResponse {
  task: TaskSummary;
  unarchivedTaskIds: TaskId[];
}

export interface DiscardEmptyTaskPayload {
  taskId: TaskId;
  expectedTaskVersion: number;
}

export interface DiscardEmptyTaskResponse {
  taskId: TaskId;
  discarded: boolean;
}

export interface TaskSummary {
  taskId: TaskId;
  workspaceId: WorkspaceId;
  parentTaskId?: TaskId;
  title: string;
  goal: string;
  status: string;
  participationMode: ParticipationMode;
  taskVersion: number;
  threadId: ThreadId;
  lastOpenedAt?: string;
  createdAt: string;
  updatedAt: string;
  execution?: {
    mode: 'none' | 'local_serial' | 'managed_worktree';
    state: 'pending' | 'ready' | 'blocked' | 'cleanup_pending' | 'retained' | 'cleaned';
    executionPath?: string;
    baseRef?: string;
    headRef?: string;
    browserIdentityId?: string;
    blockedReason?: string;
    cleanupAfter?: string;
  };
}

export interface ListTasksResponse {
  tasks: TaskSummary[];
}

export interface OpenTaskPayload {
  taskId: TaskId;
}

export interface OpenTaskResponse {
  task: TaskSummary;
}

export interface SearchTasksPayload {
  workspaceId: WorkspaceId;
  query: string;
}

export interface SearchTasksResponse {
  tasks: TaskSummary[];
}

export interface SetParticipationModePayload {
  taskId: TaskId;
  mode: ParticipationMode;
  expectedTaskVersion: number;
}

export interface SetParticipationModeResponse {
  task: TaskSummary;
}

export interface AppendMessagePayload {
  threadId: ThreadId;
  /** Optimistic concurrency: must match last seen task version. */
  expectedTaskVersion: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  /** Resolve model via priority 搂5.3. If absent, use Agent default. */
  agentVersionId?: AgentVersionId;
  modelId?: ModelId;
  credentialRefId?: CredentialRefId;
  /** Set when assistant message originates from a Run step. */
  runId?: RunId;
  stepId?: string;
  /** Local managed snapshots selected by the user. Binary data never crosses Runtime IPC. */
  attachments?: MessageAttachment[];
}

export interface AppendMessageResponse {
  messageId: MessageId;
  taskVersion: number;
  /** Present when the first user request replaced a generated placeholder title. */
  taskTitle?: string;
  taskGoal?: string;
  /** Optional: streaming id assigned if this user message triggers a model call. */
  streamId?: string;
}

export interface SubscribeEventsPayload {
  /** Only send events with workspace-scoped sequence greater than cursor. */
  afterCursor: number;
  /** Filters by category / source; empty = all. */
  categories?: import('@sync-think/shared').EventCategory[];
}

export interface ContinueEventReplayPayload {
  streamId: string;
  /** Must equal the last page cursor committed for this stream. */
  afterCursor: number;
}

export interface UnsubscribeEventsPayload {
  streamId: string;
}

export interface ConversationCancelRunPayload {
  runId: RunId;
}

export interface OrchestrationRunMutationPayload {
  workspaceId: WorkspaceId;
  taskId: TaskId;
  runId: RunId;
  expectedTaskVersion: number;
}

export type CancelRunPayload = ConversationCancelRunPayload | OrchestrationRunMutationPayload;

export type PauseRunPayload = OrchestrationRunMutationPayload;
export type ResumeRunPayload = OrchestrationRunMutationPayload;

/** Exact AgentVersion selected for a Run; never resolved as a moving latest reference. */
export interface RunAgentVersionPin {
  runId: RunId;
  agentVersionId: AgentVersionId;
}

/** Exact AgentVersion selected for a stable Step within a Run. */
export interface StepAgentVersionPin extends RunAgentVersionPin {
  stepId: StepId;
}

export interface PlanDraftPayload {
  taskId: TaskId;
  expectedTaskVersion: number;
  title: string;
  steps: PlanStepDraft[];
}

export interface PlanDraftResponse extends PlanRevision {
  taskVersion: number;
}

export interface PlanRevisePayload {
  planId: PlanId;
  expectedRevision: number;
  title?: string;
  steps: PlanStepDraft[];
}

export type PlanReviseResponse = PlanRevision;

export interface PlanListRevisionsPayload {
  planId: PlanId;
}

export interface PlanListRevisionsResponse {
  revisions: PlanRevision[];
}

export interface PlanApprovePayload {
  planId: PlanId;
  revision: number;
}

export interface RunGraphStep extends Step {
  planOrder: number;
  title: string;
  instructions: string;
  modelOverrideId?: ModelId;
}

export interface RunGraphDependency {
  runId: RunId;
  stepId: StepId;
  dependsOnStepId: StepId;
}

export interface RunGraphResponse {
  run: Run;
  steps: RunGraphStep[];
  dependencies: RunGraphDependency[];
}

export type PlanApproveResponse = RunGraphResponse;

export interface RunGetGraphPayload {
  workspaceId: WorkspaceId;
  taskId: TaskId;
  runId: RunId;
}

export type RunGetGraphResponse = RunGraphResponse;

export interface OrchestrationRunMutationResponse extends RunGraphResponse {
  taskVersion: number;
}

export type PauseRunResponse = OrchestrationRunMutationResponse;
export type ResumeRunResponse = OrchestrationRunMutationResponse;
export type CancelOrchestrationRunResponse = OrchestrationRunMutationResponse;

export interface ArtifactScopePayload {
  workspaceId: WorkspaceId;
  taskId: TaskId;
  runId: RunId;
}

export const MAX_ARTIFACT_LIST_LIMIT = 8;

export interface ListArtifactsPayload extends ArtifactScopePayload {
  limit?: number;
  cursor?: ArtifactId;
}

export interface ArtifactListItem {
  artifact: Artifact;
  versions: ArtifactVersionSummary[];
  selectedVersionId?: ArtifactVersionId;
}

export interface ListArtifactsResponse {
  artifacts: ArtifactListItem[];
  nextCursor?: ArtifactId;
}

export interface GetArtifactVersionPayload extends ArtifactScopePayload {
  artifactVersionId: ArtifactVersionId;
}

export interface GetArtifactVersionResponse {
  version: ArtifactVersion;
}

export interface CompareArtifactVersionsPayload extends ArtifactScopePayload {
  leftVersionId: ArtifactVersionId;
  rightVersionId: ArtifactVersionId;
}

export interface CompareArtifactVersionsResponse {
  artifactId: ArtifactId;
  leftVersionId: ArtifactVersionId;
  rightVersionId: ArtifactVersionId;
  comparison: ArtifactComparison;
}

export interface SelectArtifactVersionPayload extends ArtifactScopePayload {
  artifactId: ArtifactId;
  artifactVersionId: ArtifactVersionId;
  operationId: string;
  expectedTaskVersion: number;
}

export interface SelectArtifactVersionResponse {
  selection: ArtifactSelection;
  taskVersion: number;
}

export interface MergeArtifactVersionsPayload extends ArtifactScopePayload {
  artifactId: ArtifactId;
  baseVersionId: ArtifactVersionId;
  leftVersionId: ArtifactVersionId;
  rightVersionId: ArtifactVersionId;
  sourceStepId: StepId;
  operationId: string;
  expectedTaskVersion: number;
}

export type MergeArtifactVersionsResponse =
  | {
      status: 'clean';
      version: ArtifactVersionSummary;
      taskVersion: number;
    }
  | {
      status: 'conflict';
      conflict: ArtifactMergeConflict;
      runState: 'paused';
      taskVersion: number;
    };

export type ListArtifactMergeConflictsPayload = ArtifactScopePayload;

export interface ArtifactMergeConflictListItem {
  conflict: ArtifactMergeConflict;
  resolution?: ArtifactMergeConflictResolution;
}

export interface ListArtifactMergeConflictsResponse {
  conflicts: ArtifactMergeConflictListItem[];
}

export interface ResolveArtifactMergeConflictPayload extends ArtifactScopePayload {
  conflictId: string;
  strategy: ArtifactMergeConflictResolutionStrategy;
  content?: string;
  operationId: string;
  expectedTaskVersion: number;
}

export interface ResolveArtifactMergeConflictResponse {
  resolution: ArtifactMergeConflictResolution;
  version: ArtifactVersionSummary;
  runState: 'paused';
  taskVersion: number;
}

export interface CreateProviderPayload {
  name: string;
  baseUrl: string;
  protocol: import('@sync-think/shared').ProtocolFamily;
  /** Plaintext only for the create hop; Runtime stores into secure-store and never echoes it. */
  apiKey: string;
  supportsDiscovery?: boolean;
  credentialGroupName?: string;
  credentialLabel?: string;
  importedFrom?: string;
  /** CC Switch-style surface; optional on create. */
  surface?: import('@sync-think/shared').ProviderSurface;
}

export interface ProviderCredentialSummary {
  credentialRefId: import('@sync-think/shared').CredentialRefId;
  credentialGroupId: import('@sync-think/shared').CredentialGroupId;
  groupName: string;
  label: string;
  kind: 'api-key' | 'bearer-token' | 'oauth-token-ref';
  /** Always true when a secret is stored; never returns plaintext. */
  hasSecret: boolean;
}

export interface ProviderModelSummary {
  modelId: import('@sync-think/shared').ModelId;
  providerModelId: string;
  displayName: string;
  protocol: import('@sync-think/shared').ProtocolFamily;
  capabilities: import('@sync-think/shared').CapabilityTag[];
  capabilitiesConfirmed: boolean;
}

export interface ProviderSummary {
  providerId: import('@sync-think/shared').ProviderId;
  name: string;
  baseUrl: string;
  /** Default protocol used for discovery and empty-catalog manual models (搂7.2). */
  protocol: import('@sync-think/shared').ProtocolFamily;
  supportsDiscovery: boolean;
  /** CC Switch-style surface for hierarchical model picking. */
  surface: import('@sync-think/shared').ProviderSurface;
  importedFrom?: string;
  credentials: ProviderCredentialSummary[];
  models: ProviderModelSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateProviderResponse {
  provider: ProviderSummary;
  /** Opaque note for UI observability; never includes the key. */
  secretStored: true;
  discoveredModelCount: number;
}

export interface UpdateProviderPayload {
  providerId: import('@sync-think/shared').ProviderId;
  name?: string;
  baseUrl?: string;
  protocol?: import('@sync-think/shared').ProtocolFamily;
  /** Optional plaintext only when rotating; omit/empty keeps existing secret. */
  apiKey?: string;
  supportsDiscovery?: boolean;
  credentialLabel?: string;
  surface?: import('@sync-think/shared').ProviderSurface;
}

export interface UpdateProviderResponse {
  provider: ProviderSummary;
  /** True when a new secret was written to secure-store. */
  secretRotated: boolean;
}

export interface CcSwitchImportPreviewItem {
  sourceId: string;
  appType: string;
  name: string;
  baseUrl?: string;
  protocol?: import('@sync-think/shared').ProtocolFamily;
  hasSecret: boolean;
  models: string[];
  credentialGroupName: string;
  importedFrom: string;
  warnings: string[];
  importable: boolean;
}

export interface PreviewCcSwitchImportPayload {
  /** Optional absolute path; default ~/.cc-switch/cc-switch.db */
  dbPath?: string;
}

export interface PreviewCcSwitchImportResponse {
  dbPath: string;
  items: CcSwitchImportPreviewItem[];
  skippedCount: number;
  importableCount: number;
}

export interface ImportCcSwitchPayload {
  sourceIds: string[];
  dbPath?: string;
}

export interface ImportCcSwitchResultItem {
  sourceId: string;
  ok: boolean;
  providerId?: import('@sync-think/shared').ProviderId;
  name?: string;
  error?: string;
  discoveredModelCount?: number;
}

export interface ImportCcSwitchResponse {
  results: ImportCcSwitchResultItem[];
  importedCount: number;
  failedCount: number;
}

export interface ListProvidersPayload {
  /** Reserved for filters. */
}

export interface ListProvidersResponse {
  providers: ProviderSummary[];
}

export interface DiscoverModelsPayload {
  providerId: import('@sync-think/shared').ProviderId;
  /** Prefer a specific credential; defaults to first in default group. */
  credentialRefId?: import('@sync-think/shared').CredentialRefId;
}

export interface DiscoverModelsResponse {
  providerId: import('@sync-think/shared').ProviderId;
  models: ProviderModelSummary[];
  discoveredIds: string[];
  source: 'adapter' | 'cache';
  /** Protocol used for this discovery hop (persisted provider default or first model). */
  protocol?: import('@sync-think/shared').ProtocolFamily;
  /** Newly seen model ids vs prior catalog (observability). */
  addedIds?: string[];
  /** Prior catalog size before upsert (observability). */
  previousModelCount?: number;
}

export interface AddModelsPayload {
  providerId: import('@sync-think/shared').ProviderId;
  protocol: import('@sync-think/shared').ProtocolFamily;
  models: Array<{
    providerModelId: string;
    displayName?: string;
    capabilities?: import('@sync-think/shared').CapabilityTag[];
  }>;
}

export interface AddModelsResponse {
  providerId: import('@sync-think/shared').ProviderId;
  models: ProviderModelSummary[];
}

export interface ProbeCapabilitiesPayload {
  /** Probe one model, or omit modelId to probe all models for the provider. */
  providerId: import('@sync-think/shared').ProviderId;
  modelId?: import('@sync-think/shared').ModelId;
}

export interface CapabilityProbeSuggestion {
  modelId: import('@sync-think/shared').ModelId;
  providerModelId: string;
  displayName: string;
  capabilities: import('@sync-think/shared').CapabilityTag[];
  /** Always false after probe 鈥?suggestions only (搂7.2). */
  capabilitiesConfirmed: false;
  results: Partial<Record<import('@sync-think/shared').CapabilityTag, boolean>>;
  confidence: 'low' | 'medium';
  reasons: string[];
  source: 'heuristic';
}

export interface ProbeCapabilitiesResponse {
  providerId: import('@sync-think/shared').ProviderId;
  suggestions: CapabilityProbeSuggestion[];
  /** True when suggestions were written back as unconfirmed tags. */
  applied: boolean;
}

export interface ConfirmCapabilitiesPayload {
  modelId: import('@sync-think/shared').ModelId;
  /** Final user-edited tags. */
  capabilities: import('@sync-think/shared').CapabilityTag[];
  /** true = user confirms; false = keep as unconfirmed after edit. Default true. */
  confirmed?: boolean;
}

export interface ConfirmCapabilitiesResponse {
  model: ProviderModelSummary;
}

// --- Agent binding (persistent default / fallback 搂5.3) ---

export interface AgentBindingSummary {
  agentId: import('@sync-think/shared').AgentId;
  agentVersionId: import('@sync-think/shared').AgentVersionId;
  version: number;
  name: string;
  role: string;
  maxConcurrency: number;
  defaultModelId: import('@sync-think/shared').ModelId;
  fallbackModelIds: import('@sync-think/shared').ModelId[];
  pauseOnFailure: boolean;
  defaultCredentialGroupId?: import('@sync-think/shared').CredentialGroupId;
  pinnedCredentialRefId?: import('@sync-think/shared').CredentialRefId;
  /** Explicit Skill allowlist for this Agent (section 9.1). */
  skillVersionIds: string[];
  /** Explicit MCP server allowlist for this Agent (section 9.3). */
  mcpServerIds: string[];
  createdAt: string;
}

export interface GetAgentPayload {
  /** Defaults to the conversation agent when omitted. */
  agentId?: import('@sync-think/shared').AgentId;
}

export interface GetAgentResponse {
  agent: AgentBindingSummary;
}

export interface UpdateAgentBindingPayload {
  agentId?: import('@sync-think/shared').AgentId;
  defaultModelId: import('@sync-think/shared').ModelId;
  fallbackModelIds: import('@sync-think/shared').ModelId[];
  pauseOnFailure?: boolean;
  defaultCredentialGroupId?: import('@sync-think/shared').CredentialGroupId;
  pinnedCredentialRefId?: import('@sync-think/shared').CredentialRefId | null;
  /** When provided, replaces Agent skill allowlist on new version (section 9.1). */
  skillVersionIds?: string[];
  /** When provided, replaces Agent MCP server allowlist on new version (section 9.3). */
  mcpServerIds?: string[];
}

export interface UpdateAgentBindingResponse {
  agent: AgentBindingSummary;
}

export interface AgentDefinitionSummary extends AgentBindingSummary {
  description: string;
  visualIdentity: import('@sync-think/shared').AgentVisualIdentity;
  developerInstructions: string;
  inputContract: string;
  outputContract: string;
  memoryScope: import('@sync-think/shared').MemoryScope;
  mcpToolAllowlist: string[];
  permissions: import('@sync-think/shared').AgentPermissions;
  policyId?: string;
  approvalMode: import('@sync-think/shared').ApprovalMode;
  reviewBehavior: import('@sync-think/shared').AgentReviewBehavior;
  artifactRules: import('@sync-think/shared').AgentArtifactRules;
}

export interface ListAgentsPayload {
  /** Reserved for future workspace/role filters. */
}

export interface ListAgentsResponse {
  agents: AgentDefinitionSummary[];
}

export interface CreateAgentPayload {
  agentId?: import('@sync-think/shared').AgentId;
  name: string;
  description?: string;
  visualIdentity?: import('@sync-think/shared').AgentVisualIdentity;
  role: string;
  developerInstructions: string;
  inputContract: string;
  outputContract: string;
  maxConcurrency?: number;
  defaultModelId: import('@sync-think/shared').ModelId;
  defaultCredentialGroupId?: import('@sync-think/shared').CredentialGroupId;
  pinnedCredentialRefId?: import('@sync-think/shared').CredentialRefId;
  pauseOnFailure?: boolean;
  fallbackModelIds?: import('@sync-think/shared').ModelId[];
  memoryScope?: import('@sync-think/shared').MemoryScope;
  skillVersionIds?: string[];
  mcpServerIds?: string[];
  mcpToolAllowlist?: string[];
  permissions?: import('@sync-think/shared').AgentPermissions;
  policyId?: string;
  approvalMode?: import('@sync-think/shared').ApprovalMode;
  reviewBehavior?: import('@sync-think/shared').AgentReviewBehavior;
  artifactRules?: import('@sync-think/shared').AgentArtifactRules;
}

export interface CreateAgentResponse {
  agent: AgentDefinitionSummary;
}

export interface ListAgentVersionsPayload {
  agentId: import('@sync-think/shared').AgentId;
}

export interface ListAgentVersionsResponse {
  versions: AgentDefinitionSummary[];
}

export interface CreateAgentVersionPayload {
  agentId: import('@sync-think/shared').AgentId;
  expectedVersion: number;
  name: string;
  description?: string;
  visualIdentity?: import('@sync-think/shared').AgentVisualIdentity;
  role: string;
  developerInstructions: string;
  inputContract: string;
  outputContract: string;
  maxConcurrency: number;
  defaultModelId: import('@sync-think/shared').ModelId;
  defaultCredentialGroupId?: import('@sync-think/shared').CredentialGroupId;
  pinnedCredentialRefId?: import('@sync-think/shared').CredentialRefId | null;
  pauseOnFailure: boolean;
  fallbackModelIds: import('@sync-think/shared').ModelId[];
  memoryScope: import('@sync-think/shared').MemoryScope;
  skillVersionIds: string[];
  mcpServerIds: string[];
  mcpToolAllowlist?: string[];
  permissions?: import('@sync-think/shared').AgentPermissions;
  policyId?: string | null;
  approvalMode: import('@sync-think/shared').ApprovalMode;
  reviewBehavior?: import('@sync-think/shared').AgentReviewBehavior;
  artifactRules?: import('@sync-think/shared').AgentArtifactRules;
}

export interface CreateAgentVersionResponse {
  agent: AgentDefinitionSummary;
}

// --- Skill library (SKILL.md import subset 搂9.2) ---

export interface SkillVersionSummary {
  skillVersionId: string;
  skillId: string;
  name: string;
  description: string;
  version: string;
  allowedTools: string[];
  contentFingerprint: string;
  hasScripts: boolean;
  warnings: string[];
  createdAt: string;
}

export interface ImportSkillPayload {
  /** Full SKILL.md source text (frontmatter + body). */
  skillMd: string;
}

/** Permission surface change between skill versions (搂9.3 reapproval). */
export interface SkillPermissionDiffSummary {
  requiresReapproval: boolean;
  addedTools: string[];
  removedTools: string[];
  scriptsAdded: boolean;
  scriptsRemoved: boolean;
  summary: string;
  label: string;
  previousVersion?: string;
  previousSkillVersionId?: string;
}

export interface ImportSkillResponse {
  skill: SkillVersionSummary;
  /** True when an identical content fingerprint already existed. */
  deduped: boolean;
  /** Diff vs previous same-name skill version (if any). */
  permissionDiff?: SkillPermissionDiffSummary;
  /** When 搂9.3 requires reapproval, an Approval Center item is enqueued. */
  reapprovalRequest?: ApprovalRequestSummary;
}

export interface ListSkillsPayload {
  limit?: number;
}

export interface ListSkillsResponse {
  skills: SkillVersionSummary[];
}

// --- MCP server registry (搂9.3 authz skeleton; register does not spawn) ---

export interface McpToolSchemaSummary {
  name: string;
  description: string;
  inputSchemaJson?: string;
}

export interface McpServerSummary {
  mcpServerId: string;
  name: string;
  transport: 'local-stdio' | 'remote-http' | string;
  endpoint: string;
  tools: McpToolSchemaSummary[];
  trusted: boolean;
  maxOutputBytes: number;
  timeoutMs: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterMcpServerPayload {
  name: string;
  transport?: 'local-stdio' | 'remote-http' | string;
  endpoint?: string;
  tools?: McpToolSchemaSummary[];
  trusted?: boolean;
  maxOutputBytes?: number;
  timeoutMs?: number;
  notes?: string;
}

export interface RegisterMcpServerResponse {
  server: McpServerSummary;
  /** True when an existing name+endpoint row was updated in place. */
  updated: boolean;
}

export interface ListMcpServersPayload {
  limit?: number;
}

export interface ListMcpServersResponse {
  servers: McpServerSummary[];
}

// --- MCP process policy probe (搂9.3 size/timeout/untrusted/audit; no real spawn) ---

export interface ProbeMcpPolicyPayload {
  /** Optional registered server id; when set, policy fields load from registry. */
  mcpServerId?: string;
  /** Override / ad-hoc policy when server id omitted or for dry-run. */
  maxOutputBytes?: number;
  timeoutMs?: number;
  trusted?: boolean;
  /** Simulated tool name for audit labeling. */
  toolName?: string;
  /** Simulated process output (never executed as code). */
  simulatedOutput?: string;
  /** Simulated elapsed ms for timeout checks. */
  simulatedElapsedMs?: number;
  transport?: string;
}

export interface ProbeMcpPolicyResponse {
  ok: boolean;
  timedOut: boolean;
  truncated: boolean;
  contentTrust: 'trusted' | 'untrusted';
  rawBytes: number;
  keptBytes: number;
  maxOutputBytes: number;
  timeoutMs: number;
  trusted: boolean;
  policyLabel: string;
  preview: string;
  auditNote: string;
  /** True when FakeMcpWorker path used; real spawn never performed. */
  simulated: true;
  mcpServerId?: string;
  toolName: string;
}

// --- MCP tool request 鈫?Approval Center (搂9.3 / 搂13; no real spawn) ---

export interface RequestMcpToolPayload {
  /** Registered MCP server id (preferred). */
  mcpServerId?: string;
  /** Tool name to request (never executed in soft craft). */
  toolName: string;
  /** Optional JSON arguments preview for audit (not executed). */
  argumentsJson?: string;
  /** Approval mode override; default request. */
  mode?: import('@sync-think/shared').ApprovalMode | string;
  /** Force treat as sensitive even if trusted low-risk. */
  forceSensitive?: boolean;
  workspaceId?: import('@sync-think/shared').WorkspaceId;
  taskId?: import('@sync-think/shared').TaskId;
  runId?: import('@sync-think/shared').RunId;
  stepId?: import('@sync-think/shared').StepId;
  agentVersionId?: import('@sync-think/shared').AgentVersionId;
  /** When true, still enqueue even if gate would auto-approve. */
  forceEnqueue?: boolean;
}

export interface RequestMcpToolResponse {
  /** Sensitivity evaluation for observability. */
  sensitivity: {
    sensitive: boolean;
    reasons: string[];
    labelZh: string;
    toolOnCatalog: boolean;
  };
  evaluation: EvaluateApprovalResponse;
  /** True when an Approval Center item was created. */
  enqueued: boolean;
  /** True when policy auto-approved without queue. */
  autoApproved: boolean;
  /** False when an orchestration request fails exact persisted authorization. */
  authorized: boolean;
  refuseReason?: string;
  /** Always true in soft craft 鈥?never spawns a process. */
  simulated: true;
  /** Enqueued approval summary when enqueued. */
  approvalRequest?: ApprovalRequestSummary;
  mcpServerId?: string;
  serverName?: string;
  toolName: string;
  trusted: boolean;
}

// --- MCP real local-stdio spawn probe (搂9.3 / 搂14; process host only, no JSON-RPC tools) ---

export interface ProbeMcpSpawnPayload {
  /** Registered server id; preferred 鈥?endpoint/policy load from registry. */
  mcpServerId?: string;
  /** Ad-hoc local command line when server id omitted (allowlisted binaries only). */
  endpoint?: string;
  transport?: 'local-stdio' | string;
  maxOutputBytes?: number;
  timeoutMs?: number;
  trusted?: boolean;
  /** Optional stdin text closed after write. */
  stdinText?: string;
}

export interface ProbeMcpSpawnResponse {
  ok: boolean;
  timedOut: boolean;
  truncated: boolean;
  contentTrust: 'trusted' | 'untrusted';
  rawBytes: number;
  keptBytes: number;
  maxOutputBytes: number;
  timeoutMs: number;
  trusted: boolean;
  policyLabel: string;
  preview: string;
  auditNote: string;
  /** Always false 鈥?real process path (or refused before spawn). */
  simulated: false;
  spawned: boolean;
  exitCode: number | null;
  signal: string | null;
  elapsedMs: number;
  command: string;
  args: string[];
  refuseReason?: string;
  mcpServerId?: string;
  endpoint?: string;
  transport: string;
}

// --- MCP real tool call via JSON-RPC (搂9.3 / 搂13 / 搂14) ---
// Gates: Agent allowlist 鈫?sensitivity 鈫?approval (or priorApprovalId) 鈫?LocalStdio spawn + tools/call

export interface CallMcpToolPayload {
  /** Registered MCP server id (required for allowlist authz). */
  mcpServerId: string;
  /** Tool name to invoke via tools/call. */
  toolName: string;
  /** Optional JSON string of tool arguments object. */
  argumentsJson?: string;
  /** Approval mode; sensitive tools default to request. */
  mode?: import('@sync-think/shared').ApprovalMode | string;
  forceSensitive?: boolean;
  /** When true, still enqueue approval even if auto-approve. */
  forceEnqueue?: boolean;
  /**
   * When set, skip enqueue and execute only if this approval is already approved
   * for the same server+tool (human decide path).
   */
  priorApprovalId?: string;
  /**
   * When true and gate would auto-approve (trusted low-risk), execute immediately.
   * Default true for non-sensitive; sensitive always needs priorApprovalId or enqueues.
   */
  executeIfAutoApproved?: boolean;
  workspaceId: import('@sync-think/shared').WorkspaceId;
  taskId: import('@sync-think/shared').TaskId;
  runId: import('@sync-think/shared').RunId;
  stepId: import('@sync-think/shared').StepId;
  agentVersionId: import('@sync-think/shared').AgentVersionId;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

export interface CallMcpToolResponse {
  sensitivity: {
    sensitive: boolean;
    reasons: string[];
    labelZh: string;
    toolOnCatalog: boolean;
  };
  evaluation: EvaluateApprovalResponse;
  /** True when Approval Center item created (no execution). */
  enqueued: boolean;
  /** True when policy auto-approved. */
  autoApproved: boolean;
  /** True when JSON-RPC tools/call was actually run. */
  executed: boolean;
  /** Always false on the real call path (or refuse). */
  simulated: false;
  approvalRequest?: ApprovalRequestSummary;
  mcpServerId: string;
  serverName?: string;
  toolName: string;
  trusted: boolean;
  /** Agent allowlist check. */
  onAgentAllowlist: boolean;
  refuseReason?: string;
  /** Present when executed. */
  result?: {
    ok: boolean;
    timedOut: boolean;
    truncated: boolean;
    contentTrust: 'trusted' | 'untrusted';
    rawBytes: number;
    keptBytes: number;
    policyLabel: string;
    preview: string;
    auditNote: string;
    spawned: boolean;
    exitCode: number | null;
    elapsedMs: number;
    command: string;
    jsonRpcOk: boolean;
    toolResultText: string;
    protocol: 'mcp-jsonrpc';
  };
}

// --- MCP tools/list refresh (搂9.3 discovery; real JSON-RPC, no tool execution) ---
// Spawns local-stdio server, initialize 鈫?tools/list, persists tool schemas on registry.

export interface RefreshMcpToolsPayload {
  /** Registered MCP server id (required). */
  mcpServerId: string;
  /** Optional policy overrides for the short discovery process. */
  maxOutputBytes?: number;
  timeoutMs?: number;
  /** Max tools to keep from tools/list (default 64, hard cap 200). */
  maxTools?: number;
}

export interface RefreshMcpToolsResponse {
  ok: boolean;
  /** Always false 鈥?real discovery path (or refuse before spawn). */
  simulated: false;
  spawned: boolean;
  jsonRpcOk: boolean;
  timedOut: boolean;
  truncated: boolean;
  contentTrust: 'trusted' | 'untrusted';
  mcpServerId: string;
  serverName?: string;
  endpoint?: string;
  transport: string;
  /** Tool catalog after refresh (empty on failure). */
  tools: McpToolSchemaSummary[];
  previousToolCount: number;
  toolCount: number;
  /** Names added vs previous catalog. */
  addedToolNames: string[];
  /** Names removed vs previous catalog. */
  removedToolNames: string[];
  policyLabel: string;
  preview: string;
  auditNote: string;
  elapsedMs: number;
  command: string;
  args: string[];
  refuseReason?: string;
  /** Updated server summary when ok. */
  server?: McpServerSummary;
}

// --- Context Packet peek (read-only inspect; no run side effects) ---

export interface PeekContextPacketPayload {
  threadId: ThreadId;
  /** Optional run override model (ModelId or providerModelId string). */
  modelId?: ModelId | string;
  credentialRefId?: CredentialRefId;
  agentVersionId?: AgentVersionId;
  /**
   * Optional probe text used only for message-excerpt token estimate.
   * Defaults to a fixed preview label on the Runtime.
   */
  userText?: string;
}

export interface PeekContextSourceItem {
  id: string;
  kind: string;
  tokenEstimate: number;
}

export interface PeekContextSummaryItem {
  sourceId: string;
  summary: string;
}

export interface PeekContextTruncationItem {
  sourceId: string;
  reason: string;
  beforeTokens: number;
  afterTokens: number;
}

/** Response mirrors context.packet.built inspect fields for Manifest UI. */
export interface PeekContextPacketResponse {
  threadId: ThreadId;
  packetId: string;
  proofHash: string;
  modelId: string;
  providerModelId?: string;
  resolutionSource?: string;
  credentialRefId?: string;
  credentialResolutionSource?: string;
  agentVersionId?: string;
  /** Numeric AgentVersion.version for Manifest observability (搂10.3). */
  agentVersion?: number;
  /** Skill allowlist version ids bound on the Agent used for this packet (搂10.3). */
  skillVersionIds?: string[];
  /** MCP server allowlist ids bound on the Agent used for this packet (搂9.3 / 搂10.3). */
  mcpServerIds?: string[];
  /** Policy id bound on the Agent (versioned definition id; 搂10.3). */
  policyId?: string;
  includedSourceIds: string[];
  excludedSourceIds: string[];
  includedSources: PeekContextSourceItem[];
  excludedSources: PeekContextSourceItem[];
  summaries: PeekContextSummaryItem[];
  truncations: PeekContextTruncationItem[];
  crossTaskRefs: string[];
  evidenceRefsForMemory: string[];
  tokenEstimate: number;
  peekedAt: string;
}

// --- Context Packet amend (thread-scoped user overrides; 搂10.3) ---

export interface AmendContextPacketPayload {
  threadId: ThreadId;
  /**
   * Force-exclude these source ids from the next peek / run selection.
   * Protected kinds (搂20.9) are refused and reported; not silently dropped.
   * Pass [] with clearAll=false to set an empty override list.
   */
  excludeSourceIds?: string[];
  /**
   * When true, clear all thread-scoped amendments (restore automatic selection).
   * Takes precedence over excludeSourceIds.
   */
  clearAll?: boolean;
}

export interface AmendContextPacketResponse {
  threadId: ThreadId;
  /** Active force-exclude source ids after this amend. */
  excludeSourceIds: string[];
  /** Protected source ids that were requested but refused. */
  refusedProtectedIds: string[];
  amendedAt: string;
  cleared: boolean;
}

// --- Memory / Diagnostics (搂10.4 / 搂19) ---

export interface MemoryEntrySummary {
  id: string;
  key: string;
  value: string;
  targetScope: 'task' | 'project' | 'global';
}

export interface MemoryChangeSummary {
  id: import('@sync-think/shared').MemoryChangeId;
  workspaceId: import('@sync-think/shared').WorkspaceId;
  taskId: import('@sync-think/shared').TaskId;
  targetScope: 'task' | 'project' | 'global';
  additions: MemoryEntrySummary[];
  modifications: MemoryEntrySummary[];
  deprecations: string[];
  evidenceRefs: string[];
  confidence: number;
  unresolvedAmbiguity?: string;
  approvalState: 'pending' | 'approved' | 'rejected' | 'rolled_back';
  proposedByRunId?: import('@sync-think/shared').RunId;
  createdAt: string;
  decidedAt?: string;
}

export interface DurableMemoryEntrySummary {
  id: string;
  workspaceId: import('@sync-think/shared').WorkspaceId;
  taskId?: import('@sync-think/shared').TaskId;
  scope: 'task' | 'project' | 'global';
  key: string;
  value: string;
  sourceChangeId?: import('@sync-think/shared').MemoryChangeId;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListMemoryPayload {
  workspaceId?: import('@sync-think/shared').WorkspaceId;
  taskId?: import('@sync-think/shared').TaskId;
  approvalState?: 'pending' | 'approved' | 'rejected' | 'rolled_back';
  limit?: number;
}

export interface ListMemoryResponse {
  changes: MemoryChangeSummary[];
  entries: DurableMemoryEntrySummary[];
}

export interface ProposeMemoryPayload {
  workspaceId?: import('@sync-think/shared').WorkspaceId;
  taskId: import('@sync-think/shared').TaskId;
  targetScope?: 'task' | 'project' | 'global';
  additions?: MemoryEntrySummary[];
  modifications?: MemoryEntrySummary[];
  deprecations?: string[];
  evidenceRefs?: string[];
  confidence?: number;
  unresolvedAmbiguity?: string;
  proposedByRunId?: import('@sync-think/shared').RunId;
  autoApprove?: boolean;
}

export interface ProposeMemoryResponse {
  change: MemoryChangeSummary;
  /** When change is pending human approval, mirrored into Approval Center. */
  approvalRequest?: ApprovalRequestSummary;
}

export interface DecideMemoryPayload {
  changeId: import('@sync-think/shared').MemoryChangeId;
  decision: 'approved' | 'rejected';
}

export interface DecideMemoryResponse {
  change: MemoryChangeSummary;
}

export interface RollbackMemoryPayload {
  changeId: import('@sync-think/shared').MemoryChangeId;
}

export interface RollbackMemoryResponse {
  change: MemoryChangeSummary;
}

// --- Scoped approval policies ---

export type PolicyScopeType =
  'user' | 'workspace' | 'project' | 'task' | 'agent' | 'workflow' | 'run';

export interface PolicyScopeRef {
  scopeType: PolicyScopeType;
  scopeId: string;
}

export interface PolicyRuleSummary {
  action: string;
  approvalMode: ApprovalMode;
  delegateAgentVersionId?: import('@sync-think/shared').AgentVersionId;
}

export interface PolicyVersionSummary extends PolicyScopeRef {
  id: string;
  policyId: string;
  version: number;
  approvalMode: ApprovalMode;
  rules: PolicyRuleSummary[];
  createdAt: string;
}

export interface SavePolicyPayload extends PolicyScopeRef {
  /** Server validates every requested scope inside this workspace boundary. */
  workspaceId: WorkspaceId;
  policyId?: string;
  approvalMode: ApprovalMode;
  rules?: PolicyRuleSummary[];
}

export interface SavePolicyResponse {
  policy: PolicyVersionSummary;
}

export interface ListPoliciesPayload {
  /** Runtime derives the applicable scope chain; clients cannot submit raw scopes. */
  workspaceId: WorkspaceId;
  taskId?: TaskId;
  agentId?: import('@sync-think/shared').AgentId;
}

export interface ResolvedPolicySummary {
  approvalMode: ApprovalMode;
  rules: PolicyRuleSummary[];
}

export interface ListPoliciesResponse {
  policies: PolicyVersionSummary[];
  resolved: ResolvedPolicySummary;
}

// --- Approval Center (搂13 / 搂15.1 item 8) ---

export type ApprovalRequestKindSummary =
  | 'plan'
  | 'tool'
  | 'memory'
  | 'export'
  | 'skill-permission'
  | 'mcp-permission'
  | 'human-only'
  | 'other';

export type ApprovalRequestStateSummary = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequestSummary {
  id: import('@sync-think/shared').ApprovalRequestId;
  workspaceId: import('@sync-think/shared').WorkspaceId;
  taskId?: import('@sync-think/shared').TaskId;
  runId?: import('@sync-think/shared').RunId;
  stepId?: import('@sync-think/shared').StepId;
  kind: ApprovalRequestKindSummary;
  action: string;
  summary: string;
  humanOnly: boolean;
  humanOnlyAction?: string;
  mode: import('@sync-think/shared').ApprovalMode;
  gate: string;
  state: ApprovalRequestStateSummary;
  decidedBy?: 'human' | 'delegate' | 'auto' | 'system';
  /** Exact immutable AgentVersion configured for delegated approval. */
  delegateAgentVersionId?: import('@sync-think/shared').AgentVersionId;
  decisionNote?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface ListApprovalsPayload {
  workspaceId?: import('@sync-think/shared').WorkspaceId;
  taskId?: import('@sync-think/shared').TaskId;
  state?: ApprovalRequestStateSummary;
  humanOnly?: boolean;
  limit?: number;
}

export interface ListApprovalsResponse {
  items: ApprovalRequestSummary[];
  pendingCount: number;
  humanOnlyActions: string[];
  modes: import('@sync-think/shared').ApprovalMode[];
}

export interface EvaluateApprovalPayload {
  workspaceId?: import('@sync-think/shared').WorkspaceId;
  taskId?: import('@sync-think/shared').TaskId;
  runId?: import('@sync-think/shared').RunId;
  stepId?: import('@sync-think/shared').StepId;
  agentVersionId?: import('@sync-think/shared').AgentVersionId;
  mode?: import('@sync-think/shared').ApprovalMode | string;
  action: string;
  kind?: ApprovalRequestKindSummary | string;
  insideExplicitPolicy?: boolean;
  delegateAvailable?: boolean;
}

export interface EvaluateApprovalResponse {
  gate: 'auto-approve' | 'require-human' | 'require-delegate' | 'deny';
  humanOnly: boolean;
  humanOnlyAction?: string;
  mode: import('@sync-think/shared').ApprovalMode;
  reason: string;
  labelZh: string;
  /** SHA-256 over the server-validated actor, scope, AgentVersion, kind, and action. */
  actionDigest?: string;
  /** Exact server-validated approval Agent version for require-delegate. */
  delegateAgentVersionId?: import('@sync-think/shared').AgentVersionId;
}

export interface EnqueueApprovalPayload {
  workspaceId?: import('@sync-think/shared').WorkspaceId;
  taskId?: import('@sync-think/shared').TaskId;
  runId?: import('@sync-think/shared').RunId;
  stepId?: import('@sync-think/shared').StepId;
  agentVersionId?: import('@sync-think/shared').AgentVersionId;
  kind?: ApprovalRequestKindSummary | string;
  action: string;
  summary?: string;
  mode?: import('@sync-think/shared').ApprovalMode | string;
  insideExplicitPolicy?: boolean;
  delegateAvailable?: boolean;
  /** Force enqueue even if gate is auto-approve (for observability demos). */
  forceEnqueue?: boolean;
  metadata?: Record<string, unknown>;
}

export interface EnqueueApprovalResponse {
  evaluation: EvaluateApprovalResponse;
  /** Present when gate requires human (or forceEnqueue). */
  item?: ApprovalRequestSummary;
  enqueued: boolean;
  autoApproved: boolean;
}

export interface DecideApprovalPayload {
  id: import('@sync-think/shared').ApprovalRequestId;
  decision: 'approved' | 'rejected';
  decidedBy?: 'human' | 'delegate';
  delegateAgentVersionId?: import('@sync-think/shared').AgentVersionId;
  decisionNote?: string;
}

export interface DecideApprovalResponse {
  item: ApprovalRequestSummary;
  /**
   * When a skill-permission request is approved, Runtime may auto-bind the
   * approved Skill version onto the default Agent allowlist (搂9.1 / 搂9.3).
   * Import alone never allowlists; only human approval after reapproval does.
   */
  skillAllowlist?: {
    bound: boolean;
    agentId?: string;
    skillVersionId?: string;
    agentVersionId?: string;
    previousSkillVersionId?: string;
    /** Chinese / short reason when not bound. */
    reason?: string;
  };
  /**
   * When an mcp-permission request with executeOnApprove metadata is approved,
   * Runtime may run the real JSON-RPC tool call and return the result here.
   */
  mcpToolCall?: CallMcpToolResponse;
}

export interface DiagnosticSummary {
  id: string;
  workspaceId: import('@sync-think/shared').WorkspaceId;
  taskId?: import('@sync-think/shared').TaskId;
  runId?: import('@sync-think/shared').RunId;
  category: string;
  failureClass?: string;
  summary: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface ListDiagnosticsPayload {
  workspaceId?: import('@sync-think/shared').WorkspaceId;
  taskId?: import('@sync-think/shared').TaskId;
  runId?: import('@sync-think/shared').RunId;
  limit?: number;
}

export interface ListDiagnosticsResponse {
  diagnostics: DiagnosticSummary[];
}

export interface GroupMemberInput {
  agentVersionId: AgentVersionId;
  responsibility: string;
}

export interface CreateGroupPayload {
  name: string;
  description?: string;
  kind: GroupKind;
  visualIdentity?: GroupVisualIdentity;
  leadAgentVersionId: AgentVersionId;
  approvalMode?: ApprovalMode;
  collaborationMode?: GroupCollaborationMode;
  maxConcurrency?: number;
  members: GroupMemberInput[];
}

export interface CreateGroupResponse {
  group: GroupDefinition;
}

export interface GetGroupPayload {
  groupId: GroupId;
}

export interface GetGroupResponse {
  group: GroupDefinition;
}

export interface ListGroupsPayload {
  kind?: GroupKind;
  limit?: number;
}

export interface ListGroupsResponse {
  groups: GroupDefinition[];
}

export interface UpdateGroupPayload {
  groupId: GroupId;
  expectedVersion: number;
  name?: string;
  description?: string;
  kind?: GroupKind;
  visualIdentity?: GroupVisualIdentity;
  leadAgentVersionId?: AgentVersionId;
  approvalMode?: ApprovalMode;
  collaborationMode?: GroupCollaborationMode;
  maxConcurrency?: number;
  members?: GroupMemberInput[];
}

export interface UpdateGroupResponse {
  group: GroupDefinition;
}

export interface AddGroupMemberPayload {
  groupId: GroupId;
  expectedVersion: number;
  member: GroupMemberInput;
}

export interface RemoveGroupMemberPayload {
  groupId: GroupId;
  expectedVersion: number;
  agentVersionId: AgentVersionId;
}

export interface UpdateGroupMemberResponsibilityPayload {
  groupId: GroupId;
  expectedVersion: number;
  agentVersionId: AgentVersionId;
  responsibility: string;
}

export interface SetGroupLeadPayload {
  groupId: GroupId;
  expectedVersion: number;
  agentVersionId: AgentVersionId;
}

export type GroupMemberMutationResponse = UpdateGroupResponse;

export interface CreateGroupTaskPayload extends Omit<CreateTaskPayload, 'parentTaskId'> {
  groupId: GroupId;
  parentTaskId?: TaskId;
}

export interface CreateGroupTaskResponse extends CreateTaskResponse {
  groupId: GroupId;
}

export interface ResolveApplicationToolConfirmationPayload {
  confirmationId: string;
  threadId: ThreadId;
}

export interface ConfirmApplicationToolResponse {
  confirmationId: string;
  status: 'confirmed' | 'failed';
  command: CommandType;
  result?: unknown;
  errorSummary?: string;
  auditEventId: string;
}

export interface RejectApplicationToolResponse {
  confirmationId: string;
  status: 'rejected';
  command: CommandType;
  auditEventId: string;
}

export interface CreateAutomationPayload {
  name: string;
  workspaceId: WorkspaceId;
  target: AutomationTarget;
  instruction: string;
  approvalMode?: ApprovalMode;
  trigger: AutomationTriggerInput;
  timezone?: string;
  concurrencyPolicy?: AutomationConcurrencyPolicy;
  maxConcurrency?: number;
  maxRetries?: number;
  enabled?: boolean;
}

export type AutomationTriggerInput = { type: 'cron'; expression: string } | { type: 'webhook' };

export interface UpdateAutomationPayload extends CreateAutomationPayload {
  automationId: AutomationId;
  expectedVersion: number;
}

export interface DeleteAutomationPayload {
  automationId: AutomationId;
  expectedVersion: number;
}

export interface GetAutomationPayload {
  automationId: AutomationId;
}

export interface ListAutomationsPayload {
  workspaceId?: WorkspaceId;
  includeDisabled?: boolean;
  limit?: number;
}

export interface TriggerAutomationPayload {
  automationId: AutomationId;
  input?: string;
}

export interface ListAutomationExecutionsPayload {
  automationId?: AutomationId;
  limit?: number;
}

export interface AutomationRuntimeStatus {
  schedulerAvailable: boolean;
  webhookAvailable: boolean;
  webhookBaseUrl?: string;
}

export interface AutomationCommandResponse {
  automation: AutomationDefinition;
  webhookUrl?: string;
  webhookSecret?: string;
}

export interface ListAutomationsResponse {
  automations: AutomationDefinition[];
  runtime: AutomationRuntimeStatus;
}

export interface GetAutomationResponse extends AutomationCommandResponse {
  executions: AutomationExecution[];
}

export interface DeleteAutomationResponse {
  automation: AutomationDefinition;
}

export interface TriggerAutomationResponse {
  execution: AutomationExecution;
  taskId?: TaskId;
}

export interface ListAutomationExecutionsResponse {
  executions: AutomationExecution[];
}

export type PauseResumeCancelResponse = {
  runId: RunId;
  state: import('@sync-think/shared').RunState;
};

// Helper: build a typed request envelope.
export function req<T>(
  type: CommandType,
  payload: T,
  requestId: string = ulid(),
): CommandRequest<T> {
  return { type, payload, requestId };
}
