// Runtime - long-lived Agent Runtime process entry. UI lifecycle independent:
// killing the UI must not terminate active Runs (design 锟?6 / 锟?).

import {
  pipePathPortable,
  encodeFrame,
  HEADER_BYTES,
  MAX_FRAME_BYTES,
  type AppendMessageResponse,
  type BindWorkspaceFolderResponse,
  type ArchiveTaskResponse,
  type CreateTaskResponse,
  type CreateWorkspaceResponse,
  type UpdateWorkspaceResponse,
  type DeleteWorkspaceResponse,
  type EventReplayPagePayload,
  type EventStreamStartedPayload,
  type Frame,
  type ListTasksResponse,
  type ListWorkspacesResponse,
  type OpenTaskResponse,
  type SearchTasksResponse,
  type SetParticipationModeResponse,
  type UnarchiveTaskResponse,
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
  type ReorderProvidersResponse,
  type AddProviderCredentialResponse,
  type RemoveProviderCredentialResponse,
  type RevealProviderCredentialResponse,
  type UpdateProviderCredentialResponse,
  type SetModelPrioritiesResponse,
  type UpdateModelResponse,
  type RemoveModelResponse,
  type GetSettingsResponse,
  type SetSettingResponse,
  type UsageSummaryResponse,
  type UsageSummaryRow,
  type ModelPricingEntry,
  DEFAULT_MODEL_PRICING,
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
  type ImportSkillResponse,
  type SkillPermissionDiffSummary,
  type ListSkillsResponse,
  type DeleteSkillResponse,
  type GetSkillResponse,
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
  type ListGlobalAgentsResponse,
  type GlobalAgentResponse,
  type ListTeamsResponse,
  type TeamResponse,
  type TeamRunResponse,
  type ListConversationsResponse,
  type ConversationResponse,
  type RebindConversationTargetPayload,
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
  type ArtifactVersion,
  type ArtifactVersionSummary,
  type AcceptanceGateId,
  type TeamId,
  type GlobalAgent,
  type Team,
  type TeamRun,
  type Conversation,
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
  type TaskRecord,
  type SqliteProviderStore,
  type ProviderCatalogEntry,
  type ModelRecord,
  type SqliteAppSettingStore,
  type SqliteAgentStore,
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
  type SqliteGlobalAgentStore,
  type SqliteTeamStore,
  type SqliteConversationStore,
  type GlobalAgentRecord,
  type TeamRecord,
  type TeamRunRecord,
  type ConversationRecord,
  type PolicyVersionRecord,
  type SkillVersionRecord,
  type MemoryChangeRecord,
  type DurableMemoryEntry,
  type DiagnosticRecord,
  DEFAULT_CONVERSATION_AGENT_ID,
  toModelBinding,
  defaultCcSwitchDbPath,
  loadCcSwitchProviderRows,
  workspaceIconFromPrefs,
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
  resolveProviderPriorityFallback,
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
  compareTextSnapshots,
  mergeTextSnapshots,
} from '@sync-think/core';
import { createHash } from 'node:crypto';
// cc-switch import helpers re-exported via core
import type { Socket } from 'node:net';
import {
  applyDemoRunEvent,
  createDemoProviderRequest,
  createDemoRun,
  parseDemoRuns,
  projectAdapterEvent,
  serializeDemoRuns,
  type DemoProvider,
  type DemoRunState,
} from './demo-run.js';
import {
  buildChatMessagesFromEvents,
  buildCompactSummaryUserPrompt,
  buildLocalCompactSummary,
  BROWSER_COMMAND_RESULT_MAX_CHARS,
  BROWSER_COMMAND_TIMEOUT_MS,
  CHAT_AGENT_TOOL_NAMES,
  CHAT_BROWSER_COMMAND_TOOL_NAMES,
  CHAT_BROWSER_TOOL_NAMES,
  CHAT_PLAN_TOOL_NAMES,
  CHAT_SKILL_TOOL_NAMES,
  CHAT_TEAM_TOOL_NAMES,
  chatToolDeniedMessage,
  chatToolRequiresApproval,
  collectThreadChatHistory,
  COMPACT_KEEP_RECENT_MESSAGES,
  COMPACT_SUMMARY_SYSTEM_PROMPT,
  estimateCompactAfterTokens,
  buildForceFinalToolLoopMessage,
  evaluateToolLoopGuard,
  mcpToolsToProviderSchemas,
  parseMcpProviderToolName,
  executeChatBuiltInTool,
  executeChatBrowserTool,
  executeChatPlanTool,
  foldLongToolOutputsInMessages,
  foldToolOutputText,
  isChatToolAllowed,
  isMeaningfulCompactReduction,
  normalizeChatExecutionMode,
  splitHistoryForCompact,
  summarizeToolCallForApproval,
  toolsForExecutionMode,
  validateChatBrowserCommand,
  wrapModelCompactSummary,
} from './chat-tools.js';
import { resolveAppendMessageImageDataUrl } from './chat-image-staging.js';
import {
  parseAppendMessagePayload,
  parseBindWorkspaceFolderPayload,
  parseCancelRunPayload,
  parseContinueEventReplayPayload,
  parseArchiveTaskPayload,
  parseCreateTaskPayload,
  parseCreateWorkspacePayload,
  parseUpdateWorkspacePayload,
  parseDeleteWorkspacePayload,
  parseListTasksPayload,
  parseListWorkspacesPayload,
  parseOpenTaskPayload,
  parseSearchTasksPayload,
  parseSetParticipationModePayload,
  parseUnarchiveTaskPayload,
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
  parseReorderProvidersPayload,
  parseAddProviderCredentialPayload,
  parseRemoveProviderCredentialPayload,
  parseRevealProviderCredentialPayload,
  parseUpdateProviderCredentialPayload,
  parseSetModelPrioritiesPayload,
  parseUpdateModelPayload,
  parseRemoveModelPayload,
  parseGetSettingsPayload,
  parseSetSettingPayload,
  parseUsageSummaryPayload,
  parseGetAgentPayload,
  parseUpdateAgentBindingPayload,
  parseListAgentsPayload,
  parseCreateAgentPayload,
  parseListAgentVersionsPayload,
  parseCreateAgentVersionPayload,
  parseImportSkillPayload,
  parseListSkillsPayload,
  parseDeleteSkillPayload,
  parseGetSkillPayload,
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
  parseListGlobalAgentsPayload,
  parseCreateGlobalAgentPayload,
  parseUpdateGlobalAgentPayload,
  parseDeleteGlobalAgentPayload,
  parseListTeamsPayload,
  parseCreateTeamPayload,
  parseUpdateTeamPayload,
  parseDeleteTeamPayload,
  parseStartTeamRunPayload,
  parseSetTeamRunStatusPayload,
  parseListConversationsPayload,
  parseCreateConversationPayload,
  parseRenameConversationPayload,
  parseSetConversationPinnedPayload,
  parseSetConversationArchivedPayload,
  parseSetConversationExecutionModePayload,
  parseUpgradeConversationTrackPayload,
  parseDeleteConversationPayload,
  parseConversationCompactPayload,
  parseConversationDecideToolApprovalPayload,
  parseConversationSubmitBrowserResultPayload,
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
} from '@sync-think/workers';

export interface RuntimeOptions {
  installId: string;
  helloSecret?: string;
  allowNoToken?: boolean;
  checkpoint?: RuntimeCheckpointSnapshot;
  stateStore?: RuntimeStateStore;
  workspaceStore?: SqliteWorkspaceStore;
  workspaceId?: WorkspaceId;
  checkpointRunId?: RunId;
  demoProvider?: DemoProvider;
  providerStore?: SqliteProviderStore;
  agentStore?: SqliteAgentStore;
  globalAgentStore?: SqliteGlobalAgentStore;
  teamStore?: SqliteTeamStore;
  conversationStore?: SqliteConversationStore;
  memoryStore?: SqliteMemoryStore;
  approvalStore?: SqliteApprovalStore;
  policyStore?: SqlitePolicyStore;
  authorizationStore?: SqliteAuthorizationStore;
  orchestrationStore?: SqliteOrchestrationStore;
  artifactStore?: SqliteArtifactStore;
  productionExecutionStore?: SqliteProductionExecutionStore;
  unitOfWork?: SqliteUnitOfWork;
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
  /** 0026: app-level KV settings (vision fallback, plan & act). */
  appSettingStore?: SqliteAppSettingStore;
  /** 0026+: usage rows, request log, and tool aggregates from durable runtime events. */
  queryUsageSummary?: (sinceIso?: string) => {
    rows: Array<{
      modelId: string;
      providerId?: string;
      requests: number;
      succeededRequests: number;
      failedRequests: number;
      tokensIn: number;
      tokensOut: number;
      averageLatencyMs?: number;
      lastUsedAt?: string;
    }>;
    requests: Array<{
      requestId: string;
      runId?: string;
      occurredAt: string;
      modelId: string;
      providerId?: string;
      tokensIn: number;
      tokensOut: number;
      cachedTokensHit?: number;
      cachedTokensCreated?: number;
      status: 'success' | 'failed' | 'unknown';
      latencyMs?: number;
      errorMessage?: string;
    }>;
    tools: Array<{
      toolName: string;
      calls: number;
      successes: number;
      failures: number;
      successRate: number;
      lastUsedAt?: string;
    }>;
    toolModels: Array<{
      modelId: string;
      providerId?: string;
      calls: number;
      successes: number;
      failures: number;
      successRate: number;
    }>;
    toolFailures: Array<{
      occurredAt: string;
      toolName: string;
      modelId?: string;
      conversationTitle?: string;
      errorSummary: string;
    }>;
  };
}

const MODEL_PRICING_SETTING_KEY = 'model-pricing';

// conversation.rebindTarget payload — validated inline (same strict style as
// command-validation.ts parsers): exact keys, bounded non-empty strings,
// track limited to the three conversation tracks.
const CONVERSATION_REBIND_TRACKS = new Set(['model', 'agent', 'team']);

function parseRebindConversationTargetPayload(
  value: unknown,
): RebindConversationTargetPayload | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const allowed = new Set(['conversationId', 'track', 'targetRef']);
  if (!Object.keys(record).every((key) => allowed.has(key))) return undefined;
  const bounded = (input: unknown, max: number): input is string =>
    typeof input === 'string' && input.trim().length > 0 && input.length <= max;
  if (
    !bounded(record.conversationId, 128) ||
    !CONVERSATION_REBIND_TRACKS.has(String(record.track)) ||
    !bounded(record.targetRef, 256)
  ) {
    return undefined;
  }
  return {
    conversationId: record.conversationId as RebindConversationTargetPayload['conversationId'],
    track: record.track as RebindConversationTargetPayload['track'],
    targetRef: record.targetRef,
  };
}

function parseModelPricingEntries(value: unknown): ModelPricingEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const numbers = [
      row.inputPerMillion,
      row.outputPerMillion,
      row.cacheReadPerMillion,
      row.cacheWritePerMillion,
    ];
    if (
      typeof row.modelId !== 'string' ||
      !row.modelId.trim() ||
      typeof row.displayName !== 'string' ||
      !row.displayName.trim() ||
      (row.currency !== 'USD' && row.currency !== 'CNY') ||
      numbers.some((number) => typeof number !== 'number' || !Number.isFinite(number) || number < 0)
    ) {
      return [];
    }
    return [
      {
        modelId: row.modelId.trim(),
        displayName: row.displayName.trim(),
        currency: row.currency,
        inputPerMillion: row.inputPerMillion as number,
        outputPerMillion: row.outputPerMillion as number,
        cacheReadPerMillion: row.cacheReadPerMillion as number,
        cacheWritePerMillion: row.cacheWritePerMillion as number,
      },
    ];
  });
}

