// Runtime - long-lived Agent Runtime process entry. UI lifecycle independent:
// killing the UI must not terminate active Runs (design 锟?6 / 锟?).

import {
  pipePathPortable,
  encodeFrame,
  decodeFrames,
  getApplicationToolDefinition,
  HEADER_BYTES,
  MAX_FRAME_BYTES,
  type AppendMessageResponse,
  type BindWorkspaceFolderResponse,
  type BindWorkspaceGitRepositoryResponse,
  type ArchiveTaskResponse,
  type CreateTaskResponse,
  type DelegateSubtaskResponse,
  type RecordHandoffResponse,
  type ResolveWorktreeIntegrationResponse,
  type ListBrowserIdentitiesResponse,
  type CreateBrowserIdentityResponse,
  type UpdateBrowserIdentityResponse,
  type DeleteBrowserIdentityResponse,
  type SetTaskBrowserIdentityResponse,
  type DescribeTaskExecutionAccessResponse,
  type CreateWorkspaceResponse,
  type EventReplayPagePayload,
  type EventStreamStartedPayload,
  type Frame,
  type ListTasksResponse,
  type ListWorkspacesResponse,
  type OpenTaskResponse,
  type SearchTasksResponse,
  type SetParticipationModeResponse,
  type SetExecutionModeResponse,
  type UnarchiveTaskResponse,
  type DiscardEmptyTaskResponse,
  type SavePolicyResponse,
  type SavePolicyPayload,
  type ListPoliciesResponse,
  type ListPoliciesPayload,
  type PolicyScopeRef,
  type PolicyVersionSummary,
  type TaskSummary,
  type CreateProviderResponse,
  type UpdateProviderResponse,
  type PreviewCcSwitchImportResponse,
  type ImportCcSwitchResponse,
  type ListProvidersResponse,
  type DiscoverModelsResponse,
  type AddModelsResponse,
  type ProbeCapabilitiesResponse,
  type ConfirmCapabilitiesResponse,
  type CapabilityProbeSuggestion,
  type ProviderSummary,
  type ProviderModelSummary,
  type ProviderCredentialSummary,
  type GetAgentResponse,
  type UpdateAgentBindingResponse,
  type AgentBindingSummary,
  type AgentDefinitionSummary,
  type ListAgentsResponse,
  type CreateAgentResponse,
  type ListAgentVersionsResponse,
  type CreateAgentVersionResponse,
  type CreateGroupResponse,
  type GetGroupResponse,
  type ListGroupsResponse,
  type UpdateGroupResponse,
  type GroupMemberMutationResponse,
  type CreateGroupTaskResponse,
  type ImportSkillResponse,
  type SkillPermissionDiffSummary,
  type ListSkillsResponse,
  type SkillVersionSummary,
  type RegisterMcpServerResponse,
  type ListMcpServersResponse,
  type ProbeMcpPolicyResponse,
  type RequestMcpToolResponse,
  type ProbeMcpSpawnResponse,
  type CallMcpToolResponse,
  type RefreshMcpToolsResponse,
  type ListMemoryResponse,
  type ProposeMemoryResponse,
  type DecideMemoryResponse,
  type ListDiagnosticsResponse,
  type ListApprovalsResponse,
  type EvaluateApprovalResponse,
  type EnqueueApprovalResponse,
  type DecideApprovalResponse,
  type ApprovalRequestSummary,
  type PeekContextPacketResponse,
  type AmendContextPacketResponse,
  type MemoryChangeSummary,
  type DurableMemoryEntrySummary,
  type DiagnosticSummary,
  type PlanDraftResponse,
  type PlanReviseResponse,
  type PlanListRevisionsResponse,
  type PlanApproveResponse,
  type RunGetGraphResponse,
  type OrchestrationRunMutationPayload,
  type OrchestrationRunMutationResponse,
  type ListArtifactsResponse,
  type GetArtifactVersionResponse,
  type CompareArtifactVersionsResponse,
  type SelectArtifactVersionResponse,
  type MergeArtifactVersionsResponse,
  type ListArtifactMergeConflictsResponse,
  type ResolveArtifactMergeConflictResponse,
  type ConfirmApplicationToolResponse,
  type RejectApplicationToolResponse,
  type AutomationCommandResponse,
  type DeleteAutomationResponse,
  type GetAutomationResponse,
  type ListAutomationsResponse,
  type TriggerAutomationResponse,
  type ListAutomationExecutionsResponse,
  type CommandType,
} from '@sync-think/protocol';
import {
  ErrorCode,
  deriveTaskTitleFromPrompt,
  isUntitledTaskTitle,
  ulid,
  type Event,
  type EventCategory,
  type MessageId,
  type RunId,
  type StepId,
  type TaskId,
  type WorkspaceId,
  type ProviderId,
  type CredentialRefId,
  type ProtocolFamily,
  type CapabilityTag,
  type AgentId,
  type AgentVersionId,
  type ModelId,
  type ModelResolutionSource,
  type MemoryChangeId,
  type FailureClass,
  type ContextSourceRef,
  type ThreadId,
  type ParticipationMode,
  type ExecutionMode,
  type ArtifactVersion,
  type ArtifactVersionSummary,
  type AcceptanceGateId,
  type AutomationDefinition,
  type AutomationExecution,
  type AutomationTriggerSource,
  type BrowserIdentityId,
  type ApprovalMode,
} from '@sync-think/shared';
import { defaultSurfaceForProtocol, inferProviderSurface } from '@sync-think/shared';
import {
  WorkspacePathError,
  type CheckpointDraft,
  type CommitTransitionInput,
  type CommittedTransition,
  type EventDraft,
  type EventDraftBatch,
  type SqliteWorkspaceStore,
  type SqliteExecutionEnvironmentStore,
  type TaskRecord,
  type SqliteProviderStore,
  type ProviderCatalogEntry,
  type ModelRecord,
  type SqliteAgentStore,
  type SqliteGroupStore,
  type SqliteMemoryStore,
  type SqliteSkillStore,
  type SqliteMcpStore,
  type SqliteApprovalStore,
  type SqlitePolicyStore,
  type SqliteAuthorizationStore,
  type SqliteOrchestrationStore,
  type SqliteArtifactStore,
  type SqliteProductionExecutionStore,
  type SqliteUnitOfWork,
  type SqliteAutomationStore,
  type PolicyVersionRecord,
  type SkillVersionRecord,
  type MemoryChangeRecord,
  type DurableMemoryEntry,
  type DiagnosticRecord,
  DEFAULT_CONVERSATION_AGENT_ID,
  toModelBinding,
  defaultCcSwitchDbPath,
  loadCcSwitchProviderRows,
} from '@sync-think/storage';
import { mapCcSwitchProviderRow, toCcSwitchPreviewItem } from '@sync-think/core';
import type { SecureStore } from '@sync-think/secure-store';
import {
  buildContextPacket,
  selectContextSources,
  resolveCrossTaskRefs,
  resolveProjectMemorySources,
  resolveAllowedSkillSources,
  resolveAllowedMcpToolSources,
  applyUserContextAmendments,
  isProtectedSourceKind,
  resolveModelBinding,
  resolveCredentialRef,
  shouldAttemptFallback,
  suggestCapabilities,
  normalizeCapabilities,
  parseSkillMd,
  skillContentFingerprint,
  ParseSkillMdError,
  diffSkillPermissions,
  formatSkillPermissionDiffLabel,
  type AgentModelBinding,
  evaluateApproval,
  evaluateMcpToolSensitivity,
  listHumanOnlyActions,
  canTransitionMode,
  resolveScopedPolicy,
  resolveActionDecision,
  resolveCapabilityAccess,
  resolveEffectiveExecution,
  compareTextSnapshots,
  mergeTextSnapshots,
} from '@sync-think/core';
import { createHash, randomBytes } from 'node:crypto';
// cc-switch import helpers re-exported via core
import type { Socket } from 'node:net';
import type { ProviderContentPart, ProviderToolCall } from '@sync-think/adapters';
import {
  buildGroupCollaborationPlan,
  collectGroupCollaborationRunIds,
  isGroupDelegationDecisionStep,
  isGroupFinalSummaryStep,
  parseGroupDelegationDecision,
} from './group-collaboration.js';
import {
  applyDemoRunEvent,
  createDemoProviderRequest,
  createDemoRun,
  parseDemoRuns,
  projectAdapterEvent,
  resolveApplicationToolsEnabled,
  serializeDemoRuns,
  type DemoProvider,
  type DemoRunState,
} from './demo-run.js';
import { compileProviderContext, resolveSyncThinkSurface } from './provider-context.js';
import { ConfigurationCommandConfirmationGate } from './command-confirmation.js';
import { AutomationService } from './automation-service.js';
import { nextCronOccurrence } from './automation-schedule.js';
import type { TaskExecutionEnvironmentManager } from './task-execution-environment.js';
import {
  EXECUTION_TOOL_SCHEMAS,
  invokeExecutionTool,
  isExecutionToolName,
  isReadOnlyExecutionToolName,
} from './execution-tools.js';
import {
  loadImageAttachmentParts,
  prepareMessageAttachmentContext,
} from './message-attachments.js';
import {
  parseAppendMessagePayload,
  parseBindWorkspaceFolderPayload,
  parseBindWorkspaceGitRepositoryPayload,
  parseCancelRunPayload,
  parseContinueEventReplayPayload,
  parseArchiveTaskPayload,
  parseCreateTaskPayload,
  parseDelegateSubtaskPayload,
  parseRecordHandoffPayload,
  parseResolveWorktreeIntegrationPayload,
  parseListBrowserIdentitiesPayload,
  parseCreateBrowserIdentityPayload,
  parseUpdateBrowserIdentityPayload,
  parseDeleteBrowserIdentityPayload,
  parseSetTaskBrowserIdentityPayload,
  parseDescribeTaskExecutionAccessPayload,
  parseCreateWorkspacePayload,
  parseListTasksPayload,
  parseListWorkspacesPayload,
  parseOpenTaskPayload,
  parseSearchTasksPayload,
  parseSetParticipationModePayload,
  parseSetExecutionModePayload,
  parseUnarchiveTaskPayload,
  parseDiscardEmptyTaskPayload,
  parseSavePolicyPayload,
  parseListPoliciesPayload,
  parseSubscribeEventsPayload,
  parseUnsubscribeEventsPayload,
  parseCreateProviderPayload,
  parseUpdateProviderPayload,
  parsePreviewCcSwitchImportPayload,
  parseImportCcSwitchPayload,
  parseListProvidersPayload,
  parseDiscoverModelsPayload,
  parseAddModelsPayload,
  parseProbeCapabilitiesPayload,
  parseConfirmCapabilitiesPayload,
  parseGetAgentPayload,
  parseUpdateAgentBindingPayload,
  parseListAgentsPayload,
  parseCreateAgentPayload,
  parseListAgentVersionsPayload,
  parseCreateAgentVersionPayload,
  parseCreateGroupPayload,
  parseGetGroupPayload,
  parseListGroupsPayload,
  parseUpdateGroupPayload,
  parseAddGroupMemberPayload,
  parseRemoveGroupMemberPayload,
  parseUpdateGroupMemberResponsibilityPayload,
  parseSetGroupLeadPayload,
  parseCreateGroupTaskPayload,
  parseImportSkillPayload,
  parseListSkillsPayload,
  parseRegisterMcpServerPayload,
  parseListMcpServersPayload,
  parseProbeMcpPolicyPayload,
  parseRequestMcpToolPayload,
  parseProbeMcpSpawnPayload,
  parseCallMcpToolPayload,
  parseRefreshMcpToolsPayload,
  parseListMemoryPayload,
  parseProposeMemoryPayload,
  parseDecideMemoryPayload,
  parseRollbackMemoryPayload,
  parseListDiagnosticsPayload,
  parseListApprovalsPayload,
  parseEvaluateApprovalPayload,
  parseEnqueueApprovalPayload,
  parseDecideApprovalPayload,
  parsePeekContextPacketPayload,
  parseAmendContextPacketPayload,
  parsePlanDraftPayload,
  parsePlanRevisePayload,
  parsePlanListRevisionsPayload,
  parsePlanApprovePayload,
  parseRunGetGraphPayload,
  parsePauseRunPayload,
  parseResumeRunPayload,
  parseListArtifactsPayload,
  parseGetArtifactVersionPayload,
  parseCompareArtifactVersionsPayload,
  parseSelectArtifactVersionPayload,
  parseMergeArtifactVersionsPayload,
  parseListArtifactMergeConflictsPayload,
  parseResolveArtifactMergeConflictPayload,
  parseResolveApplicationToolConfirmationPayload,
  parseCreateAutomationPayload,
  parseUpdateAutomationPayload,
  parseDeleteAutomationPayload,
  parseGetAutomationPayload,
  parseListAutomationsPayload,
  parseTriggerAutomationPayload,
  parseListAutomationExecutionsPayload,
} from './command-validation.js';
import { createPipeServer, type PipeServerHandlers } from './pipe/server.js';
import { healthcheck, type HealthcheckResult, type HealthcheckError } from './healthcheck.js';
import { Scheduler } from './orchestration/scheduler.js';
import type { StepExecutor } from './orchestration/step-executor.js';
import {
  FakeMcpWorker,
  LocalStdioMcpWorker,
  formatMcpPolicyLabel,
  normalizeMcpProcessPolicy,
  previewMcpOutput,
  closePlaywrightBrowserWorkers,
} from '@sync-think/workers';

export interface RuntimeOptions {
  installId: string;
  helloSecret?: string;
  allowNoToken?: boolean;
  checkpoint?: RuntimeCheckpointSnapshot;
  stateStore?: RuntimeStateStore;
  workspaceStore?: SqliteWorkspaceStore;
  executionEnvironmentStore?: SqliteExecutionEnvironmentStore;
  taskEnvironmentManager?: TaskExecutionEnvironmentManager;
  workspaceId?: WorkspaceId;
  checkpointRunId?: RunId;
  demoProvider?: DemoProvider;
  providerStore?: SqliteProviderStore;
  agentStore?: SqliteAgentStore;
  groupStore?: SqliteGroupStore;
  memoryStore?: SqliteMemoryStore;
  approvalStore?: SqliteApprovalStore;
  policyStore?: SqlitePolicyStore;
  authorizationStore?: SqliteAuthorizationStore;
  orchestrationStore?: SqliteOrchestrationStore;
  artifactStore?: SqliteArtifactStore;
  productionExecutionStore?: SqliteProductionExecutionStore;
  unitOfWork?: SqliteUnitOfWork;
  automationStore?: SqliteAutomationStore;
  automationWebhookHost?: string;
  automationWebhookPort?: number;
  stepExecutor?: StepExecutor;
  skillStore?: SqliteSkillStore;
  mcpStore?: SqliteMcpStore;
  secureStore?: SecureStore;
  /** Server-owned plan readiness lookup; clients cannot assert plan approval. */
  hasApprovedPlan?: (taskId: TaskId) => boolean;
  /**
   * Protocol-family discovery adapters (OpenAI-compatible live adapters, etc.).
   * Preferred over the single discoveryAdapter when a protocol key matches.
   */
  discoveryByProtocol?: Partial<Record<ProtocolFamily, DemoProvider>>;
  /** Fallback discovery adapter; defaults to demoProvider when present (tests / Fake). */
  discoveryAdapter?: DemoProvider;
  /** Retry delays for an empty-output transient Provider outage before fallback. */
  providerRetryDelaysMs?: readonly number[];
}

export interface RuntimeStateStore {
  commitTransition(input: CommitTransitionInput): CommittedTransition;
  listEvents(workspaceId: WorkspaceId, afterSequence: number): Event[];
  /** Global durable stream used by Runtime replay; optional for legacy/test stores. */
  listAllEvents?(afterSequence: number): Event[];
  loadLatestCheckpoint(runId: RunId): import('@sync-think/shared').Checkpoint | undefined;
}

export interface RuntimeCheckpointSnapshot {
  eventSequence: number;
  threadVersions: Array<[threadId: string, version: number]>;
  events: Event[];
  createdAt: string;
}

interface ValidatedOrchestrationMcpScope {
  workspaceId: WorkspaceId;
  taskId: TaskId;
  runId: RunId;
  stepId: StepId;
  agentVersionId: AgentVersionId;
}

type OrchestrationMcpAuthorization =
  | { allowed: true; scope: ValidatedOrchestrationMcpScope }
  | {
      allowed: false;
      reason: string;
      scope?: ValidatedOrchestrationMcpScope;
    };

interface RuntimeEventSubscription {
  socket: Socket;
  phase: 'catching-up' | 'live';
  categories?: ReadonlySet<EventCategory>;
  highWatermark: number;
  replayCursor: number;
  replayIndex: number;
  liveCursor: number;
}

interface PendingAgentConfigurationCommand {
  id: string;
  toolCallId: string;
  toolName: string;
  command: CommandType;
  payload: Record<string, unknown>;
  confirmationToken: string;
  threadId: string;
  runId: RunId;
  agentVersionId: string;
  expiresAt: string;
}

const MAX_REPLAY_EVENTS_PER_PAGE = 64;
const MAX_REPLAY_SCANNED_EVENTS_PER_PAGE = 256;
const REPLAY_FRAME_RESERVE_BYTES = 1_024;
const MAX_APPLICATION_TOOL_TURNS = 8;
const MAX_APPLICATION_TOOL_ARGUMENT_BYTES = 64 * 1024;
const MAX_APPLICATION_TOOL_RESULT_BYTES = 24 * 1024;
const DEFAULT_PROVIDER_RETRY_DELAYS_MS = [400, 1_200] as const;
const DEFAULT_SUBTASK_RETRY_LIMIT = 5;

interface DelegatedSubtaskDescriptor {
  eventId: string;
  parentTaskId: TaskId;
  childTaskId: TaskId;
  childThreadId: ThreadId;
  delegateAgentVersionId: AgentVersionId;
  delegatingAgentVersionId: AgentVersionId;
  delegationBatchId: string;
  title: string;
  packet: import('@sync-think/protocol').SubtaskPacket;
}

function canonicalApprovalDetails(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (depth > 16) throw new Error('approval.action_details_too_deep');
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalApprovalDetails(entry, seen, depth + 1));
  }
  if (typeof value !== 'object') throw new Error('approval.action_details_invalid');
  if (seen.has(value)) throw new Error('approval.action_details_cycle');
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    result[key] = canonicalApprovalDetails(
      (value as Record<string, unknown>)[key],
      seen,
      depth + 1,
    );
  }
  seen.delete(value);
  return result;
}

class PolicyScopeBoundaryError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PolicyScopeBoundaryError';
  }
}

class PlanModeBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanModeBoundaryError';
  }
}

class PlanReviewerDependencyError extends Error {
  constructor(stepId: StepId, dependencyCount: number) {
    super(`review.reviewer_dependency_invalid: ${stepId} has ${dependencyCount} dependencies`);
    this.name = 'PlanReviewerDependencyError';
  }
}

class PlanReviewerLineageError extends Error {
  constructor(stepId: StepId, targetStepId: StepId) {
    super(`review.reviewer_lineage_invalid: ${stepId} targets planned reviewer ${targetStepId}`);
    this.name = 'PlanReviewerLineageError';
  }
}

export class Runtime {
  readonly startedAt = Date.now();
  readonly installId: string;
  private readonly handlers: PipeServerHandlers;
  private server: ReturnType<typeof createPipeServer> | null = null;
  private readonly inFlight = new Set<string>();
  private readonly threadVersions = new Map<string, number>();
  private readonly events: Event[] = [];
  private readonly subscriptions = new Map<string, RuntimeEventSubscription>();
  private readonly stateStore?: RuntimeStateStore;
  private readonly workspaceStore?: SqliteWorkspaceStore;
  private readonly executionEnvironmentStore?: SqliteExecutionEnvironmentStore;
  private readonly taskEnvironmentManager?: TaskExecutionEnvironmentManager;
  private readonly workspaceId: WorkspaceId;
  private readonly checkpointRunId: RunId;
  private readonly demoProvider?: DemoProvider;
  private readonly providerStore?: SqliteProviderStore;
  private readonly agentStore?: SqliteAgentStore;
  private readonly groupStore?: SqliteGroupStore;
  private readonly memoryStore?: SqliteMemoryStore;
  private readonly approvalStore?: SqliteApprovalStore;
  private readonly policyStore?: SqlitePolicyStore;
  private readonly authorizationStore?: SqliteAuthorizationStore;
  private readonly orchestrationStore?: SqliteOrchestrationStore;
  private readonly artifactStore?: SqliteArtifactStore;
  private readonly productionExecutionStore?: SqliteProductionExecutionStore;
  private readonly unitOfWork?: SqliteUnitOfWork;
  private readonly automationStore?: SqliteAutomationStore;
  private readonly automationService?: AutomationService;
  private readonly scheduler?: Scheduler;
  private readonly skillStore?: SqliteSkillStore;
  private readonly mcpStore?: SqliteMcpStore;
  private readonly secureStore?: SecureStore;
  private readonly hasApprovedPlan?: (taskId: TaskId) => boolean;
  private readonly discoveryByProtocol: Partial<Record<ProtocolFamily, DemoProvider>>;
  private readonly discoveryAdapter?: DemoProvider;
  private readonly providerRetryDelaysMs: readonly number[];
  private readonly demoRuns = new Map<string, DemoRunState>();
  private readonly demoRunAbortControllers = new Map<string, AbortController>();
  private readonly backgroundTasks = new Set<Promise<void>>();
  private readonly delegatedSubtaskStarting = new Set<string>();
  private readonly delegatedParentWaking = new Set<string>();
  private readonly configurationConfirmationGate = new ConfigurationCommandConfirmationGate();
  private readonly pendingAgentConfigurationCommands = new Map<
    string,
    PendingAgentConfigurationCommand
  >();
  /** Thread-scoped Manifest amendments (force-exclude source ids). In-memory for M1. */
  private readonly threadContextAmendments = new Map<string, { excludeSourceIds: string[] }>();
  private eventSequence = 0;

  constructor(opts: RuntimeOptions) {
    this.installId = opts.installId;
    this.stateStore = opts.stateStore;
    this.workspaceStore = opts.workspaceStore;
    this.executionEnvironmentStore = opts.executionEnvironmentStore;
    this.taskEnvironmentManager = opts.taskEnvironmentManager;
    this.workspaceId = opts.workspaceId ?? ('workspace-dev' as WorkspaceId);
    this.checkpointRunId = opts.checkpointRunId ?? (`runtime-${opts.installId}` as RunId);
    this.demoProvider = opts.demoProvider;
    this.providerStore = opts.providerStore;
    this.agentStore = opts.agentStore;
    this.groupStore = opts.groupStore;
    this.memoryStore = opts.memoryStore;
    this.approvalStore = opts.approvalStore;
    this.policyStore = opts.policyStore;
    this.authorizationStore = opts.authorizationStore;
    this.orchestrationStore = opts.orchestrationStore;
    this.artifactStore = opts.artifactStore;
    this.productionExecutionStore = opts.productionExecutionStore;
    this.unitOfWork = opts.unitOfWork;
    this.automationStore = opts.automationStore;
    this.scheduler =
      opts.orchestrationStore && opts.stepExecutor
        ? new Scheduler({
            store: opts.orchestrationStore,
            executor: opts.stepExecutor,
            approvalStore: opts.approvalStore,
            unitOfWork: opts.unitOfWork,
            approvalPolicy:
              opts.approvalStore && opts.unitOfWork
                ? {
                    evaluate: ({ runId, step, request }) => {
                      const graph = this.orchestrationStore?.getGraph(runId);
                      const task = graph
                        ? this.workspaceStore?.getTask(graph.run.taskId)
                        : undefined;
                      if (!graph || !task) {
                        throw new Error('scheduler.approval_scope_unavailable');
                      }
                      const resolved = this.resolveServerApproval({
                        workspaceId: task.workspaceId,
                        taskId: task.id,
                        runId,
                        stepId: step.id,
                        agentVersionId: step.agentVersionId,
                        action: request.action,
                        kind: request.kind,
                        actionDetails: request.details,
                      }).evaluation;
                      return {
                        workspaceId: task.workspaceId,
                        taskId: task.id,
                        gate: resolved.gate,
                        humanOnly: resolved.humanOnly,
                        humanOnlyAction: resolved.humanOnlyAction as never,
                        mode: resolved.mode,
                        reason: resolved.reason,
                        labelZh: resolved.labelZh,
                        delegateAgentVersionId: resolved.delegateAgentVersionId,
                      };
                    },
                    validateDelegateAgentVersion: (agentVersionId) => {
                      const delegate = this.agentStore?.getVersion(agentVersionId);
                      return delegate?.role.trim().toLowerCase() === 'approval';
                    },
                  }
                : undefined,
          })
        : undefined;
    this.skillStore = opts.skillStore;
    this.mcpStore = opts.mcpStore;
    this.secureStore = opts.secureStore;
    this.hasApprovedPlan =
      opts.hasApprovedPlan ??
      ((taskId) => this.orchestrationStore?.hasApprovedPlan(taskId) === true);
    this.discoveryByProtocol = opts.discoveryByProtocol ?? {};
    this.discoveryAdapter = opts.discoveryAdapter ?? opts.demoProvider;
    this.providerRetryDelaysMs = (opts.providerRetryDelaysMs ?? DEFAULT_PROVIDER_RETRY_DELAYS_MS)
      .slice(0, 5)
      .map((delay) => Math.max(0, Math.min(30_000, Math.floor(delay))));
    if (opts.checkpoint) {
      this.restoreCheckpoint(opts.checkpoint);
    } else if (this.stateStore) {
      this.restorePersistedState();
    }
    if (this.stateStore) this.recoverUnresolvedApplicationToolConfirmations();
    this.handlers = {
      expectedInstallId: opts.installId,
      expectedSecret: opts.helloSecret,
      allowNoToken: opts.allowNoToken,
      onReady: (address) => {
        console.log('[runtime] pipe ready', address);
      },
      onClientHello: (_socket, _hello, result) => {
        if (!result.ok) {
          console.warn('[runtime] hello rejected', result.error.code);
        } else {
          console.log('[runtime] hello accepted');
        }
      },
      onClientGone: (socket) => {
        for (const [streamId, subscription] of this.subscriptions) {
          if (subscription.socket === socket) this.subscriptions.delete(streamId);
        }
        if (!socket.destroyed) socket.destroy();
      },
      onFrame: (socket, frame: Frame) => {
        if (frame.type === 'runtime.healthcheck') {
          const hc = this.currentHealthcheck();
          socket.write(
            encodeFrame({
              id: frame.id,
              kind: 'response',
              type: 'runtime.healthcheck',
              payload: hc,
            }),
          );
          return;
        }
        if (frame.type === 'runtime.subscribeEvents') {
          this.handleSubscribeEvents(socket, frame);
          return;
        }
        if (frame.type === 'runtime.continueEventReplay') {
          this.handleContinueEventReplay(socket, frame);
          return;
        }
        if (frame.type === 'runtime.unsubscribeEvents') {
          this.handleUnsubscribeEvents(socket, frame);
          return;
        }
        if (frame.type === 'application.tool.confirm') {
          void this.handleConfirmApplicationTool(socket, frame);
          return;
        }
        if (frame.type === 'application.tool.reject') {
          this.handleRejectApplicationTool(socket, frame);
          return;
        }
        if (this.handleConfigurationConfirmation(socket, frame)) return;
        if (frame.type === 'workspace.create') {
          this.handleCreateWorkspace(socket, frame);
          return;
        }
        if (frame.type === 'workspace.bindFolder') {
          this.handleBindWorkspaceFolder(socket, frame);
          return;
        }
        if (frame.type === 'workspace.bindGitRepository') {
          this.handleBindWorkspaceGitRepository(socket, frame);
          return;
        }
        if (frame.type === 'workspace.list') {
          this.handleListWorkspaces(socket, frame);
          return;
        }
        if (frame.type === 'browserIdentity.list') {
          this.handleListBrowserIdentities(socket, frame);
          return;
        }
        if (frame.type === 'browserIdentity.create') {
          this.handleCreateBrowserIdentity(socket, frame);
          return;
        }
        if (frame.type === 'browserIdentity.update') {
          this.handleUpdateBrowserIdentity(socket, frame);
          return;
        }
        if (frame.type === 'browserIdentity.delete') {
          this.handleDeleteBrowserIdentity(socket, frame);
          return;
        }
        if (frame.type === 'task.create') {
          this.handleCreateTask(socket, frame);
          return;
        }
        if (frame.type === 'task.delegateSubtask') {
          this.handleDelegateSubtask(socket, frame);
          return;
        }
        if (frame.type === 'task.recordHandoff') {
          this.handleRecordHandoff(socket, frame);
          return;
        }
        if (frame.type === 'task.resolveWorktreeIntegration') {
          this.handleResolveWorktreeIntegration(socket, frame);
          return;
        }
        if (frame.type === 'task.setBrowserIdentity') {
          this.handleSetTaskBrowserIdentity(socket, frame);
          return;
        }
        if (frame.type === 'task.describeExecutionAccess') {
          this.handleDescribeTaskExecutionAccess(socket, frame);
          return;
        }
        if (frame.type === 'task.list') {
          this.handleListTasks(socket, frame);
          return;
        }
        if (frame.type === 'task.open') {
          this.handleOpenTask(socket, frame);
          return;
        }
        if (frame.type === 'task.search') {
          this.handleSearchTasks(socket, frame);
          return;
        }
        if (frame.type === 'task.setParticipationMode') {
          this.handleSetParticipationMode(socket, frame);
          return;
        }
        if (frame.type === 'task.setExecutionMode') {
          this.handleSetExecutionMode(socket, frame);
          return;
        }
        if (frame.type === 'task.archive') {
          this.handleArchiveTask(socket, frame);
          return;
        }
        if (frame.type === 'task.unarchive') {
          this.handleUnarchiveTask(socket, frame);
          return;
        }
        if (frame.type === 'task.discardEmpty') {
          this.handleDiscardEmptyTask(socket, frame);
          return;
        }
        if (frame.type === 'task.appendMessage') {
          this.handleAppendMessage(socket, frame);
          return;
        }
        if (frame.type === 'plan.draft') {
          this.handlePlanDraft(socket, frame);
          return;
        }
        if (frame.type === 'plan.revise') {
          this.handlePlanRevise(socket, frame);
          return;
        }
        if (frame.type === 'plan.listRevisions') {
          this.handlePlanListRevisions(socket, frame);
          return;
        }
        if (frame.type === 'plan.approve') {
          this.handlePlanApprove(socket, frame);
          return;
        }
        if (frame.type === 'run.getGraph') {
          this.handleRunGetGraph(socket, frame);
          return;
        }
        if (frame.type === 'run.pause') {
          this.handlePauseRun(socket, frame);
          return;
        }
        if (frame.type === 'run.resume') {
          this.handleResumeRun(socket, frame);
          return;
        }
        if (frame.type === 'run.cancel') {
          this.handleCancelRun(socket, frame);
          return;
        }
        if (frame.type === 'artifact.list') {
          this.handleListArtifacts(socket, frame);
          return;
        }
        if (frame.type === 'artifact.getVersion') {
          this.handleGetArtifactVersion(socket, frame);
          return;
        }
        if (frame.type === 'artifact.compare') {
          this.handleCompareArtifactVersions(socket, frame);
          return;
        }
        if (frame.type === 'artifact.selectVersion') {
          this.handleSelectArtifactVersion(socket, frame);
          return;
        }
        if (frame.type === 'artifact.merge') {
          this.handleMergeArtifactVersions(socket, frame);
          return;
        }
        if (frame.type === 'artifact.listConflicts') {
          this.handleListArtifactMergeConflicts(socket, frame);
          return;
        }
        if (frame.type === 'artifact.resolveConflict') {
          this.handleResolveArtifactMergeConflict(socket, frame);
          return;
        }
        if (frame.type === 'provider.create') {
          void this.handleCreateProvider(socket, frame);
          return;
        }
        if (frame.type === 'provider.update') {
          void this.handleUpdateProvider(socket, frame);
          return;
        }
        if (frame.type === 'provider.previewCcSwitchImport') {
          this.handlePreviewCcSwitchImport(socket, frame);
          return;
        }
        if (frame.type === 'provider.importCcSwitch') {
          void this.handleImportCcSwitch(socket, frame);
          return;
        }
        if (frame.type === 'provider.list') {
          this.handleListProviders(socket, frame);
          return;
        }
        if (frame.type === 'provider.discoverModels') {
          void this.handleDiscoverModels(socket, frame);
          return;
        }
        if (frame.type === 'provider.addModels') {
          this.handleAddModels(socket, frame);
          return;
        }
        if (frame.type === 'provider.probeCapabilities') {
          this.handleProbeCapabilities(socket, frame);
          return;
        }
        if (frame.type === 'provider.confirmCapabilities') {
          this.handleConfirmCapabilities(socket, frame);
          return;
        }
        if (frame.type === 'agent.get') {
          this.handleGetAgent(socket, frame);
          return;
        }
        if (frame.type === 'agent.updateBinding') {
          this.handleUpdateAgentBinding(socket, frame);
          return;
        }
        if (frame.type === 'agent.list') {
          this.handleListAgents(socket, frame);
          return;
        }
        if (frame.type === 'agent.create') {
          this.handleCreateAgent(socket, frame);
          return;
        }
        if (frame.type === 'agent.listVersions') {
          this.handleListAgentVersions(socket, frame);
          return;
        }
        if (frame.type === 'agent.createVersion') {
          this.handleCreateAgentVersion(socket, frame);
          return;
        }
        if (frame.type === 'group.create') {
          this.handleCreateGroup(socket, frame);
          return;
        }
        if (frame.type === 'group.get') {
          this.handleGetGroup(socket, frame);
          return;
        }
        if (frame.type === 'group.list') {
          this.handleListGroups(socket, frame);
          return;
        }
        if (frame.type === 'group.update') {
          this.handleUpdateGroup(socket, frame);
          return;
        }
        if (frame.type === 'group.member.add') {
          this.handleAddGroupMember(socket, frame);
          return;
        }
        if (frame.type === 'group.member.remove') {
          this.handleRemoveGroupMember(socket, frame);
          return;
        }
        if (frame.type === 'group.member.updateResponsibility') {
          this.handleUpdateGroupMemberResponsibility(socket, frame);
          return;
        }
        if (frame.type === 'group.setLead') {
          this.handleSetGroupLead(socket, frame);
          return;
        }
        if (frame.type === 'group.task.create') {
          this.handleCreateGroupTask(socket, frame);
          return;
        }
        if (frame.type === 'automation.create') {
          void this.handleCreateAutomation(socket, frame);
          return;
        }
        if (frame.type === 'automation.update') {
          void this.handleUpdateAutomation(socket, frame);
          return;
        }
        if (frame.type === 'automation.delete') {
          void this.handleDeleteAutomation(socket, frame);
          return;
        }
        if (frame.type === 'automation.get') {
          this.handleGetAutomation(socket, frame);
          return;
        }
        if (frame.type === 'automation.list') {
          this.handleListAutomations(socket, frame);
          return;
        }
        if (frame.type === 'automation.trigger') {
          void this.handleTriggerAutomation(socket, frame);
          return;
        }
        if (frame.type === 'automation.execution.list') {
          this.handleListAutomationExecutions(socket, frame);
          return;
        }
        if (frame.type === 'skill.import') {
          this.handleImportSkill(socket, frame);
          return;
        }
        if (frame.type === 'skill.list') {
          this.handleListSkills(socket, frame);
          return;
        }
        if (frame.type === 'mcp.register') {
          this.handleRegisterMcpServer(socket, frame);
          return;
        }
        if (frame.type === 'mcp.list') {
          this.handleListMcpServers(socket, frame);
          return;
        }
        if (frame.type === 'mcp.policy.probe') {
          void this.handleProbeMcpPolicy(socket, frame);
          return;
        }
        if (frame.type === 'mcp.tool.request') {
          this.handleRequestMcpTool(socket, frame);
          return;
        }
        if (frame.type === 'mcp.spawn.probe') {
          void this.handleProbeMcpSpawn(socket, frame);
          return;
        }
        if (frame.type === 'mcp.tool.call') {
          this.trackBackgroundTask(this.handleCallMcpTool(socket, frame));
          return;
        }
        if (frame.type === 'mcp.tools.refresh') {
          void this.handleRefreshMcpTools(socket, frame);
          return;
        }
        if (frame.type === 'memory.list') {
          this.handleListMemory(socket, frame);
          return;
        }
        if (frame.type === 'memory.propose') {
          this.handleProposeMemory(socket, frame);
          return;
        }
        if (frame.type === 'memory.decide') {
          this.handleDecideMemory(socket, frame);
          return;
        }
        if (frame.type === 'memory.rollback') {
          this.handleRollbackMemory(socket, frame);
          return;
        }
        if (frame.type === 'approval.list') {
          this.handleListApprovals(socket, frame);
          return;
        }
        if (frame.type === 'policy.save') {
          this.handleSavePolicy(socket, frame);
          return;
        }
        if (frame.type === 'policy.list') {
          this.handleListPolicies(socket, frame);
          return;
        }
        if (frame.type === 'approval.evaluate') {
          this.handleEvaluateApproval(socket, frame);
          return;
        }
        if (frame.type === 'approval.enqueue') {
          this.handleEnqueueApproval(socket, frame);
          return;
        }
        if (frame.type === 'approval.decide') {
          this.handleDecideApproval(socket, frame);
          return;
        }
        if (frame.type === 'context.packet.peek') {
          this.handlePeekContextPacket(socket, frame);
          return;
        }
        if (frame.type === 'context.packet.amend') {
          this.handleAmendContextPacket(socket, frame);
          return;
        }
        if (frame.type === 'diagnostics.list') {
          this.handleListDiagnostics(socket, frame);
          return;
        }
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: frame.type,
            payload: {},
            error: {
              code: ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
              message: `Unsupported runtime command: ${frame.type}`,
            },
          }),
        );
      },
      onFrameError: (socket, frame, error) => {
        console.warn(
          '[runtime] command failed before a response could be written',
          frame.type,
          this.scrubDiagnosticMessage(error instanceof Error ? error.message : String(error)),
        );
        if (socket.destroyed) return;
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: frame.type,
            payload: {},
            error: {
              code: ErrorCode.STORAGE_WRITE_FAILED,
              message: 'The runtime could not complete this command',
            },
          }),
        );
      },
      onServerError: (err) => console.warn('[runtime] pipe error', err.message),
    };
    this.automationService =
      this.automationStore && this.secureStore && this.workspaceStore
        ? new AutomationService({
            store: this.automationStore,
            secureStore: this.secureStore,
            host: opts.automationWebhookHost,
            port: opts.automationWebhookPort,
            createTask: (input) => this.createAutomationTask(input),
            startTask: (input) => this.startAutomationTask(input.automation, input.taskId),
            appendSkippedTaskMessage: (taskId, message) =>
              this.appendAutomationTaskMessage(taskId, message, 'system'),
            getTaskInput: (taskId) => this.workspaceStore?.getTask(taskId)?.goal,
            getTaskState: (taskId, since) => this.getAutomationTaskState(taskId, since),
            emit: (type, automation, execution, detail) =>
              this.emitAutomationEvent(type, automation, execution, detail),
          })
        : undefined;
  }

  currentHealthcheck(): HealthcheckResult | HealthcheckError {
    return healthcheck(this.startedAt, { inFlightRuns: this.inFlight.size });
  }

  recordInFlight(id: string): void {
    this.inFlight.add(id);
  }
  forgetInFlight(id: string): void {
    this.inFlight.delete(id);
  }

  createCheckpoint(): RuntimeCheckpointSnapshot {
    return {
      eventSequence: this.eventSequence,
      threadVersions: Array.from(this.threadVersions.entries()),
      events: this.events.map((event) => ({ ...event, payload: { ...event.payload } })),
      createdAt: new Date().toISOString(),
    };
  }

  private restoreCheckpoint(checkpoint: RuntimeCheckpointSnapshot): void {
    this.eventSequence = checkpoint.eventSequence;
    this.threadVersions.clear();
    for (const [threadId, version] of checkpoint.threadVersions) {
      this.threadVersions.set(threadId, version);
    }
    this.events.length = 0;
    this.events.push(
      ...checkpoint.events.map((event) => ({ ...event, payload: { ...event.payload } })),
    );
    this.events.sort((left, right) => left.sequence - right.sequence);
  }

  private restorePersistedState(): void {
    if (!this.stateStore) return;
    const checkpoint = this.stateStore.loadLatestCheckpoint(this.checkpointRunId);
    if (checkpoint) {
      this.restoreProjection(checkpoint.state);
      this.eventSequence = checkpoint.lastEventSequence;
    }

    const persistedEvents = this.stateStore.listAllEvents
      ? this.stateStore.listAllEvents(0)
      : this.stateStore.listEvents(this.workspaceId, 0);
    this.events.push(
      ...persistedEvents.map((event) => ({ ...event, payload: { ...event.payload } })),
    );
    const replayAfter = checkpoint?.lastEventSequence ?? 0;
    for (const event of persistedEvents) {
      this.eventSequence = Math.max(this.eventSequence, event.sequence);
      if (event.sequence > replayAfter) this.applyEventToProjection(event);
    }
  }

  private restoreProjection(state: Record<string, unknown>): void {
    const entries = state.threadVersions;
    if (!Array.isArray(entries)) {
      throw new Error('Runtime checkpoint is missing threadVersions');
    }
    this.threadVersions.clear();
    for (const entry of entries) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== 'string' ||
        typeof entry[1] !== 'number'
      ) {
        throw new Error('Runtime checkpoint contains an invalid thread version');
      }
      this.threadVersions.set(entry[0], entry[1]);
    }
    this.demoRuns.clear();
    for (const run of parseDemoRuns(state.demoRuns)) {
      this.demoRuns.set(run.runId, run);
    }
  }

  private recoverUnresolvedApplicationToolConfirmations(): void {
    const unresolved = new Map<string, { requested: Event; started: boolean }>();
    for (const event of this.events) {
      const confirmationId =
        typeof event.payload.confirmationId === 'string'
          ? event.payload.confirmationId
          : undefined;
      if (!confirmationId) continue;
      if (event.type === 'application.tool_confirmation_requested') {
        unresolved.set(confirmationId, { requested: event, started: false });
      } else if (event.type === 'application.tool_confirmation_started') {
        const current = unresolved.get(confirmationId);
        if (current) current.started = true;
      } else if (event.type === 'application.tool_confirmation_resolved') {
        unresolved.delete(confirmationId);
      }
    }

    for (const [confirmationId, state] of unresolved) {
      const event = state.requested;
      const runId = event.runId;
      const run = runId ? this.demoRuns.get(runId) : undefined;
      const toolCallId =
        typeof event.payload.toolCallId === 'string' ? event.payload.toolCallId : undefined;
      const toolName =
        typeof event.payload.toolName === 'string' ? event.payload.toolName : undefined;
      const definition = toolName ? getApplicationToolDefinition(toolName) : undefined;
      if (!runId || !run || !toolCallId || !toolName || !definition) continue;
      if (run.applicationToolResults.some((candidate) => candidate.toolCallId === toolCallId)) {
        continue;
      }
      let expiresAt =
        typeof event.payload.expiresAt === 'string' ? event.payload.expiresAt : undefined;
      if (!expiresAt && typeof event.payload.result === 'string') {
        try {
          const parsed = JSON.parse(event.payload.result) as { expiresAt?: unknown };
          if (typeof parsed.expiresAt === 'string') expiresAt = parsed.expiresAt;
        } catch {
          // Older events may not carry a structured preview; recovery still expires them safely.
        }
      }
      const pending: PendingAgentConfigurationCommand = {
        id: confirmationId,
        toolCallId,
        toolName,
        command: definition.command,
        payload: {},
        confirmationToken: '',
        threadId: run.threadId,
        runId,
        agentVersionId: run.agentVersionId,
        expiresAt: expiresAt ?? new Date(0).toISOString(),
      };
      this.persistApplicationToolConfirmationResult(
        pending,
        state.started ? 'failed' : 'expired',
        state.started
          ? {
              status: 'failed',
              code: 'application.configuration_outcome_unknown',
              message: 'The Runtime restarted after this operation began; it will not be repeated.',
            }
          : {
              status: 'expired',
              code: 'application.configuration_runtime_restarted',
            },
        state.started ? 'Operation outcome is unknown after Runtime restart' : undefined,
      );
    }
  }

  private applyEventToProjection(event: Event): void {
    if (event.type === 'message.appended') {
      const threadId = event.payload.threadId;
      const taskVersion = event.payload.taskVersion;
      if (typeof threadId === 'string' && typeof taskVersion === 'number') {
        const current = this.threadVersions.get(threadId) ?? 0;
        this.threadVersions.set(threadId, Math.max(current, taskVersion));
      }
    }
    applyDemoRunEvent(this.demoRuns, event);
  }

  private handleSubscribeEvents(socket: Socket, frame: Frame): void {
    const payload = parseSubscribeEventsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const highWatermark = this.eventSequence;
    if (payload.afterCursor > highWatermark) {
      this.writeUnexpectedRequest(socket, frame, 'Subscription cursor is ahead of the Runtime');
      return;
    }
    const streamId = `stream_${ulid()}`;
    const subscription: RuntimeEventSubscription = {
      socket,
      phase: 'catching-up',
      categories:
        payload.categories && payload.categories.length > 0
          ? new Set(payload.categories)
          : undefined,
      highWatermark,
      replayCursor: payload.afterCursor,
      replayIndex: this.findEventIndexAfter(payload.afterCursor),
      liveCursor: highWatermark,
    };
    this.subscriptions.set(streamId, subscription);
    this.writeReplayPage(socket, frame, streamId, subscription, payload.afterCursor + 1);
  }

  private handleContinueEventReplay(socket: Socket, frame: Frame): void {
    const payload = parseContinueEventReplayPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const subscription = this.subscriptions.get(payload.streamId);
    if (
      !subscription ||
      subscription.socket !== socket ||
      subscription.phase !== 'catching-up' ||
      subscription.replayCursor !== payload.afterCursor
    ) {
      this.writeUnexpectedRequest(socket, frame, 'Event replay continuation is not valid');
      return;
    }
    this.writeReplayPage(socket, frame, payload.streamId, subscription);
  }

  private writeReplayPage(
    socket: Socket,
    requestFrame: Frame,
    streamId: string,
    subscription: RuntimeEventSubscription,
    startingSequence?: number,
  ): void {
    const page = this.buildReplayPage(requestFrame, streamId, subscription, startingSequence);
    if (!page) {
      this.subscriptions.delete(streamId);
      socket.write(
        encodeFrame({
          id: requestFrame.id,
          kind: 'response',
          type: requestFrame.type,
          payload: {},
          error: {
            code: ErrorCode.PROTOCOL_FRAME_MALFORMED,
            message: 'A replay event exceeds the maximum frame size',
          },
        }),
      );
      return;
    }

    socket.write(page.encoded);
    subscription.replayCursor = page.payload.nextCursor;
    subscription.replayIndex = page.nextIndex;
    if (!page.payload.replayComplete) return;

    const activationWatermark = this.eventSequence;
    subscription.phase = 'live';
    subscription.liveCursor = activationWatermark;
    for (const event of this.events) {
      if (
        event.sequence <= subscription.highWatermark ||
        event.sequence > activationWatermark ||
        !this.subscriptionMatches(subscription, event)
      ) {
        continue;
      }
      this.writeLiveEvent(socket, streamId, event);
    }
  }

  private buildReplayPage(
    requestFrame: Frame,
    streamId: string,
    subscription: RuntimeEventSubscription,
    startingSequence?: number,
  ):
    | {
        encoded: Buffer;
        payload: EventReplayPagePayload | EventStreamStartedPayload;
        nextIndex: number;
      }
    | undefined {
    const replayedEvents: Event[] = [];
    let nextCursor = subscription.replayCursor;
    let matchingCount = 0;
    let scannedCount = 0;
    let replayIndex = subscription.replayIndex;
    let serializedEventBytes = 0;

    const createPayload = (
      events: Event[],
      cursor: number,
      complete: boolean,
    ): EventReplayPagePayload | EventStreamStartedPayload => {
      const page: EventReplayPagePayload = {
        streamId,
        replayedEvents: events,
        nextCursor: cursor,
        highWatermark: subscription.highWatermark,
        replayComplete: complete,
      };
      return startingSequence === undefined ? page : { ...page, startingSequence };
    };

    const emptyPayload = createPayload([], nextCursor, false);
    let emptyFrame: Buffer;
    try {
      emptyFrame = encodeFrame({
        id: requestFrame.id,
        kind: 'response',
        type: requestFrame.type,
        payload: emptyPayload,
      });
    } catch {
      return undefined;
    }
    const eventBytesBudget =
      MAX_FRAME_BYTES - (emptyFrame.length - HEADER_BYTES) - REPLAY_FRAME_RESERVE_BYTES;

    while (replayIndex < this.events.length && scannedCount < MAX_REPLAY_SCANNED_EVENTS_PER_PAGE) {
      const event = this.events[replayIndex];
      if (event.sequence <= subscription.replayCursor) {
        replayIndex++;
        continue;
      }
      if (event.sequence > subscription.highWatermark) break;
      const matches = this.subscriptionMatches(subscription, event);
      if (matches && matchingCount >= MAX_REPLAY_EVENTS_PER_PAGE) break;
      if (matches) {
        let eventBytes: number;
        try {
          eventBytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
        } catch {
          return undefined;
        }
        const separatorBytes = replayedEvents.length === 0 ? 0 : 1;
        if (serializedEventBytes + separatorBytes + eventBytes > eventBytesBudget) {
          if (nextCursor === subscription.replayCursor && replayedEvents.length === 0) {
            return undefined;
          }
          break;
        }
        replayedEvents.push(event);
        serializedEventBytes += separatorBytes + eventBytes;
        matchingCount++;
      }
      nextCursor = event.sequence;
      replayIndex++;
      scannedCount++;
    }

    const replayComplete =
      replayIndex >= this.events.length ||
      this.events[replayIndex].sequence > subscription.highWatermark;
    if (replayComplete) nextCursor = subscription.highWatermark;
    const payload = createPayload(replayedEvents, nextCursor, replayComplete);
    try {
      return {
        encoded: encodeFrame({
          id: requestFrame.id,
          kind: 'response',
          type: requestFrame.type,
          payload,
        }),
        payload,
        nextIndex: replayIndex,
      };
    } catch {
      return undefined;
    }
  }

  private findEventIndexAfter(sequence: number): number {
    let low = 0;
    let high = this.events.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.events[middle].sequence <= sequence) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private handleUnsubscribeEvents(socket: Socket, frame: Frame): void {
    const payload = parseUnsubscribeEventsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    this.subscriptions.delete(payload.streamId);
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'runtime.unsubscribeEvents',
        payload: { streamId: payload.streamId },
      }),
    );
  }

  private writeApplicationToolConfirmationError(
    socket: Socket,
    frame: Frame,
    reason: 'caller-mismatch' | 'unknown-confirmation' | 'thread-mismatch' | 'expired',
  ): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.APPROVAL_REQUIRED,
          message:
            'This application operation is unavailable, expired, or belongs to another conversation.',
          detail: { reason },
        },
      }),
    );
  }

  private persistApplicationToolConfirmationStarted(
    pending: PendingAgentConfigurationCommand,
  ): Event {
    const current = this.demoRuns.get(pending.runId);
    if (!current) throw new Error('application.configuration_run_not_found');
    const next = {
      ...current,
      startedApplicationToolCallIds: current.startedApplicationToolCallIds.includes(
        pending.toolCallId,
      )
        ? current.startedApplicationToolCallIds
        : [...current.startedApplicationToolCallIds, pending.toolCallId],
    };
    return this.persistApplicationToolRunState(
      pending.runId,
      next,
      'application.tool_confirmation_started',
      {
        confirmationId: pending.id,
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        command: pending.command,
        expiresAt: pending.expiresAt,
      },
    );
  }

  private persistApplicationToolConfirmationResult(
    pending: PendingAgentConfigurationCommand,
    status: 'confirmed' | 'failed' | 'rejected' | 'expired',
    result: Record<string, unknown>,
    errorSummary?: string,
  ): Event {
    const current = this.demoRuns.get(pending.runId);
    if (!current) throw new Error('application.configuration_run_not_found');
    const next = {
      ...current,
      startedApplicationToolCallIds: current.startedApplicationToolCallIds.filter(
        (id) => id !== pending.toolCallId,
      ),
      applicationToolResults: [
        ...current.applicationToolResults.filter(
          (candidate) => candidate.toolCallId !== pending.toolCallId,
        ),
        {
          toolCallId: pending.toolCallId,
          result: this.boundedApplicationToolResult(result),
        },
      ],
    };
    return this.persistApplicationToolRunState(
      pending.runId,
      next,
      'application.tool_confirmation_resolved',
      {
        confirmationId: pending.id,
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        command: pending.command,
        status,
        result,
        ...(errorSummary ? { errorSummary } : {}),
      },
    );
  }

  private resolvePendingApplicationToolConfirmation(
    socket: Socket,
    frame: Frame,
  ):
    | {
        payload: import('@sync-think/protocol').ResolveApplicationToolConfirmationPayload;
        pending: PendingAgentConfigurationCommand;
      }
    | undefined {
    const payload = parseResolveApplicationToolConfirmationPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return undefined;
    }
    if (this.commandCallerSurface(frame) !== 'desktop') {
      this.writeApplicationToolConfirmationError(socket, frame, 'caller-mismatch');
      return undefined;
    }
    const pending = this.pendingAgentConfigurationCommands.get(payload.confirmationId);
    if (!pending) {
      this.writeApplicationToolConfirmationError(socket, frame, 'unknown-confirmation');
      return undefined;
    }
    if (pending.threadId !== payload.threadId) {
      this.writeApplicationToolConfirmationError(socket, frame, 'thread-mismatch');
      return undefined;
    }
    if (
      !Number.isFinite(Date.parse(pending.expiresAt)) ||
      Date.parse(pending.expiresAt) <= Date.now()
    ) {
      try {
        this.persistApplicationToolConfirmationResult(
          pending,
          'expired',
          {
            status: 'expired',
            code: 'application.configuration_expired',
          },
        );
      } catch (error) {
        this.writeWorkspaceCommandError(socket, frame, error);
        return undefined;
      }
      this.pendingAgentConfigurationCommands.delete(payload.confirmationId);
      this.scheduleDemoRunExecution(pending.runId);
      this.writeApplicationToolConfirmationError(socket, frame, 'expired');
      return undefined;
    }
    return { payload, pending };
  }

  private async handleConfirmApplicationTool(socket: Socket, frame: Frame): Promise<void> {
    const resolved = this.resolvePendingApplicationToolConfirmation(socket, frame);
    if (!resolved) return;
    const { payload, pending } = resolved;
    try {
      this.persistApplicationToolConfirmationStarted(pending);
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
      return;
    }
    this.pendingAgentConfigurationCommands.delete(payload.confirmationId);

    let commandResult: Frame;
    try {
      commandResult = await this.invokeAgentRuntimeCommand(
        pending.command,
        pending.payload,
        pending.confirmationToken,
      );
    } catch (error) {
      const errorSummary =
        this.scrubDiagnosticMessage(error instanceof Error ? error.message : 'Command failed') ??
        'Command failed';
      let auditEvent: Event;
      try {
        auditEvent = this.persistApplicationToolConfirmationResult(
          pending,
          'failed',
          {
            status: 'failed',
            code: 'application.configuration_failed',
            message: errorSummary,
          },
          errorSummary,
        );
      } catch (persistError) {
        this.writeWorkspaceCommandError(socket, frame, persistError);
        return;
      }
      const response: ConfirmApplicationToolResponse = {
        confirmationId: pending.id,
        status: 'failed',
        command: pending.command,
        errorSummary,
        auditEventId: String(auditEvent.id),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: response,
        }),
      );
      this.scheduleDemoRunExecution(pending.runId);
      return;
    }

    const errorSummary = commandResult.error
      ? (this.scrubDiagnosticMessage(commandResult.error.message) ?? 'Command failed')
      : undefined;
    const status = commandResult.error ? 'failed' : 'confirmed';
    let auditEvent: Event;
    try {
      auditEvent = this.persistApplicationToolConfirmationResult(
        pending,
        status,
        commandResult.error
          ? {
              status: 'failed',
              code: commandResult.error.code,
              message: errorSummary ?? 'Command failed',
            }
          : { status: 'confirmed', result: commandResult.payload ?? {} },
        errorSummary,
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
      return;
    }
    const response: ConfirmApplicationToolResponse = {
      confirmationId: pending.id,
      status,
      command: pending.command,
      ...(commandResult.error ? {} : { result: commandResult.payload }),
      ...(errorSummary ? { errorSummary } : {}),
      auditEventId: String(auditEvent.id),
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: response,
      }),
    );
    this.scheduleDemoRunExecution(pending.runId);
  }

  private handleRejectApplicationTool(socket: Socket, frame: Frame): void {
    const resolved = this.resolvePendingApplicationToolConfirmation(socket, frame);
    if (!resolved) return;
    const { payload, pending } = resolved;
    let auditEvent: Event;
    try {
      auditEvent = this.persistApplicationToolConfirmationResult(pending, 'rejected', {
        status: 'rejected',
        code: 'application.configuration_rejected',
      });
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
      return;
    }
    this.pendingAgentConfigurationCommands.delete(payload.confirmationId);
    const response: RejectApplicationToolResponse = {
      confirmationId: pending.id,
      status: 'rejected',
      command: pending.command,
      auditEventId: String(auditEvent.id),
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: response,
      }),
    );
    this.scheduleDemoRunExecution(pending.runId);
  }

  private handleCreateWorkspace(socket: Socket, frame: Frame): void {
    const payload = parseCreateWorkspacePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const created = this.workspaceStore.createWorkspace({
        folderPath: payload.folderPath,
        name: payload.name,
        allowedRoots: payload.allowedRoots,
      });
      this.taskEnvironmentManager?.ensureWorkspaceDefaults(created.id, created.folderPath);
      const response: CreateWorkspaceResponse = {
        workspaceId: created.id,
        folderPath: created.folderPath,
        name: created.name,
        createdAt: created.createdAt,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'workspace.create',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handleBindWorkspaceFolder(socket: Socket, frame: Frame): void {
    const payload = parseBindWorkspaceFolderPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const updated = this.workspaceStore.bindWorkspaceFolder({
        workspaceId: payload.workspaceId,
        folderPath: payload.folderPath,
        allowedRoots: payload.allowedRoots,
      });
      this.taskEnvironmentManager?.ensureWorkspaceDefaults(updated.id, updated.folderPath);
      if (!updated.folderPath) {
        throw new Error(`Workspace folder binding was not persisted: ${payload.workspaceId}`);
      }
      const response: BindWorkspaceFolderResponse = {
        workspaceId: updated.id,
        folderPath: updated.folderPath,
        name: updated.name,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'workspace.bindFolder',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handleBindWorkspaceGitRepository(socket: Socket, frame: Frame): void {
    const payload = parseBindWorkspaceGitRepositoryPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const workspace = this.workspaceStore?.getWorkspace(payload.workspaceId);
    if (!workspace || !this.executionEnvironmentStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      this.taskEnvironmentManager?.ensureWorkspaceDefaults(workspace.id, workspace.folderPath);
      const resource = this.executionEnvironmentStore.configureResource({
        workspaceId: workspace.id,
        type: 'git_repository',
        repositoryUrl: payload.repositoryUrl,
        defaultRef: payload.defaultRef,
      });
      const response: BindWorkspaceGitRepositoryResponse = {
        workspaceId: workspace.id,
        resourceId: String(resource.id),
        repositoryUrl: resource.repositoryUrl!,
        defaultRef: resource.defaultRef,
        resourceType: 'git_repository',
        updatedAt: resource.updatedAt,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'workspace.bindGitRepository',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handleListWorkspaces(socket: Socket, frame: Frame): void {
    const payload = parseListWorkspacesPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    const response: ListWorkspacesResponse = {
      workspaces: this.workspaceStore.listWorkspaces().map((workspace) => {
        const resource = this.executionEnvironmentStore?.getPrimaryResource(workspace.id);
        const profile = this.executionEnvironmentStore?.getWorkspaceProfile(workspace.id);
        const browserIdentity = this.executionEnvironmentStore
          ?.listBrowserIdentities()
          .find((identity) => identity.id === profile?.browserIdentityId);
        return {
          workspaceId: workspace.id,
          folderPath: workspace.folderPath,
          name: workspace.name,
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
          resourceType: resource?.type,
          repositoryUrl: resource?.repositoryUrl,
          executionProfileId: profile?.id,
          executionProfileName: profile?.name,
          executionMode: profile?.mode,
          defaultRef: profile?.defaultRef ?? resource?.defaultRef,
          browserIdentityId: profile?.browserIdentityId,
          browserIdentityName: browserIdentity?.name,
        };
      }),
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'workspace.list',
        payload: response,
      }),
    );
  }

  private handleListBrowserIdentities(socket: Socket, frame: Frame): void {
    const payload = parseListBrowserIdentitiesPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.taskEnvironmentManager) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    const response: ListBrowserIdentitiesResponse = {
      identities: this.taskEnvironmentManager.listBrowserIdentities().map((identity) => ({
        id: String(identity.id),
        name: identity.name,
        isDefault: identity.isDefault,
        createdAt: identity.createdAt,
        updatedAt: identity.updatedAt,
      })),
    };
    socket.write(
      encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
    );
  }

  private handleCreateBrowserIdentity(socket: Socket, frame: Frame): void {
    const payload = parseCreateBrowserIdentityPayload(frame.payload);
    if (!payload || !this.taskEnvironmentManager) {
      if (!payload) this.writeMalformedPayload(socket, frame);
      else this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const identity = this.taskEnvironmentManager.createBrowserIdentity(
        payload.name,
        payload.makeDefault,
      );
      const response: CreateBrowserIdentityResponse = {
        identity: {
          id: String(identity.id),
          name: identity.name,
          isDefault: identity.isDefault,
          createdAt: identity.createdAt,
          updatedAt: identity.updatedAt,
        },
      };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handleUpdateBrowserIdentity(socket: Socket, frame: Frame): void {
    const payload = parseUpdateBrowserIdentityPayload(frame.payload);
    if (!payload || !this.taskEnvironmentManager) {
      if (!payload) this.writeMalformedPayload(socket, frame);
      else this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const identity = this.taskEnvironmentManager.updateBrowserIdentity(
        payload.id as BrowserIdentityId,
        { name: payload.name, makeDefault: payload.makeDefault },
      );
      const response: UpdateBrowserIdentityResponse = {
        identity: {
          id: String(identity.id),
          name: identity.name,
          isDefault: identity.isDefault,
          createdAt: identity.createdAt,
          updatedAt: identity.updatedAt,
        },
      };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handleDeleteBrowserIdentity(socket: Socket, frame: Frame): void {
    const payload = parseDeleteBrowserIdentityPayload(frame.payload);
    if (!payload || !this.taskEnvironmentManager) {
      if (!payload) this.writeMalformedPayload(socket, frame);
      else this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      this.taskEnvironmentManager.deleteBrowserIdentity(payload.id as BrowserIdentityId);
      const response: DeleteBrowserIdentityResponse = { id: payload.id, deleted: true };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handleCreateTask(socket: Socket, frame: Frame): void {
    const payload = parseCreateTaskPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const { created, bindingEvent } = this.runInUnitOfWork(() => {
        if (payload.agentVersionId) this.getRequiredAgentVersion(payload.agentVersionId);
        const created = this.workspaceStore!.createTask({
          workspaceId: payload.workspaceId,
          title: payload.title,
          goal: payload.goal,
          parentTaskId: payload.parentTaskId,
          acceptanceCriteria: payload.acceptanceCriteria,
        });
        const bindingEvent = payload.agentVersionId
          ? this.appendEvent(
              'system',
              'task.agent-bound',
              {
                taskId: created.taskId,
                threadId: created.threadId,
                agentVersionId: payload.agentVersionId,
                callerSurface: this.commandCallerSurface(frame),
              },
              undefined,
              undefined,
              created.taskId,
              payload.workspaceId,
            )
          : undefined;
        return { created, bindingEvent };
      });
      this.prepareCreatedTaskEnvironment(created.taskId, created.parentTaskId);
      this.threadVersions.set(created.threadId, created.taskVersion);
      if (bindingEvent) this.publishEvent(bindingEvent);
      const response: CreateTaskResponse = {
        taskId: created.taskId,
        threadId: created.threadId,
        taskVersion: created.taskVersion,
        participationMode: created.participationMode,
        executionMode: created.executionMode,
        parentTaskId: created.parentTaskId,
        createdAt: created.createdAt,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'task.create',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private prepareCreatedTaskEnvironment(taskId: TaskId, parentTaskId?: TaskId): void {
    const task = this.workspaceStore?.getTask(taskId);
    if (!task) return;
    const workspace = this.workspaceStore?.getWorkspace(task.workspaceId);
    if (!workspace) return;
    this.taskEnvironmentManager?.ensureWorkspaceDefaults(workspace.id, workspace.folderPath);
    this.executionEnvironmentStore?.createTaskContext({
      taskId,
      workspaceId: task.workspaceId,
      parentTaskId,
    });
    if (this.taskEnvironmentManager) {
      const initialContext = this.taskEnvironmentManager.prepareTask(taskId);
      if (initialContext.state !== 'pending') return;
      const preparation = this.taskEnvironmentManager.prepareTaskAsync(taskId).then((context) => {
        const currentTask = this.workspaceStore?.getTask(taskId);
        if (!currentTask) return;
        const event = this.appendEvent(
          'system',
          context.state === 'ready' ? 'task.execution-ready' : 'task.execution-blocked',
          {
            threadId: currentTask.threadId,
            taskId: currentTask.id,
            mode: context.mode,
            state: context.state,
            blockedReason: context.blockedReason,
            text:
              context.state === 'ready'
                ? '任务执行位置已准备完成。'
                : `任务执行位置未就绪：${context.blockedReason ?? '未知原因'}`,
          },
          undefined,
          undefined,
          currentTask.id,
          currentTask.workspaceId,
        );
        this.publishEvent(event);
      });
      this.trackBackgroundTask(preparation);
    }
  }

  private handleDelegateSubtask(socket: Socket, frame: Frame): void {
    const payload = parseDelegateSubtaskPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore || !this.agentStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const parent = this.workspaceStore.getTask(payload.parentTaskId);
      if (!parent || parent.workspaceId !== payload.workspaceId) {
        throw new Error('Parent task is not available in the requested workspace');
      }
      if (parent.parentTaskId) {
        throw new Error('Only one level of child tasks is supported');
      }
      const delegateAgent = this.getRequiredAgentVersion(payload.delegateAgentVersionId);
      const group = this.groupStore?.getForTask(parent.id);
      if (
        group &&
        !group.members.some((member) => member.agentVersionId === payload.delegateAgentVersionId)
      ) {
        throw new Error('Delegated AgentVersion is not a member of the bound group');
      }
      const dependsOnTaskIds = [...new Set(payload.dependsOnTaskIds ?? [])];
      for (const dependencyId of dependsOnTaskIds) {
        const dependency = this.workspaceStore.getTask(dependencyId);
        if (!dependency || dependency.parentTaskId !== parent.id) {
          throw new Error('Subtask dependencies must be existing children of the same parent');
        }
      }
      const normalizedGoal = payload.goal.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
      const existingDelegation = this.delegatedSubtaskDescriptors().find((candidate) => {
        if (
          candidate.parentTaskId !== parent.id ||
          candidate.delegateAgentVersionId !== payload.delegateAgentVersionId ||
          candidate.packet.goal.trim().replace(/\s+/g, ' ').toLocaleLowerCase() !==
            normalizedGoal ||
          this.subtaskTerminalEvent(candidate.childTaskId)
        ) {
          return false;
        }
        const child = this.workspaceStore?.getTask(candidate.childTaskId);
        return Boolean(
          child &&
          (child.status === 'active' || child.status === 'blocked' || child.status === 'paused'),
        );
      });
      if (existingDelegation) {
        const child = this.workspaceStore.getTask(existingDelegation.childTaskId)!;
        const response: DelegateSubtaskResponse = {
          taskId: child.id,
          threadId: child.threadId,
          taskVersion: child.version,
          participationMode: child.participationMode,
          executionMode: child.executionMode,
          parentTaskId: child.parentTaskId,
          createdAt: child.createdAt,
          delegateAgentVersionId: existingDelegation.delegateAgentVersionId,
          packet: existingDelegation.packet,
          eventId: existingDelegation.eventId,
          reused: true,
        };
        socket.write(
          encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
        );
        return;
      }
      const delegatingAgentVersionId =
        payload.delegatingAgentVersionId ??
        group?.leadAgentVersionId ??
        this.resolveTaskLeadAgentVersionId(parent);
      this.getRequiredAgentVersion(delegatingAgentVersionId);
      const delegationBatchId = payload.delegationBatchId ?? String(frame.id);
      const packet = {
        goal: payload.goal,
        requiredEvidence: payload.requiredEvidence ?? [],
        acceptanceConditions: payload.acceptanceConditions ?? [],
        allowedTools: payload.allowedTools ?? [],
        handoffHistory: [],
        dependsOnTaskIds,
        retryLimit: DEFAULT_SUBTASK_RETRY_LIMIT,
      };
      const { created, delegatedEvent, assignmentEvent } = this.runInUnitOfWork(() => {
        const created = this.workspaceStore!.createTask({
          workspaceId: payload.workspaceId,
          title: payload.title,
          goal: payload.goal,
          parentTaskId: payload.parentTaskId,
          acceptanceCriteria: packet.acceptanceConditions,
        });
        const delegatedEvent = this.appendEvent(
          'step',
          'subtask.delegated',
          {
            threadId: parent.threadId,
            childTaskId: created.taskId,
            childThreadId: created.threadId,
            parentTaskId: parent.id,
            delegateAgentVersionId: payload.delegateAgentVersionId,
            delegatingAgentVersionId,
            agentVersionId: delegatingAgentVersionId,
            delegationBatchId,
            packet,
            callerSurface: this.commandCallerSurface(frame),
            text: `我已将“${payload.title}”委托给 ${delegateAgent.name}。`,
          },
          undefined,
          undefined,
          parent.id,
          parent.workspaceId,
        );
        const assignmentEvent = this.appendEvent(
          'system',
          'subtask.agent-assigned',
          {
            threadId: created.threadId,
            parentTaskId: parent.id,
            childTaskId: created.taskId,
            agentVersionId: payload.delegateAgentVersionId,
            delegateAgentVersionId: payload.delegateAgentVersionId,
            delegatingAgentVersionId,
            delegationBatchId,
          },
          undefined,
          undefined,
          created.taskId,
          parent.workspaceId,
        );
        return { created, delegatedEvent, assignmentEvent };
      });
      const parentPolicy = this.policyStore
        ?.listApplicable([{ scopeType: 'task', scopeId: parent.id }])
        .filter((policy) => policy.scopeType === 'task' && policy.scopeId === parent.id)
        .sort((left, right) => right.version - left.version)[0];
      if (this.policyStore) {
        this.policyStore.save({
          scopeType: 'task',
          scopeId: created.taskId,
          approvalMode:
            parentPolicy?.approvalMode ??
            group?.approvalMode ??
            this.getRequiredAgentVersion(delegatingAgentVersionId).approvalMode,
          rules: parentPolicy?.rules ?? [],
        });
      }
      this.prepareCreatedTaskEnvironment(created.taskId, created.parentTaskId);
      this.threadVersions.set(created.threadId, created.taskVersion);
      this.publishEvent(delegatedEvent);
      this.publishEvent(assignmentEvent);
      const response: DelegateSubtaskResponse = {
        taskId: created.taskId,
        threadId: created.threadId,
        taskVersion: created.taskVersion,
        participationMode: created.participationMode,
        executionMode: created.executionMode,
        parentTaskId: created.parentTaskId,
        createdAt: created.createdAt,
        delegateAgentVersionId: payload.delegateAgentVersionId,
        packet,
        eventId: String(delegatedEvent.id),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: response,
        }),
      );
      this.scheduleReadyDelegatedSubtasks();
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private resolveTaskLeadAgentVersionId(task: TaskRecord): AgentVersionId {
    const stableBindingKeys = new Map<string, 'agentVersionId' | 'leadAgentVersionId'>([
      ['task.agent-bound', 'agentVersionId'],
      ['subtask.agent-assigned', 'agentVersionId'],
      ['group.task-created', 'leadAgentVersionId'],
    ]);
    for (const event of [...this.events].reverse()) {
      if (event.taskId !== task.id && event.payload.threadId !== task.threadId) continue;
      const bindingKey = stableBindingKeys.get(event.type);
      if (!bindingKey) continue;
      const value = event.payload[bindingKey];
      if (typeof value === 'string' && this.agentStore?.getVersion(value as AgentVersionId)) {
        return value as AgentVersionId;
      }
    }
    return this.ensureAgentRecord(DEFAULT_CONVERSATION_AGENT_ID).id;
  }

  private delegatedSubtaskDescriptors(): DelegatedSubtaskDescriptor[] {
    return this.events.flatMap((event) => {
      if (event.type !== 'subtask.delegated') return [];
      const payload = event.payload;
      if (
        typeof payload.parentTaskId !== 'string' ||
        typeof payload.childTaskId !== 'string' ||
        typeof payload.childThreadId !== 'string' ||
        typeof payload.delegateAgentVersionId !== 'string' ||
        typeof payload.delegatingAgentVersionId !== 'string' ||
        typeof payload.delegationBatchId !== 'string' ||
        typeof payload.text !== 'string' ||
        !payload.packet ||
        typeof payload.packet !== 'object' ||
        Array.isArray(payload.packet)
      ) {
        return [];
      }
      const packet = payload.packet as Record<string, unknown>;
      const strings = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : [];
      return [
        {
          eventId: String(event.id),
          parentTaskId: payload.parentTaskId as TaskId,
          childTaskId: payload.childTaskId as TaskId,
          childThreadId: payload.childThreadId as ThreadId,
          delegateAgentVersionId: payload.delegateAgentVersionId as AgentVersionId,
          delegatingAgentVersionId: payload.delegatingAgentVersionId as AgentVersionId,
          delegationBatchId: payload.delegationBatchId,
          title:
            typeof packet.goal === 'string'
              ? String(
                  this.workspaceStore?.getTask(payload.childTaskId as TaskId)?.title ?? packet.goal,
                )
              : '子任务',
          packet: {
            goal: typeof packet.goal === 'string' ? packet.goal : '',
            requiredEvidence: strings(packet.requiredEvidence),
            acceptanceConditions: strings(packet.acceptanceConditions),
            allowedTools: strings(packet.allowedTools),
            handoffHistory: strings(packet.handoffHistory),
            dependsOnTaskIds: strings(packet.dependsOnTaskIds) as TaskId[],
            retryLimit:
              typeof packet.retryLimit === 'number'
                ? packet.retryLimit
                : DEFAULT_SUBTASK_RETRY_LIMIT,
          },
        },
      ];
    });
  }

  private subtaskTerminalEvent(childTaskId: TaskId): Event | undefined {
    return [...this.events]
      .reverse()
      .find(
        (event) =>
          (event.type === 'subtask.completed' || event.type === 'subtask.failed') &&
          event.payload.childTaskId === childTaskId,
      );
  }

  private emitSubtaskEvent(
    category: EventCategory,
    type: string,
    payload: Record<string, unknown>,
    taskId: TaskId,
    workspaceId: WorkspaceId,
    runId?: RunId,
  ): Event {
    const event = this.runInUnitOfWork(() =>
      this.appendEvent(category, type, payload, undefined, runId, taskId, workspaceId),
    );
    this.publishEvent(event);
    return event;
  }

  private activeRunsForAgent(agentVersionId: AgentVersionId): number {
    return [...this.demoRuns.values()].filter((run) => run.agentVersionId === agentVersionId)
      .length;
  }

  private scheduleReadyDelegatedSubtasks(): void {
    for (const descriptor of this.delegatedSubtaskDescriptors()) {
      if (this.subtaskTerminalEvent(descriptor.childTaskId)) continue;
      const task = this.workspaceStore?.getTask(descriptor.childTaskId);
      if (
        !task ||
        task.status === 'blocked' ||
        task.status === 'archived' ||
        task.status === 'completed'
      ) {
        continue;
      }
      const failedDependencyIds = descriptor.packet.dependsOnTaskIds.filter(
        (dependencyId) => this.subtaskTerminalEvent(dependencyId)?.type === 'subtask.failed',
      );
      if (failedDependencyIds.length > 0) {
        if (this.delegatedSubtaskStarting.has(descriptor.childTaskId)) continue;
        this.delegatedSubtaskStarting.add(descriptor.childTaskId);
        const blocked = this.finalizeDelegatedSubtask(descriptor, 'failed', undefined, {
          errorMessage: `前置子任务未完成：${failedDependencyIds.join('、')}`,
        }).finally(() => this.delegatedSubtaskStarting.delete(descriptor.childTaskId));
        this.trackBackgroundTask(blocked);
        continue;
      }
      if (
        descriptor.packet.dependsOnTaskIds.some(
          (dependencyId) => this.workspaceStore?.getTask(dependencyId)?.status !== 'completed',
        )
      ) {
        continue;
      }
      if ([...this.demoRuns.values()].some((run) => run.threadId === descriptor.childThreadId)) {
        continue;
      }
      const agent = this.agentStore?.getVersion(descriptor.delegateAgentVersionId);
      if (
        !agent ||
        this.activeRunsForAgent(descriptor.delegateAgentVersionId) >= agent.maxConcurrency
      ) {
        continue;
      }
      if (this.delegatedSubtaskStarting.has(descriptor.childTaskId)) continue;
      this.delegatedSubtaskStarting.add(descriptor.childTaskId);
      const start = this.startDelegatedSubtaskAttempt(descriptor).finally(() => {
        this.delegatedSubtaskStarting.delete(descriptor.childTaskId);
      });
      this.trackBackgroundTask(start);
    }
    this.scheduleReadyParentBatchWakes();
  }

  private async startDelegatedSubtaskAttempt(
    descriptor: DelegatedSubtaskDescriptor,
  ): Promise<void> {
    const task = this.workspaceStore?.getTask(descriptor.childTaskId);
    if (!task || this.subtaskTerminalEvent(descriptor.childTaskId)) return;
    const attempt =
      this.events.filter(
        (event) =>
          event.type === 'subtask.execution-started' &&
          event.payload.childTaskId === descriptor.childTaskId,
      ).length -
      this.events.filter(
        (event) =>
          event.type === 'subtask.blocked' && event.payload.childTaskId === descriptor.childTaskId,
      ).length;
    if (attempt > descriptor.packet.retryLimit) {
      await this.finalizeDelegatedSubtask(descriptor, 'failed', undefined, {
        errorMessage: '子任务达到自动重试上限。',
      });
      return;
    }
    const agent = this.getRequiredAgentVersion(descriptor.delegateAgentVersionId);
    if (attempt === 0) {
      this.emitSubtaskEvent(
        'message',
        'subtask.agent-message',
        {
          threadId: task.threadId,
          parentTaskId: descriptor.parentTaskId,
          childTaskId: task.id,
          agentVersionId: descriptor.delegateAgentVersionId,
          delegationBatchId: descriptor.delegationBatchId,
          text: `已接收子任务“${task.title}”，现在开始执行。`,
        },
        task.id,
        task.workspaceId,
      );
    }
    this.emitSubtaskEvent(
      'run',
      'subtask.execution-started',
      {
        threadId: task.threadId,
        parentTaskId: descriptor.parentTaskId,
        childTaskId: task.id,
        agentVersionId: descriptor.delegateAgentVersionId,
        delegationBatchId: descriptor.delegationBatchId,
        attempt: attempt + 1,
        retryLimit: descriptor.packet.retryLimit,
        text:
          attempt === 0
            ? `${agent.name} 开始执行子任务。`
            : `${agent.name} 正在进行第 ${attempt} 次自动重试。`,
      },
      task.id,
      task.workspaceId,
    );
    const instruction = [
      `执行子任务：${task.title}`,
      `目标：${descriptor.packet.goal}`,
      descriptor.packet.requiredEvidence.length
        ? `所需证据：${descriptor.packet.requiredEvidence.join('；')}`
        : '',
      descriptor.packet.acceptanceConditions.length
        ? `验收条件：${descriptor.packet.acceptanceConditions.join('；')}`
        : '',
      '完成后请给出结论、完成内容、关键发现、验证结果和未解决问题。',
    ]
      .filter(Boolean)
      .join('\n');
    const response = await this.invokeInternalRuntimeCommand(
      'task.appendMessage',
      {
        threadId: task.threadId,
        expectedTaskVersion: task.version,
        role: 'user',
        text: instruction,
        agentVersionId: descriptor.delegateAgentVersionId,
        stepId: `subtask-auto:${task.id}:${attempt + 1}`,
      },
      'agent',
    );
    if (!response.error) return;
    this.emitSubtaskEvent(
      'run',
      'subtask.execution-attempt-failed',
      {
        threadId: task.threadId,
        childTaskId: task.id,
        agentVersionId: descriptor.delegateAgentVersionId,
        attempt: attempt + 1,
        errorMessage: this.scrubDiagnosticMessage(response.error.message),
      },
      task.id,
      task.workspaceId,
    );
    if (attempt < descriptor.packet.retryLimit) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, 500 * 2 ** attempt)));
      this.scheduleReadyDelegatedSubtasks();
      return;
    }
    await this.finalizeDelegatedSubtask(descriptor, 'failed', undefined, {
      errorMessage: response.error.message,
    });
  }

  private handleDelegatedRunTerminal(
    runId: RunId,
    run: DemoRunState,
    type: string,
    payload: Record<string, unknown>,
  ): void {
    const task = this.resolveTaskForThread(run.threadId);
    if (!task?.parentTaskId) {
      this.scheduleReadyDelegatedSubtasks();
      return;
    }
    const descriptor = this.delegatedSubtaskDescriptors().find(
      (candidate) => candidate.childTaskId === task.id,
    );
    if (!descriptor || this.subtaskTerminalEvent(task.id)) return;
    const finish = async () => {
      if (type === 'run.completed') {
        if (!this.hasDurableSubtaskEvidence(task.id, runId)) {
          const blocked = this.workspaceStore!.setTaskStatus(task.id, 'blocked', task.version, {
            cascade: false,
          }).task;
          this.threadVersions.set(blocked.threadId, blocked.version);
          this.emitSubtaskEvent(
            'run',
            'subtask.blocked',
            {
              threadId: task.threadId,
              parentTaskId: task.parentTaskId,
              childTaskId: task.id,
              agentVersionId: descriptor.delegateAgentVersionId,
              reason: '缺少文件、命令、Git、测试或产物执行证据，文本声明不能完成实现子任务。',
              retryConsumed: false,
              text: '子任务已暂停：尚未产生可验证的执行证据。',
            },
            task.id,
            task.workspaceId,
            runId,
          );
          return;
        }
        await this.finalizeDelegatedSubtask(descriptor, 'completed', runId, payload);
        return;
      }
      const attempts =
        this.events.filter(
          (event) =>
            event.type === 'subtask.execution-started' && event.payload.childTaskId === task.id,
        ).length -
        this.events.filter(
          (event) => event.type === 'subtask.blocked' && event.payload.childTaskId === task.id,
        ).length;
      if (attempts <= descriptor.packet.retryLimit) {
        this.emitSubtaskEvent(
          'run',
          'subtask.retry-scheduled',
          {
            threadId: task.threadId,
            childTaskId: task.id,
            agentVersionId: descriptor.delegateAgentVersionId,
            nextAttempt: attempts + 1,
            retryLimit: descriptor.packet.retryLimit,
            text: `执行失败，准备自动重试（${attempts}/${descriptor.packet.retryLimit}）。`,
          },
          task.id,
          task.workspaceId,
          runId,
        );
        this.scheduleReadyDelegatedSubtasks();
        return;
      }
      await this.finalizeDelegatedSubtask(descriptor, 'failed', runId, payload);
    };
    this.trackBackgroundTask(finish());
  }

  private hasDurableSubtaskEvidence(taskId: TaskId, runId: RunId): boolean {
    return this.events.some((event) => {
      if (event.taskId !== taskId && event.runId !== runId) return false;
      return (
        event.type === 'execution.tool.completed' ||
        event.type === 'artifact.created' ||
        event.type === 'artifact.version-created' ||
        event.type === 'step.completed' ||
        event.type === 'test.completed'
      );
    });
  }

  private async finalizeDelegatedSubtask(
    descriptor: DelegatedSubtaskDescriptor,
    status: 'completed' | 'failed',
    runId: RunId | undefined,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (this.subtaskTerminalEvent(descriptor.childTaskId)) return;
    const child = this.workspaceStore?.getTask(descriptor.childTaskId);
    const parent = this.workspaceStore?.getTask(descriptor.parentTaskId);
    if (!child || !parent) return;
    const assistantText =
      typeof payload.assistantText === 'string'
        ? payload.assistantText.trim()
        : typeof payload.errorMessage === 'string'
          ? payload.errorMessage.trim()
          : '';
    const evidenceRefs = this.events
      .filter(
        (event) => event.taskId === child.id && typeof event.payload.artifactVersionId === 'string',
      )
      .map((event) => String(event.payload.artifactVersionId))
      .slice(-16);
    const execution = (() => {
      try {
        return status === 'completed'
          ? this.taskEnvironmentManager?.integrateChildTask(child.id)
          : this.taskEnvironmentManager?.describeTaskChanges(child.id);
      } catch {
        return undefined;
      }
    })();
    const result = {
      conclusion: assistantText || (status === 'completed' ? '子任务已完成。' : '子任务执行失败。'),
      completedWork: status === 'completed' ? [child.goal] : [],
      keyFindings: assistantText ? [assistantText.slice(0, 1_200)] : [],
      verification: descriptor.packet.acceptanceConditions,
      unresolvedIssues: status === 'failed' ? [assistantText || '达到自动重试上限'] : [],
      evidenceRefs,
      ...(execution ? { execution } : {}),
    };
    const updated = this.workspaceStore!.setTaskStatus(
      child.id,
      status === 'completed' ? 'completed' : 'paused',
      child.version,
      { cascade: false },
    ).task;
    if (status === 'completed') {
      try {
        this.taskEnvironmentManager?.scheduleCleanup(child.id);
      } catch {
        console.warn('[runtime] completed child worktree cleanup could not be scheduled');
      }
    }
    this.threadVersions.set(child.threadId, updated.version);
    const agent = this.getRequiredAgentVersion(descriptor.delegateAgentVersionId);
    this.emitSubtaskEvent(
      'message',
      status === 'completed' ? 'subtask.completed' : 'subtask.failed',
      {
        threadId: parent.threadId,
        parentTaskId: parent.id,
        childTaskId: child.id,
        childThreadId: child.threadId,
        messageAgentVersionId: descriptor.delegateAgentVersionId,
        fromAgentVersionId: descriptor.delegateAgentVersionId,
        toAgentVersionId: descriptor.delegatingAgentVersionId,
        delegationBatchId: descriptor.delegationBatchId,
        status,
        result,
        text:
          status === 'completed'
            ? `${agent.name} 已完成子任务“${child.title}”：${result.conclusion}`
            : `${agent.name} 未能完成子任务“${child.title}”：${result.conclusion}`,
      },
      parent.id,
      parent.workspaceId,
      runId,
    );
    this.scheduleReadyDelegatedSubtasks();
  }

  private scheduleReadyParentBatchWakes(): void {
    const descriptors = this.delegatedSubtaskDescriptors();
    const keys = new Set(
      descriptors.map(
        (descriptor) => `${descriptor.parentTaskId}\u0000${descriptor.delegationBatchId}`,
      ),
    );
    for (const key of keys) {
      const [parentTaskId, delegationBatchId] = key.split('\u0000');
      if (!parentTaskId || !delegationBatchId) continue;
      if (this.delegatedParentWaking.has(key)) continue;
      const batch = descriptors.filter(
        (descriptor) =>
          descriptor.parentTaskId === parentTaskId &&
          descriptor.delegationBatchId === delegationBatchId,
      );
      const terminals = batch.map((descriptor) =>
        this.subtaskTerminalEvent(descriptor.childTaskId),
      );
      if (terminals.some((event) => !event)) continue;
      if (
        this.events.some(
          (event) =>
            event.type === 'subtask.parent-resumed' &&
            event.payload.parentTaskId === parentTaskId &&
            event.payload.delegationBatchId === delegationBatchId,
        )
      ) {
        continue;
      }
      const parent = this.workspaceStore?.getTask(parentTaskId as TaskId);
      if (!parent || [...this.demoRuns.values()].some((run) => run.threadId === parent.threadId)) {
        continue;
      }
      this.delegatedParentWaking.add(key);
      const wake = this.wakeParentAfterSubtaskBatch(parent, batch, terminals as Event[]).finally(
        () => this.delegatedParentWaking.delete(key),
      );
      this.trackBackgroundTask(wake);
    }
  }

  private async wakeParentAfterSubtaskBatch(
    parent: TaskRecord,
    batch: readonly DelegatedSubtaskDescriptor[],
    terminals: readonly Event[],
  ): Promise<void> {
    const summaries = terminals.map((event) => String(event.payload.text ?? '')).filter(Boolean);
    const leadAgentVersionId = batch[0]!.delegatingAgentVersionId;
    const response = await this.invokeInternalRuntimeCommand(
      'task.appendMessage',
      {
        threadId: parent.threadId,
        expectedTaskVersion: parent.version,
        role: 'user',
        text: [
          '以下子任务已经全部结束。请作为主智能体验收结果、决定是否返工，并继续父任务：',
          ...summaries.map((summary, index) => `${index + 1}. ${summary}`),
        ].join('\n'),
        agentVersionId: leadAgentVersionId,
        stepId: `subtask-wake:${parent.id}:${batch[0]!.delegationBatchId}`,
      },
      'agent',
    );
    if (response.error) return;
    const latestParent = this.workspaceStore?.getTask(parent.id) ?? parent;
    this.emitSubtaskEvent(
      'run',
      'subtask.parent-resumed',
      {
        threadId: parent.threadId,
        parentTaskId: parent.id,
        delegationBatchId: batch[0]!.delegationBatchId,
        agentVersionId: leadAgentVersionId,
        childTaskIds: batch.map((descriptor) => descriptor.childTaskId),
        text: '全部子任务结果已交回主智能体，父任务继续执行。',
      },
      latestParent.id,
      latestParent.workspaceId,
    );
  }

  private handleRecordHandoff(socket: Socket, frame: Frame): void {
    const payload = parseRecordHandoffPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore || !this.agentStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const task = this.workspaceStore.getTask(payload.taskId);
      if (!task) throw new Error(`Task not found: ${payload.taskId}`);
      this.getRequiredAgentVersion(payload.fromAgentVersionId);
      this.getRequiredAgentVersion(payload.toAgentVersionId);
      const group = this.groupStore?.getForTask(task.id);
      if (
        group &&
        (!group.members.some((member) => member.agentVersionId === payload.fromAgentVersionId) ||
          !group.members.some((member) => member.agentVersionId === payload.toAgentVersionId))
      ) {
        throw new Error('Handoff Agents must both belong to the bound group');
      }
      const event = this.runInUnitOfWork(() =>
        this.appendEvent(
          'step',
          'subtask.handoff-recorded',
          {
            threadId: task.threadId,
            fromAgentVersionId: payload.fromAgentVersionId,
            toAgentVersionId: payload.toAgentVersionId,
            summary: payload.summary,
            evidenceRefs: payload.evidenceRefs ?? [],
            status: payload.status ?? 'completed',
            callerSurface: this.commandCallerSurface(frame),
            text: payload.summary,
          },
          undefined,
          undefined,
          task.id,
          task.workspaceId,
        ),
      );
      this.publishEvent(event);
      const response: RecordHandoffResponse = {
        taskId: task.id,
        eventId: String(event.id),
        recordedAt: event.occurredAt,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: response,
        }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handleResolveWorktreeIntegration(socket: Socket, frame: Frame): void {
    const payload = parseResolveWorktreeIntegrationPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore || !this.taskEnvironmentManager) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const child = this.workspaceStore.getTask(payload.childTaskId);
      if (!child?.parentTaskId) throw new Error('Child task is not available');
      const parent = this.workspaceStore.getTask(child.parentTaskId);
      if (!parent) throw new Error('Parent task is not available');
      const result = this.taskEnvironmentManager.resolveChildIntegration(
        child.id,
        payload.strategy,
      );
      this.emitSubtaskEvent(
        'run',
        'subtask.integration-resolved',
        {
          threadId: parent.threadId,
          parentTaskId: parent.id,
          childTaskId: child.id,
          strategy: payload.strategy,
          integrationStatus: result.integrationStatus,
          integrationCommit: result.integrationCommit,
          changedFiles: result.changedFiles,
          text:
            result.integrationStatus === 'integrated'
              ? `已采用子任务“${child.title}”的改动。`
              : `已保留父任务版本并放弃子任务“${child.title}”的冲突改动。`,
        },
        parent.id,
        parent.workspaceId,
      );
      const response: ResolveWorktreeIntegrationResponse = {
        childTaskId: child.id,
        parentTaskId: parent.id,
        integrationStatus: result.integrationStatus === 'integrated' ? 'integrated' : 'kept-parent',
        ...(result.integrationCommit ? { integrationCommit: result.integrationCommit } : {}),
        changedFiles: result.changedFiles,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'task.resolveWorktreeIntegration',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handleSetTaskBrowserIdentity(socket: Socket, frame: Frame): void {
    const payload = parseSetTaskBrowserIdentityPayload(frame.payload);
    if (!payload || !this.taskEnvironmentManager || !this.workspaceStore) {
      if (!payload) this.writeMalformedPayload(socket, frame);
      else this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const task = this.workspaceStore.getTask(payload.taskId);
      if (!task) throw new Error(`Task not found: ${payload.taskId}`);
      const identity = this.taskEnvironmentManager
        .listBrowserIdentities()
        .find((candidate) => String(candidate.id) === payload.browserIdentityId);
      if (!identity) throw new Error(`BrowserIdentity not found: ${payload.browserIdentityId}`);
      this.taskEnvironmentManager.prepareTask(task.id);
      this.taskEnvironmentManager.setTaskBrowserIdentity(task.id, identity.id);
      const response: SetTaskBrowserIdentityResponse = {
        taskId: task.id,
        browserIdentityId: String(identity.id),
        browserIdentityName: identity.name,
      };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handleDescribeTaskExecutionAccess(socket: Socket, frame: Frame): void {
    const payload = parseDescribeTaskExecutionAccessPayload(frame.payload);
    if (
      !payload ||
      !this.workspaceStore ||
      !this.executionEnvironmentStore ||
      !this.taskEnvironmentManager
    ) {
      if (!payload) this.writeMalformedPayload(socket, frame);
      else this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const task = this.workspaceStore.getTask(payload.taskId);
      if (!task) throw new Error(`Task not found: ${payload.taskId}`);
      const agent = this.getRequiredAgentVersion(payload.agentVersionId);
      const context = this.taskEnvironmentManager.prepareTask(task.id);
      const binding = this.resolveConversationExecutionBinding(task, String(agent.id));
      const identity = context.browserIdentityId
        ? this.taskEnvironmentManager
            .listBrowserIdentities()
            .find((candidate) => candidate.id === context.browserIdentityId)
        : undefined;
      const candidateMode = binding.effectiveApprovalMode ?? agent.approvalMode ?? 'request';
      const approvalMode: ApprovalMode =
        candidateMode === 'request' ||
        candidateMode === 'delegate' ||
        candidateMode === 'custom' ||
        candidateMode === 'full'
          ? candidateMode
          : 'request';
      const response: DescribeTaskExecutionAccessResponse = {
        taskId: task.id,
        agentVersionId: agent.id,
        approvalMode,
        executionMode: context.mode,
        executionState: context.state,
        ...(context.executionPath ? { executionPath: context.executionPath } : {}),
        ...(context.baseRef ? { baseRef: context.baseRef } : {}),
        ...(identity
          ? {
              browserIdentityId: String(identity.id),
              browserIdentityName: identity.name,
            }
          : {}),
        effectiveToolNames: binding.executionToolNames,
        capabilityCeiling: {
          file: [...(agent.permissions?.file ?? [])],
          command: [...(agent.permissions?.command ?? [])],
          browser: [...(agent.permissions?.browser ?? [])],
          desktop: [...(agent.permissions?.desktop ?? [])],
          network: [...(agent.permissions?.network ?? [])],
        },
      };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handleListTasks(socket: Socket, frame: Frame): void {
    const payload = parseListTasksPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    if (!this.workspaceStore.getWorkspace(payload.workspaceId)) {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: {},
          error: {
            code: ErrorCode.WORKSPACE_NOT_FOUND,
            message: `Workspace not found: ${payload.workspaceId}`,
          },
        }),
      );
      return;
    }
    const response: ListTasksResponse = {
      tasks: this.workspaceStore
        .listTasks(payload.workspaceId, { includeArchived: Boolean(payload.includeArchived) })
        .map((task) =>
          toTaskSummary(task, this.executionEnvironmentStore?.getTaskContext(task.id)),
        ),
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'task.list',
        payload: response,
      }),
    );
  }

  private handleOpenTask(socket: Socket, frame: Frame): void {
    const payload = parseOpenTaskPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const opened = this.workspaceStore.openTask(payload.taskId as TaskId);
      const response: OpenTaskResponse = {
        task: toTaskSummary(opened, this.executionEnvironmentStore?.getTaskContext(opened.id)),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'task.open',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handleSearchTasks(socket: Socket, frame: Frame): void {
    const payload = parseSearchTasksPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    if (!this.workspaceStore.getWorkspace(payload.workspaceId)) {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: {},
          error: {
            code: ErrorCode.WORKSPACE_NOT_FOUND,
            message: `Workspace not found: ${payload.workspaceId}`,
          },
        }),
      );
      return;
    }
    const response: SearchTasksResponse = {
      tasks: this.workspaceStore
        .searchTasks(payload.workspaceId, payload.query)
        .map((task) =>
          toTaskSummary(task, this.executionEnvironmentStore?.getTaskContext(task.id)),
        ),
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'task.search',
        payload: response,
      }),
    );
  }

  private handleSetParticipationMode(socket: Socket, frame: Frame): void {
    const payload = parseSetParticipationModePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }

    const task = this.workspaceStore.getTask(payload.taskId);
    if (!task) {
      this.writeTaskModeCommandError(socket, frame, new Error(`Task not found: ${payload.taskId}`));
      return;
    }
    const currentVersion = task.version;
    if (payload.expectedTaskVersion !== currentVersion) {
      this.writeTaskVersionMismatch(socket, frame, currentVersion, payload.expectedTaskVersion);
      return;
    }

    const previousMode: ParticipationMode = task.participationMode;
    let approvedPlan = false;
    let applicablePolicy = false;
    if (previousMode !== payload.mode && payload.mode === 'automatic') {
      try {
        approvedPlan = this.hasApprovedPlan?.(payload.taskId) === true;
        applicablePolicy = this.hasApplicablePolicyForTask(task);
      } catch {
        approvedPlan = false;
        applicablePolicy = false;
      }
    }
    if (!canTransitionMode(previousMode, payload.mode, { approvedPlan, applicablePolicy })) {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: {},
          error: {
            code: ErrorCode.APPROVAL_REQUIRED,
            message:
              'An approved plan and applicable policy are required before entering automatic mode',
          },
        }),
      );
      return;
    }

    try {
      const occurredAt = new Date().toISOString();
      const result = this.runInUnitOfWork(() => {
        const updated = this.workspaceStore!.setParticipationMode(
          payload.taskId,
          payload.mode,
          payload.expectedTaskVersion,
          occurredAt,
        );
        const projectedThreadVersions = new Map(this.threadVersions);
        projectedThreadVersions.set(updated.threadId, updated.version);
        const eventPayload = {
          taskId: updated.id,
          threadId: updated.threadId,
          previousMode,
          participationMode: updated.participationMode,
          taskVersion: updated.version,
        };
        if (this.stateStore) {
          return {
            updated,
            needsProjection: true,
            committedEvents: this.commitProjectedEvents(
              [
                {
                  id: ulid() as Event['id'],
                  workspaceId: updated.workspaceId,
                  taskId: updated.id,
                  category: 'system',
                  type: 'task.participation-mode.changed',
                  occurredAt,
                  payload: eventPayload,
                },
              ],
              projectedThreadVersions,
              this.demoRuns,
            ),
          };
        }
        return {
          updated,
          needsProjection: false,
          committedEvents: [
            this.appendEvent(
              'system',
              'task.participation-mode.changed',
              eventPayload,
              undefined,
              undefined,
              updated.id,
            ),
          ],
        };
      });

      if (result.needsProjection) this.recordCommittedEvents(result.committedEvents);
      this.threadVersions.set(result.updated.threadId, result.updated.version);
      const response: SetParticipationModeResponse = {
        task: toTaskSummary(
          result.updated,
          this.executionEnvironmentStore?.getTaskContext(result.updated.id),
        ),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'task.setParticipationMode',
          payload: response,
        }),
      );
      for (const event of result.committedEvents) this.publishEvent(event);
    } catch (error) {
      this.writeTaskModeCommandError(socket, frame, error);
    }
  }

  private handleSetExecutionMode(socket: Socket, frame: Frame): void {
    const payload = parseSetExecutionModePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }

    const task = this.workspaceStore.getTask(payload.taskId);
    if (!task) {
      this.writeTaskModeCommandError(socket, frame, new Error(`Task not found: ${payload.taskId}`));
      return;
    }
    const currentVersion = task.version;
    if (payload.expectedTaskVersion !== currentVersion) {
      this.writeTaskVersionMismatch(socket, frame, currentVersion, payload.expectedTaskVersion);
      return;
    }

    const previousMode: ExecutionMode = task.executionMode;
    try {
      const occurredAt = new Date().toISOString();
      const result = this.runInUnitOfWork(() => {
        const updated = this.workspaceStore!.setExecutionMode(
          payload.taskId,
          payload.mode,
          payload.expectedTaskVersion,
          occurredAt,
        );
        const projectedThreadVersions = new Map(this.threadVersions);
        projectedThreadVersions.set(updated.threadId, updated.version);
        const eventPayload = {
          taskId: updated.id,
          threadId: updated.threadId,
          previousMode,
          executionMode: updated.executionMode,
          taskVersion: updated.version,
        };
        if (this.stateStore) {
          return {
            updated,
            needsProjection: true,
            committedEvents: this.commitProjectedEvents(
              [
                {
                  id: ulid() as Event['id'],
                  workspaceId: updated.workspaceId,
                  taskId: updated.id,
                  category: 'system',
                  type: 'task.execution-mode.changed',
                  occurredAt,
                  payload: eventPayload,
                },
              ],
              projectedThreadVersions,
              this.demoRuns,
            ),
          };
        }
        return {
          updated,
          needsProjection: false,
          committedEvents: [
            this.appendEvent(
              'system',
              'task.execution-mode.changed',
              eventPayload,
              undefined,
              undefined,
              updated.id,
            ),
          ],
        };
      });

      if (result.needsProjection) this.recordCommittedEvents(result.committedEvents);
      this.threadVersions.set(result.updated.threadId, result.updated.version);
      const response: SetExecutionModeResponse = {
        task: toTaskSummary(
          result.updated,
          this.executionEnvironmentStore?.getTaskContext(result.updated.id),
        ),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'task.setExecutionMode',
          payload: response,
        }),
      );
      for (const event of result.committedEvents) this.publishEvent(event);
    } catch (error) {
      this.writeTaskModeCommandError(socket, frame, error);
    }
  }

  private handleArchiveTask(socket: Socket, frame: Frame): void {
    const payload = parseArchiveTaskPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const result = this.workspaceStore.setTaskStatus(
        payload.taskId as TaskId,
        'archived',
        payload.expectedTaskVersion,
        { cascade: payload.cascade !== false },
      );
      for (const taskId of result.affectedTaskIds) {
        try {
          this.taskEnvironmentManager?.scheduleCleanup(taskId);
        } catch {
          console.warn('[runtime] task worktree cleanup could not be scheduled');
        }
      }
      this.threadVersions.set(result.task.threadId, result.task.version);
      const response: ArchiveTaskResponse = {
        task: toTaskSummary(
          result.task,
          this.executionEnvironmentStore?.getTaskContext(result.task.id),
        ),
        archivedTaskIds: result.affectedTaskIds,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'task.archive',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handleUnarchiveTask(socket: Socket, frame: Frame): void {
    const payload = parseUnarchiveTaskPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const result = this.workspaceStore.setTaskStatus(
        payload.taskId as TaskId,
        'active',
        payload.expectedTaskVersion,
        { cascade: payload.cascade !== false },
      );
      this.threadVersions.set(result.task.threadId, result.task.version);
      const response: UnarchiveTaskResponse = {
        task: toTaskSummary(
          result.task,
          this.executionEnvironmentStore?.getTaskContext(result.task.id),
        ),
        unarchivedTaskIds: result.affectedTaskIds,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'task.unarchive',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handleDiscardEmptyTask(socket: Socket, frame: Frame): void {
    const payload = parseDiscardEmptyTaskPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const task = this.workspaceStore.getTask(payload.taskId);
      const executionContext = task
        ? this.executionEnvironmentStore?.getTaskContext(task.id)
        : undefined;
      const discarded = this.workspaceStore.discardEmptyTask(
        payload.taskId,
        payload.expectedTaskVersion,
        task && this.taskEnvironmentManager
          ? () => this.taskEnvironmentManager!.discardPreparedTask(task.id, executionContext)
          : undefined,
      );
      if (discarded && task) {
        this.threadVersions.delete(task.threadId);
        for (let index = this.events.length - 1; index >= 0; index -= 1) {
          if (this.events[index]?.taskId === task.id) this.events.splice(index, 1);
        }
      }
      const response: DiscardEmptyTaskResponse = {
        taskId: payload.taskId,
        discarded,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'task.discardEmpty',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handlePlanDraft(socket: Socket, frame: Frame): void {
    const payload = parsePlanDraftPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.hasPlanTransitionStores()) {
      this.writePlanStoreUnavailable(socket, frame);
      return;
    }

    try {
      const occurredAt = new Date().toISOString();
      const result = this.unitOfWork!.run(() => {
        const task = this.workspaceStore!.getTask(payload.taskId);
        if (!task) throw new Error(`Task not found: ${payload.taskId}`);
        this.assertPlanAuthoringMode(task);
        const updatedTask = this.workspaceStore!.advanceTaskVersionByThreadId(
          task.threadId,
          payload.expectedTaskVersion,
          occurredAt,
        );
        const revision = this.orchestrationStore!.createPlanDraft({
          taskId: payload.taskId,
          title: payload.title,
          steps: payload.steps,
          now: occurredAt,
        });
        const projectedThreadVersions = new Map(this.threadVersions);
        projectedThreadVersions.set(updatedTask.threadId, updatedTask.version);
        const committedEvents = this.commitProjectedEvents(
          [
            {
              id: ulid() as Event['id'],
              workspaceId: task.workspaceId,
              taskId: task.id,
              category: 'run',
              type: 'plan.drafted',
              occurredAt,
              payload: {
                planId: revision.planId,
                planRevisionId: revision.id,
                revision: revision.revision,
                taskVersion: updatedTask.version,
                title: revision.title,
                stepCount: revision.steps.length,
              },
            },
          ],
          projectedThreadVersions,
          this.demoRuns,
        );
        return { revision, updatedTask, committedEvents };
      });
      this.recordCommittedEvents(result.committedEvents);
      this.threadVersions.set(result.updatedTask.threadId, result.updatedTask.version);
      const response: PlanDraftResponse = {
        ...result.revision,
        taskVersion: result.updatedTask.version,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'plan.draft',
          payload: response,
        }),
      );
      for (const event of result.committedEvents) this.publishEvent(event);
    } catch (error) {
      this.writePlanCommandError(socket, frame, error);
    }
  }

  private handlePlanRevise(socket: Socket, frame: Frame): void {
    const payload = parsePlanRevisePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.hasPlanTransitionStores()) {
      this.writePlanStoreUnavailable(socket, frame);
      return;
    }

    try {
      const occurredAt = new Date().toISOString();
      const result = this.unitOfWork!.run(() => {
        const existingRevision = this.orchestrationStore!.listPlanRevisions(payload.planId)[0];
        if (!existingRevision) throw new Error(`Plan not found: ${payload.planId}`);
        const task = this.workspaceStore!.getTask(existingRevision.taskId);
        if (!task) throw new Error(`Task not found: ${existingRevision.taskId}`);
        this.assertPlanAuthoringMode(task);
        const revision = this.orchestrationStore!.revisePlan({
          planId: payload.planId,
          expectedRevision: payload.expectedRevision,
          title: payload.title,
          steps: payload.steps,
          now: occurredAt,
        });
        const committedEvents = this.commitProjectedEvents(
          [
            {
              id: ulid() as Event['id'],
              workspaceId: task.workspaceId,
              taskId: task.id,
              category: 'run',
              type: 'plan.revised',
              occurredAt,
              payload: {
                planId: revision.planId,
                planRevisionId: revision.id,
                revision: revision.revision,
                previousRevision: payload.expectedRevision,
                title: revision.title,
                stepCount: revision.steps.length,
              },
            },
          ],
          this.threadVersions,
          this.demoRuns,
        );
        return { revision, committedEvents };
      });
      this.recordCommittedEvents(result.committedEvents);
      const response: PlanReviseResponse = result.revision;
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'plan.revise',
          payload: response,
        }),
      );
      for (const event of result.committedEvents) this.publishEvent(event);
    } catch (error) {
      this.writePlanCommandError(socket, frame, error);
    }
  }

  private handlePlanListRevisions(socket: Socket, frame: Frame): void {
    const payload = parsePlanListRevisionsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.orchestrationStore) {
      this.writePlanStoreUnavailable(socket, frame);
      return;
    }
    try {
      const revisions = this.orchestrationStore.listPlanRevisions(payload.planId);
      if (revisions.length === 0) throw new Error(`Plan not found: ${payload.planId}`);
      const response: PlanListRevisionsResponse = { revisions };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'plan.listRevisions',
          payload: response,
        }),
      );
    } catch (error) {
      this.writePlanCommandError(socket, frame, error);
    }
  }

  private handlePlanApprove(socket: Socket, frame: Frame): void {
    const payload = parsePlanApprovePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.hasPlanTransitionStores()) {
      this.writePlanStoreUnavailable(socket, frame);
      return;
    }

    try {
      const occurredAt = new Date().toISOString();
      const result = this.unitOfWork!.run(() => {
        const selectedRevision = this.orchestrationStore!.getPlanRevision(
          payload.planId,
          payload.revision,
        );
        if (!selectedRevision) {
          throw new Error(`PlanRevision not found: ${payload.planId}@${payload.revision}`);
        }
        const task = this.workspaceStore!.getTask(selectedRevision.taskId);
        if (!task) throw new Error(`Task not found: ${selectedRevision.taskId}`);
        this.assertPlanAuthoringMode(task);
        const wasApproved = selectedRevision.state === 'approved';
        const graph = this.orchestrationStore!.approvePlan({
          planId: payload.planId,
          revision: payload.revision,
          now: occurredAt,
        });
        if (wasApproved) return { graph, committedEvents: [] as Event[] };

        const eventDrafts: [EventDraft, ...EventDraft[]] = [
          {
            id: ulid() as Event['id'],
            workspaceId: task.workspaceId,
            taskId: task.id,
            runId: graph.run.id,
            category: 'run',
            type: 'plan.approved',
            occurredAt,
            payload: {
              planId: selectedRevision.planId,
              planRevisionId: selectedRevision.id,
              revision: selectedRevision.revision,
              runId: graph.run.id,
            },
          },
          {
            id: ulid() as Event['id'],
            workspaceId: task.workspaceId,
            taskId: task.id,
            runId: graph.run.id,
            category: 'run',
            type: 'run.queued',
            occurredAt,
            payload: {
              runId: graph.run.id,
              planId: selectedRevision.planId,
              planRevisionId: selectedRevision.id,
              revision: selectedRevision.revision,
              stepIds: [...graph.run.stepIds],
            },
          },
        ];
        for (const step of graph.steps) {
          eventDrafts.push({
            id: ulid() as Event['id'],
            workspaceId: task.workspaceId,
            taskId: task.id,
            runId: graph.run.id,
            stepId: step.id,
            category: 'step',
            type: 'step.created',
            occurredAt,
            payload: {
              runId: graph.run.id,
              stepId: step.id,
              kind: step.kind,
              planRevisionId: selectedRevision.id,
              planOrder: step.planOrder,
              title: step.title,
              agentVersionId: step.agentVersionId,
              ...(step.modelOverrideId === undefined
                ? {}
                : { modelOverrideId: step.modelOverrideId }),
              dependsOn: [...step.dependsOn],
            },
          });
        }
        const committedEvents = this.commitProjectedEvents(
          eventDrafts,
          this.threadVersions,
          this.demoRuns,
        );
        this.createPlanAcceptanceGates({
          runId: graph.run.id,
          planRevisionId: selectedRevision.id,
          task,
          steps: graph.steps,
          now: occurredAt,
        });
        return { graph, committedEvents };
      });
      if (result.committedEvents.length > 0) {
        this.recordCommittedEvents(result.committedEvents);
      }
      const response: PlanApproveResponse = result.graph;
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'plan.approve',
          payload: response,
        }),
      );
      for (const event of result.committedEvents) this.publishEvent(event);
      this.scheduleOrchestrationDrain(result.graph.run.id, 'plan-approval');
    } catch (error) {
      this.writePlanCommandError(socket, frame, error);
    }
  }

  private handleRunGetGraph(socket: Socket, frame: Frame): void {
    const payload = parseRunGetGraphPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.orchestrationStore || !this.workspaceStore) {
      this.writePlanStoreUnavailable(socket, frame);
      return;
    }
    try {
      const graph = this.orchestrationStore.getGraph(payload.runId);
      const task = this.workspaceStore.getTask(payload.taskId);
      if (
        !graph ||
        !task ||
        task.workspaceId !== payload.workspaceId ||
        graph.run.taskId !== task.id
      ) {
        throw new Error('Orchestration scope is not available');
      }
      const response: RunGetGraphResponse = graph;
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'run.getGraph',
          payload: response,
        }),
      );
    } catch (error) {
      this.writePlanCommandError(socket, frame, error);
    }
  }

  private handlePauseRun(socket: Socket, frame: Frame): void {
    const payload = parsePauseRunPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    this.handleOrchestrationRunMutation(socket, frame, payload, 'pause');
  }

  private handleResumeRun(socket: Socket, frame: Frame): void {
    const payload = parseResumeRunPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    this.handleOrchestrationRunMutation(socket, frame, payload, 'resume');
  }

  private handleOrchestrationRunMutation(
    socket: Socket,
    frame: Frame,
    payload: OrchestrationRunMutationPayload,
    operation: 'pause' | 'resume' | 'cancel',
  ): void {
    if (!this.orchestrationStore || !this.workspaceStore || !this.unitOfWork) {
      this.writePlanStoreUnavailable(socket, frame);
      return;
    }

    try {
      const current = this.requireOrchestrationMutationScope(payload);
      const terminal =
        current.graph.run.state === 'completed' ||
        current.graph.run.state === 'failed' ||
        current.graph.run.state === 'cancelled';
      if (terminal) {
        this.writeOrchestrationMutationResponse(socket, frame, current.graph, current.task.version);
        return;
      }
      if (current.task.version !== payload.expectedTaskVersion) {
        this.writeTaskVersionMismatch(
          socket,
          frame,
          current.task.version,
          payload.expectedTaskVersion,
        );
        return;
      }
      const noOp =
        (operation === 'pause' && current.graph.run.state === 'paused') ||
        (operation === 'resume' && current.graph.run.state !== 'paused');
      if (noOp) {
        this.writeOrchestrationMutationResponse(socket, frame, current.graph, current.task.version);
        return;
      }

      const result = this.unitOfWork.run(() => {
        const scoped = this.requireOrchestrationMutationScope(payload);
        if (scoped.task.version !== payload.expectedTaskVersion) {
          throw new Error(
            `task version conflict: expected ${scoped.task.version}, received ${payload.expectedTaskVersion}`,
          );
        }
        const graph =
          operation === 'pause'
            ? (this.scheduler?.pause(payload.runId) ??
              this.orchestrationStore!.pauseRun(payload.runId))
            : operation === 'resume'
              ? (this.scheduler?.resume(payload.runId) ??
                this.orchestrationStore!.resumeRun(payload.runId))
              : (this.scheduler?.persistCancel(payload.runId) ??
                this.orchestrationStore!.cancelRun(payload.runId));
        const task = this.workspaceStore!.advanceTaskVersionByThreadId(
          scoped.task.threadId,
          payload.expectedTaskVersion,
        );
        return { graph, taskVersion: task.version };
      });
      if (operation === 'cancel') this.scheduler?.abortActiveRun(payload.runId);
      this.syncOrchestrationEvents();
      this.writeOrchestrationMutationResponse(socket, frame, result.graph, result.taskVersion);

      if (
        operation === 'resume' &&
        this.scheduler &&
        (result.graph.run.state === 'queued' ||
          result.graph.run.state === 'running' ||
          result.graph.run.state === 'reviewing' ||
          result.graph.run.state === 'revising')
      ) {
        this.scheduleOrchestrationRecovery(payload.runId, 'resume');
      }
    } catch (error) {
      this.writePlanCommandError(socket, frame, error);
    }
  }

  private requireOrchestrationMutationScope(payload: OrchestrationRunMutationPayload): {
    graph: RunGetGraphResponse;
    task: TaskRecord;
  } {
    const graph = this.orchestrationStore!.getGraph(payload.runId);
    const task = this.workspaceStore!.getTask(payload.taskId);
    if (
      !graph ||
      !task ||
      task.workspaceId !== payload.workspaceId ||
      graph.run.taskId !== task.id
    ) {
      throw new Error('Orchestration scope is not available');
    }
    return { graph, task };
  }

  private writeOrchestrationMutationResponse(
    socket: Socket,
    frame: Frame,
    graph: RunGetGraphResponse,
    taskVersion: number,
  ): void {
    const response: OrchestrationRunMutationResponse = { ...graph, taskVersion };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: response,
      }),
    );
  }

  private handleListArtifacts(socket: Socket, frame: Frame): void {
    const payload = parseListArtifactsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.hasArtifactQueryStores()) {
      this.writeArtifactStoreUnavailable(socket, frame);
      return;
    }
    try {
      this.requireArtifactScope(payload);
      const page = this.artifactStore!.listArtifacts(payload, {
        ...(payload.limit === undefined ? {} : { limit: payload.limit }),
        ...(payload.cursor === undefined ? {} : { cursor: payload.cursor }),
      });
      const response: ListArtifactsResponse = {
        artifacts: page.items.map((item) => ({
          artifact: item.artifact,
          versions: item.versions,
          ...(item.selectedVersionId ? { selectedVersionId: item.selectedVersionId } : {}),
        })),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: response,
        }),
      );
    } catch (error) {
      this.writeArtifactCommandError(socket, frame, error);
    }
  }

  private handleGetArtifactVersion(socket: Socket, frame: Frame): void {
    const payload = parseGetArtifactVersionPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.hasArtifactQueryStores()) {
      this.writeArtifactStoreUnavailable(socket, frame);
      return;
    }
    try {
      this.requireArtifactScope(payload);
      const version = this.artifactStore!.getVersionForScope(payload.artifactVersionId, payload);
      if (!version) throw new Error('Artifact version is not available in this scope');
      const response: GetArtifactVersionResponse = { version };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: response,
        }),
      );
    } catch (error) {
      this.writeArtifactCommandError(socket, frame, error);
    }
  }

  private handleCompareArtifactVersions(socket: Socket, frame: Frame): void {
    const payload = parseCompareArtifactVersionsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.hasArtifactQueryStores()) {
      this.writeArtifactStoreUnavailable(socket, frame);
      return;
    }
    try {
      this.requireArtifactScope(payload);
      const left = this.artifactStore!.getVersionForScope(payload.leftVersionId, payload);
      const right = this.artifactStore!.getVersionForScope(payload.rightVersionId, payload);
      if (!left || !right || left.artifactId !== right.artifactId) {
        throw new Error('Artifact versions are not available in the same Artifact scope');
      }
      const comparison =
        left.content !== undefined &&
        right.content !== undefined &&
        left.mimeType === right.mimeType &&
        this.isTextArtifactMime(left.mimeType)
          ? compareTextSnapshots({ left: left.content, right: right.content })
          : this.artifactStore!.compareReferences(left, right);
      const response: CompareArtifactVersionsResponse = {
        artifactId: left.artifactId,
        leftVersionId: left.id,
        rightVersionId: right.id,
        comparison,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: response,
        }),
      );
    } catch (error) {
      this.writeArtifactCommandError(socket, frame, error);
    }
  }

  private handleSelectArtifactVersion(socket: Socket, frame: Frame): void {
    const payload = parseSelectArtifactVersionPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.hasArtifactTransitionStores()) {
      this.writeArtifactStoreUnavailable(socket, frame);
      return;
    }
    try {
      const result = this.unitOfWork!.run(() => {
        const task = this.requireArtifactScope(payload);
        const artifact = this.artifactStore!.getArtifactForScope(payload.artifactId, payload);
        const version = this.artifactStore!.getVersionForScope(payload.artifactVersionId, payload);
        if (!artifact || !version || version.artifactId !== artifact.id) {
          throw new Error('Artifact selection is not available in this scope');
        }
        const existing = this.artifactStore!.getSelectionByOperationId(payload.operationId);
        if (existing) {
          const replay = this.artifactStore!.selectVersion({
            operationId: payload.operationId,
            artifactId: payload.artifactId,
            versionId: payload.artifactVersionId,
            expectedTaskVersion: payload.expectedTaskVersion,
            resultingTaskVersion: payload.expectedTaskVersion + 1,
          });
          return {
            selection: replay.selection,
            updatedTask: undefined,
            committedEvents: [] as Event[],
          };
        }
        this.assertArtifactTaskVersion(task, payload.expectedTaskVersion);
        const occurredAt = new Date().toISOString();
        const updatedTask = this.workspaceStore!.advanceTaskVersionByThreadId(
          task.threadId,
          payload.expectedTaskVersion,
          occurredAt,
        );
        const selection = this.artifactStore!.selectVersion({
          operationId: payload.operationId,
          artifactId: artifact.id,
          versionId: version.id,
          expectedTaskVersion: payload.expectedTaskVersion,
          resultingTaskVersion: updatedTask.version,
          now: occurredAt,
        }).selection;
        const projectedThreadVersions = new Map(this.threadVersions);
        projectedThreadVersions.set(updatedTask.threadId, updatedTask.version);
        const committedEvents = this.commitProjectedEvents(
          [
            {
              id: ulid() as Event['id'],
              workspaceId: task.workspaceId,
              taskId: task.id,
              runId: payload.runId,
              category: 'artifact',
              type: 'artifact.selected',
              occurredAt,
              payload: {
                artifactId: artifact.id,
                artifactVersionId: version.id,
                contentHash: version.contentHash,
                selectionId: selection.id,
                operationId: selection.operationId,
                taskVersion: updatedTask.version,
              },
            },
          ],
          projectedThreadVersions,
          this.demoRuns,
        );
        return { selection, updatedTask, committedEvents };
      });
      if (result.committedEvents.length > 0) {
        this.recordCommittedEvents(result.committedEvents);
        for (const event of result.committedEvents) this.publishEvent(event);
      }
      if (result.updatedTask) {
        this.threadVersions.set(result.updatedTask.threadId, result.updatedTask.version);
      }
      const response: SelectArtifactVersionResponse = {
        selection: result.selection,
        taskVersion: result.selection.resultingTaskVersion,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: response,
        }),
      );
    } catch (error) {
      this.writeArtifactCommandError(socket, frame, error);
    }
  }

  private handleMergeArtifactVersions(socket: Socket, frame: Frame): void {
    const payload = parseMergeArtifactVersionsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.hasArtifactTransitionStores()) {
      this.writeArtifactStoreUnavailable(socket, frame);
      return;
    }
    try {
      const result = this.unitOfWork!.run(() => {
        const task = this.requireArtifactScope(payload);
        const artifact = this.artifactStore!.getArtifactForScope(payload.artifactId, payload);
        const versions = [
          this.artifactStore!.getVersionForScope(payload.baseVersionId, payload),
          this.artifactStore!.getVersionForScope(payload.leftVersionId, payload),
          this.artifactStore!.getVersionForScope(payload.rightVersionId, payload),
        ];
        if (
          !artifact ||
          versions.some((version) => !version || version.artifactId !== artifact.id)
        ) {
          throw new Error('Merge versions are not available in the same Artifact scope');
        }
        const [base, left, right] = versions as [ArtifactVersion, ArtifactVersion, ArtifactVersion];
        const graph = this.orchestrationStore!.getGraph(payload.runId);
        const mergeStep = graph?.steps.find((step) => step.id === payload.sourceStepId);
        if (!mergeStep) {
          throw new Error('Merge source Step does not belong to the owning Run');
        }
        if (mergeStep.kind !== 'merge') {
          throw new Error('Merge source Step must be an explicit merge Step');
        }
        if (
          !mergeStep.dependsOn.includes(left.sourceStepId) ||
          !mergeStep.dependsOn.includes(right.sourceStepId)
        ) {
          throw new Error('Explicit merge Step must depend on both Artifact producer Steps');
        }
        const existing = this.artifactStore!.getMergeOutcomeByOperationId(payload.operationId);
        if (existing) {
          this.assertMergeReplayMatches(payload, existing);
          if (
            existing.status === 'clean' &&
            mergeStep.state !== 'ready' &&
            mergeStep.state !== 'completed'
          ) {
            throw new Error(`Explicit merge Step cannot replay a clean merge: ${mergeStep.state}`);
          }
          if (
            existing.status === 'conflict' &&
            (mergeStep.state !== 'ready' || graph?.run.state !== 'paused')
          ) {
            throw new Error('Explicit merge conflict can replay only while its Run is paused');
          }
          const orchestrationGraph =
            existing.status === 'clean' && mergeStep.state === 'ready'
              ? this.orchestrationStore!.completeMergeStep({
                  runId: payload.runId,
                  stepId: payload.sourceStepId,
                })
              : undefined;
          const response: MergeArtifactVersionsResponse =
            existing.status === 'clean'
              ? {
                  status: 'clean',
                  version: toArtifactVersionSummary(existing.version),
                  taskVersion: existing.resultingTaskVersion,
                }
              : {
                  status: 'conflict',
                  conflict: existing.conflict,
                  runState: 'paused',
                  taskVersion: existing.conflict.resultingTaskVersion,
                };
          return {
            response,
            updatedTask: undefined,
            committedEvents: [] as Event[],
            orchestrationGraph,
          };
        }
        if (mergeStep.state !== 'ready') {
          throw new Error(`Explicit merge Step is not ready: ${mergeStep.state}`);
        }
        this.artifactStore!.assertMergePreconditions({
          artifactId: payload.artifactId,
          baseVersionId: payload.baseVersionId,
          leftVersionId: payload.leftVersionId,
          rightVersionId: payload.rightVersionId,
          sourceStepId: payload.sourceStepId,
        });
        this.assertArtifactTaskVersion(task, payload.expectedTaskVersion);
        if (
          base.mimeType !== left.mimeType ||
          base.mimeType !== right.mimeType ||
          !this.isTextArtifactMime(base.mimeType) ||
          base.content === undefined ||
          left.content === undefined ||
          right.content === undefined
        ) {
          throw new Error('Artifact merge requires inline versions with one mergeable text MIME');
        }
        const merge = mergeTextSnapshots({
          base: base.content,
          left: left.content,
          right: right.content,
        });
        const occurredAt = new Date().toISOString();
        const updatedTask = this.workspaceStore!.advanceTaskVersionByThreadId(
          task.threadId,
          payload.expectedTaskVersion,
          occurredAt,
        );
        const projectedThreadVersions = new Map(this.threadVersions);
        projectedThreadVersions.set(updatedTask.threadId, updatedTask.version);

        if (merge.status === 'clean') {
          const version = this.artifactStore!.createMergedVersion({
            operationId: payload.operationId,
            artifactId: artifact.id,
            baseVersionId: base.id,
            leftVersionId: left.id,
            rightVersionId: right.id,
            sourceStepId: payload.sourceStepId,
            content: merge.content,
            mimeType: base.mimeType,
            expectedTaskVersion: payload.expectedTaskVersion,
            resultingTaskVersion: updatedTask.version,
            metadata: { mergeSource: merge.source },
            now: occurredAt,
          }).version;
          const committedEvents = this.commitProjectedEvents(
            [
              {
                id: ulid() as Event['id'],
                workspaceId: task.workspaceId,
                taskId: task.id,
                runId: payload.runId,
                stepId: payload.sourceStepId,
                category: 'artifact',
                type: 'artifact.merged',
                occurredAt,
                payload: {
                  artifactId: artifact.id,
                  artifactVersionId: version.id,
                  contentHash: version.contentHash,
                  mimeType: version.mimeType,
                  sourceStepId: version.sourceStepId,
                  parentVersionIds: [...version.parentVersionIds],
                  baseVersionId: base.id,
                  operationId: payload.operationId,
                  taskVersion: updatedTask.version,
                },
              },
            ],
            projectedThreadVersions,
            this.demoRuns,
          );
          const orchestrationGraph = this.orchestrationStore!.completeMergeStep({
            runId: payload.runId,
            stepId: payload.sourceStepId,
            now: occurredAt,
          });
          const response: MergeArtifactVersionsResponse = {
            status: 'clean',
            version: toArtifactVersionSummary(version),
            taskVersion: updatedTask.version,
          };
          return { response, updatedTask, committedEvents, orchestrationGraph };
        }

        const conflict = this.artifactStore!.createMergeConflict({
          operationId: payload.operationId,
          artifactId: artifact.id,
          baseVersionId: base.id,
          leftVersionId: left.id,
          rightVersionId: right.id,
          sourceStepId: payload.sourceStepId,
          expectedTaskVersion: payload.expectedTaskVersion,
          resultingTaskVersion: updatedTask.version,
          summary: {
            baseHash: base.contentHash,
            leftHash: left.contentHash,
            rightHash: right.contentHash,
          },
          now: occurredAt,
        }).conflict;
        const committedEvents = this.commitProjectedEvents(
          [
            {
              id: ulid() as Event['id'],
              workspaceId: task.workspaceId,
              taskId: task.id,
              runId: payload.runId,
              stepId: payload.sourceStepId,
              category: 'artifact',
              type: 'artifact.merge-conflicted',
              occurredAt,
              payload: {
                conflictId: conflict.id,
                artifactId: artifact.id,
                baseVersionId: base.id,
                leftVersionId: left.id,
                rightVersionId: right.id,
                baseHash: base.contentHash,
                leftHash: left.contentHash,
                rightHash: right.contentHash,
                operationId: payload.operationId,
                taskVersion: updatedTask.version,
              },
            },
            {
              id: ulid() as Event['id'],
              workspaceId: task.workspaceId,
              taskId: task.id,
              runId: payload.runId,
              category: 'run',
              type: 'run.paused',
              occurredAt,
              payload: {
                runId: payload.runId,
                reason: 'artifact-merge-conflict',
                conflictId: conflict.id,
              },
            },
          ],
          projectedThreadVersions,
          this.demoRuns,
        );
        const response: MergeArtifactVersionsResponse = {
          status: 'conflict',
          conflict,
          runState: 'paused',
          taskVersion: updatedTask.version,
        };
        return { response, updatedTask, committedEvents, orchestrationGraph: undefined };
      });
      if (result.committedEvents.length > 0) {
        this.recordCommittedEvents(result.committedEvents);
        for (const event of result.committedEvents) this.publishEvent(event);
      }
      if (result.updatedTask) {
        this.threadVersions.set(result.updatedTask.threadId, result.updatedTask.version);
      }
      this.syncOrchestrationEvents();
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: result.response,
        }),
      );
      if (
        result.orchestrationGraph &&
        (result.orchestrationGraph.run.state === 'queued' ||
          result.orchestrationGraph.run.state === 'running' ||
          result.orchestrationGraph.run.state === 'reviewing' ||
          result.orchestrationGraph.run.state === 'revising')
      ) {
        this.scheduleOrchestrationDrain(payload.runId, 'artifact-merge');
      }
    } catch (error) {
      this.writeArtifactCommandError(socket, frame, error);
    }
  }

  private handleListArtifactMergeConflicts(socket: Socket, frame: Frame): void {
    const payload = parseListArtifactMergeConflictsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.hasArtifactQueryStores()) {
      this.writeArtifactStoreUnavailable(socket, frame);
      return;
    }
    try {
      this.requireArtifactScope(payload);
      const response: ListArtifactMergeConflictsResponse = {
        conflicts: this.artifactStore!.listMergeConflictsForScope(payload),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: response,
        }),
      );
    } catch (error) {
      this.writeArtifactCommandError(socket, frame, error);
    }
  }

  private handleResolveArtifactMergeConflict(socket: Socket, frame: Frame): void {
    const payload = parseResolveArtifactMergeConflictPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.hasArtifactTransitionStores()) {
      this.writeArtifactStoreUnavailable(socket, frame);
      return;
    }
    try {
      const result = this.unitOfWork!.run(() => {
        const task = this.requireArtifactScope(payload);
        const conflict = this.artifactStore!.getMergeConflictForScope(payload.conflictId, payload);
        if (!conflict) throw new Error('Artifact merge conflict is not available in this scope');
        if (conflict.legacySourceStepUnknown) {
          throw new Error(
            'artifact.legacy_conflict_step_unknown: conflict has no auditable merge Step',
          );
        }
        const graph = this.orchestrationStore!.getGraph(payload.runId);
        const mergeStep = graph?.steps.find((step) => step.id === conflict.sourceStepId);
        if (!mergeStep || mergeStep.kind !== 'merge') {
          throw new Error('Merge conflict source is not an explicit merge Step');
        }

        const existing = this.artifactStore!.getConflictResolutionByOperationId(
          payload.operationId,
        );
        if (existing) {
          const replay = this.artifactStore!.resolveMergeConflict({
            operationId: payload.operationId,
            conflictId: payload.conflictId,
            strategy: payload.strategy,
            ...(payload.content === undefined ? {} : { content: payload.content }),
            expectedTaskVersion: payload.expectedTaskVersion,
            resultingTaskVersion: payload.expectedTaskVersion + 1,
          });
          const response: ResolveArtifactMergeConflictResponse = {
            resolution: replay.resolution,
            version: toArtifactVersionSummary(replay.version),
            runState: 'paused',
            taskVersion: replay.resolution.resultingTaskVersion,
          };
          return {
            response,
            updatedTask: undefined,
            committedEvents: [] as Event[],
          };
        }

        if (graph?.run.state !== 'paused') {
          throw new Error('Artifact merge conflict resolution requires a paused Run');
        }
        if (mergeStep.state !== 'ready') {
          throw new Error(`Explicit merge Step is not ready: ${mergeStep.state}`);
        }
        this.assertArtifactTaskVersion(task, payload.expectedTaskVersion);
        const occurredAt = new Date().toISOString();
        const updatedTask = this.workspaceStore!.advanceTaskVersionByThreadId(
          task.threadId,
          payload.expectedTaskVersion,
          occurredAt,
        );
        const resolved = this.artifactStore!.resolveMergeConflict({
          operationId: payload.operationId,
          conflictId: payload.conflictId,
          strategy: payload.strategy,
          ...(payload.content === undefined ? {} : { content: payload.content }),
          expectedTaskVersion: payload.expectedTaskVersion,
          resultingTaskVersion: updatedTask.version,
          now: occurredAt,
        });
        const projectedThreadVersions = new Map(this.threadVersions);
        projectedThreadVersions.set(updatedTask.threadId, updatedTask.version);
        const committedEvents = this.commitProjectedEvents(
          [
            {
              id: ulid() as Event['id'],
              workspaceId: task.workspaceId,
              taskId: task.id,
              runId: payload.runId,
              stepId: conflict.sourceStepId,
              category: 'artifact',
              type: 'artifact.merge-conflict-resolved',
              occurredAt,
              payload: {
                conflictId: conflict.id,
                artifactId: conflict.artifactId,
                artifactVersionId: resolved.version.id,
                sourceStepId: conflict.sourceStepId,
                strategy: resolved.resolution.strategy,
                operationId: resolved.resolution.operationId,
                taskVersion: updatedTask.version,
              },
            },
          ],
          projectedThreadVersions,
          this.demoRuns,
        );
        this.orchestrationStore!.completeMergeStep({
          runId: payload.runId,
          stepId: conflict.sourceStepId,
          now: occurredAt,
        });
        const response: ResolveArtifactMergeConflictResponse = {
          resolution: resolved.resolution,
          version: toArtifactVersionSummary(resolved.version),
          runState: 'paused',
          taskVersion: updatedTask.version,
        };
        return { response, updatedTask, committedEvents };
      });
      if (result.committedEvents.length > 0) {
        this.recordCommittedEvents(result.committedEvents);
        for (const event of result.committedEvents) this.publishEvent(event);
      }
      if (result.updatedTask) {
        this.threadVersions.set(result.updatedTask.threadId, result.updatedTask.version);
      }
      this.syncOrchestrationEvents();
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: result.response,
        }),
      );
    } catch (error) {
      this.writeArtifactCommandError(socket, frame, error);
    }
  }

  private hasArtifactQueryStores(): boolean {
    return Boolean(this.workspaceStore && this.orchestrationStore && this.artifactStore);
  }

  private hasArtifactTransitionStores(): boolean {
    return Boolean(this.hasArtifactQueryStores() && this.stateStore && this.unitOfWork);
  }

  private requireArtifactScope(scope: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
    runId: RunId;
  }): TaskRecord {
    const task = this.workspaceStore!.getTask(scope.taskId);
    const run = this.orchestrationStore!.getRun(scope.runId);
    if (!task || task.workspaceId !== scope.workspaceId || !run || run.taskId !== task.id) {
      throw new Error('Artifact scope is not available');
    }
    return task;
  }

  private assertArtifactTaskVersion(task: TaskRecord, expectedTaskVersion: number): void {
    if (task.version !== expectedTaskVersion) {
      throw new Error(
        `task version conflict: expected ${task.version}, received ${expectedTaskVersion}`,
      );
    }
  }

  private assertMergeReplayMatches(
    payload: ReturnType<typeof parseMergeArtifactVersionsPayload> & {},
    outcome: ReturnType<SqliteArtifactStore['getMergeOutcomeByOperationId']> & {},
  ): void {
    const commonMatches =
      outcome.status === 'clean'
        ? outcome.version.artifactId === payload.artifactId &&
          outcome.baseVersionId === payload.baseVersionId &&
          outcome.version.parentVersionIds[0] === payload.leftVersionId &&
          outcome.version.parentVersionIds[1] === payload.rightVersionId &&
          outcome.version.sourceStepId === payload.sourceStepId &&
          outcome.expectedTaskVersion === payload.expectedTaskVersion
        : outcome.conflict.artifactId === payload.artifactId &&
          outcome.conflict.baseVersionId === payload.baseVersionId &&
          outcome.conflict.leftVersionId === payload.leftVersionId &&
          outcome.conflict.rightVersionId === payload.rightVersionId &&
          outcome.conflict.sourceStepId === payload.sourceStepId &&
          outcome.conflict.expectedTaskVersion === payload.expectedTaskVersion;
    if (!commonMatches) {
      throw new Error('Artifact operation ID was reused with different merge input');
    }
  }

  private isTextArtifactMime(mimeType: string): boolean {
    return (
      mimeType.startsWith('text/') ||
      mimeType === 'application/json' ||
      mimeType === 'application/xml' ||
      mimeType === 'application/javascript'
    );
  }

  private hasPlanTransitionStores(): boolean {
    return Boolean(
      this.workspaceStore &&
      this.agentStore &&
      this.orchestrationStore &&
      this.stateStore &&
      this.unitOfWork,
    );
  }

  private createPlanAcceptanceGates(input: {
    runId: RunId;
    planRevisionId: string;
    task: TaskRecord;
    steps: ReadonlyArray<{
      id: StepId;
      agentVersionId: AgentVersionId;
      dependsOn: readonly StepId[];
    }>;
    now: string;
  }): void {
    const configuredSteps = input.steps.map((step) => {
      const agent = this.agentStore!.getRequiredAgentVersion(step.agentVersionId);
      return { step, behavior: agent.reviewBehavior };
    });
    for (const { step, behavior } of configuredSteps) {
      if (behavior.role !== 'none' && step.dependsOn.length !== 1) {
        throw new PlanReviewerDependencyError(step.id, step.dependsOn.length);
      }
    }
    const reviewers = configuredSteps.filter(({ behavior }) => behavior.role !== 'none');
    const reviewerStepIds = new Set(reviewers.map(({ step }) => step.id));
    for (const { step } of reviewers) {
      const targetStepId = step.dependsOn[0]!;
      if (reviewerStepIds.has(targetStepId)) {
        throw new PlanReviewerLineageError(step.id, targetStepId);
      }
    }
    if (reviewers.length > 0 && input.task.acceptanceCriteria.length === 0) {
      throw new Error('review.criteria_required');
    }
    for (const { step, behavior } of reviewers) {
      const targetStepId = step.dependsOn[0]!;
      const gateDigest = createHash('sha256')
        .update(
          JSON.stringify({
            kind: 'plan-acceptance-gate',
            planRevisionId: input.planRevisionId,
            targetStepId,
            reviewerStepId: step.id,
            reviewerAgentVersionId: step.agentVersionId,
          }),
        )
        .digest('hex');
      this.orchestrationStore!.createAcceptanceGate({
        id: `auto-gate-${gateDigest}` as AcceptanceGateId,
        runId: input.runId,
        targetStepId,
        reviewerAgentVersionId: step.agentVersionId,
        initialReviewerStepId: step.id,
        ...(behavior.backupAgentVersionId
          ? { backupAgentVersionId: behavior.backupAgentVersionId }
          : {}),
        maxIterations: behavior.maxIterations,
        onLimitReached: behavior.onLimitReached,
        criteria: input.task.acceptanceCriteria.map((description, index) => ({
          id: `criterion-${index + 1}-${createHash('sha256').update(description).digest('hex').slice(0, 16)}`,
          description,
        })),
        now: input.now,
      });
    }
  }

  private assertPlanAuthoringMode(task: TaskRecord): void {
    if (task.participationMode !== 'collaboration') {
      throw new PlanModeBoundaryError(
        `Plan authoring requires collaboration mode; task is ${task.participationMode}`,
      );
    }
  }

  private handleSavePolicy(socket: Socket, frame: Frame): void {
    const payload = parseSavePolicyPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.policyStore) {
      this.writePolicyStoreUnavailable(socket, frame);
      return;
    }

    try {
      this.validatePolicySaveScope(payload);
      const result = this.runInUnitOfWork(() => {
        const policy = toPolicyVersionSummary(this.policyStore!.save(payload));
        const eventPayload = {
          policyId: policy.policyId,
          policyVersionId: policy.id,
          version: policy.version,
          scopeType: policy.scopeType,
          scopeId: policy.scopeId,
          approvalMode: policy.approvalMode,
          ruleCount: policy.rules.length,
        };
        if (this.stateStore) {
          return {
            policy,
            needsProjection: true,
            committedEvents: this.commitEvents([
              {
                id: ulid() as Event['id'],
                workspaceId: payload.workspaceId,
                category: 'approval',
                type: 'approval.policy.saved',
                occurredAt: new Date().toISOString(),
                payload: eventPayload,
              },
            ]),
          };
        }
        return {
          policy,
          needsProjection: false,
          committedEvents: [this.appendEvent('approval', 'approval.policy.saved', eventPayload)],
        };
      });
      if (result.needsProjection) this.recordCommittedEvents(result.committedEvents);
      const response: SavePolicyResponse = { policy: result.policy };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'policy.save',
          payload: response,
        }),
      );
      for (const event of result.committedEvents) this.publishEvent(event);
      if (payload.scopeType === 'task') {
        const blockedTask = this.workspaceStore?.getTask(payload.scopeId as TaskId);
        if (blockedTask?.status === 'blocked') {
          const resumed = this.workspaceStore!.setTaskStatus(
            blockedTask.id,
            'active',
            blockedTask.version,
            { cascade: false },
          ).task;
          this.threadVersions.set(resumed.threadId, resumed.version);
          this.emitSubtaskEvent(
            'run',
            'subtask.permission-resumed',
            {
              threadId: resumed.threadId,
              childTaskId: resumed.id,
              approvalMode: result.policy.approvalMode,
              retryConsumed: false,
              text: '访问范围已更新，正在同一子任务中继续执行。',
            },
            resumed.id,
            resumed.workspaceId,
          );
          this.scheduleReadyDelegatedSubtasks();
        }
      }
    } catch (error) {
      this.writePolicyCommandError(socket, frame, error);
    }
  }

  private handleListPolicies(socket: Socket, frame: Frame): void {
    const payload = parseListPoliciesPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.policyStore) {
      this.writePolicyStoreUnavailable(socket, frame);
      return;
    }

    try {
      const scopes = this.buildApplicablePolicyScopes(payload);
      const policies = this.policyStore.listApplicable(scopes).map(toPolicyVersionSummary);
      const resolved = resolveScopedPolicy(
        policies.map((policy) => ({
          scope: policy.scopeType,
          scopeId: policy.scopeId,
          approvalMode: policy.approvalMode,
          rules: policy.rules,
          policyId: policy.policyId,
          version: policy.version,
        })),
      );
      const response: ListPoliciesResponse = { policies, resolved };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'policy.list',
          payload: response,
        }),
      );
    } catch (error) {
      this.writePolicyCommandError(socket, frame, error);
    }
  }

  private validatePolicySaveScope(payload: SavePolicyPayload): void {
    this.requirePolicyWorkspace(payload.workspaceId);
    for (const rule of payload.rules ?? []) {
      if (!rule.delegateAgentVersionId) continue;
      const delegate = this.agentStore?.getVersion(rule.delegateAgentVersionId);
      if (!delegate || delegate.role.trim().toLowerCase() !== 'approval') {
        throw new PolicyScopeBoundaryError(
          ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
          'Policy delegate AgentVersion is not an exact approval Agent version',
        );
      }
    }

    switch (payload.scopeType) {
      case 'user':
        if (payload.scopeId !== this.installId) {
          throw new PolicyScopeBoundaryError(
            ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
            'User policy scope must match the Runtime install',
          );
        }
        return;
      case 'workspace':
      case 'project':
        if (payload.scopeId !== payload.workspaceId) {
          throw new PolicyScopeBoundaryError(
            ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
            'Workspace policy scope must match the workspace context',
          );
        }
        return;
      case 'task':
        this.requirePolicyTask(payload.workspaceId, payload.scopeId as TaskId);
        return;
      case 'agent':
        this.requirePolicyAgent(payload.scopeId as AgentId);
        return;
      case 'workflow':
      case 'run':
        throw new PolicyScopeBoundaryError(
          ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
          `Policy scope is not supported yet: ${payload.scopeType}`,
        );
    }
  }

  private buildApplicablePolicyScopes(payload: ListPoliciesPayload): PolicyScopeRef[] {
    this.requirePolicyWorkspace(payload.workspaceId);

    const scopes: PolicyScopeRef[] = [
      { scopeType: 'user', scopeId: this.installId },
      { scopeType: 'workspace', scopeId: payload.workspaceId },
      { scopeType: 'project', scopeId: payload.workspaceId },
    ];
    if (payload.taskId) {
      this.requirePolicyTask(payload.workspaceId, payload.taskId);
      scopes.push({ scopeType: 'task', scopeId: payload.taskId });
    }
    if (payload.agentId) {
      this.requirePolicyAgent(payload.agentId);
      scopes.push({ scopeType: 'agent', scopeId: payload.agentId });
    }
    return scopes;
  }

  private hasApplicablePolicyForTask(task: TaskRecord): boolean {
    if (!this.policyStore) return false;
    const scopes: PolicyScopeRef[] = [
      { scopeType: 'user', scopeId: this.installId },
      { scopeType: 'workspace', scopeId: task.workspaceId },
      { scopeType: 'project', scopeId: task.workspaceId },
      { scopeType: 'task', scopeId: task.id },
    ];
    return this.policyStore.listApplicable(scopes).length > 0;
  }

  private requirePolicyWorkspace(workspaceId: WorkspaceId): void {
    if (!this.workspaceStore) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.STORAGE_WRITE_FAILED,
        'Workspace store is not configured on this Runtime',
      );
    }
    if (!this.workspaceStore.getWorkspace(workspaceId)) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.WORKSPACE_NOT_FOUND,
        `Workspace not found: ${workspaceId}`,
      );
    }
  }

  private requirePolicyTask(workspaceId: WorkspaceId, taskId: TaskId): void {
    const task = this.workspaceStore?.getTask(taskId);
    if (!task || task.workspaceId !== workspaceId) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.TASK_NOT_FOUND,
        `Task not found in workspace ${workspaceId}: ${taskId}`,
      );
    }
  }

  private requirePolicyAgent(agentId: AgentId): void {
    if (!this.agentStore) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.STORAGE_WRITE_FAILED,
        'Agent store is not configured on this Runtime',
      );
    }
    if (!this.agentStore.getLatestVersion(agentId)) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
        `Agent not found: ${agentId}`,
      );
    }
  }

  private async handleCreateProvider(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseCreateProviderPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore || !this.secureStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }

    let storeHandle: string | undefined;
    let providerCommitted = false;
    try {
      storeHandle = await this.secureStore.storeSecret(payload.apiKey);
      const created = this.providerStore.createProvider({
        name: payload.name,
        baseUrl: payload.baseUrl,
        protocol: payload.protocol,
        surface: payload.surface ?? defaultSurfaceForProtocol(payload.protocol),
        supportsDiscovery: payload.supportsDiscovery ?? true,
        importedFrom: payload.importedFrom,
        credentialGroupName: payload.credentialGroupName,
        credentialLabel: payload.credentialLabel,
        credentialKind: 'api-key',
        storeHandle,
      });
      providerCommitted = true;

      let discoveredModelCount = 0;
      const createDiscovery = this.resolveDiscoveryAdapter(payload.protocol);
      if (created.provider.supportsDiscovery && createDiscovery) {
        try {
          const discovered = await createDiscovery.discoverModels(
            payload.apiKey,
            created.provider.baseUrl,
          );
          if (discovered.length > 0) {
            this.providerStore.upsertModels({
              providerId: created.provider.id,
              protocol: payload.protocol,
              models: discovered.map((id) => ({
                providerModelId: id,
                displayName: id,
                capabilities: ['text'] as CapabilityTag[],
              })),
              capabilitiesConfirmed: false,
            });
            discoveredModelCount = discovered.length;
          }
        } catch (error) {
          // Discovery is best-effort on create; catalog remains usable without models.
          const message = error instanceof Error ? error.message : 'Provider discovery failed';
          const failureClass =
            error && typeof error === 'object' && 'failureClass' in error
              ? String((error as { failureClass?: unknown }).failureClass)
              : 'transient';
          const scrubbed = message
            .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
            .replace(/Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, 'Bearer [REDACTED]');
          this.recordProviderDiagnostic({
            category: 'provider',
            failureClass,
            summary: `Create-time discovery failed (${failureClass}): ${scrubbed}`,
            detail: {
              providerId: created.provider.id,
              baseUrl: created.provider.baseUrl,
              protocol: payload.protocol,
              phase: 'provider.create',
              errorMessage: scrubbed,
            },
          });
        }
      }

      const summary = this.toProviderSummary(
        this.providerStore
          .listProviders()
          .find((entry) => entry.provider.id === created.provider.id)!,
      );
      const response: CreateProviderResponse = {
        provider: summary,
        secretStored: true,
        discoveredModelCount,
      };

      // Observability: durable scrubbed audit event (never carries secrets).
      if (this.stateStore) {
        const draft: EventDraft = {
          id: ulid() as Event['id'],
          workspaceId: this.workspaceId,
          category: 'provider',
          type: 'provider.created',
          occurredAt: new Date().toISOString(),
          payload: {
            providerId: summary.providerId,
            name: summary.name,
            baseUrl: summary.baseUrl,
            protocol: payload.protocol,
            credentialRefId: created.credentialRef.id,
            modelCount: summary.models.length,
            secretStored: true,
          },
        };
        try {
          const committed = this.stateStore.commitTransition({ events: [draft] });
          for (const event of committed.events) {
            this.events.push(event);
            this.eventSequence = Math.max(this.eventSequence, event.sequence);
            this.publishEvent(event);
          }
        } catch {
          const event = this.appendEvent('provider', 'provider.created', draft.payload);
          this.publishEvent(event);
        }
      } else {
        const event = this.appendEvent('provider', 'provider.created', {
          providerId: summary.providerId,
          name: summary.name,
          baseUrl: summary.baseUrl,
          protocol: payload.protocol,
          credentialRefId: created.credentialRef.id,
          modelCount: summary.models.length,
          secretStored: true,
        });
        this.publishEvent(event);
      }

      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.create',
          payload: response,
        }),
      );
    } catch (error) {
      if (storeHandle && !providerCommitted) {
        try {
          await this.secureStore.removeSecret(storeHandle);
        } catch {
          /* best-effort rollback */
        }
      }
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private async handleUpdateProvider(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseUpdateProviderPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore || !this.secureStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }

    let newStoreHandle: string | undefined;
    let providerCommitted = false;
    try {
      const apiKey =
        typeof payload.apiKey === 'string' && payload.apiKey.trim().length > 0
          ? payload.apiKey
          : undefined;
      if (apiKey) {
        newStoreHandle = await this.secureStore.storeSecret(apiKey);
      }

      const updated = this.providerStore.updateProvider({
        providerId: payload.providerId,
        name: payload.name,
        baseUrl: payload.baseUrl,
        protocol: payload.protocol,
        surface: payload.surface,
        supportsDiscovery: payload.supportsDiscovery,
        credentialLabel: payload.credentialLabel,
        storeHandle: newStoreHandle,
      });
      providerCommitted = true;

      if (updated.previousStoreHandle) {
        try {
          await this.secureStore.removeSecret(updated.previousStoreHandle);
        } catch {
          /* best-effort old handle cleanup */
        }
      }

      const entry = this.providerStore
        .listProviders()
        .find((item) => item.provider.id === updated.provider.id);
      if (!entry) {
        throw new Error(`Provider not found after update: ${payload.providerId}`);
      }
      const summary = this.toProviderSummary(entry);
      const response: UpdateProviderResponse = {
        provider: summary,
        secretRotated: Boolean(newStoreHandle),
      };

      if (this.stateStore) {
        const draft: EventDraft = {
          id: ulid() as Event['id'],
          workspaceId: this.workspaceId,
          category: 'provider',
          type: 'provider.updated',
          occurredAt: new Date().toISOString(),
          payload: {
            providerId: summary.providerId,
            name: summary.name,
            baseUrl: summary.baseUrl,
            protocol: summary.protocol,
            secretRotated: response.secretRotated,
            modelCount: summary.models.length,
          },
        };
        try {
          const committed = this.stateStore.commitTransition({ events: [draft] });
          for (const event of committed.events) {
            this.events.push(event);
            this.eventSequence = Math.max(this.eventSequence, event.sequence);
            this.publishEvent(event);
          }
        } catch {
          const event = this.appendEvent('provider', 'provider.updated', draft.payload);
          this.publishEvent(event);
        }
      } else {
        const event = this.appendEvent('provider', 'provider.updated', {
          providerId: summary.providerId,
          name: summary.name,
          baseUrl: summary.baseUrl,
          protocol: summary.protocol,
          secretRotated: response.secretRotated,
          modelCount: summary.models.length,
        });
        this.publishEvent(event);
      }

      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.update',
          payload: response,
        }),
      );
    } catch (error) {
      if (newStoreHandle && !providerCommitted) {
        try {
          await this.secureStore.removeSecret(newStoreHandle);
        } catch {
          /* best-effort rollback */
        }
      }
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private resolveCcSwitchDbPath(dbPath?: string): string {
    const resolved = (dbPath && dbPath.trim()) || defaultCcSwitchDbPath();
    if (!resolved) {
      throw new Error('无法解析 CC Switch 数据库路径（缺少用户主目录）');
    }
    return resolved;
  }

  private handlePreviewCcSwitchImport(socket: Socket, frame: Frame): void {
    const payload = parsePreviewCcSwitchImportPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    try {
      const dbPath = this.resolveCcSwitchDbPath(payload.dbPath);
      const loaded = loadCcSwitchProviderRows(dbPath);
      const mapped = loaded.rows.map((row) => mapCcSwitchProviderRow(row));
      const items = mapped.map((m) => toCcSwitchPreviewItem(m));
      const importableCount = items.filter((i) => i.importable).length;
      const response: PreviewCcSwitchImportResponse = {
        dbPath: loaded.dbPath,
        items,
        skippedCount: items.length - importableCount,
        importableCount,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.previewCcSwitchImport',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private async handleImportCcSwitch(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseImportCcSwitchPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore || !this.secureStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }

    const results: ImportCcSwitchResponse['results'] = [];
    try {
      const dbPath = this.resolveCcSwitchDbPath(payload.dbPath);
      const loaded = loadCcSwitchProviderRows(dbPath);
      const byId = new Map(loaded.rows.map((row) => [row.id, mapCcSwitchProviderRow(row)]));

      for (const sourceId of payload.sourceIds) {
        const mapped = byId.get(sourceId);
        if (!mapped) {
          results.push({ sourceId, ok: false, error: '源配置不存在' });
          continue;
        }
        if (!mapped.importable || !mapped.baseUrl || !mapped.protocol || !mapped.apiKey) {
          results.push({
            sourceId,
            ok: false,
            name: mapped.name,
            error: mapped.warnings.join('; ') || '不可导入',
          });
          continue;
        }

        let storeHandle: string | undefined;
        let providerCommitted = false;
        try {
          storeHandle = await this.secureStore.storeSecret(mapped.apiKey);
          const created = this.providerStore.createProvider({
            name: mapped.name,
            baseUrl: mapped.baseUrl,
            protocol: mapped.protocol,
            surface: mapped.surface,
            supportsDiscovery: true,
            importedFrom: mapped.importedFrom,
            credentialGroupName: mapped.credentialGroupName,
            credentialLabel: mapped.credentialLabel,
            credentialKind: 'api-key',
            storeHandle,
          });
          providerCommitted = true;

          let discoveredModelCount = 0;
          if (mapped.models.length > 0) {
            this.providerStore.upsertModels({
              providerId: created.provider.id,
              protocol: mapped.protocol,
              models: mapped.models.map((id) => ({
                providerModelId: id,
                displayName: id,
                capabilities: ['text'] as CapabilityTag[],
              })),
              capabilitiesConfirmed: false,
            });
            discoveredModelCount = mapped.models.length;
          }

          const entry = this.providerStore
            .listProviders()
            .find((item) => item.provider.id === created.provider.id);
          if (entry) {
            const summary = this.toProviderSummary(entry);
            const event = this.appendEvent('provider', 'provider.created', {
              providerId: summary.providerId,
              name: summary.name,
              baseUrl: summary.baseUrl,
              protocol: summary.protocol,
              credentialRefId: created.credentialRef.id,
              modelCount: summary.models.length,
              secretStored: true,
              importedFrom: mapped.importedFrom,
              sourceId: mapped.sourceId,
            });
            this.publishEvent(event);
          }

          results.push({
            sourceId,
            ok: true,
            providerId: created.provider.id,
            name: created.provider.name,
            discoveredModelCount,
          });
        } catch (error) {
          if (storeHandle && !providerCommitted) {
            try {
              await this.secureStore.removeSecret(storeHandle);
            } catch {
              /* best-effort */
            }
          }
          const message = error instanceof Error ? error.message : '导入失败';
          const scrubbed = message
            .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
            .replace(/Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, 'Bearer [REDACTED]');
          results.push({ sourceId, ok: false, name: mapped.name, error: scrubbed });
        }
      }

      const response: ImportCcSwitchResponse = {
        results,
        importedCount: results.filter((r) => r.ok).length,
        failedCount: results.filter((r) => !r.ok).length,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.importCcSwitch',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleListProviders(socket: Socket, frame: Frame): void {
    const payload = parseListProvidersPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }
    const response: ListProvidersResponse = {
      providers: this.providerStore.listProviders().map((entry) => this.toProviderSummary(entry)),
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'provider.list',
        payload: response,
      }),
    );
  }

  private async handleDiscoverModels(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseDiscoverModelsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore || !this.secureStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }
    const provider = this.providerStore.getProvider(payload.providerId as ProviderId);
    if (!provider) {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.discoverModels',
          payload: {},
          error: {
            code: ErrorCode.WORKSPACE_NOT_FOUND,
            message: `Provider not found: ${payload.providerId}`,
          },
        }),
      );
      return;
    }

    const catalog = this.providerStore
      .listProviders()
      .find((entry) => entry.provider.id === provider.id);
    const firstCred = catalog?.credentialGroups[0]?.credentials[0];
    const credentialRefId = (payload.credentialRefId ?? firstCred?.id) as
      CredentialRefId | undefined;
    if (!credentialRefId) {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.discoverModels',
          payload: {},
          error: {
            code: ErrorCode.CREDENTIAL_GROUP_EMPTY,
            message: 'No credential available for discovery',
          },
        }),
      );
      return;
    }

    const storeHandle = this.providerStore.getCredentialStoreHandle(credentialRefId);
    if (!storeHandle) {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.discoverModels',
          payload: {},
          error: {
            code: ErrorCode.CREDENTIAL_GROUP_EMPTY,
            message: 'Credential store handle missing',
          },
        }),
      );
      return;
    }

    // Prefer persisted provider protocol; fall back to first model protocol; then openai-chat.
    const existingForProtocol = this.providerStore.listModels(provider.id);
    const previousModelCount = existingForProtocol.length;
    const priorIds = new Set(existingForProtocol.map((m) => m.providerModelId));
    const protocol = (provider.protocol ??
      existingForProtocol[0]?.protocol ??
      'openai-chat') as ProtocolFamily;
    const discovery = this.resolveDiscoveryAdapter(protocol);
    if (!discovery) {
      this.recordProviderDiagnostic({
        category: 'provider',
        failureClass: 'protocol',
        summary: `Discovery unavailable: no adapter for protocol ${protocol}`,
        detail: {
          providerId: provider.id,
          baseUrl: provider.baseUrl,
          protocol,
          phase: 'discoverModels',
        },
      });
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.discoverModels',
          payload: {},
          error: {
            code: ErrorCode.PROVIDER_PROTOCOL_INCOMPATIBLE,
            message: 'No discovery adapter configured for this protocol',
          },
        }),
      );
      return;
    }

    let apiKey = '';
    try {
      apiKey = await this.secureStore.retrieveSecret(storeHandle);
      const discoveredIds = await discovery.discoverModels(apiKey, provider.baseUrl);
      // Protocol already resolved above for routing and upsert
      const upserted = this.providerStore.upsertModels({
        providerId: provider.id,
        protocol,
        models: discoveredIds.map((id) => ({
          providerModelId: id,
          displayName: id,
          capabilities: ['text'] as CapabilityTag[],
        })),
        capabilitiesConfirmed: false,
      });
      const addedIds = discoveredIds.filter((id) => !priorIds.has(id));

      if (this.stateStore) {
        const draft: EventDraft = {
          id: ulid() as Event['id'],
          workspaceId: this.workspaceId,
          category: 'provider',
          type: 'provider.models_discovered',
          occurredAt: new Date().toISOString(),
          payload: {
            providerId: provider.id,
            modelCount: upserted.length,
            discoveredIds,
            addedIds,
            previousModelCount,
            protocol,
            credentialRefId,
          },
        };
        try {
          const committed = this.stateStore.commitTransition({ events: [draft] });
          for (const event of committed.events) {
            this.events.push(event);
            this.eventSequence = Math.max(this.eventSequence, event.sequence);
            this.publishEvent(event);
          }
        } catch {
          const event = this.appendEvent('provider', 'provider.models_discovered', draft.payload);
          this.publishEvent(event);
        }
      }

      const models = this.providerStore.listModels(provider.id).map((m) => this.toModelSummary(m));
      const response: DiscoverModelsResponse = {
        providerId: provider.id,
        models,
        discoveredIds,
        source: 'adapter',
        protocol,
        addedIds,
        previousModelCount,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.discoverModels',
          payload: response,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider discovery failed';
      const failureClass =
        error && typeof error === 'object' && 'failureClass' in error
          ? String((error as { failureClass?: unknown }).failureClass)
          : 'transient';
      const scrubbed = message
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
        .replace(/Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, 'Bearer [REDACTED]');
      this.recordProviderDiagnostic({
        category: 'provider',
        failureClass,
        summary: `Discovery failed (${failureClass}): ${scrubbed}`,
        detail: {
          providerId: provider.id,
          baseUrl: provider.baseUrl,
          protocol,
          phase: 'discoverModels',
          credentialRefId,
          errorMessage: scrubbed,
        },
      });
      this.writeProviderCommandError(socket, frame, error);
    } finally {
      apiKey = '';
    }
  }

  private handleAddModels(socket: Socket, frame: Frame): void {
    const payload = parseAddModelsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }
    try {
      const upserted = this.providerStore.upsertModels({
        providerId: payload.providerId as ProviderId,
        protocol: payload.protocol,
        models: payload.models.map((m) => ({
          providerModelId: m.providerModelId,
          displayName: m.displayName,
          capabilities: m.capabilities as CapabilityTag[] | undefined,
        })),
        capabilitiesConfirmed: false,
      });
      const response: AddModelsResponse = {
        providerId: payload.providerId as ProviderId,
        models: upserted.map((m) => this.toModelSummary(m)),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.addModels',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleProbeCapabilities(socket: Socket, frame: Frame): void {
    const payload = parseProbeCapabilitiesPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }

    try {
      const providerId = payload.providerId as ProviderId;
      const provider = this.providerStore.getProvider(providerId);
      if (!provider) {
        throw new Error(`Provider not found: ${providerId}`);
      }

      let models = this.providerStore.listModels(providerId);
      if (payload.modelId) {
        const one = this.providerStore.getModel(payload.modelId as ModelId);
        if (!one || one.providerId !== providerId) {
          throw new Error(`Model not found for provider: ${payload.modelId}`);
        }
        models = [one];
      }

      const suggestions: CapabilityProbeSuggestion[] = [];
      for (const model of models) {
        const suggestion = suggestCapabilities({
          modelId: model.id,
          providerModelId: model.providerModelId,
          protocol: model.protocol,
          existing: model.capabilities,
        });
        const updated = this.providerStore.updateModelCapabilities({
          modelId: model.id,
          capabilities: suggestion.capabilities,
          capabilitiesConfirmed: false,
        });
        suggestions.push({
          modelId: updated.id,
          providerModelId: updated.providerModelId,
          displayName: updated.displayName,
          capabilities: updated.capabilities,
          capabilitiesConfirmed: false,
          results: suggestion.results,
          confidence: suggestion.confidence,
          reasons: suggestion.reasons,
          source: 'heuristic',
        });
      }

      if (this.stateStore) {
        const draft: EventDraft = {
          id: ulid() as Event['id'],
          workspaceId: this.workspaceId,
          category: 'provider',
          type: 'provider.capabilities_probed',
          occurredAt: new Date().toISOString(),
          payload: {
            providerId,
            modelCount: suggestions.length,
            modelIds: suggestions.map((s) => s.modelId),
            source: 'heuristic',
          },
        };
        try {
          const committed = this.stateStore.commitTransition({ events: [draft] });
          for (const event of committed.events) {
            this.events.push(event);
            this.eventSequence = Math.max(this.eventSequence, event.sequence);
            this.publishEvent(event);
          }
        } catch {
          const event = this.appendEvent('provider', 'provider.capabilities_probed', draft.payload);
          this.publishEvent(event);
        }
      } else {
        const event = this.appendEvent('provider', 'provider.capabilities_probed', {
          providerId,
          modelCount: suggestions.length,
          modelIds: suggestions.map((s) => s.modelId),
          source: 'heuristic',
        });
        this.publishEvent(event);
      }

      const response: ProbeCapabilitiesResponse = {
        providerId,
        suggestions,
        applied: true,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.probeCapabilities',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleConfirmCapabilities(socket: Socket, frame: Frame): void {
    const payload = parseConfirmCapabilitiesPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }

    try {
      const capabilities = normalizeCapabilities(payload.capabilities as string[]);
      const confirmed = payload.confirmed !== false;
      const updated = this.providerStore.updateModelCapabilities({
        modelId: payload.modelId as ModelId,
        capabilities,
        capabilitiesConfirmed: confirmed,
      });

      if (this.stateStore) {
        const draft: EventDraft = {
          id: ulid() as Event['id'],
          workspaceId: this.workspaceId,
          category: 'provider',
          type: 'provider.capabilities_confirmed',
          occurredAt: new Date().toISOString(),
          payload: {
            modelId: updated.id,
            providerId: updated.providerId,
            providerModelId: updated.providerModelId,
            capabilities: updated.capabilities,
            capabilitiesConfirmed: updated.capabilitiesConfirmed,
          },
        };
        try {
          const committed = this.stateStore.commitTransition({ events: [draft] });
          for (const event of committed.events) {
            this.events.push(event);
            this.eventSequence = Math.max(this.eventSequence, event.sequence);
            this.publishEvent(event);
          }
        } catch {
          const event = this.appendEvent(
            'provider',
            'provider.capabilities_confirmed',
            draft.payload,
          );
          this.publishEvent(event);
        }
      } else {
        const event = this.appendEvent('provider', 'provider.capabilities_confirmed', {
          modelId: updated.id,
          providerId: updated.providerId,
          providerModelId: updated.providerModelId,
          capabilities: updated.capabilities,
          capabilitiesConfirmed: updated.capabilitiesConfirmed,
        });
        this.publishEvent(event);
      }

      const response: ConfirmCapabilitiesResponse = {
        model: this.toModelSummary(updated),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.confirmCapabilities',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private toProviderSummary(entry: ProviderCatalogEntry): ProviderSummary {
    const credentials: ProviderCredentialSummary[] = [];
    for (const group of entry.credentialGroups) {
      for (const cred of group.credentials) {
        credentials.push({
          credentialRefId: cred.id,
          credentialGroupId: cred.credentialGroupId,
          groupName: group.name,
          label: cred.label,
          kind: cred.kind,
          hasSecret: true,
        });
      }
    }
    return {
      providerId: entry.provider.id,
      name: entry.provider.name,
      baseUrl: entry.provider.baseUrl,
      protocol: entry.provider.protocol,
      supportsDiscovery: entry.provider.supportsDiscovery,
      surface: inferProviderSurface({
        surface: entry.provider.surface,
        protocol: entry.provider.protocol,
        name: entry.provider.name,
      }),
      importedFrom: entry.provider.importedFrom,
      credentials,
      models: entry.models.map((m) => this.toModelSummary(m)),
      createdAt: entry.provider.createdAt,
      updatedAt: entry.provider.updatedAt,
    };
  }

  private toModelSummary(model: ModelRecord): ProviderModelSummary {
    return {
      modelId: model.id,
      providerModelId: model.providerModelId,
      displayName: model.displayName,
      protocol: model.protocol,
      capabilities: model.capabilities,
      capabilitiesConfirmed: model.capabilitiesConfirmed,
    };
  }

  private resolveDiscoveryAdapter(protocol: ProtocolFamily): DemoProvider | undefined {
    return this.discoveryByProtocol[protocol] ?? this.discoveryAdapter;
  }

  private handleGetAgent(socket: Socket, frame: Frame): void {
    const payload = parseGetAgentPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.agentStore) {
      this.writeAgentStoreUnavailable(socket, frame);
      return;
    }
    try {
      const agentId = (payload.agentId ?? DEFAULT_CONVERSATION_AGENT_ID) as AgentId;
      const record = this.ensureAgentRecord(agentId);
      const response: GetAgentResponse = { agent: this.toAgentBindingSummary(record) };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'agent.get',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleUpdateAgentBinding(socket: Socket, frame: Frame): void {
    const payload = parseUpdateAgentBindingPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.agentStore) {
      this.writeAgentStoreUnavailable(socket, frame);
      return;
    }
    try {
      const agentId = (payload.agentId ?? DEFAULT_CONVERSATION_AGENT_ID) as AgentId;
      // Ensure lineage exists so contracts/name are preserved on first update.
      this.ensureAgentRecord(agentId);
      const updated = this.agentStore.updateBinding({
        agentId,
        defaultModelId: payload.defaultModelId as ModelId,
        fallbackModelIds: payload.fallbackModelIds as ModelId[],
        pauseOnFailure: payload.pauseOnFailure,
        defaultCredentialGroupId: payload.defaultCredentialGroupId,
        pinnedCredentialRefId: payload.pinnedCredentialRefId,
        skillVersionIds: payload.skillVersionIds,
        mcpServerIds: payload.mcpServerIds,
      });
      const followedGroups =
        this.groupStore?.followLatestAgentVersion(updated.agentId, updated.id) ?? [];
      const summary = this.toAgentBindingSummary(updated);
      const event = this.appendEvent('provider', 'agent.binding_updated', {
        agentId: summary.agentId,
        agentVersionId: summary.agentVersionId,
        version: summary.version,
        defaultModelId: summary.defaultModelId,
        fallbackModelIds: summary.fallbackModelIds,
        pauseOnFailure: summary.pauseOnFailure,
        skillVersionIds: summary.skillVersionIds,
        mcpServerIds: summary.mcpServerIds,
        followedGroupIds: followedGroups.map((group) => group.id),
      });
      this.publishEvent(event);
      const response: UpdateAgentBindingResponse = { agent: summary };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'agent.updateBinding',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleListAgents(socket: Socket, frame: Frame): void {
    const payload = parseListAgentsPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.agentStore) {
      this.writeAgentStoreUnavailable(socket, frame);
      return;
    }
    try {
      this.ensureAgentRecord();
      const response: ListAgentsResponse = {
        agents: this.agentStore
          .listLatestVersions()
          .map((record) => this.toAgentDefinitionSummary(record)),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'agent.list',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleCreateAgent(socket: Socket, frame: Frame): void {
    const payload = parseCreateAgentPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.agentStore) {
      this.writeAgentStoreUnavailable(socket, frame);
      return;
    }
    try {
      const created = this.agentStore.createAgent({
        agentId: payload.agentId,
        name: payload.name,
        description: payload.description,
        visualIdentity: payload.visualIdentity,
        role: payload.role,
        developerInstructions: payload.developerInstructions,
        inputContract: payload.inputContract,
        outputContract: payload.outputContract,
        maxConcurrency: payload.maxConcurrency,
        defaultModelId: payload.defaultModelId,
        defaultCredentialGroupId: payload.defaultCredentialGroupId,
        pinnedCredentialRefId: payload.pinnedCredentialRefId,
        pauseOnFailure: payload.pauseOnFailure,
        fallbackModelIds: payload.fallbackModelIds,
        memoryScope: payload.memoryScope,
        skillVersionIds: payload.skillVersionIds,
        mcpServerIds: payload.mcpServerIds,
        mcpToolAllowlist: payload.mcpToolAllowlist,
        permissions: payload.permissions,
        policyId: payload.policyId,
        approvalMode: payload.approvalMode,
        reviewBehavior: payload.reviewBehavior,
        artifactRules: payload.artifactRules,
      });
      const agent = this.toAgentDefinitionSummary(created);
      const event = this.appendEvent('system', 'agent.created', {
        agentId: agent.agentId,
        agentVersionId: agent.agentVersionId,
        version: agent.version,
        name: agent.name,
        role: agent.role,
      });
      this.publishEvent(event);
      const response: CreateAgentResponse = { agent };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'agent.create',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleListAgentVersions(socket: Socket, frame: Frame): void {
    const payload = parseListAgentVersionsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.agentStore) {
      this.writeAgentStoreUnavailable(socket, frame);
      return;
    }
    try {
      const versions = this.agentStore.listAgentVersions(payload.agentId);
      if (versions.length === 0) throw new Error(`Agent not found: ${payload.agentId}`);
      const response: ListAgentVersionsResponse = {
        versions: versions.map((record) => this.toAgentDefinitionSummary(record)),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'agent.listVersions',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleCreateAgentVersion(socket: Socket, frame: Frame): void {
    const payload = parseCreateAgentVersionPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.agentStore) {
      this.writeAgentStoreUnavailable(socket, frame);
      return;
    }
    try {
      const current = this.agentStore.getLatestVersion(payload.agentId);
      if (!current) throw new Error(`Agent not found: ${payload.agentId}`);
      if (current.version !== payload.expectedVersion) {
        throw new Error(
          `agent expectedVersion conflict: current ${current.version}, received ${payload.expectedVersion}`,
        );
      }
      const updated = this.agentStore.updateDefinition({
        agentId: payload.agentId,
        name: payload.name,
        description: payload.description,
        visualIdentity: payload.visualIdentity,
        role: payload.role,
        developerInstructions: payload.developerInstructions,
        inputContract: payload.inputContract,
        outputContract: payload.outputContract,
        maxConcurrency: payload.maxConcurrency,
        defaultModelId: payload.defaultModelId,
        defaultCredentialGroupId: payload.defaultCredentialGroupId,
        pinnedCredentialRefId: payload.pinnedCredentialRefId,
        pauseOnFailure: payload.pauseOnFailure,
        fallbackModelIds: payload.fallbackModelIds,
        memoryScope: payload.memoryScope,
        skillVersionIds: payload.skillVersionIds,
        mcpServerIds: payload.mcpServerIds,
        mcpToolAllowlist: payload.mcpToolAllowlist,
        permissions: payload.permissions,
        policyId: payload.policyId,
        approvalMode: payload.approvalMode,
        reviewBehavior: payload.reviewBehavior,
        artifactRules: payload.artifactRules,
      });
      const followedGroups =
        this.groupStore?.followLatestAgentVersion(updated.agentId, updated.id) ?? [];
      const agent = this.toAgentDefinitionSummary(updated);
      const event = this.appendEvent('system', 'agent.version-created', {
        agentId: agent.agentId,
        agentVersionId: agent.agentVersionId,
        previousAgentVersionId: current.id,
        version: agent.version,
        followedGroupIds: followedGroups.map((group) => group.id),
      });
      this.publishEvent(event);
      const response: CreateAgentVersionResponse = { agent };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'agent.createVersion',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleCreateGroup(socket: Socket, frame: Frame): void {
    const payload = parseCreateGroupPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.groupStore) {
      this.writeGroupStoreUnavailable(socket, frame);
      return;
    }
    try {
      const { group, event } = this.runInUnitOfWork(() => {
        const group = this.groupStore!.create(payload);
        const event = this.appendEvent('system', 'group.created', {
          groupId: group.id,
          version: group.version,
          name: group.name,
          kind: group.kind,
          leadAgentVersionId: group.leadAgentVersionId,
          memberCount: group.members.length,
          callerSurface: this.commandCallerSurface(frame),
        });
        return { group, event };
      });
      this.publishEvent(event);
      const response: CreateGroupResponse = { group };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: 'group.create', payload: response }),
      );
    } catch (error) {
      this.writeGroupCommandError(socket, frame, error);
    }
  }

  private handleGetGroup(socket: Socket, frame: Frame): void {
    const payload = parseGetGroupPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.groupStore) {
      this.writeGroupStoreUnavailable(socket, frame);
      return;
    }
    const group = this.groupStore.get(payload.groupId);
    if (!group) {
      this.writeGroupCommandError(socket, frame, new Error(`Group not found: ${payload.groupId}`));
      return;
    }
    const response: GetGroupResponse = { group };
    socket.write(
      encodeFrame({ id: frame.id, kind: 'response', type: 'group.get', payload: response }),
    );
  }

  private handleListGroups(socket: Socket, frame: Frame): void {
    const payload = parseListGroupsPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.groupStore) {
      this.writeGroupStoreUnavailable(socket, frame);
      return;
    }
    try {
      const response: ListGroupsResponse = { groups: this.groupStore.list(payload) };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: 'group.list', payload: response }),
      );
    } catch (error) {
      this.writeGroupCommandError(socket, frame, error);
    }
  }

  private handleUpdateGroup(socket: Socket, frame: Frame): void {
    const payload = parseUpdateGroupPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.groupStore) {
      this.writeGroupStoreUnavailable(socket, frame);
      return;
    }
    try {
      const { group, event } = this.runInUnitOfWork(() => {
        const group = this.groupStore!.update(payload);
        const event = this.appendEvent('system', 'group.updated', {
          groupId: group.id,
          version: group.version,
          leadAgentVersionId: group.leadAgentVersionId,
          memberCount: group.members.length,
          callerSurface: this.commandCallerSurface(frame),
        });
        return { group, event };
      });
      this.publishEvent(event);
      const response: UpdateGroupResponse = { group };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: 'group.update', payload: response }),
      );
    } catch (error) {
      this.writeGroupCommandError(socket, frame, error);
    }
  }

  private handleAddGroupMember(socket: Socket, frame: Frame): void {
    const payload = parseAddGroupMemberPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    this.mutateGroupMembers(socket, frame, payload.groupId, payload.expectedVersion, (group) => {
      if (group.members.some((member) => member.agentVersionId === payload.member.agentVersionId)) {
        throw new Error(`Group member already exists: ${payload.member.agentVersionId}`);
      }
      return {
        members: [...group.members, payload.member],
        eventType: 'group.member-added',
        eventPayload: { agentVersionId: payload.member.agentVersionId },
      };
    });
  }

  private handleRemoveGroupMember(socket: Socket, frame: Frame): void {
    const payload = parseRemoveGroupMemberPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    this.mutateGroupMembers(socket, frame, payload.groupId, payload.expectedVersion, (group) => {
      if (group.leadAgentVersionId === payload.agentVersionId) {
        throw new Error('Group lead cannot be removed before another member becomes lead');
      }
      if (!group.members.some((member) => member.agentVersionId === payload.agentVersionId)) {
        throw new Error(`Group member not found: ${payload.agentVersionId}`);
      }
      return {
        members: group.members.filter((member) => member.agentVersionId !== payload.agentVersionId),
        eventType: 'group.member-removed',
        eventPayload: { agentVersionId: payload.agentVersionId },
      };
    });
  }

  private handleUpdateGroupMemberResponsibility(socket: Socket, frame: Frame): void {
    const payload = parseUpdateGroupMemberResponsibilityPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    this.mutateGroupMembers(socket, frame, payload.groupId, payload.expectedVersion, (group) => {
      if (!group.members.some((member) => member.agentVersionId === payload.agentVersionId)) {
        throw new Error(`Group member not found: ${payload.agentVersionId}`);
      }
      return {
        members: group.members.map((member) =>
          member.agentVersionId === payload.agentVersionId
            ? { ...member, responsibility: payload.responsibility }
            : member,
        ),
        eventType: 'group.member-responsibility-updated',
        eventPayload: { agentVersionId: payload.agentVersionId },
      };
    });
  }

  private mutateGroupMembers(
    socket: Socket,
    frame: Frame,
    groupId: import('@sync-think/shared').GroupId,
    expectedVersion: number,
    mutation: (group: import('@sync-think/shared').GroupDefinition) => {
      members:
        | import('@sync-think/shared').GroupMember[]
        | import('@sync-think/protocol').GroupMemberInput[];
      eventType: string;
      eventPayload: Record<string, unknown>;
    },
  ): void {
    if (!this.groupStore) {
      this.writeGroupStoreUnavailable(socket, frame);
      return;
    }
    try {
      const { group, event } = this.runInUnitOfWork(() => {
        const current = this.groupStore!.get(groupId);
        if (!current) throw new Error(`Group not found: ${groupId}`);
        const next = mutation(current);
        const group = this.groupStore!.update({
          groupId,
          expectedVersion,
          members: next.members,
        });
        const event = this.appendEvent('system', next.eventType, {
          groupId: group.id,
          version: group.version,
          callerSurface: this.commandCallerSurface(frame),
          ...next.eventPayload,
        });
        return { group, event };
      });
      this.publishEvent(event);
      const response: GroupMemberMutationResponse = { group };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
      );
    } catch (error) {
      this.writeGroupCommandError(socket, frame, error);
    }
  }

  private handleSetGroupLead(socket: Socket, frame: Frame): void {
    const payload = parseSetGroupLeadPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.groupStore) {
      this.writeGroupStoreUnavailable(socket, frame);
      return;
    }
    try {
      const { group, event } = this.runInUnitOfWork(() => {
        const group = this.groupStore!.update({
          groupId: payload.groupId,
          expectedVersion: payload.expectedVersion,
          leadAgentVersionId: payload.agentVersionId,
        });
        const event = this.appendEvent('system', 'group.lead-updated', {
          groupId: group.id,
          version: group.version,
          leadAgentVersionId: group.leadAgentVersionId,
          callerSurface: this.commandCallerSurface(frame),
        });
        return { group, event };
      });
      this.publishEvent(event);
      const response: GroupMemberMutationResponse = { group };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: 'group.setLead', payload: response }),
      );
    } catch (error) {
      this.writeGroupCommandError(socket, frame, error);
    }
  }

  private handleCreateGroupTask(socket: Socket, frame: Frame): void {
    const payload = parseCreateGroupTaskPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.groupStore || !this.workspaceStore) {
      this.writeGroupStoreUnavailable(socket, frame);
      return;
    }
    try {
      const { created, event } = this.runInUnitOfWork(() => {
        const group = this.groupStore!.get(payload.groupId);
        if (!group) throw new Error(`Group not found: ${payload.groupId}`);
        const initial = this.workspaceStore!.createTask({
          workspaceId: payload.workspaceId,
          title: payload.title,
          goal: payload.goal,
          parentTaskId: payload.parentTaskId,
          acceptanceCriteria: payload.acceptanceCriteria,
          participationMode: 'collaboration',
        });
        const created = initial;
        this.groupStore!.attachTask(group.id, created.taskId, created.createdAt);
        const event = this.appendEvent(
          'system',
          'group.task-created',
          {
            groupId: group.id,
            taskId: created.taskId,
            threadId: created.threadId,
            leadAgentVersionId: group.leadAgentVersionId,
            callerSurface: this.commandCallerSurface(frame),
          },
          undefined,
          undefined,
          created.taskId,
          payload.workspaceId,
        );
        return { created, event };
      });
      this.prepareCreatedTaskEnvironment(created.taskId, created.parentTaskId);
      this.threadVersions.set(created.threadId, created.taskVersion);
      this.publishEvent(event);
      const response: CreateGroupTaskResponse = {
        groupId: payload.groupId,
        taskId: created.taskId,
        threadId: created.threadId,
        taskVersion: created.taskVersion,
        participationMode: created.participationMode,
        executionMode: created.executionMode,
        parentTaskId: created.parentTaskId,
        createdAt: created.createdAt,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'group.task.create',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeGroupCommandError(socket, frame, error);
    }
  }

  private assertAutomationTarget(automation: {
    workspaceId: WorkspaceId;
    target: AutomationDefinition['target'];
  }): void {
    if (!this.workspaceStore?.getWorkspace(automation.workspaceId)) {
      throw new Error(`Workspace not found: ${automation.workspaceId}`);
    }
    if (automation.target.type === 'agent') {
      if (!this.agentStore?.getVersion(automation.target.agentVersionId)) {
        throw new Error(`AgentVersion not found: ${automation.target.agentVersionId}`);
      }
      return;
    }
    if (!this.groupStore?.get(automation.target.groupId)) {
      throw new Error(`Group not found: ${automation.target.groupId}`);
    }
  }

  private automationRuntimeStatus() {
    const webhook = this.automationService?.status();
    return {
      schedulerAvailable: Boolean(this.automationService),
      webhookAvailable: webhook?.available === true,
      ...(webhook?.baseUrl ? { webhookBaseUrl: webhook.baseUrl } : {}),
    };
  }

  private webhookPath(): string {
    return `wh_${randomBytes(18).toString('base64url').toLowerCase()}`;
  }

  private validateAutomationTimezone(timezone: string): void {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
    } catch {
      throw new Error('automation.timezone_invalid');
    }
  }

  private automationCommandResponse(
    automation: AutomationDefinition,
    webhookSecret?: string,
  ): AutomationCommandResponse {
    const webhookUrl = this.automationService?.webhookUrl(automation);
    return {
      automation,
      ...(webhookUrl ? { webhookUrl } : {}),
      ...(webhookSecret ? { webhookSecret } : {}),
    };
  }

  private handleAutomationError(socket: Socket, frame: Frame, error: unknown): void {
    const message =
      this.scrubDiagnosticMessage(error instanceof Error ? error.message : '') ??
      'Automation command failed';
    const code = /not found/i.test(message)
      ? ErrorCode.PROTOCOL_UNEXPECTED_REQUEST
      : /version_conflict/i.test(message)
        ? ErrorCode.TASK_VERSION_MISMATCH
        : /invalid|cron_|timezone_|trigger_|target_/i.test(message)
          ? ErrorCode.PROTOCOL_FRAME_MALFORMED
          : ErrorCode.STORAGE_WRITE_FAILED;
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: { code, message },
      }),
    );
  }

  private async handleCreateAutomation(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseCreateAutomationPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.automationStore || !this.secureStore) {
      this.handleAutomationError(socket, frame, new Error('Automation persistence unavailable'));
      return;
    }
    let secretHandle: string | undefined;
    try {
      this.assertAutomationTarget(payload);
      const timezone = payload.timezone ?? 'Asia/Shanghai';
      this.validateAutomationTimezone(timezone);
      const now = new Date();
      const trigger =
        payload.trigger.type === 'cron'
          ? ({ type: 'cron', expression: payload.trigger.expression } as const)
          : ({ type: 'webhook', path: this.webhookPath() } as const);
      const webhookSecret =
        trigger.type === 'webhook' ? randomBytes(32).toString('base64url') : undefined;
      if (webhookSecret) secretHandle = await this.secureStore.storeSecret(webhookSecret);
      const automation = this.automationStore.create({
        name: payload.name,
        workspaceId: payload.workspaceId,
        target: payload.target,
        instruction: payload.instruction,
        approvalMode: payload.approvalMode ?? 'full',
        trigger,
        timezone,
        concurrencyPolicy: payload.concurrencyPolicy ?? 'skip',
        maxConcurrency: payload.maxConcurrency ?? 1,
        maxRetries: payload.maxRetries ?? 0,
        enabled: payload.enabled ?? true,
        ...(secretHandle ? { webhookSecretHandle: secretHandle } : {}),
        ...(trigger.type === 'cron' && (payload.enabled ?? true)
          ? { nextTriggerAt: nextCronOccurrence(trigger.expression, timezone, now) }
          : {}),
        now: now.toISOString(),
      });
      this.emitAutomationEvent('automation.created', automation, undefined, {
        callerSurface: this.commandCallerSurface(frame),
      });
      const response = this.automationCommandResponse(automation, webhookSecret);
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
      );
    } catch (error) {
      if (secretHandle) await this.secureStore.removeSecret(secretHandle).catch(() => undefined);
      this.handleAutomationError(socket, frame, error);
    }
  }

  private async handleUpdateAutomation(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseUpdateAutomationPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.automationStore || !this.secureStore) {
      this.handleAutomationError(socket, frame, new Error('Automation persistence unavailable'));
      return;
    }
    let createdHandle: string | undefined;
    try {
      this.assertAutomationTarget(payload);
      const current = this.automationStore.getRequired(payload.automationId);
      const currentWebhookHandle = this.automationStore.getWebhookSecretHandle(current.id);
      const timezone = payload.timezone ?? 'Asia/Shanghai';
      this.validateAutomationTimezone(timezone);
      let webhookSecret: string | undefined;
      let webhookSecretHandle: string | undefined;
      let trigger: AutomationDefinition['trigger'];
      if (payload.trigger.type === 'cron') {
        trigger = { type: 'cron', expression: payload.trigger.expression };
      } else if (current.trigger.type === 'webhook') {
        trigger = current.trigger;
        webhookSecretHandle = currentWebhookHandle;
      } else {
        trigger = { type: 'webhook', path: this.webhookPath() };
        webhookSecret = randomBytes(32).toString('base64url');
        createdHandle = await this.secureStore.storeSecret(webhookSecret);
        webhookSecretHandle = createdHandle;
      }
      const now = new Date();
      const automation = this.automationStore.replace({
        automationId: payload.automationId,
        expectedVersion: payload.expectedVersion,
        name: payload.name,
        workspaceId: payload.workspaceId,
        target: payload.target,
        instruction: payload.instruction,
        approvalMode: payload.approvalMode ?? 'full',
        trigger,
        timezone,
        concurrencyPolicy: payload.concurrencyPolicy ?? 'skip',
        maxConcurrency: payload.maxConcurrency ?? 1,
        maxRetries: payload.maxRetries ?? 0,
        enabled: payload.enabled ?? true,
        ...(webhookSecretHandle ? { webhookSecretHandle } : {}),
        ...(trigger.type === 'cron' && (payload.enabled ?? true)
          ? { nextTriggerAt: nextCronOccurrence(trigger.expression, timezone, now) }
          : {}),
        now: now.toISOString(),
      });
      if (current.trigger.type === 'webhook' && trigger.type === 'cron') {
        if (currentWebhookHandle) {
          await this.secureStore.removeSecret(currentWebhookHandle).catch(() => undefined);
        }
      }
      this.emitAutomationEvent('automation.updated', automation, undefined, {
        callerSurface: this.commandCallerSurface(frame),
      });
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: this.automationCommandResponse(automation, webhookSecret),
        }),
      );
    } catch (error) {
      if (createdHandle) await this.secureStore.removeSecret(createdHandle).catch(() => undefined);
      this.handleAutomationError(socket, frame, error);
    }
  }

  private async handleDeleteAutomation(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseDeleteAutomationPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.automationStore) {
      this.handleAutomationError(socket, frame, new Error('Automation persistence unavailable'));
      return;
    }
    try {
      const handle = this.automationStore.getWebhookSecretHandle(payload.automationId);
      const automation = this.automationStore.softDelete(
        payload.automationId,
        payload.expectedVersion,
      );
      if (handle && this.secureStore) {
        await this.secureStore.removeSecret(handle).catch(() => undefined);
      }
      this.emitAutomationEvent('automation.deleted', automation, undefined, {
        callerSurface: this.commandCallerSurface(frame),
      });
      const response: DeleteAutomationResponse = { automation };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
      );
    } catch (error) {
      this.handleAutomationError(socket, frame, error);
    }
  }

  private handleGetAutomation(socket: Socket, frame: Frame): void {
    const payload = parseGetAutomationPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    try {
      const automation = this.automationStore?.getRequired(payload.automationId);
      if (!automation || !this.automationStore) throw new Error('automation.not_found');
      const response: GetAutomationResponse = {
        ...this.automationCommandResponse(automation),
        executions: this.automationStore.listExecutions({
          automationId: automation.id,
          limit: 100,
        }),
      };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
      );
    } catch (error) {
      this.handleAutomationError(socket, frame, error);
    }
  }

  private handleListAutomations(socket: Socket, frame: Frame): void {
    const payload = parseListAutomationsPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.automationStore) {
      const response: ListAutomationsResponse = {
        automations: [],
        runtime: this.automationRuntimeStatus(),
      };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
      );
      return;
    }
    const response: ListAutomationsResponse = {
      automations: this.automationStore.list(payload),
      runtime: this.automationRuntimeStatus(),
    };
    socket.write(
      encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
    );
  }

  private async handleTriggerAutomation(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseTriggerAutomationPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.automationService) {
      this.handleAutomationError(socket, frame, new Error('Automation Runtime unavailable'));
      return;
    }
    try {
      const execution = await this.automationService.trigger(
        payload.automationId,
        'manual',
        payload.input,
      );
      const response: TriggerAutomationResponse = {
        execution,
        ...(execution.taskId ? { taskId: execution.taskId } : {}),
      };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
      );
    } catch (error) {
      this.handleAutomationError(socket, frame, error);
    }
  }

  private handleListAutomationExecutions(socket: Socket, frame: Frame): void {
    const payload = parseListAutomationExecutionsPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const response: ListAutomationExecutionsResponse = {
      executions: this.automationStore?.listExecutions(payload) ?? [],
    };
    socket.write(
      encodeFrame({ id: frame.id, kind: 'response', type: frame.type, payload: response }),
    );
  }

  private async createAutomationTask(input: {
    automation: AutomationDefinition;
    taskInput: string;
    source: AutomationTriggerSource;
    triggerId: string;
    attempt: number;
  }): Promise<{ taskId: TaskId }> {
    const suffix = input.attempt > 0 ? ` · 重试 ${input.attempt}` : '';
    const title = `${input.automation.name} · ${input.source}${suffix}`;
    const command = input.automation.target.type === 'group' ? 'group.task.create' : 'task.create';
    const payload =
      input.automation.target.type === 'group'
        ? {
            groupId: input.automation.target.groupId,
            workspaceId: input.automation.workspaceId,
            title,
            goal: input.taskInput,
            acceptanceCriteria: [],
          }
        : {
            workspaceId: input.automation.workspaceId,
            title,
            goal: input.taskInput,
            acceptanceCriteria: [],
          };
    const created = await this.invokeInternalRuntimeCommand(command, payload);
    if (created.error) throw new Error(created.error.message);
    const taskId = (created.payload as { taskId?: unknown }).taskId;
    if (typeof taskId !== 'string') throw new Error('automation.task_creation_invalid_response');

    if (this.policyStore) {
      const policy = await this.invokeInternalRuntimeCommand('policy.save', {
        workspaceId: input.automation.workspaceId,
        scopeType: 'task',
        scopeId: taskId,
        approvalMode: input.automation.approvalMode,
        rules: [],
      });
      if (policy.error) throw new Error(policy.error.message);
    }
    return { taskId: taskId as TaskId };
  }

  private async startAutomationTask(
    automation: AutomationDefinition,
    taskId: TaskId,
  ): Promise<void> {
    const task = this.workspaceStore?.getTask(taskId);
    if (!task) throw new Error(`automation.task_not_found:${taskId}`);
    const response = await this.invokeInternalRuntimeCommand('task.appendMessage', {
      threadId: task.threadId,
      expectedTaskVersion: task.version,
      role: 'user',
      text: task.goal,
      ...(automation.target.type === 'agent'
        ? { agentVersionId: automation.target.agentVersionId }
        : {}),
    });
    if (response.error) throw new Error(response.error.message);
  }

  private async appendAutomationTaskMessage(
    taskId: TaskId,
    message: string,
    role: 'system' | 'user',
  ): Promise<void> {
    const task = this.workspaceStore?.getTask(taskId);
    if (!task) throw new Error(`automation.task_not_found:${taskId}`);
    const response = await this.invokeInternalRuntimeCommand('task.appendMessage', {
      threadId: task.threadId,
      expectedTaskVersion: task.version,
      role,
      text: message,
    });
    if (response.error) throw new Error(response.error.message);
  }

  private getAutomationTaskState(
    taskId: TaskId,
    since: string,
  ): 'running' | 'completed' | 'failed' {
    const task = this.workspaceStore?.getTask(taskId);
    if (!task) return 'failed';
    const sinceMs = Date.parse(since);
    const events = this.events.filter((event) => {
      if (event.taskId === taskId) return Date.parse(event.occurredAt) >= sinceMs;
      return event.payload.threadId === task.threadId && Date.parse(event.occurredAt) >= sinceMs;
    });
    for (const event of [...events].reverse()) {
      if (event.type === 'group.collaboration.completed' || event.type === 'run.completed') {
        return 'completed';
      }
      if (
        event.type === 'group.collaboration.failed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled'
      ) {
        return 'failed';
      }
    }
    return 'running';
  }

  private emitAutomationEvent(
    type: string,
    automation: AutomationDefinition,
    execution?: AutomationExecution,
    detail: Record<string, unknown> = {},
  ): void {
    const task = execution?.taskId ? this.workspaceStore?.getTask(execution.taskId) : undefined;
    const event = this.appendEvent(
      type.startsWith('automation.execution.') ? 'run' : 'system',
      type,
      {
        automationId: automation.id,
        automationName: automation.name,
        workspaceId: automation.workspaceId,
        ...(execution
          ? {
              executionId: execution.id,
              triggerId: execution.triggerId,
              source: execution.source,
              status: execution.status,
              attempt: execution.attempt,
            }
          : {}),
        ...(task ? { threadId: task.threadId, taskId: task.id } : {}),
        ...detail,
      },
      undefined,
      undefined,
      task?.id,
      automation.workspaceId,
    );
    this.publishEvent(event);
  }

  private handleListMemory(socket: Socket, frame: Frame): void {
    const payload = parseListMemoryPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.memoryStore) {
      this.writeMemoryStoreUnavailable(socket, frame);
      return;
    }
    try {
      const workspaceId = (payload.workspaceId ?? this.workspaceId) as WorkspaceId;
      const changes = this.memoryStore.listChanges({
        workspaceId,
        taskId: payload.taskId as TaskId | undefined,
        approvalState: payload.approvalState,
        limit: payload.limit,
      });
      const entries = this.memoryStore.listActiveEntries({
        workspaceId,
        taskId: payload.taskId as TaskId | undefined,
        limit: payload.limit,
      });
      const response: ListMemoryResponse = {
        changes: changes.map((c) => this.toMemoryChangeSummary(c)),
        entries: entries.map((e) => this.toDurableMemoryEntrySummary(e)),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'memory.list',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleProposeMemory(socket: Socket, frame: Frame): void {
    const payload = parseProposeMemoryPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.memoryStore) {
      this.writeMemoryStoreUnavailable(socket, frame);
      return;
    }
    try {
      const change = this.memoryStore.proposeChange({
        workspaceId: (payload.workspaceId ?? this.workspaceId) as WorkspaceId,
        taskId: payload.taskId as TaskId,
        targetScope: payload.targetScope,
        additions: payload.additions,
        modifications: payload.modifications,
        deprecations: payload.deprecations,
        evidenceRefs: payload.evidenceRefs,
        confidence: payload.confidence,
        unresolvedAmbiguity: payload.unresolvedAmbiguity,
        proposedByRunId: payload.proposedByRunId,
        autoApprove: payload.autoApprove,
      });
      const summary = this.toMemoryChangeSummary(change);
      const event = this.appendEvent('memory', 'memory.change.proposed', {
        changeId: summary.id,
        taskId: summary.taskId,
        targetScope: summary.targetScope,
        approvalState: summary.approvalState,
        additionKeys: summary.additions.map((a) => a.key),
        autoApprove: Boolean(payload.autoApprove),
      });
      this.publishEvent(event);
      let approvalRequest: ApprovalRequestSummary | undefined;
      if (summary.approvalState === 'pending' && this.approvalStore) {
        try {
          const workspaceId = (payload.workspaceId ?? this.workspaceId) as WorkspaceId;
          if (workspaceId) {
            const keys = summary.additions
              .map((a) => a.key)
              .slice(0, 4)
              .join(',');
            const evaluation = evaluateApproval({
              mode: 'request',
              action: 'memory.change.propose',
              kind: 'memory',
              insideExplicitPolicy: false,
              delegateAvailable: false,
            });
            const record = this.approvalStore.enqueue({
              workspaceId,
              taskId: summary.taskId,
              runId: summary.proposedByRunId as never,
              kind: 'memory',
              action: 'memory.change.propose',
              summary: `Memory 变更待审 · ${summary.targetScope}${keys ? ' · ' + keys : ''}`,
              humanOnly: evaluation.humanOnly,
              mode: evaluation.mode,
              gate: evaluation.gate,
              metadata: {
                memoryChangeId: summary.id,
                targetScope: summary.targetScope,
                additionKeys: summary.additions.map((a) => a.key),
                source: 'memory.propose',
              },
            });
            approvalRequest = this.toApprovalRequestSummary(record);
            const approvalEvent = this.appendEvent(
              'approval',
              'approval.requested',
              {
                approvalId: approvalRequest.id,
                action: approvalRequest.action,
                kind: approvalRequest.kind,
                memoryChangeId: summary.id,
                taskId: summary.taskId,
                source: 'memory.propose',
              },
              undefined,
              summary.proposedByRunId as never,
            );
            this.publishEvent(approvalEvent);
          }
        } catch (enqueueError) {
          console.warn(
            '[runtime] memory approval enqueue failed',
            enqueueError instanceof Error ? enqueueError.message : enqueueError,
          );
        }
      }
      if (summary.approvalState === 'approved') {
        const approvedEvent = this.appendEvent('memory', 'memory.change.decided', {
          changeId: summary.id,
          decision: 'approved',
          taskId: summary.taskId,
        });
        this.publishEvent(approvedEvent);
      }
      const response: ProposeMemoryResponse = { change: summary, approvalRequest };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'memory.propose',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleDecideMemory(socket: Socket, frame: Frame): void {
    const payload = parseDecideMemoryPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.memoryStore) {
      this.writeMemoryStoreUnavailable(socket, frame);
      return;
    }
    try {
      const change = this.memoryStore.decideChange({
        changeId: payload.changeId as MemoryChangeId,
        decision: payload.decision,
      });
      const summary = this.toMemoryChangeSummary(change);
      this.mirrorApprovalDecisionFromMemory(summary.id, payload.decision);
      const event = this.appendEvent('memory', 'memory.change.decided', {
        changeId: summary.id,
        decision: payload.decision,
        taskId: summary.taskId,
        targetScope: summary.targetScope,
      });
      this.publishEvent(event);
      const response: DecideMemoryResponse = { change: summary };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'memory.decide',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleRollbackMemory(socket: Socket, frame: Frame): void {
    const payload = parseRollbackMemoryPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.memoryStore) {
      this.writeMemoryStoreUnavailable(socket, frame);
      return;
    }
    try {
      const change = this.memoryStore.rollbackChange({
        changeId: payload.changeId,
      });
      const summary = this.toMemoryChangeSummary(change);
      const event = this.appendEvent('memory', 'memory.change.rolled_back', {
        changeId: summary.id,
        taskId: summary.taskId,
        targetScope: summary.targetScope,
        approvalState: summary.approvalState,
        additionKeys: summary.additions.map((a) => a.key),
        modificationKeys: summary.modifications.map((m) => m.key),
        deprecations: summary.deprecations,
      });
      this.publishEvent(event);
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'memory.rollback',
          payload: { change: summary },
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  /**
   * Read-only Context Packet / Manifest inspect (protocol context.packet.peek).
   * Reuses prepareRunBinding selection without starting a run or appending events.
   */
  /**
   * Thread-scoped Manifest amend (protocol context.packet.amend, design 搂10.3).
   * Stores force-exclude overrides applied on next peek / run. Protected kinds
   * (搂20.9) cannot be force-excluded; refused ids are returned for observability.
   */
  private handleAmendContextPacket(socket: Socket, frame: Frame): void {
    const payload = parseAmendContextPacketPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    try {
      const threadId = payload.threadId;
      const now = new Date().toISOString();
      if (payload.clearAll) {
        this.threadContextAmendments.delete(threadId);
        const response: AmendContextPacketResponse = {
          threadId,
          excludeSourceIds: [],
          refusedProtectedIds: [],
          amendedAt: now,
          cleared: true,
        };
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'context.packet.amend',
            payload: response,
          }),
        );
        return;
      }

      // Resolve candidate kinds so we can refuse protected ids without a full prepare.
      const probe = this.buildProtectedContextSelection({
        runId: ulid() as RunId,
        threadId,
        userText: '(amend probe)',
        agentVersionId: DEFAULT_CONVERSATION_AGENT_ID,
      });
      const kindById = new Map<string, string>();
      for (const s of [...probe.selected.included, ...probe.selected.excluded]) {
        kindById.set(s.id, s.kind);
      }

      const requested: string[] = [
        ...new Set(
          (payload.excludeSourceIds ?? [])
            .map((id: string) => id.trim())
            .filter((id: string): id is string => id.length > 0),
        ),
      ];
      const applied: string[] = [];
      const refusedProtectedIds: string[] = [];
      for (const id of requested) {
        const kind = kindById.get(id);
        if (kind && isProtectedSourceKind(kind)) {
          refusedProtectedIds.push(id);
          continue;
        }
        applied.push(id);
      }

      this.threadContextAmendments.set(threadId, { excludeSourceIds: applied });
      const response: AmendContextPacketResponse = {
        threadId,
        excludeSourceIds: applied,
        refusedProtectedIds,
        amendedAt: now,
        cleared: false,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'context.packet.amend',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handlePeekContextPacket(socket: Socket, frame: Frame): void {
    const payload = parsePeekContextPacketPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    try {
      const peekRunId = ulid() as RunId;
      const userText =
        typeof payload.userText === 'string' && payload.userText.trim().length > 0
          ? payload.userText
          : '锛堥瑙堬細灏氭湭鍙戦€佺殑涓婁笅鏂囷級';
      const prepared = this.prepareRunBinding({
        runId: peekRunId,
        threadId: payload.threadId,
        userText,
        modelId: typeof payload.modelId === 'string' ? payload.modelId : undefined,
        credentialRefId:
          typeof payload.credentialRefId === 'string' ? payload.credentialRefId : undefined,
        agentVersionId:
          typeof payload.agentVersionId === 'string' ? payload.agentVersionId : undefined,
      });
      const response: PeekContextPacketResponse = {
        threadId: payload.threadId,
        packetId: prepared.packetId,
        proofHash: prepared.proofHash,
        modelId: prepared.run.modelId,
        providerModelId: prepared.run.providerModelId,
        resolutionSource: prepared.run.resolutionSource,
        credentialRefId: prepared.run.credentialRefId,
        credentialResolutionSource: prepared.run.credentialResolutionSource,
        agentVersionId: prepared.run.agentVersionId,
        agentVersion: prepared.agentVersion,
        skillVersionIds: prepared.skillVersionIds,
        mcpServerIds: prepared.mcpServerIds,
        policyId: prepared.policyId,
        includedSourceIds: prepared.includedSourceIds,
        excludedSourceIds: prepared.excludedSourceIds,
        includedSources: prepared.includedSources,
        excludedSources: prepared.excludedSources,
        summaries: prepared.summaries,
        truncations: prepared.truncations,
        crossTaskRefs: prepared.crossTaskRefs,
        evidenceRefsForMemory: prepared.evidenceRefsForMemory,
        tokenEstimate: prepared.tokenEstimate,
        peekedAt: new Date().toISOString(),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'context.packet.peek',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleListDiagnostics(socket: Socket, frame: Frame): void {
    const payload = parseListDiagnosticsPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.memoryStore) {
      this.writeMemoryStoreUnavailable(socket, frame);
      return;
    }
    try {
      const diagnostics = this.memoryStore.listDiagnostics({
        workspaceId: (payload.workspaceId ?? this.workspaceId) as WorkspaceId,
        taskId: payload.taskId as TaskId | undefined,
        runId: payload.runId as RunId | undefined,
        limit: payload.limit,
      });
      const response: ListDiagnosticsResponse = {
        diagnostics: diagnostics.map((d) => this.toDiagnosticSummary(d)),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'diagnostics.list',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleListApprovals(socket: Socket, frame: Frame): void {
    const payload = parseListApprovalsPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.approvalStore) {
      this.writeApprovalStoreUnavailable(socket, frame);
      return;
    }
    try {
      const workspaceId = (payload.workspaceId ?? this.workspaceId) as WorkspaceId | undefined;
      const items = this.approvalStore.list({
        workspaceId,
        taskId: payload.taskId as TaskId | undefined,
        state: payload.state,
        humanOnly: payload.humanOnly,
        limit: payload.limit,
      });
      const pendingCount = this.approvalStore.countPending(workspaceId);
      const response: ListApprovalsResponse = {
        items: items.map((item) => this.toApprovalRequestSummary(item)),
        pendingCount,
        humanOnlyActions: [...listHumanOnlyActions()],
        modes: ['request', 'delegate', 'full', 'custom'],
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'approval.list',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private resolveServerApproval(input: {
    workspaceId?: WorkspaceId;
    taskId?: TaskId;
    runId?: RunId;
    stepId?: import('@sync-think/shared').StepId;
    agentVersionId?: AgentVersionId;
    action: string;
    kind?: string;
    actionDetails?: unknown;
  }): {
    evaluation: EvaluateApprovalResponse;
    policyMode: ApprovalMode;
    actionDigest: string;
    workspaceId?: WorkspaceId;
    taskId?: TaskId;
    runId?: RunId;
    stepId?: import('@sync-think/shared').StepId;
    agentVersionId?: AgentVersionId;
  } {
    const action = input.action.trim();
    const workspaceId = input.workspaceId;
    const taskId = input.taskId;
    const runId = input.runId;
    const stepId = input.stepId;

    if (!workspaceId && (taskId || runId || stepId || input.agentVersionId)) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
        'Approval scope requires workspaceId',
      );
    }
    if (workspaceId) this.requirePolicyWorkspace(workspaceId);
    if (taskId) {
      if (!workspaceId) throw new Error('Approval task scope requires workspaceId');
      this.requirePolicyTask(workspaceId, taskId);
    }
    if (runId && !taskId) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
        'Approval Run scope requires taskId',
      );
    }
    if (stepId && !runId) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
        'Approval Step scope requires runId',
      );
    }

    const graph = runId ? this.orchestrationStore?.getGraph(runId) : undefined;
    const conversationRun = runId ? this.demoRuns.get(runId) : undefined;
    const conversationRunTask = conversationRun
      ? this.resolveTaskForThread(conversationRun.threadId)
      : undefined;
    const graphOwnsScope = Boolean(graph && graph.run.taskId === taskId);
    const conversationRunOwnsScope = Boolean(
      conversationRunTask && conversationRunTask.id === taskId,
    );
    if (runId && !graphOwnsScope && !conversationRunOwnsScope) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.RUN_NOT_FOUND,
        'Approval Run scope is not available',
      );
    }
    const step = stepId ? graph?.steps.find((candidate) => candidate.id === stepId) : undefined;
    if (stepId && !step) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.RUN_NOT_FOUND,
        'Approval Step scope is not available',
      );
    }

    const persistedAgentVersionId =
      step?.agentVersionId ??
      (conversationRun?.agentVersionId as AgentVersionId | undefined) ??
      input.agentVersionId;
    if (
      step &&
      input.agentVersionId !== undefined &&
      input.agentVersionId !== step.agentVersionId
    ) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
        'Approval AgentVersion does not own the Step',
      );
    }
    if (
      conversationRun &&
      input.agentVersionId !== undefined &&
      input.agentVersionId !== conversationRun.agentVersionId
    ) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
        'Approval AgentVersion does not own the conversation Run',
      );
    }
    const agentVersion = persistedAgentVersionId
      ? this.agentStore?.getVersion(persistedAgentVersionId)
      : undefined;
    if (persistedAgentVersionId && !agentVersion) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
        'Approval AgentVersion is not available',
      );
    }

    const groupApprovalMode = taskId
      ? this.groupStore?.getForTask(taskId)?.approvalMode
      : undefined;
    const resolved = this.resolveEffectiveScopedPolicy({
      workspaceId,
      taskId,
      runId,
      agentVersion: agentVersion
        ? { agentId: String(agentVersion.agentId), approvalMode: agentVersion.approvalMode }
        : undefined,
      groupApprovalMode,
    });
    const actionDecision = resolveActionDecision({
      action,
      approvalMode: resolved.approvalMode,
      rules: resolved.rules,
    });
    const configuredDelegate = actionDecision.delegateAgentVersionId
      ? this.agentStore?.getVersion(actionDecision.delegateAgentVersionId)
      : undefined;
    const delegateAgentVersionId =
      configuredDelegate?.role.trim().toLowerCase() === 'approval'
        ? configuredDelegate.id
        : undefined;
    const humanOnlyProbe = evaluateApproval({
      mode: actionDecision.approvalMode,
      action,
      kind: input.kind,
    });
    const evaluated = humanOnlyProbe.humanOnly
      ? humanOnlyProbe
      : actionDecision.decision === 'allowed'
        ? evaluateApproval({
            mode: actionDecision.approvalMode,
            action,
            kind: input.kind,
            insideExplicitPolicy: true,
          })
        : actionDecision.decision === 'delegate-required'
          ? evaluateApproval({
              mode: actionDecision.approvalMode,
              action,
              kind: input.kind,
              delegateAvailable: delegateAgentVersionId !== undefined,
            })
          : evaluateApproval({
              mode: actionDecision.approvalMode,
              action,
              kind: input.kind,
            });
    const actionDetails = canonicalApprovalDetails(input.actionDetails);
    if (JSON.stringify(actionDetails).length > 16_000) {
      throw new Error('approval.action_details_too_large');
    }
    const actionDigest = createHash('sha256')
      .update(
        JSON.stringify({
          actor: `local-user:${this.installId}`,
          workspaceId: workspaceId ?? null,
          taskId: taskId ?? null,
          runId: runId ?? null,
          stepId: stepId ?? null,
          agentVersionId: persistedAgentVersionId ?? null,
          kind: input.kind ?? 'other',
          action,
          actionDetails,
        }),
      )
      .digest('hex');
    return {
      evaluation: {
        ...evaluated,
        actionDigest,
        ...(evaluated.gate === 'require-delegate' && delegateAgentVersionId
          ? { delegateAgentVersionId }
          : {}),
      },
      policyMode: resolved.approvalMode,
      actionDigest,
      workspaceId,
      taskId,
      runId,
      stepId,
      agentVersionId: persistedAgentVersionId,
    };
  }

  private handleEvaluateApproval(socket: Socket, frame: Frame): void {
    const payload = parseEvaluateApprovalPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    try {
      const resolved = this.resolveServerApproval({
        workspaceId: payload.workspaceId,
        taskId: payload.taskId,
        runId: payload.runId,
        stepId: payload.stepId,
        agentVersionId: payload.agentVersionId,
        action: payload.action,
        kind: payload.kind,
      });
      const response: EvaluateApprovalResponse = resolved.evaluation;
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'approval.evaluate',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleEnqueueApproval(socket: Socket, frame: Frame): void {
    const payload = parseEnqueueApprovalPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.approvalStore) {
      this.writeApprovalStoreUnavailable(socket, frame);
      return;
    }
    try {
      const resolved = this.resolveServerApproval({
        workspaceId: payload.workspaceId,
        taskId: payload.taskId,
        runId: payload.runId,
        stepId: payload.stepId,
        agentVersionId: payload.agentVersionId,
        action: payload.action,
        kind: payload.kind,
        actionDetails: payload.metadata,
      });
      const evaluation = resolved.evaluation;
      const evaluationResponse: EvaluateApprovalResponse = evaluation;

      const autoApproved = evaluation.gate === 'auto-approve';
      if (autoApproved && (evaluation.mode === 'full' || !payload.forceEnqueue)) {
        const response: EnqueueApprovalResponse = {
          evaluation: evaluationResponse,
          enqueued: false,
          autoApproved: true,
        };
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'approval.enqueue',
            payload: response,
          }),
        );
        return;
      }

      const needsQueue =
        (evaluation.mode !== 'full' && Boolean(payload.forceEnqueue)) ||
        evaluation.gate === 'require-human' ||
        evaluation.gate === 'require-delegate' ||
        evaluation.gate === 'deny';

      if (!needsQueue) {
        const response: EnqueueApprovalResponse = {
          evaluation: evaluationResponse,
          enqueued: false,
          autoApproved: false,
        };
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'approval.enqueue',
            payload: response,
          }),
        );
        return;
      }

      const workspaceId = (resolved.workspaceId ?? this.workspaceId) as WorkspaceId;
      if (!workspaceId) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'approval.enqueue',
            payload: {},
            error: {
              code: ErrorCode.PROTOCOL_FRAME_MALFORMED,
              message: 'workspaceId is required to enqueue approval',
            },
          }),
        );
        return;
      }

      const record = this.approvalStore.enqueue({
        workspaceId,
        taskId: resolved.taskId,
        runId: resolved.runId,
        stepId: resolved.stepId,
        kind: payload.kind,
        action: payload.action,
        summary: payload.summary,
        humanOnly: evaluation.humanOnly,
        humanOnlyAction: evaluation.humanOnlyAction,
        mode: evaluation.mode,
        gate: evaluation.gate,
        metadata: {
          ...(payload.metadata ?? {}),
          actorId: `local-user:${this.installId}`,
          actionDigest: resolved.actionDigest,
          workspaceId: resolved.workspaceId ?? null,
          taskId: resolved.taskId ?? null,
          runId: resolved.runId ?? null,
          stepId: resolved.stepId ?? null,
          agentVersionId: resolved.agentVersionId ?? null,
          delegateAgentVersionId: evaluation.delegateAgentVersionId ?? null,
        },
      });
      const summary = this.toApprovalRequestSummary(record);
      const event = this.appendEvent(
        'approval',
        'approval.requested',
        {
          approvalId: summary.id,
          action: summary.action,
          kind: summary.kind,
          humanOnly: summary.humanOnly,
          mode: summary.mode,
          gate: summary.gate,
          taskId: summary.taskId,
        },
        undefined,
        summary.runId as never,
      );
      this.publishEvent(event);

      const response: EnqueueApprovalResponse = {
        evaluation: evaluationResponse,
        item: summary,
        enqueued: true,
        autoApproved: false,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'approval.enqueue',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleDecideApproval(socket: Socket, frame: Frame): void {
    const payload = parseDecideApprovalPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.approvalStore) {
      this.writeApprovalStoreUnavailable(socket, frame);
      return;
    }
    try {
      const existing = this.approvalStore.get(payload.id);
      const decidedBy = payload.decidedBy ?? 'human';
      this.assertApprovalDecisionActor(existing, decidedBy, payload.delegateAgentVersionId);
      const schedulerBound =
        existing?.metadata.source === 'scheduler.step-action' &&
        existing.runId !== undefined &&
        existing.stepId !== undefined;
      const schedulerDecision =
        schedulerBound && this.scheduler
          ? this.scheduler.decideApproval({
              approvalId: payload.id,
              decision: payload.decision,
              decidedBy,
              delegateAgentVersionId: payload.delegateAgentVersionId,
              decisionNote: payload.decisionNote,
            })
          : undefined;
      const record =
        schedulerDecision?.approval ??
        this.approvalStore.decide({
          id: payload.id,
          decision: payload.decision,
          decidedBy,
          decisionNote: payload.decisionNote,
        });
      if (schedulerDecision) this.syncOrchestrationEvents();
      const summary = this.toApprovalRequestSummary(record);
      this.mirrorMemoryDecisionFromApproval(summary, payload.decision);
      const skillAllowlist = this.mirrorSkillAllowlistFromApproval(
        summary,
        payload.decision,
        record.metadata,
      );
      // Fire-and-forget async MCP execute-on-approve (async write after sync decide)
      void this.finishDecideApprovalWithOptionalMcp(
        socket,
        frame,
        summary,
        payload.decision,
        record.metadata,
        skillAllowlist,
        schedulerDecision
          ? { replayed: schedulerDecision.replayed, runId: schedulerDecision.graph.run.id }
          : undefined,
        decidedBy === 'delegate' ? payload.delegateAgentVersionId : undefined,
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private async finishDecideApprovalWithOptionalMcp(
    socket: Socket,
    frame: Frame,
    summary: ApprovalRequestSummary,
    decision: 'approved' | 'rejected',
    metadata: Record<string, unknown> | undefined,
    skillAllowlist: DecideApprovalResponse['skillAllowlist'] | undefined,
    schedulerDecision?: { replayed: boolean; runId: RunId },
    delegateAgentVersionId?: AgentVersionId,
  ): Promise<void> {
    let mcpToolCall: CallMcpToolResponse | undefined;
    try {
      if (
        decision === 'approved' &&
        summary.kind === 'mcp-permission' &&
        metadata &&
        metadata.executeOnApprove === true &&
        metadata.source !== 'mcp.tool.call'
      ) {
        mcpToolCall = await this.executeMcpToolFromApproval(summary, metadata);
      }
    } catch (err) {
      console.warn('[runtime] mcp execute-on-approve failed', err);
      mcpToolCall = {
        sensitivity: {
          sensitive: true,
          reasons: ['execute-on-approve-error'],
          labelZh: '批准后执行失败',
          toolOnCatalog: false,
        },
        evaluation: {
          gate: 'require-human',
          humanOnly: false,
          mode: 'request',
          reason: err instanceof Error ? err.message : String(err),
          labelZh: '执行失败',
        },
        enqueued: false,
        autoApproved: false,
        executed: false,
        simulated: false,
        mcpServerId: String(metadata?.mcpServerId || ''),
        toolName: String(metadata?.toolName || ''),
        trusted: false,
        onAgentAllowlist: false,
        refuseReason: err instanceof Error ? err.message : String(err),
      };
    }

    if (!schedulerDecision) {
      const event = this.appendEvent(
        'approval',
        'approval.decided',
        {
          approvalId: summary.id,
          decision: summary.state,
          decidedBy: summary.decidedBy,
          action: summary.action,
          humanOnly: summary.humanOnly,
          taskId: summary.taskId,
          kind: summary.kind,
          memoryChangeId:
            summary.kind === 'memory'
              ? (metadata?.memoryChangeId as string | undefined)
              : undefined,
          skillVersionId:
            summary.kind === 'skill-permission'
              ? (metadata?.skillVersionId as string | undefined)
              : undefined,
          skillAllowlistBound: skillAllowlist?.bound === true,
          skillAllowlistAgentVersionId: skillAllowlist?.agentVersionId,
          mcpToolExecuted: mcpToolCall?.executed === true,
          mcpToolOk: mcpToolCall?.result?.ok === true,
          ...(delegateAgentVersionId ? { delegateAgentVersionId } : {}),
        },
        undefined,
        summary.runId as never,
      );
      this.publishEvent(event);
    }
    const response: DecideApprovalResponse = {
      item: summary,
      skillAllowlist,
      mcpToolCall,
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'approval.decide',
        payload: response,
      }),
    );
    if (
      metadata?.source === 'conversation.execution-tool' &&
      summary.runId &&
      this.demoRuns.has(summary.runId)
    ) {
      this.scheduleDemoRunExecution(summary.runId);
    }
    if (schedulerDecision && !schedulerDecision.replayed && decision === 'approved') {
      this.scheduleOrchestrationDrain(schedulerDecision.runId, 'step-approval');
    }
  }

  private assertApprovalDecisionActor(
    existing: import('@sync-think/storage').ApprovalRequestRecord | null,
    decidedBy: 'human' | 'delegate',
    requestedDelegateAgentVersionId: AgentVersionId | undefined,
  ): void {
    if (!existing) throw new Error('approval.not_found');
    if (existing.humanOnly && decidedBy !== 'human') {
      throw new Error('approval.human_only_requires_human');
    }
    if (existing.gate === 'require-delegate' && decidedBy !== 'delegate') {
      throw new Error('approval.delegate_required');
    }
    if (decidedBy !== 'delegate') return;
    if (existing.gate !== 'require-delegate') {
      throw new Error('approval.delegate_not_permitted');
    }
    const configuredDelegateAgentVersionId = existing.metadata.delegateAgentVersionId;
    if (
      typeof configuredDelegateAgentVersionId !== 'string' ||
      !requestedDelegateAgentVersionId ||
      requestedDelegateAgentVersionId !== configuredDelegateAgentVersionId
    ) {
      throw new Error('approval.delegate_agent_version_invalid');
    }
    const delegate = this.agentStore?.getVersion(requestedDelegateAgentVersionId);
    if (!delegate || delegate.role.trim().toLowerCase() !== 'approval') {
      throw new Error('approval.delegate_agent_version_invalid');
    }
  }

  /**
   * 搂9.1 / 搂9.3: Import never auto-allowlists. After a human approves a
   * skill-permission (upgrade reapproval), bind the approved skillVersionId
   * onto the default conversation Agent allowlist. Reject leaves allowlist untouched.
   */
  private mirrorSkillAllowlistFromApproval(
    summary: ApprovalRequestSummary,
    decision: 'approved' | 'rejected',
    metadata: Record<string, unknown> | undefined,
  ): DecideApprovalResponse['skillAllowlist'] | undefined {
    if (summary.kind !== 'skill-permission') return undefined;
    if (decision !== 'approved') {
      return {
        bound: false,
        reason: '已拒绝 · 不写入 Agent Skill 白名单',
        skillVersionId:
          typeof metadata?.skillVersionId === 'string' ? metadata.skillVersionId : undefined,
      };
    }
    if (!this.agentStore) {
      return { bound: false, reason: 'Agent store 不可用' };
    }
    const skillVersionId =
      typeof metadata?.skillVersionId === 'string' ? metadata.skillVersionId.trim() : '';
    if (!skillVersionId) {
      return { bound: false, reason: '审批元数据缺少 skillVersionId' };
    }
    const previousSkillVersionId =
      typeof metadata?.previousSkillVersionId === 'string'
        ? metadata.previousSkillVersionId.trim()
        : undefined;
    try {
      const agentId = DEFAULT_CONVERSATION_AGENT_ID;
      const current = this.ensureAgentRecord(agentId);
      const nextIds = [...(current.skillVersionIds ?? [])];
      let changed = false;
      if (previousSkillVersionId) {
        const idx = nextIds.indexOf(previousSkillVersionId);
        if (idx >= 0) {
          if (nextIds[idx] !== skillVersionId) {
            nextIds[idx] = skillVersionId;
            changed = true;
          }
        }
      }
      // Dedup and ensure approved version is present
      const deduped: string[] = [];
      const seen = new Set<string>();
      for (const id of nextIds) {
        if (!id || seen.has(id)) continue;
        // drop previous if we are replacing and it somehow remained
        if (previousSkillVersionId && id === previousSkillVersionId && id !== skillVersionId) {
          changed = true;
          continue;
        }
        seen.add(id);
        deduped.push(id);
      }
      if (!seen.has(skillVersionId)) {
        deduped.push(skillVersionId);
        changed = true;
      }
      if (!changed && seen.has(skillVersionId)) {
        return {
          bound: true,
          agentId: String(agentId),
          skillVersionId,
          agentVersionId: String(current.id),
          previousSkillVersionId,
          reason: '已在白名单中',
        };
      }
      const updated = this.agentStore.updateBinding({
        agentId,
        defaultModelId: current.defaultModelId,
        fallbackModelIds: current.fallbackModelIds,
        pauseOnFailure: current.pauseOnFailure,
        defaultCredentialGroupId: current.defaultCredentialGroupId,
        pinnedCredentialRefId: current.pinnedCredentialRefId ?? null,
        skillVersionIds: deduped,
        mcpServerIds: current.mcpServerIds,
      });
      const agentSummary = this.toAgentBindingSummary(updated);
      const bindEvent = this.appendEvent('provider', 'agent.binding_updated', {
        agentId: agentSummary.agentId,
        agentVersionId: agentSummary.agentVersionId,
        version: agentSummary.version,
        defaultModelId: agentSummary.defaultModelId,
        fallbackModelIds: agentSummary.fallbackModelIds,
        pauseOnFailure: agentSummary.pauseOnFailure,
        skillVersionIds: agentSummary.skillVersionIds,
        mcpServerIds: agentSummary.mcpServerIds,
        source: 'approval.decide',
        skillAllowlistFrom: 'skill-permission',
        approvedSkillVersionId: skillVersionId,
        previousSkillVersionId: previousSkillVersionId ?? null,
      });
      this.publishEvent(bindEvent);
      return {
        bound: true,
        agentId: String(agentSummary.agentId),
        skillVersionId,
        agentVersionId: String(agentSummary.agentVersionId),
        previousSkillVersionId,
        reason: previousSkillVersionId
          ? '已批准 · 替换旧版并写入白名单'
          : '已批准 · 写入 Agent Skill 白名单',
      };
    } catch (error) {
      console.warn(
        '[runtime] mirror skill allowlist from approval failed',
        error instanceof Error ? error.message : error,
      );
      return {
        bound: false,
        skillVersionId,
        previousSkillVersionId,
        reason: error instanceof Error ? error.message : '白名单绑定失败',
      };
    }
  }

  private mirrorApprovalDecisionFromMemory(
    memoryChangeId: string,
    decision: 'approved' | 'rejected',
  ): void {
    if (!this.approvalStore) return;
    try {
      const pending = this.approvalStore.list({ state: 'pending', limit: 100 });
      const match = pending.find(
        (item) =>
          item.kind === 'memory' &&
          item.metadata &&
          item.metadata.memoryChangeId === memoryChangeId,
      );
      if (!match) return;
      const record = this.approvalStore.decide({
        id: match.id,
        decision,
        decidedBy: 'human',
        decisionNote: 'mirrored from memory.decide',
      });
      const summary = this.toApprovalRequestSummary(record);
      const event = this.appendEvent(
        'approval',
        'approval.decided',
        {
          approvalId: summary.id,
          decision: summary.state,
          decidedBy: summary.decidedBy,
          action: summary.action,
          memoryChangeId,
          source: 'memory.decide',
        },
        undefined,
        summary.runId as never,
      );
      this.publishEvent(event);
    } catch (error) {
      console.warn(
        '[runtime] mirror approval from memory failed',
        error instanceof Error ? error.message : error,
      );
    }
  }

  private mirrorMemoryDecisionFromApproval(
    summary: ApprovalRequestSummary,
    decision: 'approved' | 'rejected',
  ): void {
    if (summary.kind !== 'memory' || !this.memoryStore || !this.approvalStore) return;
    try {
      const full = this.approvalStore.get(summary.id as never);
      const memoryChangeId = full?.metadata?.memoryChangeId;
      if (typeof memoryChangeId !== 'string' || !memoryChangeId) return;
      const existing = this.memoryStore
        .listChanges({
          workspaceId: summary.workspaceId as WorkspaceId,
          limit: 100,
        })
        .find((c) => c.id === memoryChangeId);
      if (!existing || existing.approvalState !== 'pending') return;
      const change = this.memoryStore.decideChange({
        changeId: memoryChangeId as MemoryChangeId,
        decision,
      });
      const memSummary = this.toMemoryChangeSummary(change);
      const event = this.appendEvent('memory', 'memory.change.decided', {
        changeId: memSummary.id,
        decision,
        taskId: memSummary.taskId,
        targetScope: memSummary.targetScope,
        source: 'approval.decide',
      });
      this.publishEvent(event);
    } catch (error) {
      console.warn(
        '[runtime] mirror memory from approval failed',
        error instanceof Error ? error.message : error,
      );
    }
  }

  private writeApprovalStoreUnavailable(socket: Socket, frame: Frame): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.STORAGE_WRITE_FAILED,
          message: 'Approval store is not configured on this Runtime',
        },
      }),
    );
  }

  private toApprovalRequestSummary(
    item: import('@sync-think/storage').ApprovalRequestRecord,
  ): ApprovalRequestSummary {
    return {
      id: item.id,
      workspaceId: item.workspaceId,
      taskId: item.taskId,
      runId: item.runId,
      stepId: item.stepId,
      kind: item.kind,
      action: item.action,
      summary: item.summary,
      humanOnly: item.humanOnly,
      humanOnlyAction: item.humanOnlyAction,
      mode: item.mode,
      gate: item.gate,
      state: item.state,
      decidedBy: item.decidedBy,
      delegateAgentVersionId:
        typeof item.metadata.delegateAgentVersionId === 'string' &&
        item.metadata.delegateAgentVersionId.trim().length > 0
          ? (item.metadata.delegateAgentVersionId as AgentVersionId)
          : undefined,
      decisionNote: item.decisionNote,
      createdAt: item.createdAt,
      decidedAt: item.decidedAt,
    };
  }

  private writeSkillStoreUnavailable(socket: Socket, frame: Frame): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.STORAGE_WRITE_FAILED,
          message: 'Skill store is not configured on this Runtime',
        },
      }),
    );
  }

  private toSkillVersionSummary(record: SkillVersionRecord): SkillVersionSummary {
    return {
      skillVersionId: record.id,
      skillId: record.skillId,
      name: record.name,
      description: record.description,
      version: record.version,
      allowedTools: [...record.allowedTools],
      contentFingerprint: record.contentFingerprint,
      hasScripts: record.hasScripts,
      warnings: [...record.warnings],
      createdAt: record.createdAt,
    };
  }

  /**
   * Import SKILL.md as a content-addressed library entry (搂9.2).
   * Parse-only: scripts/shell tools are recorded, never executed on import.
   * Installing a Skill does not auto-allowlist it for any Agent (搂9.1).
   */
  private handleImportSkill(socket: Socket, frame: Frame): void {
    const payload = parseImportSkillPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.skillStore) {
      this.writeSkillStoreUnavailable(socket, frame);
      return;
    }
    try {
      let parsed;
      try {
        parsed = parseSkillMd(payload.skillMd);
      } catch (error) {
        if (error instanceof ParseSkillMdError) {
          const code =
            error.code === 'path_traversal'
              ? ErrorCode.PATH_TRAVERSAL
              : ErrorCode.PROTOCOL_FRAME_MALFORMED;
          socket.write(
            encodeFrame({
              id: frame.id,
              kind: 'response',
              type: 'skill.import',
              payload: {},
              error: {
                code,
                message: error.message,
              },
            }),
          );
          return;
        }
        throw error;
      }

      const fingerprint = skillContentFingerprint({
        name: parsed.name,
        version: parsed.version,
        body: parsed.body,
        allowedTools: parsed.allowedTools,
      });
      const existing = this.skillStore.findByFingerprint(fingerprint);
      // Previous same-name version for permission diff (exclude current fingerprint).
      const previous = this.skillStore.findLatestByName(parsed.name, {
        excludeFingerprint: fingerprint,
      });
      const record = this.skillStore.importVersion({
        name: parsed.name,
        description: parsed.description,
        version: parsed.version,
        sourceMd: payload.skillMd,
        body: parsed.body,
        allowedTools: parsed.allowedTools,
        contentFingerprint: fingerprint,
        hasScripts: parsed.hasScripts,
        warnings: parsed.warnings,
      });
      const summary = this.toSkillVersionSummary(record);
      const rawDiff = diffSkillPermissions(
        previous
          ? {
              skillVersionId: previous.id,
              skillId: previous.skillId,
              name: previous.name,
              version: previous.version,
              allowedTools: previous.allowedTools,
              hasScripts: previous.hasScripts,
            }
          : null,
        {
          skillVersionId: record.id,
          skillId: record.skillId,
          name: record.name,
          version: record.version,
          allowedTools: record.allowedTools,
          hasScripts: record.hasScripts,
        },
      );
      const permissionDiff: SkillPermissionDiffSummary = {
        requiresReapproval: rawDiff.requiresReapproval,
        addedTools: rawDiff.addedTools,
        removedTools: rawDiff.removedTools,
        scriptsAdded: rawDiff.scriptsAdded,
        scriptsRemoved: rawDiff.scriptsRemoved,
        summary: rawDiff.summary,
        label: formatSkillPermissionDiffLabel(rawDiff),
        previousVersion: rawDiff.previous?.version,
        previousSkillVersionId: rawDiff.previous?.skillVersionId,
      };
      let reapprovalRequest: ApprovalRequestSummary | undefined;
      if (permissionDiff.requiresReapproval && this.approvalStore) {
        try {
          const workspaceId = this.workspaceId;
          if (workspaceId) {
            const action = `skill.permission-upgrade:${summary.name}`;
            const evaluation = evaluateApproval({
              mode: 'request',
              action,
              kind: 'skill-permission',
              insideExplicitPolicy: false,
              delegateAvailable: false,
            });
            const added =
              permissionDiff.addedTools.length > 0
                ? ` · +${permissionDiff.addedTools.join(',')}`
                : permissionDiff.scriptsAdded
                  ? ' · +scripts'
                  : '';
            const record = this.approvalStore.enqueue({
              workspaceId,
              kind: 'skill-permission',
              action,
              summary: `Skill 升级需重新批准 · ${summary.name}@${summary.version}${added}`,
              humanOnly: evaluation.humanOnly,
              humanOnlyAction: evaluation.humanOnlyAction,
              mode: evaluation.mode,
              gate: evaluation.gate,
              metadata: {
                skillVersionId: summary.skillVersionId,
                skillId: summary.skillId,
                skillName: summary.name,
                skillVersion: summary.version,
                previousVersion: permissionDiff.previousVersion,
                previousSkillVersionId: permissionDiff.previousSkillVersionId,
                addedTools: permissionDiff.addedTools,
                removedTools: permissionDiff.removedTools,
                scriptsAdded: permissionDiff.scriptsAdded,
                permissionDiffSummary: permissionDiff.summary,
                source: 'skill.import',
              },
            });
            reapprovalRequest = this.toApprovalRequestSummary(record);
            const approvalEvent = this.appendEvent('approval', 'approval.requested', {
              approvalId: reapprovalRequest.id,
              action: reapprovalRequest.action,
              kind: reapprovalRequest.kind,
              humanOnly: reapprovalRequest.humanOnly,
              mode: reapprovalRequest.mode,
              gate: reapprovalRequest.gate,
              skillVersionId: summary.skillVersionId,
              skillName: summary.name,
              source: 'skill.import',
            });
            this.publishEvent(approvalEvent);
          }
        } catch (enqueueError) {
          console.warn(
            '[runtime] skill reapproval enqueue failed',
            enqueueError instanceof Error ? enqueueError.message : enqueueError,
          );
        }
      }
      const event = this.appendEvent('provider', 'skill.imported', {
        skillVersionId: summary.skillVersionId,
        skillId: summary.skillId,
        name: summary.name,
        version: summary.version,
        contentFingerprint: summary.contentFingerprint,
        hasScripts: summary.hasScripts,
        deduped: Boolean(existing),
        warnings: summary.warnings,
        requiresReapproval: permissionDiff.requiresReapproval,
        addedTools: permissionDiff.addedTools,
        permissionDiffSummary: permissionDiff.summary,
        reapprovalRequestId: reapprovalRequest?.id,
      });
      this.publishEvent(event);
      const response: ImportSkillResponse = {
        skill: summary,
        deduped: Boolean(existing),
        permissionDiff,
        reapprovalRequest,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'skill.import',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleListSkills(socket: Socket, frame: Frame): void {
    const payload = parseListSkillsPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.skillStore) {
      this.writeSkillStoreUnavailable(socket, frame);
      return;
    }
    try {
      const skills = this.skillStore
        .listVersions(payload.limit ?? 100)
        .map((r) => this.toSkillVersionSummary(r));
      const response: ListSkillsResponse = { skills };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'skill.list',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  /**
   * Register MCP server metadata (搂9.3). Does not spawn process or call remote tools.
   * Tool schemas are recorded for later allowlisted Context Packet injection.
   */
  private handleRegisterMcpServer(socket: Socket, frame: Frame): void {
    const payload = parseRegisterMcpServerPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.mcpStore) {
      this.writeMcpStoreUnavailable(socket, frame);
      return;
    }
    try {
      const before = this.mcpStore.list(500);
      const existing = before.find(
        (row) =>
          row.name === payload.name.trim() &&
          row.endpoint === String(payload.endpoint ?? '').trim(),
      );
      const record = this.mcpStore.register({
        name: payload.name,
        transport: payload.transport,
        endpoint: payload.endpoint,
        tools: payload.tools?.map(
          (t: { name: string; description?: string; inputSchemaJson?: string }) => ({
            name: t.name,
            description: t.description ?? '',
            inputSchemaJson: t.inputSchemaJson,
          }),
        ),
        trusted: payload.trusted,
        maxOutputBytes: payload.maxOutputBytes,
        timeoutMs: payload.timeoutMs,
        notes: payload.notes,
      });
      const summary = this.toMcpServerSummary(record);
      const event = this.appendEvent('provider', 'mcp.registered', {
        mcpServerId: summary.mcpServerId,
        name: summary.name,
        transport: summary.transport,
        toolCount: summary.tools.length,
        trusted: summary.trusted,
        updated: Boolean(existing),
      });
      this.publishEvent(event);
      const response: RegisterMcpServerResponse = {
        server: summary,
        updated: Boolean(existing),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'mcp.register',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleListMcpServers(socket: Socket, frame: Frame): void {
    const payload = parseListMcpServersPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.mcpStore) {
      this.writeMcpStoreUnavailable(socket, frame);
      return;
    }
    try {
      const servers = this.mcpStore
        .list(payload.limit ?? 100)
        .map((r) => this.toMcpServerSummary(r));
      const response: ListMcpServersResponse = { servers };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'mcp.list',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  /**
   * Probe MCP process policy without spawning (搂9.3).
   * Uses FakeMcpWorker + registered server limits when mcpServerId is provided.
   */
  private async handleProbeMcpPolicy(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseProbeMcpPolicyPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    try {
      let maxOutputBytes = payload.maxOutputBytes;
      let timeoutMs = payload.timeoutMs;
      let trusted = payload.trusted;
      let transport = payload.transport;
      const mcpServerId = payload.mcpServerId;
      if (mcpServerId && this.mcpStore) {
        const row = this.mcpStore.get(mcpServerId);
        if (!row) {
          socket.write(
            encodeFrame({
              id: frame.id,
              kind: 'response',
              type: 'mcp.policy.probe',
              payload: {},
              error: {
                code: ErrorCode.RUN_NOT_FOUND,
                message: 'MCP server not found: ' + mcpServerId,
              },
            }),
          );
          return;
        }
        maxOutputBytes = maxOutputBytes ?? row.maxOutputBytes;
        timeoutMs = timeoutMs ?? row.timeoutMs;
        trusted = trusted ?? row.trusted;
        transport = transport ?? row.transport;
      }
      const policy = normalizeMcpProcessPolicy({
        maxOutputBytes,
        timeoutMs,
        trusted,
      });
      const toolName =
        typeof payload.toolName === 'string' && payload.toolName.trim()
          ? payload.toolName.trim()
          : 'probe';
      const simulatedOutput =
        typeof payload.simulatedOutput === 'string'
          ? payload.simulatedOutput
          : '[probe] MCP policy dry-run 鈥?no process spawn';
      const simulatedElapsedMs =
        typeof payload.simulatedElapsedMs === 'number' ? payload.simulatedElapsedMs : 0;

      const worker = new FakeMcpWorker();
      let completedOut: Record<string, unknown> | null = null;
      let timedOut = false;
      let failMessage = '';

      for await (const event of worker.exec(
        {
          workingDir: process.cwd(),
          action: {
            kind: 'probe-policy',
            toolName,
            simulatedOutput,
            simulatedElapsedMs,
          },
          policy,
          mcpServerId,
          transport,
        },
        {
          token: 'mcp-policy-probe',
          allowedRoot: process.cwd(),
          timeoutMs: policy.timeoutMs,
        },
      )) {
        if (event.type === 'completed') {
          completedOut = event.output as unknown as Record<string, unknown>;
        }
        if (event.type === 'failed') {
          timedOut = event.failureClass === 'timeout';
          failMessage = event.error?.message ?? 'MCP policy probe failed';
        }
      }

      const response: ProbeMcpPolicyResponse = completedOut
        ? {
            ok: Boolean(completedOut.ok),
            timedOut: Boolean(completedOut.timedOut),
            truncated: Boolean(completedOut.truncated),
            contentTrust: completedOut.contentTrust === 'trusted' ? 'trusted' : 'untrusted',
            rawBytes: Number(completedOut.rawBytes) || 0,
            keptBytes: Number(completedOut.keptBytes) || 0,
            maxOutputBytes: policy.maxOutputBytes,
            timeoutMs: policy.timeoutMs,
            trusted: policy.trusted,
            policyLabel:
              typeof completedOut.policyLabel === 'string'
                ? completedOut.policyLabel
                : formatMcpPolicyLabel(policy),
            preview:
              typeof completedOut.preview === 'string'
                ? completedOut.preview
                : previewMcpOutput(simulatedOutput),
            auditNote:
              completedOut.audit &&
              typeof completedOut.audit === 'object' &&
              completedOut.audit !== null &&
              typeof (completedOut.audit as { note?: unknown }).note === 'string'
                ? String((completedOut.audit as { note: string }).note)
                : '',
            simulated: true,
            mcpServerId,
            toolName,
          }
        : {
            ok: false,
            timedOut,
            truncated: false,
            contentTrust: policy.trusted ? 'trusted' : 'untrusted',
            rawBytes: Buffer.byteLength(simulatedOutput, 'utf8'),
            keptBytes: 0,
            maxOutputBytes: policy.maxOutputBytes,
            timeoutMs: policy.timeoutMs,
            trusted: policy.trusted,
            policyLabel: formatMcpPolicyLabel(policy),
            preview: previewMcpOutput(simulatedOutput),
            auditNote: failMessage || 'probe failed without completed event',
            simulated: true,
            mcpServerId,
            toolName,
          };

      const event = this.appendEvent('provider', 'mcp.policy_probed', {
        mcpServerId: response.mcpServerId ?? null,
        toolName: response.toolName,
        ok: response.ok,
        timedOut: response.timedOut,
        truncated: response.truncated,
        contentTrust: response.contentTrust,
        policyLabel: response.policyLabel,
        simulated: true,
      });
      this.publishEvent(event);

      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'mcp.policy.probe',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  /**
   * Soft craft MCP tool *request* (搂9.3 鈫?搂13).
   * Evaluates sensitivity + approval policy and may enqueue Approval Center.
   * Never spawns a process or executes the tool.
   */
  private handleRequestMcpTool(socket: Socket, frame: Frame): void {
    const payload = parseRequestMcpToolPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    try {
      let trusted = false;
      let serverName: string | undefined;
      let registeredTools: string[] = [];
      const mcpServerId = payload.mcpServerId;
      if (mcpServerId && this.mcpStore) {
        const row = this.mcpStore.get(mcpServerId);
        if (!row) {
          socket.write(
            encodeFrame({
              id: frame.id,
              kind: 'response',
              type: 'mcp.tool.request',
              payload: {},
              error: {
                code: ErrorCode.RUN_NOT_FOUND,
                message: 'MCP server not found: ' + mcpServerId,
              },
            }),
          );
          return;
        }
        trusted = Boolean(row.trusted);
        serverName = row.name;
        registeredTools = (row.tools ?? []).map((t: { name: string }) => t.name);
      }

      const sensitivity = evaluateMcpToolSensitivity({
        toolName: payload.toolName,
        trusted,
        registeredTools,
        forceSensitive: payload.forceSensitive,
      });

      const orchestrationAuthorization = this.resolveOrchestrationMcpAuthorization({
        workspaceId: payload.workspaceId,
        taskId: payload.taskId,
        runId: payload.runId,
        stepId: payload.stepId,
        agentVersionId: payload.agentVersionId,
        mcpServerId: mcpServerId ?? '',
        toolName: payload.toolName,
      });
      const validatedScope = orchestrationAuthorization?.scope;
      const evaluationResponse: EvaluateApprovalResponse = validatedScope
        ? this.resolveServerApproval({
            ...validatedScope,
            action: sensitivity.action,
            kind: 'mcp-permission',
            actionDetails: {
              mcpServerId: mcpServerId ?? null,
              toolName: payload.toolName,
              argumentsJson: payload.argumentsJson ?? null,
            },
          }).evaluation
        : orchestrationAuthorization === undefined && sensitivity.sensitive
          ? this.resolveServerApproval({
              workspaceId: payload.workspaceId,
              taskId: payload.taskId,
              action: sensitivity.action,
              kind: 'mcp-permission',
              actionDetails: {
                mcpServerId: mcpServerId ?? null,
                toolName: payload.toolName,
                argumentsJson: payload.argumentsJson ?? null,
              },
            }).evaluation
          : evaluateApproval({
              mode: orchestrationAuthorization === undefined ? 'full' : 'request',
              action: sensitivity.action,
              kind: 'mcp-permission',
              insideExplicitPolicy: orchestrationAuthorization === undefined,
            });

      if (orchestrationAuthorization && !orchestrationAuthorization.allowed) {
        const response: RequestMcpToolResponse = {
          sensitivity: {
            sensitive: sensitivity.sensitive,
            reasons: [...sensitivity.reasons, orchestrationAuthorization.reason],
            labelZh: sensitivity.labelZh,
            toolOnCatalog: sensitivity.toolOnCatalog,
          },
          evaluation: evaluationResponse,
          enqueued: false,
          autoApproved: false,
          authorized: false,
          refuseReason: orchestrationAuthorization.reason,
          simulated: true,
          mcpServerId,
          serverName,
          toolName: payload.toolName,
          trusted,
        };
        if (validatedScope && evaluationResponse.actionDigest) {
          const event = this.appendOrchestrationMcpAudit(
            'mcp.tool_refused',
            {
              mcpServerId: mcpServerId ?? null,
              toolName: payload.toolName,
              reason: orchestrationAuthorization.reason,
              source: 'mcp.tool.request',
              simulated: true,
            },
            validatedScope,
            evaluationResponse.actionDigest,
          );
          this.publishEvent(event);
        }
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'mcp.tool.request',
            payload: response,
          }),
        );
        return;
      }

      if (validatedScope) {
        const autoApproved =
          evaluationResponse.gate === 'auto-approve' &&
          (evaluationResponse.mode === 'full' || !payload.forceEnqueue);
        const event = this.appendOrchestrationMcpAudit(
          'mcp.tool_requested',
          {
            mcpServerId: mcpServerId ?? null,
            serverName: serverName ?? null,
            toolName: payload.toolName,
            sensitive: sensitivity.sensitive,
            reasons: sensitivity.reasons,
            enqueued: false,
            autoApproved,
            authorized: true,
            simulated: true,
          },
          validatedScope,
          evaluationResponse.actionDigest!,
        );
        this.publishEvent(event);
        const response: RequestMcpToolResponse = {
          sensitivity: {
            sensitive: sensitivity.sensitive,
            reasons: sensitivity.reasons,
            labelZh: sensitivity.labelZh,
            toolOnCatalog: sensitivity.toolOnCatalog,
          },
          evaluation: evaluationResponse,
          enqueued: false,
          autoApproved,
          authorized: true,
          simulated: true,
          mcpServerId,
          serverName,
          toolName: payload.toolName,
          trusted,
        };
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'mcp.tool.request',
            payload: response,
          }),
        );
        return;
      }

      const autoApproved =
        evaluationResponse.gate === 'auto-approve' &&
        (evaluationResponse.mode === 'full' || !payload.forceEnqueue);
      let approvalRequest: ApprovalRequestSummary | undefined;
      let enqueued = false;

      if (!autoApproved && this.approvalStore) {
        const workspaceId = (payload.workspaceId ?? this.workspaceId) as WorkspaceId;
        if (workspaceId) {
          const argsPreview =
            typeof payload.argumentsJson === 'string' && payload.argumentsJson.trim()
              ? payload.argumentsJson.trim().slice(0, 120)
              : '';
          const record = this.approvalStore.enqueue({
            workspaceId,
            taskId: payload.taskId as TaskId | undefined,
            runId: payload.runId,
            stepId: payload.stepId,
            kind: 'mcp-permission',
            action: sensitivity.action,
            summary: `MCP 工具待审 · ${serverName ?? 'ad-hoc'} · ${payload.toolName}${
              sensitivity.reasons.length ? ' · ' + sensitivity.reasons.join(',') : ''
            }`,
            humanOnly: evaluationResponse.humanOnly,
            humanOnlyAction: evaluationResponse.humanOnlyAction as never,
            mode: evaluationResponse.mode,
            gate: evaluationResponse.gate,
            metadata: {
              mcpServerId: mcpServerId ?? null,
              serverName: serverName ?? null,
              toolName: payload.toolName,
              argumentsJson: payload.argumentsJson ?? null,
              argsPreview,
              trusted,
              sensitivityReasons: sensitivity.reasons,
              source: 'mcp.tool.request',
              simulated: true,
              workspaceId: payload.workspaceId ?? null,
              taskId: payload.taskId ?? null,
              runId: payload.runId ?? null,
              stepId: payload.stepId ?? null,
              agentVersionId: payload.agentVersionId ?? null,
              actionDigest: evaluationResponse.actionDigest ?? null,
            },
          });
          approvalRequest = this.toApprovalRequestSummary(record);
          enqueued = true;
          const approvalEvent = this.appendEvent('approval', 'approval.requested', {
            approvalId: approvalRequest.id,
            action: approvalRequest.action,
            kind: approvalRequest.kind,
            humanOnly: approvalRequest.humanOnly,
            mode: approvalRequest.mode,
            gate: approvalRequest.gate,
            mcpServerId: mcpServerId ?? null,
            toolName: payload.toolName,
            source: 'mcp.tool.request',
            simulated: true,
          });
          this.publishEvent(approvalEvent);
        }
      }

      const event = this.appendEvent('provider', 'mcp.tool_requested', {
        mcpServerId: mcpServerId ?? null,
        serverName: serverName ?? null,
        toolName: payload.toolName,
        sensitive: sensitivity.sensitive,
        reasons: sensitivity.reasons,
        enqueued,
        autoApproved,
        authorized: true,
        approvalRequestId: approvalRequest?.id ?? null,
        simulated: true,
      });
      this.publishEvent(event);

      const response: RequestMcpToolResponse = {
        sensitivity: {
          sensitive: sensitivity.sensitive,
          reasons: sensitivity.reasons,
          labelZh: sensitivity.labelZh,
          toolOnCatalog: sensitivity.toolOnCatalog,
        },
        evaluation: evaluationResponse,
        enqueued,
        autoApproved,
        authorized: true,
        simulated: true,
        approvalRequest,
        mcpServerId,
        serverName,
        toolName: payload.toolName,
        trusted,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'mcp.tool.request',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  /**
   * Real local-stdio spawn probe (sec 9.3 / 14).
   * Spawns an allowlisted short-lived process with timeout/output limits.
   * Does NOT speak MCP JSON-RPC or execute tools.
   */
  private async handleProbeMcpSpawn(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseProbeMcpSpawnPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    try {
      let endpoint = typeof payload.endpoint === 'string' ? payload.endpoint.trim() : '';
      let maxOutputBytes = payload.maxOutputBytes;
      let timeoutMs = payload.timeoutMs;
      let trusted = payload.trusted;
      let transport = payload.transport ?? 'local-stdio';
      const mcpServerId = payload.mcpServerId;

      if (mcpServerId) {
        if (!this.mcpStore) {
          this.writeMcpStoreUnavailable(socket, frame);
          return;
        }
        const row = this.mcpStore.get(mcpServerId);
        if (!row) {
          socket.write(
            encodeFrame({
              id: frame.id,
              kind: 'response',
              type: 'mcp.spawn.probe',
              payload: {},
              error: {
                code: ErrorCode.RUN_NOT_FOUND,
                message: 'MCP server not found: ' + mcpServerId,
              },
            }),
          );
          return;
        }
        endpoint = endpoint || String(row.endpoint || '');
        maxOutputBytes = maxOutputBytes ?? row.maxOutputBytes;
        timeoutMs = timeoutMs ?? row.timeoutMs;
        trusted = trusted ?? row.trusted;
        transport = payload.transport ?? row.transport ?? 'local-stdio';
      }

      if (!endpoint) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'mcp.spawn.probe',
            payload: {},
            error: {
              code: ErrorCode.PROTOCOL_FRAME_MALFORMED,
              message: 'mcp.spawn.probe requires mcpServerId with endpoint or ad-hoc endpoint',
            },
          }),
        );
        return;
      }

      const policy = normalizeMcpProcessPolicy({
        maxOutputBytes,
        timeoutMs,
        trusted,
      });

      const worker = new LocalStdioMcpWorker();
      let completedOut: Record<string, unknown> | null = null;
      let failMessage = '';
      let failClass = '';

      for await (const event of worker.exec(
        {
          workingDir: process.cwd(),
          endpoint,
          transport: String(transport || 'local-stdio'),
          policy,
          mcpServerId,
          action: {
            kind: 'spawn-probe',
            toolName: 'spawn-probe',
            stdinText: payload.stdinText,
          },
        },
        {
          token: 'mcp-spawn-probe',
          allowedRoot: process.cwd(),
          timeoutMs: policy.timeoutMs,
        },
      )) {
        if (event.type === 'completed') {
          completedOut = event.output as unknown as Record<string, unknown>;
        }
        if (event.type === 'failed') {
          failClass = event.failureClass || '';
          failMessage = event.error?.message ?? 'MCP spawn probe failed';
        }
      }

      // When refuse path only yields failed (no completed), synthesize response.
      const response: ProbeMcpSpawnResponse = completedOut
        ? {
            ok: Boolean(completedOut.ok),
            timedOut: Boolean(completedOut.timedOut),
            truncated: Boolean(completedOut.truncated),
            contentTrust: completedOut.contentTrust === 'trusted' ? 'trusted' : 'untrusted',
            rawBytes: Number(completedOut.rawBytes) || 0,
            keptBytes: Number(completedOut.keptBytes) || 0,
            maxOutputBytes: policy.maxOutputBytes,
            timeoutMs: policy.timeoutMs,
            trusted: policy.trusted,
            policyLabel:
              typeof completedOut.policyLabel === 'string'
                ? completedOut.policyLabel
                : formatMcpPolicyLabel(policy),
            preview: typeof completedOut.preview === 'string' ? completedOut.preview : '',
            auditNote:
              completedOut.audit &&
              typeof completedOut.audit === 'object' &&
              completedOut.audit !== null &&
              typeof (completedOut.audit as { note?: unknown }).note === 'string'
                ? String((completedOut.audit as { note: string }).note)
                : failMessage || '',
            simulated: false,
            spawned: Boolean(completedOut.spawned),
            exitCode:
              typeof completedOut.exitCode === 'number' || completedOut.exitCode === null
                ? (completedOut.exitCode as number | null)
                : null,
            signal:
              typeof completedOut.signal === 'string' || completedOut.signal === null
                ? (completedOut.signal as string | null)
                : null,
            elapsedMs: Number(completedOut.elapsedMs) || 0,
            command: typeof completedOut.command === 'string' ? completedOut.command : '',
            args: Array.isArray(completedOut.args) ? completedOut.args.map((a) => String(a)) : [],
            refuseReason:
              typeof completedOut.refuseReason === 'string'
                ? completedOut.refuseReason
                : failClass === 'permission'
                  ? failMessage
                  : undefined,
            mcpServerId,
            endpoint,
            transport: String(transport || 'local-stdio'),
          }
        : {
            ok: false,
            timedOut: failClass === 'timeout',
            truncated: false,
            contentTrust: policy.trusted ? 'trusted' : 'untrusted',
            rawBytes: 0,
            keptBytes: 0,
            maxOutputBytes: policy.maxOutputBytes,
            timeoutMs: policy.timeoutMs,
            trusted: policy.trusted,
            policyLabel: formatMcpPolicyLabel(policy),
            preview: '',
            auditNote: failMessage || 'spawn probe failed without completed event',
            simulated: false,
            spawned: false,
            exitCode: null,
            signal: null,
            elapsedMs: 0,
            command: '',
            args: [],
            refuseReason: failMessage || undefined,
            mcpServerId,
            endpoint,
            transport: String(transport || 'local-stdio'),
          };

      const event = this.appendEvent('provider', 'mcp.spawn_probed', {
        mcpServerId: response.mcpServerId ?? null,
        ok: response.ok,
        timedOut: response.timedOut,
        truncated: response.truncated,
        contentTrust: response.contentTrust,
        spawned: response.spawned,
        exitCode: response.exitCode,
        elapsedMs: response.elapsedMs,
        command: response.command,
        refuseReason: response.refuseReason ?? null,
        simulated: false,
        policyLabel: response.policyLabel,
      });
      this.publishEvent(event);

      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'mcp.spawn.probe',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  /**
   * Real MCP JSON-RPC tool call (搂9.3 / 搂13 / 搂14).
   * Exact orchestration call. Approval gates are owned by Scheduler Step state.
   */
  private async handleCallMcpTool(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseCallMcpToolPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    try {
      const response = await this.runMcpToolCallPipeline({
        mcpServerId: payload.mcpServerId,
        toolName: payload.toolName,
        argumentsJson: payload.argumentsJson,
        mode: payload.mode,
        forceSensitive: payload.forceSensitive,
        forceEnqueue: payload.forceEnqueue,
        executeIfAutoApproved: payload.executeIfAutoApproved !== false,
        priorApprovalId: payload.priorApprovalId,
        workspaceId: payload.workspaceId,
        taskId: payload.taskId,
        runId: payload.runId,
        stepId: payload.stepId,
        agentVersionId: payload.agentVersionId,
        maxOutputBytes: payload.maxOutputBytes,
        timeoutMs: payload.timeoutMs,
        source: 'mcp.tool.call',
      });
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'mcp.tool.call',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private async executeMcpToolFromApproval(
    summary: ApprovalRequestSummary,
    metadata: Record<string, unknown>,
  ): Promise<CallMcpToolResponse> {
    const mcpServerId = String(metadata.mcpServerId || '').trim();
    const toolName = String(metadata.toolName || '').trim();
    if (!mcpServerId || !toolName) {
      return {
        sensitivity: {
          sensitive: true,
          reasons: ['missing-metadata'],
          labelZh: '缂哄皯 mcpServerId/toolName',
          toolOnCatalog: false,
        },
        evaluation: {
          gate: 'require-human',
          humanOnly: false,
          mode: 'request',
          reason: 'missing metadata',
          labelZh: '元数据缺失',
        },
        enqueued: false,
        autoApproved: false,
        executed: false,
        simulated: false,
        mcpServerId,
        toolName,
        trusted: false,
        onAgentAllowlist: false,
        refuseReason: '审批元数据缺少 mcpServerId 或 toolName',
      };
    }
    return this.runMcpToolCallPipeline({
      mcpServerId,
      toolName,
      argumentsJson:
        typeof metadata.argumentsJson === 'string' ? metadata.argumentsJson : undefined,
      mode: 'full',
      forceSensitive: false,
      forceEnqueue: false,
      executeIfAutoApproved: true,
      priorApprovalId: summary.id,
      workspaceId:
        typeof metadata.workspaceId === 'string'
          ? (metadata.workspaceId as WorkspaceId)
          : metadata.workspaceId === null
            ? undefined
            : (summary.workspaceId as WorkspaceId),
      taskId:
        typeof metadata.taskId === 'string'
          ? (metadata.taskId as TaskId)
          : metadata.taskId === null
            ? undefined
            : (summary.taskId as TaskId | undefined),
      runId:
        typeof metadata.runId === 'string'
          ? (metadata.runId as import('@sync-think/shared').RunId)
          : undefined,
      stepId:
        typeof metadata.stepId === 'string'
          ? (metadata.stepId as import('@sync-think/shared').StepId)
          : undefined,
      agentVersionId:
        typeof metadata.agentVersionId === 'string'
          ? (metadata.agentVersionId as AgentVersionId)
          : undefined,
      source: 'approval.decide',
      executeOnApprove: false,
      skipSensitivityEnqueue: true,
    });
  }

  private resolveOrchestrationMcpAuthorization(input: {
    workspaceId?: WorkspaceId;
    taskId?: TaskId;
    runId?: RunId;
    stepId?: import('@sync-think/shared').StepId;
    agentVersionId?: AgentVersionId;
    mcpServerId: string;
    toolName: string;
  }): OrchestrationMcpAuthorization | undefined {
    const hasOrchestrationScope = Boolean(input.runId || input.stepId || input.agentVersionId);
    if (!hasOrchestrationScope) return undefined;
    if (
      !input.workspaceId ||
      !input.taskId ||
      !input.runId ||
      !input.stepId ||
      !input.agentVersionId
    ) {
      return { allowed: false, reason: 'authorization.scope_incomplete' };
    }
    if (!this.workspaceStore || !this.orchestrationStore || !this.agentStore) {
      return { allowed: false, reason: 'authorization.store_unavailable' };
    }

    const task = this.workspaceStore.getTask(input.taskId);
    const graph = this.orchestrationStore.getGraph(input.runId);
    const step = graph?.steps.find((candidate) => candidate.id === input.stepId);
    if (
      !task ||
      task.workspaceId !== input.workspaceId ||
      !graph ||
      graph.run.taskId !== task.id ||
      !step
    ) {
      return { allowed: false, reason: 'authorization.orchestration_scope_mismatch' };
    }
    if (step.agentVersionId !== input.agentVersionId) {
      return { allowed: false, reason: 'authorization.agent_version_mismatch' };
    }
    const scope: ValidatedOrchestrationMcpScope = {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      runId: input.runId,
      stepId: input.stepId,
      agentVersionId: input.agentVersionId,
    };
    const agent = this.agentStore.getVersion(input.agentVersionId);
    if (!agent || !agent.mcpServerIds.includes(input.mcpServerId)) {
      return {
        allowed: false,
        reason: 'authorization.agent_mcp_binding_missing',
        scope,
      };
    }
    if (!this.authorizationStore) {
      return { allowed: false, reason: 'authorization.store_unavailable', scope };
    }

    const scopeChain = [
      { scope: 'user' as const, scopeId: this.installId },
      { scope: 'workspace' as const, scopeId: input.workspaceId },
      { scope: 'project' as const, scopeId: input.workspaceId },
      { scope: 'task' as const, scopeId: input.taskId },
      { scope: 'run' as const, scopeId: input.runId },
    ];
    const access = resolveCapabilityAccess({
      agentVersionId: input.agentVersionId,
      scopeChain,
      serverId: input.mcpServerId as never,
      toolName: input.toolName,
      grants: this.authorizationStore.listApplicable(scopeChain),
    });
    return access.allowed
      ? { allowed: true, scope }
      : { allowed: false, reason: `authorization.${access.reason}`, scope };
  }

  private async runMcpToolCallPipeline(input: {
    mcpServerId: string;
    toolName: string;
    argumentsJson?: string;
    mode?: string;
    forceSensitive?: boolean;
    forceEnqueue?: boolean;
    executeIfAutoApproved?: boolean;
    priorApprovalId?: string;
    workspaceId?: import('@sync-think/shared').WorkspaceId;
    taskId?: import('@sync-think/shared').TaskId;
    runId?: import('@sync-think/shared').RunId;
    stepId?: import('@sync-think/shared').StepId;
    agentVersionId?: AgentVersionId;
    maxOutputBytes?: number;
    timeoutMs?: number;
    source: string;
    executeOnApprove?: boolean;
    skipSensitivityEnqueue?: boolean;
  }): Promise<CallMcpToolResponse> {
    if (!this.mcpStore) {
      return {
        sensitivity: {
          sensitive: true,
          reasons: ['no-store'],
          labelZh: 'MCP store 不可用',
          toolOnCatalog: false,
        },
        evaluation: {
          gate: 'require-human',
          humanOnly: false,
          mode: 'request',
          reason: 'MCP store unavailable',
          labelZh: '存储不可用',
        },
        enqueued: false,
        autoApproved: false,
        executed: false,
        simulated: false,
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
        trusted: false,
        onAgentAllowlist: false,
        refuseReason: 'MCP store is not configured on this Runtime',
      };
    }

    const row = this.mcpStore.get(input.mcpServerId);
    if (!row) {
      return {
        sensitivity: {
          sensitive: true,
          reasons: ['server-not-found'],
          labelZh: 'MCP 未登记',
          toolOnCatalog: false,
        },
        evaluation: {
          gate: 'require-human',
          humanOnly: false,
          mode: 'request',
          reason: 'not found',
          labelZh: '未找到',
        },
        enqueued: false,
        autoApproved: false,
        executed: false,
        simulated: false,
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
        trusted: false,
        onAgentAllowlist: false,
        refuseReason: 'MCP server not found: ' + input.mcpServerId,
      };
    }

    const trusted = Boolean(row.trusted);
    const serverName = row.name;
    const registeredTools = (row.tools ?? []).map((x: { name: string }) => x.name);
    const sensitivity = evaluateMcpToolSensitivity({
      toolName: input.toolName,
      trusted,
      registeredTools,
      forceSensitive: input.forceSensitive,
    });

    const orchestrationAuthorization = this.resolveOrchestrationMcpAuthorization({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      runId: input.runId,
      stepId: input.stepId,
      agentVersionId: input.agentVersionId,
      mcpServerId: input.mcpServerId,
      toolName: input.toolName,
    });
    const validatedScope = orchestrationAuthorization?.scope;
    const serverApproval = validatedScope
      ? this.resolveServerApproval({
          ...validatedScope,
          action: sensitivity.action,
          kind: 'mcp-permission',
          actionDetails: {
            mcpServerId: input.mcpServerId,
            toolName: input.toolName,
            argumentsJson: input.argumentsJson ?? null,
          },
        })
      : undefined;
    let evaluationResponse: EvaluateApprovalResponse =
      serverApproval?.evaluation ??
      evaluateApproval({
        mode: 'request',
        action: sensitivity.action,
        kind: 'mcp-permission',
      });

    if (!orchestrationAuthorization?.allowed) {
      const denialReason = orchestrationAuthorization?.reason ?? 'authorization.scope_required';
      const refused: CallMcpToolResponse = {
        sensitivity: {
          sensitive: sensitivity.sensitive,
          reasons: [...sensitivity.reasons, denialReason],
          labelZh: sensitivity.labelZh + ' · 未在 Agent 白名单',
          toolOnCatalog: sensitivity.toolOnCatalog,
        },
        evaluation: evaluationResponse,
        enqueued: false,
        autoApproved: false,
        executed: false,
        simulated: false,
        mcpServerId: input.mcpServerId,
        serverName,
        toolName: input.toolName,
        trusted,
        onAgentAllowlist: false,
        refuseReason: denialReason,
      };
      if (validatedScope && evaluationResponse.actionDigest) {
        const event = this.appendOrchestrationMcpAudit(
          'mcp.tool_refused',
          {
            mcpServerId: input.mcpServerId,
            toolName: input.toolName,
            reason: refused.refuseReason,
            source: input.source,
          },
          validatedScope,
          evaluationResponse.actionDigest,
        );
        this.publishEvent(event);
      }
      return refused;
    }
    if (
      !this.scheduler ||
      !validatedScope ||
      !this.productionExecutionStore ||
      !this.unitOfWork ||
      !this.stateStore
    ) {
      const reason = 'scheduler.step_action_unavailable';
      const event = this.appendOrchestrationMcpAudit(
        'mcp.tool_refused',
        { mcpServerId: input.mcpServerId, toolName: input.toolName, reason, source: input.source },
        orchestrationAuthorization.scope,
        evaluationResponse.actionDigest!,
      );
      this.publishEvent(event);
      return {
        sensitivity: {
          sensitive: sensitivity.sensitive,
          reasons: [...sensitivity.reasons, reason],
          labelZh: sensitivity.labelZh,
          toolOnCatalog: sensitivity.toolOnCatalog,
        },
        evaluation: evaluationResponse,
        enqueued: false,
        autoApproved: false,
        executed: false,
        simulated: false,
        mcpServerId: input.mcpServerId,
        serverName,
        toolName: input.toolName,
        trusted,
        onAgentAllowlist: true,
        refuseReason: reason,
      };
    }

    let gate: ReturnType<Scheduler['gateStepAction']>;
    try {
      gate = this.scheduler.gateStepAction({
        ...validatedScope,
        request: {
          kind: 'mcp-permission',
          action: sensitivity.action,
          summary: `MCP tool · ${serverName} · ${input.toolName}`,
          details: {
            mcpServerId: input.mcpServerId,
            toolName: input.toolName,
            argumentsJson: input.argumentsJson ?? null,
          },
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'scheduler.step_action_rejected';
      const event = this.appendOrchestrationMcpAudit(
        'mcp.tool_refused',
        { mcpServerId: input.mcpServerId, toolName: input.toolName, reason, source: input.source },
        validatedScope,
        evaluationResponse.actionDigest!,
      );
      this.publishEvent(event);
      return {
        sensitivity: {
          sensitive: sensitivity.sensitive,
          reasons: [...sensitivity.reasons, reason],
          labelZh: sensitivity.labelZh,
          toolOnCatalog: sensitivity.toolOnCatalog,
        },
        evaluation: evaluationResponse,
        enqueued: false,
        autoApproved: false,
        executed: false,
        simulated: false,
        mcpServerId: input.mcpServerId,
        serverName,
        toolName: input.toolName,
        trusted,
        onAgentAllowlist: true,
        refuseReason: reason,
      };
    }

    evaluationResponse = { ...evaluationResponse, actionDigest: gate.actionDigest };
    const approvalRequest = gate.approval
      ? this.toApprovalRequestSummary(gate.approval)
      : undefined;
    const priorOk = gate.approval?.state === 'approved';
    const autoApproved = gate.approval === null;
    if (!gate.allowed) {
      const event = this.appendOrchestrationMcpAudit(
        'mcp.tool_requested',
        {
          mcpServerId: input.mcpServerId,
          toolName: input.toolName,
          enqueued: gate.approval?.state === 'pending',
          autoApproved: false,
          sensitive: sensitivity.sensitive,
          source: input.source,
          simulated: false,
          approvalRequestId: gate.approval?.id ?? null,
        },
        validatedScope,
        gate.actionDigest,
      );
      this.publishEvent(event);
      return {
        sensitivity: {
          sensitive: sensitivity.sensitive,
          reasons: sensitivity.reasons,
          labelZh: sensitivity.labelZh,
          toolOnCatalog: sensitivity.toolOnCatalog,
        },
        evaluation: evaluationResponse,
        enqueued: gate.approval?.state === 'pending',
        autoApproved: false,
        executed: false,
        simulated: false,
        approvalRequest,
        mcpServerId: input.mcpServerId,
        serverName,
        toolName: input.toolName,
        trusted,
        onAgentAllowlist: true,
      };
    }

    let toolArguments: Record<string, unknown> = {};
    if (typeof input.argumentsJson === 'string' && input.argumentsJson.trim()) {
      try {
        const parsed = JSON.parse(input.argumentsJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          toolArguments = parsed as Record<string, unknown>;
        }
      } catch {
        toolArguments = { _raw: input.argumentsJson };
      }
    }

    const policy = normalizeMcpProcessPolicy({
      maxOutputBytes: input.maxOutputBytes ?? row.maxOutputBytes,
      timeoutMs: input.timeoutMs ?? row.timeoutMs,
      trusted: row.trusted,
    });

    const actionFence = {
      runId: validatedScope.runId,
      stepId: validatedScope.stepId,
      agentVersionId: validatedScope.agentVersionId,
      ownerId: gate.ownerId,
      executionAttempt: gate.executionAttempt,
      actionDigest: gate.actionDigest,
    };
    try {
      this.productionExecutionStore.createMcpActionIntent(actionFence);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'mcp.action_intent_rejected';
      const event = this.appendOrchestrationMcpAudit(
        'mcp.tool_refused',
        { mcpServerId: input.mcpServerId, toolName: input.toolName, reason, source: input.source },
        validatedScope,
        gate.actionDigest,
      );
      this.publishEvent(event);
      return {
        sensitivity: {
          sensitive: sensitivity.sensitive,
          reasons: [...sensitivity.reasons, reason],
          labelZh: sensitivity.labelZh,
          toolOnCatalog: sensitivity.toolOnCatalog,
        },
        evaluation: evaluationResponse,
        enqueued: false,
        autoApproved: autoApproved || priorOk,
        executed: false,
        simulated: false,
        mcpServerId: input.mcpServerId,
        serverName,
        toolName: input.toolName,
        trusted,
        onAgentAllowlist: true,
        refuseReason: reason,
      };
    }

    const worker = new LocalStdioMcpWorker();
    let completedOut: Record<string, unknown> | null = null;
    let failMessage = '';
    let failClass = '';
    let startFailure = '';
    for await (const ev of worker.exec(
      {
        workingDir: process.cwd(),
        endpoint: row.endpoint,
        transport: row.transport || 'local-stdio',
        policy,
        mcpServerId: input.mcpServerId,
        action: {
          kind: 'call-tool',
          toolName: input.toolName,
          toolArguments,
        },
      },
      {
        token: 'mcp-tool-call',
        allowedRoot: process.cwd(),
        timeoutMs: policy.timeoutMs,
        signal: gate.signal,
        beforeStart: () => {
          try {
            const started = this.productionExecutionStore!.startMcpAction(actionFence);
            return started.startedNow;
          } catch (error) {
            startFailure = error instanceof Error ? error.message : 'mcp.action_fence_mismatch';
            return false;
          }
        },
      },
    )) {
      if (ev.type === 'completed') {
        completedOut = ev.output as unknown as Record<string, unknown>;
      }
      if (ev.type === 'failed') {
        failClass = String(ev.failureClass || '');
        failMessage = String(ev.error?.message || '');
      }
    }

    const ok = Boolean(completedOut?.ok);
    const result = {
      ok,
      timedOut: Boolean(completedOut?.timedOut) || failClass === 'timeout',
      truncated: Boolean(completedOut?.truncated),
      contentTrust: (completedOut?.contentTrust === 'trusted' ? 'trusted' : 'untrusted') as
        'trusted' | 'untrusted',
      rawBytes: Number(completedOut?.rawBytes) || 0,
      keptBytes: Number(completedOut?.keptBytes) || 0,
      policyLabel:
        typeof completedOut?.policyLabel === 'string'
          ? completedOut.policyLabel
          : formatMcpPolicyLabel(policy),
      preview: typeof completedOut?.preview === 'string' ? completedOut.preview : '',
      auditNote:
        completedOut?.audit &&
        typeof completedOut.audit === 'object' &&
        completedOut.audit !== null &&
        typeof (completedOut.audit as { note?: unknown }).note === 'string'
          ? String((completedOut.audit as { note: string }).note)
          : failMessage || '',
      spawned: Boolean(completedOut?.spawned),
      exitCode:
        typeof completedOut?.exitCode === 'number' || completedOut?.exitCode === null
          ? (completedOut?.exitCode as number | null)
          : null,
      elapsedMs: Number(completedOut?.elapsedMs) || 0,
      command: typeof completedOut?.command === 'string' ? completedOut.command : '',
      jsonRpcOk: Boolean(completedOut?.jsonRpcOk),
      toolResultText:
        typeof completedOut?.toolResultText === 'string'
          ? completedOut.toolResultText
          : typeof completedOut?.preview === 'string'
            ? completedOut.preview
            : '',
      protocol: 'mcp-jsonrpc' as const,
    };

    let completedFence = false;
    let calledEvent: Event | undefined;
    if (result.ok && result.spawned && result.jsonRpcOk && !gate.signal.aborted && !failClass) {
      try {
        calledEvent = this.completeMcpActionWithAudit(
          actionFence,
          {
            mcpServerId: input.mcpServerId,
            toolName: input.toolName,
            ok: result.ok,
            timedOut: result.timedOut,
            truncated: result.truncated,
            contentTrust: result.contentTrust,
            spawned: result.spawned,
            jsonRpcOk: result.jsonRpcOk,
            elapsedMs: result.elapsedMs,
            preview: result.preview.slice(0, 120),
            source: input.source,
            approvalRequestId: gate.approval?.id ?? null,
            simulated: false,
          },
          validatedScope,
          gate.signal,
        );
        completedFence = true;
      } catch (error) {
        failMessage = error instanceof Error ? error.message : 'mcp.action_completion_rejected';
      }
    }

    const refusalReason = completedFence
      ? undefined
      : startFailure ||
        (gate.signal.aborted ? 'mcp.action_cancelled' : '') ||
        (typeof completedOut?.refuseReason === 'string'
          ? String(completedOut.refuseReason)
          : failMessage || 'mcp.action_execution_failed');
    const response: CallMcpToolResponse = {
      sensitivity: {
        sensitive: sensitivity.sensitive,
        reasons: sensitivity.reasons,
        labelZh: sensitivity.labelZh,
        toolOnCatalog: sensitivity.toolOnCatalog,
      },
      evaluation: evaluationResponse,
      enqueued: false,
      autoApproved: autoApproved || priorOk,
      executed: completedFence,
      simulated: false,
      mcpServerId: input.mcpServerId,
      serverName,
      toolName: input.toolName,
      trusted,
      onAgentAllowlist: true,
      refuseReason: refusalReason,
      result,
    };

    if (calledEvent) {
      this.publishEvent(calledEvent);
    } else {
      const refusedEvent = this.appendOrchestrationMcpAudit(
        'mcp.tool_refused',
        {
          mcpServerId: input.mcpServerId,
          toolName: input.toolName,
          reason: refusalReason,
          source: input.source,
          spawned: result.spawned,
          jsonRpcOk: result.jsonRpcOk,
          timedOut: result.timedOut,
          simulated: false,
        },
        validatedScope,
        gate.actionDigest,
      );
      this.publishEvent(refusedEvent);
    }
    return response;
  }

  /**
   * Refresh MCP tool catalog via real JSON-RPC tools/list (搂9.3).
   * Does NOT execute tools. Persists discovered schemas onto the registry.
   * Does not mutate Agent allowlist.
   */
  private async handleRefreshMcpTools(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseRefreshMcpToolsPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.mcpStore) {
      this.writeMcpStoreUnavailable(socket, frame);
      return;
    }
    try {
      const row = this.mcpStore.get(payload.mcpServerId);
      if (!row) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'mcp.tools.refresh',
            payload: {},
            error: {
              code: ErrorCode.RUN_NOT_FOUND,
              message: 'MCP server not found: ' + payload.mcpServerId,
            },
          }),
        );
        return;
      }

      const previousToolCount = row.tools.length;
      const previousNames = new Set(row.tools.map((t) => t.name));
      const policy = normalizeMcpProcessPolicy({
        maxOutputBytes: payload.maxOutputBytes ?? row.maxOutputBytes,
        timeoutMs: payload.timeoutMs ?? row.timeoutMs,
        trusted: row.trusted,
      });
      const maxTools =
        typeof payload.maxTools === 'number'
          ? Math.max(1, Math.min(200, Math.floor(payload.maxTools)))
          : 64;

      const worker = new LocalStdioMcpWorker();
      let completedOut: Record<string, unknown> | null = null;
      let failMessage = '';
      let failClass = '';
      for await (const ev of worker.exec(
        {
          workingDir: process.cwd(),
          endpoint: row.endpoint,
          transport: row.transport || 'local-stdio',
          policy,
          mcpServerId: payload.mcpServerId,
          action: {
            kind: 'list-tools',
            maxTools,
          },
        },
        {
          token: 'mcp-tools-refresh',
          allowedRoot: process.cwd(),
          timeoutMs: policy.timeoutMs,
        },
      )) {
        if (ev.type === 'completed') {
          completedOut = ev.output as unknown as Record<string, unknown>;
        }
        if (ev.type === 'failed') {
          failClass = String(ev.failureClass || '');
          failMessage = String(ev.error?.message || '');
        }
      }

      const discovered = Array.isArray(completedOut?.tools)
        ? (
            completedOut!.tools as Array<{
              name?: string;
              description?: string;
              inputSchemaJson?: string;
            }>
          )
            .map((t) => ({
              name: String(t.name || '').trim(),
              description: String(t.description || '').trim(),
              inputSchemaJson:
                typeof t.inputSchemaJson === 'string' ? t.inputSchemaJson : undefined,
            }))
            .filter((t) => t.name.length > 0)
        : [];

      const ok = Boolean(completedOut?.ok) && Boolean(completedOut?.jsonRpcOk);
      const spawned = Boolean(completedOut?.spawned);
      const jsonRpcOk = Boolean(completedOut?.jsonRpcOk);
      const timedOut = Boolean(completedOut?.timedOut) || failClass === 'timeout';
      const truncated = Boolean(completedOut?.truncated);
      const contentTrust = completedOut?.contentTrust === 'trusted' ? 'trusted' : 'untrusted';
      const refuseReason =
        typeof completedOut?.refuseReason === 'string'
          ? String(completedOut.refuseReason)
          : !spawned && failMessage
            ? failMessage
            : undefined;

      let serverSummary: import('@sync-think/protocol').McpServerSummary | undefined;
      let addedToolNames: string[] = [];
      let removedToolNames: string[] = [];

      if (ok && spawned && jsonRpcOk) {
        const updated = this.mcpStore.register({
          id: row.id,
          name: row.name,
          transport: row.transport,
          endpoint: row.endpoint,
          tools: discovered,
          trusted: row.trusted,
          maxOutputBytes: row.maxOutputBytes,
          timeoutMs: row.timeoutMs,
          notes: row.notes,
        });
        serverSummary = this.toMcpServerSummary(updated);
        const newNames = new Set(updated.tools.map((t) => t.name));
        addedToolNames = updated.tools.map((t) => t.name).filter((n) => !previousNames.has(n));
        removedToolNames = [...previousNames].filter((n) => !newNames.has(n));
      }

      const response: RefreshMcpToolsResponse = {
        ok: Boolean(ok),
        simulated: false,
        spawned,
        jsonRpcOk,
        timedOut,
        truncated,
        contentTrust: contentTrust as 'trusted' | 'untrusted',
        mcpServerId: payload.mcpServerId,
        serverName: row.name,
        endpoint: row.endpoint,
        transport: row.transport || 'local-stdio',
        tools: serverSummary
          ? serverSummary.tools
          : discovered.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchemaJson: t.inputSchemaJson,
            })),
        previousToolCount,
        toolCount: serverSummary ? serverSummary.tools.length : discovered.length,
        addedToolNames,
        removedToolNames,
        policyLabel:
          typeof completedOut?.policyLabel === 'string'
            ? completedOut.policyLabel
            : formatMcpPolicyLabel(policy),
        preview: typeof completedOut?.preview === 'string' ? completedOut.preview : '',
        auditNote:
          completedOut?.audit &&
          typeof completedOut.audit === 'object' &&
          completedOut.audit !== null &&
          typeof (completedOut.audit as { note?: unknown }).note === 'string'
            ? String((completedOut.audit as { note: string }).note)
            : failMessage || '',
        elapsedMs: Number(completedOut?.elapsedMs) || 0,
        command: typeof completedOut?.command === 'string' ? completedOut.command : '',
        args: Array.isArray(completedOut?.args) ? (completedOut!.args as string[]).map(String) : [],
        refuseReason,
        server: serverSummary,
      };

      const event = this.appendEvent('provider', 'mcp.tools_refreshed', {
        mcpServerId: payload.mcpServerId,
        serverName: row.name,
        ok: response.ok,
        spawned: response.spawned,
        jsonRpcOk: response.jsonRpcOk,
        timedOut: response.timedOut,
        toolCount: response.toolCount,
        previousToolCount: response.previousToolCount,
        addedToolNames: response.addedToolNames,
        removedToolNames: response.removedToolNames,
        contentTrust: response.contentTrust,
        elapsedMs: response.elapsedMs,
        refuseReason: response.refuseReason ?? null,
        simulated: false,
      });
      this.publishEvent(event);

      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'mcp.tools.refresh',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private writeMcpStoreUnavailable(socket: Socket, frame: Frame): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.STORAGE_WRITE_FAILED,
          message: 'MCP store is not configured on this Runtime',
        },
      }),
    );
  }

  private toMcpServerSummary(
    record: import('@sync-think/storage').McpServerRecord,
  ): import('@sync-think/protocol').McpServerSummary {
    return {
      mcpServerId: record.id,
      name: record.name,
      transport: record.transport,
      endpoint: record.endpoint,
      tools: record.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchemaJson: t.inputSchemaJson,
      })),
      trusted: record.trusted,
      maxOutputBytes: record.maxOutputBytes,
      timeoutMs: record.timeoutMs,
      notes: record.notes,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private writeMemoryStoreUnavailable(socket: Socket, frame: Frame): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.STORAGE_WRITE_FAILED,
          message: 'Memory/diagnostics store is not configured on this Runtime',
        },
      }),
    );
  }

  private toMemoryChangeSummary(change: MemoryChangeRecord): MemoryChangeSummary {
    return {
      id: change.id,
      workspaceId: change.workspaceId,
      taskId: change.taskId,
      targetScope: change.targetScope,
      additions: change.additions,
      modifications: change.modifications,
      deprecations: change.deprecations,
      evidenceRefs: change.evidenceRefs,
      confidence: change.confidence,
      unresolvedAmbiguity: change.unresolvedAmbiguity,
      approvalState: change.approvalState,
      proposedByRunId: change.proposedByRunId,
      createdAt: change.createdAt,
      decidedAt: change.decidedAt,
    };
  }

  private toDurableMemoryEntrySummary(entry: DurableMemoryEntry): DurableMemoryEntrySummary {
    return {
      id: entry.id,
      workspaceId: entry.workspaceId,
      taskId: entry.taskId,
      scope: entry.scope,
      key: entry.key,
      value: entry.value,
      sourceChangeId: entry.sourceChangeId,
      active: entry.active,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  private toDiagnosticSummary(rec: DiagnosticRecord): DiagnosticSummary {
    return {
      id: rec.id,
      workspaceId: rec.workspaceId,
      taskId: rec.taskId,
      runId: rec.runId,
      category: rec.category,
      failureClass: rec.failureClass ? String(rec.failureClass) : undefined,
      summary: rec.summary,
      detail: rec.detail,
      createdAt: rec.createdAt,
    };
  }

  private writeAgentStoreUnavailable(socket: Socket, frame: Frame): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.STORAGE_WRITE_FAILED,
          message: 'Agent store is not configured on this Runtime',
        },
      }),
    );
  }

  private writeGroupStoreUnavailable(socket: Socket, frame: Frame): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.STORAGE_WRITE_FAILED,
          message: 'Group store is not configured on this Runtime',
        },
      }),
    );
  }

  private writeGroupCommandError(socket: Socket, frame: Frame, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Group command failed';
    let code: (typeof ErrorCode)[keyof typeof ErrorCode] = ErrorCode.STORAGE_WRITE_FAILED;
    if (/group version conflict/i.test(message)) code = ErrorCode.TASK_VERSION_MISMATCH;
    else if (/task not found/i.test(message)) code = ErrorCode.TASK_NOT_FOUND;
    else if (/workspace not found/i.test(message)) code = ErrorCode.WORKSPACE_NOT_FOUND;
    else if (
      /group not found|member not found|already exists|lead cannot be removed/i.test(message)
    ) {
      code = ErrorCode.PROTOCOL_UNEXPECTED_REQUEST;
    } else if (/must|invalid|duplicate|between|exceeds|empty/i.test(message)) {
      code = ErrorCode.PROTOCOL_FRAME_MALFORMED;
    }
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: { code, message },
      }),
    );
  }

  private getRequiredAgentVersion(agentVersionId: AgentVersionId | string) {
    if (!this.agentStore) {
      throw new Error('AgentVersion exact lookup requires the Agent store');
    }
    const version = this.agentStore.getVersion(agentVersionId);
    if (!version) {
      throw new Error(`AgentVersion not found: ${String(agentVersionId)}`);
    }
    return version;
  }

  private ensureAgentRecord(agentId: AgentId = DEFAULT_CONVERSATION_AGENT_ID) {
    if (!this.agentStore) {
      throw new Error('Agent store unavailable');
    }
    const existing = this.agentStore.getLatestVersion(agentId);
    if (existing) return existing;
    const catalog = this.providerStore?.listAllModels() ?? [];
    const defaultModelId = (catalog[0]?.id ?? 'fake-mini') as ModelId;
    const fallbackModelIds = catalog.slice(1, 4).map((m) => m.id as ModelId);
    if (agentId === DEFAULT_CONVERSATION_AGENT_ID) {
      return this.agentStore.ensureConversationAgent({
        defaultModelId,
        fallbackModelIds,
        pauseOnFailure: true,
      });
    }
    return this.agentStore.updateBinding({
      agentId,
      defaultModelId,
      fallbackModelIds,
      pauseOnFailure: true,
    });
  }

  private toAgentBindingSummary(
    record: import('@sync-think/storage').AgentVersionRecord,
  ): AgentBindingSummary {
    return {
      agentId: record.agentId,
      agentVersionId: record.id,
      version: record.version,
      name: record.name,
      role: record.role,
      maxConcurrency: record.maxConcurrency,
      defaultModelId: record.defaultModelId,
      fallbackModelIds: [...record.fallbackModelIds],
      pauseOnFailure: record.pauseOnFailure,
      defaultCredentialGroupId: record.defaultCredentialGroupId,
      pinnedCredentialRefId: record.pinnedCredentialRefId,
      skillVersionIds: [...(record.skillVersionIds ?? [])],
      mcpServerIds: [...(record.mcpServerIds ?? [])],
      createdAt: record.createdAt,
    };
  }

  private toAgentDefinitionSummary(
    record: import('@sync-think/storage').AgentVersionRecord,
  ): AgentDefinitionSummary {
    return {
      ...this.toAgentBindingSummary(record),
      description: record.description,
      visualIdentity: { ...record.visualIdentity },
      developerInstructions: record.developerInstructions,
      inputContract: record.inputContract,
      outputContract: record.outputContract,
      memoryScope: record.memoryScope,
      mcpToolAllowlist: [...record.mcpToolAllowlist],
      permissions: {
        file: [...record.permissions.file],
        command: [...record.permissions.command],
        browser: [...record.permissions.browser],
        desktop: [...record.permissions.desktop],
        network: [...record.permissions.network],
      },
      policyId: record.policyId,
      approvalMode: record.approvalMode,
      reviewBehavior: { ...record.reviewBehavior },
      artifactRules: { ...record.artifactRules },
    };
  }

  private writeProviderStoreUnavailable(socket: Socket, frame: Frame): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.STORAGE_WRITE_FAILED,
          message: 'Provider store or secure store is not configured on this Runtime',
        },
      }),
    );
  }

  private writeProviderCommandError(socket: Socket, frame: Frame, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Provider command failed';
    const failureClass =
      error && typeof error === 'object' && 'failureClass' in error
        ? String((error as { failureClass?: unknown }).failureClass)
        : undefined;
    let code: (typeof ErrorCode)[keyof typeof ErrorCode] = ErrorCode.STORAGE_WRITE_FAILED;
    if (/agent expectedVersion conflict/i.test(message)) code = ErrorCode.TASK_VERSION_MISMATCH;
    else if (/AgentVersion not found/i.test(message)) code = ErrorCode.PROTOCOL_UNEXPECTED_REQUEST;
    else if (/provider not found/i.test(message)) code = ErrorCode.WORKSPACE_NOT_FOUND;
    else if (/base url/i.test(message) || /protocol/i.test(message) || /name/i.test(message)) {
      code = ErrorCode.PROTOCOL_FRAME_MALFORMED;
    } else if (failureClass === 'auth' || /auth/i.test(message)) {
      code = ErrorCode.PROVIDER_AUTH_FAILED;
    } else if (failureClass === 'timeout' || /timed out/i.test(message)) {
      code = ErrorCode.PROVIDER_TIMEOUT;
    } else if (failureClass === 'rate-limit' || /rate limit/i.test(message)) {
      code = ErrorCode.PROVIDER_RATE_LIMITED;
    } else if (
      failureClass === 'protocol' ||
      failureClass === 'transient' ||
      /discovery/i.test(message)
    ) {
      code = ErrorCode.PROVIDER_CALL_FAILED;
    }
    // Scrub accidental secrets from error messages
    const scrubbed = message
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, 'Bearer [REDACTED]');
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: { code, message: scrubbed },
      }),
    );
  }

  private writeWorkspaceStoreUnavailable(socket: Socket, frame: Frame): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.STORAGE_WRITE_FAILED,
          message: 'Workspace store is not configured on this Runtime',
        },
      }),
    );
  }

  private writeWorkspaceCommandError(socket: Socket, frame: Frame, error: unknown): void {
    if (error instanceof WorkspacePathError) {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: {},
          error: {
            code: ErrorCode.PATH_TRAVERSAL,
            message: error.message,
          },
        }),
      );
      return;
    }
    const message = error instanceof Error ? error.message : 'Workspace command failed';
    let code: (typeof ErrorCode)[keyof typeof ErrorCode] = ErrorCode.STORAGE_WRITE_FAILED;
    if (/workspace not found/i.test(message)) code = ErrorCode.WORKSPACE_NOT_FOUND;
    else if (/task not found/i.test(message) || /parent task not found/i.test(message)) {
      code = ErrorCode.TASK_NOT_FOUND;
    } else if (/already exists|already has a folder/i.test(message)) {
      code = ErrorCode.PROTOCOL_UNEXPECTED_REQUEST;
    }
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: { code, message },
      }),
    );
  }

  private writeTaskVersionMismatch(
    socket: Socket,
    frame: Frame,
    currentVersion: number,
    receivedVersion: number,
  ): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.TASK_VERSION_MISMATCH,
          message: `Expected task version ${currentVersion}, received ${receivedVersion}`,
        },
      }),
    );
  }

  private writeTaskModeCommandError(socket: Socket, frame: Frame, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Participation mode update failed';
    let code: (typeof ErrorCode)[keyof typeof ErrorCode] = ErrorCode.STORAGE_WRITE_FAILED;
    if (/task not found/i.test(message)) code = ErrorCode.TASK_NOT_FOUND;
    else if (/task version conflict/i.test(message)) code = ErrorCode.TASK_VERSION_MISMATCH;
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: { code, message },
      }),
    );
  }

  private writePolicyStoreUnavailable(socket: Socket, frame: Frame): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.STORAGE_WRITE_FAILED,
          message: 'Policy store is not configured on this Runtime',
        },
      }),
    );
  }

  private writePolicyCommandError(socket: Socket, frame: Frame, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Policy command failed';
    const code =
      error instanceof PolicyScopeBoundaryError
        ? error.code
        : /policy scope cannot change/i.test(message)
          ? ErrorCode.PROTOCOL_UNEXPECTED_REQUEST
          : ErrorCode.STORAGE_WRITE_FAILED;
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: { code, message },
      }),
    );
  }

  private handleAppendMessage(socket: Socket, frame: Frame): void {
    const payload = parseAppendMessagePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    let persistedTask: TaskRecord | undefined;
    if (this.workspaceStore && this.unitOfWork) {
      persistedTask = this.workspaceStore.getTaskByThreadId(payload.threadId as ThreadId);
      if (!persistedTask) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'task.appendMessage',
            payload: {},
            error: {
              code: ErrorCode.TASK_NOT_FOUND,
              message: `Task not found for thread: ${payload.threadId}`,
            },
          }),
        );
        return;
      }
    }
    const boundGroup = persistedTask ? this.groupStore?.getForTask(persistedTask.id) : undefined;
    const requestedAgentVersionId =
      typeof payload.agentVersionId === 'string' ? payload.agentVersionId : undefined;
    if (
      boundGroup &&
      requestedAgentVersionId &&
      !boundGroup.members.some((member) => member.agentVersionId === requestedAgentVersionId)
    ) {
      this.writeUnexpectedRequest(
        socket,
        frame,
        'The mentioned Agent is not a member of this group',
      );
      return;
    }
    const targetAgentVersionId =
      requestedAgentVersionId ??
      boundGroup?.leadAgentVersionId ??
      (persistedTask && this.agentStore
        ? this.resolveTaskLeadAgentVersionId(persistedTask)
        : undefined);
    const currentVersion = persistedTask?.version ?? this.threadVersions.get(payload.threadId) ?? 0;
    if (payload.expectedTaskVersion !== currentVersion) {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'task.appendMessage',
          payload: {},
          error: {
            code: ErrorCode.TASK_VERSION_MISMATCH,
            message: `Expected task version ${currentVersion}, received ${payload.expectedTaskVersion}`,
          },
        }),
      );
      return;
    }

    if (targetAgentVersionId !== undefined) {
      try {
        this.getRequiredAgentVersion(targetAgentVersionId);
      } catch (error) {
        this.writeProviderCommandError(socket, frame, error);
        return;
      }
    }

    let attachmentContext = '';
    try {
      attachmentContext = prepareMessageAttachmentContext(payload.attachments ?? []);
    } catch (error) {
      this.writeUnexpectedRequest(
        socket,
        frame,
        error instanceof Error ? error.message : 'Attachment validation failed',
      );
      return;
    }
    const nextVersion = currentVersion + 1;
    const generatedTaskIdentity =
      persistedTask &&
      payload.role === 'user' &&
      currentVersion === 0 &&
      isUntitledTaskTitle(persistedTask.title)
        ? {
            title: deriveTaskTitleFromPrompt(payload.text),
            goal: payload.text.trim(),
          }
        : undefined;
    const messageId = ulid() as MessageId;
    const eventPayload = {
      threadId: payload.threadId,
      role: payload.role,
      text: payload.text,
      messageId,
      taskVersion: nextVersion,
      ...(targetAgentVersionId ? { targetAgentVersionId } : {}),
      ...(boundGroup ? { groupId: boundGroup.id } : {}),
      ...(this.commandCallerSurface(frame) === 'agent' &&
      typeof payload.stepId === 'string' &&
      (payload.stepId.startsWith('subtask-auto:') || payload.stepId.startsWith('subtask-wake:'))
        ? {
            internalKind: payload.stepId.startsWith('subtask-auto:')
              ? 'subtask-auto'
              : 'subtask-wake',
          }
        : {}),
      ...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
      ...(generatedTaskIdentity
        ? {
            taskTitle: generatedTaskIdentity.title,
            taskGoal: generatedTaskIdentity.goal,
          }
        : {}),
    };
    const messageEventDraft: EventDraft = {
      id: ulid() as Event['id'],
      workspaceId: persistedTask?.workspaceId ?? this.workspaceId,
      taskId: persistedTask?.id,
      messageId,
      category: 'message',
      type: 'message.appended',
      occurredAt: new Date().toISOString(),
      payload: eventPayload,
    };
    const projectedThreadVersions = new Map(this.threadVersions);
    projectedThreadVersions.set(payload.threadId, nextVersion);
    const projectedRuns = new Map(this.demoRuns);
    const eventDrafts: [EventDraft, ...EventDraft[]] = [messageEventDraft];
    let demoRunId: RunId | undefined;
    let demoRun: DemoRunState | undefined;
    if (this.stateStore && payload.role === 'user' && this.canStartModelRun()) {
      demoRunId = ulid() as RunId;
      let prepared: ReturnType<Runtime['prepareRunBinding']>;
      try {
        prepared = this.prepareRunBinding({
          runId: demoRunId,
          threadId: payload.threadId,
          userText: payload.text,
          attachmentContext,
          attachments: payload.attachments ?? [],
          latestUserMessageId: messageId,
          modelId: typeof payload.modelId === 'string' ? payload.modelId : undefined,
          credentialRefId:
            typeof payload.credentialRefId === 'string' ? payload.credentialRefId : undefined,
          agentVersionId:
            typeof targetAgentVersionId === 'string' ? targetAgentVersionId : undefined,
        });
      } catch (error) {
        this.writeUnexpectedRequest(
          socket,
          frame,
          error instanceof Error ? error.message : 'Run attachment preparation failed',
        );
        return;
      }
      demoRun = prepared.run;
      projectedRuns.set(demoRunId, demoRun);
      eventDrafts.push({
        id: ulid() as Event['id'],
        workspaceId: persistedTask?.workspaceId ?? this.workspaceId,
        runId: demoRunId,
        category: 'context',
        type: 'context.packet.built',
        occurredAt: new Date().toISOString(),
        payload: {
          threadId: payload.threadId,
          packetId: prepared.packetId,
          proofHash: prepared.proofHash,
          modelId: demoRun.modelId,
          providerModelId: demoRun.providerModelId,
          resolutionSource: demoRun.resolutionSource,
          credentialRefId: demoRun.credentialRefId,
          credentialResolutionSource: demoRun.credentialResolutionSource,
          agentVersionId: demoRun.agentVersionId,
          agentVersion: prepared.agentVersion,
          skillVersionIds: prepared.skillVersionIds,
          mcpServerIds: prepared.mcpServerIds,
          policyId: prepared.policyId,
          includedSourceIds: prepared.includedSourceIds,
          excludedSourceIds: prepared.excludedSourceIds,
          includedSources: prepared.includedSources,
          excludedSources: prepared.excludedSources,
          summaries: prepared.summaries,
          truncations: prepared.truncations,
          crossTaskRefs: prepared.crossTaskRefs,
          evidenceRefsForMemory: prepared.evidenceRefsForMemory ?? [],
          historyIncludedEventIds: prepared.historyIncludedEventIds,
          historyExcludedEventIds: prepared.historyExcludedEventIds,
          tokenEstimate: prepared.tokenEstimate,
          attachmentCount: payload.attachments?.length ?? 0,
          executionRoot: demoRun.executionRoot,
          executionToolNames: demoRun.executionToolNames,
          effectiveApprovalMode: demoRun.effectiveApprovalMode,
          browserIdentityId: demoRun.browserIdentityId,
        },
      });
      eventDrafts.push({
        id: ulid() as Event['id'],
        workspaceId: persistedTask?.workspaceId ?? this.workspaceId,
        runId: demoRunId,
        category: 'run',
        type: 'run.started',
        occurredAt: new Date().toISOString(),
        payload: {
          threadId: payload.threadId,
          modelId: demoRun.modelId,
          providerModelId: demoRun.providerModelId,
          resolutionSource: demoRun.resolutionSource,
          credentialRefId: demoRun.credentialRefId,
          credentialResolutionSource: demoRun.credentialResolutionSource,
          agentVersionId: demoRun.agentVersionId,
          packetId: prepared.packetId,
          protocol: demoRun.protocol,
          useFakeProvider: demoRun.useFakeProvider,
          idempotencyKey: demoRunId,
          executionRoot: demoRun.executionRoot,
          executionToolNames: demoRun.executionToolNames,
          effectiveApprovalMode: demoRun.effectiveApprovalMode,
          browserIdentityId: demoRun.browserIdentityId,
          run: demoRun,
        },
      });
    }

    let committedEvents: Event[];
    try {
      const result = this.runInUnitOfWork(() => {
        if (persistedTask) {
          this.workspaceStore!.advanceTaskVersionByThreadId(
            payload.threadId as ThreadId,
            payload.expectedTaskVersion,
            messageEventDraft.occurredAt,
            generatedTaskIdentity
              ? {
                  generatedTitle: generatedTaskIdentity.title,
                  generatedGoal: generatedTaskIdentity.goal,
                }
              : undefined,
          );
        }
        if (this.stateStore) {
          return {
            needsProjection: true,
            committedEvents: this.commitProjectedEvents(
              eventDrafts,
              projectedThreadVersions,
              projectedRuns,
            ),
          };
        }
        return {
          needsProjection: false,
          committedEvents: [
            this.appendEvent('message', 'message.appended', eventPayload, messageId),
          ],
        };
      });
      committedEvents = result.committedEvents;
      if (result.needsProjection) this.recordCommittedEvents(committedEvents);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/task version conflict/i.test(message)) {
        const actual =
          this.workspaceStore?.getTaskByThreadId(payload.threadId as ThreadId)?.version ??
          currentVersion;
        this.writeTaskVersionMismatch(socket, frame, actual, payload.expectedTaskVersion);
        return;
      }
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'task.appendMessage',
          payload: {},
          error: {
            code: ErrorCode.STORAGE_WRITE_FAILED,
            message: 'The runtime could not persist this transition',
          },
        }),
      );
      return;
    }
    this.threadVersions.set(payload.threadId, nextVersion);
    if (demoRunId && demoRun) this.demoRuns.set(demoRunId, demoRun);

    const response: AppendMessageResponse = {
      messageId,
      taskVersion: nextVersion,
      ...(generatedTaskIdentity
        ? {
            taskTitle: generatedTaskIdentity.title,
            taskGoal: generatedTaskIdentity.goal,
          }
        : {}),
      streamId: demoRunId,
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'task.appendMessage',
        payload: response,
      }),
    );
    for (const event of committedEvents) this.publishEvent(event);
    if (demoRunId) this.scheduleDemoRunExecution(demoRunId);
  }

  private handleCancelRun(socket: Socket, frame: Frame): void {
    const payload = parseCancelRunPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const orchestrationRun = this.orchestrationStore?.getRun(payload.runId);
    if (orchestrationRun) {
      if (!('workspaceId' in payload)) {
        this.writeUnexpectedRequest(
          socket,
          frame,
          'Orchestration cancellation requires server-verified scope and task version',
        );
        return;
      }
      this.handleOrchestrationRunMutation(socket, frame, payload, 'cancel');
      return;
    }
    if ('workspaceId' in payload) {
      this.writeUnexpectedRequest(
        socket,
        frame,
        'No orchestration run exists in the requested scope',
      );
      return;
    }
    const run = this.demoRuns.get(payload.runId);
    if (!run) {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'run.cancel',
          payload: {},
          error: {
            code: ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
            message: 'No in-flight run to cancel',
          },
        }),
      );
      return;
    }

    const projectedRuns = new Map(this.demoRuns);
    projectedRuns.delete(payload.runId);
    try {
      if (this.stateStore) {
        const event = this.persistProjectedEvent(
          {
            id: ulid() as Event['id'],
            workspaceId: this.workspaceId,
            runId: payload.runId as RunId,
            category: 'run',
            type: 'run.cancelled',
            occurredAt: new Date().toISOString(),
            payload: {
              threadId: run.threadId,
              reason: 'cancelled',
              assistantText: run.assistantText,
              idempotencyKey: payload.runId,
            },
          },
          projectedRuns,
        );
        this.demoRuns.delete(payload.runId);
        this.publishEvent(event);
      } else {
        this.demoRuns.delete(payload.runId);
        const event = this.appendEvent(
          'run',
          'run.cancelled',
          {
            threadId: run.threadId,
            reason: 'cancelled',
            assistantText: run.assistantText,
            idempotencyKey: payload.runId,
          },
          undefined,
          payload.runId as RunId,
        );
        this.publishEvent(event);
      }
    } catch {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'run.cancel',
          payload: {},
          error: {
            code: ErrorCode.STORAGE_WRITE_FAILED,
            message: 'The runtime could not cancel this run',
          },
        }),
      );
      return;
    }

    this.demoRunAbortControllers.get(payload.runId)?.abort();

    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'run.cancel',
        payload: { runId: payload.runId, state: 'cancelled' },
      }),
    );
  }
  private writeMalformedPayload(socket: Socket, frame: Frame): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.PROTOCOL_FRAME_MALFORMED,
          message: `Invalid payload for ${frame.type}`,
        },
      }),
    );
  }

  private writePlanStoreUnavailable(socket: Socket, frame: Frame): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.STORAGE_WRITE_FAILED,
          message: 'Plan orchestration persistence is not configured on this Runtime',
        },
      }),
    );
  }

  private writeArtifactStoreUnavailable(socket: Socket, frame: Frame): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.STORAGE_WRITE_FAILED,
          message: 'Artifact persistence is not configured on this Runtime',
        },
      }),
    );
  }

  private writeArtifactCommandError(socket: Socket, frame: Frame, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Artifact command failed';
    let code: (typeof ErrorCode)[keyof typeof ErrorCode] = ErrorCode.STORAGE_WRITE_FAILED;
    if (/task version conflict/i.test(message)) {
      code = ErrorCode.TASK_VERSION_MISMATCH;
    } else if (
      /artifact\.(?:invalid_input|invalid_record|invalid_version|invalid_selection|invalid_conflict)/i.test(
        message,
      ) ||
      /artifact\.legacy_conflict_step_unknown/i.test(message) ||
      /Artifact .*not available/i.test(message) ||
      /Artifact scope/i.test(message) ||
      /Merge source Step/i.test(message) ||
      /Merge conflict source/i.test(message) ||
      /Explicit merge Step/i.test(message) ||
      /Explicit merge conflict/i.test(message) ||
      /merge requires/i.test(message) ||
      /operation ID was reused/i.test(message)
    ) {
      code = ErrorCode.PROTOCOL_UNEXPECTED_REQUEST;
    }
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code,
          message:
            code === ErrorCode.STORAGE_WRITE_FAILED
              ? 'The runtime could not persist the artifact transition'
              : message,
        },
      }),
    );
  }

  private writePlanCommandError(socket: Socket, frame: Frame, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Plan command failed';
    let code: (typeof ErrorCode)[keyof typeof ErrorCode] = ErrorCode.STORAGE_WRITE_FAILED;
    if (error instanceof PlanModeBoundaryError) {
      code = ErrorCode.RUN_INVALID_STATE;
    } else if (/run\.merge_conflict_unresolved/i.test(message)) {
      code = ErrorCode.RUN_INVALID_STATE;
    } else if (
      error instanceof PlanReviewerDependencyError ||
      error instanceof PlanReviewerLineageError
    ) {
      code = ErrorCode.PROTOCOL_UNEXPECTED_REQUEST;
    } else if (/task version conflict/i.test(message)) {
      code = ErrorCode.TASK_VERSION_MISMATCH;
    } else if (/task not found/i.test(message)) {
      code = ErrorCode.TASK_NOT_FOUND;
    } else if (/^run not found/i.test(message)) {
      code = ErrorCode.RUN_NOT_FOUND;
    } else if (
      /AgentVersion not found/i.test(message) ||
      /Orchestration scope is not available/i.test(message) ||
      /plan\.stale_revision/i.test(message) ||
      /Plan(?:Revision)? not found/i.test(message) ||
      /plan\.(?:revision_not_approvable|approval_conflict|approved_run_missing)/i.test(message)
    ) {
      code = ErrorCode.PROTOCOL_UNEXPECTED_REQUEST;
    } else if (
      /plan\.(?:invalid|missing|duplicate|self|cycle)/i.test(message) ||
      /title must not be empty/i.test(message)
    ) {
      code = ErrorCode.PROTOCOL_FRAME_MALFORMED;
    }
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: { code, message },
      }),
    );
  }

  private writeUnexpectedRequest(socket: Socket, frame: Frame, message: string): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
          message,
        },
      }),
    );
  }

  private runInUnitOfWork<T>(fn: () => T): T {
    return this.unitOfWork ? this.unitOfWork.run(fn) : fn();
  }

  private commitEvents(events: EventDraftBatch): Event[] {
    if (!this.stateStore) throw new Error('Runtime state store is not configured');
    const committed = this.stateStore.commitTransition({ events }).events;
    if (committed.length === 0) throw new Error('The event store returned an empty transition');
    return committed;
  }

  private recordCommittedEvents(events: readonly Event[]): void {
    if (events.length === 0) throw new Error('Cannot project an empty event transition');
    this.eventSequence = Math.max(this.eventSequence, events[events.length - 1]!.sequence);
    this.events.push(...events);
  }

  private syncOrchestrationEvents(): void {
    if (!this.stateStore) return;
    const events = this.stateStore.listAllEvents
      ? this.stateStore.listAllEvents(this.eventSequence)
      : this.stateStore.listEvents(this.workspaceId, this.eventSequence);
    if (events.length === 0) return;
    this.recordCommittedEvents(events);
    for (const event of events) this.publishEvent(event);
  }

  private appendGroupCollaborationStatus(
    task: TaskRecord,
    groupId: string,
    type: string,
    text: string,
    detail: Record<string, unknown> = {},
  ): void {
    const event = this.appendEvent(
      type.startsWith('group.collaboration.') ? 'run' : 'system',
      type,
      {
        threadId: task.threadId,
        groupId,
        text,
        ...detail,
      },
      undefined,
      undefined,
      task.id,
      task.workspaceId,
    );
    this.publishEvent(event);
  }

  /** Explicit orchestration entry point; normal group-chat messages do not call this. */
  startGroupCollaboration(taskId: TaskId, userMessage: string): void {
    const task = this.workspaceStore?.getTask(taskId);
    const group = this.groupStore?.getForTask(taskId);
    if (!task || !group) return;
    if (!this.hasPlanTransitionStores() || !this.scheduler) {
      this.appendGroupCollaborationStatus(
        task,
        group.id,
        'group.collaboration.failed',
        '群聊编排尚未在当前 Runtime 中启用。',
        { reason: 'orchestration_unavailable' },
      );
      return;
    }

    const activeGroupRuns = this.orchestrationStore!.listRecoverableRunIds()
      .map((runId) => this.orchestrationStore!.getRun(runId))
      .filter((run): run is NonNullable<typeof run> => Boolean(run))
      .filter((run) => this.groupStore!.getForTask(run.taskId)?.id === group.id);
    if (activeGroupRuns.some((run) => run.taskId === task.id)) {
      this.appendGroupCollaborationStatus(
        task,
        group.id,
        'group.collaboration.skipped',
        '这个群聊任务已有一次协作正在执行，请等待完成后继续。',
        { reason: 'task_run_active' },
      );
      return;
    }
    if (activeGroupRuns.length >= group.maxConcurrency) {
      this.appendGroupCollaborationStatus(
        task,
        group.id,
        'group.collaboration.skipped',
        `群聊已达到 ${group.maxConcurrency} 个并发任务，请稍后重试。`,
        { reason: 'group_concurrency_limit', maxConcurrency: group.maxConcurrency },
      );
      return;
    }

    try {
      const steps = buildGroupCollaborationPlan({
        group,
        taskTitle: task.title,
        taskGoal: task.goal,
        userMessage,
        createStepId: () => ulid(),
      });
      const occurredAt = new Date().toISOString();
      const result = this.unitOfWork!.run(() => {
        const revision = this.orchestrationStore!.createPlanDraft({
          taskId: task.id,
          title: `${group.name} · ${task.title}`,
          steps,
          now: occurredAt,
        });
        const graph = this.orchestrationStore!.approvePlan({
          planId: revision.planId,
          revision: revision.revision,
          now: occurredAt,
        });
        const eventDrafts: [EventDraft, ...EventDraft[]] = [
          {
            id: ulid() as Event['id'],
            workspaceId: task.workspaceId,
            taskId: task.id,
            runId: graph.run.id,
            category: 'run',
            type: 'plan.drafted',
            occurredAt,
            payload: {
              threadId: task.threadId,
              groupId: group.id,
              planId: revision.planId,
              planRevisionId: revision.id,
              revision: revision.revision,
              title: revision.title,
              stepCount: revision.steps.length,
              source: 'group-lead',
            },
          },
          {
            id: ulid() as Event['id'],
            workspaceId: task.workspaceId,
            taskId: task.id,
            runId: graph.run.id,
            category: 'run',
            type: 'plan.approved',
            occurredAt,
            payload: {
              threadId: task.threadId,
              groupId: group.id,
              planId: revision.planId,
              planRevisionId: revision.id,
              revision: revision.revision,
              runId: graph.run.id,
              source: 'group-automatic',
            },
          },
          {
            id: ulid() as Event['id'],
            workspaceId: task.workspaceId,
            taskId: task.id,
            runId: graph.run.id,
            category: 'run',
            type: 'group.collaboration.started',
            occurredAt,
            payload: {
              threadId: task.threadId,
              groupId: group.id,
              groupName: group.name,
              leadAgentVersionId: group.leadAgentVersionId,
              memberCount: group.members.length,
              collaborationMode: group.collaborationMode,
              text: `${group.name} 已开始协作。`,
            },
          },
        ];
        for (const step of graph.steps) {
          eventDrafts.push({
            id: ulid() as Event['id'],
            workspaceId: task.workspaceId,
            taskId: task.id,
            runId: graph.run.id,
            stepId: step.id,
            category: 'step',
            type: 'step.created',
            occurredAt,
            payload: {
              threadId: task.threadId,
              groupId: group.id,
              planRevisionId: revision.id,
              stepId: step.id,
              planOrder: step.planOrder,
              title: step.title,
              agentVersionId: step.agentVersionId,
              dependsOn: [...step.dependsOn],
            },
          });
        }
        const committedEvents = this.commitProjectedEvents(
          eventDrafts,
          this.threadVersions,
          this.demoRuns,
        );
        return { graph, committedEvents };
      });
      this.recordCommittedEvents(result.committedEvents);
      for (const event of result.committedEvents) this.publishEvent(event);
      this.scheduleOrchestrationDrain(result.graph.run.id, 'group-collaboration');
    } catch (error) {
      this.appendGroupCollaborationStatus(
        task,
        group.id,
        'group.collaboration.failed',
        '群聊协作计划创建失败。',
        {
          reason: this.scrubDiagnosticMessage(
            error instanceof Error ? error.message : 'group collaboration failed',
          ),
        },
      );
    }
  }

  private projectGroupRunConversation(runId: RunId): void {
    if (!this.stateStore || !this.orchestrationStore || !this.workspaceStore || !this.groupStore) {
      return;
    }
    const graph = this.orchestrationStore.getGraph(runId);
    if (!graph) return;
    const task = this.workspaceStore.getTask(graph.run.taskId);
    const group = task ? this.groupStore.getForTask(task.id) : undefined;
    if (!task || !group) return;
    const existingMessageStepIds = new Set(
      this.events
        .filter((event) => event.runId === runId && event.type === 'group.agent-message')
        .map((event) => String(event.stepId ?? event.payload.stepId ?? '')),
    );
    const existingDecisionStepIds = new Set(
      this.events
        .filter((event) => event.runId === runId && event.type === 'group.delegation-decided')
        .map((event) => String(event.stepId ?? event.payload.stepId ?? '')),
    );
    const existingHandoffStepIds = new Set(
      this.events
        .filter((event) => event.runId === runId && event.type === 'group.handoff-recorded')
        .map((event) => String(event.stepId ?? event.payload.stepId ?? '')),
    );
    const existingToolTraceIds = new Set(
      this.events
        .filter((event) => event.runId === runId && event.type === 'tool.completed')
        .map((event) => `${String(event.stepId ?? '')}:${String(event.payload.toolCallId ?? '')}`),
    );
    const artifacts = this.orchestrationStore.listRunArtifactVersions(runId);
    const drafts: EventDraft[] = [];
    const steps = [...graph.steps].sort((left, right) => left.planOrder - right.planOrder);
    for (const step of steps) {
      if (step.state !== 'completed') continue;
      const toolTrace = artifacts
        .filter(
          (artifact) =>
            artifact.sourceStepId === step.id &&
            artifact.metadata?.executionKind === 'tool-trace' &&
            typeof artifact.content === 'string',
        )
        .sort((left, right) => right.version - left.version)[0];
      if (toolTrace?.content) {
        try {
          const parsed = JSON.parse(toolTrace.content) as {
            calls?: Array<{
              id?: unknown;
              name?: unknown;
              arguments?: unknown;
              result?: unknown;
              startedAt?: unknown;
              durationMs?: unknown;
            }>;
          };
          for (const call of parsed.calls ?? []) {
            if (typeof call.id !== 'string' || typeof call.name !== 'string') continue;
            if (existingToolTraceIds.has(`${String(step.id)}:${call.id}`)) continue;
            const occurredAt =
              typeof call.startedAt === 'string' ? call.startedAt : toolTrace.createdAt;
            const toolCall = {
              id: call.id,
              name: call.name,
              argumentsJson: JSON.stringify(call.arguments ?? {}),
            };
            drafts.push({
              id: ulid() as Event['id'],
              workspaceId: task.workspaceId,
              taskId: task.id,
              runId,
              stepId: step.id,
              category: 'tool',
              type: 'tool.requested',
              occurredAt,
              payload: {
                threadId: task.threadId,
                agentVersionId: step.agentVersionId,
                modelId:
                  step.modelOverrideId ??
                  this.agentStore?.getVersion(step.agentVersionId)?.defaultModelId,
                toolCall,
              },
            });
            drafts.push({
              id: ulid() as Event['id'],
              workspaceId: task.workspaceId,
              taskId: task.id,
              runId,
              stepId: step.id,
              category: 'tool',
              type: 'tool.completed',
              occurredAt,
              payload: {
                threadId: task.threadId,
                agentVersionId: step.agentVersionId,
                modelId:
                  step.modelOverrideId ??
                  this.agentStore?.getVersion(step.agentVersionId)?.defaultModelId,
                toolCallId: call.id,
                toolName: call.name,
                result:
                  typeof call.result === 'string' ? call.result : JSON.stringify(call.result ?? {}),
                durationMs: typeof call.durationMs === 'number' ? call.durationMs : undefined,
              },
            });
          }
        } catch {
          // Invalid legacy trace artifacts remain inspectable as artifacts but are not projected as logs.
        }
      }
      const output = artifacts
        .filter(
          (artifact) =>
            artifact.sourceStepId === step.id &&
            artifact.metadata?.executionKind !== 'tool-trace' &&
            typeof artifact.content === 'string',
        )
        .sort((left, right) => right.version - left.version)[0];
      if (!output?.content?.trim()) continue;
      const agent = this.agentStore?.getVersion(step.agentVersionId);
      const executionKind = String(output.metadata.executionKind ?? '');
      if (executionKind === 'group-delegation-decision' || isGroupDelegationDecisionStep(step)) {
        if (existingDecisionStepIds.has(String(step.id))) continue;
        const decision = parseGroupDelegationDecision(output.content, group);
        if (!decision) continue;
        const leadName = agent?.name ?? '主智能体';
        drafts.push({
          id: ulid() as Event['id'],
          workspaceId: task.workspaceId,
          taskId: task.id,
          runId,
          stepId: step.id,
          category: 'run',
          type: 'group.delegation-decided',
          occurredAt: output.createdAt,
          payload: {
            threadId: task.threadId,
            groupId: group.id,
            stepId: step.id,
            agentVersionId: step.agentVersionId,
            mode: decision.mode,
            reason: decision.reason,
            assignmentCount: decision.assignments.length,
            text:
              decision.mode === 'single'
                ? `${leadName} 决定直接完成，不委派其他成员。`
                : `${leadName} 已拆分 ${decision.assignments.length} 个子任务。`,
          },
        });
        for (const assignment of decision.assignments) {
          const memberName =
            this.agentStore?.getVersion(assignment.agentVersionId)?.name ??
            assignment.agentVersionId;
          drafts.push({
            id: ulid() as Event['id'],
            workspaceId: task.workspaceId,
            taskId: task.id,
            runId,
            stepId: step.id,
            category: 'step',
            type: 'group.subtask-delegated',
            occurredAt: output.createdAt,
            payload: {
              threadId: task.threadId,
              groupId: group.id,
              stepId: step.id,
              fromAgentVersionId: group.leadAgentVersionId,
              toAgentVersionId: assignment.agentVersionId,
              goal: assignment.goal,
              requiredEvidence: assignment.requiredEvidence,
              acceptanceConditions: assignment.acceptanceConditions,
              allowedTools: assignment.allowedTools,
              text: `已将“${assignment.goal}”委派给 ${memberName}。`,
            },
          });
        }
        continue;
      }
      if (executionKind === 'group-skip') continue;
      if (!existingMessageStepIds.has(String(step.id))) {
        drafts.push({
          id: ulid() as Event['id'],
          workspaceId: task.workspaceId,
          taskId: task.id,
          runId,
          stepId: step.id,
          category: 'message',
          type: 'group.agent-message',
          occurredAt: output.createdAt,
          payload: {
            threadId: task.threadId,
            groupId: group.id,
            role: 'assistant',
            text: output.content,
            agentVersionId: step.agentVersionId,
            modelId: step.modelOverrideId ?? agent?.defaultModelId,
            stepId: step.id,
            stepTitle: step.title,
            phase:
              isGroupFinalSummaryStep(step) && step.agentVersionId === group.leadAgentVersionId
                ? 'final-summary'
                : 'subtask-result',
            ...(!(isGroupFinalSummaryStep(step) && step.agentVersionId === group.leadAgentVersionId)
              ? { mentionAgentVersionId: group.leadAgentVersionId }
              : {}),
          },
        });
      }
      if (
        !(isGroupFinalSummaryStep(step) && step.agentVersionId === group.leadAgentVersionId) &&
        !existingHandoffStepIds.has(String(step.id))
      ) {
        drafts.push({
          id: ulid() as Event['id'],
          workspaceId: task.workspaceId,
          taskId: task.id,
          runId,
          stepId: step.id,
          category: 'step',
          type: 'group.handoff-recorded',
          occurredAt: output.createdAt,
          payload: {
            threadId: task.threadId,
            groupId: group.id,
            stepId: step.id,
            fromAgentVersionId: step.agentVersionId,
            toAgentVersionId: group.leadAgentVersionId,
            artifactVersionId: output.id,
            text: `${agent?.name ?? '成员智能体'} 已将“${step.title}”的结果交接给主智能体。`,
          },
        });
      }
    }

    const lifecycleType =
      graph.run.state === 'completed'
        ? 'group.collaboration.completed'
        : graph.run.state === 'failed' || graph.run.state === 'cancelled'
          ? 'group.collaboration.failed'
          : undefined;
    if (
      lifecycleType &&
      !this.events.some((event) => event.runId === runId && event.type === lifecycleType)
    ) {
      drafts.push({
        id: ulid() as Event['id'],
        workspaceId: task.workspaceId,
        taskId: task.id,
        runId,
        category: 'run',
        type: lifecycleType,
        occurredAt: new Date().toISOString(),
        payload: {
          threadId: task.threadId,
          groupId: group.id,
          state: graph.run.state,
          text:
            lifecycleType === 'group.collaboration.completed'
              ? `${group.name} 已完成协作。`
              : `${group.name} 协作未完成。`,
        },
      });
    }
    const first = drafts[0];
    if (!first) return;
    const committed = this.commitEvents([first, ...drafts.slice(1)]);
    this.recordCommittedEvents(committed);
    for (const event of committed) this.publishEvent(event);
  }

  private scheduleOrchestrationDrain(runId: RunId, source: string): void {
    if (!this.scheduler) return;
    const task = this.scheduler
      .runUntilIdle(runId)
      .then(() => {
        this.syncOrchestrationEvents();
        this.projectGroupRunConversation(runId);
      })
      .catch(() => console.warn(`[runtime] orchestration ${source} failed`));
    this.trackBackgroundTask(task);
  }

  private scheduleOrchestrationRecovery(runId: RunId, source: string): void {
    if (!this.scheduler) return;
    const task = this.scheduler
      .recover(runId)
      .then(() => {
        this.syncOrchestrationEvents();
        this.projectGroupRunConversation(runId);
      })
      .catch(() => console.warn(`[runtime] orchestration ${source} recovery failed`));
    this.trackBackgroundTask(task);
  }

  private trackBackgroundTask(task: Promise<void>): void {
    this.backgroundTasks.add(task);
    void task.then(
      () => this.backgroundTasks.delete(task),
      () => this.backgroundTasks.delete(task),
    );
  }

  private persistProjectedEvent(
    event: EventDraft,
    projectedRuns: ReadonlyMap<string, DemoRunState>,
  ): Event {
    return this.persistProjectedEvents([event], this.threadVersions, projectedRuns)[0];
  }

  private persistProjectedEvents(
    events: EventDraftBatch,
    projectedThreadVersions: ReadonlyMap<string, number>,
    projectedRuns: ReadonlyMap<string, DemoRunState>,
  ): Event[] {
    const eventsCommitted = this.commitProjectedEvents(
      events,
      projectedThreadVersions,
      projectedRuns,
    );
    this.recordCommittedEvents(eventsCommitted);
    return eventsCommitted;
  }

  private commitProjectedEvents(
    events: EventDraftBatch,
    projectedThreadVersions: ReadonlyMap<string, number>,
    projectedRuns: ReadonlyMap<string, DemoRunState>,
  ): Event[] {
    if (!this.stateStore) throw new Error('Runtime state store is not configured');
    const checkpoint: CheckpointDraft = {
      id: `runtime-latest:${this.checkpointRunId}`,
      runId: this.checkpointRunId,
      state: {
        schemaVersion: 1,
        threadVersions: Array.from(projectedThreadVersions.entries()).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
        demoRuns: serializeDemoRuns(projectedRuns),
      },
      createdAt: events[events.length - 1].occurredAt,
    };
    const compactEvents = events.map((event) => {
      const { run: _runtimeCheckpoint, ...payload } = event.payload;
      return { ...event, payload };
    }) as unknown as EventDraftBatch;
    const committed = this.stateStore.commitTransition({ events: compactEvents, checkpoint });
    if (committed.events.length === 0) {
      throw new Error('The event store returned an empty transition');
    }
    return committed.events;
  }

  private persistApplicationToolRunState(
    runId: RunId,
    run: DemoRunState,
    type: string,
    payload: Record<string, unknown>,
  ): Event {
    const task = this.resolveTaskForThread(run.threadId);
    const projectedRuns = new Map(this.demoRuns);
    projectedRuns.set(runId, run);
    const event = this.persistProjectedEvent(
      {
        id: ulid() as Event['id'],
        workspaceId: task?.workspaceId ?? this.workspaceId,
        taskId: task?.id,
        runId,
        category: 'tool',
        type,
        occurredAt: new Date().toISOString(),
        payload: {
          threadId: run.threadId,
          agentVersionId: run.agentVersionId,
          modelId: run.modelId,
          ...payload,
          run,
        },
      },
      projectedRuns,
    );
    this.demoRuns.set(runId, run);
    this.publishEvent(event);
    return event;
  }

  private parseApplicationToolArguments(toolCall: ProviderToolCall): Record<string, unknown> {
    if (
      !toolCall.id.trim() ||
      toolCall.id.length > 256 ||
      !toolCall.name.trim() ||
      toolCall.name.length > 128 ||
      Buffer.byteLength(toolCall.argumentsJson, 'utf8') > MAX_APPLICATION_TOOL_ARGUMENT_BYTES
    ) {
      throw new Error('application.tool_call_invalid');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(toolCall.argumentsJson) as unknown;
    } catch {
      throw new Error('application.tool_arguments_invalid_json');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('application.tool_arguments_not_object');
    }
    const payload = parsed as Record<string, unknown>;
    if ('_confirmationToken' in payload) {
      throw new Error('application.agent_cannot_self_confirm_configuration');
    }
    return payload;
  }

  private invokeAgentRuntimeCommand(
    command: CommandType,
    payload: Record<string, unknown>,
    confirmationToken?: string,
  ): Promise<Frame> {
    return this.invokeInternalRuntimeCommand(command, payload, 'agent', confirmationToken);
  }

  private invokeInternalRuntimeCommand(
    command: CommandType,
    payload: Record<string, unknown>,
    callerSurface: import('@sync-think/protocol').CommandCallerSurface = 'desktop',
    confirmationToken?: string,
  ): Promise<Frame> {
    return new Promise<Frame>((resolve, reject) => {
      const requestId = `internal_${ulid()}`;
      const timer = setTimeout(
        () => reject(new Error(`application.command_timeout:${command}`)),
        10_000,
      );
      if (typeof timer === 'object' && 'unref' in timer) timer.unref();
      const socket = {
        destroyed: false,
        write: (chunk: Uint8Array | string) => {
          try {
            const decoded = decodeFrames(
              typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk),
            );
            const response = decoded.frames.find(
              (candidate) => candidate.kind === 'response' && candidate.id === requestId,
            );
            if (response) {
              clearTimeout(timer);
              resolve(response);
            }
          } catch (error) {
            clearTimeout(timer);
            reject(error);
          }
          return true;
        },
      } as unknown as Socket;
      try {
        this.handlers.onFrame(socket, {
          id: requestId,
          kind: 'request',
          type: command,
          payload,
          meta: {
            callerSurface,
            ...(confirmationToken ? { confirmationToken } : {}),
          },
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  private boundedApplicationToolResult(value: unknown): string {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') <= MAX_APPLICATION_TOOL_RESULT_BYTES) {
      return serialized;
    }
    return JSON.stringify({
      status: 'truncated',
      byteLength: Buffer.byteLength(serialized, 'utf8'),
      summary: 'SYNC-THINK application tool result exceeded the model result limit.',
    });
  }

  private async invokeApplicationTool(
    run: DemoRunState,
    toolCall: ProviderToolCall,
  ): Promise<{ result: string; confirmationId?: string }> {
    if (isExecutionToolName(toolCall.name)) {
      if (!run.executionRoot || !run.executionToolNames.includes(toolCall.name)) {
        return {
          result: this.boundedApplicationToolResult({
            status: 'blocked',
            code: 'execution.tool_not_available',
            toolName: toolCall.name,
          }),
        };
      }
      const task = this.resolveTaskForThread(run.threadId);
      if (!task) {
        return {
          result: this.boundedApplicationToolResult({
            status: 'error',
            code: 'execution.task_not_found',
          }),
        };
      }
      const args = this.parseApplicationToolArguments(toolCall);
      const kind = toolCall.name.startsWith('browser_')
        ? 'browser'
        : toolCall.name === 'run_command'
          ? 'shell'
          : toolCall.name.startsWith('git_')
            ? 'git'
            : 'file';
      const resolvedApproval = this.resolveServerApproval({
        workspaceId: task.workspaceId,
        taskId: task.id,
        runId: run.runId,
        agentVersionId: run.agentVersionId as AgentVersionId,
        action: `execution.${toolCall.name}`,
        kind,
        actionDetails: args,
      });
      const approval = resolvedApproval.evaluation;
      const readOnlyInRequestMode =
        resolvedApproval.policyMode === 'request' && isReadOnlyExecutionToolName(toolCall.name);
      if (approval.gate !== 'auto-approve' && !readOnlyInRequestMode) {
        const existing = this.approvalStore
          ?.list({ taskId: task.id, limit: 200 })
          .find(
            (item) =>
              item.runId === run.runId &&
              item.metadata.actionDigest === resolvedApproval.actionDigest &&
              item.metadata.toolCallId === toolCall.id,
          );
        if (existing?.state === 'approved') {
          // The exact persisted action was approved; continue below without re-enqueueing.
        } else if (existing?.state === 'rejected') {
          return {
            result: this.boundedApplicationToolResult({
              status: 'blocked',
              code: 'execution.approval_rejected',
              toolName: toolCall.name,
              approvalId: existing.id,
            }),
          };
        } else {
          const item =
            existing ??
            this.approvalStore?.enqueue({
              workspaceId: task.workspaceId,
              taskId: task.id,
              runId: run.runId,
              kind: 'tool',
              action: `execution.${toolCall.name}`,
              summary: `允许智能体执行：${toolCall.name}`,
              humanOnly: approval.humanOnly,
              humanOnlyAction: approval.humanOnlyAction,
              mode: approval.mode,
              gate: approval.gate,
              metadata: {
                source: 'conversation.execution-tool',
                actionDigest: resolvedApproval.actionDigest,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                agentVersionId: run.agentVersionId,
                arguments: args,
                ...(approval.delegateAgentVersionId
                  ? { delegateAgentVersionId: approval.delegateAgentVersionId }
                  : {}),
              },
            });
          if (item && !existing) {
            this.emitSubtaskEvent(
              'approval',
              'approval.requested',
              {
                threadId: run.threadId,
                approvalId: item.id,
                action: item.action,
                summary: item.summary,
                approvalMode: item.mode,
                gate: item.gate,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
              },
              task.id,
              task.workspaceId,
              run.runId,
            );
          }
          if (item) {
            return {
              confirmationId: String(item.id),
              result: this.boundedApplicationToolResult({
                status: 'approval_required',
                approvalId: item.id,
                summary: item.summary,
                toolName: toolCall.name,
              }),
            };
          }
        }
      }
      if (approval.gate !== 'auto-approve' && !readOnlyInRequestMode) {
        const approved = this.approvalStore
          ?.list({ taskId: task.id, state: 'approved', limit: 200 })
          .some(
            (item) =>
              item.runId === run.runId &&
              item.metadata.actionDigest === resolvedApproval.actionDigest &&
              item.metadata.toolCallId === toolCall.id,
          );
        if (!approved) {
          return {
            result: this.boundedApplicationToolResult({
              status: 'blocked',
              code: 'execution.approval_required',
              toolName: toolCall.name,
              approvalMode: approval.mode,
              reason: approval.reason,
            }),
          };
        }
      }
      this.emitSubtaskEvent(
        'tool',
        'execution.tool.started',
        {
          threadId: run.threadId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          arguments: args,
          executionRoot: run.executionRoot,
          effectiveApprovalMode: run.effectiveApprovalMode,
          browserIdentityId: run.browserIdentityId,
        },
        task.id,
        task.workspaceId,
        run.runId,
      );
      try {
        const browserIdentity = run.browserIdentityId
          ? this.executionEnvironmentStore
              ?.listBrowserIdentities()
              .find((identity) => String(identity.id) === run.browserIdentityId)
          : undefined;
        const agentPermissions = this.agentStore?.getVersion(
          run.agentVersionId as AgentVersionId,
        )?.permissions;
        const result = await invokeExecutionTool({
          name: toolCall.name,
          arguments: args as Record<string, import('@sync-think/shared').JsonValue>,
          executionRoot: run.executionRoot,
          browserProfilePath: browserIdentity?.profilePath,
          allowedSites: agentPermissions?.browser,
        });
        this.emitSubtaskEvent(
          'tool',
          'execution.tool.completed',
          {
            threadId: run.threadId,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result,
            executionRoot: run.executionRoot,
          },
          task.id,
          task.workspaceId,
          run.runId,
        );
        return { result: this.boundedApplicationToolResult(JSON.parse(result)) };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Execution tool failed';
        this.emitSubtaskEvent(
          'tool',
          'execution.tool.failed',
          {
            threadId: run.threadId,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            errorMessage: this.scrubDiagnosticMessage(message),
          },
          task.id,
          task.workspaceId,
          run.runId,
        );
        return {
          result: this.boundedApplicationToolResult({
            status: 'error',
            code: 'execution.tool_failed',
            message: this.scrubDiagnosticMessage(message),
          }),
        };
      }
    }
    const definition = getApplicationToolDefinition(toolCall.name);
    if (!definition) {
      return {
        result: this.boundedApplicationToolResult({
          status: 'error',
          code: 'application.tool_unknown',
          toolName: toolCall.name,
        }),
      };
    }
    const parsedPayload = this.parseApplicationToolArguments(toolCall);
    const payload =
      definition.command === 'task.delegateSubtask'
        ? {
            ...parsedPayload,
            delegatingAgentVersionId: run.agentVersionId,
            delegationBatchId: String(run.runId),
          }
        : parsedPayload;
    const response = await this.invokeAgentRuntimeCommand(definition.command, payload);
    if (response.error) {
      return {
        result: this.boundedApplicationToolResult({
          status: 'error',
          code: response.error.code,
          message: this.scrubDiagnosticMessage(response.error.message) ?? 'Command failed',
        }),
      };
    }

    const value = response.payload;
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as { status?: unknown }).status === 'confirmation_required' &&
      typeof (value as { confirmationToken?: unknown }).confirmationToken === 'string'
    ) {
      const preview = value as {
        confirmationToken: string;
        expiresAt?: string;
        summary?: string;
        payloadKeys?: string[];
      };
      const task = this.resolveTaskForThread(run.threadId);
      const approvalAgentVersionId = this.agentStore?.getVersion(
        run.agentVersionId as AgentVersionId,
      )?.id;
      const permission = task
        ? this.resolveServerApproval({
            workspaceId: task.workspaceId,
            taskId: task.id,
            runId: run.runId,
            ...(approvalAgentVersionId ? { agentVersionId: approvalAgentVersionId } : {}),
            action: definition.name,
            kind: 'other',
            actionDetails: payload,
          }).evaluation
        : undefined;
      if (permission?.gate === 'auto-approve') {
        const confirmed = await this.invokeAgentRuntimeCommand(
          definition.command,
          payload,
          preview.confirmationToken,
        );
        if (confirmed.error) {
          return {
            result: this.boundedApplicationToolResult({
              status: 'error',
              code: confirmed.error.code,
              message: this.scrubDiagnosticMessage(confirmed.error.message) ?? 'Command failed',
            }),
          };
        }
        return { result: this.boundedApplicationToolResult(confirmed.payload ?? {}) };
      }
      const confirmationId = `confirmation_${ulid()}`;
      const pending: PendingAgentConfigurationCommand = {
        id: confirmationId,
        toolCallId: toolCall.id,
        toolName: definition.name,
        command: definition.command,
        payload: structuredClone(payload),
        confirmationToken: preview.confirmationToken,
        threadId: run.threadId,
        runId: run.runId,
        agentVersionId: run.agentVersionId,
        expiresAt: preview.expiresAt ?? new Date(Date.now() + 5 * 60_000).toISOString(),
      };
      this.pendingAgentConfigurationCommands.set(confirmationId, pending);
      return {
        confirmationId,
        result: this.boundedApplicationToolResult({
          status: 'confirmation_required',
          confirmationId,
          summary: preview.summary ?? definition.description,
          payloadKeys: preview.payloadKeys ?? Object.keys(payload).sort(),
          expiresAt: pending.expiresAt,
          instruction: 'Wait for the user to approve or reject this SYNC-THINK operation.',
        }),
      };
    }
    return { result: this.boundedApplicationToolResult(value ?? {}) };
  }

  private async continueDemoRunAfterApplicationTools(
    runId: RunId,
    initialRun: DemoRunState,
  ): Promise<{ run: DemoRunState; pausedForApproval: boolean }> {
    if (initialRun.providerTurn >= MAX_APPLICATION_TOOL_TURNS) {
      throw new Error('application.tool_turn_limit_reached');
    }
    if (initialRun.pendingApplicationToolCalls.length === 0) {
      throw new Error('application.tool_requests_missing');
    }
    let run = initialRun;
    for (const toolCall of run.pendingApplicationToolCalls) {
      const completed = run.applicationToolResults.find(
        (candidate) => candidate.toolCallId === toolCall.id,
      );
      if (completed) continue;
      if (run.startedApplicationToolCallIds.includes(toolCall.id)) {
        throw new Error('application.tool_execution_outcome_unknown');
      }
      run = {
        ...run,
        startedApplicationToolCallIds: [...run.startedApplicationToolCallIds, toolCall.id],
      };
      this.persistApplicationToolRunState(runId, run, 'application.tool_started', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      });
      const invoked = await this.invokeApplicationTool(run, toolCall);
      if (invoked.confirmationId) {
        const pendingConfiguration = invoked.confirmationId.startsWith('confirmation_')
          ? this.pendingAgentConfigurationCommands.get(invoked.confirmationId)
          : undefined;
        run = {
          ...run,
          startedApplicationToolCallIds: run.startedApplicationToolCallIds.filter(
            (id) => id !== toolCall.id,
          ),
        };
        const isConfigurationConfirmation = invoked.confirmationId.startsWith('confirmation_');
        this.persistApplicationToolRunState(
          runId,
          run,
          isConfigurationConfirmation
            ? 'application.tool_confirmation_requested'
            : 'execution.tool_approval_requested',
          {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            confirmationId: invoked.confirmationId,
            result: invoked.result,
            ...(pendingConfiguration
              ? {
                  command: pendingConfiguration.command,
                  expiresAt: pendingConfiguration.expiresAt,
                }
              : {}),
          },
        );
        return { run, pausedForApproval: true };
      }
      run = {
        ...run,
        applicationToolResults: [
          ...run.applicationToolResults,
          { toolCallId: toolCall.id, result: invoked.result },
        ],
      };
      this.persistApplicationToolRunState(runId, run, 'application.tool_completed', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: invoked.result,
      });
    }

    const assistantParts: ProviderContentPart[] = [];
    if (run.assistantText.trim()) {
      assistantParts.push({ type: 'text', text: run.assistantText.trim() });
    }
    for (const toolCall of run.pendingApplicationToolCalls) {
      assistantParts.push({ type: 'tool-call', toolCall });
    }
    const existingContext = run.providerContext ?? {
      systemPrompt: 'You are running inside SYNC-THINK.',
      messages: [{ role: 'user' as const, content: run.userText }],
      history: { includedEventIds: [], excludedEventIds: [], tokenEstimate: 1 },
    };
    const messages = [
      ...existingContext.messages,
      { role: 'assistant' as const, content: assistantParts },
      ...run.applicationToolResults.map((result) => ({
        role: 'tool' as const,
        toolCallId: result.toolCallId,
        content: result.result,
      })),
    ];
    const nextRun: DemoRunState = {
      ...run,
      providerContext: { ...existingContext, messages },
      providerTurn: run.providerTurn + 1,
      providerRetryAttempt: 0,
      nextAdapterEventIndex: 0,
      assistantText: '',
      pendingApplicationToolCalls: [],
      startedApplicationToolCallIds: [],
      applicationToolResults: [],
    };
    this.persistApplicationToolRunState(runId, nextRun, 'application.tool_turn_completed', {
      providerTurn: nextRun.providerTurn,
      toolCallCount: run.pendingApplicationToolCalls.length,
    });
    return { run: nextRun, pausedForApproval: false };
  }

  private async executeDemoRun(runId: RunId): Promise<void> {
    const initialRun = this.demoRuns.get(runId);
    if (!initialRun || this.inFlight.has(runId)) return;
    const executionTask = this.resolveTaskForThread(initialRun.threadId);
    let executionLeaseAcquired = false;
    if (executionTask && this.taskEnvironmentManager) {
      const executionContext = await this.taskEnvironmentManager.prepareTaskAsync(executionTask.id);
      if (executionContext.resourceId && executionContext.state !== 'ready') {
        this.persistDemoRunBlocked(runId, executionContext.blockedReason ?? '任务执行位置尚未就绪');
        return;
      }
      if (executionContext.state === 'ready' && executionContext.mode !== 'none') {
        try {
          this.taskEnvironmentManager.acquireWriteLease(executionTask.id, runId);
          executionLeaseAcquired = true;
        } catch (error) {
          this.persistDemoRunBlocked(
            runId,
            error instanceof Error ? error.message : '任务执行位置正在被其他任务使用',
          );
          return;
        }
      }

      // Task creation and execution-location preparation can finish on different ticks. Refresh
      // the Run binding here so the first Provider turn receives the tools for the location that
      // was just made ready instead of keeping the empty snapshot captured by appendMessage.
      const currentRun = this.demoRuns.get(runId);
      if (currentRun) {
        const binding = this.resolveConversationExecutionBinding(
          executionTask,
          currentRun.agentVersionId,
        );
        const bindingChanged =
          currentRun.executionRoot !== binding.executionRoot ||
          currentRun.effectiveApprovalMode !== binding.effectiveApprovalMode ||
          currentRun.browserIdentityId !== binding.browserIdentityId ||
          currentRun.executionToolNames.length !== binding.executionToolNames.length ||
          currentRun.executionToolNames.some(
            (toolName, index) => toolName !== binding.executionToolNames[index],
          );
        if (bindingChanged) {
          const refreshedRun = { ...currentRun, ...binding };
          this.persistApplicationToolRunState(runId, refreshedRun, 'run.execution-context.bound', {
            executionRoot: refreshedRun.executionRoot,
            executionToolNames: refreshedRun.executionToolNames,
            effectiveApprovalMode: refreshedRun.effectiveApprovalMode,
            browserIdentityId: refreshedRun.browserIdentityId,
          });
        }
      }
    }
    const abortController = new AbortController();
    this.demoRunAbortControllers.set(runId, abortController);
    this.recordInFlight(runId);
    try {
      const pendingToolRun = this.demoRuns.get(runId);
      if (pendingToolRun?.pendingApplicationToolCalls.length) {
        const continuation = await this.continueDemoRunAfterApplicationTools(runId, pendingToolRun);
        if (continuation.pausedForApproval) return;
      }
      // Outer loop: re-enter after section 5.3 fallback walk selects the next model.
      while (this.demoRuns.has(runId)) {
        const attemptRun = this.demoRuns.get(runId);
        if (!attemptRun) return;

        try {
          let stream: AsyncIterable<import('@sync-think/adapters').AdapterEvent> | undefined;
          try {
            stream = await this.openProviderStream(attemptRun, abortController.signal);
          } catch (error) {
            if (abortController.signal.aborted) return;
            const message = error instanceof Error ? error.message : 'provider stream failed';
            const failureClass = this.classifyThrownFailure(error);
            const retry = await this.tryRetryCurrentProvider(
              runId,
              attemptRun,
              failureClass,
              message,
            );
            if (retry === 'retry') continue;
            if (retry === 'stopped') return;
            const outcome = this.tryContinueWithFallback(runId, attemptRun, failureClass, message);
            if (outcome === 'continued') continue;
            if (outcome === 'paused') return;
            this.persistDemoRunFailure(runId, failureClass, message);
            return;
          }

          if (!stream) {
            this.persistDemoRunFailure(
              runId,
              'protocol',
              'No provider adapter available for this run',
            );
            return;
          }

          let providerEventIndex = 0;
          let resumeAfterProviderRetry = false;
          let resumeAfterFallback = false;
          let resumeAfterApplicationTools = false;

          for await (const adapterEvent of abortableAdapterEvents(stream, abortController.signal)) {
            const currentRun = this.demoRuns.get(runId);
            if (!currentRun) break;

            if (providerEventIndex < currentRun.nextAdapterEventIndex) {
              providerEventIndex++;
              continue;
            }

            // section 5.3: retryable / auth / unknown failures walk the configured fallback chain.
            if (adapterEvent.type === 'error') {
              const failureClass = adapterEvent.failureClass as FailureClass;
              const message =
                typeof adapterEvent.message === 'string' ? adapterEvent.message : undefined;
              const retry = await this.tryRetryCurrentProvider(
                runId,
                currentRun,
                failureClass,
                message,
              );
              if (retry === 'retry') {
                resumeAfterProviderRetry = true;
                break;
              }
              if (retry === 'stopped') return;
              const outcome = this.tryContinueWithFallback(
                runId,
                currentRun,
                failureClass,
                message,
              );
              if (outcome === 'continued') {
                resumeAfterFallback = true;
                break;
              }
              if (outcome === 'paused') {
                return;
              }
              // Non-fallbackable: project terminal failure as before.
            }

            if (adapterEvent.type === 'tool-result' && currentRun.applicationToolsEnabled) {
              throw new Error('application.provider_supplied_untrusted_tool_result');
            }

            if (
              adapterEvent.type === 'finished' &&
              currentRun.applicationToolsEnabled &&
              currentRun.pendingApplicationToolCalls.length > 0
            ) {
              const continuation = await this.continueDemoRunAfterApplicationTools(
                runId,
                currentRun,
              );
              if (continuation.pausedForApproval) return;
              resumeAfterApplicationTools = true;
              break;
            }

            const projection = projectAdapterEvent(currentRun, adapterEvent);
            const projectedRuns = new Map(this.demoRuns);
            if (projection.terminal) projectedRuns.delete(runId);
            else if (projection.nextRun) projectedRuns.set(runId, projection.nextRun);
            const payload = { ...projection.payload };
            if (typeof payload.errorMessage === 'string') {
              const scrubbed = this.scrubDiagnosticMessage(payload.errorMessage);
              if (scrubbed) payload.errorMessage = scrubbed;
              else delete payload.errorMessage;
            }
            const event = this.persistProjectedEvent(
              {
                id: ulid() as Event['id'],
                workspaceId: this.workspaceId,
                runId,
                category: projection.category,
                type: projection.type,
                occurredAt: new Date().toISOString(),
                payload,
              },
              projectedRuns,
            );

            if (projection.terminal) this.demoRuns.delete(runId);
            else if (projection.nextRun) this.demoRuns.set(runId, projection.nextRun);
            this.publishEvent(event);
            if (projection.terminal) {
              if (projection.type === 'run.failed') {
                this.recordRunDiagnostic(runId, currentRun, projection.payload);
              } else if (projection.type === 'run.completed') {
                this.maybeProposeRunMemory(runId, currentRun, projection.payload);
              }
              this.handleDelegatedRunTerminal(
                runId,
                currentRun,
                projection.type,
                projection.payload,
              );
            }
            providerEventIndex++;
            if (projection.terminal) break;
          }

          if (resumeAfterProviderRetry || resumeAfterFallback || resumeAfterApplicationTools) {
            continue;
          }
          return;
        } catch (error) {
          if (abortController.signal.aborted) return;
          const message = error instanceof Error ? error.message : 'provider stream failed';
          const current = this.demoRuns.get(runId);
          if (current) {
            const failureClass = this.classifyThrownFailure(error);
            const retry = await this.tryRetryCurrentProvider(runId, current, failureClass, message);
            if (retry === 'retry') continue;
            if (retry === 'stopped') return;
            const outcome = this.tryContinueWithFallback(runId, current, failureClass, message);
            if (outcome === 'continued') continue;
            if (outcome === 'paused') return;
          }
          this.persistDemoRunFailure(runId, 'unknown', message);
          return;
        }
      }
    } finally {
      if (executionLeaseAcquired && executionTask) {
        try {
          this.taskEnvironmentManager?.releaseWriteLease(executionTask.id, runId);
        } catch {
          console.warn('[runtime] task execution lease could not be released');
        }
      }
      if (this.demoRunAbortControllers.get(runId) === abortController) {
        this.demoRunAbortControllers.delete(runId);
      }
      this.forgetInFlight(runId);
    }
  }

  private scheduleDemoRunExecution(runId: RunId): void {
    this.trackBackgroundTask(this.executeDemoRun(runId));
  }

  private canLiveStream(): boolean {
    return Boolean(
      this.providerStore && this.secureStore && this.providerStore.listAllModels().length > 0,
    );
  }

  private canStartModelRun(): boolean {
    return Boolean(this.demoProvider) || this.canLiveStream();
  }

  /** 搂10.3 鈥?Agent / Skill allowlist / policy ids for Manifest inspect. */
  private resolveAgentManifestMeta(agentVersionId: string): {
    skillVersionIds: string[];
    mcpServerIds: string[];
    policyId?: string;
    policyVersion?: number;
    agentVersion?: number;
  } {
    if (this.agentStore) {
      const pinned = this.getRequiredAgentVersion(agentVersionId);
      return {
        skillVersionIds: [...(pinned.skillVersionIds ?? [])],
        mcpServerIds: [...(pinned.mcpServerIds ?? [])],
        policyId: pinned.policyId,
        agentVersion: pinned.version,
      };
    }
    return { skillVersionIds: [], mcpServerIds: [] };
  }

  private resolveAgentModelBinding(requestedVersionId?: string): AgentModelBinding {
    if (this.agentStore) {
      if (requestedVersionId !== undefined) {
        return toModelBinding(this.getRequiredAgentVersion(requestedVersionId));
      }
      const record = this.ensureAgentRecord(DEFAULT_CONVERSATION_AGENT_ID);
      return toModelBinding(record);
    }

    // Tests / ephemeral Runtime without agent store: catalog-derived binding.
    const catalog = this.providerStore?.listAllModels() ?? [];
    const defaultModel = catalog[0];
    const fallbackIds = catalog.slice(1, 4).map((m) => m.id as ModelId);
    return {
      agentVersionId: (requestedVersionId ?? DEFAULT_CONVERSATION_AGENT_ID) as AgentVersionId,
      defaultModelId: (defaultModel?.id ?? 'fake-mini') as ModelId,
      fallbackModelIds: fallbackIds,
      pauseOnFailure: true,
    };
  }

  /**
   * Product 搂5.4: run > pin > agent group first > provider primary.
   * Never returns secrets; only CredentialRef metadata + storeHandle in store layer.
   */
  private resolveRunCredentialRef(input: {
    runCredentialRefId?: string;
    agent: import('@sync-think/core').AgentModelBinding;
    providerId?: string;
  }): {
    credential?: import('@sync-think/storage').CredentialRefRecord;
    source: import('@sync-think/core').CredentialResolutionSource;
    credentialGroupId?: string;
  } {
    if (!this.providerStore) {
      return { source: 'none' };
    }
    const resolution = resolveCredentialRef({
      runCredentialRefId: input.runCredentialRefId,
      pinnedCredentialRefId: input.agent.pinnedCredentialRefId,
      defaultCredentialGroupId: input.agent.defaultCredentialGroupId,
      providerId: input.providerId,
      getCredentialRef: (id) => this.providerStore?.getCredentialRef(id),
      getFirstCredentialInGroup: (groupId) =>
        this.providerStore?.getFirstCredentialInGroup(groupId),
      getPrimaryCredentialRef: (providerId) =>
        this.providerStore?.getPrimaryCredentialRef(providerId),
      getProviderIdForCredentialGroup: (groupId) =>
        this.providerStore?.getProviderIdForCredentialGroup(groupId),
    });
    return {
      credential: resolution.credential,
      source: resolution.source,
      credentialGroupId: resolution.credentialGroupId,
    };
  }

  private resolveTaskForThread(threadId: string) {
    return this.workspaceStore?.getTaskByThreadId(threadId as ThreadId);
  }

  private resolveEffectiveScopedPolicy(input: {
    workspaceId?: WorkspaceId;
    taskId?: TaskId;
    runId?: RunId;
    agentVersion?: { agentId: string; approvalMode: ApprovalMode };
    groupApprovalMode?: ApprovalMode;
  }): ReturnType<typeof resolveScopedPolicy> {
    const scopes: PolicyScopeRef[] = [{ scopeType: 'user', scopeId: this.installId }];
    if (input.workspaceId) {
      scopes.push(
        { scopeType: 'workspace', scopeId: input.workspaceId },
        { scopeType: 'project', scopeId: input.workspaceId },
      );
    }
    if (input.taskId) scopes.push({ scopeType: 'task', scopeId: input.taskId });
    if (input.agentVersion) {
      scopes.push({ scopeType: 'agent', scopeId: input.agentVersion.agentId });
    }
    if (input.runId) scopes.push({ scopeType: 'run', scopeId: input.runId });

    const applicable = this.policyStore?.listApplicable(scopes) ?? [];
    const runPolicies = input.runId
      ? applicable.filter((policy) => policy.scopeType === 'run' && policy.scopeId === input.runId)
      : [];
    const taskPolicies = input.taskId
      ? applicable.filter(
          (policy) => policy.scopeType === 'task' && policy.scopeId === input.taskId,
        )
      : [];
    const effectivePolicies = runPolicies.length
      ? runPolicies
      : taskPolicies.length
        ? taskPolicies
        : applicable;
    const defaultApprovalMode =
      input.groupApprovalMode ?? input.agentVersion?.approvalMode ?? 'request';
    return resolveScopedPolicy([
      ...effectivePolicies.map((policy) => ({
        scope: policy.scopeType,
        scopeId: policy.scopeId,
        approvalMode: policy.approvalMode,
        rules: policy.rules,
        policyId: policy.policyId,
        version: policy.version,
      })),
      ...(effectivePolicies.length === 0
        ? [
            {
              scope: input.groupApprovalMode ? ('task' as const) : ('agent' as const),
              scopeId: input.groupApprovalMode ? input.taskId : input.agentVersion?.agentId,
              approvalMode: defaultApprovalMode,
              rules: [],
            },
          ]
        : []),
    ]);
  }

  private compileProviderContextForRun(input: {
    threadId: string;
    latestUserMessageId?: string;
    latestUserText: string;
    agentVersionId: string;
    maxHistoryTokens: number;
  }) {
    const task = this.resolveTaskForThread(input.threadId);
    const project = task ? this.workspaceStore?.getWorkspace(task.workspaceId) : undefined;
    const agent = this.agentStore?.getVersion(input.agentVersionId);
    const group = task ? this.groupStore?.getForTask(task.id) : undefined;
    const effectivePolicy = task
      ? this.resolveEffectiveScopedPolicy({
          workspaceId: task.workspaceId,
          taskId: task.id,
          agentVersion: agent
            ? { agentId: String(agent.agentId), approvalMode: agent.approvalMode }
            : undefined,
          groupApprovalMode: group?.approvalMode,
        })
      : undefined;
    const surface = resolveSyncThinkSurface({
      events: this.events,
      taskId: task?.id,
      hasGroup: Boolean(group),
      fallback: 'conversation',
    });
    return compileProviderContext({
      events: this.events,
      threadId: input.threadId,
      latestUserMessageId: input.latestUserMessageId,
      latestUserText: input.latestUserText,
      surface,
      permissionMode: effectivePolicy?.approvalMode ?? group?.approvalMode ?? agent?.approvalMode,
      project: project
        ? {
            id: project.id,
            name: project.name,
            folderBound: Boolean(project.folderPath),
            ...(project.folderPath ? { authorizedFolderPath: project.folderPath } : {}),
          }
        : undefined,
      task: task
        ? {
            id: task.id,
            title: task.title,
            goal: task.goal,
            status: task.status,
            acceptanceCriteria: task.acceptanceCriteria,
          }
        : undefined,
      agent: agent
        ? {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            developerInstructions: agent.developerInstructions,
            inputContract: agent.inputContract,
            outputContract: agent.outputContract,
          }
        : undefined,
      group: group
        ? {
            id: group.id,
            name: group.name,
            leadAgentVersionId: group.leadAgentVersionId,
            members: group.members.map((member) => ({
              agentVersionId: member.agentVersionId,
              name: this.agentStore?.getVersion(member.agentVersionId)?.name,
              responsibility: member.responsibility,
            })),
          }
        : undefined,
      maxHistoryTokens: input.maxHistoryTokens,
    });
  }

  /**
   * Assemble candidate sources for a model call. Protected task goal /
   * acceptance always enter selection (design section 20.9); overflow drops
   * compressible excerpts first and is visible on the Manifest.
   */
  private buildProtectedContextSelection(input: {
    runId: RunId;
    threadId: string;
    userText: string;
    latestUserMessageId?: string;
    agentVersionId: string;
    historyTokenEstimate?: number;
    tokenBudget?: number;
    /** Agent allowlist 鈥?only these Skill versions become skill-definition sources (搂9.1). */
    skillVersionIds?: readonly string[];
    /** Agent MCP allowlist 鈥?only these servers contribute tool-schema sources (搂9.3). */
    mcpServerIds?: readonly string[];
  }) {
    const task = this.resolveTaskForThread(input.threadId);
    const candidates: ContextSourceRef[] = [];
    const summaries: Array<{ sourceId: string; summary: string }> = [];

    candidates.push({
      id: 'application:sync-think',
      kind: 'application-context',
      tokenEstimate: 72,
    });
    summaries.push({
      sourceId: 'application:sync-think',
      summary: 'SYNC-THINK local-first Agent desktop workspace',
    });

    const agent = this.agentStore?.getVersion(input.agentVersionId);
    const agentInstructions = agent?.developerInstructions ?? 'Default conversation Agent';
    candidates.push({
      id: `agent-instructions:${input.agentVersionId}`,
      kind: 'agent-instructions',
      tokenEstimate: Math.max(16, Math.ceil(agentInstructions.length / 4)),
    });
    summaries.push({
      sourceId: `agent-instructions:${input.agentVersionId}`,
      summary: agent ? `${agent.name} · ${agent.role}`.slice(0, 120) : 'default conversation Agent',
    });

    if (task?.goal?.trim()) {
      candidates.push({
        id: `task-goal:${task.id}`,
        kind: 'task-goal',
        tokenEstimate: Math.max(8, Math.ceil(task.goal.length / 4)),
      });
      summaries.push({
        sourceId: `task-goal:${task.id}`,
        summary: task.goal.slice(0, 120),
      });
    }

    if (task) {
      candidates.push({
        id: `task-status:${task.id}`,
        kind: 'task-status',
        tokenEstimate: 8,
      });
      summaries.push({
        sourceId: `task-status:${task.id}`,
        summary: task.status,
      });
    }

    if (task && task.acceptanceCriteria.length > 0) {
      const joined = task.acceptanceCriteria.join('\n');
      candidates.push({
        id: `acceptance:${task.id}`,
        kind: 'acceptance-criteria',
        tokenEstimate: Math.max(8, Math.ceil(joined.length / 4)),
      });
      summaries.push({
        sourceId: `acceptance:${task.id}`,
        summary: task.acceptanceCriteria.slice(0, 3).join(' · ').slice(0, 120),
      });
    }

    const group = task ? this.groupStore?.getForTask(task.id) : undefined;
    if (group) {
      const responsibilities = group.members.map((member) => member.responsibility).join('\n');
      candidates.push({
        id: `group:${group.id}:v${group.version}`,
        kind: 'group-definition',
        tokenEstimate: Math.max(24, Math.ceil((group.name.length + responsibilities.length) / 4)),
      });
      summaries.push({
        sourceId: `group:${group.id}:v${group.version}`,
        summary: `${group.name} · ${group.members.length} members`,
      });
    }

    if ((input.historyTokenEstimate ?? 0) > 0) {
      candidates.push({
        id: `conversation-history:${input.threadId}`,
        kind: 'conversation-history',
        tokenEstimate: input.historyTokenEstimate!,
      });
      summaries.push({
        sourceId: `conversation-history:${input.threadId}`,
        summary: 'ordered messages from the current task only',
      });
    }

    // Explicit cross-task ref via parentTaskId only (搂10.1) 锟?never sibling scrape.
    const parent =
      task?.parentTaskId && this.workspaceStore
        ? this.workspaceStore.getTask(task.parentTaskId)
        : undefined;
    const cross = resolveCrossTaskRefs({
      taskId: task?.id ?? input.threadId,
      parentTaskId: task?.parentTaskId,
      parent: parent
        ? {
            id: parent.id,
            title: parent.title,
            goal: parent.goal,
            status: parent.status,
            acceptanceCriteria: parent.acceptanceCriteria,
          }
        : undefined,
    });
    for (const source of cross.sources) {
      candidates.push(source);
    }
    for (const summary of cross.summaries) {
      summaries.push(summary);
    }

    // Approved/active project memory (搂10.1 layer 2) 锟?explicit durable entries only.
    let memoryEvidenceRefs: string[] = [];
    if (this.memoryStore) {
      try {
        const taskId = task?.id as import('@sync-think/shared').TaskId | undefined;
        const entries = this.memoryStore.listActiveEntries({
          workspaceId: this.workspaceId,
          taskId,
          limit: 16,
        });
        const memory = resolveProjectMemorySources({
          entries: entries.map((e) => ({
            id: e.id,
            key: e.key,
            value: e.value,
            scope: e.scope,
            taskId: e.taskId,
          })),
          maxEntries: 8,
        });
        for (const source of memory.sources) {
          candidates.push(source);
        }
        for (const summary of memory.summaries) {
          summaries.push(summary);
        }
        memoryEvidenceRefs = memory.evidenceRefs;
      } catch (err) {
        console.warn('[runtime] project memory context load failed', err);
      }
    }

    candidates.push({
      id: `latest-message:${input.latestUserMessageId ?? input.runId}`,
      kind: 'latest-user-message',
      tokenEstimate: Math.max(1, Math.ceil(input.userText.length / 4)),
    });
    summaries.push({
      sourceId: `latest-message:${input.latestUserMessageId ?? input.runId}`,
      summary: input.userText.slice(0, 80),
    });

    // Allowed Skills only 鈥?install 鈮?available (搂9.1 / 搂10.2 skill-definition).
    let resolvedSkillVersionIds: string[] = [];
    let missingSkillVersionIds: string[] = [];
    if (this.skillStore && input.skillVersionIds && input.skillVersionIds.length > 0) {
      try {
        const skills = resolveAllowedSkillSources({
          skillVersionIds: input.skillVersionIds,
          getSkill: (id) => {
            const row = this.skillStore?.getVersion(id);
            if (!row) return undefined;
            return {
              id: row.id,
              name: row.name,
              version: row.version,
              description: row.description,
              body: row.body,
              allowedTools: row.allowedTools,
              hasScripts: row.hasScripts,
            };
          },
          maxSkills: 6,
        });
        for (const source of skills.sources) {
          candidates.push(source);
        }
        for (const summary of skills.summaries) {
          summaries.push(summary);
        }
        resolvedSkillVersionIds = skills.resolvedSkillVersionIds;
        missingSkillVersionIds = skills.missingSkillVersionIds;
        if (missingSkillVersionIds.length > 0) {
          console.warn('[runtime] allowlisted skills missing from library', missingSkillVersionIds);
        }
      } catch (err) {
        console.warn('[runtime] skill context load failed', err);
      }
    }

    // Allowed MCP tools only 鈥?register 鈮?available (搂9.3 / 搂10.2 tool-schema).
    let resolvedMcpServerIds: string[] = [];
    let missingMcpServerIds: string[] = [];
    let toolSchemaCount = 0;
    if (this.mcpStore && input.mcpServerIds && input.mcpServerIds.length > 0) {
      try {
        const mcp = resolveAllowedMcpToolSources({
          mcpServerIds: input.mcpServerIds,
          getServer: (id) => {
            const row = this.mcpStore?.get(id);
            if (!row) return undefined;
            return {
              id: row.id,
              name: row.name,
              transport: row.transport,
              endpoint: row.endpoint,
              trusted: row.trusted,
              tools: row.tools,
              maxOutputBytes: row.maxOutputBytes,
              timeoutMs: row.timeoutMs,
            };
          },
          maxServers: 6,
          maxTools: 16,
        });
        for (const source of mcp.sources) {
          candidates.push(source);
        }
        for (const summary of mcp.summaries) {
          summaries.push(summary);
        }
        resolvedMcpServerIds = mcp.resolvedMcpServerIds;
        missingMcpServerIds = mcp.missingMcpServerIds;
        toolSchemaCount = mcp.toolSchemaCount;
        if (missingMcpServerIds.length > 0) {
          console.warn(
            '[runtime] allowlisted MCP servers missing from registry',
            missingMcpServerIds,
          );
        }
      } catch (err) {
        console.warn('[runtime] mcp tool-schema context load failed', err);
      }
    }

    const selected = selectContextSources({
      candidates,
      tokenBudget: input.tokenBudget ?? 8_000,
      allowSoftTruncateKinds: [
        'message-excerpt',
        'conversation-history',
        'file-excerpt',
        'cross-task-ref',
        'project-memory',
        'skill-definition',
        'tool-schema',
      ],
    });

    return {
      task,
      selected,
      crossTaskRefs: cross.crossTaskRefs,
      memoryEvidenceRefs,
      resolvedSkillVersionIds,
      missingSkillVersionIds,
      resolvedMcpServerIds,
      missingMcpServerIds,
      toolSchemaCount,
      summaries: summaries.filter(
        (s) =>
          selected.included.some((i) => i.id === s.sourceId) ||
          selected.excluded.some((e) => e.id === s.sourceId),
      ),
    };
  }

  private prepareRunBinding(input: {
    runId: RunId;
    threadId: string;
    userText: string;
    attachmentContext?: string;
    attachments?: readonly import('@sync-think/shared').MessageAttachment[];
    latestUserMessageId?: string;
    modelId?: string;
    credentialRefId?: string;
    agentVersionId?: string;
  }): {
    run: DemoRunState;
    packetId: string;
    proofHash: string;
    includedSourceIds: string[];
    excludedSourceIds: string[];
    includedSources: Array<{ id: string; kind: string; tokenEstimate: number }>;
    excludedSources: Array<{ id: string; kind: string; tokenEstimate: number }>;
    summaries: Array<{ sourceId: string; summary: string }>;
    truncations: Array<{
      sourceId: string;
      reason: string;
      beforeTokens: number;
      afterTokens: number;
    }>;
    crossTaskRefs: string[];
    evidenceRefsForMemory: string[];
    historyIncludedEventIds: string[];
    historyExcludedEventIds: string[];
    tokenEstimate: number;
    skillVersionIds: string[];
    mcpServerIds: string[];
    policyId?: string;
    agentVersion?: number;
  } {
    if (input.agentVersionId !== undefined && !this.agentStore) {
      throw new Error('AgentVersion exact lookup requires the Agent store');
    }
    const agent = this.resolveAgentModelBinding(input.agentVersionId);
    const agentVersionId = agent.agentVersionId;
    const agentMeta = this.resolveAgentManifestMeta(agentVersionId);

    const resolution = resolveModelBinding({
      agent,
      runModelId: input.modelId ? (input.modelId as ModelId) : undefined,
    });

    let resolvedModelId =
      resolution.status === 'resolved' ? resolution.modelId : agent.defaultModelId;
    let source: ModelResolutionSource =
      resolution.status === 'resolved' ? resolution.source : 'agentDefault';

    // If payload modelId is a providerModelId string (UI may send either), map it.
    let modelRecord = this.providerStore?.getModel(resolvedModelId);
    if (!modelRecord && input.modelId && this.providerStore) {
      for (const entry of this.providerStore.listProviders()) {
        const found = this.providerStore.findModelByProviderModelId(
          entry.provider.id,
          input.modelId,
        );
        if (found) {
          modelRecord = found;
          resolvedModelId = found.id as ModelId;
          source = 'runOverride';
          break;
        }
      }
    }
    if (!modelRecord && resolvedModelId !== 'fake-mini' && this.providerStore) {
      modelRecord = this.providerStore.getModel(resolvedModelId);
    }
    const useFake = !modelRecord || !this.providerStore || !this.secureStore;
    const provider = modelRecord
      ? this.providerStore?.getProvider(modelRecord.providerId)
      : undefined;
    const credentialResolution = this.resolveRunCredentialRef({
      runCredentialRefId: input.credentialRefId,
      agent,
      providerId: provider?.id,
    });
    const credential = credentialResolution.credential;

    const packetId = ulid();
    const historyPreview = this.compileProviderContextForRun({
      threadId: input.threadId,
      latestUserText: '',
      agentVersionId,
      maxHistoryTokens: 24_000,
    });
    const historicalImageAttachments = historyPreview.history.imageAttachments ?? [];
    if (
      (input.attachments?.some((attachment) => attachment.kind === 'image') ||
        historicalImageAttachments.length > 0) &&
      modelRecord &&
      (!modelRecord.capabilitiesConfirmed || !modelRecord.capabilities.includes('vision'))
    ) {
      throw new Error('当前模型未确认支持图片，请切换到具有视觉能力的模型');
    }
    const {
      task: boundTask,
      selected,
      summaries: protectedSummaries,
      crossTaskRefs: protectedCrossTaskRefs,
      memoryEvidenceRefs: protectedMemoryEvidenceRefs,
    } = this.buildProtectedContextSelection({
      runId: input.runId,
      threadId: input.threadId,
      userText: input.userText,
      latestUserMessageId: input.latestUserMessageId,
      agentVersionId,
      historyTokenEstimate: historyPreview.history.tokenEstimate,
      skillVersionIds: agentMeta.skillVersionIds,
      mcpServerIds: agentMeta.mcpServerIds,
    });
    const forceExclude = this.threadContextAmendments.get(input.threadId)?.excludeSourceIds ?? [];
    const amended = applyUserContextAmendments({
      included: selected.included,
      excluded: selected.excluded,
      forceExcludeSourceIds: forceExclude,
      summaries: protectedSummaries,
      evidenceRefsForMemory: protectedMemoryEvidenceRefs,
    });
    const included = amended.included;
    const allocatedHistoryTokens =
      included.find((source) => source.kind === 'conversation-history')?.tokenEstimate ?? 0;
    const latestUserText = input.attachmentContext
      ? `${input.userText}\n\n${input.attachmentContext}`
      : input.userText;
    const providerContext = this.compileProviderContextForRun({
      threadId: input.threadId,
      latestUserMessageId: input.latestUserMessageId,
      latestUserText,
      agentVersionId,
      maxHistoryTokens: allocatedHistoryTokens + Math.max(1, Math.ceil(latestUserText.length / 4)),
    });
    const built = buildContextPacket({
      packetId,
      taskId: (boundTask?.id ?? this.workspaceId) as unknown as TaskId,
      agentVersionId,
      modelId: resolvedModelId,
      createdAt: new Date().toISOString(),
      runId: input.runId,
      credentialRefId: credential?.id,
      included,
      excluded: amended.excluded,
      truncations: selected.truncations,
      summaries: amended.summaries,
      crossTaskRefs: protectedCrossTaskRefs,
      evidenceRefsForMemory: amended.evidenceRefsForMemory,
      skillVersionIds: agentMeta.skillVersionIds as never,
      policyVersion: agentMeta.policyVersion,
    });

    const run = createDemoRun(input.runId, input.threadId, input.userText, {
      latestUserMessageId: input.latestUserMessageId,
      providerContext,
      modelId: resolvedModelId,
      providerModelId: modelRecord?.providerModelId ?? resolvedModelId,
      protocol: modelRecord?.protocol ?? 'openai-chat',
      baseUrl: provider?.baseUrl ?? 'https://fake.invalid/v1',
      providerId: provider?.id,
      credentialRefId: credential?.id,
      credentialResolutionSource: credentialResolution.source,
      agentVersionId,
      resolutionSource: source,
      packetId: built.packet.id,
      proofHash: built.packet.proofHash,
      useFakeProvider: useFake,
      applicationToolsEnabled: resolveApplicationToolsEnabled({
        protocol: modelRecord?.protocol,
        capabilities: modelRecord?.capabilities,
        capabilitiesConfirmed: modelRecord?.capabilitiesConfirmed,
        modelId: resolvedModelId,
      }),
      ...this.resolveConversationExecutionBinding(boundTask, agentVersionId),
      attachments: input.attachments ?? [],
    });

    return {
      run,
      packetId: built.packet.id,
      proofHash: built.packet.proofHash,
      includedSourceIds: included.map((s) => s.id),
      excludedSourceIds: built.packet.excludedSources.map((s) => s.id),
      includedSources: included.map((s) => ({
        id: s.id,
        kind: s.kind,
        tokenEstimate: s.tokenEstimate,
      })),
      excludedSources: built.packet.excludedSources.map((s) => ({
        id: s.id,
        kind: s.kind,
        tokenEstimate: s.tokenEstimate,
      })),
      summaries: built.manifest.summaries.map((s) => ({
        sourceId: s.sourceId,
        summary: s.summary,
      })),
      truncations: built.manifest.truncations.map((t) => ({
        sourceId: t.sourceId,
        reason: t.reason,
        beforeTokens: t.beforeTokens,
        afterTokens: t.afterTokens,
      })),
      crossTaskRefs: [...built.packet.crossTaskRefs],
      evidenceRefsForMemory: [...(built.manifest.evidenceRefsForMemory ?? [])],
      historyIncludedEventIds: [...providerContext.history.includedEventIds],
      historyExcludedEventIds: [...providerContext.history.excludedEventIds],
      tokenEstimate: built.packet.tokenEstimate,
      skillVersionIds: [...agentMeta.skillVersionIds],
      mcpServerIds: [...agentMeta.mcpServerIds],
      policyId: agentMeta.policyId,
      agentVersion: agentMeta.agentVersion,
    };
  }

  private resolveConversationExecutionBinding(
    task: TaskRecord | undefined,
    agentVersionId: string,
  ): {
    executionRoot?: string;
    executionToolNames: string[];
    effectiveApprovalMode?: string;
    browserIdentityId?: string;
  } {
    if (!task) return { executionToolNames: [] };
    const agent = this.agentStore?.getVersion(agentVersionId as AgentVersionId);
    const group = this.groupStore?.getForTask(task.id);
    const effectivePolicy = this.resolveEffectiveScopedPolicy({
      workspaceId: task.workspaceId,
      taskId: task.id,
      agentVersion: agent
        ? { agentId: String(agent.agentId), approvalMode: agent.approvalMode }
        : undefined,
      groupApprovalMode: group?.approvalMode,
    });
    const context = this.executionEnvironmentStore?.getTaskContext(task.id);
    const executionRoot =
      context?.executionPath && context.state === 'ready' ? context.executionPath : undefined;
    const delegated = this.delegatedSubtaskDescriptors().find(
      (candidate) => candidate.childTaskId === task.id,
    );
    // Codex three-mode authority: mode decides tool surface; AgentPermissions matrix is ignored.
    const effectiveExecution = resolveEffectiveExecution({
      legacyApprovalMode: effectivePolicy.approvalMode,
      workspaceRoot: executionRoot,
      candidateToolNames: EXECUTION_TOOL_SCHEMAS.map((tool) => tool.name),
      allowedTools: delegated?.packet.allowedTools,
    });
    if (!executionRoot) {
      return {
        executionToolNames: [],
        effectiveApprovalMode: effectiveExecution.legacyApprovalMode,
      };
    }
    return {
      executionRoot,
      executionToolNames: effectiveExecution.toolNames,
      effectiveApprovalMode: effectiveExecution.legacyApprovalMode,
      ...(context?.browserIdentityId
        ? { browserIdentityId: String(context.browserIdentityId) }
        : {}),
    };
  }

  private async tryRetryCurrentProvider(
    runId: RunId,
    run: DemoRunState,
    failureClass: FailureClass,
    errorMessage?: string,
  ): Promise<'retry' | 'stopped' | 'none'> {
    const isEmptyAttempt =
      run.nextAdapterEventIndex === 0 &&
      run.assistantText.length === 0 &&
      run.pendingApplicationToolCalls.length === 0;
    const isGatewayOutage =
      failureClass === 'timeout' ||
      (failureClass === 'transient' &&
        /(?:\b502\b|\b503\b|\b504\b|network error|econnreset|socket hang up)/i.test(
          errorMessage ?? '',
        ));
    const attempt = run.providerRetryAttempt + 1;
    const delayMs = this.providerRetryDelaysMs[attempt - 1];
    if (!isEmptyAttempt || !isGatewayOutage || delayMs === undefined) return 'none';

    const scrubbedMessage = this.scrubDiagnosticMessage(errorMessage);
    const nextRun: DemoRunState = {
      ...run,
      providerRetryAttempt: attempt,
      nextAdapterEventIndex: 0,
      assistantText: '',
    };
    const projectedRuns = new Map(this.demoRuns);
    projectedRuns.set(runId, nextRun);
    try {
      const event = this.persistProjectedEvent(
        {
          id: ulid() as Event['id'],
          workspaceId: this.workspaceId,
          runId,
          category: 'run',
          type: 'run.retry.scheduled',
          occurredAt: new Date().toISOString(),
          payload: {
            threadId: run.threadId,
            modelId: run.modelId,
            providerModelId: run.providerModelId,
            failureClass,
            ...(scrubbedMessage ? { errorMessage: scrubbedMessage } : {}),
            attempt,
            maxAttempts: this.providerRetryDelaysMs.length,
            delayMs,
            providerTurn: run.providerTurn,
            packetId: run.packetId,
            run: nextRun,
          },
        },
        projectedRuns,
      );
      this.demoRuns.set(runId, nextRun);
      this.publishEvent(event);
    } catch (error) {
      console.warn(
        '[runtime] provider retry could not be persisted',
        error instanceof Error ? error.message : 'unknown persistence error',
      );
      return 'none';
    }

    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    return this.demoRuns.has(runId) ? 'retry' : 'stopped';
  }

  /**
   * After bounded transient retries, walk the Agent fallback chain (design section 5.3).
   * Never silent-swaps models; pauses when the chain is empty or exhausted.
   */
  private tryContinueWithFallback(
    runId: RunId,
    run: DemoRunState,
    failureClass: FailureClass,
    errorMessage?: string,
  ): 'continued' | 'paused' | 'failed' {
    if (!shouldAttemptFallback(failureClass)) {
      return 'failed';
    }

    const agent = this.resolveAgentModelBinding(run.agentVersionId);
    let resolution = resolveModelBinding({
      agent,
      failedModelId: run.modelId as ModelId,
      failureClass,
    });
    while (resolution.status === 'resolved' && resolution.source === 'agentFallback') {
      const candidate = this.providerStore?.getModel(resolution.modelId);
      const requiresVision = run.attachments.some((attachment) => attachment.kind === 'image');
      if (
        !requiresVision ||
        !candidate ||
        (candidate.capabilitiesConfirmed && candidate.capabilities.includes('vision'))
      ) {
        break;
      }
      resolution = resolveModelBinding({
        agent,
        failedModelId: resolution.modelId,
        failureClass,
      });
    }

    const scrubbedMessage = this.scrubDiagnosticMessage(errorMessage);

    // Do NOT call recordRunDiagnostic here: it uses appendEvent and advances
    // liveCursor outside the state-store sequence, which can hide later
    // durable events (run.paused / run.fallback.selected) from subscribers.
    // Diagnostics are recorded on terminal pause/failure only.

    if (resolution.status === 'paused') {
      this.persistDemoRunPaused(runId, {
        reason: resolution.reason,
        failedModelId: resolution.failedModelId,
        failureClass,
        errorMessage: scrubbedMessage,
      });
      return 'paused';
    }

    if (resolution.status !== 'resolved' || resolution.source !== 'agentFallback') {
      return 'failed';
    }

    const nextRun = this.rebindRunToModel(run, resolution.modelId, resolution.source);
    const projectedRuns = new Map(this.demoRuns);
    projectedRuns.set(runId, nextRun);

    try {
      const event = this.persistProjectedEvent(
        {
          id: ulid() as Event['id'],
          workspaceId: this.workspaceId,
          runId,
          category: 'run',
          type: 'run.fallback.selected',
          occurredAt: new Date().toISOString(),
          payload: {
            threadId: run.threadId,
            fromModelId: run.modelId,
            toModelId: nextRun.modelId,
            fromProviderModelId: run.providerModelId,
            toProviderModelId: nextRun.providerModelId,
            failureClass,
            ...(scrubbedMessage ? { errorMessage: scrubbedMessage } : {}),
            resolutionSource: nextRun.resolutionSource,
            fallbackIndex: resolution.fallbackIndex,
            agentVersionId: nextRun.agentVersionId,
            packetId: nextRun.packetId,
            previousPacketId: run.packetId,
            run: nextRun,
          },
        },
        projectedRuns,
      );
      this.demoRuns.set(runId, nextRun);
      this.publishEvent(event);

      // Observable Manifest refresh for the fallback model (same task context).
      const fallbackAgentMeta = this.resolveAgentManifestMeta(String(nextRun.agentVersionId));
      const fallbackContextSelection = this.buildProtectedContextSelection({
        runId,
        threadId: nextRun.threadId,
        userText: nextRun.userText,
        latestUserMessageId: nextRun.latestUserMessageId,
        agentVersionId: nextRun.agentVersionId,
        historyTokenEstimate: nextRun.providerContext?.history.tokenEstimate,
        skillVersionIds: fallbackAgentMeta.skillVersionIds,
        mcpServerIds: fallbackAgentMeta.mcpServerIds,
      });
      const fallbackForce =
        this.threadContextAmendments.get(nextRun.threadId)?.excludeSourceIds ?? [];
      const fallbackAmended = applyUserContextAmendments({
        included: fallbackContextSelection.selected.included,
        excluded: fallbackContextSelection.selected.excluded,
        forceExcludeSourceIds: fallbackForce,
        summaries: fallbackContextSelection.summaries,
        evidenceRefsForMemory: fallbackContextSelection.memoryEvidenceRefs,
      });
      const contextEvent = this.persistProjectedEvent(
        {
          id: ulid() as Event['id'],
          workspaceId: this.workspaceId,
          runId,
          category: 'context',
          type: 'context.packet.built',
          occurredAt: new Date().toISOString(),
          payload: {
            threadId: nextRun.threadId,
            packetId: nextRun.packetId,
            proofHash: nextRun.proofHash,
            modelId: nextRun.modelId,
            providerModelId: nextRun.providerModelId,
            resolutionSource: nextRun.resolutionSource,
            credentialRefId: nextRun.credentialRefId,
            credentialResolutionSource: nextRun.credentialResolutionSource,
            agentVersionId: nextRun.agentVersionId,
            fallbackIndex: resolution.fallbackIndex,
            agentVersion: fallbackAgentMeta.agentVersion,
            skillVersionIds: fallbackAgentMeta.skillVersionIds,
            mcpServerIds: fallbackAgentMeta.mcpServerIds,
            policyId: fallbackAgentMeta.policyId,
            includedSourceIds: fallbackAmended.included.map((s) => s.id),
            excludedSourceIds: fallbackAmended.excluded.map((s) => s.id),
            includedSources: fallbackAmended.included.map((s) => ({
              id: s.id,
              kind: s.kind,
              tokenEstimate: s.tokenEstimate,
            })),
            excludedSources: fallbackAmended.excluded.map((s) => ({
              id: s.id,
              kind: s.kind,
              tokenEstimate: s.tokenEstimate,
            })),
            summaries: fallbackAmended.summaries,
            truncations: fallbackContextSelection.selected.truncations.map((tr) => ({
              sourceId: tr.sourceId,
              reason: tr.reason,
              beforeTokens: tr.beforeTokens,
              afterTokens: tr.afterTokens,
            })),
            crossTaskRefs: fallbackContextSelection.crossTaskRefs ?? [],
            evidenceRefsForMemory: fallbackAmended.evidenceRefsForMemory,
            historyIncludedEventIds: nextRun.providerContext?.history.includedEventIds ?? [],
            historyExcludedEventIds: nextRun.providerContext?.history.excludedEventIds ?? [],
            tokenEstimate: fallbackAmended.tokenEstimate,
          },
        },
        new Map(this.demoRuns),
      );
      this.publishEvent(contextEvent);
      return 'continued';
    } catch {
      console.warn('[runtime] fallback selection could not be persisted');
      return 'failed';
    }
  }

  private rebindRunToModel(
    run: DemoRunState,
    modelId: ModelId,
    source: ModelResolutionSource,
  ): DemoRunState {
    let modelRecord = this.providerStore?.getModel(modelId);
    if (!modelRecord && this.providerStore) {
      for (const entry of this.providerStore.listProviders()) {
        const found = this.providerStore.findModelByProviderModelId(entry.provider.id, modelId);
        if (found) {
          modelRecord = found;
          break;
        }
      }
    }

    const useFake = !modelRecord || !this.providerStore || !this.secureStore;
    const provider = modelRecord
      ? this.providerStore?.getProvider(modelRecord.providerId)
      : undefined;
    const agentBinding = this.resolveAgentModelBinding(run.agentVersionId);
    const credentialResolution = this.resolveRunCredentialRef({
      runCredentialRefId: run.credentialRefId,
      agent: agentBinding,
      providerId: provider?.id,
    });
    const credential = credentialResolution.credential;

    const packetId = ulid();
    const {
      task: boundTask,
      selected,
      summaries: protectedSummaries,
      crossTaskRefs: protectedCrossTaskRefs,
      memoryEvidenceRefs: protectedMemoryEvidenceRefs,
    } = this.buildProtectedContextSelection({
      runId: run.runId,
      threadId: run.threadId,
      userText: run.userText,
      latestUserMessageId: run.latestUserMessageId,
      agentVersionId: run.agentVersionId,
      historyTokenEstimate: run.providerContext?.history.tokenEstimate,
      skillVersionIds: this.resolveAgentManifestMeta(String(run.agentVersionId)).skillVersionIds,
      mcpServerIds: this.resolveAgentManifestMeta(String(run.agentVersionId)).mcpServerIds,
    });
    const rebindAgentMeta = this.resolveAgentManifestMeta(String(run.agentVersionId));
    const included = selected.included;
    const built = buildContextPacket({
      packetId,
      taskId: (boundTask?.id ?? this.workspaceId) as unknown as TaskId,
      agentVersionId: run.agentVersionId as AgentVersionId,
      modelId,
      createdAt: new Date().toISOString(),
      runId: run.runId,
      credentialRefId: credential?.id as CredentialRefId | undefined,
      included,
      excluded: selected.excluded,
      truncations: selected.truncations,
      summaries: protectedSummaries,
      crossTaskRefs: protectedCrossTaskRefs,
      evidenceRefsForMemory: protectedMemoryEvidenceRefs,
      skillVersionIds: rebindAgentMeta.skillVersionIds as never,
      policyVersion: rebindAgentMeta.policyVersion,
    });

    return {
      ...run,
      modelId: (modelRecord?.id ?? modelId) as string,
      providerModelId: modelRecord?.providerModelId ?? modelId,
      protocol: modelRecord?.protocol ?? run.protocol,
      baseUrl: provider?.baseUrl ?? run.baseUrl,
      providerId: provider?.id,
      credentialRefId: credential?.id as string | undefined,
      credentialResolutionSource: credentialResolution.source,
      resolutionSource: source,
      packetId: built.packet.id,
      proofHash: built.packet.proofHash,
      nextAdapterEventIndex: 0,
      assistantText: '',
      providerRetryAttempt: 0,
      applicationToolsEnabled: resolveApplicationToolsEnabled({
        protocol: modelRecord?.protocol,
        capabilities: modelRecord?.capabilities,
        capabilitiesConfirmed: modelRecord?.capabilitiesConfirmed,
        modelId,
      }),
      pendingApplicationToolCalls: [],
      startedApplicationToolCallIds: [],
      applicationToolResults: [],
      useFakeProvider: useFake,
    };
  }

  private persistDemoRunPaused(
    runId: RunId,
    details: {
      reason: 'no_fallback_configured' | 'fallback_exhausted';
      failedModelId: ModelId | string;
      failureClass: FailureClass;
      errorMessage?: string;
    },
  ): void {
    const run = this.demoRuns.get(runId);
    if (!run) return;
    const projectedRuns = new Map(this.demoRuns);
    projectedRuns.delete(runId);
    try {
      const event = this.persistProjectedEvent(
        {
          id: ulid() as Event['id'],
          workspaceId: this.workspaceId,
          runId,
          category: 'run',
          type: 'run.paused',
          occurredAt: new Date().toISOString(),
          payload: {
            threadId: run.threadId,
            reason: details.reason,
            failedModelId: details.failedModelId,
            failureClass: details.failureClass,
            ...(details.errorMessage ? { errorMessage: details.errorMessage } : {}),
            modelId: run.modelId,
            providerModelId: run.providerModelId,
            packetId: run.packetId,
            resolutionSource: run.resolutionSource,
            agentVersionId: run.agentVersionId,
            pauseOnFailure: true,
            idempotencyKey: runId,
          },
        },
        projectedRuns,
      );
      this.demoRuns.delete(runId);
      this.publishEvent(event);
      this.handleDelegatedRunTerminal(runId, run, 'run.failed', {
        failureClass: details.failureClass,
        errorMessage: details.errorMessage,
      });
      this.recordRunDiagnostic(runId, run, {
        failureClass: details.failureClass,
        errorMessage: details.errorMessage,
        modelId: run.modelId,
        providerModelId: run.providerModelId,
        stage: 'paused',
        reason: details.reason,
      });
    } catch (error) {
      console.warn(
        '[runtime] demo Run pause could not be persisted',
        error instanceof Error ? error.message : 'unknown persistence error',
      );
    }
  }

  private classifyThrownFailure(error: unknown): FailureClass {
    if (error && typeof error === 'object' && 'failureClass' in error) {
      const fc = String((error as { failureClass?: unknown }).failureClass);
      if (
        fc === 'transient' ||
        fc === 'auth' ||
        fc === 'protocol' ||
        fc === 'permission' ||
        fc === 'acceptance' ||
        fc === 'rate-limit' ||
        fc === 'timeout' ||
        fc === 'unknown'
      ) {
        return fc;
      }
    }
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/timed?\s*out/i.test(message)) return 'timeout';
    if (/rate\s*limit/i.test(message)) return 'rate-limit';
    if (/auth|unauthorized|401|403/i.test(message)) return 'auth';
    return 'unknown';
  }

  private async openProviderStream(
    run: DemoRunState,
    signal: AbortSignal,
  ): Promise<AsyncIterable<import('@sync-think/adapters').AdapterEvent> | undefined> {
    const attachments = [
      ...(run.providerContext?.history.imageAttachments ?? []),
      ...run.attachments,
    ].filter(
      (attachment, index, all) =>
        attachment.kind === 'image' &&
        all.findIndex((candidate) => candidate.id === attachment.id) === index,
    );
    const imageParts = await loadImageAttachmentParts(attachments);
    if (run.useFakeProvider || !run.providerId) {
      if (!this.demoProvider) return undefined;
      return this.demoProvider.call(createDemoProviderRequest(run, undefined, signal, imageParts));
    }
    if (!this.providerStore || !this.secureStore || !run.credentialRefId) {
      if (this.demoProvider) {
        return this.demoProvider.call(
          createDemoProviderRequest(run, undefined, signal, imageParts),
        );
      }
      return undefined;
    }
    const adapter = this.resolveDiscoveryAdapter(run.protocol) ?? this.demoProvider;
    if (!adapter) return undefined;

    const storeHandle = this.providerStore.getCredentialStoreHandle(run.credentialRefId);
    if (!storeHandle) {
      throw new Error('Credential handle missing for live provider call');
    }
    const apiKey = await this.secureStore.retrieveSecret(storeHandle);
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('Credential secret empty for live provider call');
    }
    return adapter.call(createDemoProviderRequest(run, apiKey, signal, imageParts));
  }

  private persistDemoRunFailure(
    runId: RunId,
    failureClass: string = 'unknown',
    errorMessage?: string,
  ): void {
    const run = this.demoRuns.get(runId);
    if (!run) return;
    const projectedRuns = new Map(this.demoRuns);
    projectedRuns.delete(runId);
    try {
      const scrubbedMessage = this.scrubDiagnosticMessage(errorMessage);
      const event = this.persistProjectedEvent(
        {
          id: ulid() as Event['id'],
          workspaceId: this.workspaceId,
          runId,
          category: 'run',
          type: 'run.failed',
          occurredAt: new Date().toISOString(),
          payload: {
            threadId: run.threadId,
            failureClass,
            ...(scrubbedMessage ? { errorMessage: scrubbedMessage } : {}),
            modelId: run.modelId,
            providerModelId: run.providerModelId,
            packetId: run.packetId,
            adapterEventIndex: run.nextAdapterEventIndex,
            idempotencyKey: runId,
          },
        },
        projectedRuns,
      );
      this.demoRuns.delete(runId);
      this.publishEvent(event);
      this.handleDelegatedRunTerminal(runId, run, 'run.failed', {
        failureClass,
        errorMessage: scrubbedMessage,
      });
      this.recordRunDiagnostic(runId, run, {
        failureClass,
        errorMessage: scrubbedMessage,
        modelId: run.modelId,
        providerModelId: run.providerModelId,
      });
    } catch {
      console.warn('[runtime] demo Run failure could not be persisted');
    }
  }

  private persistDemoRunBlocked(runId: RunId, reason: string): void {
    const run = this.demoRuns.get(runId);
    if (!run) return;
    const projectedRuns = new Map(this.demoRuns);
    projectedRuns.delete(runId);
    try {
      const task = this.resolveTaskForThread(run.threadId);
      const event = this.persistProjectedEvent(
        {
          id: ulid() as Event['id'],
          workspaceId: task?.workspaceId ?? this.workspaceId,
          taskId: task?.id,
          runId,
          category: 'run',
          type: 'run.blocked',
          occurredAt: new Date().toISOString(),
          payload: {
            threadId: run.threadId,
            reason: this.scrubDiagnosticMessage(reason) ?? '任务执行位置尚未就绪',
            retryConsumed: false,
            modelId: run.modelId,
            providerModelId: run.providerModelId,
            packetId: run.packetId,
            idempotencyKey: runId,
          },
        },
        projectedRuns,
      );
      this.demoRuns.delete(runId);
      this.publishEvent(event);
      if (task?.parentTaskId && task.status !== 'blocked') {
        const blocked = this.workspaceStore?.setTaskStatus(task.id, 'blocked', task.version, {
          cascade: false,
        }).task;
        if (blocked) this.threadVersions.set(blocked.threadId, blocked.version);
        this.emitSubtaskEvent(
          'run',
          'subtask.blocked',
          {
            threadId: task.threadId,
            parentTaskId: task.parentTaskId,
            childTaskId: task.id,
            agentVersionId: run.agentVersionId,
            reason: this.scrubDiagnosticMessage(reason),
            retryConsumed: false,
            text: '子任务已暂停，调整访问范围后可在同一任务中继续。',
          },
          task.id,
          task.workspaceId,
          runId,
        );
      }
    } catch {
      console.warn('[runtime] demo Run block could not be persisted');
    }
  }

  private recordProviderDiagnostic(input: {
    category: string;
    failureClass: string;
    summary: string;
    detail?: Record<string, unknown>;
  }): void {
    if (!this.memoryStore) return;
    try {
      const rec = this.memoryStore.appendDiagnostic({
        workspaceId: this.workspaceId,
        category: input.category,
        failureClass: input.failureClass,
        summary: input.summary,
        detail: input.detail ?? {},
      });
      const event = this.appendEvent('system', 'diagnostics.appended', {
        diagnosticId: rec.id,
        failureClass: input.failureClass,
        summary: rec.summary,
        source: 'provider',
      });
      this.publishEvent(event);
    } catch {
      console.warn('[runtime] provider diagnostic append failed');
    }
  }

  private recordRunDiagnostic(
    runId: RunId,
    run: DemoRunState,
    payload: Record<string, unknown>,
  ): void {
    if (!this.memoryStore) return;
    try {
      const failureClass = String(payload.failureClass ?? 'unknown');
      const errorMessage =
        typeof payload.errorMessage === 'string' ? payload.errorMessage : undefined;
      const rec = this.memoryStore.appendDiagnostic({
        workspaceId: this.workspaceId,
        runId,
        category: 'provider',
        failureClass,
        summary: errorMessage
          ? `Run failed (${failureClass}): ${errorMessage}`
          : `Run failed (${failureClass})`,
        detail: {
          modelId: run.modelId,
          providerModelId: run.providerModelId,
          protocol: run.protocol,
          resolutionSource: run.resolutionSource,
          packetId: run.packetId,
          threadId: run.threadId,
          failureClass,
          ...(errorMessage ? { errorMessage } : {}),
        },
      });
      const event = this.appendEvent(
        'system',
        'diagnostics.appended',
        {
          diagnosticId: rec.id,
          runId,
          failureClass,
          summary: rec.summary,
        },
        undefined,
        runId,
      );
      this.publishEvent(event);
    } catch {
      console.warn('[runtime] diagnostic append failed');
    }
  }

  private maybeProposeRunMemory(
    runId: RunId,
    run: DemoRunState,
    payload: Record<string, unknown>,
  ): void {
    if (!this.memoryStore) return;
    const assistantText =
      typeof payload.assistantText === 'string' ? payload.assistantText : run.assistantText;
    const snippet = (assistantText || '').trim().replace(/\s+/g, ' ').slice(0, 240);
    if (snippet.length < 12) return;
    const effectiveTaskId = `task-from-thread:${run.threadId}` as TaskId;
    try {
      const change = this.memoryStore.proposeChange({
        workspaceId: this.workspaceId,
        taskId: effectiveTaskId,
        targetScope: 'task',
        additions: [
          {
            id: ulid(),
            key: `run-digest:${String(runId).slice(0, 10)}`,
            value: snippet,
            targetScope: 'task',
          },
        ],
        evidenceRefs: [run.packetId ?? String(runId), run.threadId].filter(Boolean) as string[],
        confidence: 0.55,
        proposedByRunId: runId,
        autoApprove: true,
      });
      const event = this.appendEvent(
        'memory',
        'memory.change.proposed',
        {
          changeId: change.id,
          taskId: change.taskId,
          targetScope: change.targetScope,
          approvalState: change.approvalState,
          additionKeys: change.additions.map((a) => a.key),
          autoApprove: true,
          runId,
        },
        undefined,
        runId,
      );
      this.publishEvent(event);
    } catch {
      console.warn('[runtime] memory propose after run failed');
    }
  }

  private resumeDemoRuns(): void {
    if (!this.canStartModelRun()) return;
    for (const run of this.demoRuns.values()) this.scheduleDemoRunExecution(run.runId);
  }

  private scrubDiagnosticMessage(message: string | undefined): string | undefined {
    if (!message) return undefined;
    let out = message;
    out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
    out = out.replace(/Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, 'Bearer [REDACTED]');
    out = out.replace(/plaintext-secret/gi, '[REDACTED]');
    out = out.replace(/api[_-]?key["'\s:=]+[A-Za-z0-9._\-]{8,}/gi, 'api_key=[REDACTED]');
    if (out.length > 240) out = out.slice(0, 240);
    return out;
  }

  private completeMcpActionWithAudit(
    fence: {
      runId: RunId;
      stepId: StepId;
      agentVersionId: AgentVersionId;
      ownerId: string;
      executionAttempt: number;
      actionDigest: string;
    },
    payload: Record<string, unknown>,
    scope: ValidatedOrchestrationMcpScope,
    signal: AbortSignal,
  ): Event {
    if (!this.productionExecutionStore || !this.unitOfWork || !this.stateStore) {
      throw new Error('scheduler.step_action_unavailable');
    }
    const draft = this.createOrchestrationMcpAuditDraft(
      'mcp.tool_called',
      payload,
      scope,
      fence.actionDigest,
    );
    const event = this.unitOfWork.run(() => {
      if (signal.aborted) throw new Error('mcp.action_cancelled');
      this.productionExecutionStore!.completeMcpAction(fence);
      if (signal.aborted) throw new Error('mcp.action_cancelled');
      const committed = this.stateStore!.commitTransition({ events: [draft] });
      const committedEvent = committed.events[0];
      if (!committedEvent) throw new Error('The event store returned an empty transition');
      return committedEvent;
    });
    this.rememberCommittedEvent(event);
    return event;
  }

  private createOrchestrationMcpAuditDraft(
    type: 'mcp.tool_called' | 'mcp.tool_refused' | 'mcp.tool_requested',
    payload: Record<string, unknown>,
    scope: ValidatedOrchestrationMcpScope,
    actionDigest: string,
  ): EventDraft {
    if (!/^[a-f0-9]{64}$/.test(actionDigest)) {
      throw new Error('approval.action_digest_invalid');
    }
    return {
      id: ulid() as Event['id'],
      workspaceId: scope.workspaceId,
      taskId: scope.taskId,
      runId: scope.runId,
      stepId: scope.stepId,
      category: 'provider',
      type,
      occurredAt: new Date().toISOString(),
      payload: {
        ...payload,
        workspaceId: scope.workspaceId,
        taskId: scope.taskId,
        runId: scope.runId,
        stepId: scope.stepId,
        agentVersionId: scope.agentVersionId,
        actionDigest,
      },
    };
  }

  private rememberCommittedEvent(event: Event): void {
    this.events.push(event);
    this.eventSequence = Math.max(this.eventSequence, event.sequence);
  }

  private appendOrchestrationMcpAudit(
    type: 'mcp.tool_called' | 'mcp.tool_refused' | 'mcp.tool_requested',
    payload: Record<string, unknown>,
    scope: ValidatedOrchestrationMcpScope,
    actionDigest: string,
  ): Event {
    const draft = this.createOrchestrationMcpAuditDraft(type, payload, scope, actionDigest);
    if (this.stateStore) {
      const committed = this.stateStore.commitTransition({ events: [draft] });
      const event = committed.events[0];
      if (!event) throw new Error('The event store returned an empty transition');
      this.rememberCommittedEvent(event);
      return event;
    }
    const event: Event = { ...draft, sequence: ++this.eventSequence };
    this.events.push(event);
    return event;
  }

  private appendEvent(
    category: EventCategory,
    type: string,
    payload: Record<string, unknown>,
    messageId?: MessageId,
    runId?: RunId,
    taskId?: TaskId,
    workspaceId: WorkspaceId = this.workspaceId,
  ): Event {
    const draft: EventDraft = {
      id: ulid() as Event['id'],
      workspaceId,
      taskId,
      messageId,
      runId,
      category,
      type,
      occurredAt: new Date().toISOString(),
      payload,
    };
    if (this.stateStore) {
      const committed = this.stateStore.commitTransition({ events: [draft] });
      const event = committed.events[0];
      if (!event) throw new Error('The event store returned an empty transition');
      this.events.push(event);
      this.eventSequence = Math.max(this.eventSequence, event.sequence);
      return event;
    }

    const event: Event = {
      ...draft,
      sequence: ++this.eventSequence,
    };
    this.events.push(event);
    return event;
  }

  private commandCallerSurface(frame: Frame): import('@sync-think/protocol').CommandCallerSurface {
    const surface = frame.meta?.callerSurface;
    return surface === 'agent' || surface === 'mcp' || surface === 'cli' ? surface : 'desktop';
  }

  private handleConfigurationConfirmation(socket: Socket, frame: Frame): boolean {
    if (!this.configurationCommandPayloadIsValid(frame)) return false;
    const callerSurface = this.commandCallerSurface(frame);
    const decision = this.configurationConfirmationGate.evaluate({
      command: frame.type as CommandType,
      callerSurface,
      payload: frame.payload,
      ...(frame.meta?.confirmationToken ? { confirmationToken: frame.meta.confirmationToken } : {}),
    });
    if (decision.kind === 'execute' && !decision.confirmed) return false;
    if (decision.kind === 'execute') {
      const event = this.appendEvent('system', 'application.command_confirmed', {
        requestId: frame.id,
        command: frame.type,
        callerSurface,
        payloadDigest: decision.payloadDigest,
        confirmationTokenHash: decision.tokenHash,
      });
      this.publishEvent(event);
      return false;
    }
    if (decision.kind === 'preview') {
      const event = this.appendEvent('system', 'application.command_confirmation_requested', {
        requestId: frame.id,
        command: frame.type,
        callerSurface,
        payloadDigest: decision.preview.payloadDigest,
        confirmationTokenHash: decision.tokenHash,
        expiresAt: decision.preview.expiresAt,
      });
      this.publishEvent(event);
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: { ...decision.preview, auditEventId: String(event.id) },
        }),
      );
      return true;
    }

    const event = this.appendEvent('system', 'application.command_confirmation_rejected', {
      requestId: frame.id,
      command: frame.type,
      callerSurface,
      reason: decision.reason,
    });
    this.publishEvent(event);
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.APPROVAL_REQUIRED,
          message:
            'Configuration confirmation is missing, expired, or does not match this command.',
          detail: { reason: decision.reason, auditEventId: String(event.id) },
        },
      }),
    );
    return true;
  }

  private configurationCommandPayloadIsValid(frame: Frame): boolean {
    switch (frame.type) {
      case 'workspace.create':
        return Boolean(parseCreateWorkspacePayload(frame.payload));
      case 'workspace.bindFolder':
        return Boolean(parseBindWorkspaceFolderPayload(frame.payload));
      case 'provider.create':
        return Boolean(parseCreateProviderPayload(frame.payload));
      case 'provider.update':
        return Boolean(parseUpdateProviderPayload(frame.payload));
      case 'provider.addModels':
        return Boolean(parseAddModelsPayload(frame.payload));
      case 'provider.confirmCapabilities':
        return Boolean(parseConfirmCapabilitiesPayload(frame.payload));
      case 'provider.importCcSwitch':
        return Boolean(parseImportCcSwitchPayload(frame.payload));
      case 'agent.updateBinding':
        return Boolean(parseUpdateAgentBindingPayload(frame.payload));
      case 'agent.create':
        return Boolean(parseCreateAgentPayload(frame.payload));
      case 'agent.createVersion':
        return Boolean(parseCreateAgentVersionPayload(frame.payload));
      case 'group.create':
        return Boolean(parseCreateGroupPayload(frame.payload));
      case 'group.update':
        return Boolean(parseUpdateGroupPayload(frame.payload));
      case 'group.member.add':
        return Boolean(parseAddGroupMemberPayload(frame.payload));
      case 'group.member.remove':
        return Boolean(parseRemoveGroupMemberPayload(frame.payload));
      case 'group.member.updateResponsibility':
        return Boolean(parseUpdateGroupMemberResponsibilityPayload(frame.payload));
      case 'group.setLead':
        return Boolean(parseSetGroupLeadPayload(frame.payload));
      case 'skill.import':
        return Boolean(parseImportSkillPayload(frame.payload));
      case 'mcp.register':
        return Boolean(parseRegisterMcpServerPayload(frame.payload));
      case 'policy.save':
        return Boolean(parseSavePolicyPayload(frame.payload));
      case 'automation.create':
        return Boolean(parseCreateAutomationPayload(frame.payload));
      case 'automation.update':
        return Boolean(parseUpdateAutomationPayload(frame.payload));
      case 'automation.delete':
        return Boolean(parseDeleteAutomationPayload(frame.payload));
      default:
        return false;
    }
  }

  private publishEvent(event: Event): void {
    for (const [streamId, sub] of this.subscriptions) {
      if (sub.socket.destroyed || sub.phase === 'catching-up' || event.sequence <= sub.liveCursor) {
        continue;
      }
      sub.liveCursor = event.sequence;
      if (!this.subscriptionMatches(sub, event)) continue;
      this.writeLiveEvent(sub.socket, streamId, event);
    }
  }

  private subscriptionMatches(subscription: RuntimeEventSubscription, event: Event): boolean {
    return !subscription.categories || subscription.categories.has(event.category);
  }

  private writeLiveEvent(socket: Socket, streamId: string, event: Event): void {
    socket.write(
      encodeFrame({
        id: streamId,
        kind: 'event',
        type: 'runtime.event',
        payload: { streamId, event },
      }),
    );
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createPipeServer(this.handlers, this.installId);
      const path = pipePathPortable(this.installId);
      this.server.listen(path, () => {
        this.handlers.onReady(path);
        this.resumeDemoRuns();
        this.scheduleReadyDelegatedSubtasks();
        if (this.scheduler) {
          const groupRunIds = collectGroupCollaborationRunIds(this.events);
          const recovery = this.scheduler
            .recoverAll()
            .then(() => {
              this.syncOrchestrationEvents();
              for (const runId of groupRunIds) this.projectGroupRunConversation(runId);
            })
            .catch(() => console.warn('[runtime] orchestration recovery failed'));
          this.trackBackgroundTask(recovery);
        }
        const automationReady = this.automationService
          ?.start()
          .catch(() => console.warn('[runtime] automation service failed to start'));
        if (automationReady) {
          this.trackBackgroundTask(automationReady);
          void automationReady.finally(resolve);
        } else {
          resolve();
        }
      });
      this.server.on('error', (e) => reject(e));
    });
  }

  async stop(): Promise<void> {
    for (const controller of this.demoRunAbortControllers.values()) controller.abort();
    await this.automationService?.stop();
    await closePlaywrightBrowserWorkers();
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      const server = this.server;
      this.server = null;
      this.subscriptions.clear();
      server.destroyConnections();
      server.close(() => resolve());
    });
    await this.scheduler?.shutdown();
    await Promise.allSettled([...this.backgroundTasks]);
  }
}

async function* abortableAdapterEvents(
  source: AsyncIterable<import('@sync-think/adapters').AdapterEvent>,
  signal: AbortSignal,
): AsyncIterable<import('@sync-think/adapters').AdapterEvent> {
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await nextAdapterEventOrAbort(iterator, signal);
      if (next.done) return;
      yield next.value;
    }
  } finally {
    if (iterator.return) {
      const closing = Promise.resolve(iterator.return());
      if (signal.aborted) void closing.catch(() => undefined);
      else await closing;
    }
  }
}

function nextAdapterEventOrAbort(
  iterator: AsyncIterator<import('@sync-think/adapters').AdapterEvent>,
  signal: AbortSignal,
): Promise<IteratorResult<import('@sync-think/adapters').AdapterEvent>> {
  if (signal.aborted) return Promise.reject(adapterAbortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(adapterAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(iterator.next()).then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function adapterAbortError(): Error {
  const error = new Error('Provider stream was cancelled');
  error.name = 'AbortError';
  return error;
}

function toTaskSummary(
  task: TaskRecord,
  execution?: import('@sync-think/shared').TaskExecutionContext,
): TaskSummary {
  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
    parentTaskId: task.parentTaskId,
    title: task.title,
    goal: task.goal,
    status: task.status,
    participationMode: task.participationMode,
    executionMode: task.executionMode,
    taskVersion: task.version,
    threadId: task.threadId,
    lastOpenedAt: task.lastOpenedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(execution
      ? {
          execution: {
            mode: execution.mode,
            state: execution.state,
            executionPath: execution.executionPath,
            baseRef: execution.baseRef,
            headRef: execution.headRef,
            browserIdentityId: execution.browserIdentityId,
            blockedReason: execution.blockedReason,
            cleanupAfter: execution.cleanupAfter,
          },
        }
      : {}),
  };
}

function toArtifactVersionSummary(version: ArtifactVersion): ArtifactVersionSummary {
  return {
    id: version.id,
    artifactId: version.artifactId,
    contentHash: version.contentHash,
    mimeType: version.mimeType,
    sourceStepId: version.sourceStepId,
    status: version.status,
    version: version.version,
    parentVersionIds: [...version.parentVersionIds],
    createdAt: version.createdAt,
    hasInlineContent: version.content !== undefined,
    hasContentRef: version.contentRef !== undefined,
  };
}

function toPolicyVersionSummary(policy: PolicyVersionRecord): PolicyVersionSummary {
  return {
    id: policy.id,
    policyId: policy.policyId,
    version: policy.version,
    scopeType: policy.scopeType,
    scopeId: policy.scopeId,
    approvalMode: policy.approvalMode,
    rules: policy.rules.map((rule) => ({ ...rule })),
    createdAt: policy.createdAt,
  };
}