function estimateUsageCost(
  usage: {
    tokensIn: number;
    tokensOut: number;
    cachedTokensHit?: number;
    cachedTokensCreated?: number;
  },
  pricing: ModelPricingEntry,
): number {
  const cacheRead = Math.max(0, usage.cachedTokensHit ?? 0);
  const cacheWrite = Math.max(0, usage.cachedTokensCreated ?? 0);
  const uncachedInput = Math.max(0, usage.tokensIn - cacheRead - cacheWrite);
  return (
    (uncachedInput * pricing.inputPerMillion +
      usage.tokensOut * pricing.outputPerMillion +
      cacheRead * pricing.cacheReadPerMillion +
      cacheWrite * pricing.cacheWritePerMillion) /
    1_000_000
  );
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

const MAX_REPLAY_EVENTS_PER_PAGE = 64;
const MAX_REPLAY_SCANNED_EVENTS_PER_PAGE = 256;
const REPLAY_FRAME_RESERVE_BYTES = 1_024;

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
  private readonly workspaceId: WorkspaceId;
  private readonly checkpointRunId: RunId;
  private readonly demoProvider?: DemoProvider;
  private readonly providerStore?: SqliteProviderStore;
  private readonly appSettingStore?: SqliteAppSettingStore;
  private readonly queryUsageSummary?: RuntimeOptions['queryUsageSummary'];
  private readonly agentStore?: SqliteAgentStore;
  private readonly globalAgentStore?: SqliteGlobalAgentStore;
  private readonly teamStore?: SqliteTeamStore;
  private readonly conversationStore?: SqliteConversationStore;
  private readonly memoryStore?: SqliteMemoryStore;
  private readonly approvalStore?: SqliteApprovalStore;
  private readonly policyStore?: SqlitePolicyStore;
  private readonly authorizationStore?: SqliteAuthorizationStore;
  private readonly orchestrationStore?: SqliteOrchestrationStore;
  private readonly artifactStore?: SqliteArtifactStore;
  private readonly productionExecutionStore?: SqliteProductionExecutionStore;
  private readonly unitOfWork?: SqliteUnitOfWork;
  private readonly scheduler?: Scheduler;
  private readonly skillStore?: SqliteSkillStore;
  private readonly mcpStore?: SqliteMcpStore;
  private readonly secureStore?: SecureStore;
  private readonly hasApprovedPlan?: (taskId: TaskId) => boolean;
  private readonly discoveryByProtocol: Partial<Record<ProtocolFamily, DemoProvider>>;
  private readonly discoveryAdapter?: DemoProvider;
  private readonly demoRuns = new Map<string, DemoRunState>();
  /** Abort controllers for in-flight demo chat streams (Stop button). */
  private readonly demoRunAborts = new Map<string, AbortController>();
  /**
   * Chat tool approvals under「询问批准」:
   * mutating tools pause here until conversation.decideToolApproval.
   */
  private readonly pendingToolApprovals = new Map<
    string,
    {
      approvalId: string;
      runId: RunId;
      threadId: string;
      workspaceRoot: string;
      executionMode: string;
      chatMessages: import('@sync-think/adapters').ProviderMessage[];
      pendingToolCalls: import('@sync-think/adapters').ProviderToolCall[];
      /** Index of the tool currently waiting for approval. */
      currentIndex: number;
      /** Results for tools already executed in this round. */
      completedResults: Array<{ toolCallId: string; content: string }>;
      toolLoopRound: number;
      resolve: (decision: 'approve' | 'deny') => void;
      createdAt: string;
    }
  >();
  /**
   * Interactive browser commands (browser_click / type / read / screenshot):
   * the tool loop emits browser.command_requested and waits here until the
   * desktop renderer replies via conversation.submitBrowserResult (or timeout).
   */
  private readonly pendingBrowserCommands = new Map<
    string,
    {
      requestId: string;
      runId: RunId;
      threadId: string;
      toolName: string;
      resolve: (result: { ok: boolean; resultJson?: string; error?: string }) => void;
      createdAt: string;
    }
  >();
  private readonly backgroundTasks = new Set<Promise<void>>();
  /** Thread-scoped Manifest amendments (force-exclude source ids). In-memory for M1. */
  private readonly threadContextAmendments = new Map<string, { excludeSourceIds: string[] }>();
  private eventSequence = 0;

  constructor(opts: RuntimeOptions) {
    this.installId = opts.installId;
    this.stateStore = opts.stateStore;
    this.workspaceStore = opts.workspaceStore;
    this.workspaceId = opts.workspaceId ?? ('workspace-dev' as WorkspaceId);
    this.checkpointRunId = opts.checkpointRunId ?? (`runtime-${opts.installId}` as RunId);
    this.demoProvider = opts.demoProvider;
    this.providerStore = opts.providerStore;
    this.appSettingStore = opts.appSettingStore;
    this.queryUsageSummary = opts.queryUsageSummary;
    this.agentStore = opts.agentStore;
    this.globalAgentStore = opts.globalAgentStore;
    this.teamStore = opts.teamStore;
    this.conversationStore = opts.conversationStore;
    this.memoryStore = opts.memoryStore;
    this.approvalStore = opts.approvalStore;
    this.policyStore = opts.policyStore;
    this.authorizationStore = opts.authorizationStore;
    this.orchestrationStore = opts.orchestrationStore;
    this.artifactStore = opts.artifactStore;
    this.productionExecutionStore = opts.productionExecutionStore;
    this.unitOfWork = opts.unitOfWork;
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
    if (opts.checkpoint) {
      this.restoreCheckpoint(opts.checkpoint);
    } else if (this.stateStore) {
      this.restorePersistedState();
    }
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
        if (frame.type === 'workspace.create') {
          this.handleCreateWorkspace(socket, frame);
          return;
        }
        if (frame.type === 'workspace.bindFolder') {
          this.handleBindWorkspaceFolder(socket, frame);
          return;
        }
        if (frame.type === 'workspace.list') {
          this.handleListWorkspaces(socket, frame);
          return;
        }
        if (frame.type === 'workspace.update') {
          this.handleUpdateWorkspace(socket, frame);
          return;
        }
        if (frame.type === 'workspace.delete') {
          this.handleDeleteWorkspace(socket, frame);
          return;
        }
        if (frame.type === 'task.create') {
          this.handleCreateTask(socket, frame);
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
        if (frame.type === 'task.archive') {
          this.handleArchiveTask(socket, frame);
          return;
        }
        if (frame.type === 'task.unarchive') {
          this.handleUnarchiveTask(socket, frame);
          return;
        }
        if (frame.type === 'task.appendMessage') {
          this.handleAppendMessage(socket, frame);
          return;
        }
        if (frame.type === 'message.attachImages') {
          this.handleAttachMessageImages(socket, frame);
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
        if (frame.type === 'provider.reorder') {
          this.handleReorderProviders(socket, frame);
          return;
        }
        if (frame.type === 'provider.addCredential') {
          void this.handleAddProviderCredential(socket, frame);
          return;
        }
        if (frame.type === 'provider.removeCredential') {
          void this.handleRemoveProviderCredential(socket, frame);
          return;
        }
        if (frame.type === 'provider.revealCredential') {
          void this.handleRevealProviderCredential(socket, frame);
          return;
        }
        if (frame.type === 'provider.updateCredential') {
          void this.handleUpdateProviderCredential(socket, frame);
          return;
        }
        if (frame.type === 'provider.setModelPriorities') {
          this.handleSetModelPriorities(socket, frame);
          return;
        }
        if (frame.type === 'provider.updateModel') {
          this.handleUpdateModel(socket, frame);
          return;
        }
        if (frame.type === 'provider.removeModel') {
          this.handleRemoveModel(socket, frame);
          return;
        }
        if (frame.type === 'settings.get') {
          this.handleGetSettings(socket, frame);
          return;
        }
        if (frame.type === 'settings.set') {
          this.handleSetSetting(socket, frame);
          return;
        }
        if (frame.type === 'usage.summary') {
          this.handleUsageSummary(socket, frame);
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
        if (frame.type === 'globalAgent.list') {
          this.handleListGlobalAgents(socket, frame);
          return;
        }
        if (frame.type === 'globalAgent.create') {
          this.handleCreateGlobalAgent(socket, frame);
          return;
        }
        if (frame.type === 'globalAgent.update') {
          this.handleUpdateGlobalAgent(socket, frame);
          return;
        }
        if (frame.type === 'globalAgent.delete') {
          this.handleDeleteGlobalAgent(socket, frame);
          return;
        }
        if (frame.type === 'team.list') {
          this.handleListTeams(socket, frame);
          return;
        }
        if (frame.type === 'team.create') {
          this.handleCreateTeam(socket, frame);
          return;
        }
        if (frame.type === 'team.update') {
          this.handleUpdateTeam(socket, frame);
          return;
        }
        if (frame.type === 'team.delete') {
          this.handleDeleteTeam(socket, frame);
          return;
        }
        if (frame.type === 'team.startRun') {
          this.handleStartTeamRun(socket, frame);
          return;
        }
        if (frame.type === 'team.setRunStatus') {
          this.handleSetTeamRunStatus(socket, frame);
          return;
        }
        if (frame.type === 'conversation.list') {
          this.handleListConversations(socket, frame);
          return;
        }
        if (frame.type === 'conversation.create') {
          this.handleCreateConversation(socket, frame);
          return;
        }
        if (frame.type === 'conversation.rename') {
          this.handleRenameConversation(socket, frame);
          return;
        }
        if (frame.type === 'conversation.setPinned') {
          this.handleSetConversationPinned(socket, frame);
          return;
        }
        if (frame.type === 'conversation.setArchived') {
          this.handleSetConversationArchived(socket, frame);
          return;
        }
        if (frame.type === 'conversation.setExecutionMode') {
          this.handleSetConversationExecutionMode(socket, frame);
          return;
        }
        if (frame.type === 'conversation.upgradeTrack') {
          this.handleUpgradeConversationTrack(socket, frame);
          return;
        }
        if (frame.type === 'conversation.rebindTarget') {
          this.handleRebindConversationTarget(socket, frame);
          return;
        }
        if (frame.type === 'conversation.delete') {
          this.handleDeleteConversation(socket, frame);
          return;
        }
        if (frame.type === 'conversation.sendMessage') {
          void this.handleConversationSendMessage(socket, frame);
          return;
        }
        if (frame.type === 'conversation.compact') {
          void this.handleConversationCompact(socket, frame);
          return;
        }
        if (frame.type === 'conversation.decideToolApproval') {
          this.handleConversationDecideToolApproval(socket, frame);
          return;
        }
        if (frame.type === 'conversation.submitBrowserResult') {
          this.handleConversationSubmitBrowserResult(socket, frame);
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
        if (frame.type === 'skill.get') {
          this.handleGetSkill(socket, frame);
          return;
        }
        if (frame.type === 'skill.delete') {
          this.handleDeleteSkill(socket, frame);
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
      onServerError: (err) => console.warn('[runtime] pipe error', err.message),
    };
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
      workspaces: this.workspaceStore.listWorkspaces().map((workspace) =>
        this.toWorkspaceSummary(workspace),
      ),
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

  private handleUpdateWorkspace(socket: Socket, frame: Frame): void {
    const payload = parseUpdateWorkspacePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const updated = this.workspaceStore.updateWorkspace({
        workspaceId: payload.workspaceId,
        name: payload.name,
        folderPath: payload.folderPath,
        icon: payload.icon,
        allowedRoots: undefined,
      });
      const response: UpdateWorkspaceResponse = {
        workspace: this.toWorkspaceSummary(updated),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'workspace.update',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeWorkspaceCommandError(socket, frame, error);
    }
  }

  private handleDeleteWorkspace(socket: Socket, frame: Frame): void {
    const payload = parseDeleteWorkspacePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.workspaceStore) {
      this.writeWorkspaceStoreUnavailable(socket, frame);
      return;
    }
    try {
      const deleted = this.workspaceStore.deleteWorkspace(payload.workspaceId);
      const response: DeleteWorkspaceResponse = {
        workspaceId: payload.workspaceId,
        deleted,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'workspace.delete',
          payload: response,
        }),
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
      const created = this.workspaceStore.createTask({
        workspaceId: payload.workspaceId,
        title: payload.title,
        goal: payload.goal,
        parentTaskId: payload.parentTaskId,
        acceptanceCriteria: payload.acceptanceCriteria,
      });
      this.threadVersions.set(created.threadId, created.taskVersion);
      const response: CreateTaskResponse = {
        taskId: created.taskId,
        threadId: created.threadId,
        taskVersion: created.taskVersion,
        participationMode: created.participationMode,
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
        .map((task) => toTaskSummary(task)),
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
        task: toTaskSummary(opened),
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
        .map((task) => toTaskSummary(task)),
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
        task: toTaskSummary(result.updated),
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
      this.threadVersions.set(result.task.threadId, result.task.version);
      const response: ArchiveTaskResponse = {
        task: toTaskSummary(result.task),
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
        task: toTaskSummary(result.task),
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
        enabled: payload.enabled,
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
    const shouldPersist = payload.persist !== false;
    const startedAt = Date.now();
    try {
      apiKey = await this.secureStore.retrieveSecret(storeHandle);
      const discoveredIds = await discovery.discoverModels(apiKey, provider.baseUrl);
      const latencyMs = Math.max(0, Date.now() - startedAt);
      const addedIds = discoveredIds.filter((id) => !priorIds.has(id));

      // Preview/test mode: return discovered ids without writing the catalog.
      if (!shouldPersist) {
        const previewModels: ProviderModelSummary[] = discoveredIds.map((id, index) => {
          const existing = existingForProtocol.find((m) => m.providerModelId === id);
          if (existing) return this.toModelSummary(existing);
          return {
            modelId: id as ModelId,
            providerModelId: id,
            displayName: id,
            protocol,
            capabilities: ['text'] as CapabilityTag[],
            capabilitiesConfirmed: false,
            priority: index,
          };
        });
        const response: DiscoverModelsResponse = {
          providerId: provider.id,
          models: previewModels,
          discoveredIds,
          source: 'adapter',
          protocol,
          addedIds,
          previousModelCount,
          latencyMs,
        };
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'provider.discoverModels',
            payload: response,
          }),
        );
        return;
      }

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
            latencyMs,
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
        latencyMs,
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
          limitsJson:
            typeof m.contextWindow === 'number' && m.contextWindow > 0
              ? JSON.stringify({ contextWindow: m.contextWindow })
              : undefined,
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

  // --- 0026: model-source config handlers ---

  private providerSummaryById(providerId: string): ProviderSummary | undefined {
    const entry = this.providerStore
      ?.listProviders()
      .find((item) => item.provider.id === providerId);
    return entry ? this.toProviderSummary(entry) : undefined;
  }

  private handleReorderProviders(socket: Socket, frame: Frame): void {
    const payload = parseReorderProvidersPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }
    try {
      this.providerStore.reorderProviders(payload.orderedProviderIds);
      const response: ReorderProvidersResponse = {
        providers: this.providerStore.listProviders().map((entry) => this.toProviderSummary(entry)),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.reorder',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private async handleAddProviderCredential(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseAddProviderCredentialPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore || !this.secureStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }
    let storeHandle: string | undefined;
    let committed = false;
    try {
      const entry = this.providerStore
        .listProviders()
        .find((item) => item.provider.id === payload.providerId);
      if (!entry) {
        throw new Error(`Provider not found: ${payload.providerId}`);
      }
      const group = entry.credentialGroups[0];
      if (!group) {
        throw new Error('Provider has no credential group');
      }
      storeHandle = await this.secureStore.storeSecret(payload.apiKey);
      const created = this.providerStore.addCredentialRef({
        credentialGroupId: group.id,
        label: payload.label,
        storeHandle,
      });
      committed = true;
      const summary = this.providerSummaryById(payload.providerId);
      if (!summary)
        throw new Error(`Provider not found after credential add: ${payload.providerId}`);
      const response: AddProviderCredentialResponse = {
        provider: summary,
        credentialRefId: created.id,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.addCredential',
          payload: response,
        }),
      );
    } catch (error) {
      if (storeHandle && !committed) {
        try {
          await this.secureStore.removeSecret(storeHandle);
        } catch {
          /* best-effort rollback */
        }
      }
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private async handleRemoveProviderCredential(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseRemoveProviderCredentialPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore || !this.secureStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }
    try {
      const owned = this.providerStore.getCredentialRefForProvider(
        payload.providerId,
        payload.credentialRefId,
      );
      if (!owned) {
        throw new Error(`Credential ref not found for provider: ${payload.credentialRefId}`);
      }
      const { storeHandle } = this.providerStore.removeCredentialRef(payload.credentialRefId);
      try {
        await this.secureStore.removeSecret(storeHandle);
      } catch {
        /* best-effort secret purge */
      }
      const summary = this.providerSummaryById(payload.providerId);
      if (!summary) throw new Error(`Provider not found: ${payload.providerId}`);
      const response: RemoveProviderCredentialResponse = { provider: summary, removed: true };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.removeCredential',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private async handleRevealProviderCredential(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseRevealProviderCredentialPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore || !this.secureStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }
    try {
      const credential = this.providerStore.getCredentialRefForProvider(
        payload.providerId,
        payload.credentialRefId,
      );
      if (!credential) {
        throw new Error(`Credential ref not found for provider: ${payload.credentialRefId}`);
      }
      const apiKey = await this.secureStore.retrieveSecret(credential.storeHandle);
      if (typeof apiKey !== 'string' || apiKey.length === 0) {
        throw new Error('Stored credential is unavailable');
      }
      const expiresAt = new Date(Date.now() + 10_000).toISOString();
      const response: RevealProviderCredentialResponse = {
        providerId: payload.providerId,
        credentialRefId: payload.credentialRefId,
        label: credential.label,
        apiKey,
        expiresAt,
      };
      // Audit metadata only — never the secret.
      if (this.stateStore) {
        try {
          const draft: EventDraft = {
            id: ulid() as Event['id'],
            workspaceId: this.workspaceId,
            category: 'provider',
            type: 'provider.credentialRevealed',
            occurredAt: new Date().toISOString(),
            payload: {
              providerId: payload.providerId,
              credentialRefId: payload.credentialRefId,
              label: credential.label,
              expiresAt,
            },
          };
          const committed = this.stateStore.commitTransition({ events: [draft] });
          for (const event of committed.events) {
            this.events.push(event);
            this.eventSequence = Math.max(this.eventSequence, event.sequence);
            this.publishEvent(event);
          }
        } catch {
          const event = this.appendEvent('provider', 'provider.credentialRevealed', {
            providerId: payload.providerId,
            credentialRefId: payload.credentialRefId,
            label: credential.label,
            expiresAt,
          });
          this.publishEvent(event);
        }
      } else {
        const event = this.appendEvent('provider', 'provider.credentialRevealed', {
          providerId: payload.providerId,
          credentialRefId: payload.credentialRefId,
          label: credential.label,
          expiresAt,
        });
        this.publishEvent(event);
      }
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.revealCredential',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private async handleUpdateProviderCredential(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseUpdateProviderCredentialPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore || !this.secureStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }
    let newStoreHandle: string | undefined;
    let committed = false;
    try {
      const existing = this.providerStore.getCredentialRefForProvider(
        payload.providerId,
        payload.credentialRefId,
      );
      if (!existing) {
        throw new Error(`Credential ref not found for provider: ${payload.credentialRefId}`);
      }
      const apiKey =
        typeof payload.apiKey === 'string' && payload.apiKey.trim().length > 0
          ? payload.apiKey
          : undefined;
      if (apiKey) {
        newStoreHandle = await this.secureStore.storeSecret(apiKey);
      }
      const updated = this.providerStore.updateCredentialRef({
        providerId: payload.providerId,
        credentialRefId: payload.credentialRefId,
        label: payload.label,
        storeHandle: newStoreHandle,
      });
      committed = true;
      if (updated.previousStoreHandle) {
        try {
          await this.secureStore.removeSecret(updated.previousStoreHandle);
        } catch {
          /* best-effort old handle cleanup */
        }
      }
      const summary = this.providerSummaryById(payload.providerId);
      if (!summary) throw new Error(`Provider not found: ${payload.providerId}`);
      const response: UpdateProviderCredentialResponse = {
        provider: summary,
        credentialRefId: payload.credentialRefId,
        secretRotated: Boolean(newStoreHandle),
      };
      if (this.stateStore) {
        try {
          const draft: EventDraft = {
            id: ulid() as Event['id'],
            workspaceId: this.workspaceId,
            category: 'provider',
            type: 'provider.credentialUpdated',
            occurredAt: new Date().toISOString(),
            payload: {
              providerId: payload.providerId,
              credentialRefId: payload.credentialRefId,
              label: updated.credential.label,
              secretRotated: response.secretRotated,
            },
          };
          const committedEvents = this.stateStore.commitTransition({ events: [draft] });
          for (const event of committedEvents.events) {
            this.events.push(event);
            this.eventSequence = Math.max(this.eventSequence, event.sequence);
            this.publishEvent(event);
          }
        } catch {
          const event = this.appendEvent('provider', 'provider.credentialUpdated', {
            providerId: payload.providerId,
            credentialRefId: payload.credentialRefId,
            label: updated.credential.label,
            secretRotated: response.secretRotated,
          });
          this.publishEvent(event);
        }
      } else {
        const event = this.appendEvent('provider', 'provider.credentialUpdated', {
          providerId: payload.providerId,
          credentialRefId: payload.credentialRefId,
          label: updated.credential.label,
          secretRotated: response.secretRotated,
        });
        this.publishEvent(event);
      }
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.updateCredential',
          payload: response,
        }),
      );
    } catch (error) {
      if (newStoreHandle && !committed) {
        try {
          await this.secureStore.removeSecret(newStoreHandle);
        } catch {
          /* best-effort rollback */
        }
      }
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleSetModelPriorities(socket: Socket, frame: Frame): void {
    const payload = parseSetModelPrioritiesPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }
    try {
      const models = this.providerStore.setModelPriorities({
        providerId: payload.providerId,
        entries: payload.entries,
      });
      const response: SetModelPrioritiesResponse = {
        providerId: payload.providerId,
        models: models.map((m) => this.toModelSummary(m)),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.setModelPriorities',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleUpdateModel(socket: Socket, frame: Frame): void {
    const payload = parseUpdateModelPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }
    try {
      const model = this.providerStore.updateModel({
        providerId: payload.providerId,
        modelId: payload.modelId,
        displayName: payload.displayName,
        contextWindow: payload.contextWindow,
      });
      const response: UpdateModelResponse = {
        providerId: payload.providerId,
        model: this.toModelSummary(model),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.updateModel',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleRemoveModel(socket: Socket, frame: Frame): void {
    const payload = parseRemoveModelPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.providerStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }
    try {
      const model = this.providerStore.getModel(payload.modelId);
      if (model && model.providerId !== payload.providerId) {
        throw new Error('Model does not belong to the given provider');
      }
      const removed = this.providerStore.removeModel(payload.modelId);
      const response: RemoveModelResponse = { providerId: payload.providerId, removed };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'provider.removeModel',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleGetSettings(socket: Socket, frame: Frame): void {
    const payload = parseGetSettingsPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.appSettingStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }
    try {
      const settings: Record<string, unknown> = {};
      if (payload.keys && payload.keys.length > 0) {
        for (const key of payload.keys) {
          const record = this.appSettingStore.get(key);
          if (record) settings[record.key] = record.value;
        }
      } else {
        for (const record of this.appSettingStore.list()) {
          settings[record.key] = record.value;
        }
      }
      const response: GetSettingsResponse = { settings };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: 'settings.get', payload: response }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleSetSetting(socket: Socket, frame: Frame): void {
    const payload = parseSetSettingPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.appSettingStore) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }
    try {
      const record = this.appSettingStore.set(payload.key, payload.value);
      const response: SetSettingResponse = {
        key: record.key,
        value: record.value,
        updatedAt: record.updatedAt,
      };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: 'settings.set', payload: response }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleUsageSummary(socket: Socket, frame: Frame): void {
    const payload = parseUsageSummaryPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.queryUsageSummary) {
      this.writeProviderStoreUnavailable(socket, frame);
      return;
    }
    try {
      const sinceIso =
        typeof payload.sinceDays === 'number' && payload.sinceDays > 0
          ? new Date(Date.now() - payload.sinceDays * 24 * 60 * 60 * 1000).toISOString()
          : undefined;
      const raw = this.queryUsageSummary(sinceIso);
      // Enrich request and aggregate rows with catalog display names.
      const catalog = this.providerStore?.listProviders() ?? [];
      const providerNameById = new Map(
        catalog.map((e) => [String(e.provider.id), e.provider.name]),
      );
      const modelById = new Map(
        catalog.flatMap((e) => e.models.map((m) => [String(m.id), m] as const)),
      );
      const modelByProviderModelId = new Map(
        catalog.flatMap((e) => e.models.map((m) => [m.providerModelId, m] as const)),
      );
      const catalogModelFor = (modelId: string) =>
        modelById.get(modelId) ?? modelByProviderModelId.get(modelId);
      const storedPricingRecord = this.appSettingStore?.get(MODEL_PRICING_SETTING_KEY);
      const pricing = storedPricingRecord
        ? parseModelPricingEntries(storedPricingRecord.value)
        : DEFAULT_MODEL_PRICING.map((entry) => ({ ...entry }));
      const pricingByModelId = new Map(
        pricing.map((entry) => [entry.modelId.toLowerCase(), entry] as const),
      );
      const resolvePricing = (modelId: string) => {
        const model = catalogModelFor(modelId);
        const candidates = [
          modelId,
          model?.providerModelId,
          // strip vendor prefix: "z-ai/glm-5.2" → "glm-5.2"
          model?.providerModelId?.includes('/')
            ? model.providerModelId.slice(model.providerModelId.lastIndexOf('/') + 1)
            : undefined,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0);
        for (const candidate of candidates) {
          const hit = pricingByModelId.get(candidate.toLowerCase());
          if (hit) return hit;
        }
        return undefined;
      };
      /** Prefer a human display name over raw model / provider IDs. */
      const resolveDisplayName = (modelId: string) => {
        const model = catalogModelFor(modelId);
        const modelPricing = resolvePricing(modelId);
        const catalogName = model?.displayName?.trim();
        const providerModelId = model?.providerModelId?.trim();
        const looksLikeRawId =
          !catalogName ||
          catalogName === modelId ||
          (providerModelId !== undefined && catalogName === providerModelId);
        if (!looksLikeRawId && catalogName) return catalogName;
        if (modelPricing?.displayName) return modelPricing.displayName;
        return catalogName || providerModelId || modelId;
      };
      const requests = raw.requests.map((row) => {
        const modelPricing = resolvePricing(row.modelId);
        return {
          ...row,
          displayName: resolveDisplayName(row.modelId),
          providerName: row.providerId ? providerNameById.get(row.providerId) : undefined,
          estimatedCost: modelPricing ? estimateUsageCost(row, modelPricing) : undefined,
          currency: modelPricing?.currency,
        };
      });
      const rows: UsageSummaryRow[] = raw.rows.map((row) => {
        const matchingRequests = requests.filter(
          (request) =>
            request.modelId === row.modelId && request.providerId === row.providerId,
        );
        const pricedRequests = matchingRequests.filter(
          (request) =>
            typeof request.estimatedCost === 'number' && request.currency !== undefined,
        );
        const currencies = new Set(pricedRequests.map((request) => request.currency));
        return {
          ...row,
          displayName: resolveDisplayName(row.modelId),
          providerName: row.providerId ? providerNameById.get(row.providerId) : undefined,
          totalCost:
            pricedRequests.length > 0 && currencies.size === 1
              ? pricedRequests.reduce(
                  (sum, request) => sum + (request.estimatedCost ?? 0),
                  0,
                )
              : undefined,
          currency:
            currencies.size === 1
              ? (pricedRequests[0]?.currency as 'USD' | 'CNY' | undefined)
              : undefined,
        };
      });
      const toolModels = raw.toolModels.map((row) => ({
        ...row,
        displayName: resolveDisplayName(row.modelId),
      }));
      const toolFailures = raw.toolFailures.map((row) => ({
        ...row,
        displayName: row.modelId ? resolveDisplayName(row.modelId) : undefined,
      }));
      const cachedHits = requests.map((row) => row.cachedTokensHit).filter((v): v is number => typeof v === 'number');
      const cachedCreated = requests
        .map((row) => row.cachedTokensCreated)
        .filter((v): v is number => typeof v === 'number');
      const totalCostByCurrency: UsageSummaryResponse['totalCostByCurrency'] = {};
      for (const request of requests) {
        if (typeof request.estimatedCost !== 'number' || !request.currency) continue;
        totalCostByCurrency[request.currency] =
          (totalCostByCurrency[request.currency] ?? 0) + request.estimatedCost;
      }
      const response: UsageSummaryResponse = {
        rows,
        requests,
        tools: raw.tools,
        toolModels,
        toolFailures,
        pricing,
        totalRequests: requests.length,
        totalTokensIn: requests.reduce((sum, row) => sum + row.tokensIn, 0),
        totalTokensOut: requests.reduce((sum, row) => sum + row.tokensOut, 0),
        totalCostByCurrency,
        totalCachedTokensHit:
          cachedHits.length > 0 ? cachedHits.reduce((sum, value) => sum + value, 0) : undefined,
        totalCachedTokensCreated:
          cachedCreated.length > 0
            ? cachedCreated.reduce((sum, value) => sum + value, 0)
            : undefined,
      };
      socket.write(
        encodeFrame({ id: frame.id, kind: 'response', type: 'usage.summary', payload: response }),
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
      enabled: entry.provider.enabled,
      sortOrder: entry.provider.sortOrder,
      credentials,
      models: entry.models.map((m) => this.toModelSummary(m)),
      createdAt: entry.provider.createdAt,
      updatedAt: entry.provider.updatedAt,
    };
  }

  private toWorkspaceSummary(workspace: {
    id: import('@sync-think/shared').WorkspaceId;
    folderPath?: string;
    name: string;
    uiPrefsJson?: string;
    createdAt: string;
    updatedAt: string;
  }): import('@sync-think/protocol').WorkspaceSummary {
    return {
      workspaceId: workspace.id,
      folderPath: workspace.folderPath,
      name: workspace.name,
      icon: workspaceIconFromPrefs(workspace.uiPrefsJson),
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    };
  }

  private toModelSummary(model: ModelRecord): ProviderModelSummary {
    let contextWindow: number | undefined;
    if (model.limitsJson) {
      try {
        const limits = JSON.parse(model.limitsJson) as { contextWindow?: unknown };
        if (typeof limits?.contextWindow === 'number' && limits.contextWindow > 0) {
          contextWindow = limits.contextWindow;
        }
      } catch {
        contextWindow = undefined;
      }
    }
    return {
      modelId: model.id,
      providerModelId: model.providerModelId,
      displayName: model.displayName,
      protocol: model.protocol,
      capabilities: model.capabilities,
      capabilitiesConfirmed: model.capabilitiesConfirmed,
      priority: model.priority,
      credentialRefId: model.credentialRefId,
      contextWindow,
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
      const agent = this.toAgentDefinitionSummary(updated);
      const event = this.appendEvent('system', 'agent.version-created', {
        agentId: agent.agentId,
        agentVersionId: agent.agentVersionId,
        previousAgentVersionId: current.id,
        version: agent.version,
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

  // --- mutable global Agent / Team / Conversation handlers (2026-07-22 model) ---

  private handleListGlobalAgents(socket: Socket, frame: Frame): void {
    const payload = parseListGlobalAgentsPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.globalAgentStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const response: ListGlobalAgentsResponse = {
        agents: this.globalAgentStore
          .list({ includeArchived: payload.includeArchived })
          .map((record) => this.toGlobalAgentSummary(record)),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'globalAgent.list',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private assertGlobalAgentSkillVersions(skillIds: readonly string[] | undefined): void {
    if (skillIds === undefined) return;
    if (skillIds.length > 8) {
      throw new Error('global agent may equip at most 8 Skill versions');
    }
    if (!this.skillStore && skillIds.length > 0) {
      throw new Error('Skill store is not configured on this Runtime');
    }
    for (const skillVersionId of skillIds) {
      const skill = this.skillStore?.getVersion(skillVersionId);
      if (!skill || skill.archivedAt) {
        throw new Error(`Skill version not found: ${skillVersionId}`);
      }
      if (!this.skillStore?.isPermissionApproved(skillVersionId)) {
        throw new Error(`Skill version is not approved: ${skillVersionId}`);
      }
    }
  }

  private handleCreateGlobalAgent(socket: Socket, frame: Frame): void {
    const payload = parseCreateGlobalAgentPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.globalAgentStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      this.assertGlobalAgentSkillVersions(payload.skillIds);
      const created = this.globalAgentStore.create({
        name: payload.name,
        defaultModelId: payload.defaultModelId,
        avatar: payload.avatar,
        persona: payload.persona,
        description: payload.description,
        fallbackModelIds: payload.fallbackModelIds,
        skillIds: payload.skillIds,
        mcpServerIds: payload.mcpServerIds,
        reasoningEffort: payload.reasoningEffort,
      });
      const agent = this.toGlobalAgentSummary(created);
      const event = this.appendEvent('system', 'globalAgent.created', {
        agentId: agent.id,
        name: agent.name,
      });
      this.publishEvent(event);
      const response: GlobalAgentResponse = { agent };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'globalAgent.create',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleUpdateGlobalAgent(socket: Socket, frame: Frame): void {
    const payload = parseUpdateGlobalAgentPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.globalAgentStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      this.assertGlobalAgentSkillVersions(payload.skillIds);
      const updated = this.globalAgentStore.update({
        agentId: payload.agentId,
        name: payload.name,
        avatar: payload.avatar,
        persona: payload.persona,
        description: payload.description,
        defaultModelId: payload.defaultModelId,
        fallbackModelIds: payload.fallbackModelIds,
        skillIds: payload.skillIds,
        mcpServerIds: payload.mcpServerIds,
        reasoningEffort: payload.reasoningEffort,
        archived: payload.archived,
      });
      const agent = this.toGlobalAgentSummary(updated);
      const event = this.appendEvent('system', 'globalAgent.updated', {
        agentId: agent.id,
        name: agent.name,
        archived: agent.archived,
      });
      this.publishEvent(event);
      const response: GlobalAgentResponse = { agent };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'globalAgent.update',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleDeleteGlobalAgent(socket: Socket, frame: Frame): void {
    const payload = parseDeleteGlobalAgentPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.globalAgentStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      // Refuse hard-delete while conversations still reference this agent.
      // Soft-archive keeps identity for historical chats without silent demotion.
      if (this.conversationStore) {
        const referenced = this.conversationStore
          .list({ track: 'agent', includeArchived: true })
          .filter((c) => c.targetRef === payload.agentId && !c.archivedAt);
        if (referenced.length > 0) {
          this.globalAgentStore.update({
            agentId: payload.agentId,
            archived: true,
          });
          const event = this.appendEvent('system', 'globalAgent.updated', {
            agentId: payload.agentId,
            archived: true,
            reason: 'archived_due_to_conversation_refs',
            conversationCount: referenced.length,
          });
          this.publishEvent(event);
          socket.write(
            encodeFrame({
              id: frame.id,
              kind: 'response',
              type: 'globalAgent.delete',
              payload: {
                archived: true,
                conversationCount: referenced.length,
                message: `智能体仍被 ${referenced.length} 个对话引用，已归档而非删除`,
              },
            }),
          );
          return;
        }
      }
      this.globalAgentStore.delete(payload.agentId);
      const event = this.appendEvent('system', 'globalAgent.deleted', {
        agentId: payload.agentId,
      });
      this.publishEvent(event);
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'globalAgent.delete',
          payload: {},
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleListTeams(socket: Socket, frame: Frame): void {
    const payload = parseListTeamsPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.teamStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const response: ListTeamsResponse = {
        teams: this.teamStore.list().map((record) => this.toTeamSummary(record)),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'team.list',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleCreateTeam(socket: Socket, frame: Frame): void {
    const payload = parseCreateTeamPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.teamStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const created = this.teamStore.create({
        name: payload.name,
        avatar: payload.avatar,
        mission: payload.mission,
        strategy: payload.strategy,
        coordinatorAgentId: payload.coordinatorAgentId,
        members: payload.members,
      });
      const team = this.toTeamSummary(created);
      const event = this.appendEvent('system', 'team.created', {
        teamId: team.id,
        name: team.name,
        memberCount: team.members.length,
      });
      this.publishEvent(event);
      const response: TeamResponse = { team };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'team.create',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleUpdateTeam(socket: Socket, frame: Frame): void {
    const payload = parseUpdateTeamPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.teamStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const updated = this.teamStore.update({
        teamId: payload.teamId,
        name: payload.name,
        avatar: payload.avatar,
        mission: payload.mission,
        strategy: payload.strategy,
        coordinatorAgentId: payload.coordinatorAgentId,
        members: payload.members,
      });
      const team = this.toTeamSummary(updated);
      const event = this.appendEvent('system', 'team.updated', {
        teamId: team.id,
        name: team.name,
        memberCount: team.members.length,
      });
      this.publishEvent(event);
      const response: TeamResponse = { team };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'team.update',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleDeleteTeam(socket: Socket, frame: Frame): void {
    const payload = parseDeleteTeamPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.teamStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      // Refuse delete while conversations still reference this team — historical
      // chats would otherwise silently lose their team identity (same class of
      // bug as deleting a global agent with open agent-track conversations).
      if (this.conversationStore) {
        const referenced = this.conversationStore
          .list({ track: 'team', includeArchived: true })
          .filter((c) => c.targetRef === payload.teamId && !c.archivedAt);
        if (referenced.length > 0) {
          throw new Error(
            `小队仍被 ${referenced.length} 个对话引用，请先归档或删除这些对话后再删除小队`,
          );
        }
      }
      this.teamStore.delete(payload.teamId);
      const event = this.appendEvent('system', 'team.deleted', { teamId: payload.teamId });
      this.publishEvent(event);
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'team.delete',
          payload: {},
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleStartTeamRun(socket: Socket, frame: Frame): void {
    const payload = parseStartTeamRunPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.teamStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const started = this.teamStore.startRun({
        teamId: payload.teamId,
        conversationId: payload.conversationId,
      });
      const run = this.toTeamRunSummary(started);
      const event = this.appendEvent('run', 'team.run_started', {
        teamRunId: run.id,
        teamId: run.teamId,
        conversationId: run.conversationId,
      });
      this.publishEvent(event);
      const response: TeamRunResponse = { run };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'team.startRun',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleSetTeamRunStatus(socket: Socket, frame: Frame): void {
    const payload = parseSetTeamRunStatusPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.teamStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const updated = this.teamStore.setRunStatus(payload.runId, payload.status);
      const run = this.toTeamRunSummary(updated);
      const event = this.appendEvent('run', 'team.run_status_changed', {
        teamRunId: run.id,
        teamId: run.teamId,
        status: run.status,
      });
      this.publishEvent(event);
      const response: TeamRunResponse = { run };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'team.setRunStatus',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleListConversations(socket: Socket, frame: Frame): void {
    const payload = parseListConversationsPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const response: ListConversationsResponse = {
        conversations: this.conversationStore
          .list({
            track: payload.track,
            workspaceId: payload.workspaceId as WorkspaceId | undefined,
            includeArchived: payload.includeArchived,
          })
          .map((record) => this.toConversationSummary(record)),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.list',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleCreateConversation(socket: Socket, frame: Frame): void {
    const payload = parseCreateConversationPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      // Refuse to create agent/team conversations that point at missing targets.
      if (payload.track === 'agent') {
        const agent = this.globalAgentStore?.get(payload.targetRef as AgentId);
        if (!agent || agent.archived) {
          throw new Error(`AGENT_NOT_FOUND: ${payload.targetRef}`);
        }
      }
      if (payload.track === 'team') {
        const team = this.teamStore?.get(payload.targetRef as TeamId);
        if (!team) {
          throw new Error(`TEAM_NOT_FOUND: ${payload.targetRef}`);
        }
      }
      const created = this.conversationStore.create({
        target: this.toConversationTarget(payload.track, payload.targetRef),
        workspaceId: payload.workspaceId as WorkspaceId | undefined,
        title: payload.title,
        executionMode: payload.executionMode,
      });
      const conversation = this.toConversationSummary(created);
      const event = this.appendEvent('system', 'conversation.created', {
        conversationId: conversation.id,
        track: conversation.track,
        targetRef: conversation.targetRef,
      });
      this.publishEvent(event);
      const response: ConversationResponse = { conversation };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.create',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleRenameConversation(socket: Socket, frame: Frame): void {
    const payload = parseRenameConversationPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const updated = this.conversationStore.rename(payload.conversationId, payload.title);
      const response: ConversationResponse = { conversation: this.toConversationSummary(updated) };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.rename',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleSetConversationPinned(socket: Socket, frame: Frame): void {
    const payload = parseSetConversationPinnedPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const updated = this.conversationStore.setPinned(payload.conversationId, payload.pinned);
      const response: ConversationResponse = { conversation: this.toConversationSummary(updated) };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.setPinned',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleSetConversationArchived(socket: Socket, frame: Frame): void {
    const payload = parseSetConversationArchivedPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const updated = this.conversationStore.setArchived(payload.conversationId, payload.archived);
      const response: ConversationResponse = { conversation: this.toConversationSummary(updated) };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.setArchived',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleSetConversationExecutionMode(socket: Socket, frame: Frame): void {
    const payload = parseSetConversationExecutionModePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const updated = this.conversationStore.setExecutionMode(
        payload.conversationId,
        payload.executionMode,
      );
      const conversation = this.toConversationSummary(updated);
      const event = this.appendEvent('system', 'conversation.execution_mode_changed', {
        conversationId: conversation.id,
        executionMode: conversation.executionMode,
      });
      this.publishEvent(event);
      const response: ConversationResponse = { conversation };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.setExecutionMode',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleUpgradeConversationTrack(socket: Socket, frame: Frame): void {
    const payload = parseUpgradeConversationTrackPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const target =
        payload.track === 'agent'
          ? { track: 'agent' as const, agentId: payload.targetRef as AgentId }
          : { track: 'team' as const, teamId: payload.targetRef as TeamId };
      const updated = this.conversationStore.upgradeTrack(payload.conversationId, target);
      const conversation = this.toConversationSummary(updated);
      const event = this.appendEvent('system', 'conversation.track_upgraded', {
        conversationId: conversation.id,
        track: conversation.track,
        targetRef: conversation.targetRef,
      });
      this.publishEvent(event);
      const response: ConversationResponse = { conversation };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.upgradeTrack',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  /**
   * conversation.rebindTarget — free retarget of "who this conversation talks
   * to": same-track swap or any cross-track switch. Validation is inline
   * (strict key/shape check) mirroring parseUpgradeConversationTrackPayload.
   */
  private handleRebindConversationTarget(socket: Socket, frame: Frame): void {
    const payload = parseRebindConversationTargetPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const updated = this.conversationStore.rebindTarget(
        payload.conversationId,
        payload.track,
        payload.targetRef,
      );
      const conversation = this.toConversationSummary(updated);
      const event = this.appendEvent('system', 'conversation.target_rebound', {
        conversationId: conversation.id,
        track: conversation.track,
        targetRef: conversation.targetRef,
      });
      this.publishEvent(event);
      const response: ConversationResponse = { conversation };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.rebindTarget',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleDeleteConversation(socket: Socket, frame: Frame): void {
    const payload = parseDeleteConversationPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      this.conversationStore.delete(payload.conversationId);
      const event = this.appendEvent('system', 'conversation.deleted', {
        conversationId: payload.conversationId,
      });
      this.publishEvent(event);
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.delete',
          payload: {},
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  /**
   * NewMax-style context compact:
   * 1) User types /compact (or auto at ~70% window) → runtime receives conversation.compact
   * 2) Primary path: call the bound provider with Claude Code's compact summary prompt
   *    (same approach NewMax uses by submitting /compact to the long-lived CLI)
   * 3) Write durable context.compacted boundary + visible system marker
   * 4) Subsequent buildChatMessagesFromEvents starts from that boundary
   * Local truncate summary is only a degraded fallback when the model is unavailable.
   */
  private async handleConversationCompact(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseConversationCompactPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore || !this.workspaceStore || !this.stateStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }

    const startedAt = Date.now();
    try {
      const conversation = this.conversationStore.get(payload.conversationId);
      if (!conversation) {
        throw new Error(`Conversation not found: ${payload.conversationId}`);
      }
      if (!conversation.taskId) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'conversation.compact',
            payload: {
              conversationId: payload.conversationId,
              threadId: '',
              compacted: false,
              mode: payload.mode ?? 'manual',
              beforeTokens: 0,
              afterTokens: 0,
              foldedCount: 0,
              durationMs: Date.now() - startedAt,
            },
          }),
        );
        return;
      }

      const task = this.workspaceStore.getTask(conversation.taskId);
      if (!task?.threadId) {
        throw new Error(`Task/thread not found for conversation: ${payload.conversationId}`);
      }
      const threadId = String(task.threadId);
      const events = this.stateStore.listAllEvents
        ? this.stateStore.listAllEvents(0)
        : this.stateStore.listEvents(this.workspaceId, 0);

      // Prefer real usage occupancy from the client (usedTokens + contextWindow).
      // Fall back to local transcript estimate when the ring has no usage yet.
      const history = collectThreadChatHistory(events, threadId, {
        contextWindow: payload.contextWindow,
        usedTokens: payload.usedTokens,
      });
      const mode = payload.mode === 'auto' ? 'auto' : 'manual';
      const onlyIfNeeded = payload.onlyIfNeeded === true || mode === 'auto';
      if (onlyIfNeeded && !history.shouldAutoCompact) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'conversation.compact',
            payload: {
              conversationId: payload.conversationId,
              threadId,
              compacted: false,
              mode,
              beforeTokens: history.estimatedTokens,
              afterTokens: history.estimatedTokens,
              foldedCount: 0,
              durationMs: Date.now() - startedAt,
            },
          }),
        );
        return;
      }

      const keepRecent = payload.keepRecent ?? COMPACT_KEEP_RECENT_MESSAGES;
      const split = splitHistoryForCompact(history.messages, keepRecent);
      if (split.foldedCount <= 0) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'conversation.compact',
            payload: {
              conversationId: payload.conversationId,
              threadId,
              compacted: false,
              mode,
              beforeTokens: split.beforeTokens,
              afterTokens: split.beforeTokens,
              foldedCount: 0,
              durationMs: Date.now() - startedAt,
            },
          }),
        );
        return;
      }

      // Primary: model-generated structured summary (NewMax / Claude Code path).
      // If the model summary does not shrink occupancy (common on short threads where a
      // 9-section summary is larger than the original turns), fall back to local fold.
      const beforeTokens = split.beforeTokens;
      let summaryText = '';
      let summarySource: 'model' | 'local' = 'local';
      let afterTokens = beforeTokens;

      const local = buildLocalCompactSummary({
        messages: history.messages,
        keepRecent,
        contextWindow: payload.contextWindow,
      });

      const compactModelId = this.resolveCompactModelId(conversation);
      const modelSummary = await this.generateModelCompactSummary({
        threadId,
        conversationId: String(payload.conversationId),
        olderMessages: split.older,
        modelId: compactModelId,
      });
      if (modelSummary) {
        const wrapped = wrapModelCompactSummary(modelSummary);
        const modelAfter = estimateCompactAfterTokens(wrapped, split.keptMessages);
        // Require a real reduction; otherwise local truncate is better for the ring.
        if (
          wrapped &&
          isMeaningfulCompactReduction(beforeTokens, modelAfter)
        ) {
          summaryText = wrapped;
          summarySource = 'model';
          afterTokens = modelAfter;
        }
      }
      if (!summaryText) {
        // Local path already rejects non-shrinking summaries (empty summaryText).
        summaryText = local.summaryText;
        summarySource = 'local';
        afterTokens = local.afterTokens;
      }

      if (
        !summaryText ||
        split.foldedCount <= 0 ||
        !isMeaningfulCompactReduction(beforeTokens, afterTokens)
      ) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'conversation.compact',
            payload: {
              conversationId: payload.conversationId,
              threadId,
              compacted: false,
              mode,
              beforeTokens,
              afterTokens: beforeTokens,
              foldedCount: 0,
              durationMs: Date.now() - startedAt,
            },
          }),
        );
        return;
      }

      const foldedCount = split.foldedCount;
      const compactMessageId = ulid() as MessageId;
      const markerMessageId = ulid() as MessageId;
      // Prefer durable task.version — same source appendMessage uses for OCC.
      const currentVersion = task.version ?? this.threadVersions.get(threadId) ?? 0;
      const nextVersion = currentVersion + 1;

      // Durable compact boundary: later buildChatMessagesFromEvents starts from here.
      // Keep compact + marker + version bump in one unit of work when available.
      const writeCompact = () => {
        const compactEvent = this.appendEvent(
          'system',
          'context.compacted',
          {
            threadId,
            conversationId: payload.conversationId,
            mode,
            summaryText,
            summarySource,
            beforeTokens,
            afterTokens,
            foldedCount,
            keepRecent,
            messageId: compactMessageId,
          },
          compactMessageId,
          undefined,
          task.id,
        );
        // Visible system marker (info tone, not an error).
        const markerLabel =
          mode === 'auto'
            ? `上下文已自动压缩：折叠 ${foldedCount} 条较早消息（${beforeTokens} → ${afterTokens} tokens）`
            : `上下文已压缩：折叠 ${foldedCount} 条较早消息（${beforeTokens} → ${afterTokens} tokens）`;
        const markerEvent = this.appendEvent(
          'message',
          'message.appended',
          {
            threadId,
            role: 'system',
            text: markerLabel,
            messageId: markerMessageId,
            taskVersion: nextVersion,
            compact: true,
            tone: 'info',
            summarySource,
          },
          markerMessageId,
          undefined,
          task.id,
        );
        // Persist task version so subsequent appendMessage optimistic concurrency stays consistent.
        if (this.workspaceStore) {
          this.workspaceStore.advanceTaskVersionByThreadId(
            threadId as ThreadId,
            currentVersion,
            markerEvent.occurredAt,
          );
        }
        this.threadVersions.set(threadId, nextVersion);
        return { compactEvent, markerEvent };
      };

      const written = this.runInUnitOfWork(writeCompact);
      this.publishEvent(written.compactEvent);
      this.publishEvent(written.markerEvent);

      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.compact',
          payload: {
            conversationId: payload.conversationId,
            threadId,
            compacted: true,
            mode,
            beforeTokens,
            afterTokens,
            foldedCount,
            durationMs: Date.now() - startedAt,
            summaryText,
            messageId: compactMessageId,
          },
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  /**
   * Resolve the model used for compact summaries.
   * Model track → targetRef; agent track → agent.defaultModelId;
   * team track → coordinator agent default model (fallback: undefined → fake/default).
   */
  private resolveCompactModelId(conversation: {
    track?: string;
    targetRef?: string | null;
  }): string | undefined {
    const track = conversation.track;
    const targetRef =
      typeof conversation.targetRef === 'string' ? conversation.targetRef.trim() : '';
    if (!targetRef) return undefined;
    if (track === 'model' || !track) return targetRef;
    if (track === 'agent') {
      const agent = this.globalAgentStore?.get(targetRef as AgentId);
      const modelId =
        agent && typeof agent.defaultModelId === 'string' ? String(agent.defaultModelId).trim() : '';
      return modelId || undefined;
    }
    if (track === 'team') {
      const team = this.teamStore?.get(targetRef as TeamId);
      const coordinatorId =
        team && typeof team.coordinatorAgentId === 'string'
          ? team.coordinatorAgentId
          : undefined;
      if (coordinatorId) {
        const agent = this.globalAgentStore?.get(coordinatorId as AgentId);
        const modelId =
          agent && typeof agent.defaultModelId === 'string'
            ? String(agent.defaultModelId).trim()
            : '';
        if (modelId) return modelId;
      }
      // Fall back to first member's default model when coordinator is missing.
      const firstMember = team?.members?.[0];
      const memberAgentId =
        firstMember && typeof firstMember.agentId === 'string' ? firstMember.agentId : undefined;
      if (memberAgentId) {
        const agent = this.globalAgentStore?.get(memberAgentId as AgentId);
        const modelId =
          agent && typeof agent.defaultModelId === 'string'
            ? String(agent.defaultModelId).trim()
            : '';
        if (modelId) return modelId;
      }
    }
    return undefined;
  }

  /**
   * Call the bound provider with Claude Code's compact summary prompt.
   * Returns raw model text, or undefined when no live provider is available.
   * Tools are intentionally disabled — compaction agents must only produce text.
   */
  private async generateModelCompactSummary(input: {
    threadId: string;
    conversationId: string;
    olderMessages: readonly import('./chat-tools.js').CompactHistoryMessage[];
    modelId?: string;
  }): Promise<string | undefined> {
    if (!this.canStartModelRun()) return undefined;
    if (!input.olderMessages.length) return undefined;

    const runId = ulid() as RunId;
    let prepared: {
      run: DemoRunState;
    };
    try {
      prepared = this.prepareRunBinding({
        runId,
        threadId: input.threadId,
        userText: '[compact]',
        modelId: input.modelId,
      });
    } catch {
      return undefined;
    }

    const userPrompt = buildCompactSummaryUserPrompt(input.olderMessages);
    const abort = new AbortController();
    // Compaction should not hang the UI forever; 90s is generous for long transcripts.
    const timer = setTimeout(() => abort.abort(), 90_000);
    try {
      const stream = await this.openProviderStream(prepared.run, {
        messages: [{ role: 'user', content: userPrompt }],
        toolsEnabled: false,
        networkEnabled: false,
        signal: abort.signal,
        systemPromptOverride: COMPACT_SUMMARY_SYSTEM_PROMPT,
      });
      if (!stream) return undefined;

      let text = '';
      for await (const event of stream) {
        if (abort.signal.aborted) break;
        if (event.type === 'text-delta') {
          text += event.text;
        } else if (event.type === 'error') {
          return undefined;
        } else if (event.type === 'finished') {
          break;
        }
      }
      const cleaned = text.replace(/\s+$/g, '').trim();
      // Reject empty / trivial responses so we fall back to local summary.
      if (cleaned.length < 40) return undefined;
      return cleaned;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  private async handleConversationSendMessage(socket: Socket, frame: Frame): Promise<void> {
    const payload = frame.payload as
      { conversationId?: string; text?: string; modelId?: string } | undefined;
    if (
      !payload ||
      typeof payload.conversationId !== 'string' ||
      typeof payload.text !== 'string'
    ) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const conversationId = payload.conversationId;
    const text = payload.text;
    if (!this.conversationStore || !this.workspaceStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }

    try {
      // 1. Get conversation
      const conversation = this.conversationStore.get(conversationId);
      if (!conversation) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'conversation.sendMessage',
            payload: {},
            error: {
              code: ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
              message: 'Conversation not found',
            },
          }),
        );
        return;
      }

      // 2. Ensure task exists (lazy creation on first message)
      let threadId: ThreadId;
      let taskVersion: number;
      let persistedTask: TaskRecord | undefined;

      if (conversation.taskId) {
        persistedTask = this.workspaceStore.getTask(conversation.taskId);
        if (!persistedTask) {
          socket.write(
            encodeFrame({
              id: frame.id,
              kind: 'response',
              type: 'conversation.sendMessage',
              payload: {},
              error: { code: ErrorCode.TASK_NOT_FOUND, message: 'Bound task not found' },
            }),
          );
          return;
        }
        threadId = persistedTask.threadId;
        taskVersion = persistedTask.version;
      } else {
        // Lazy-create: get or create inbox workspace, then create task
        const workspaceId = conversation.workspaceId || this.getOrCreateInboxWorkspace();
        const created = this.workspaceStore.createTask({
          workspaceId,
          title: '新对话',
          goal: text.slice(0, 200),
        });
        this.threadVersions.set(created.threadId, created.taskVersion);
        // Bind task to conversation
        this.conversationStore.bindTask(conversation.id, created.taskId);
        threadId = created.threadId;
        taskVersion = created.taskVersion;
        persistedTask = this.workspaceStore.getTaskByThreadId(threadId);
      }

      // 3. Update conversation title from first message + touch lastMessageAt
      if (taskVersion === 0) {
        const generatedTitle = deriveTaskTitleFromPrompt(text);
        this.conversationStore.rename(conversation.id, generatedTitle);
        this.conversationStore.touchLastMessage(conversation.id);
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'conversation.sendMessage',
            payload: {
              threadId,
              taskVersion,
              conversationTitle: generatedTitle,
            },
          }),
        );
      } else {
        this.conversationStore.touchLastMessage(conversation.id);
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'conversation.sendMessage',
            payload: {
              threadId,
              taskVersion,
            },
          }),
        );
      }
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private getOrCreateInboxWorkspace(): WorkspaceId {
    if (!this.workspaceStore) throw new Error('workspace store unavailable');
    const workspaces = this.workspaceStore.listWorkspaces();
    const inbox = workspaces.find((w) => w.name === '__inbox__');
    if (inbox) return inbox.id;
    const created = this.workspaceStore.createWorkspace({ name: '__inbox__' });
    return created.id;
  }

  private toConversationTarget(
    track: 'model' | 'agent' | 'team',
    targetRef: string,
  ): import('@sync-think/storage').ConversationTarget {
    if (track === 'model') return { track, modelId: targetRef as ModelId };
    if (track === 'agent') return { track, agentId: targetRef as AgentId };
    return { track, teamId: targetRef as TeamId };
  }

  private toGlobalAgentSummary(record: GlobalAgentRecord): GlobalAgent {
    return {
      id: record.id,
      name: record.name,
      avatar: record.avatar,
      persona: record.persona,
      description: record.description,
      defaultModelId: record.defaultModelId,
      fallbackModelIds: [...record.fallbackModelIds],
      skillIds: [...record.skillIds],
      mcpServerIds: [...record.mcpServerIds],
      reasoningEffort: record.reasoningEffort,
      archived: record.archived,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private toTeamSummary(record: TeamRecord): Team {
    return {
      id: record.id,
      name: record.name,
      avatar: record.avatar,
      mission: record.mission,
      strategy: record.strategy,
      coordinatorAgentId: record.coordinatorAgentId,
      members: record.members.map((member) => ({
        agentId: member.agentId,
        memberOrder: member.memberOrder,
        role: member.role,
        title: member.title,
        dependsOn: [...member.dependsOn],
      })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private toTeamRunSummary(record: TeamRunRecord): TeamRun {
    return {
      id: record.id,
      teamId: record.teamId,
      conversationId: record.conversationId,
      status: record.status,
      rosterSnapshot: {
        name: record.rosterSnapshot.name,
        mission: record.rosterSnapshot.mission,
        strategy: record.rosterSnapshot.strategy,
        coordinatorAgentId: record.rosterSnapshot.coordinatorAgentId,
        members: record.rosterSnapshot.members.map((member) => ({
          agentId: member.agentId,
          memberOrder: member.memberOrder,
          role: member.role,
          title: member.title,
          dependsOn: [...member.dependsOn],
        })),
      },
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private toConversationSummary(record: ConversationRecord): Conversation {
    return {
      id: record.id,
      track: record.track,
      targetRef: record.targetRef,
      workspaceId: record.workspaceId,
      title: record.title,
      pinnedAt: record.pinnedAt,
      archivedAt: record.archivedAt,
      executionMode: record.executionMode,
      lastMessageAt: record.lastMessageAt,
      taskId: record.taskId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private writeTeamModelStoreUnavailable(socket: Socket, frame: Frame): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.STORAGE_WRITE_FAILED,
          message: 'Agent/Team/Conversation store is not configured on this Runtime',
        },
      }),
    );
  }

  private writeTeamModelCommandError(socket: Socket, frame: Frame, error: unknown): void {
    const message =
      error instanceof Error ? error.message : 'Agent/Team/Conversation command failed';
    let code: (typeof ErrorCode)[keyof typeof ErrorCode] = ErrorCode.STORAGE_WRITE_FAILED;
    if (/not found/i.test(message)) {
      code = ErrorCode.PROTOCOL_UNEXPECTED_REQUEST;
    } else if (
      /is a member of team/i.test(message) ||
      /running run/i.test(message) ||
      /historical runs/i.test(message) ||
      /only model-direct conversations/i.test(message)
    ) {
      code = ErrorCode.PROTOCOL_UNEXPECTED_REQUEST;
    } else if (
      /must not be empty/i.test(message) ||
      /duplicate team member/i.test(message) ||
      /depends on/i.test(message) ||
      /must be a team member/i.test(message) ||
      /empty team/i.test(message) ||
      /archived/i.test(message)
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
    if (runId && (!graph || graph.run.taskId !== taskId)) {
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

    const persistedAgentVersionId = step?.agentVersionId ?? input.agentVersionId;
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
    const agentVersion = persistedAgentVersionId
      ? this.agentStore?.getVersion(persistedAgentVersionId)
      : undefined;
    if (persistedAgentVersionId && !agentVersion) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
        'Approval AgentVersion is not available',
      );
    }

    const scopes: PolicyScopeRef[] = [{ scopeType: 'user', scopeId: this.installId }];
    if (workspaceId) {
      scopes.push(
        { scopeType: 'workspace', scopeId: workspaceId },
        { scopeType: 'project', scopeId: workspaceId },
      );
    }
    if (taskId) scopes.push({ scopeType: 'task', scopeId: taskId });
    if (agentVersion) scopes.push({ scopeType: 'agent', scopeId: agentVersion.agentId });
    if (runId) scopes.push({ scopeType: 'run', scopeId: runId });

    const policies = this.policyStore?.listApplicable(scopes) ?? [];
    const resolved = resolveScopedPolicy([
      ...policies.map((policy) => ({
        scope: policy.scopeType,
        scopeId: policy.scopeId,
        approvalMode: policy.approvalMode,
        rules: policy.rules,
        policyId: policy.policyId,
        version: policy.version,
      })),
      ...(agentVersion
        ? [
            {
              scope: 'agent' as const,
              scopeId: agentVersion.agentId,
              approvalMode: agentVersion.approvalMode,
              rules: [],
            },
          ]
        : []),
    ]);
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
      if (autoApproved && !payload.forceEnqueue) {
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
        Boolean(payload.forceEnqueue) ||
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
    if (!this.skillStore) {
      return { bound: false, skillVersionId, reason: 'Skill store 不可用' };
    }
    const approvedSkill = this.skillStore.getVersion(skillVersionId);
    if (!approvedSkill || approvedSkill.archivedAt) {
      return { bound: false, skillVersionId, reason: 'Skill 版本不存在或已卸载' };
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
  /**
   * Shared SKILL.md import core used by the skill.import command and the
   * create_skill / update_skill chat tools. Parses text only — never executes
   * scripts. Emits skill.imported (+ optional reapproval) events.
   */
  private importSkillMdCore(skillMd: string): ImportSkillResponse {
    if (!this.skillStore) throw new Error('Skill store is not configured on this Runtime.');
    const parsed = parseSkillMd(skillMd);
    return this.finishSkillImport(skillMd, parsed);
  }

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
      const response = this.finishSkillImport(payload.skillMd, parsed);
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

  /** Fingerprint + persist + permission diff + events for a parsed SKILL.md. */
  private finishSkillImport(
    skillMd: string,
    parsed: ReturnType<typeof parseSkillMd>,
  ): ImportSkillResponse {
    if (!this.skillStore) throw new Error('Skill store is not configured on this Runtime.');
    {
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
        sourceMd: skillMd,
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
      return {
        skill: summary,
        deduped: Boolean(existing),
        permissionDiff,
        reapprovalRequest,
      };
    }
  }

  private handleDeleteSkill(socket: Socket, frame: Frame): void {
    const payload = parseDeleteSkillPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.skillStore) {
      this.writeSkillStoreUnavailable(socket, frame);
      return;
    }
    try {
      const existing = this.skillStore.getVersion(payload.skillVersionId);
      if (!existing) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'skill.delete',
            payload: {},
            error: {
              code: ErrorCode.STORAGE_WRITE_FAILED,
              message: 'Skill version not found',
              detail: { reason: 'not_found', skillVersionId: payload.skillVersionId },
            },
          }),
        );
        return;
      }
      const result = this.skillStore.deleteVersion(payload.skillVersionId);
      const blockerCount =
        result.blockers.globalAgentIds.length +
        result.blockers.activeLegacyAgentVersionIds.length +
        result.blockers.authorizationGrantVersionIds.length +
        result.blockers.pendingApprovalIds.length;
      if (!result.deleted) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'skill.delete',
            payload: {},
            error: {
              code: ErrorCode.STORAGE_WRITE_FAILED,
              message:
                blockerCount > 0
                  ? 'Skill version is still equipped or authorized; remove references before uninstalling'
                  : 'Skill version could not be deleted',
              detail: { reason: blockerCount > 0 ? 'in_use' : 'delete_failed', ...result.blockers },
            },
          }),
        );
        return;
      }
      const event = this.appendEvent('provider', 'skill.deleted', {
        skillVersionId: existing.id,
        skillId: existing.skillId,
        name: existing.name,
        version: existing.version,
      });
      this.publishEvent(event);
      const response: DeleteSkillResponse = {
        deleted: true,
        skillVersionId: existing.id,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'skill.delete',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  /** Read one Skill version's full SKILL.md source for display (never executed). */
  private handleGetSkill(socket: Socket, frame: Frame): void {
    const payload = parseGetSkillPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.skillStore) {
      this.writeSkillStoreUnavailable(socket, frame);
      return;
    }
    try {
      const record = this.skillStore.getVersion(payload.skillVersionId);
      if (!record) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'skill.get',
            payload: {},
            error: {
              code: ErrorCode.STORAGE_WRITE_FAILED,
              message: 'Skill version not found',
              detail: { reason: 'not_found', skillVersionId: payload.skillVersionId },
            },
          }),
        );
        return;
      }
      const response: GetSkillResponse = {
        skill: this.toSkillVersionSummary(record),
        sourceMd: record.sourceMd,
        body: record.body,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'skill.get',
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
        const autoApproved = evaluationResponse.gate === 'auto-approve' && !payload.forceEnqueue;
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

      const autoApproved = evaluationResponse.gate === 'auto-approve' && !payload.forceEnqueue;
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

  private handleAttachMessageImages(socket: Socket, frame: Frame): void {
    const payload =
      frame.payload && typeof frame.payload === 'object' && !Array.isArray(frame.payload)
        ? (frame.payload as Record<string, unknown>)
        : {};
    const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
    const messageId = typeof payload.messageId === 'string' ? payload.messageId : '';
    const images = Array.isArray(payload.images)
      ? payload.images.filter(
          (image): image is { id: string; name: string; mimeType: string; storageRef: string } =>
            Boolean(
              image &&
              typeof image === 'object' &&
              typeof image.id === 'string' &&
              typeof image.name === 'string' &&
              typeof image.mimeType === 'string' &&
              image.mimeType.startsWith('image/') &&
              typeof image.storageRef === 'string' &&
              /^[A-Za-z0-9._-]+$/.test(image.storageRef),
            ),
        )
      : [];
    if (!threadId || !messageId || images.length === 0 || images.length > 8) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const task = this.workspaceStore?.getTaskByThreadId(threadId as ThreadId);
    try {
      const draft: EventDraft = {
        id: ulid() as Event['id'],
        workspaceId: task?.workspaceId ?? this.workspaceId,
        taskId: task?.id,
        messageId: messageId as MessageId,
        category: 'message',
        type: 'message.images-attached',
        occurredAt: new Date().toISOString(),
        payload: { threadId, messageId, images },
      };
      const committed = this.stateStore
        ? this.persistProjectedEvents([draft], this.threadVersions, this.demoRuns)
        : [this.appendEvent('message', draft.type, draft.payload, messageId as MessageId)];
      for (const event of committed) this.publishEvent(event);
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: { attached: images.length },
        }),
      );
    } catch {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: {},
          error: {
            code: ErrorCode.STORAGE_WRITE_FAILED,
            message: 'The runtime could not persist image attachments',
          },
        }),
      );
    }
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

    if (payload.agentVersionId !== undefined) {
      try {
        this.getRequiredAgentVersion(payload.agentVersionId);
      } catch (error) {
        this.writeProviderCommandError(socket, frame, error);
        return;
      }
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
      // Resolve bound conversation → global Agent (persona / default model).
      const boundConversation =
        persistedTask && this.conversationStore
          ? this.conversationStore.getByTaskId(persistedTask.id)
          : undefined;
      const conversationModelId =
        boundConversation?.track === 'model' &&
        typeof boundConversation.targetRef === 'string' &&
        boundConversation.targetRef.trim()
          ? boundConversation.targetRef.trim()
          : undefined;
      const globalAgentId =
        boundConversation?.track === 'agent' &&
        typeof boundConversation.targetRef === 'string' &&
        boundConversation.targetRef.trim()
          ? boundConversation.targetRef.trim()
          : undefined;
      const teamId =
        boundConversation?.track === 'team' &&
        typeof boundConversation.targetRef === 'string' &&
        boundConversation.targetRef.trim()
          ? boundConversation.targetRef.trim()
          : undefined;
      const explicitModelId =
        typeof payload.modelId === 'string' && payload.modelId.trim()
          ? payload.modelId.trim()
          : conversationModelId;
      const prepared = this.prepareRunBinding({
        runId: demoRunId,
        threadId: payload.threadId,
        userText: payload.text,
        modelId: explicitModelId,
        credentialRefId:
          typeof payload.credentialRefId === 'string' ? payload.credentialRefId : undefined,
        agentVersionId:
          typeof payload.agentVersionId === 'string' ? payload.agentVersionId : undefined,
        globalAgentId,
        teamId,
        reasoningEffort:
          typeof payload.reasoningEffort === 'string' ? payload.reasoningEffort : undefined,
        networkEnabled: payload.networkEnabled === true ? true : undefined,
        images: Array.isArray(payload.images)
          ? payload.images.map((raw) => ({
              name: raw.name,
              mimeType: raw.mimeType,
              ...(typeof raw.stagingPath === 'string' ? { stagingPath: raw.stagingPath } : {}),
              ...(typeof raw.dataUrl === 'string' ? { dataUrl: raw.dataUrl } : {}),
            }))
          : undefined,
      });
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
          tokenEstimate: prepared.tokenEstimate,
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
          globalAgentId: demoRun.globalAgentId,
          globalAgentName: demoRun.globalAgentName,
          packetId: prepared.packetId,
          protocol: demoRun.protocol,
          useFakeProvider: demoRun.useFakeProvider,
          idempotencyKey: demoRunId,
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
    if (demoRunId) void this.executeDemoRun(demoRunId);
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

    // Abort the live provider stream / tool loop first so executeDemoRun exits.
    this.demoRunAborts.get(payload.runId)?.abort();
    this.demoRunAborts.delete(payload.runId);
    // Drop any in-flight tool approvals for this run. Emit a decided event so
    // the shell card collapses instead of lingering as an orphan.
    for (const [approvalId, pending] of this.pendingToolApprovals) {
      if (pending.runId === payload.runId) {
        this.pendingToolApprovals.delete(approvalId);
        this.emitToolApprovalDecided({
          approvalId,
          threadId: pending.threadId,
          runId: pending.runId,
          decision: 'deny',
          reason: 'run-cancelled',
          toolCallId: pending.pendingToolCalls[pending.currentIndex]?.id,
          toolName: pending.pendingToolCalls[pending.currentIndex]?.name,
        });
        pending.resolve('deny');
      }
    }

    const projectedRuns = new Map(this.demoRuns);
    projectedRuns.delete(payload.runId);
    try {
      if (this.stateStore) {
        const event = this.persistProjectedEvent(
          {
            id: ulid() as Event['id'],
            workspaceId: this.resolveEventWorkspaceId(run.threadId),
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

  private scheduleOrchestrationDrain(runId: RunId, source: string): void {
    if (!this.scheduler) return;
    const task = this.scheduler
      .runUntilIdle(runId)
      .then(() => this.syncOrchestrationEvents())
      .catch(() => console.warn(`[runtime] orchestration ${source} failed`));
    this.trackBackgroundTask(task);
  }

  private scheduleOrchestrationRecovery(runId: RunId, source: string): void {
    if (!this.scheduler) return;
    const task = this.scheduler
      .recover(runId)
      .then(() => this.syncOrchestrationEvents())
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
      id: ulid(),
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
    const committed = this.stateStore.commitTransition({ events, checkpoint });
    if (committed.events.length === 0) {
      throw new Error('The event store returned an empty transition');
    }
    return committed.events;
  }

  private async executeDemoRun(runId: RunId): Promise<void> {
    const initialRun = this.demoRuns.get(runId);
    if (!initialRun || this.inFlight.has(runId)) return;
    this.recordInFlight(runId);
    const abort = new AbortController();
    this.demoRunAborts.set(runId, abort);
    try {
      // Multi-turn chat history + optional bound workspace for file tools.
      // Network tools can run without a project folder when Compose 联网 is on.
      let chatMessages = this.buildChatProviderMessages(initialRun);
      const workspaceRoot = this.resolveChatWorkspaceRoot(initialRun.threadId);
      const executionMode = this.resolveChatExecutionMode(initialRun.threadId);
      const networkEnabled = initialRun.networkEnabled === true;
      // Agent-management tools (create_agent / list_agent_resources) do not need
      // a bound project folder — only a configured global agent store.
      const agentToolsEnabled = Boolean(this.globalAgentStore);
      const toolsEnabled = Boolean(workspaceRoot) || networkEnabled || agentToolsEnabled;
      const pendingToolCalls: import('@sync-think/adapters').ProviderToolCall[] = [];
      let toolLoopRound = 0;
      const MAX_TOOL_ROUNDS = 8;
      /** Track repeated/failed tool batches so we can force a final answer. */
      let toolLoopSeenFingerprints = new Set<string>();
      let toolLoopStagnantRounds = 0;
      let forceFinalAnswer = false;
      let forceFinalReason: string | undefined;

      // Outer loop: re-enter after section 5.3 fallback walk selects the next model,
      // and after local tool execution feeds results back to the provider.
      while (this.demoRuns.has(runId)) {
        if (abort.signal.aborted) return;
        const attemptRun = this.demoRuns.get(runId);
        if (!attemptRun) return;

        try {
          let stream: AsyncIterable<import('@sync-think/adapters').AdapterEvent> | undefined;
          try {
            const finalTurn = forceFinalAnswer;
            stream = await this.openProviderStream(attemptRun, {
              messages: finalTurn
                ? [
                    ...chatMessages,
                    {
                      role: 'user',
                      content: buildForceFinalToolLoopMessage(
                        forceFinalReason ??
                          '工具循环已停止。请直接根据已有结果回复用户，本轮不要再调用工具。',
                      ),
                    },
                  ]
                : chatMessages,
              // When the guard forces a final turn, hide tools so the model must answer.
              toolsEnabled: finalTurn ? false : toolsEnabled,
              workspaceRoot,
              executionMode,
              networkEnabled,
              signal: abort.signal,
            });
            if (finalTurn) {
              // Consume at most one final no-tool turn.
              forceFinalAnswer = false;
              forceFinalReason = undefined;
            }
          } catch (error) {
            if (abort.signal.aborted || this.isAbortError(error)) return;
            const message = error instanceof Error ? error.message : 'provider stream failed';
            const failureClass = this.classifyThrownFailure(error);
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
          let resumeAfterFallback = false;
          let finishedWithToolRequests = false;
          pendingToolCalls.length = 0;
          let roundAssistantText = '';

          for await (const adapterEvent of stream) {
            if (abort.signal.aborted || !this.demoRuns.has(runId)) break;
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

            if (adapterEvent.type === 'tool-call') {
              pendingToolCalls.push(adapterEvent.toolCall);
            }
            if (adapterEvent.type === 'text-delta') {
              roundAssistantText += adapterEvent.text;
            }
            if (adapterEvent.type === 'finished' && adapterEvent.reason === 'tool-requests') {
              finishedWithToolRequests = true;
            }

            // When tools are requested, do not treat finished as terminal yet —
            // we still need a local tool loop + follow-up model turn.
            const suppressTerminal =
              finishedWithToolRequests &&
              toolsEnabled &&
              pendingToolCalls.length > 0 &&
              adapterEvent.type === 'finished';

            const projection = projectAdapterEvent(currentRun, adapterEvent);
            if (suppressTerminal) {
              // Keep run alive for the tool follow-up turn.
              projection.terminal = false;
              if (projection.type === 'run.completed') {
                // Convert synthetic completion into a non-terminal marker.
                projection.type = 'tool.turn_pending';
                projection.category = 'tool';
              }
            }

            // Enrich tool.requested payloads with NewMax-friendly fields.
            if (projection.type === 'tool.requested' && adapterEvent.type === 'tool-call') {
              projection.payload = {
                ...projection.payload,
                threadId: currentRun.threadId,
                toolCallId: adapterEvent.toolCall.id,
                toolName: adapterEvent.toolCall.name,
                arguments: (() => {
                  try {
                    return JSON.parse(adapterEvent.toolCall.argumentsJson || '{}');
                  } catch {
                    return {};
                  }
                })(),
              };
            }

            const projectedRuns = new Map(this.demoRuns);
            if (projection.terminal) projectedRuns.delete(runId);
            else if (projection.nextRun) projectedRuns.set(runId, projection.nextRun);
            const payload = { ...projection.payload };
            if (typeof payload.errorMessage === 'string') {
              const scrubbed = this.scrubDiagnosticMessage(payload.errorMessage);
              if (scrubbed) payload.errorMessage = scrubbed;
              else delete payload.errorMessage;
            }
            // Skip publishing the intermediate tool-turn marker to keep user UI clean.
            if (projection.type !== 'tool.turn_pending') {
              const event = this.persistProjectedEvent(
                {
                  id: ulid() as Event['id'],
                  workspaceId: this.resolveEventWorkspaceId(currentRun.threadId),
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
              }
            } else if (projection.nextRun) {
              this.demoRuns.set(runId, projection.nextRun);
            }
            providerEventIndex++;
            if (projection.terminal) break;
          }

          if (resumeAfterFallback) continue;

          // Local tool loop: execute requested tools and continue the model turn.
          // Project tools need workspaceRoot; network tools only need networkEnabled.
          if (
            finishedWithToolRequests &&
            toolsEnabled &&
            pendingToolCalls.length > 0 &&
            this.demoRuns.has(runId) &&
            toolLoopRound < MAX_TOOL_ROUNDS
          ) {
            toolLoopRound += 1;
            const currentRun = this.demoRuns.get(runId)!;
            const assistantParts: import('@sync-think/adapters').ProviderContentPart[] = [];
            if (roundAssistantText.trim()) {
              assistantParts.push({ type: 'text', text: roundAssistantText });
            }
            for (const toolCall of pendingToolCalls) {
              assistantParts.push({ type: 'tool-call', toolCall });
            }
            chatMessages = [
              ...chatMessages,
              {
                role: 'assistant',
                content:
                  assistantParts.length > 0 ? assistantParts : roundAssistantText || '（调用工具）',
              },
            ];

            const completedResults: Array<{ toolCallId: string; content: string }> = [];
            for (let toolIndex = 0; toolIndex < pendingToolCalls.length; toolIndex++) {
              const toolCall = pendingToolCalls[toolIndex]!;
              if (abort.signal.aborted || !this.demoRuns.has(runId)) return;

              // 「询问批准」：写/命令工具先挂起，等用户点批准/拒绝。
              // create_agent 在非 full-access 模式下同样先挂起（不依赖项目文件夹）。
              if (chatToolRequiresApproval(executionMode, toolCall.name)) {
                const isAgentTool =
                  CHAT_AGENT_TOOL_NAMES.has(toolCall.name) ||
                  CHAT_SKILL_TOOL_NAMES.has(toolCall.name) ||
                  CHAT_TEAM_TOOL_NAMES.has(toolCall.name);
                if (!workspaceRoot && !isAgentTool) {
                  const deniedText = JSON.stringify({
                    ok: false,
                    error: 'No project folder is bound; mutating tools are unavailable.',
                  });
                  this.publishToolCompleted(runId, currentRun.threadId, toolCall, deniedText);
                  completedResults.push({ toolCallId: toolCall.id, content: deniedText });
                  chatMessages = [
                    ...chatMessages,
                    { role: 'tool', toolCallId: toolCall.id, content: deniedText },
                  ];
                  continue;
                }
                const decision = await this.requestChatToolApproval({
                  runId,
                  threadId: currentRun.threadId,
                  workspaceRoot: workspaceRoot ?? '',
                  executionMode,
                  chatMessages,
                  pendingToolCalls: [...pendingToolCalls],
                  currentIndex: toolIndex,
                  completedResults: [...completedResults],
                  toolLoopRound,
                  toolCall,
                  signal: abort.signal,
                });
                if (abort.signal.aborted || !this.demoRuns.has(runId)) return;
                if (decision === 'deny') {
                  const deniedText = JSON.stringify({
                    ok: false,
                    error: chatToolDeniedMessage(executionMode, toolCall.name, 'denied'),
                    deniedBy: 'user',
                    executionMode: normalizeChatExecutionMode(executionMode),
                  });
                  this.publishToolCompleted(runId, currentRun.threadId, toolCall, deniedText);
                  completedResults.push({ toolCallId: toolCall.id, content: deniedText });
                  chatMessages = [
                    ...chatMessages,
                    { role: 'tool', toolCallId: toolCall.id, content: deniedText },
                  ];
                  continue;
                }
                // approved → fall through to execute
              } else if (!isChatToolAllowed(executionMode, toolCall.name, { networkEnabled })) {
                const deniedText = JSON.stringify({
                  ok: false,
                  error: chatToolDeniedMessage(executionMode, toolCall.name),
                  deniedBy: 'execution_mode',
                  executionMode: normalizeChatExecutionMode(executionMode),
                });
                this.publishToolCompleted(runId, currentRun.threadId, toolCall, deniedText);
                completedResults.push({ toolCallId: toolCall.id, content: deniedText });
                chatMessages = [
                  ...chatMessages,
                  { role: 'tool', toolCallId: toolCall.id, content: deniedText },
                ];
                continue;
              }

              // MCP tools (mcp__server__tool) go through the MCP pipeline; built-ins stay local.
              let resultText: string;
              const mcpDispatch =
                (currentRun as DemoRunState & {
                  mcpToolDispatch?: Map<string, { mcpServerId: string; toolName: string }>;
                }).mcpToolDispatch?.get(toolCall.name) ??
                parseMcpProviderToolName(toolCall.name);
              if (CHAT_PLAN_TOOL_NAMES.has(toolCall.name)) {
                resultText = executeChatPlanTool(toolCall.argumentsJson);
              } else if (CHAT_BROWSER_COMMAND_TOOL_NAMES.has(toolCall.name)) {
                // Interactive browser commands round-trip through the desktop
                // renderer (webview executor) with a 15s timeout.
                resultText = await this.executeChatBrowserCommandTool({
                  runId,
                  threadId: currentRun.threadId,
                  toolCall,
                  signal: abort.signal,
                });
              } else if (CHAT_BROWSER_TOOL_NAMES.has(toolCall.name)) {
                resultText = executeChatBrowserTool(toolCall.argumentsJson);
              } else if (CHAT_AGENT_TOOL_NAMES.has(toolCall.name)) {
                resultText = this.executeChatAgentTool({
                  run: currentRun,
                  toolCall,
                });
              } else if (CHAT_SKILL_TOOL_NAMES.has(toolCall.name)) {
                resultText = this.executeChatSkillTool({
                  run: currentRun,
                  toolCall,
                });
              } else if (CHAT_TEAM_TOOL_NAMES.has(toolCall.name)) {
                resultText = this.executeChatTeamTool({
                  run: currentRun,
                  toolCall,
                });
              } else if (mcpDispatch) {
                resultText = await this.executeChatBoundMcpTool({
                  run: currentRun,
                  mcpServerId: mcpDispatch.mcpServerId,
                  toolName: mcpDispatch.toolName,
                  argumentsJson: toolCall.argumentsJson,
                  signal: abort.signal,
                });
              } else {
                resultText = await executeChatBuiltInTool({
                  workspaceRoot,
                  toolCall,
                  signal: abort.signal,
                  networkEnabled,
                });
              }
              if (abort.signal.aborted || !this.demoRuns.has(runId)) return;
              // Publish full result for UI/trace; fold only the in-memory provider transcript.
              this.publishToolCompleted(runId, currentRun.threadId, toolCall, resultText);
              const foldedForModel = foldToolOutputText(resultText).text;
              completedResults.push({ toolCallId: toolCall.id, content: foldedForModel });
              chatMessages = [
                ...chatMessages,
                { role: 'tool', toolCallId: toolCall.id, content: foldedForModel },
              ];
            }

            // NewMax preventive: also fold older tool outputs still in the live loop transcript.
            chatMessages = foldLongToolOutputsInMessages(chatMessages).messages;

            const guard = evaluateToolLoopGuard({
              toolLoopRound,
              maxToolRounds: MAX_TOOL_ROUNDS,
              completedResults,
              seenFingerprints: toolLoopSeenFingerprints,
              stagnantRounds: toolLoopStagnantRounds,
            });
            toolLoopSeenFingerprints = guard.seenFingerprints;
            toolLoopStagnantRounds = guard.stagnantRounds;
            if (guard.kind === 'force_final') {
              forceFinalAnswer = true;
              forceFinalReason = guard.reason;
            } else if (guard.reason) {
              // Soft recovery hint (e.g. first all-unavailable batch) — keep tools on
              // but tell the model how to recover.
              chatMessages = [
                ...chatMessages,
                {
                  role: 'user',
                  content: `[tool-loop-hint]\n${guard.reason}`,
                },
              ];
            }

            // Reset adapter index so the follow-up stream is fully consumed.
            const live = this.demoRuns.get(runId);
            if (live) {
              this.demoRuns.set(runId, { ...live, nextAdapterEventIndex: 0 });
            }
            continue;
          }

          // Hit the round cap with pending tools still requested: one forced final turn.
          if (
            finishedWithToolRequests &&
            toolsEnabled &&
            pendingToolCalls.length > 0 &&
            this.demoRuns.has(runId) &&
            toolLoopRound >= MAX_TOOL_ROUNDS &&
            !forceFinalAnswer
          ) {
            forceFinalAnswer = true;
            forceFinalReason =
              `已达到工具轮次上限（${MAX_TOOL_ROUNDS}）。请停止调用工具，直接根据已有结果回复用户。`;
            const live = this.demoRuns.get(runId);
            if (live) {
              this.demoRuns.set(runId, { ...live, nextAdapterEventIndex: 0 });
            }
            continue;
          }

          return;
        } catch (error) {
          if (abort.signal.aborted || this.isAbortError(error)) return;
          const message = error instanceof Error ? error.message : 'provider stream failed';
          const current = this.demoRuns.get(runId);
          if (current) {
            const failureClass = this.classifyThrownFailure(error);
            const outcome = this.tryContinueWithFallback(runId, current, failureClass, message);
            if (outcome === 'continued') continue;
            if (outcome === 'paused') return;
          }
          this.persistDemoRunFailure(runId, 'unknown', message);
          return;
        }
      }
    } finally {
      this.demoRunAborts.delete(runId);
      this.forgetInFlight(runId);
    }
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

  /**
   * Assemble candidate sources for a model call. Protected task goal /
   * acceptance always enter selection (design section 20.9); overflow drops
   * compressible excerpts first and is visible on the Manifest.
   */
  private buildProtectedContextSelection(input: {
    runId: RunId;
    threadId: string;
    userText: string;
    tokenBudget?: number;
    /** Agent allowlist 鈥?only these Skill versions become skill-definition sources (搂9.1). */
    skillVersionIds?: readonly string[];
    /** Agent MCP allowlist 鈥?only these servers contribute tool-schema sources (搂9.3). */
    mcpServerIds?: readonly string[];
  }) {
    const task = this.resolveTaskForThread(input.threadId);
    const candidates: ContextSourceRef[] = [];
    const summaries: Array<{ sourceId: string; summary: string }> = [];

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
      id: `msg-${input.runId}`,
      kind: 'message-excerpt',
      tokenEstimate: Math.max(1, Math.ceil(input.userText.length / 4)),
    });
    summaries.push({
      sourceId: `msg-${input.runId}`,
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

    candidates.push({
      id: 'agent-instructions',
      kind: 'agent-instructions',
      tokenEstimate: 32,
    });
    summaries.push({
      sourceId: 'agent-instructions',
      summary: 'default conversation agent',
    });

    const selected = selectContextSources({
      candidates,
      tokenBudget: input.tokenBudget ?? 8_000,
      allowSoftTruncateKinds: [
        'message-excerpt',
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
    modelId?: string;
    credentialRefId?: string;
    agentVersionId?: string;
    /** Bound global Agent (mutable agent table) for persona / default model. */
    globalAgentId?: string;
    /** Bound team (team-track conversations) — coordinator drives the model. */
    teamId?: string;
    reasoningEffort?: string;
    networkEnabled?: boolean;
    images?: Array<{
      name: string;
      mimeType: string;
      stagingPath?: string;
      dataUrl?: string;
    }>;
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
    tokenEstimate: number;
    skillVersionIds: string[];
    mcpServerIds: string[];
    policyId?: string;
    agentVersion?: number;
  } {
    if (input.agentVersionId !== undefined && !this.agentStore) {
      throw new Error('AgentVersion exact lookup requires the Agent store');
    }
    // Team-track binding: the coordinator agent (fallback: first member) drives
    // the model/persona; the full roster is injected as an orchestration prompt.
    let teamRecord: ReturnType<NonNullable<typeof this.teamStore>['get']> | undefined;
    let effectiveGlobalAgentId = input.globalAgentId;
    if (input.teamId && this.teamStore) {
      teamRecord = this.teamStore.get(input.teamId as TeamId);
      if (!teamRecord) {
        throw new Error(`TEAM_NOT_FOUND: ${input.teamId}`);
      }
      if (!effectiveGlobalAgentId) {
        effectiveGlobalAgentId =
          teamRecord.coordinatorAgentId ?? teamRecord.members[0]?.agentId;
      }
    }
    const globalAgent =
      effectiveGlobalAgentId && this.globalAgentStore
        ? this.globalAgentStore.get(effectiveGlobalAgentId)
        : undefined;
    if (input.globalAgentId && !globalAgent) {
      throw new Error(`AGENT_NOT_FOUND: ${input.globalAgentId}`);
    }
    // Build the team orchestration prompt: mission + roster + strategy.
    const teamPromptBlock = teamRecord
      ? (() => {
          const memberLines = teamRecord.members.map((member) => {
            const agent = this.globalAgentStore?.get(member.agentId);
            const name = agent?.name ?? member.agentId;
            const parts = [
              `- ${name}`,
              member.title ? `（${member.title}）` : '',
              member.role ? `：${member.role}` : '',
              agent?.persona?.trim()
                ? `\n  人设摘要：${agent.persona.trim().slice(0, 160)}`
                : '',
              member.dependsOn.length > 0
                ? `\n  依赖：${member.dependsOn
                    .map((id) => this.globalAgentStore?.get(id)?.name ?? id)
                    .join('、')}`
                : '',
            ];
            return parts.join('');
          });
          const coordinatorName = teamRecord.coordinatorAgentId
            ? this.globalAgentStore?.get(teamRecord.coordinatorAgentId)?.name ??
              teamRecord.coordinatorAgentId
            : undefined;
          return [
            `你正在主持小队「${teamRecord.name}」的协作对话。`,
            teamRecord.mission ? `小队使命：${teamRecord.mission}` : '',
            `协作策略：${teamRecord.strategy}`,
            coordinatorName ? `协调人：${coordinatorName}（由你扮演）` : '',
            '成员名单：',
            ...memberLines,
            '',
            '协作规则：',
            '1. 按成员分工推进任务：需要某成员视角时，用「【成员名】：」开头的小节以该成员的角色和人设发言。',
            '2. 尊重依赖顺序 — 依赖未完成的成员先等待其前置产出。',
            '3. 每轮先给出简短的分工计划，再输出各成员的工作，最后由协调人汇总结论。',
            '4. 不要虚构成员没有的能力；成员的专长以其人设为准。',
          ]
            .filter(Boolean)
            .join('\n');
        })()
      : undefined;
    const agent = this.resolveAgentModelBinding(input.agentVersionId);
    // When a global agent is bound, its full config wins — including empty
    // fallback/skill/mcp arrays (explicit "none"), not "inherit legacy".
    const effectiveAgentBinding: typeof agent = globalAgent
      ? {
          ...agent,
          defaultModelId: (globalAgent.defaultModelId || agent.defaultModelId) as ModelId,
          fallbackModelIds: [...globalAgent.fallbackModelIds],
          defaultCredentialGroupId:
            globalAgent.defaultCredentialGroupId ?? agent.defaultCredentialGroupId,
        }
      : agent;
    const agentVersionId = effectiveAgentBinding.agentVersionId;
    const agentMeta = this.resolveAgentManifestMeta(agentVersionId);
    const effectiveSkillIds = globalAgent
      ? [...globalAgent.skillIds]
      : agentMeta.skillVersionIds;
    const effectiveMcpIds = globalAgent
      ? [...globalAgent.mcpServerIds]
      : agentMeta.mcpServerIds;

    const resolution = resolveModelBinding({
      agent: effectiveAgentBinding,
      runModelId: input.modelId ? (input.modelId as ModelId) : undefined,
    });

    let resolvedModelId =
      resolution.status === 'resolved' ? resolution.modelId : effectiveAgentBinding.defaultModelId;
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
      agent: effectiveAgentBinding,
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
      runId: input.runId,
      threadId: input.threadId,
      userText: input.userText,
      skillVersionIds: effectiveSkillIds,
      mcpServerIds: effectiveMcpIds,
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

    // Global agent reasoning default applies when Compose did not override.
    const reasoningEffort =
      input.reasoningEffort ??
      (globalAgent &&
      globalAgent.reasoningEffort &&
      globalAgent.reasoningEffort !== 'auto'
        ? globalAgent.reasoningEffort
        : undefined);

    // Resolve skill bodies for system-prompt injection (not just Manifest IDs).
    const skillPromptBlocks: string[] = [];
    if (this.skillStore && effectiveSkillIds.length > 0) {
      for (const skillId of effectiveSkillIds.slice(0, 8)) {
        let row = this.skillStore.getVersion(skillId);
        // global agent may store skillId / name rather than skillVersionId
        if (!row) {
          const byName = this.skillStore.findLatestByName(skillId);
          if (byName) row = byName;
        }
        if (!row) {
          // last resort: scan recent versions for matching skill_id
          const match = this.skillStore
            .listVersions(200)
            .find((v) => v.id === skillId || v.skillId === skillId);
          if (match) row = match;
        }
        if (row?.body?.trim()) {
          skillPromptBlocks.push(
            `### Skill: ${row.name}${row.version ? ` (${row.version})` : ''}\n${row.body.trim()}`,
          );
        }
      }
    }

    const run = createDemoRun(input.runId, input.threadId, input.userText, {
      modelId: resolvedModelId,
      providerModelId: modelRecord?.providerModelId ?? resolvedModelId,
      protocol: modelRecord?.protocol ?? 'openai-chat',
      baseUrl: provider?.baseUrl ?? 'https://fake.invalid/v1',
      providerId: provider?.id,
      credentialRefId: credential?.id,
      credentialResolutionSource: credentialResolution.source,
      agentVersionId,
      resolutionSource: source,
      globalAgentId: globalAgent?.id,
      globalAgentName: globalAgent?.name,
      persona: globalAgent?.persona?.trim() ? globalAgent.persona.trim() : undefined,
      teamId: teamRecord?.id,
      teamName: teamRecord?.name,
      teamPromptBlock,
      fallbackModelIds: effectiveAgentBinding.fallbackModelIds.map(String),
      skillPromptBlocks,
      skillVersionIds: effectiveSkillIds,
      mcpServerIds: effectiveMcpIds,
      reasoningEffort,
      networkEnabled: input.networkEnabled === true ? true : undefined,
      images: input.images,
      packetId: built.packet.id,
      proofHash: built.packet.proofHash,
      useFakeProvider: useFake,
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
      tokenEstimate: built.packet.tokenEstimate,
      skillVersionIds: [...effectiveSkillIds],
      mcpServerIds: [...effectiveMcpIds],
      policyId: agentMeta.policyId,
      agentVersion: agentMeta.agentVersion,
    };
  }

  /**
   * After a model call failure:
   * 1) Same-provider priority chain — walk *forward only* from the failed model
   *    (e.g. spare-1 → spare-2, never back to primary).
   * 2) Agent-configured fallbackModelIds (§5.3).
   * Never silent-swaps models; pauses when both chains are empty or exhausted.
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

    const scrubbedMessage = this.scrubDiagnosticMessage(errorMessage);
    const failedModelId = run.modelId as ModelId;

    // Layer 1: same-provider priority chain (forward-only from current model).
    if (this.providerStore) {
      const failedRecord = this.providerStore.getModel(failedModelId);
      if (failedRecord) {
        const ordered = this.providerStore
          .listModels(failedRecord.providerId)
          .slice()
          .sort((a, b) => a.priority - b.priority);
        const providerNext = resolveProviderPriorityFallback({
          orderedModelIds: ordered.map((m) => m.id as ModelId),
          failedModelId,
        });
        if (providerNext) {
          const nextRun = this.rebindRunToModel(
            run,
            providerNext.modelId,
            'providerFallback',
          );
          return this.persistFallbackContinuation(runId, run, nextRun, {
            failureClass,
            scrubbedMessage,
            fallbackIndex: providerNext.fallbackIndex,
            resolutionSource: 'providerFallback',
          });
        }
      }
    }

    // Layer 2: Agent-configured fallback chain.
    // Prefer the snapshot captured at run start (global agent fallbacks), then
    // fall back to the legacy agent_version binding.
    const legacyAgent = this.resolveAgentModelBinding(run.agentVersionId);
    const agent =
      run.fallbackModelIds && run.fallbackModelIds.length > 0
        ? {
            ...legacyAgent,
            fallbackModelIds: run.fallbackModelIds.map((id) => id as ModelId),
          }
        : legacyAgent;
    const resolution = resolveModelBinding({
      agent,
      failedModelId,
      failureClass,
    });

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
    return this.persistFallbackContinuation(runId, run, nextRun, {
      failureClass,
      scrubbedMessage,
      fallbackIndex: resolution.fallbackIndex,
      resolutionSource: resolution.source,
    });
  }

  /**
   * Persist run.fallback.selected + context.packet.built for any fallback layer
   * (provider priority or agent fallbackModelIds).
   */
  private persistFallbackContinuation(
    runId: RunId,
    run: DemoRunState,
    nextRun: DemoRunState,
    details: {
      failureClass: FailureClass;
      scrubbedMessage?: string;
      fallbackIndex?: number;
      resolutionSource: ModelResolutionSource | string;
    },
  ): 'continued' | 'failed' {
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
            failureClass: details.failureClass,
            ...(details.scrubbedMessage ? { errorMessage: details.scrubbedMessage } : {}),
            resolutionSource: nextRun.resolutionSource ?? details.resolutionSource,
            fallbackIndex: details.fallbackIndex,
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
            fallbackIndex: details.fallbackIndex,
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
      reasoningEffort: run.reasoningEffort,
      // Keep network + images on rebind so vision/web turns survive fallback walks.
      networkEnabled: run.networkEnabled === true ? true : undefined,
      images: run.images,
      packetId: built.packet.id,
      proofHash: built.packet.proofHash,
      nextAdapterEventIndex: 0,
      assistantText: '',
      reasoningText: '',
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
      this.recordRunDiagnostic(runId, run, {
        failureClass: details.failureClass,
        errorMessage: details.errorMessage,
        modelId: run.modelId,
        providerModelId: run.providerModelId,
        stage: 'paused',
        reason: details.reason,
      });
    } catch {
      console.warn('[runtime] demo Run pause could not be persisted');
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

  private buildChatProviderMessages(
    run: DemoRunState,
  ): import('@sync-think/adapters').ProviderMessage[] {
    const events = this.stateStore
      ? this.stateStore.listAllEvents
        ? this.stateStore.listAllEvents(0)
        : this.stateStore.listEvents(this.workspaceId, 0)
      : [];
    const resolvedImages = run.images
      ?.map((image) => {
        const dataUrl = resolveAppendMessageImageDataUrl(image);
        return dataUrl ? { name: image.name, mimeType: image.mimeType, dataUrl } : undefined;
      })
      .filter((image): image is { name: string; mimeType: string; dataUrl: string } =>
        Boolean(image),
      );
    return buildChatMessagesFromEvents(events, run.threadId, run.userText, resolvedImages);
  }

  /**
   * Chat-loop MCP dispatch (no orchestration step fence).
   * Bound servers only — schemas were already filtered by run.mcpServerIds.
   */
  private async executeChatBoundMcpTool(input: {
    run: DemoRunState;
    mcpServerId: string;
    toolName: string;
    argumentsJson?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    if (!this.mcpStore) {
      return JSON.stringify({
        ok: false,
        error: 'MCP store is not configured on this Runtime',
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
      });
    }
    // Enforce run allowlist when present.
    if (
      input.run.mcpServerIds &&
      input.run.mcpServerIds.length > 0 &&
      !input.run.mcpServerIds.includes(input.mcpServerId)
    ) {
      return JSON.stringify({
        ok: false,
        error: `MCP server ${input.mcpServerId} is not on this Agent's allowlist`,
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
      });
    }
    const row = this.mcpStore.get(input.mcpServerId);
    if (!row) {
      return JSON.stringify({
        ok: false,
        error: `MCP server not found: ${input.mcpServerId}`,
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
      });
    }
    const registered = (row.tools ?? []).map((t) => t.name);
    if (registered.length > 0 && !registered.includes(input.toolName)) {
      return JSON.stringify({
        ok: false,
        error: `Tool ${input.toolName} is not on MCP server ${row.name}`,
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
        registeredTools: registered,
      });
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
      maxOutputBytes: row.maxOutputBytes,
      timeoutMs: row.timeoutMs,
      trusted: row.trusted,
    });
    const worker = new LocalStdioMcpWorker();
    let completedOut: Record<string, unknown> | null = null;
    let failMessage = '';
    try {
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
          token: 'mcp-chat-tool',
          allowedRoot: process.cwd(),
          timeoutMs: policy.timeoutMs,
          signal: input.signal,
        },
      )) {
        if (ev.type === 'completed') {
          completedOut = ev.output as unknown as Record<string, unknown>;
        }
        if (ev.type === 'failed') {
          failMessage = String(ev.error?.message || ev.failureClass || 'MCP tool failed');
        }
      }
    } catch (error) {
      failMessage = error instanceof Error ? error.message : 'MCP tool failed';
    }

    if (failMessage) {
      return JSON.stringify({
        ok: false,
        error: failMessage,
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
        serverName: row.name,
      });
    }
    return JSON.stringify({
      ok: true,
      mcpServerId: input.mcpServerId,
      toolName: input.toolName,
      serverName: row.name,
      result: completedOut ?? {},
    });
  }

  private resolveChatWorkspaceRoot(threadId: string): string | undefined {
    const task = this.workspaceStore?.getTaskByThreadId(threadId as ThreadId);
    if (!task || !this.workspaceStore) return undefined;
    const workspace = this.workspaceStore.getWorkspace(task.workspaceId);
    const folder = workspace?.folderPath?.trim();
    return folder && folder.length > 0 ? folder : undefined;
  }

  /** Resolve conversation.executionMode for the task/thread (default workspace). */
  private resolveChatExecutionMode(threadId: string): string {
    const task = this.workspaceStore?.getTaskByThreadId(threadId as ThreadId);
    if (!task || !this.conversationStore) return 'workspace';
    const conversation = this.conversationStore.getByTaskId(task.id);
    return normalizeChatExecutionMode(conversation?.executionMode);
  }

  private resolveEventWorkspaceId(threadId: string): WorkspaceId {
    const task = this.workspaceStore?.getTaskByThreadId(threadId as ThreadId);
    return task?.workspaceId ?? this.workspaceId;
  }

  private isAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const name = 'name' in error ? String((error as { name?: unknown }).name ?? '') : '';
    const message = error instanceof Error ? error.message : String(error);
    return name === 'AbortError' || /aborted|abort(ed)?|cancell?ed/i.test(message);
  }

  private publishToolCompleted(
    runId: RunId,
    threadId: string,
    toolCall: import('@sync-think/adapters').ProviderToolCall,
    resultText: string,
  ): void {
    let failed = false;
    let errorSummary: string | undefined;
    try {
      const parsed = JSON.parse(resultText) as unknown;
      if (parsed && typeof parsed === 'object') {
        const result = parsed as Record<string, unknown>;
        failed = result.ok === false;
        if (failed && typeof result.error === 'string') errorSummary = result.error;
      }
    } catch {
      failed = /<tool_use_error>|tool execution failed/i.test(resultText);
    }
    const completedEvent = this.persistProjectedEvent(
      {
        id: ulid() as Event['id'],
        workspaceId: this.resolveEventWorkspaceId(threadId),
        runId,
        category: 'tool',
        type: 'tool.completed',
        occurredAt: new Date().toISOString(),
        payload: {
          threadId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: resultText,
          ...(failed ? { failed: true } : {}),
          ...(errorSummary ? { errorSummary: this.scrubDiagnosticMessage(errorSummary) } : {}),
        },
      },
      new Map(this.demoRuns),
    );
    this.publishEvent(completedEvent);
  }

  /**
   * Agent-management chat tools: list_agent_resources / create_agent.
   * create_agent reaches here only after the permission gate passed
   * (full-access, or user approved the tool card in other modes).
   */
  private executeChatAgentTool(input: {
    run: DemoRunState;
    toolCall: import('@sync-think/adapters').ProviderToolCall;
  }): string {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(input.toolCall.argumentsJson || '{}') as Record<string, unknown>;
    } catch {
      return JSON.stringify({ ok: false, error: 'Invalid tool arguments JSON' });
    }

    if (!this.globalAgentStore) {
      return JSON.stringify({
        ok: false,
        error: 'Agent store is not configured on this Runtime.',
      });
    }

    if (input.toolCall.name === 'list_agent_resources') {
      const models = (this.providerStore?.listAllModels() ?? []).map((model) => ({
        id: model.id,
        displayName: model.displayName,
        providerId: model.providerId,
      }));
      const approvedSkills = (this.skillStore?.listVersions(100) ?? [])
        .filter(
          (skill) =>
            !skill.archivedAt && this.skillStore?.isPermissionApproved(skill.id) === true,
        )
        .map((skill) => ({
          skillVersionId: skill.id,
          name: skill.name,
          version: skill.version,
        }));
      const existingAgents = this.globalAgentStore
        .list()
        .map((agent) => ({ id: agent.id, name: agent.name }));
      return JSON.stringify({
        ok: true,
        currentConversationModelId: input.run.modelId,
        models,
        approvedSkills,
        existingAgents,
        note: 'Use these ids in create_agent. skillIds must be approved skillVersionId values (max 8).',
      });
    }

    // Shared helpers for create/update: resolve skill ids by exact version id or
    // by skill name (latest approved). Returns an error string on failure.
    const resolveSkillIds = (
      raw: unknown,
    ): { ok: true; skillIds: string[] } | { ok: false; error: string } => {
      const rawSkillIds = Array.isArray(raw)
        ? raw.map((v) => String(v).trim()).filter(Boolean)
        : [];
      const resolved: string[] = [];
      for (const item of rawSkillIds) {
        const exact = this.skillStore?.getVersion(item);
        if (exact && !exact.archivedAt) {
          if (!resolved.includes(exact.id)) resolved.push(exact.id);
          continue;
        }
        const byName = this.skillStore?.findLatestByName(item);
        if (byName && !byName.archivedAt) {
          if (!resolved.includes(byName.id)) resolved.push(byName.id);
          continue;
        }
        return {
          ok: false,
          error: `Skill not found: ${item}. Call list_agent_resources for approved skill versions.`,
        };
      }
      return { ok: true, skillIds: resolved };
    };

    // Resolve an update/archive target by exact agent id, then by unique
    // non-archived agent name. Ambiguity or miss is a hard error — never guess.
    const resolveAgentTarget = (
      raw: unknown,
    ):
      | { ok: true; agent: NonNullable<ReturnType<SqliteGlobalAgentStore['get']>> }
      | { ok: false; error: string } => {
      const ref = typeof raw === 'string' ? raw.trim() : '';
      if (!ref) {
        return { ok: false, error: 'agent is required: pass an exact agent id or unique agent name.' };
      }
      const byId = this.globalAgentStore!.get(ref);
      if (byId) return { ok: true, agent: byId };
      const matches = this.globalAgentStore!
        .list()
        .filter((a) => a.name.trim().toLowerCase() === ref.toLowerCase());
      if (matches.length === 1) return { ok: true, agent: matches[0]! };
      if (matches.length > 1) {
        return {
          ok: false,
          error: `Agent name "${ref}" is ambiguous (${matches.length} matches). Use the exact agent id from list_agent_resources.`,
        };
      }
      return {
        ok: false,
        error: `Agent not found: ${ref}. Call list_agent_resources to see existing agents.`,
      };
    };

    if (input.toolCall.name === 'create_agent') {
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      if (!name) {
        return JSON.stringify({ ok: false, error: 'name is required and must be non-empty' });
      }
      const requestedModelId =
        typeof args.defaultModelId === 'string' && args.defaultModelId.trim()
          ? args.defaultModelId.trim()
          : '';
      const defaultModelId = requestedModelId || input.run.modelId;
      if (requestedModelId && this.providerStore) {
        const model = this.providerStore.getModel(requestedModelId);
        if (!model) {
          return JSON.stringify({
            ok: false,
            error: `Model not found: ${requestedModelId}. Call list_agent_resources for valid model ids.`,
          });
        }
      }
      // Resolve skillIds: accept exact skillVersionId, or a skill name (latest
      // approved version). Reject anything unresolvable so the model can retry.
      const rawSkillIds = Array.isArray(args.skillIds)
        ? args.skillIds.map((v) => String(v).trim()).filter(Boolean)
        : [];
      const resolvedSkillIds: string[] = [];
      for (const raw of rawSkillIds) {
        const exact = this.skillStore?.getVersion(raw);
        if (exact && !exact.archivedAt) {
          if (!resolvedSkillIds.includes(exact.id)) resolvedSkillIds.push(exact.id);
          continue;
        }
        const byName = this.skillStore?.findLatestByName(raw);
        if (byName && !byName.archivedAt) {
          if (!resolvedSkillIds.includes(byName.id)) resolvedSkillIds.push(byName.id);
          continue;
        }
        return JSON.stringify({
          ok: false,
          error: `Skill not found: ${raw}. Call list_agent_resources for approved skill versions.`,
        });
      }
      const reasoningEffort =
        typeof args.reasoningEffort === 'string' &&
        ['auto', 'low', 'medium', 'high'].includes(args.reasoningEffort)
          ? args.reasoningEffort
          : undefined;
      try {
        // Same validation as the UI path: ≤8 skills, versions exist & approved.
        this.assertGlobalAgentSkillVersions(resolvedSkillIds);
        const created = this.globalAgentStore.create({
          name,
          defaultModelId: defaultModelId as ModelId,
          persona: typeof args.persona === 'string' ? args.persona : undefined,
          description: typeof args.description === 'string' ? args.description : undefined,
          skillIds: resolvedSkillIds,
          reasoningEffort,
        });
        const agent = this.toGlobalAgentSummary(created);
        const event = this.appendEvent('system', 'globalAgent.created', {
          agentId: agent.id,
          name: agent.name,
          createdVia: 'chat-tool',
          threadId: input.run.threadId,
        });
        this.publishEvent(event);
        return JSON.stringify({
          ok: true,
          agent: {
            id: agent.id,
            name: agent.name,
            defaultModelId: created.defaultModelId,
            skillIds: created.skillIds,
          },
          note: '智能体已写入智能体库。用户可在「智能体库」查看/编辑，或直接用它开新对话。',
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : 'create_agent failed',
        });
      }
    }

    if (input.toolCall.name === 'update_agent') {
      const target = resolveAgentTarget(args.agent);
      if (!target.ok) return JSON.stringify({ ok: false, error: target.error });
      const current = target.agent;

      const changedFields: string[] = [];

      let nextName: string | undefined;
      if (typeof args.name === 'string') {
        nextName = args.name.trim();
        if (!nextName) {
          return JSON.stringify({ ok: false, error: 'name must be non-empty when provided' });
        }
        if (nextName !== current.name) {
          const collision = this.globalAgentStore
            .list({ includeArchived: true })
            .find(
              (a) =>
                a.id !== current.id &&
                a.name.trim().toLowerCase() === nextName!.toLowerCase(),
            );
          if (collision) {
            return JSON.stringify({
              ok: false,
              error: `Another agent is already named "${nextName}" (${collision.id}). Pick a different name.`,
            });
          }
          changedFields.push('name');
        }
      }

      let nextModelId: string | undefined;
      if (typeof args.defaultModelId === 'string' && args.defaultModelId.trim()) {
        nextModelId = args.defaultModelId.trim();
        if (this.providerStore && !this.providerStore.getModel(nextModelId)) {
          return JSON.stringify({
            ok: false,
            error: `Model not found: ${nextModelId}. Call list_agent_resources for valid model ids.`,
          });
        }
        if (nextModelId !== current.defaultModelId) changedFields.push('defaultModelId');
      }

      let nextSkillIds: string[] | undefined;
      if (args.skillIds !== undefined) {
        const resolved = resolveSkillIds(args.skillIds);
        if (!resolved.ok) return JSON.stringify({ ok: false, error: resolved.error });
        nextSkillIds = resolved.skillIds;
        changedFields.push('skillIds');
      }

      const nextPersona = typeof args.persona === 'string' ? args.persona : undefined;
      if (nextPersona !== undefined && nextPersona !== current.persona) changedFields.push('persona');
      const nextDescription =
        typeof args.description === 'string' ? args.description : undefined;
      if (nextDescription !== undefined && nextDescription !== current.description) {
        changedFields.push('description');
      }
      const nextReasoningEffort =
        typeof args.reasoningEffort === 'string' &&
        ['auto', 'low', 'medium', 'high'].includes(args.reasoningEffort)
          ? args.reasoningEffort
          : undefined;
      if (nextReasoningEffort !== undefined && nextReasoningEffort !== current.reasoningEffort) {
        changedFields.push('reasoningEffort');
      }

      if (
        nextName === undefined &&
        nextModelId === undefined &&
        nextSkillIds === undefined &&
        nextPersona === undefined &&
        nextDescription === undefined &&
        nextReasoningEffort === undefined
      ) {
        return JSON.stringify({
          ok: false,
          error: 'No fields to update. Pass at least one of name / persona / description / defaultModelId / skillIds / reasoningEffort.',
        });
      }

      try {
        // Same validation as the UI path: ≤8 skills, versions exist & approved.
        this.assertGlobalAgentSkillVersions(nextSkillIds);
        const updated = this.globalAgentStore.update({
          agentId: current.id,
          name: nextName,
          persona: nextPersona,
          description: nextDescription,
          defaultModelId: nextModelId as ModelId | undefined,
          skillIds: nextSkillIds,
          reasoningEffort: nextReasoningEffort,
        });
        const agent = this.toGlobalAgentSummary(updated);
        const event = this.appendEvent('system', 'globalAgent.updated', {
          agentId: agent.id,
          name: agent.name,
          archived: agent.archived,
          updatedVia: 'chat-tool',
          changedFields,
          threadId: input.run.threadId,
        });
        this.publishEvent(event);
        return JSON.stringify({
          ok: true,
          agent: {
            id: agent.id,
            name: agent.name,
            defaultModelId: updated.defaultModelId,
            skillIds: updated.skillIds,
          },
          changedFields,
          note: '智能体已更新。用户可在「智能体库」查看最新配置。',
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : 'update_agent failed',
        });
      }
    }

    if (input.toolCall.name === 'archive_agent') {
      const target = resolveAgentTarget(args.agent);
      if (!target.ok) return JSON.stringify({ ok: false, error: target.error });
      const current = target.agent;
      if (current.archived) {
        return JSON.stringify({
          ok: false,
          error: `Agent「${current.name}」is already archived.`,
        });
      }
      // Never archive the agent bound to the CURRENT conversation.
      if (input.run.globalAgentId && input.run.globalAgentId === current.id) {
        return JSON.stringify({
          ok: false,
          error: `Agent「${current.name}」is the agent of the CURRENT conversation and cannot be archived from within it. Ask the user to switch conversations first or archive it in the Agent Library UI.`,
        });
      }
      const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
      try {
        const updated = this.globalAgentStore.update({
          agentId: current.id,
          archived: true,
        });
        const agent = this.toGlobalAgentSummary(updated);
        const event = this.appendEvent('system', 'globalAgent.updated', {
          agentId: agent.id,
          name: agent.name,
          archived: true,
          archivedVia: 'chat-tool',
          reason: reason || undefined,
          threadId: input.run.threadId,
        });
        this.publishEvent(event);
        return JSON.stringify({
          ok: true,
          agent: { id: agent.id, name: agent.name, archived: true },
          note: '智能体已归档（软删除）。用户可在「智能体库」的已归档列表中随时恢复。',
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : 'archive_agent failed',
        });
      }
    }

    return JSON.stringify({ ok: false, error: `Unsupported agent tool: ${input.toolCall.name}` });
  }

  /**
   * Skill-management chat tools: list_skills / read_skill / create_skill /
   * update_skill / delete_skill. Mutations reach here only after the
   * permission gate passed (full-access, or approved on the approval card).
   * Import parses text only — scripts are never executed (§9.2).
   */
  private executeChatSkillTool(input: {
    run: DemoRunState;
    toolCall: import('@sync-think/adapters').ProviderToolCall;
  }): string {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(input.toolCall.argumentsJson || '{}') as Record<string, unknown>;
    } catch {
      return JSON.stringify({ ok: false, error: 'Invalid tool arguments JSON' });
    }
    if (!this.skillStore) {
      return JSON.stringify({ ok: false, error: 'Skill store is not configured on this Runtime.' });
    }

    if (input.toolCall.name === 'list_skills') {
      const skills = this.skillStore.listVersions(200).map((record) => ({
        skillVersionId: record.id,
        skillId: record.skillId,
        name: record.name,
        description: record.description,
        version: record.version,
        allowedTools: record.allowedTools,
        hasScripts: record.hasScripts,
        archived: Boolean(record.archivedAt),
        permissionApproved: this.skillStore!.isPermissionApproved(record.id),
        createdAt: record.createdAt,
      }));
      return JSON.stringify({
        ok: true,
        skills,
        note: 'Use skillVersionId in read_skill / delete_skill. update_skill needs the full new SKILL.md with the same name and a bumped version.',
      });
    }

    if (input.toolCall.name === 'read_skill') {
      const ref = typeof args.skillVersionId === 'string' ? args.skillVersionId.trim() : '';
      if (!ref) {
        return JSON.stringify({ ok: false, error: 'skillVersionId is required' });
      }
      const record = this.skillStore.getVersion(ref) ?? this.skillStore.findLatestByName(ref);
      if (!record) {
        return JSON.stringify({
          ok: false,
          error: `Skill not found: ${ref}. Call list_skills for installed versions.`,
        });
      }
      return JSON.stringify({
        ok: true,
        skill: {
          skillVersionId: record.id,
          name: record.name,
          version: record.version,
          allowedTools: record.allowedTools,
        },
        sourceMd: record.sourceMd,
      });
    }

    if (input.toolCall.name === 'create_skill' || input.toolCall.name === 'update_skill') {
      const skillMd = typeof args.skillMd === 'string' ? args.skillMd : '';
      if (!skillMd.trim()) {
        return JSON.stringify({ ok: false, error: 'skillMd is required (full SKILL.md source)' });
      }
      if (skillMd.length > 512_000) {
        return JSON.stringify({ ok: false, error: 'SKILL.md exceeds the 512,000 character limit' });
      }
      try {
        const result = this.importSkillMdCore(skillMd);
        // update_skill on a name that doesn't exist yet is really a create —
        // surface that so the model can tell the user what actually happened.
        const note = result.deduped
          ? '相同内容的版本已存在，未创建重复版本。'
          : result.reapprovalRequest
            ? `已导入「${result.skill.name}」@${result.skill.version}。本次工具权限扩大，已提交审批（批准前不会生效新增权限）。`
            : `已导入「${result.skill.name}」@${result.skill.version}。用户可在「能力中心」查看，或装备给智能体。`;
        return JSON.stringify({
          ok: true,
          skill: {
            skillVersionId: result.skill.skillVersionId,
            skillId: result.skill.skillId,
            name: result.skill.name,
            version: result.skill.version,
            allowedTools: result.skill.allowedTools,
          },
          deduped: result.deduped,
          requiresReapproval: Boolean(result.reapprovalRequest),
          note,
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error:
            error instanceof Error
              ? `SKILL.md invalid or import failed: ${error.message}`
              : 'SKILL.md import failed',
        });
      }
    }

    if (input.toolCall.name === 'delete_skill') {
      const ref = typeof args.skillVersionId === 'string' ? args.skillVersionId.trim() : '';
      if (!ref) {
        return JSON.stringify({ ok: false, error: 'skillVersionId is required' });
      }
      const existing = this.skillStore.getVersion(ref);
      if (!existing) {
        return JSON.stringify({
          ok: false,
          error: `Skill version not found: ${ref}. Call list_skills for installed versions.`,
        });
      }
      const result = this.skillStore.deleteVersion(ref);
      if (!result.deleted) {
        const blockerCount =
          result.blockers.globalAgentIds.length +
          result.blockers.activeLegacyAgentVersionIds.length +
          result.blockers.authorizationGrantVersionIds.length +
          result.blockers.pendingApprovalIds.length;
        return JSON.stringify({
          ok: false,
          error:
            blockerCount > 0
              ? `该版本仍被引用（${result.blockers.globalAgentIds.length} 个智能体装备 / ${result.blockers.pendingApprovalIds.length} 个待审批）。请先解除绑定，不要重试。`
              : '卸载失败。',
          blockers: result.blockers,
        });
      }
      const event = this.appendEvent('provider', 'skill.deleted', {
        skillVersionId: existing.id,
        skillId: existing.skillId,
        name: existing.name,
        version: existing.version,
        deletedVia: 'chat-tool',
        threadId: input.run.threadId,
      });
      this.publishEvent(event);
      return JSON.stringify({
        ok: true,
        skillVersionId: existing.id,
        note: `已卸载「${existing.name}」@${existing.version}。`,
      });
    }

    return JSON.stringify({ ok: false, error: `Unsupported skill tool: ${input.toolCall.name}` });
  }

  /**
   * Team-management chat tools: list_teams / create_team / update_team /
   * delete_team. Mutations reach here only after the permission gate passed
   * (full-access, or user approved the tool card in other modes).
   */
  private executeChatTeamTool(input: {
    run: DemoRunState;
    toolCall: import('@sync-think/adapters').ProviderToolCall;
  }): string {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(input.toolCall.argumentsJson || '{}') as Record<string, unknown>;
    } catch {
      return JSON.stringify({ ok: false, error: 'Invalid tool arguments JSON' });
    }
    if (!this.teamStore) {
      return JSON.stringify({ ok: false, error: 'Team store is not configured on this Runtime.' });
    }

    // Agent name lookup for member summaries + member resolution.
    const agentNameById = new Map<string, string>();
    if (this.globalAgentStore) {
      for (const agent of this.globalAgentStore.list({ includeArchived: true })) {
        agentNameById.set(agent.id, agent.name);
      }
    }

    if (input.toolCall.name === 'list_teams') {
      const teams = this.teamStore.list().map((record) => ({
        id: record.id,
        name: record.name,
        mission: record.mission,
        strategy: record.strategy,
        coordinatorAgentId: record.coordinatorAgentId,
        members: record.members.map((member) => ({
          agentId: member.agentId,
          agentName: agentNameById.get(member.agentId) ?? '',
          title: member.title,
          role: member.role,
          dependsOn: member.dependsOn,
        })),
      }));
      return JSON.stringify({
        ok: true,
        teams,
        note: 'Use these team ids in update_team / delete_team, and list_agent_resources agent ids in members.',
      });
    }

    // Resolve a member/coordinator agent by exact id, then by unique
    // non-archived agent name. Ambiguity or miss is a hard error — never guess.
    const resolveAgentRef = (
      raw: unknown,
    ): { ok: true; agentId: AgentId } | { ok: false; error: string } => {
      const ref = typeof raw === 'string' ? raw.trim() : '';
      if (!ref) return { ok: false, error: 'agent reference must be non-empty' };
      if (!this.globalAgentStore) {
        return { ok: false, error: 'Agent store is not configured on this Runtime.' };
      }
      const byId = this.globalAgentStore.get(ref);
      if (byId && !byId.archived) return { ok: true, agentId: byId.id };
      const matches = this.globalAgentStore
        .list()
        .filter((a) => a.name.trim().toLowerCase() === ref.toLowerCase());
      if (matches.length === 1) return { ok: true, agentId: matches[0]!.id };
      if (matches.length > 1) {
        return {
          ok: false,
          error: `Agent name "${ref}" is ambiguous (${matches.length} matches). Use the exact agent id from list_agent_resources.`,
        };
      }
      return {
        ok: false,
        error: `Agent not found or archived: ${ref}. Call list_agent_resources to see existing agents.`,
      };
    };

    // Resolve an update/delete target by exact team id, then by unique team name.
    const resolveTeamTarget = (
      raw: unknown,
    ):
      | { ok: true; team: NonNullable<ReturnType<SqliteTeamStore['get']>> }
      | { ok: false; error: string } => {
      const ref = typeof raw === 'string' ? raw.trim() : '';
      if (!ref) {
        return { ok: false, error: 'team is required: pass an exact team id or unique team name.' };
      }
      const byId = this.teamStore!.get(ref);
      if (byId) return { ok: true, team: byId };
      const matches = this.teamStore!
        .list()
        .filter((t) => t.name.trim().toLowerCase() === ref.toLowerCase());
      if (matches.length === 1) return { ok: true, team: matches[0]! };
      if (matches.length > 1) {
        return {
          ok: false,
          error: `Team name "${ref}" is ambiguous (${matches.length} matches). Use the exact team id from list_teams.`,
        };
      }
      return { ok: false, error: `Team not found: ${ref}. Call list_teams to see existing teams.` };
    };

    // Resolve a raw members array into storage TeamMemberInput rows.
    const resolveMembers = (
      raw: unknown,
    ):
      | { ok: true; members: import('@sync-think/storage').TeamMemberInput[] }
      | { ok: false; error: string } => {
      const rawMembers = Array.isArray(raw) ? raw : [];
      if (rawMembers.length > 8) {
        return { ok: false, error: 'members supports at most 8 entries.' };
      }
      const members: import('@sync-think/storage').TeamMemberInput[] = [];
      const idsInRoster = new Set<string>();
      for (const rawMember of rawMembers) {
        const rec = rawMember as Record<string, unknown>;
        const agent = resolveAgentRef(rec?.agent);
        if (!agent.ok) return { ok: false, error: agent.error };
        if (idsInRoster.has(agent.agentId)) {
          return { ok: false, error: `Duplicate team member: ${agent.agentId}` };
        }
        idsInRoster.add(agent.agentId);
        members.push({
          agentId: agent.agentId,
          role: typeof rec?.role === 'string' && rec.role.trim() ? rec.role.trim() : undefined,
          title: typeof rec?.title === 'string' ? rec.title.trim() : undefined,
          dependsOn: [],
        });
      }
      // Second pass: dependsOn entries may reference members by id or name and
      // must resolve to agents inside the roster.
      for (let i = 0; i < rawMembers.length; i++) {
        const rec = rawMembers[i] as Record<string, unknown>;
        const rawDeps = Array.isArray(rec?.dependsOn) ? rec.dependsOn : [];
        const deps: AgentId[] = [];
        for (const rawDep of rawDeps) {
          const dep = resolveAgentRef(rawDep);
          if (!dep.ok) return { ok: false, error: dep.error };
          if (!idsInRoster.has(dep.agentId)) {
            return {
              ok: false,
              error: `dependsOn target ${String(rawDep)} is not a member of this team.`,
            };
          }
          if (dep.agentId === members[i]!.agentId) {
            return { ok: false, error: `Member ${members[i]!.agentId} cannot depend on itself.` };
          }
          if (!deps.includes(dep.agentId)) deps.push(dep.agentId);
        }
        members[i]!.dependsOn = deps;
      }
      return { ok: true, members };
    };

    if (input.toolCall.name === 'create_team') {
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      if (!name) {
        return JSON.stringify({ ok: false, error: 'name is required and must be non-empty' });
      }
      const collision = this.teamStore
        .list()
        .find((t) => t.name.trim().toLowerCase() === name.toLowerCase());
      if (collision) {
        return JSON.stringify({
          ok: false,
          error: `Another team is already named "${name}" (${collision.id}). Pick a different name.`,
        });
      }
      const strategy =
        args.strategy === 'parallel' ? ('parallel' as const) : ('serial' as const);
      const resolved = resolveMembers(args.members);
      if (!resolved.ok) return JSON.stringify({ ok: false, error: resolved.error });
      let coordinatorAgentId: AgentId | undefined;
      if (typeof args.coordinatorAgent === 'string' && args.coordinatorAgent.trim()) {
        const coordinator = resolveAgentRef(args.coordinatorAgent);
        if (!coordinator.ok) return JSON.stringify({ ok: false, error: coordinator.error });
        if (!resolved.members.some((m) => m.agentId === coordinator.agentId)) {
          return JSON.stringify({
            ok: false,
            error: 'coordinatorAgent must also be listed in members.',
          });
        }
        coordinatorAgentId = coordinator.agentId;
      }
      try {
        const created = this.teamStore.create({
          name,
          mission: typeof args.mission === 'string' ? args.mission : undefined,
          strategy,
          coordinatorAgentId,
          members: resolved.members,
        });
        const team = this.toTeamSummary(created);
        const event = this.appendEvent('system', 'team.created', {
          teamId: team.id,
          name: team.name,
          memberCount: team.members.length,
          createdVia: 'chat-tool',
          threadId: input.run.threadId,
        });
        this.publishEvent(event);
        return JSON.stringify({
          ok: true,
          team: {
            id: team.id,
            name: team.name,
            strategy: team.strategy,
            memberCount: team.members.length,
          },
          note: '小队已写入小队库。用户可在「小队库」查看/编辑，或直接用它开新对话。',
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : 'create_team failed',
        });
      }
    }

    if (input.toolCall.name === 'update_team') {
      const target = resolveTeamTarget(args.team);
      if (!target.ok) return JSON.stringify({ ok: false, error: target.error });
      const current = target.team;

      const changedFields: string[] = [];

      let nextName: string | undefined;
      if (typeof args.name === 'string') {
        nextName = args.name.trim();
        if (!nextName) {
          return JSON.stringify({ ok: false, error: 'name must be non-empty when provided' });
        }
        if (nextName !== current.name) {
          const collision = this.teamStore
            .list()
            .find(
              (t) =>
                t.id !== current.id && t.name.trim().toLowerCase() === nextName!.toLowerCase(),
            );
          if (collision) {
            return JSON.stringify({
              ok: false,
              error: `Another team is already named "${nextName}" (${collision.id}). Pick a different name.`,
            });
          }
          changedFields.push('name');
        }
      }

      const nextMission = typeof args.mission === 'string' ? args.mission : undefined;
      if (nextMission !== undefined && nextMission !== current.mission) {
        changedFields.push('mission');
      }
      const nextStrategy =
        args.strategy === 'serial' || args.strategy === 'parallel' ? args.strategy : undefined;
      if (nextStrategy !== undefined && nextStrategy !== current.strategy) {
        changedFields.push('strategy');
      }

      let nextMembers: import('@sync-think/storage').TeamMemberInput[] | undefined;
      if (args.members !== undefined) {
        const resolved = resolveMembers(args.members);
        if (!resolved.ok) return JSON.stringify({ ok: false, error: resolved.error });
        nextMembers = resolved.members;
        changedFields.push('members');
      }

      let nextCoordinator: AgentId | null | undefined;
      if (typeof args.coordinatorAgent === 'string') {
        const ref = args.coordinatorAgent.trim();
        if (!ref) {
          nextCoordinator = null;
        } else {
          const coordinator = resolveAgentRef(ref);
          if (!coordinator.ok) return JSON.stringify({ ok: false, error: coordinator.error });
          const finalRoster =
            nextMembers ?? current.members.map((m) => ({ agentId: m.agentId }));
          if (!finalRoster.some((m) => m.agentId === coordinator.agentId)) {
            return JSON.stringify({
              ok: false,
              error: 'coordinatorAgent must be a member of the final roster.',
            });
          }
          nextCoordinator = coordinator.agentId;
        }
        if (nextCoordinator !== (current.coordinatorAgentId ?? null)) {
          changedFields.push('coordinatorAgentId');
        }
      }

      if (
        nextName === undefined &&
        nextMission === undefined &&
        nextStrategy === undefined &&
        nextMembers === undefined &&
        nextCoordinator === undefined
      ) {
        return JSON.stringify({
          ok: false,
          error:
            'No fields to update. Pass at least one of name / mission / strategy / coordinatorAgent / members.',
        });
      }

      try {
        const updated = this.teamStore.update({
          teamId: current.id,
          name: nextName,
          mission: nextMission,
          strategy: nextStrategy,
          coordinatorAgentId: nextCoordinator,
          members: nextMembers,
        });
        const team = this.toTeamSummary(updated);
        const event = this.appendEvent('system', 'team.updated', {
          teamId: team.id,
          name: team.name,
          memberCount: team.members.length,
          updatedVia: 'chat-tool',
          changedFields,
          threadId: input.run.threadId,
        });
        this.publishEvent(event);
        return JSON.stringify({
          ok: true,
          team: {
            id: team.id,
            name: team.name,
            strategy: team.strategy,
            memberCount: team.members.length,
          },
          changedFields,
          note: '小队已更新。用户可在「小队库」查看最新配置；已开始的运行仍按开跑时的成员快照执行。',
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : 'update_team failed',
        });
      }
    }

    if (input.toolCall.name === 'delete_team') {
      const target = resolveTeamTarget(args.team);
      if (!target.ok) return JSON.stringify({ ok: false, error: target.error });
      const current = target.team;
      // Never delete the team bound to the CURRENT conversation.
      if (input.run.teamId && input.run.teamId === current.id) {
        return JSON.stringify({
          ok: false,
          error: `Team「${current.name}」is the team of the CURRENT conversation and cannot be deleted from within it. Ask the user to switch conversations first or delete it in the Team Library UI.`,
        });
      }
      // Same guard as the UI path: refuse while conversations still reference
      // this team — historical chats would silently lose their team identity.
      if (this.conversationStore) {
        const referenced = this.conversationStore
          .list({ track: 'team', includeArchived: true })
          .filter((c) => c.targetRef === current.id && !c.archivedAt);
        if (referenced.length > 0) {
          return JSON.stringify({
            ok: false,
            error: `小队「${current.name}」仍被 ${referenced.length} 个对话引用，请先归档或删除这些对话后再删除小队。`,
          });
        }
      }
      const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
      try {
        this.teamStore.delete(current.id);
        const event = this.appendEvent('system', 'team.deleted', {
          teamId: current.id,
          name: current.name,
          deletedVia: 'chat-tool',
          reason: reason || undefined,
          threadId: input.run.threadId,
        });
        this.publishEvent(event);
        return JSON.stringify({
          ok: true,
          team: { id: current.id, name: current.name },
          note: `小队「${current.name}」已删除。`,
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : 'delete_team failed',
        });
      }
    }

    return JSON.stringify({ ok: false, error: `Unsupported team tool: ${input.toolCall.name}` });
  }

  /**
   * Persist + publish tool.approval_decided so the shell approval card always
   * collapses — including cancel/abort paths that used to deny silently and
   * leave an orphan card that then failed with「没有待处理的工具批准请求」.
   */
  private emitToolApprovalDecided(input: {
    approvalId: string;
    threadId: string;
    runId: RunId;
    decision: 'approve' | 'deny';
    reason?: string;
    toolCallId?: string;
    toolName?: string;
  }): void {
    const payload: Record<string, unknown> = {
      approvalId: input.approvalId,
      threadId: input.threadId,
      runId: input.runId,
      decision: input.decision,
      reason: input.reason,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
    };
    try {
      if (this.stateStore) {
        const event = this.persistProjectedEvent(
          {
            id: ulid() as Event['id'],
            workspaceId: this.resolveEventWorkspaceId(input.threadId),
            runId: input.runId,
            category: 'approval',
            type: 'tool.approval_decided',
            occurredAt: new Date().toISOString(),
            payload,
          },
          new Map(this.demoRuns),
        );
        this.publishEvent(event);
      } else {
        const event = this.appendEvent(
          'approval',
          'tool.approval_decided',
          payload,
          undefined,
          input.runId,
        );
        this.publishEvent(event);
      }
    } catch {
      // Approval cleanup must never crash a cancel/abort path.
    }
  }

  /**
   * Pause the tool loop under「询问批准」until the user approves/denies.
   * Emits tool.approval_requested for the shell confirmation card.
   */
  private requestChatToolApproval(input: {
    runId: RunId;
    threadId: string;
    workspaceRoot: string;
    executionMode: string;
    chatMessages: import('@sync-think/adapters').ProviderMessage[];
    pendingToolCalls: import('@sync-think/adapters').ProviderToolCall[];
    currentIndex: number;
    completedResults: Array<{ toolCallId: string; content: string }>;
    toolLoopRound: number;
    toolCall: import('@sync-think/adapters').ProviderToolCall;
    signal: AbortSignal;
  }): Promise<'approve' | 'deny'> {
    const approvalId = `tappr-${ulid()}`;
    const summary = summarizeToolCallForApproval(
      input.toolCall.name,
      input.toolCall.argumentsJson || '{}',
    );

    const event = this.persistProjectedEvent(
      {
        id: ulid() as Event['id'],
        workspaceId: this.resolveEventWorkspaceId(input.threadId),
        runId: input.runId,
        category: 'approval',
        type: 'tool.approval_requested',
        occurredAt: new Date().toISOString(),
        payload: {
          approvalId,
          threadId: input.threadId,
          runId: input.runId,
          toolCallId: input.toolCall.id,
          toolName: input.toolCall.name,
          arguments: (() => {
            try {
              return JSON.parse(input.toolCall.argumentsJson || '{}');
            } catch {
              return {};
            }
          })(),
          title: summary.title,
          detail: summary.detail,
          path: summary.path,
          command: summary.command,
          executionMode: normalizeChatExecutionMode(input.executionMode),
        },
      },
      new Map(this.demoRuns),
    );
    this.publishEvent(event);

    return new Promise<'approve' | 'deny'>((resolve) => {
      const onAbort = () => {
        // Only emit decided if the pending entry is still ours — run.cancel
        // already removed + emitted for its own runs.
        if (this.pendingToolApprovals.delete(approvalId)) {
          this.emitToolApprovalDecided({
            approvalId,
            threadId: input.threadId,
            runId: input.runId,
            decision: 'deny',
            reason: 'run-aborted',
            toolCallId: input.toolCall.id,
            toolName: input.toolCall.name,
          });
        }
        resolve('deny');
      };
      if (input.signal.aborted) {
        this.emitToolApprovalDecided({
          approvalId,
          threadId: input.threadId,
          runId: input.runId,
          decision: 'deny',
          reason: 'run-aborted',
          toolCallId: input.toolCall.id,
          toolName: input.toolCall.name,
        });
        resolve('deny');
        return;
      }
      input.signal.addEventListener('abort', onAbort, { once: true });
      this.pendingToolApprovals.set(approvalId, {
        approvalId,
        runId: input.runId,
        threadId: input.threadId,
        workspaceRoot: input.workspaceRoot,
        executionMode: input.executionMode,
        chatMessages: input.chatMessages,
        pendingToolCalls: input.pendingToolCalls,
        currentIndex: input.currentIndex,
        completedResults: input.completedResults,
        toolLoopRound: input.toolLoopRound,
        resolve: (decision) => {
          input.signal.removeEventListener('abort', onAbort);
          resolve(decision);
        },
        createdAt: new Date().toISOString(),
      });
    });
  }

  private handleConversationDecideToolApproval(socket: Socket, frame: Frame): void {
    const payload = parseConversationDecideToolApprovalPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const pending = this.pendingToolApprovals.get(payload.approvalId);
    if (!pending) {
      // Not in the in-memory map: idempotent replay or an orphan card left by a
      // runtime restart / cancelled run. Resolve gracefully instead of erroring.
      let priorDecision: 'approve' | 'deny' | undefined;
      let orphanRequested:
        | { threadId: string; runId: RunId; toolCallId?: string; toolName?: string }
        | undefined;
      for (let i = this.events.length - 1; i >= 0; i--) {
        const event = this.events[i];
        if (event.payload?.approvalId !== payload.approvalId) continue;
        if (event.type === 'tool.approval_decided') {
          const d = event.payload.decision;
          priorDecision = d === 'approve' || d === 'deny' ? d : 'deny';
          break;
        }
        if (event.type === 'tool.approval_requested' && !orphanRequested) {
          orphanRequested = {
            threadId: typeof event.payload.threadId === 'string' ? event.payload.threadId : '',
            runId: (typeof event.payload.runId === 'string'
              ? event.payload.runId
              : event.runId) as RunId,
            toolCallId:
              typeof event.payload.toolCallId === 'string' ? event.payload.toolCallId : undefined,
            toolName:
              typeof event.payload.toolName === 'string' ? event.payload.toolName : undefined,
          };
        }
      }
      if (priorDecision) {
        // Already decided — idempotent success so double-clicks don't error.
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'conversation.decideToolApproval',
            payload: { approvalId: payload.approvalId, decision: priorDecision },
          }),
        );
        return;
      }
      if (orphanRequested) {
        // Requested but the waiting loop is gone (restart / cancel). Emit a
        // deny-decided so the stale card collapses, then acknowledge.
        this.emitToolApprovalDecided({
          approvalId: payload.approvalId,
          threadId: orphanRequested.threadId,
          runId: orphanRequested.runId,
          decision: 'deny',
          reason: 'stale-approval',
          toolCallId: orphanRequested.toolCallId,
          toolName: orphanRequested.toolName,
        });
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'conversation.decideToolApproval',
            payload: { approvalId: payload.approvalId, decision: 'deny' },
          }),
        );
        return;
      }
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.decideToolApproval',
          payload: {},
          error: {
            code: ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
            message: '没有待处理的工具批准请求（可能已过期或已处理）',
          },
        }),
      );
      return;
    }

    this.pendingToolApprovals.delete(payload.approvalId);
    const decidedEvent = this.persistProjectedEvent(
      {
        id: ulid() as Event['id'],
        workspaceId: this.resolveEventWorkspaceId(pending.threadId),
        runId: pending.runId,
        category: 'approval',
        type: 'tool.approval_decided',
        occurredAt: new Date().toISOString(),
        payload: {
          approvalId: payload.approvalId,
          threadId: pending.threadId,
          runId: pending.runId,
          decision: payload.decision,
          toolCallId: pending.pendingToolCalls[pending.currentIndex]?.id,
          toolName: pending.pendingToolCalls[pending.currentIndex]?.name,
        },
      },
      new Map(this.demoRuns),
    );
    this.publishEvent(decidedEvent);

    pending.resolve(payload.decision);

    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'conversation.decideToolApproval',
        payload: {
          approvalId: payload.approvalId,
          decision: payload.decision,
          runId: pending.runId,
        },
      }),
    );
  }

  /**
   * Execute an interactive browser tool (browser_click / browser_type /
   * browser_read / browser_screenshot) by round-tripping through the desktop
   * renderer: emit browser.command_requested with a requestId, wait for
   * conversation.submitBrowserResult (same reverse channel pattern as the
   * approval cards), resolve with the renderer's JSON result. 15s timeout —
   * covers "panel not open / webview not ready" with a clear recovery hint.
   */
  private async executeChatBrowserCommandTool(input: {
    runId: RunId;
    threadId: string;
    toolCall: import('@sync-think/adapters').ProviderToolCall;
    signal: AbortSignal;
  }): Promise<string> {
    const validated = validateChatBrowserCommand(
      input.toolCall.name,
      input.toolCall.argumentsJson || '{}',
    );
    if (!validated.ok) {
      return JSON.stringify({ ok: false, error: validated.error });
    }

    const requestId = `brw-${ulid()}`;
    const event = this.persistProjectedEvent(
      {
        id: ulid() as Event['id'],
        workspaceId: this.resolveEventWorkspaceId(input.threadId),
        runId: input.runId,
        category: 'tool',
        type: 'browser.command_requested',
        occurredAt: new Date().toISOString(),
        payload: {
          requestId,
          threadId: input.threadId,
          runId: input.runId,
          toolCallId: input.toolCall.id,
          toolName: input.toolCall.name,
          action: validated.command.action,
          args: validated.command.args,
        },
      },
      new Map(this.demoRuns),
    );
    this.publishEvent(event);

    const outcome = await new Promise<{ ok: boolean; resultJson?: string; error?: string }>(
      (resolve) => {
        const finish = (result: { ok: boolean; resultJson?: string; error?: string }) => {
          if (!this.pendingBrowserCommands.delete(requestId)) return;
          clearTimeout(timer);
          input.signal.removeEventListener('abort', onAbort);
          resolve(result);
        };
        const onAbort = () => finish({ ok: false, error: '运行已中止。' });
        const timer = setTimeout(() => {
          finish({
            ok: false,
            error:
              `浏览器面板 ${BROWSER_COMMAND_TIMEOUT_MS / 1000} 秒内没有响应。` +
              '右栏浏览器可能未打开或页面尚未加载完成——请先用 browser_open 打开目标页面，等待加载后重试。',
          });
        }, BROWSER_COMMAND_TIMEOUT_MS);
        this.pendingBrowserCommands.set(requestId, {
          requestId,
          runId: input.runId,
          threadId: input.threadId,
          toolName: input.toolCall.name,
          resolve: finish,
          createdAt: new Date().toISOString(),
        });
        if (input.signal.aborted) onAbort();
        else input.signal.addEventListener('abort', onAbort, { once: true });
      },
    );

    if (!outcome.ok) {
      return JSON.stringify({ ok: false, error: outcome.error ?? 'Browser command failed.' });
    }
    // Renderer already sends JSON; re-wrap defensively and cap the size.
    let raw = outcome.resultJson ?? '{}';
    if (raw.length > BROWSER_COMMAND_RESULT_MAX_CHARS) {
      raw = raw.slice(0, BROWSER_COMMAND_RESULT_MAX_CHARS);
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return JSON.stringify({ ok: true, ...parsed });
    } catch {
      return JSON.stringify({ ok: true, result: raw });
    }
  }

  /** Renderer reverse channel: deliver a browser command result to the waiting tool loop. */
  private handleConversationSubmitBrowserResult(socket: Socket, frame: Frame): void {
    const payload = parseConversationSubmitBrowserResultPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const pending = this.pendingBrowserCommands.get(payload.requestId);
    if (pending) {
      pending.resolve({
        ok: payload.ok,
        resultJson: payload.resultJson,
        error: payload.error,
      });
    }
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'conversation.submitBrowserResult',
        payload: { requestId: payload.requestId, accepted: Boolean(pending) },
      }),
    );
  }

  private async openProviderStream(
    run: DemoRunState,
    options: {
      messages?: import('@sync-think/adapters').ProviderMessage[];
      toolsEnabled?: boolean;
      workspaceRoot?: string;
      executionMode?: string;
      networkEnabled?: boolean;
      signal?: AbortSignal;
      /** When set, replaces the default coding/chat system prompt (used by compact). */
      systemPromptOverride?: string;
    } = {},
  ): Promise<AsyncIterable<import('@sync-think/adapters').AdapterEvent> | undefined> {
    const signal = options.signal ?? new AbortController().signal;
    const executionMode = normalizeChatExecutionMode(options.executionMode);
    const networkEnabled = options.networkEnabled === true || run.networkEnabled === true;
    const hasProjectTools = Boolean(options.toolsEnabled && options.workspaceRoot);
    // MCP tools bound on the run — expose schemas to the provider when tools are on.
    const mcpExtra = (() => {
      if (!options.toolsEnabled || !this.mcpStore || !run.mcpServerIds?.length) {
        return { tools: [] as import('@sync-think/adapters').ProviderToolSchema[], dispatch: new Map<string, { mcpServerId: string; toolName: string }>() };
      }
      const servers = run.mcpServerIds
        .map((id) => this.mcpStore?.get(id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .map((row) => ({
          id: row.id,
          name: row.name,
          tools: row.tools,
        }));
      return mcpToolsToProviderSchemas(servers, { maxTools: 16 });
    })();
    // Stash dispatch on the run for the tool loop (in-memory only).
    if (mcpExtra.dispatch.size > 0) {
      (run as DemoRunState & { mcpToolDispatch?: Map<string, { mcpServerId: string; toolName: string }> }).mcpToolDispatch =
        mcpExtra.dispatch;
    }
    const agentToolsEnabled = Boolean(options.toolsEnabled && this.globalAgentStore);
    const tools =
      options.toolsEnabled &&
      (hasProjectTools || networkEnabled || agentToolsEnabled || mcpExtra.tools.length > 0)
        ? [
            ...toolsForExecutionMode(executionMode, {
              networkEnabled,
              includeProjectTools: hasProjectTools,
              includeAgentTools: agentToolsEnabled,
              extraTools: mcpExtra.tools,
            }),
          ]
        : undefined;
    const networkPrompt = networkEnabled
      ? [
          'Web tools are ENABLED for this turn (web_search, web_fetch, browser_open, browser_click, browser_type, browser_read, browser_screenshot).',
          'Use web_search for current facts, then web_fetch to READ a static page. Cite URLs you used.',
          'Built-in browser panel: browser_open SHOWS a page to the user beside the chat (e.g. 用户说「打开/看看这个网站」).',
          'To OPERATE that live page: browser_click clicks an element (CSS selector or x/y), browser_type fills an input (selector + text), browser_read returns the live page title/URL/visible text and link+button summary (works on logged-in / JS-rendered pages where web_fetch cannot).',
          'ALWAYS browser_open the page first and browser_read to locate elements before clicking/typing. These actions run visibly in front of the user and need no approval.',
          'browser_screenshot saves a PNG under the project folder and returns embedUrl + path — embed it in your markdown reply as ![说明](embedUrl). 典型用法：操作网页后输出带截图的评审报告（每个关键步骤截一张图并配文字说明）。',
        ].join('\n')
      : 'Web tools are DISABLED. Do not claim you browsed the live web; answer from knowledge or ask the user to enable 联网.';
    const agentCreationPrompt = agentToolsEnabled
      ? [
          'Agent Library tools are ENABLED (list_agent_resources, create_agent, update_agent, archive_agent):',
          '- When the user asks to 创建智能体/新建智能体/入库, FIRST call list_agent_resources to get valid model ids and approved skill versions, THEN call create_agent with a complete draft (name, persona, description, defaultModelId, skillIds).',
          '- When the user asks to 修改/调整某个智能体, FIRST call list_agent_resources to confirm the target agent id, THEN call update_agent with ONLY the fields to change. skillIds is full-replace: include the complete final set.',
          '- When the user asks to 删除/归档某个智能体, use archive_agent (soft-delete, restorable in the Agent Library). There is NO hard-delete tool; never claim you deleted permanently. The agent of the CURRENT conversation cannot be archived.',
          executionMode === 'full-access'
            ? '- Permission mode is full-access: create/update/archive execute immediately without extra confirmation. Still show the user exactly what you changed.'
            : '- Permission mode is NOT full-access: create_agent / update_agent / archive_agent will pause and show the user an approval card. Wait for their decision; if denied, do not retry — hand them the draft/diff instead.',
          '- skillIds must be approved skill version ids from list_agent_resources (max 8). Never invent ids.',
          '- Resolve update/archive targets by exact agent id when possible; names must be unique or the call fails.',
          '- Do NOT search the repository for a hidden createAgent API — use these tools.',
          'Skill capability-center tools are ENABLED (list_skills, read_skill, create_skill, update_skill, delete_skill):',
          '- When the user asks to 创建 Skill, write a complete SKILL.md (frontmatter: name / description / version / optional allowed-tools + markdown body with the workflow rules), then call create_skill.',
          '- When the user asks to 修改 Skill, FIRST call read_skill to get the current source, edit it, bump the version, and call update_skill. Old versions are kept; equipped agents stay on their pinned version until rebound.',
          '- When the user asks to 删除/卸载 Skill, call list_skills to find the exact skillVersionId, then delete_skill. If it is still equipped by an agent the call fails — report that instead of retrying.',
          '- Importing only parses text; scripts are never executed. Expanding allowed-tools enqueues a separate permission approval automatically.',
          executionMode === 'full-access'
            ? '- Skill mutations execute immediately in full-access mode.'
            : '- Skill mutations (create_skill / update_skill / delete_skill) pause on an approval card outside full-access. If denied, hand the user the SKILL.md draft instead.',
          'Team Library tools are ENABLED (list_teams, create_team, update_team, delete_team):',
          '- When the user asks to 创建小队/组队, FIRST call list_teams and list_agent_resources to confirm existing teams and valid agent ids, THEN call create_team with a complete draft (name, mission, strategy, members with agent/title/role/dependsOn).',
          '- When the user asks to 修改某个小队, FIRST call list_teams to confirm the target team id, THEN call update_team with ONLY the fields to change. members is full-replace: include the complete final roster.',
          '- When the user asks to 删除某个小队, use delete_team. It fails while the team still has runs or is referenced by conversations — report that instead of retrying. The team of the CURRENT conversation cannot be deleted.',
          executionMode === 'full-access'
            ? '- Team mutations execute immediately in full-access mode.'
            : '- Team mutations (create_team / update_team / delete_team) pause on an approval card outside full-access. If denied, hand the user the roster draft instead.',
        ].join('\n')
      : [
          'Agent Library tools are unavailable in this Runtime.',
          '- If the user asks to 创建智能体, offer a concrete draft (name, persona, default model, skills) they can save manually in the Agent Library UI.',
        ].join('\n');
    const planToolPrompt = [
      'Task checklist (update_task_plan):',
      '- For any request needing 2+ distinct steps, call update_task_plan FIRST with the full step list (first step in_progress), and call it again with the FULL updated list每当 a step completes or the plan changes.',
      '- Titles: short imperative Chinese, ≤40 chars. Do not use it for trivial single-step answers.',
      '- This tool only updates the progress UI — it never touches files and needs no approval.',
    ].join('\n');
    const productBoundaryPrompt = [
      'Product capability boundaries (SYNC-THINK / this desktop shell):',
      agentCreationPrompt,
      planToolPrompt,
      '- Prefer built-in tools list_files / read_file / git_status / git_diff. Do not call rg/ripgrep/fd/ag — they are often missing on Windows and will fail with ENOENT.',
      '- If a tool fails as unavailable, do not retry the same command; change approach or answer with what you already know.',
      '- Avoid long pure-exploration loops. After a few targeted looks, give the user a useful answer.',
    ].join('\n');
    const agentIdentityPrompt = run.teamPromptBlock
      ? [
          run.globalAgentName
            ? `You are the Agent「${run.globalAgentName}」in SYNC-THINK, acting as the team coordinator.`
            : undefined,
          run.persona ? `Coordinator persona:\n${run.persona}` : undefined,
          run.teamPromptBlock,
        ]
          .filter(Boolean)
          .join('\n\n')
      : run.globalAgentName
        ? [
            `You are the Agent「${run.globalAgentName}」in SYNC-THINK.`,
            run.persona
              ? `Follow this persona / system instructions exactly:\n${run.persona}`
              : 'Stay in character for this Agent across the whole conversation.',
            'Answer as this Agent. Do not claim to be a different agent unless the user reassigns you.',
          ].join('\n')
        : run.persona
          ? `Persona / system instructions:\n${run.persona}`
          : undefined;
    // Skill bodies from the bound agent — must reach the model, not only Manifest IDs.
    const skillPrompt =
      run.skillPromptBlocks && run.skillPromptBlocks.length > 0
        ? ['Bound Skills (follow these instructions when relevant):', ...run.skillPromptBlocks].join(
            '\n\n',
          )
        : undefined;
    const defaultSystemPrompt = options.workspaceRoot
      ? [
          agentIdentityPrompt ??
            'You are a coding assistant with filesystem tools for the bound project folder.',
          skillPrompt,
          `Project folder: ${options.workspaceRoot}`,
          `Permission mode: ${executionMode}` +
            (executionMode === 'ask'
              ? ' (「询问批准」: you MAY call write_file / run_command; the user will be prompted to approve each mutating action before it runs. Prefer read-only tools when enough.)'
              : ' (write_file / run_command auto-allowed inside the project folder).'),
          'Use tools when needed. Paths are relative to the project folder. Prefer tools over guessing file contents.',
          productBoundaryPrompt,
          networkPrompt,
        ]
          .filter(Boolean)
          .join('\n')
      : [
          agentIdentityPrompt ?? 'You are a helpful assistant.',
          skillPrompt,
          'No project folder is bound for this conversation, so filesystem tools are unavailable.',
          'If the user asks about local project files, tell them to open/select a project folder first.',
          productBoundaryPrompt,
          networkPrompt,
        ]
          .filter(Boolean)
          .join('\n');
    const systemPrompt =
      typeof options.systemPromptOverride === 'string' && options.systemPromptOverride.trim()
        ? options.systemPromptOverride.trim()
        : defaultSystemPrompt;
    const requestExtras = {
      messages: options.messages,
      tools,
      systemPrompt,
    };

    // Diagnostic: confirm multimodal parts actually reached the provider request.
    if (run.images && run.images.length > 0) {
      const msgs = options.messages ?? [];
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
      const imageParts =
        lastUser && Array.isArray(lastUser.content)
          ? lastUser.content.filter((p) => p.type === 'image').length
          : 0;
      console.log('[runtime] vision: provider request', {
        modelId: run.providerModelId,
        protocol: run.protocol,
        runImages: run.images.length,
        lastUserImageParts: imageParts,
        useFakeProvider: run.useFakeProvider,
      });
      if (imageParts === 0) {
        console.warn('[runtime] vision: run has images but last user message has no image parts');
      }
    }

    if (run.useFakeProvider || !run.providerId) {
      if (!this.demoProvider) return undefined;
      return this.demoProvider.call(
        createDemoProviderRequest(run, 'fake-provider-no-secret', signal, requestExtras),
      );
    }
    if (!this.providerStore || !this.secureStore || !run.credentialRefId) {
      if (this.demoProvider) {
        return this.demoProvider.call(
          createDemoProviderRequest(run, 'fake-provider-no-secret', signal, requestExtras),
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
    return adapter.call(createDemoProviderRequest(run, apiKey, signal, requestExtras));
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
    for (const run of this.demoRuns.values()) void this.executeDemoRun(run.runId);
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
  ): Event {
    const draft: EventDraft = {
      id: ulid() as Event['id'],
      workspaceId: this.workspaceId,
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
        if (this.scheduler) {
          const recovery = this.scheduler
            .recoverAll()
            .then(() => this.syncOrchestrationEvents())
            .catch(() => console.warn('[runtime] orchestration recovery failed'));
          this.trackBackgroundTask(recovery);
        }
        resolve();
      });
      this.server.on('error', (e) => reject(e));
    });
  }

  async stop(): Promise<void> {
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

function toTaskSummary(task: TaskRecord): TaskSummary {
  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
    parentTaskId: task.parentTaskId,
    title: task.title,
    goal: task.goal,
    status: task.status,
    participationMode: task.participationMode,
    taskVersion: task.version,
    threadId: task.threadId,
    lastOpenedAt: task.lastOpenedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
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
