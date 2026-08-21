// Runtime - long-lived Agent Runtime process entry. UI lifecycle independent:
// killing the UI must not terminate active Runs (design �?6 / �?).

import { existsSync, readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
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
  type EventReplayCursor,
  type EventReplayPagePayload,
  type EventStreamStartedPayload,
  type Frame,
  type SetParticipationModeResponse,
  type UnarchiveTaskResponse,
  type SavePolicyResponse,
  type SavePolicyPayload,
  type ListPoliciesResponse,
  type ListPoliciesPayload,
  type PolicyScopeRef,
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
  type ImportSkillPayload,
  type ImportSkillResponse,
  type ImportRemoteSkillResponse,
  type SkillPermissionDiffSummary,
  type DeleteSkillResponse,
  type SetSkillEnabledResponse,
  type SkillVersionSummary,
  type RegisterMcpServerResponse,
  type RegisterRemoteMcpResponse,
  type SetMcpServerEnabledResponse,
  type DeleteMcpServerResponse,
  type CapabilityWorkspaceListResponse,
  type CapabilityWorkspaceSetActiveResponse,
  type CapabilityGovernanceListResponse,
  type SaveSkillPublishDraftResponse,
  type ListSkillPublishDraftsResponse,
  type GetSkillPublishDraftResponse,
  type SubmitSkillPublishDraftResponse,
  type PreviewCapabilityOrganizeResponse,
  type GetLatestCapabilityOrganizeResponse,
  type CapabilityWorkspaceActivationSummary,
  type CapabilityUsageSummary,
  type SkillPublishDraftSummary,
  type CapabilityOrganizeReportSummary,
  type ProbeMcpPolicyResponse,
  type RequestMcpToolResponse,
  type ProbeMcpSpawnResponse,
  type CallMcpToolResponse,
  type RefreshMcpToolsResponse,
  type RefreshMcpToolsPayload,
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
  type GoalSetResponse,
  type GoalGetResponse,
  type GoalClearResponse,
  type GoalResumeResponse,
  type GoalStatus,
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
  type ConversationListMessagesResponse,
  type ConversationGetContextStatusResponse,
  parseConversationGetContextStatusPayload,
  type ConversationResponse,
  type ConversationPlanResponse,
  type ConversationPlanApproveResponse,
  type ConversationAskPendingResponse,
  type AskQuestion,
  type CreateScheduledTaskPayload,
  type ListScheduledTasksPayload,
  type ListScheduledTasksResponse,
  type UpdateScheduledTaskPayload,
  type DeleteScheduledTaskPayload,
  type TriggerScheduledTaskPayload,
  type TriggerScheduledTaskResponse,
  type ListScheduledTaskHistoryPayload,
  type ListScheduledTaskHistoryResponse,
  type SkillLocalScanPayload,
  type SkillLocalScanResponse,
  type SkillLocalImportPayload,
  type SkillLocalImportResponse,
  type LocalSkillCandidate,
  type AssistantTurnSegment,
  type ConversationTransientFrame,
  type ConversationTransientSnapshot,
  type SubscribeConversationTransientStreamResponse,
  type UnsubscribeConversationTransientStreamResponse,
  type ListWaitingBrowserHandoffsResponse,
  type DesktopWaitingCommandSummary,
  type ListWaitingDesktopCommandsResponse,
  type ContinueDesktopCommandResponse,
  type CancelDesktopCommandResponse,
  type ContinueBrowserHandoffResponse,
  type CancelBrowserHandoffResponse,
  type ListBrowserProfilesResponse,
  type CreateBrowserProfileResponse,
  type RenameBrowserProfileResponse,
  type DeleteBrowserProfileResponse,
  type ListBrowserSiteSessionsResponse,
  type ClearBrowserSiteSessionResponse,
  type ListBrowserRecordingsResponse,
  type GetBrowserRecordingResponse,
  type StartBrowserRecordingResponse,
  type StopBrowserRecordingResponse,
  type ListBrowserWorkflowsResponse,
  type GetBrowserWorkflowResponse,
  type CreateBrowserWorkflowDraftResponse,
  type CreateBrowserWorkflowRevisionDraftResponse,
  type SubmitBrowserWorkflowDraftResponse,
  type ReviewBrowserWorkflowDraftResponse,
  type ExecuteBrowserWorkflowResponse,
  type KernelDetectResponse,
  COMPUTER_USE_PLUGIN_SETTING_KEY,
  isComputerUsePluginEnabled as isComputerUsePluginSettingEnabled,
  OPEN_GATEWAY_SETTING_KEY,
  normalizeOpenGatewaySetting,
  type GatewayLogsQuery,
  type GatewayLogsResponse,
  type OpenGatewayStatusResponse,
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
  type AcceptanceGateId,
  type TeamId,
  type GlobalAgent,
  type Team,
  type TeamRun,
  type Conversation,
  type Message,
  type MessageBlock,
  type ConversationId,
  type ScheduledTask,
  type ScheduledTaskTarget,
  type ScheduledTaskRunStatus,
  type TaskRule,
  type ExternalEventEnvelope,
} from '@sync-think/shared';
import type {
  ProviderContentPart,
  ProviderMessage,
  ProviderToolCall,
  VisibleAssistantMessagePhase,
} from '@sync-think/adapters';
import { defaultSurfaceForProtocol, inferProviderSurface } from '@sync-think/shared';
import type { ConversationGetRunProcessResponse } from '@sync-think/protocol';
import { projectRunProcess } from './run-process-view.js';
import {
  backfillMessagesFromEvents,
  MESSAGE_STORE_BACKFILL_SETTING_KEY,
  MESSAGE_STORE_BACKFILL_VERSION,
  readBackfillProgress,
} from './message-store-backfill.js';
import {
  WorkspacePathError,
  MessageStoreError,
  MAX_MESSAGE_BLOCKS,
  MAX_MESSAGE_BLOCKS_JSON_BYTES,
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
  type SqliteScheduledTaskStore,
  type SqliteAgentStore,
  type SqliteMemoryStore,
  type SqliteSkillStore,
  type SqliteMcpStore,
  type SqliteCapabilityStore,
  type SqliteTaskPlanStore,
  type SqliteApprovalStore,
  type SqlitePolicyStore,
  type SqliteAuthorizationStore,
  type SqliteOrchestrationStore,
  type SqliteArtifactStore,
  type SqliteProductionExecutionStore,
  type SqliteBrowserStore,
  type SqliteDesktopStore,
  type DesktopCommandRecord,
  type SqliteUnitOfWork,
  type SqliteGlobalAgentStore,
  type SqliteTeamStore,
  type SqliteConversationStore,
  type SqliteMessageStore,
  type SqliteAgentContextStore,
  type GlobalAgentRecord,
  type TeamRecord,
  type TeamRunRecord,
  type ConversationRecord,
  type SkillVersionMetadataRecord,
  type SkillVersionRecord,
  type MemoryChangeRecord,
  type DurableMemoryEntry,
  type DiagnosticRecord,
  DEFAULT_CONVERSATION_AGENT_ID,
  toModelBinding,
  defaultCcSwitchDbPath,
  loadCcSwitchProviderRows,
  workspaceIconFromPrefs,
  workspaceSortOrderFromPrefs,
  workspaceHiddenFromPrefs,
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
  resolveRunSkillSelection,
  shouldAttemptFallback,
  shouldSkipSameProviderFallback,
  suggestCapabilities,
  normalizeCapabilities,
  isTextFallbackCompatibleModel,
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
import { createHash, randomUUID } from 'node:crypto';
// cc-switch import helpers re-exported via core
import type { Socket } from 'node:net';
import {
  appendAssistantStatus,
  appendAssistantTextDelta,
  appendAssistantThinkingDelta,
  appendCommentaryTimelineDelta,
  applyDemoRunEvent,
  closeAssistantTimeline,
  closeCommentaryTimelineSegment,
  createDemoProviderRequest,
  createDemoRun,
  isDemoRunRecoveryExpired,
  MODEL_RETRY_MAX,
  nextAssistantTimelineSequence,
  parseDemoRuns,
  projectAdapterEvent,
  serializeDemoRun,
  serializeDemoRuns,
  shouldRetrySameModel,
  startAssistantTool,
  completeAssistantTool,
  type DemoProvider,
  type DemoRunState,
  type KernelToolEventRecord,
} from './demo-run.js';
import {
  buildCompactSummaryUserPrompt,
  buildLocalCompactSummary,
  CHAT_AGENT_TOOL_NAMES,
  CHAT_BROWSER_TOOL_NAMES,
  CHAT_BROWSER_WORKFLOW_TOOL_NAMES,
  CHAT_DESKTOP_TOOL_NAMES,
  CHAT_PLAN_TOOL_NAMES,
  CHAT_TASK_PLAN_TOOL_NAMES,
  CHAT_MCP_CATALOG_TOOL_NAMES,
  CHAT_MCP_REGISTRY_TOOL_NAMES,
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
  resolveToolLoopProviderPolicy,
  executeChatBuiltInTool,
  executeChatBrowserWorkflowTool,
  executeChatDesktopTool,
  executeChatPlanTool,
  executeTaskCreateTool,
  executeTaskUpdateTool,
  executeTaskListTool,
  foldLongToolOutputsInMessages,
  foldToolOutputText,
  isChatToolAllowed,
  isMeaningfulCompactReduction,
  normalizeChatExecutionMode,
  splitHistoryForCompact,
  summarizeToolCallForApproval,
  toolsForExecutionMode,
  wrapModelCompactSummary,
} from './chat-tools.js';
import { resolveAppendMessageImageDataUrl } from './chat-image-staging.js';
import {
  discoverRemoteMcpTools,
  callRemoteMcpTool,
  fetchRemoteSkillMd,
  parseRemoteHttpUrl,
  redactRemoteCapabilityError,
} from './remote-capability.js';
import {
  ContextSnapshotBuilder,
  LANGUAGE_FOLLOW_PROMPT,
  selectRecentMessagesWithinBudget,
  type ContextSnapshot,
  type ContextSnapshotSource,
} from './context-snapshot.js';
import {
  buildProviderMessagesFromDurableMessages,
  type InterruptedRunToolTrace,
} from './context-message-history.js';
import { shouldCreateRuntimeCheckpoint } from './runtime-checkpoint-policy.js';
import { resolveHistoricalMessageImageDataUrl } from './message-image-context.js';
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
  parseSetParticipationModePayload,
  parseUnarchiveTaskPayload,
  parseSavePolicyPayload,
  parseListPoliciesPayload,
  parseSubscribeEventsPayload,
  parseUnsubscribeEventsPayload,
  parseSubscribeConversationTransientStreamPayload,
  parseUnsubscribeConversationTransientStreamPayload,
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
  parseImportRemoteSkillPayload,
  parseDeleteSkillPayload,
  parseSetSkillEnabledPayload,
  parseRegisterMcpServerPayload,
  parseRegisterRemoteMcpPayload,
  parseSetMcpServerEnabledPayload,
  parseDeleteMcpServerPayload,
  parseCapabilityWorkspaceListPayload,
  parseCapabilityWorkspaceSetActivePayload,
  parseCapabilityGovernanceListPayload,
  parseSaveSkillPublishDraftPayload,
  parseListSkillPublishDraftsPayload,
  parseGetSkillPublishDraftPayload,
  parseSubmitSkillPublishDraftPayload,
  parsePreviewCapabilityOrganizePayload,
  parseGetLatestCapabilityOrganizePayload,
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
  parseConversationListMessagesPayload,
  parseConversationGetRunProcessPayload,
  parseCreateConversationPayload,
  parseRenameConversationPayload,
  parseSetConversationPinnedPayload,
  parseSetConversationArchivedPayload,
  parseSetConversationExecutionModePayload,
  parseSetConversationInteractionModePayload,
  parseConversationPlanSubmitPayload,
  parseConversationPlanGetPayload,
  parseConversationPlanApprovePayload,
  parseConversationPlanRevisePayload,
  parseConversationPlanCancelPayload,
  parseAskUserQuestionInput,
  parseConversationAskAnswerPayload,
  parseConversationAskCancelPayload,
  parseConversationAskPendingPayload,
  parseUpgradeConversationTrackPayload,
  parseDeleteConversationPayload,
  parseConversationCompactPayload,
  parseConversationDecideToolApprovalPayload,
  parseConversationSubmitBrowserResultPayload,
  parseListBrowserProfilesPayload,
  parseCreateBrowserProfilePayload,
  parseRenameBrowserProfilePayload,
  parseDeleteBrowserProfilePayload,
  parseListBrowserSiteSessionsPayload,
  parseClearBrowserSiteSessionPayload,
  parseListBrowserRecordingsPayload,
  parseGetBrowserRecordingPayload,
  parseStartBrowserRecordingPayload,
  parseStopBrowserRecordingPayload,
  parseListBrowserWorkflowsPayload,
  parseGetBrowserWorkflowPayload,
  parseCreateBrowserWorkflowDraftPayload,
  parseCreateBrowserWorkflowRevisionDraftPayload,
  parseSubmitBrowserWorkflowDraftPayload,
  parseReviewBrowserWorkflowDraftPayload,
  parseExecuteBrowserWorkflowPayload,
  parseApproveExecuteBrowserWorkflowPayload,
  parseListWaitingBrowserHandoffsPayload,
  parseContinueBrowserHandoffPayload,
  parseCancelBrowserHandoffPayload,
  parseListWaitingDesktopCommandsPayload,
  parseContinueDesktopCommandPayload,
  parseCancelDesktopCommandPayload,
} from './command-validation.js';
import {
  parseGoalSetPayload,
  parseGoalGetPayload,
  parseGoalClearPayload,
  parseGoalPausePayload,
  parseGoalResumePayload,
} from './validation/goal.js';
import { createPipeServer, type PipeServerHandlers } from './pipe/server.js';
import { healthcheck, type HealthcheckResult, type HealthcheckError } from './healthcheck.js';
import { Scheduler } from './orchestration/scheduler.js';
import {
  resolveKernelAdapter as resolveRegisteredKernelAdapter,
  getKernelRegistry,
} from './kernel/registry.js';
import { collectWorkspaceSharedFacts } from './kernel/shared-facts.js';
import { formatKernelExitDiagnostic } from './kernel/kernel-diagnostics.js';
import {
  BoundedKernelSessionHost,
  type KernelSessionLease,
} from './kernel/bounded-session-host.js';
import {
  OpenGatewayManager,
  kernelNeedsGateway,
  toGatewayUpstreamProtocol,
  type GatewayCatalogEntry,
  type GatewayRunUsage,
} from './gateway/index.js';
import {
  startKernelMcpBroker,
  type KernelMcpBroker,
  type PlatformMcpToolCall,
  type PlatformMcpToolDefinition,
} from './kernel/mcp-broker.js';
import {
  executePlatformTool,
  buildPlatformMcpToolDefinitions,
  isPlatformFileToolName,
  isPlanningDeniedTool,
  nativePlatformToolSchemas,
  PLATFORM_MCP_TOOL_DEFINITIONS,
  type PlatformToolContext,
} from './kernel/platform-tools.js';
import { resolvePlatformMcpServerEntry } from './kernel/platform-mcp-entry.js';
import {
  PLAN_ACT_SETTING_KEY,
  parsePlanActSetting,
  resolvePlanActRouteForContext,
  type PlanActRoute,
} from './plan-act.js';
import { computeNextRunAt, initialNextRunAt } from './task-scheduler.js';
import {
  localSkillsDirectory,
  scanLocalSkills,
  watchLocalSkills,
} from './local-skill-discovery.js';
import type {
  KernelAdapter,
  KernelCredential,
  KernelDetectionResult,
  KernelEvent,
  KernelPermissionRequest,
  KernelRequest,
  KernelUsage,
} from '@sync-think/shared';
import type { StepExecutor } from './orchestration/step-executor.js';
import {
  FakeMcpWorker,
  LocalStdioMcpWorker,
  PersistentBrowserWorker,
  IsolatedDesktopWorker,
  formatMcpPolicyLabel,
  enforceMcpOutputLimit,
  normalizeMcpProcessPolicy,
  previewMcpOutput,
  type BrowserHostLike,
  type DesktopUserInputMonitor,
  type DesktopWorker,
} from '@sync-think/workers';
import {
  RuntimeBrowserController,
  RuntimeBrowserHandoffError,
  type RuntimeBrowserHandoffContext,
} from './browser/runtime-browser-controller.js';
import {
  RuntimeBrowserProfileError,
  RuntimeBrowserProfileService,
} from './browser/runtime-browser-profile-service.js';
import {
  RuntimeBrowserProfileGate,
  type BrowserProfileOperationGate,
} from './browser/runtime-browser-profile-gate.js';
import {
  RuntimeBrowserRecordingError,
  RuntimeBrowserRecordingService,
} from './browser/runtime-browser-recording-service.js';
import {
  RuntimeBrowserWorkflowError,
  RuntimeBrowserWorkflowService,
} from './browser/runtime-browser-workflow-service.js';
import {
  BrowserWorkflowRunner,
  BrowserWorkflowRunnerError,
} from './browser/runtime-browser-workflow-runner.js';
import { RuntimeDesktopController } from './desktop/runtime-desktop-controller.js';

import {
  estimateUsageCostBreakdown,
  MODEL_PRICING_SETTING_KEY,
  parseModelPricingEntries,
} from './pricing.js';
import { parseRebindConversationTargetPayload } from './payload-parsers.js';
import {
  canonicalApprovalDetails,
  PlanModeBoundaryError,
  PlanReviewerDependencyError,
  PlanReviewerLineageError,
  PolicyScopeBoundaryError,
} from './errors.js';
import { toArtifactVersionSummary, toPolicyVersionSummary, toTaskSummary } from './summaries.js';
import * as queries from './commands/queries.js';
import type { QueryContext } from './commands/query-context.js';
import * as skillQueries from './commands/skill-queries.js';
import type { SkillQueryContext } from './commands/skill-query-context.js';
import type { UsageSummaryRawResult } from './usage-summary-cache.js';
import { decideSchedulerHeartbeat, probeDaemonPipe } from './daemon/yield.js';
import { parseTaskFrame } from './daemon/protocol.js';
import { sendAbortToDaemon, sendTaskCompletionToDaemon } from './daemon/dispatch-client.js';
import {
  parseExternalEventFrame,
  type ExternalEventDispatchPayload,
} from './daemon/external-event-protocol.js';
import {
  sendExternalEventCompletionToDaemon,
  sendExternalEventHeartbeatToDaemon,
} from './daemon/external-event-client.js';

const CODEX_STYLE_COMMENTARY_PROMPT = [
  'User-visible execution updates (Codex-style commentary):',
  '- Write commentary in the same language as the latest user message unless the user explicitly requests another language.',
  '- Before meaningful tool work, send a brief commentary preamble that states the immediate plan.',
  '- After important tool results, briefly state the relevant finding before the next action. During longer work, add a concise progress update after roughly 4-5 tool calls and never leave a long tool sequence unexplained.',
  '- Keep commentary concise and natural. Group related actions instead of narrating every trivial read, search, or command.',
  '- Commentary may describe observable plans, actions, progress, and findings. Never expose hidden chain-of-thought or provider reasoning summaries.',
  '- Use the provider commentary phase for progress updates when phase metadata is available. Keep the terminal response separate as the final answer.',
  '- Do not add timestamps to commentary; Runtime sequence metadata determines display order.',
].join('\n');

export interface RuntimeOptions {
  installId: string;
  helloSecret?: string;
  allowNoToken?: boolean;
  /** worker 模式（守护进程自拉）：不监听管道、不启动调度 tick、不恢复 run。 */
  daemonWorker?: boolean;
  /** Called after an authenticated runtime.shutdown request is acknowledged. */
  onShutdownRequested?: () => void;
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
  messageStore?: SqliteMessageStore;
  memoryStore?: SqliteMemoryStore;
  approvalStore?: SqliteApprovalStore;
  policyStore?: SqlitePolicyStore;
  authorizationStore?: SqliteAuthorizationStore;
  orchestrationStore?: SqliteOrchestrationStore;
  artifactStore?: SqliteArtifactStore;
  productionExecutionStore?: SqliteProductionExecutionStore;
  agentContextStore?: SqliteAgentContextStore;
  browserStore?: SqliteBrowserStore;
  desktopStore?: SqliteDesktopStore;
  desktopWorker?: DesktopWorker;
  desktopUserInputMonitor?: DesktopUserInputMonitor;
  unitOfWork?: SqliteUnitOfWork;
  stepExecutor?: StepExecutor;
  skillStore?: SqliteSkillStore;
  mcpStore?: SqliteMcpStore;
  /** NewMax-style persisted task checklist store (workspace-scoped). */
  taskPlanStore?: SqliteTaskPlanStore;
  capabilityStore?: SqliteCapabilityStore;
  secureStore?: SecureStore;
  /** Shared Browser Host. Persistent Runtime supplies the production CDP Host. */
  browserHost?: BrowserHostLike;
  browserProfileId?: string;
  /** Shared with production Browser execution so Profile maintenance fences every reservation. */
  browserProfileGate?: BrowserProfileOperationGate;
  /** Existing local directory used for non-file browser actions without a bound Workspace. */
  browserFallbackWorkingDir?: string;
  /** Server-owned plan readiness lookup; clients cannot assert plan approval. */
  hasApprovedPlan?: (taskId: TaskId) => boolean;
  /** Test/embedding seam; production defaults to the registered adapters. */
  kernelAdapterResolver?: (kernelId?: string) => KernelAdapter | undefined;
  /** Maximum resident Codex app-server processes. Active turns consume one lease. */
  codexSessionMaxEntries?: number;
  /** Idle duration before a resident Codex app-server is stopped. */
  codexSessionIdleTimeoutMs?: number;
  /**
   * Protocol-family discovery adapters (OpenAI-compatible live adapters, etc.).
   * Preferred over the single discoveryAdapter when a protocol key matches.
   */
  discoveryByProtocol?: Partial<Record<ProtocolFamily, DemoProvider>>;
  /** Fallback discovery adapter; defaults to demoProvider when present (tests / Fake). */
  discoveryAdapter?: DemoProvider;
  /** 0026: app-level KV settings (vision fallback, plan & act). */
  appSettingStore?: SqliteAppSettingStore;
  /** 0044: 定时任务表。 */
  scheduledTaskStore?: SqliteScheduledTaskStore;
  /** 0026+: usage rows, request log, and tool aggregates from durable runtime events. */
  queryUsageSummary?: (sinceIso?: string) => Promise<UsageSummaryRawResult>;
  /**
   * Base delay (ms) for the same-model in-place retry backoff
   * (500ms * 2^attempt, capped at 8s). Tests inject 0 to skip the wait.
   */
  modelRetryBaseDelayMs?: number;
}

export interface RuntimeStateStore {
  commitTransition(input: CommitTransitionInput): CommittedTransition;
  listEvents(workspaceId: WorkspaceId, afterSequence: number): Event[];
  /** Run-local durable query used by the conversation process read model. */
  listEventsByRun?(runId: RunId): Event[];
  /** Task-local durable query used by context history and compaction. */
  listEventsByTask?(taskId: TaskId): Event[];
  /** Global durable stream used by Runtime replay; optional for legacy/test stores. */
  listAllEvents?(afterSequence: number): Event[];
  /** Latest durable global cursor; optional for legacy/test stores. */
  getLatestEventSequence?(): number;
  getLatestEventCursor?(): EventReplayCursor;
  /** Bounded global durable page ordered by (sequence, id). */
  listEventPage?(input: {
    afterSequence: number;
    afterId?: string;
    throughSequence: number;
    throughId?: string;
    limit: number;
  }): Event[];
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
  highWatermark: EventReplayCursor;
  replayCursor: EventReplayCursor;
  liveCursor: EventReplayCursor;
}

function runtimeRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

interface PersistedKernelConversationSession {
  version: 1;
  sessionId: string;
  fingerprint: string;
  updatedAt: string;
  responseContinuationScopeId?: string;
  /**
   * Host-message watermark (last `message.sequence` this kernel session saw).
   * Used to detect cross-kernel gaps when another kernel handled turns after
   * this session's last run. Absent on legacy records → treated as in sync.
   */
  lastMessageSequence?: number;
  lastMessageAt?: string;
}

/** Cross-kernel gap handling: a gap larger than this is cheaper to rebuild. */
const KERNEL_SESSION_GAP_MESSAGE_LIMIT = 60;
const KERNEL_SESSION_GAP_TOKEN_RATIO = 0.35;

const KERNEL_SESSION_SETTING_PREFIX = 'kernel.session';
const GATEWAY_RESPONSE_CONTINUATION_SETTING_PREFIX = 'gateway.response-continuation';
const TERMINAL_RUN_EVENT_TYPES = new Set([
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.paused',
]);

function parsePersistedKernelConversationSession(
  value: unknown,
): PersistedKernelConversationSession | undefined {
  const record = runtimeRecord(value);
  if (
    record?.version !== 1 ||
    typeof record.sessionId !== 'string' ||
    !record.sessionId.trim() ||
    typeof record.fingerprint !== 'string' ||
    !record.fingerprint.trim() ||
    typeof record.updatedAt !== 'string'
  ) {
    return undefined;
  }
  return {
    version: 1,
    sessionId: record.sessionId,
    fingerprint: record.fingerprint,
    updatedAt: record.updatedAt,
    ...(typeof record.responseContinuationScopeId === 'string' &&
    record.responseContinuationScopeId.trim()
      ? { responseContinuationScopeId: record.responseContinuationScopeId.trim() }
      : {}),
    ...(typeof record.lastMessageSequence === 'number' &&
    Number.isSafeInteger(record.lastMessageSequence) &&
    record.lastMessageSequence >= 0
      ? { lastMessageSequence: record.lastMessageSequence }
      : {}),
    ...(typeof record.lastMessageAt === 'string' && record.lastMessageAt.trim()
      ? { lastMessageAt: record.lastMessageAt.trim() }
      : {}),
  };
}

function parsePersistedGatewayResponseContinuations(
  value: unknown,
): readonly (readonly [callId: string, responseId: string])[] | undefined {
  const record = runtimeRecord(value);
  if (record?.version === 1) {
    // Version 1 stored Responses function item ids. They are recognized as
    // legacy state but deliberately not reused as previous_response_id.
    return [];
  }
  if (record?.version !== 2 || !Array.isArray(record.items)) return undefined;
  const items: Array<readonly [string, string]> = [];
  for (const candidate of record.items) {
    if (!Array.isArray(candidate) || candidate.length !== 2) continue;
    const callId = typeof candidate[0] === 'string' ? candidate[0].trim() : '';
    const responseId = typeof candidate[1] === 'string' ? candidate[1].trim() : '';
    if (!callId || !responseId) continue;
    items.push([callId, responseId]);
  }
  return items;
}

function isInvalidKernelSessionError(error: string | undefined): boolean {
  const message = error?.trim();
  if (!message) return false;
  return [
    /\bsession\b.{0,120}\bnot found\b/i,
    /\bthread\b.{0,120}\bdoes not exist\b/i,
    /\binvalid session\b/i,
    /\bunknown thread\b/i,
    /\bfailed to resume session\b/i,
    /\bcould not load session\b/i,
    /\bno conversation found\b/i,
  ].some((pattern) => pattern.test(message));
}

const TOOL_ARGUMENTS_TRANSCRIPT_LIMIT = 300;
const TOOL_RESULT_TRANSCRIPT_LIMIT = 800;

function truncateTranscriptText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}…`, truncated: true };
}

export function providerContentToKernelTranscript(content: ProviderMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => {
      if (part.type === 'text') return part.text ?? '';
      if (part.type === 'image') return '[Image attached in this conversation]';
      if (part.type === 'tool-call') {
        const tool = part.toolCall;
        if (!tool) return '[Tool call]';
        if (!tool.argumentsJson) return `[Tool call: ${tool.name}]`;
        const { text, truncated } = truncateTranscriptText(
          tool.argumentsJson,
          TOOL_ARGUMENTS_TRANSCRIPT_LIMIT,
        );
        return `[Tool call: ${tool.name} 参数: ${text}${truncated ? ' (参数截断)' : ''}]`;
      }
      if (part.type === 'tool-result') {
        const { text, truncated } = truncateTranscriptText(
          part.toolResult ?? '',
          TOOL_RESULT_TRANSCRIPT_LIMIT,
        );
        return `[Tool result: ${text}${truncated ? ' (结果截断)' : ''}]`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function kernelTranscriptTurnLabel(message: ProviderMessage): string {
  return message.role === 'assistant'
    ? message.phase === 'commentary'
      ? 'Assistant commentary'
      : 'Assistant'
    : message.role === 'user'
      ? 'User'
      : message.role === 'tool'
        ? 'Tool'
        : 'System';
}

function formatKernelTranscriptTurns(messages: readonly ProviderMessage[]): string[] {
  return messages
    .map((message) => {
      const content = providerContentToKernelTranscript(message.content).trim();
      if (!content) return undefined;
      return `### ${kernelTranscriptTurnLabel(message)}\n${content}`;
    })
    .filter((turn): turn is string => Boolean(turn));
}

export function formatKernelBootstrapTranscript(messages: readonly ProviderMessage[]): string {
  const turns = formatKernelTranscriptTurns(messages);
  if (turns.length === 0) return '';
  return [
    '## Restored conversation context',
    'The following transcript is prior conversation state restored from history. It is NOT the current user input — treat every turn below as already-happened context. Continue from it without repeating it.',
    ...turns,
  ].join('\n\n');
}

export function formatKernelGapTranscript(messages: readonly ProviderMessage[]): string {
  const turns = formatKernelTranscriptTurns(messages);
  if (turns.length === 0) return '';
  return [
    '## Cross-kernel session gap',
    'The turns below were handled by another kernel/session while this one was idle. They are prior context, NOT the current user input — treat them as already-happened conversation state.',
    ...turns,
  ].join('\n\n');
}

/**
 * Gap-specific durable→provider conversion that keeps tool calls/results, so
 * the catch-up transcript carries the tool names + arguments + outputs that the
 * generic message-history builder intentionally drops. This is gap-only and
 * never feeds the live provider request path.
 */
/**
 * Convert a run's external-kernel tool history into durable MessageBlocks.
 * Kept as durable blocks on the assistant message so cross-kernel gap
 * transcripts (durableMessagesToGapProviderMessages) restore tool names,
 * arguments and results for the resumed kernel.
 */
export function externalKernelToolEventsToMessageBlocks(
  toolEvents: readonly KernelToolEventRecord[] | undefined,
): MessageBlock[] {
  if (!toolEvents || toolEvents.length === 0) return [];
  return toolEvents.map((entry) =>
    entry.kind === 'tool-call'
      ? {
          type: 'tool-call',
          payload: { name: entry.name ?? 'unknown', argumentsJson: entry.argsJson ?? '' },
        }
      : {
          type: 'tool-result',
          text: entry.output ?? '',
          ...(entry.failed ? { payload: { failed: true } } : {}),
        },
  );
}

/**
 * Assemble the durable assistant message blocks for a finalized run.
 *
 * Reasoning rows lead for the native kernel (the model thinks before it
 * speaks, so the inline execution-process view shows 思考 → 摘要 → 工具 in
 * time order). External kernels (claude-code / codex) keep the legacy
 * `[text … reasoning]` order — locked by their finalization tests and the
 * cross-kernel gap-transcript recovery that rebuilds from block order.
 */
export function buildFinalAssistantBlocks(input: {
  commentaryText?: string;
  commentarySegments: readonly { text: string }[];
  assistantText: string;
  reasoningText?: string;
  reasoningSegments: readonly { text: string }[];
  toolBlocks: readonly MessageBlock[];
  reasoningFirst: boolean;
}): MessageBlock[] {
  const reasoningBlocks: MessageBlock[] =
    input.reasoningText || input.reasoningSegments.length > 0
      ? [
          {
            type: 'reasoning',
            ...(input.reasoningText ? { reasoningText: input.reasoningText } : {}),
            ...(input.reasoningSegments.length > 0
              ? { payload: { reasoningSegments: input.reasoningSegments } }
              : {}),
          },
        ]
      : [];
  const commentaryBlocks: MessageBlock[] =
    input.commentaryText || input.commentarySegments.length > 0
      ? [
          {
            type: 'commentary',
            ...(input.commentaryText ? { text: input.commentaryText } : {}),
            ...(input.commentarySegments.length > 0
              ? { payload: { commentarySegments: input.commentarySegments } }
              : {}),
          },
        ]
      : [];
  const textBlocks: MessageBlock[] = input.assistantText.trim()
    ? [{ type: 'text', text: input.assistantText }]
    : [];
  return [
    ...(input.reasoningFirst ? reasoningBlocks : []),
    ...commentaryBlocks,
    ...textBlocks,
    ...input.toolBlocks,
    ...(input.reasoningFirst ? [] : reasoningBlocks),
  ];
}

/**
 * Build the durable blocks for ONE provider round (DSH parity: one assistant
 * message per round — thinking + commentary + that round's text + tool calls
 * with their results — then the final answer as the last message).
 */
/**
 * Convert the exact assistant turn timeline into durable compatibility blocks.
 * The first metadata-only commentary block is the renderer source of truth;
 * following blocks preserve provider/gap-transcript compatibility in sequence.
 */
export function assistantTimelineToMessageBlocks(
  timeline: readonly AssistantTurnSegment[],
): MessageBlock[] {
  if (timeline.length === 0) return [];
  const ordered = [...timeline].map((segment) => ({ ...segment })) as AssistantTurnSegment[];
  ordered.sort((left, right) => left.sequence - right.sequence);

  const completeBlocks = buildAssistantTimelineBlocks(ordered);
  if (
    completeBlocks.length <= MAX_MESSAGE_BLOCKS - 1 &&
    messageBlocksJsonBytes(completeBlocks) <= MAX_MESSAGE_BLOCKS_JSON_BYTES - 8 * 1024
  ) {
    return completeBlocks;
  }

  let maxSegments = 96;
  let detailCharacters = 4_096;
  let finalAnswerCharacters = 96 * 1024;
  let storedTimeline = compactAssistantTimeline(ordered, {
    maxSegments,
    detailCharacters,
    finalAnswerCharacters,
  });
  let metadataBlock: MessageBlock = {
    type: 'commentary',
    payload: { assistantTimeline: storedTimeline },
  };
  const metadataBudget = Math.floor((MAX_MESSAGE_BLOCKS_JSON_BYTES - 8 * 1024) / 2);
  while (messageBlocksJsonBytes([metadataBlock]) > metadataBudget) {
    if (detailCharacters > 256) {
      detailCharacters = Math.max(256, Math.floor(detailCharacters / 2));
    } else if (maxSegments > 24) {
      maxSegments = Math.max(24, Math.floor(maxSegments / 2));
    } else if (finalAnswerCharacters > 8_192) {
      finalAnswerCharacters = Math.max(8_192, Math.floor(finalAnswerCharacters / 2));
    } else {
      storedTimeline = compactAssistantTimeline(ordered, {
        maxSegments: 8,
        detailCharacters: 128,
        finalAnswerCharacters: 4_096,
      });
      metadataBlock = { type: 'commentary', payload: { assistantTimeline: storedTimeline } };
      break;
    }
    storedTimeline = compactAssistantTimeline(ordered, {
      maxSegments,
      detailCharacters,
      finalAnswerCharacters,
    });
    metadataBlock = { type: 'commentary', payload: { assistantTimeline: storedTimeline } };
  }

  const compatibilityBlocks = buildAssistantTimelineBlocks(storedTimeline).slice(1);
  const selectedIndexes = new Set<number>();
  compatibilityBlocks.forEach((block, index) => {
    if (block.type === 'text') selectedIndexes.add(index);
  });
  const buildSelectedBlocks = (): MessageBlock[] => [
    metadataBlock,
    ...[...selectedIndexes]
      .sort((left, right) => left - right)
      .map((index) => compatibilityBlocks[index]!),
  ];

  for (let index = compatibilityBlocks.length - 1; index >= 0; index -= 1) {
    if (selectedIndexes.has(index)) continue;
    selectedIndexes.add(index);
    const candidate = buildSelectedBlocks();
    if (
      candidate.length > MAX_MESSAGE_BLOCKS - 1 ||
      messageBlocksJsonBytes(candidate) > MAX_MESSAGE_BLOCKS_JSON_BYTES - 8 * 1024
    ) {
      selectedIndexes.delete(index);
    }
  }
  return buildSelectedBlocks();
}

const DURABLE_TRUNCATION_MARKER = '\n[... content truncated for durable storage ...]';

function truncateDurableText(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) return text;
  if (maxCharacters <= DURABLE_TRUNCATION_MARKER.length) {
    return DURABLE_TRUNCATION_MARKER.slice(0, maxCharacters);
  }
  let end = maxCharacters - DURABLE_TRUNCATION_MARKER.length;
  const lastCodeUnit = text.charCodeAt(end - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}${DURABLE_TRUNCATION_MARKER}`;
}

function compactAssistantTimeline(
  ordered: readonly AssistantTurnSegment[],
  limits: {
    maxSegments: number;
    detailCharacters: number;
    finalAnswerCharacters: number;
  },
): AssistantTurnSegment[] {
  const retainedCount = Math.max(1, limits.maxSegments - 1);
  const omittedCount = Math.max(0, ordered.length - retainedCount);
  const selected = omittedCount > 0 ? ordered.slice(omittedCount) : ordered;
  const compacted = selected.map((segment): AssistantTurnSegment => {
    if (segment.kind === 'thinking') {
      return {
        ...segment,
        id: truncateDurableText(segment.id, 256),
        text: truncateDurableText(segment.text, limits.detailCharacters),
      };
    }
    if (segment.kind === 'text') {
      return {
        ...segment,
        id: truncateDurableText(segment.id, 256),
        text: truncateDurableText(
          segment.text,
          segment.phase === 'final_answer' ? limits.finalAnswerCharacters : limits.detailCharacters,
        ),
      };
    }
    if (segment.kind === 'tool') {
      return {
        ...segment,
        id: truncateDurableText(segment.id, 256),
        toolCallId: truncateDurableText(segment.toolCallId, 256),
        name: truncateDurableText(segment.name, 512),
        ...(segment.displayName
          ? { displayName: truncateDurableText(segment.displayName, 512) }
          : {}),
        ...(segment.inputSummary
          ? { inputSummary: truncateDurableText(segment.inputSummary, 1_024) }
          : {}),
        ...(segment.argumentsJson !== undefined
          ? {
              argumentsJson: truncateDurableText(
                segment.argumentsJson,
                Math.min(1_024, limits.detailCharacters),
              ),
            }
          : {}),
        ...(segment.output !== undefined
          ? { output: truncateDurableText(segment.output, limits.detailCharacters) }
          : {}),
      };
    }
    return {
      ...segment,
      id: truncateDurableText(segment.id, 256),
      label: truncateDurableText(segment.label, 1_024),
      ...(segment.detail
        ? { detail: truncateDurableText(segment.detail, limits.detailCharacters) }
        : {}),
    };
  });
  if (omittedCount === 0) return compacted;
  return [
    {
      id: 'durable-timeline-truncated',
      sequence: Math.max(0, (compacted[0]?.sequence ?? 1) - 1),
      kind: 'status',
      statusType: 'other',
      label: `${omittedCount} earlier process segments truncated for durable storage`,
    },
    ...compacted,
  ];
}

function buildAssistantTimelineBlocks(
  storedTimeline: readonly AssistantTurnSegment[],
): MessageBlock[] {
  const blocks: MessageBlock[] = [
    {
      type: 'commentary',
      payload: { assistantTimeline: storedTimeline },
    },
  ];
  for (const segment of storedTimeline) {
    if (segment.kind === 'thinking') {
      if (segment.text.trim()) blocks.push({ type: 'reasoning', reasoningText: segment.text });
      continue;
    }
    if (segment.kind === 'text') {
      if (!segment.text.trim()) continue;
      blocks.push(
        segment.phase === 'commentary'
          ? { type: 'commentary', text: segment.text }
          : { type: 'text', text: segment.text },
      );
      continue;
    }
    if (segment.kind !== 'tool') continue;
    blocks.push({
      type: 'tool-call',
      payload: {
        toolCallId: segment.toolCallId,
        name: segment.name,
        argumentsJson: segment.argumentsJson ?? '',
      },
    });
    if (segment.output !== undefined || segment.status !== 'running') {
      blocks.push({
        type: 'tool-result',
        text: segment.output ?? '',
        payload: {
          toolCallId: segment.toolCallId,
          ...(segment.isError || segment.status === 'failed' ? { failed: true } : {}),
        },
      });
    }
  }
  return blocks;
}

function messageBlocksJsonBytes(blocks: readonly MessageBlock[]): number {
  return Buffer.byteLength(JSON.stringify(blocks), 'utf8');
}

/** 分页响应 JSON 字节数（listMessages 降级重试的判断依据）。 */
function messagePageJsonBytes(page: { messages: readonly unknown[] }): number {
  return Buffer.byteLength(JSON.stringify(page), 'utf8');
}

export function assistantTextFallbackMessageBlocks(text: string): MessageBlock[] {
  if (!text.trim()) return [];
  const complete: MessageBlock[] = [{ type: 'text', text }];
  if (messageBlocksJsonBytes(complete) <= MAX_MESSAGE_BLOCKS_JSON_BYTES) return complete;

  let low = 0;
  let high = text.length;
  let best = DURABLE_TRUNCATION_MARKER;
  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    const candidate = truncateDurableText(text, midpoint);
    if (
      messageBlocksJsonBytes([{ type: 'text', text: candidate }]) <= MAX_MESSAGE_BLOCKS_JSON_BYTES
    ) {
      best = candidate;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }
  return [{ type: 'text', text: best }];
}

export function assistantTimelineFinalText(timeline: readonly AssistantTurnSegment[]): string {
  return [...timeline]
    .sort((left, right) => left.sequence - right.sequence)
    .filter(
      (segment): segment is Extract<AssistantTurnSegment, { kind: 'text' }> =>
        segment.kind === 'text' && segment.phase === 'final_answer',
    )
    .map((segment) => segment.text)
    .join('');
}

export function buildRoundMessageBlocks(input: {
  reasoningDelta: string;
  transcriptMessages: readonly { phase?: string; content: unknown }[];
  toolCalls: readonly { name: string; argumentsJson?: string }[];
  toolResults: readonly string[];
}): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  if (input.reasoningDelta.trim()) {
    blocks.push({ type: 'reasoning', reasoningText: input.reasoningDelta });
  }
  const commentary = input.transcriptMessages
    .filter(
      (message) =>
        message.phase === 'commentary' &&
        typeof message.content === 'string' &&
        message.content.trim(),
    )
    .map((message) => message.content as string)
    .join('\n');
  if (commentary.trim()) blocks.push({ type: 'commentary', text: commentary });
  const text = input.transcriptMessages
    .filter(
      (message) =>
        message.phase === 'final_answer' &&
        typeof message.content === 'string' &&
        message.content.trim(),
    )
    .map((message) => message.content as string)
    .join('\n');
  if (text.trim()) blocks.push({ type: 'text', text });
  input.toolCalls.forEach((toolCall, index) => {
    blocks.push({
      type: 'tool-call',
      payload: { name: toolCall.name, argumentsJson: toolCall.argumentsJson ?? '' },
    });
    blocks.push({ type: 'tool-result', text: input.toolResults[index] ?? '' });
  });
  return blocks;
}

export function durableMessagesToGapProviderMessages(
  messages: readonly Message[],
): ProviderMessage[] {
  const result: ProviderMessage[] = [];
  for (const message of messages) {
    const parts: ProviderContentPart[] = [];
    for (const block of message.blocks) {
      switch (block.type) {
        case 'text':
        case 'code':
          if (block.text) parts.push({ type: 'text', text: block.text });
          break;
        case 'commentary':
          if (block.text) parts.push({ type: 'text', text: block.text });
          break;
        case 'tool-call': {
          const payload = (block.payload ?? {}) as {
            name?: string;
            argumentsJson?: string;
          };
          parts.push({
            type: 'tool-call',
            toolCall: {
              id: '',
              name: payload.name ?? 'unknown',
              argumentsJson: payload.argumentsJson ?? '',
            },
          });
          break;
        }
        case 'tool-result':
          parts.push({ type: 'tool-result', toolResult: block.text ?? '' });
          break;
        case 'reasoning':
          if (block.reasoningText) parts.push({ type: 'text', text: block.reasoningText });
          break;
        default:
          break;
      }
    }
    if (parts.length === 0) continue;
    result.push({ role: message.role, content: parts });
  }
  return result;
}

/**
 * Decide whether a set of gap messages should be patched into a resumed kernel
 * session (via a catch-up transcript) or treated as oversized (caller rebuilds).
 * Pure — the caller supplies the durable gap messages and the effective window.
 */
export function computeKernelGapFromMessages(
  messages: readonly Message[],
  effectiveWindow: number,
): { count: number; catchUp?: string; oversized: boolean } {
  if (messages.length === 0) return { count: 0, oversized: false };
  const roughTokens = messages.reduce(
    (sum, message) => sum + Math.ceil(JSON.stringify(message.blocks).length / 4),
    0,
  );
  const oversized =
    messages.length > KERNEL_SESSION_GAP_MESSAGE_LIMIT ||
    roughTokens > effectiveWindow * KERNEL_SESSION_GAP_TOKEN_RATIO;
  if (oversized) return { count: messages.length, oversized: true };
  const catchUp = formatKernelGapTranscript(durableMessagesToGapProviderMessages(messages));
  return { count: messages.length, oversized: false, ...(catchUp ? { catchUp } : {}) };
}

function isCurrentKernelUserMessage(
  message: ProviderMessage | undefined,
  userText: string,
): boolean {
  if (!message || message.role !== 'user') return false;
  const normalizedUserText = userText.trim();
  if (!normalizedUserText) return false;
  return providerContentToKernelTranscript(message.content).trim() === normalizedUserText;
}

function cursorForEvent(event: Event): EventReplayCursor {
  return { sequence: event.sequence, eventId: String(event.id) };
}

/** One checklist item as maintained by the model via update_task_plan. */
export interface ModelTaskPlanItem {
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** Latest task checklist snapshot for a thread (NewMax-style todo list). */
export interface ModelTaskPlan {
  items: ModelTaskPlanItem[];
  total: number;
  completed: number;
}

function parseJsonObjectText(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract the latest update_task_plan checklist for a thread from the recent
 * event buffer. Prefers the executed result ({ok:true, plan:{items}}) from
 * tool.completed; falls back to the request arguments so the model can read
 * back the checklist as soon as the call is streamed. NewMax-style: the
 * checklist is part of the model context, not just a UI signal.
 */
export function extractLatestTaskPlanFromEvents(
  events: readonly Event[],
  threadId: string,
): ModelTaskPlan | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.category !== 'tool') continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (payload.threadId !== threadId || payload.toolName !== 'update_task_plan') continue;
    let rawItems: unknown;
    if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      const result = parseJsonObjectText(payload.result ?? payload.output);
      if (result?.ok === true) {
        const plan = result.plan;
        rawItems =
          plan && typeof plan === 'object' ? (plan as Record<string, unknown>).items : undefined;
      }
    } else if (event.type === 'tool.requested') {
      rawItems =
        payload.arguments && typeof payload.arguments === 'object'
          ? (payload.arguments as Record<string, unknown>).items
          : undefined;
    }
    if (rawItems === undefined) continue;
    return normalizeModelTaskPlan(rawItems);
  }
  return undefined;
}

function normalizeModelTaskPlan(raw: unknown): ModelTaskPlan | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const items: ModelTaskPlanItem[] = [];
  for (const entry of raw.slice(0, 20)) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    if (!title) continue;
    const status =
      rec.status === 'in_progress' || rec.status === 'completed' ? rec.status : 'pending';
    items.push({ title, status });
  }
  if (items.length === 0) return undefined;
  const completed = items.filter((item) => item.status === 'completed').length;
  return { items, total: items.length, completed };
}

/** Parse the goal evaluator's JSON answer ({met, reason}) with lenient extraction. */
export function parseGoalEvaluatorOutput(
  output: string,
): { met: boolean; reason: string } | undefined {
  if (!output || typeof output !== 'string') return undefined;
  const trimmed = output.trim();
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart)) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (typeof record.met === 'boolean') {
          return {
            met: record.met,
            reason: typeof record.reason === 'string' ? record.reason.slice(0, 240) : '',
          };
        }
      }
    } catch {
      // fall through to keyword matching
    }
  }
  if (/\btrue\b/i.test(trimmed) || /^\s*(yes|是|满足|完成|达成)\b/i.test(trimmed)) {
    return { met: true, reason: trimmed.slice(0, 240) };
  }
  return { met: false, reason: trimmed.slice(0, 240) };
}

/** NewMax-style checkbox checklist text injected into the model context. */
export function formatTaskPlanForModel(plan: ModelTaskPlan): string {
  const lines = plan.items.map((item) => {
    const mark =
      item.status === 'completed' ? '[x]' : item.status === 'in_progress' ? '[~]' : '[ ]';
    return `- ${mark} ${item.title}`;
  });
  return `当前任务清单（${plan.completed}/${plan.total} 已完成）：\n${lines.join('\n')}`;
}

function sameCursor(left: EventReplayCursor, right: EventReplayCursor): boolean {
  return left.sequence === right.sequence && left.eventId === right.eventId;
}

function compareCursor(left: EventReplayCursor, right: EventReplayCursor): number {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  return left.eventId.localeCompare(right.eventId);
}

interface ConversationTransientSubscription {
  socket: Socket;
  threadId: ThreadId;
  liveCursor: number;
}

const MAX_REPLAY_EVENTS_PER_PAGE = 64;
const MAX_REPLAY_SCANNED_EVENTS_PER_PAGE = 256;
const MAX_RECENT_RUNTIME_EVENTS = 2_048;
const RESTORE_EVENT_PAGE_SIZE = 1_000;
const REPLAY_FRAME_RESERVE_BYTES = 1_024;
/** Global memory bound; frames retain a thread-local cursor for isolated replay. */
const MAX_TRANSIENT_REPLAY_FRAMES = 256;
/** Keep a subscribe response comfortably under the 1 MiB pipe frame limit. */
const MAX_TRANSIENT_REPLAY_BYTES = 512 * 1024;

interface ProviderRoundTranscript {
  messages: ProviderMessage[];
  itemIndexes: Map<string, number>;
  openAnonymousItems: Map<VisibleAssistantMessagePhase, string>;
  nextAnonymousItem: number;
  legacyText: string;
}

function createProviderRoundTranscript(): ProviderRoundTranscript {
  return {
    messages: [],
    itemIndexes: new Map(),
    openAnonymousItems: new Map(),
    nextAnonymousItem: 0,
    legacyText: '',
  };
}

function ensureProviderRoundAssistantItem(
  transcript: ProviderRoundTranscript,
  input: {
    phase: VisibleAssistantMessagePhase;
    itemId?: string;
    forceNewAnonymous?: boolean;
  },
): { key: string; index: number } {
  let key: string;
  if (input.itemId) {
    key = `item:${input.itemId}`;
  } else {
    const open = transcript.openAnonymousItems.get(input.phase);
    if (open && !input.forceNewAnonymous) {
      key = open;
    } else {
      key = `anonymous:${input.phase}:${transcript.nextAnonymousItem++}`;
      transcript.openAnonymousItems.set(input.phase, key);
    }
  }

  const existing = transcript.itemIndexes.get(key);
  if (existing !== undefined) return { key, index: existing };
  const index = transcript.messages.length;
  transcript.messages.push({
    role: 'assistant',
    phase: input.phase,
    content: '',
  });
  transcript.itemIndexes.set(key, index);
  return { key, index };
}

function startProviderRoundAssistantItem(
  transcript: ProviderRoundTranscript,
  phase: VisibleAssistantMessagePhase,
  itemId?: string,
): void {
  ensureProviderRoundAssistantItem(transcript, {
    phase,
    itemId,
    forceNewAnonymous: !itemId,
  });
}

function appendProviderRoundAssistantDelta(
  transcript: ProviderRoundTranscript,
  phase: VisibleAssistantMessagePhase,
  text: string,
  itemId?: string,
): void {
  const { index } = ensureProviderRoundAssistantItem(transcript, { phase, itemId });
  const message = transcript.messages[index];
  if (!message) return;
  const current = typeof message.content === 'string' ? message.content : '';
  transcript.messages[index] = {
    ...message,
    content: current + text,
  };
}

function endProviderRoundAssistantItem(
  transcript: ProviderRoundTranscript,
  phase: VisibleAssistantMessagePhase,
  itemId?: string,
): void {
  ensureProviderRoundAssistantItem(transcript, { phase, itemId });
  if (!itemId) transcript.openAnonymousItems.delete(phase);
}

function appendProviderRoundLegacyMessage(
  transcript: ProviderRoundTranscript,
  phase: VisibleAssistantMessagePhase,
): void {
  if (!transcript.legacyText.trim()) return;
  transcript.messages.push({
    role: 'assistant',
    phase,
    content: transcript.legacyText,
  });
  transcript.legacyText = '';
}

function appendProviderRoundToolCall(
  transcript: ProviderRoundTranscript,
  toolCall: ProviderToolCall,
): void {
  transcript.messages = transcript.messages.map((message) =>
    message.role === 'assistant' &&
    typeof message.content === 'string' &&
    message.phase === 'final_answer'
      ? { ...message, phase: 'commentary' }
      : message,
  );
  transcript.messages.push({
    role: 'assistant',
    content: [{ type: 'tool-call', toolCall }],
  });
}

function providerMessagesFromRoundTranscript(
  transcript: ProviderRoundTranscript,
): ProviderMessage[] {
  return transcript.messages.filter((message) => {
    if (typeof message.content === 'string') return Boolean(message.content.trim());
    return message.content.length > 0;
  });
}

/**
 * A failed provider attempt may already have emitted user-visible progress.
 * Carry only that visible assistant text into the next model attempt. Incomplete
 * tool calls and internal reasoning are deliberately excluded.
 */
function providerVisibleMessagesFromRoundTranscript(
  transcript: ProviderRoundTranscript,
): ProviderMessage[] {
  return transcript.messages.filter(
    (message) =>
      message.role === 'assistant' &&
      (message.phase === 'commentary' || message.phase === 'final_answer') &&
      typeof message.content === 'string' &&
      Boolean(message.content.trim()),
  );
}

/** 一个挂起的 ask_user_question 等待（模型问询 → 用户作答 → 回填工具结果）。 */
interface PendingAskEntry {
  askId: string;
  runId: RunId;
  threadId: string;
  questions: AskQuestion[];
  createdAt: string;
  resolve(result: { ok: boolean; content?: string; error?: string }): void;
  onAbort(): void;
}

/** 目标模式默认轮次上限（防无限烧 token；达上限自动 blocked）。 */
const DEFAULT_GOAL_MAX_ROUNDS = 5;

export class Runtime {
  readonly startedAt = Date.now();
  readonly installId: string;
  private readonly handlers: PipeServerHandlers;
  private server: ReturnType<typeof createPipeServer> | null = null;
  private readonly inFlight = new Set<string>();
  private readonly daemonWorker: boolean;
  private readonly onShutdownRequested?: () => void;
  /** 投递来且尚未完成的任务 id（T8：stop() 时向其发 abort）。 */
  private readonly dispatchedTasks = new Set<string>();
  /** runId → taskId（投递任务终态时从 dispatchedTasks 移除）。 */
  private readonly taskIdByRun = new Map<string, string>();
  private readonly threadVersions = new Map<string, number>();
  private readonly events: Event[] = [];
  private readonly subscriptions = new Map<string, RuntimeEventSubscription>();
  private readonly transientSubscriptions = new Map<string, ConversationTransientSubscription>();
  private readonly transientReplay: ConversationTransientFrame[] = [];
  /** Current transient snapshot per thread; survives replay eviction for active runs. */
  private readonly transientSnapshotByThread = new Map<string, ConversationTransientSnapshot>();
  private readonly transientSequenceByThread = new Map<string, number>();
  private readonly stateStore?: RuntimeStateStore;
  private readonly workspaceStore?: SqliteWorkspaceStore;
  private readonly workspaceId: WorkspaceId;
  private readonly checkpointRunId: RunId;
  private readonly demoProvider?: DemoProvider;
  private readonly modelRetryBaseDelayMs: number;
  private readonly providerStore?: SqliteProviderStore;
  private readonly appSettingStore?: SqliteAppSettingStore;
  /** 0044: 定时任务表与调度心跳。 */
  private readonly scheduledTaskStore?: SqliteScheduledTaskStore;
  private taskSchedulerTimer?: ReturnType<typeof setInterval>;
  private taskSchedulerTicking = false;
  /** 当前由定时任务触发的 run（并发上限统计）。 */
  private readonly taskRuns = new Set<string>();
  /** runId → 定时任务元数据；历史只在 run 终态时写入。 */
  private readonly scheduledTaskRuns = new Map<
    string,
    { task: ScheduledTask; firedAt: string; run: DemoRunState }
  >();
  /** Completion frames in flight; shutdown waits so daemon does not retry a finished run. */
  private readonly daemonCompletionPromises = new Set<Promise<boolean>>();
  /** Active durable external-event lease per event id. */
  private readonly externalEventExecutions = new Map<
    string,
    { leaseToken: string; runId: string }
  >();
  private readonly externalEventIdByRun = new Map<string, string>();
  private readonly externalEventCleanupRuns = new Set<string>();
  private externalEventHeartbeatTimer?: ReturnType<typeof setInterval>;
  private runtimeStopped = false;
  /** Persisted runId → kernelId, so message-stream kernel badges survive restarts. */
  private readonly runKernelIds: Map<string, string> = new Map();
  private runKernelIdsLoaded = false;
  /** 挂起的 ask_user_question（模型问询等待用户作答）。 */
  private readonly pendingAsks = new Map<string, PendingAskEntry>();
  /**
   * Open gateway (开放网关): loopback protocol bridge that lets a kernel speak
   * its native dialect against an upstream that speaks the other one.
   */
  private readonly openGateway: OpenGatewayManager;
  private readonly queryUsageSummary?: RuntimeOptions['queryUsageSummary'];
  private readonly agentStore?: SqliteAgentStore;
  private readonly globalAgentStore?: SqliteGlobalAgentStore;
  private readonly teamStore?: SqliteTeamStore;
  private readonly conversationStore?: SqliteConversationStore;
  private readonly messageStore?: SqliteMessageStore;
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
  private readonly taskPlanStore?: SqliteTaskPlanStore;
  private readonly capabilityStore?: SqliteCapabilityStore;
  private readonly recordedCapabilityUsageKeys = new Set<string>();
  private readonly secureStore?: SecureStore;
  /**
   * Remote MCP auth. Key is stored as plaintext in app settings (product
   * requirement: the key is echoed back into the register dialog), so the
   * in-memory cache mirrors `{ key, authScheme }`. Legacy SecureStore handles
   * (storeHandle) are still readable for backwards compatibility.
   */
  private readonly mcpAuthHandles = new Map<
    string,
    { key?: string; storeHandle?: string; authScheme: string }
  >();
  private readonly browserHost?: BrowserHostLike;
  private readonly browserController?: RuntimeBrowserController;
  private readonly browserProfileService?: RuntimeBrowserProfileService;
  private readonly browserRecordingService?: RuntimeBrowserRecordingService;
  private readonly browserWorkflowService?: RuntimeBrowserWorkflowService;
  private readonly browserWorkflowRunner?: BrowserWorkflowRunner;
  private readonly desktopController?: RuntimeDesktopController;
  private readonly kernelAdapterResolver: (kernelId?: string) => KernelAdapter | undefined;
  /**
   * Bounded resident Codex processes. Durable thread ids remain in app_setting,
   * so evicting an idle process never deletes conversation context.
   */
  private readonly codexSessionHost: BoundedKernelSessionHost;
  /**
   * Platform MCP catalog frozen per external-kernel run. The kernel may only
   * call tools that were exposed when its broker started; a later capability or
   * permission-mode change must not widen an in-flight run.
   */
  private readonly platformMcpCatalogByRun = new Map<
    string,
    readonly PlatformMcpToolDefinition[]
  >();
  /**
   * Per-run platform MCP results keyed by `<callId>:<argsHash>`. A kernel retry
   * of the same call replays the first result instead of creating a second
   * agent/task (design §6.4 idempotency).
   */
  private readonly platformMcpResultsByRun = new Map<
    string,
    Map<string, Promise<{ ok: boolean; content?: string; error?: string }>>
  >();
  /** Hot cache for external-kernel sessions; app_setting remains durable authority. */
  private readonly kernelConversationSessions = new Map<
    string,
    PersistedKernelConversationSession
  >();
  /**
   * Promise tails serialize one external kernel session without blocking
   * unrelated conversations. The durable app_setting entry remains the
   * authority for the actual session id.
   */
  private readonly externalKernelSessionTails = new Map<string, Promise<void>>();
  private readonly hasApprovedPlan?: (taskId: TaskId) => boolean;
  private readonly discoveryByProtocol: Partial<Record<ProtocolFamily, DemoProvider>>;
  private readonly discoveryAdapter?: DemoProvider;
  private readonly demoRuns = new Map<string, DemoRunState>();
  /** Abort controllers for in-flight demo chat streams (Stop button). */
  private readonly demoRunAborts = new Map<string, AbortController>();
  /**
   * Chat tool approvals under「询问批准�?
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
  private readonly backgroundTasks = new Set<Promise<void>>();
  /** Thread-scoped Manifest amendments (force-exclude source ids). In-memory for M1. */
  private readonly threadContextAmendments = new Map<string, { excludeSourceIds: string[] }>();
  private readonly contextSnapshotByThread = new Map<string, Map<string, ContextSnapshot>>();
  private readonly contextRunByThread = new Map<
    string,
    {
      run: DemoRunState;
      workspaceRoot?: string;
      executionMode: string;
      toolsEnabled: boolean;
      networkEnabled: boolean;
    }
  >();
  private readonly latestCompactByThread = new Map<
    string,
    { summaryText: string; compactedAt: string }
  >();
  private eventSequence = 0;
  private lastCheckpointEventSequence = 0;

  constructor(opts: RuntimeOptions) {
    this.installId = opts.installId;
    this.daemonWorker = opts.daemonWorker ?? false;
    this.onShutdownRequested = opts.onShutdownRequested;
    this.kernelAdapterResolver = opts.kernelAdapterResolver ?? resolveRegisteredKernelAdapter;
    this.codexSessionHost = new BoundedKernelSessionHost({
      maxEntries: opts.codexSessionMaxEntries ?? 4,
      idleTimeoutMs: opts.codexSessionIdleTimeoutMs ?? 15 * 60_000,
      createAdapter: () => this.kernelAdapterResolver('codex'),
    });
    this.stateStore = opts.stateStore;
    this.workspaceStore = opts.workspaceStore;
    this.workspaceId = opts.workspaceId ?? ('workspace-dev' as WorkspaceId);
    this.checkpointRunId = opts.checkpointRunId ?? (`runtime-${opts.installId}` as RunId);
    this.demoProvider = opts.demoProvider;
    this.modelRetryBaseDelayMs = Math.max(0, opts.modelRetryBaseDelayMs ?? 500);
    this.providerStore = opts.providerStore;
    this.appSettingStore = opts.appSettingStore;
    this.scheduledTaskStore = opts.scheduledTaskStore;
    this.openGateway = new OpenGatewayManager({
      listCatalog: () => this.collectGatewayCatalog(),
      resolveProviderSecret: (providerId) => this.resolveProviderSecret(providerId),
      loadResponseContinuations: (scopeId) => this.loadGatewayResponseContinuations(scopeId),
      saveResponseContinuations: (scopeId, items) =>
        this.saveGatewayResponseContinuations(scopeId, items),
      removeResponseContinuations: (scopeId) => this.removeGatewayResponseContinuations(scopeId),
      onLog: (message) => {
        // Diagnostics only; the manager never passes secrets through here.
        console.error(`[runtime] ${message}`);
      },
    });
    this.queryUsageSummary = opts.queryUsageSummary;
    this.agentStore = opts.agentStore;
    this.globalAgentStore = opts.globalAgentStore;
    this.teamStore = opts.teamStore;
    this.conversationStore = opts.conversationStore;
    this.messageStore = opts.messageStore;
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
            agentContextStore: opts.agentContextStore,
            approvalStore: opts.approvalStore,
            unitOfWork: opts.unitOfWork,
            onProviderUsage: (usage) => {
              const { taskId, runId, stepId, ...payload } = usage;
              const event = this.appendEvent(
                'provider',
                'provider.usage',
                payload,
                undefined,
                runId,
                taskId,
                stepId,
              );
              this.publishEvent(event);
            },
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
    this.taskPlanStore = opts.taskPlanStore;
    this.capabilityStore = opts.capabilityStore;
    this.secureStore = opts.secureStore;
    this.browserHost = opts.browserHost;
    const browserProfileGate =
      opts.browserHost && opts.browserStore
        ? (opts.browserProfileGate ?? new RuntimeBrowserProfileGate())
        : undefined;
    this.browserController =
      opts.browserHost && opts.browserStore
        ? new RuntimeBrowserController({
            worker: new PersistentBrowserWorker(opts.browserHost),
            store: opts.browserStore,
            profileId: opts.browserProfileId,
            fallbackWorkingDir: opts.browserFallbackWorkingDir ?? process.cwd(),
            leaseHost: opts.browserHost,
            ...(browserProfileGate ? { profileGate: browserProfileGate } : {}),
          })
        : undefined;
    this.browserProfileService =
      opts.browserHost && opts.browserStore
        ? new RuntimeBrowserProfileService({
            store: opts.browserStore,
            host: opts.browserHost,
            ...(browserProfileGate ? { profileGate: browserProfileGate } : {}),
          })
        : undefined;
    this.browserRecordingService =
      opts.browserHost && opts.browserStore
        ? new RuntimeBrowserRecordingService({
            store: opts.browserStore,
            host: opts.browserHost,
          })
        : undefined;
    this.browserWorkflowService = opts.browserStore
      ? new RuntimeBrowserWorkflowService({
          store: opts.browserStore,
          ...(this.browserProfileService
            ? { listProfiles: () => this.browserProfileService!.listProfiles() }
            : {}),
        })
      : undefined;
    this.browserWorkflowRunner =
      opts.browserHost && opts.browserStore
        ? new BrowserWorkflowRunner({
            store: opts.browserStore,
            host: opts.browserHost,
            ...(opts.browserFallbackWorkingDir
              ? { fallbackWorkingDir: opts.browserFallbackWorkingDir }
              : {}),
          })
        : undefined;
    this.desktopController = opts.desktopStore
      ? new RuntimeDesktopController({
          store: opts.desktopStore,
          ...(opts.desktopWorker ? { worker: opts.desktopWorker } : {}),
          workerFactory: () => new IsolatedDesktopWorker(),
          ...(opts.desktopUserInputMonitor
            ? { userInputMonitor: opts.desktopUserInputMonitor }
            : {}),
          fallbackWorkingDir: opts.browserFallbackWorkingDir ?? process.cwd(),
        })
      : undefined;
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
        for (const [streamId, subscription] of this.transientSubscriptions) {
          if (subscription.socket === socket) this.transientSubscriptions.delete(streamId);
        }
        if (!socket.destroyed) socket.destroy();
      },
      onFrame: (socket, frame: Frame) => {
        if (frame.type === 'runtime.shutdown') {
          socket.write(
            encodeFrame({
              id: frame.id,
              kind: 'response',
              type: 'runtime.shutdown',
              payload: { accepted: Boolean(this.onShutdownRequested) },
            }),
          );
          if (this.onShutdownRequested) queueMicrotask(this.onShutdownRequested);
          return;
        }
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
        if (frame.type === 'conversation.subscribeTransientStream') {
          this.handleSubscribeConversationTransientStream(socket, frame);
          return;
        }
        if (frame.type === 'conversation.unsubscribeTransientStream') {
          this.handleUnsubscribeConversationTransientStream(socket, frame);
          return;
        }
        if (frame.type === 'goal.set') {
          this.handleGoalSet(socket, frame);
          return;
        }
        if (frame.type === 'goal.get') {
          this.handleGoalGet(socket, frame);
          return;
        }
        if (frame.type === 'goal.clear') {
          this.handleGoalClear(socket, frame);
          return;
        }
        if (frame.type === 'goal.pause') {
          this.handleGoalPause(socket, frame);
          return;
        }
        if (frame.type === 'goal.resume') {
          this.handleGoalResume(socket, frame);
          return;
        }
        if (frame.type === 'scheduledTask.create') {
          this.handleCreateScheduledTask(socket, frame);
          return;
        }
        if (frame.type === 'scheduledTask.list') {
          this.handleListScheduledTasks(socket, frame);
          return;
        }
        if (frame.type === 'scheduledTask.update') {
          this.handleUpdateScheduledTask(socket, frame);
          return;
        }
        if (frame.type === 'scheduledTask.delete') {
          this.handleDeleteScheduledTask(socket, frame);
          return;
        }
        if (frame.type === 'scheduledTask.trigger') {
          this.handleTriggerScheduledTask(socket, frame);
          return;
        }
        if (frame.type === 'task.dispatch') {
          this.handleTaskDispatch(socket, frame);
          return;
        }
        if (frame.type === 'external.event.dispatch') {
          this.handleExternalEventDispatch(socket, frame);
          return;
        }
        if (frame.type === 'scheduledTask.history') {
          this.handleListScheduledTaskHistory(socket, frame);
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
          void this.handleUsageSummary(socket, frame);
          return;
        }
        if (frame.type === 'kernel.detect') {
          void this.handleKernelDetect(socket, frame);
          return;
        }
        if (frame.type === 'gateway.status') {
          this.handleGatewayStatus(socket, frame);
          return;
        }
        if (frame.type === 'gateway.logs') {
          this.handleGatewayLogs(socket, frame);
          return;
        }
        if (frame.type === 'gateway.logs.clear') {
          this.handleGatewayLogsClear(socket, frame);
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
        if (frame.type === 'conversation.listMessages') {
          this.handleListConversationMessages(socket, frame);
          return;
        }
        if (frame.type === 'conversation.getContextStatus') {
          this.handleGetConversationContextStatus(socket, frame);
          return;
        }
        if (frame.type === 'conversation.getRunProcess') {
          this.handleGetConversationRunProcess(socket, frame);
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
        if (frame.type === 'conversation.setInteractionMode') {
          this.handleSetConversationInteractionMode(socket, frame);
          return;
        }
        if (frame.type === 'conversation.plan.submit') {
          this.handleConversationPlanSubmit(socket, frame);
          return;
        }
        if (frame.type === 'conversation.plan.get') {
          this.handleConversationPlanGet(socket, frame);
          return;
        }
        if (frame.type === 'conversation.plan.approve') {
          this.handleConversationPlanApprove(socket, frame);
          return;
        }
        if (frame.type === 'conversation.plan.revise') {
          this.handleConversationPlanRevise(socket, frame);
          return;
        }
        if (frame.type === 'conversation.plan.cancel') {
          this.handleConversationPlanCancel(socket, frame);
          return;
        }
        if (frame.type === 'conversation.ask.answer') {
          this.handleConversationAskAnswer(socket, frame);
          return;
        }
        if (frame.type === 'conversation.ask.cancel') {
          this.handleConversationAskCancel(socket, frame);
          return;
        }
        if (frame.type === 'conversation.ask.pending') {
          this.handleConversationAskPending(socket, frame);
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
        if (frame.type === 'browser.profile.list') {
          this.handleListBrowserProfiles(socket, frame);
          return;
        }
        if (frame.type === 'browser.profile.create') {
          this.handleCreateBrowserProfile(socket, frame);
          return;
        }
        if (frame.type === 'browser.profile.rename') {
          this.handleRenameBrowserProfile(socket, frame);
          return;
        }
        if (frame.type === 'browser.profile.delete') {
          this.trackBackgroundTask(this.handleDeleteBrowserProfile(socket, frame));
          return;
        }
        if (frame.type === 'browser.profile.listSiteSessions') {
          this.trackBackgroundTask(this.handleListBrowserSiteSessions(socket, frame));
          return;
        }
        if (frame.type === 'browser.profile.clearSiteSession') {
          this.trackBackgroundTask(this.handleClearBrowserSiteSession(socket, frame));
          return;
        }
        if (frame.type === 'browser.recording.list') {
          this.handleListBrowserRecordings(socket, frame);
          return;
        }
        if (frame.type === 'browser.recording.get') {
          this.trackBackgroundTask(this.handleGetBrowserRecording(socket, frame));
          return;
        }
        if (frame.type === 'browser.recording.start') {
          this.trackBackgroundTask(this.handleStartBrowserRecording(socket, frame));
          return;
        }
        if (frame.type === 'browser.recording.stop') {
          this.trackBackgroundTask(this.handleStopBrowserRecording(socket, frame));
          return;
        }
        if (frame.type === 'browser.workflow.list') {
          this.handleListBrowserWorkflows(socket, frame);
          return;
        }
        if (frame.type === 'browser.workflow.get') {
          this.handleGetBrowserWorkflow(socket, frame);
          return;
        }
        if (frame.type === 'browser.workflow.createDraft') {
          this.handleCreateBrowserWorkflowDraft(socket, frame);
          return;
        }
        if (frame.type === 'browser.workflow.createRevisionDraft') {
          this.handleCreateBrowserWorkflowRevisionDraft(socket, frame);
          return;
        }
        if (frame.type === 'browser.workflow.submit') {
          this.handleSubmitBrowserWorkflowDraft(socket, frame);
          return;
        }
        if (frame.type === 'browser.workflow.review') {
          this.handleReviewBrowserWorkflowDraft(socket, frame);
          return;
        }
        if (frame.type === 'browser.workflow.execute') {
          this.trackBackgroundTask(this.handleExecuteBrowserWorkflow(socket, frame));
          return;
        }
        if (frame.type === 'browser.workflow.approveAndExecute') {
          this.trackBackgroundTask(this.handleApproveExecuteBrowserWorkflow(socket, frame));
          return;
        }
        if (frame.type === 'desktop.command.listWaiting') {
          this.handleListWaitingDesktopCommands(socket, frame);
          return;
        }
        if (frame.type === 'desktop.command.continue') {
          this.handleContinueDesktopCommand(socket, frame);
          return;
        }
        if (frame.type === 'desktop.command.cancel') {
          this.handleCancelDesktopCommand(socket, frame);
          return;
        }
        if (frame.type === 'browser.handoff.listWaiting') {
          this.handleListWaitingBrowserHandoffs(socket, frame);
          return;
        }
        if (frame.type === 'browser.handoff.continue') {
          this.trackBackgroundTask(this.handleContinueBrowserHandoff(socket, frame));
          return;
        }
        if (frame.type === 'browser.handoff.cancel') {
          this.trackBackgroundTask(this.handleCancelBrowserHandoff(socket, frame));
          return;
        }
        if (frame.type === 'skill.import') {
          this.handleImportSkill(socket, frame);
          return;
        }
        if (frame.type === 'skill.importRemote') {
          this.trackBackgroundTask(this.handleImportRemoteSkill(socket, frame));
          return;
        }
        if (frame.type === 'skill.local.scan') {
          this.handleSkillLocalScan(socket, frame);
          return;
        }
        if (frame.type === 'skill.local.import') {
          this.handleSkillLocalImport(socket, frame);
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
        if (frame.type === 'skill.setEnabled') {
          this.handleSetSkillEnabled(socket, frame);
          return;
        }
        if (frame.type === 'mcp.register') {
          this.trackBackgroundTask(this.handleRegisterMcpServer(socket, frame));
          return;
        }
        if (frame.type === 'mcp.registerRemote') {
          this.trackBackgroundTask(this.handleRegisterRemoteMcp(socket, frame));
          return;
        }
        if (frame.type === 'mcp.list') {
          this.trackBackgroundTask(this.handleListMcpServers(socket, frame));
          return;
        }
        if (frame.type === 'mcp.setEnabled') {
          this.handleSetMcpServerEnabled(socket, frame);
          return;
        }
        if (frame.type === 'mcp.delete') {
          this.handleDeleteMcpServer(socket, frame);
          return;
        }
        if (frame.type === 'capability.workspace.list') {
          this.handleListCapabilityWorkspaceActivations(socket, frame);
          return;
        }
        if (frame.type === 'capability.workspace.setActive') {
          this.handleSetCapabilityWorkspaceActive(socket, frame);
          return;
        }
        if (frame.type === 'capability.governance.list') {
          this.handleListCapabilityGovernance(socket, frame);
          return;
        }
        if (frame.type === 'capability.publishDraft.save') {
          this.handleSaveSkillPublishDraft(socket, frame);
          return;
        }
        if (frame.type === 'capability.publishDraft.list') {
          this.handleListSkillPublishDrafts(socket, frame);
          return;
        }
        if (frame.type === 'capability.publishDraft.get') {
          this.handleGetSkillPublishDraft(socket, frame);
          return;
        }
        if (frame.type === 'capability.publishDraft.submit') {
          this.handleSubmitSkillPublishDraft(socket, frame);
          return;
        }
        if (frame.type === 'capability.organize.preview') {
          this.handlePreviewCapabilityOrganize(socket, frame);
          return;
        }
        if (frame.type === 'capability.organize.getLatest') {
          this.handleGetLatestCapabilityOrganize(socket, frame);
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
    return healthcheck(this.startedAt, {
      inFlightRuns: this.inFlight.size,
      inFlightRunIds: [...this.inFlight],
      eventSequence: this.eventSequence,
    });
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
    this.rememberRecentEvents(
      checkpoint.events.map((event) => ({ ...event, payload: { ...event.payload } })),
    );
    this.events.sort((left, right) =>
      left.sequence === right.sequence
        ? String(left.id).localeCompare(String(right.id))
        : left.sequence - right.sequence,
    );
  }

  private restorePersistedState(): void {
    if (!this.stateStore) return;
    const checkpoint = this.stateStore.loadLatestCheckpoint(this.checkpointRunId);
    this.lastCheckpointEventSequence = checkpoint?.lastEventSequence ?? 0;
    if (checkpoint) {
      this.restoreProjection(checkpoint.state);
      this.eventSequence = checkpoint.lastEventSequence;
    }

    const replayAfter = checkpoint?.lastEventSequence ?? 0;
    if (
      this.stateStore.listEventPage &&
      (this.stateStore.getLatestEventCursor || this.stateStore.getLatestEventSequence)
    ) {
      const throughCursor = this.stateStore.getLatestEventCursor
        ? this.stateStore.getLatestEventCursor()
        : { sequence: this.stateStore.getLatestEventSequence!(), eventId: '' };
      let cursor: EventReplayCursor = { sequence: replayAfter, eventId: '' };
      while (true) {
        const page = this.stateStore.listEventPage({
          afterSequence: cursor.sequence,
          ...(cursor.eventId ? { afterId: cursor.eventId } : {}),
          throughSequence: throughCursor.sequence,
          ...(throughCursor.eventId ? { throughId: throughCursor.eventId } : {}),
          limit: RESTORE_EVENT_PAGE_SIZE,
        });
        if (page.length === 0) break;
        for (const event of page) {
          this.eventSequence = Math.max(this.eventSequence, event.sequence);
          this.applyEventToProjection(event);
        }
        this.rememberRecentEvents(
          page.map((event) => ({ ...event, payload: { ...event.payload } })),
        );
        cursor = cursorForEvent(page[page.length - 1]!);
      }
      this.eventSequence = Math.max(this.eventSequence, throughCursor.sequence);
    } else {
      const persistedEvents = this.stateStore.listAllEvents
        ? this.stateStore.listAllEvents(0)
        : this.stateStore.listEvents(this.workspaceId, 0);
      for (const event of persistedEvents) {
        this.eventSequence = Math.max(this.eventSequence, event.sequence);
        if (event.sequence > replayAfter) this.applyEventToProjection(event);
      }
      this.rememberRecentEvents(
        persistedEvents.map((event) => ({ ...event, payload: { ...event.payload } })),
      );
    }
    this.backfillDurableMessages();
  }

  /**
   * S1/S3: project historical chat events into SqliteMessageStore in bounded
   * cursor pages. Progress is durable and the job is safe to resume.
   */
  private backfillDurableMessages(): void {
    if (!this.messageStore || !this.stateStore) return;
    try {
      const stored = readBackfillProgress(
        this.appSettingStore?.get(MESSAGE_STORE_BACKFILL_SETTING_KEY)?.value,
      );
      const previous = stored?.version === MESSAGE_STORE_BACKFILL_VERSION ? stored : undefined;
      let cursor: EventReplayCursor = {
        sequence: previous?.lastEventSequence ?? 0,
        eventId: previous?.lastEventId ?? '',
      };
      const throughCursor = this.stateStore.getLatestEventCursor
        ? this.stateStore.getLatestEventCursor()
        : this.stateStore.getLatestEventSequence
          ? { sequence: this.stateStore.getLatestEventSequence(), eventId: '' }
          : undefined;
      const legacyEvents =
        throughCursor === undefined
          ? this.stateStore.listAllEvents
            ? this.stateStore.listAllEvents(cursor.sequence)
            : this.stateStore.listEvents(this.workspaceId, cursor.sequence)
          : undefined;
      let legacyConsumed = false;
      let progress = previous;

      while (true) {
        const events =
          throughCursor === undefined
            ? legacyConsumed
              ? []
              : ((legacyConsumed = true), legacyEvents ?? [])
            : this.stateStore.listEventPage
              ? this.stateStore.listEventPage({
                  afterSequence: cursor.sequence,
                  ...(cursor.eventId ? { afterId: cursor.eventId } : {}),
                  throughSequence: throughCursor.sequence,
                  ...(throughCursor.eventId ? { throughId: throughCursor.eventId } : {}),
                  limit: RESTORE_EVENT_PAGE_SIZE,
                })
              : [];
        if (events.length === 0) break;
        const result = backfillMessagesFromEvents(this.messageStore, events, {
          afterSequence: cursor.sequence,
          ...(cursor.eventId ? { afterEventId: cursor.eventId } : {}),
        });
        cursor = cursorForEvent(events[events.length - 1]!);
        progress = {
          version: MESSAGE_STORE_BACKFILL_VERSION,
          lastEventSequence: cursor.sequence,
          lastEventId: cursor.eventId,
          processedEvents: (progress?.processedEvents ?? 0) + result.processedEvents,
          writtenMessages: (progress?.writtenMessages ?? 0) + result.writtenMessages,
          updatedMessages: (progress?.updatedMessages ?? 0) + result.updatedMessages,
          skippedEvents: (progress?.skippedEvents ?? 0) + result.skippedEvents,
          completedAt: result.completedAt,
        };
        this.appSettingStore?.set(MESSAGE_STORE_BACKFILL_SETTING_KEY, progress);
        if (result.writtenMessages > 0 || result.updatedMessages > 0) {
          console.log(
            '[runtime] message-store backfill',
            `from=${result.fromSequence}`,
            `to=${result.toSequence}`,
            `written=${result.writtenMessages}`,
            `updated=${result.updatedMessages}`,
            `skipped=${result.skippedEvents}`,
          );
        }
      }

      if (throughCursor && !progress && throughCursor.sequence === 0) {
        this.appSettingStore?.set(MESSAGE_STORE_BACKFILL_SETTING_KEY, {
          version: MESSAGE_STORE_BACKFILL_VERSION,
          lastEventSequence: 0,
          lastEventId: '',
          processedEvents: 0,
          writtenMessages: 0,
          updatedMessages: 0,
          skippedEvents: 0,
          completedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.warn(
        '[runtime] message-store backfill failed:',
        error instanceof Error ? error.message : error,
      );
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
    const highWatermark = this.latestEventCursor();
    const afterCursor: EventReplayCursor = {
      sequence: payload.afterCursor,
      eventId: payload.afterEventId ?? '',
    };
    if (
      afterCursor.sequence > highWatermark.sequence ||
      (afterCursor.sequence === highWatermark.sequence &&
        afterCursor.eventId !== '' &&
        highWatermark.eventId !== '' &&
        afterCursor.eventId.localeCompare(highWatermark.eventId) > 0)
    ) {
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
      replayCursor: afterCursor,
      liveCursor: highWatermark,
    };
    this.subscriptions.set(streamId, subscription);
    this.writeReplayPage(
      socket,
      frame,
      streamId,
      subscription,
      payload.afterCursor + (payload.afterEventId ? 0 : 1),
    );
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
      subscription.replayCursor.sequence !== payload.afterCursor ||
      (payload.afterEventId !== undefined &&
        subscription.replayCursor.eventId !== payload.afterEventId)
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
    subscription.replayCursor = {
      sequence: page.payload.nextCursor,
      eventId: page.payload.nextEventId ?? '',
    };
    if (!page.payload.replayComplete) return;

    const activationWatermark = this.latestEventCursor();
    let cursor = subscription.highWatermark;
    while (true) {
      const events = this.listReplayEventPage(
        cursor,
        activationWatermark,
        MAX_REPLAY_SCANNED_EVENTS_PER_PAGE,
      );
      if (events.length === 0) break;
      for (const event of events) {
        if (this.subscriptionMatches(subscription, event)) {
          this.writeLiveEvent(socket, streamId, event);
        }
      }
      cursor = cursorForEvent(events[events.length - 1]!);
    }
    subscription.phase = 'live';
    subscription.liveCursor = activationWatermark;
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
      }
    | undefined {
    const replayedEvents: Event[] = [];
    let nextCursor = { ...subscription.replayCursor };
    let serializedEventBytes = 0;

    const createPayload = (
      events: Event[],
      cursor: EventReplayCursor,
      complete: boolean,
    ): EventReplayPagePayload | EventStreamStartedPayload => {
      const page: EventReplayPagePayload = {
        streamId,
        replayedEvents: events,
        nextCursor: cursor.sequence,
        nextEventId: cursor.eventId,
        highWatermark: subscription.highWatermark.sequence,
        highWatermarkEventId: subscription.highWatermark.eventId,
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
    const candidates = this.listReplayEventPage(
      subscription.replayCursor,
      subscription.highWatermark,
      MAX_REPLAY_SCANNED_EVENTS_PER_PAGE,
    );
    let stoppedBeforeCandidate = false;

    for (const event of candidates) {
      const matches = this.subscriptionMatches(subscription, event);
      if (matches && replayedEvents.length >= MAX_REPLAY_EVENTS_PER_PAGE) {
        stoppedBeforeCandidate = true;
        break;
      }
      if (matches) {
        let eventBytes: number;
        try {
          eventBytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
          if (replayedEvents.length > 0) eventBytes += 1;
        } catch {
          return undefined;
        }
        if (serializedEventBytes + eventBytes > eventBytesBudget) {
          if (sameCursor(nextCursor, subscription.replayCursor)) return undefined;
          stoppedBeforeCandidate = true;
          break;
        }
        replayedEvents.push(event);
        serializedEventBytes += eventBytes;
      }
      nextCursor = cursorForEvent(event);
    }

    const reachedKnownHighWatermark =
      subscription.highWatermark.eventId !== '' &&
      compareCursor(nextCursor, subscription.highWatermark) >= 0;
    const replayComplete =
      candidates.length === 0 ||
      reachedKnownHighWatermark ||
      (!stoppedBeforeCandidate && candidates.length < MAX_REPLAY_SCANNED_EVENTS_PER_PAGE);
    if (replayComplete) nextCursor = { ...subscription.highWatermark };
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
      };
    } catch {
      return undefined;
    }
  }

  private latestEventCursor(): EventReplayCursor {
    let latest: EventReplayCursor = { sequence: this.eventSequence, eventId: '' };
    if (this.stateStore?.getLatestEventCursor) {
      const stored = this.stateStore.getLatestEventCursor();
      if (compareCursor(stored, latest) > 0 || stored.sequence === latest.sequence) {
        latest = { ...stored };
      }
    }
    for (const event of this.events) {
      const candidate = cursorForEvent(event);
      if (compareCursor(candidate, latest) > 0) latest = candidate;
    }
    return latest;
  }

  private listReplayEventPage(
    afterCursor: EventReplayCursor,
    throughCursor: EventReplayCursor,
    limit: number,
  ): Event[] {
    if (throughCursor.sequence < afterCursor.sequence) return [];
    if (this.stateStore?.listEventPage) {
      return this.stateStore.listEventPage({
        afterSequence: afterCursor.sequence,
        ...(afterCursor.eventId ? { afterId: afterCursor.eventId } : {}),
        throughSequence: throughCursor.sequence,
        ...(throughCursor.eventId ? { throughId: throughCursor.eventId } : {}),
        limit,
      });
    }
    return this.events
      .filter((event) => {
        const id = String(event.id);
        const after =
          event.sequence > afterCursor.sequence ||
          (afterCursor.eventId !== '' &&
            event.sequence === afterCursor.sequence &&
            id.localeCompare(afterCursor.eventId) > 0);
        const through =
          event.sequence < throughCursor.sequence ||
          (event.sequence === throughCursor.sequence &&
            (throughCursor.eventId === '' || id.localeCompare(throughCursor.eventId) <= 0));
        return after && through;
      })
      .sort((left, right) =>
        left.sequence === right.sequence
          ? String(left.id).localeCompare(String(right.id))
          : left.sequence - right.sequence,
      )
      .slice(0, limit);
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

  private handleSubscribeConversationTransientStream(socket: Socket, frame: Frame): void {
    const payload = parseSubscribeConversationTransientStreamPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const afterStreamSequence = payload.afterStreamSequence ?? 0;
    const latestStreamSequence = this.transientSequenceByThread.get(payload.threadId) ?? 0;
    const cursorAhead = afterStreamSequence > latestStreamSequence;

    const retained = this.transientReplay.filter(
      (candidate) => candidate.threadId === payload.threadId,
    );
    const candidates = cursorAhead
      ? []
      : retained.filter((candidate) => candidate.streamSequence > afterStreamSequence);
    const replayedFrames: ConversationTransientFrame[] = [];
    let replayBytes = 0;
    for (let index = candidates.length - 1; index >= 0; index--) {
      const candidate = candidates[index]!;
      const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
      if (candidateBytes > MAX_TRANSIENT_REPLAY_BYTES - replayBytes) break;
      replayedFrames.push(candidate);
      replayBytes += candidateBytes;
    }
    replayedFrames.reverse();
    const earliestReplayedSequence = replayedFrames[0]?.streamSequence;
    const earliestRetainedSequence = retained[0]?.streamSequence;
    const resetRequired =
      cursorAhead ||
      (latestStreamSequence > afterStreamSequence &&
        (earliestRetainedSequence === undefined ||
          afterStreamSequence < earliestRetainedSequence - 1 ||
          earliestReplayedSequence === undefined ||
          afterStreamSequence < earliestReplayedSequence - 1));
    const streamId = `transient_${ulid()}`;
    this.transientSubscriptions.set(streamId, {
      socket,
      threadId: payload.threadId,
      liveCursor: latestStreamSequence,
    });
    const activeSnapshot = this.transientSnapshotByThread.get(payload.threadId);
    const response: SubscribeConversationTransientStreamResponse = {
      streamId,
      threadId: payload.threadId,
      replayedFrames,
      ...(activeSnapshot ? { snapshot: activeSnapshot } : {}),
      latestStreamSequence,
      resetRequired,
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'conversation.subscribeTransientStream',
        payload: response,
      }),
    );
  }

  private handleUnsubscribeConversationTransientStream(socket: Socket, frame: Frame): void {
    const payload = parseUnsubscribeConversationTransientStreamPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const subscription = this.transientSubscriptions.get(payload.streamId);
    if (!subscription || subscription.socket !== socket) {
      this.writeUnexpectedRequest(socket, frame, 'Transient stream subscription is not valid');
      return;
    }
    this.transientSubscriptions.delete(payload.streamId);
    const response: UnsubscribeConversationTransientStreamResponse = {
      streamId: payload.streamId,
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'conversation.unsubscribeTransientStream',
        payload: response,
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

  private queryContext(): QueryContext {
    return {
      workspaceStore: this.workspaceStore,
      writeMalformedPayload: (socket, frame) => this.writeMalformedPayload(socket, frame),
      writeWorkspaceStoreUnavailable: (socket, frame) =>
        this.writeWorkspaceStoreUnavailable(socket, frame),
      writeWorkspaceCommandError: (socket, frame, error) =>
        this.writeWorkspaceCommandError(socket, frame, error),
      toWorkspaceSummary: (workspace) => this.toWorkspaceSummary(workspace),
    };
  }

  private handleListWorkspaces(socket: Socket, frame: Frame): void {
    queries.handleListWorkspaces(this.queryContext(), socket, frame);
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
        sortOrder: payload.sortOrder,
        hidden: payload.hidden,
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
    queries.handleListTasks(this.queryContext(), socket, frame);
  }

  private handleOpenTask(socket: Socket, frame: Frame): void {
    queries.handleOpenTask(this.queryContext(), socket, frame);
  }

  private handleSearchTasks(socket: Socket, frame: Frame): void {
    queries.handleSearchTasks(this.queryContext(), socket, frame);
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
                capabilities: suggestCapabilities({
                  providerModelId: id,
                  protocol: payload.protocol,
                }).capabilities,
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
            this.rememberRecentEvents([event]);
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
            this.rememberRecentEvents([event]);
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

        const mappedProtocol = mapped.protocol;

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
                capabilities: suggestCapabilities({ providerModelId: id, protocol: mappedProtocol })
                  .capabilities,
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
            capabilities: suggestCapabilities({ providerModelId: id, protocol }).capabilities,
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
          capabilities: suggestCapabilities({ providerModelId: id, protocol }).capabilities,
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
            this.rememberRecentEvents([event]);
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
            this.rememberRecentEvents([event]);
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
            this.rememberRecentEvents([event]);
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
      // Audit metadata only �?never the secret.
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
            this.rememberRecentEvents([event]);
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
            this.rememberRecentEvents([event]);
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
      if (record.key === OPEN_GATEWAY_SETTING_KEY) {
        // Converge the listener in the background: the shell polls gateway.status
        // for the result, so the set response must not wait on a port bind.
        this.trackBackgroundTask(
          this.syncOpenGatewayFromSettings().catch((error) => {
            console.warn('[runtime] open gateway reconfigure failed', error);
          }),
        );
      }
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private async handleUsageSummary(socket: Socket, frame: Frame): Promise<void> {
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
      const raw = await this.queryUsageSummary(sinceIso);
      const scopedRawRequests = payload.taskId
        ? raw.requests.filter((request) => request.taskId === payload.taskId)
        : raw.requests;
      const scopedRawRows: UsageSummaryRawResult['rows'] = payload.taskId
        ? (() => {
            const byModel = new Map<
              string,
              UsageSummaryRawResult['rows'][number] & {
                latencyTotalMs: number;
                latencySamples: number;
              }
            >();
            for (const request of scopedRawRequests) {
              const key = `${request.providerId ?? ''}|${request.modelId}`;
              const current = byModel.get(key) ?? {
                modelId: request.modelId,
                providerId: request.providerId,
                requests: 0,
                succeededRequests: 0,
                failedRequests: 0,
                tokensIn: 0,
                tokensOut: 0,
                cachedTokensHit: undefined,
                cachedTokensCreated: undefined,
                reasoningTokens: 0,
                totalTokens: 0,
                latencyTotalMs: 0,
                latencySamples: 0,
                lastUsedAt: request.occurredAt,
              };
              current.requests += 1;
              if (request.status === 'success') current.succeededRequests += 1;
              if (request.status === 'failed') current.failedRequests += 1;
              current.tokensIn += request.tokensIn;
              current.tokensOut += request.tokensOut;
              if (request.cachedTokensHit !== undefined) {
                current.cachedTokensHit = (current.cachedTokensHit ?? 0) + request.cachedTokensHit;
              }
              if (request.cachedTokensCreated !== undefined) {
                current.cachedTokensCreated =
                  (current.cachedTokensCreated ?? 0) + request.cachedTokensCreated;
              }
              current.reasoningTokens += request.reasoningTokens ?? 0;
              current.totalTokens += request.totalTokens;
              if (typeof request.latencyMs === 'number') {
                current.latencyTotalMs += request.latencyMs;
                current.latencySamples += 1;
                current.averageLatencyMs = current.latencyTotalMs / current.latencySamples;
              }
              if (!current.lastUsedAt || request.occurredAt > current.lastUsedAt) {
                current.lastUsedAt = request.occurredAt;
              }
              byModel.set(key, current);
            }
            return Array.from(byModel.values())
              .map(
                ({ latencyTotalMs: _latencyTotalMs, latencySamples: _latencySamples, ...row }) =>
                  row,
              )
              .sort((left, right) => right.tokensOut - left.tokensOut);
          })()
        : raw.rows;
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
          // strip vendor prefix: "z-ai/glm-5.2" �?"glm-5.2"
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
      const requests = scopedRawRequests.map((row) => {
        const modelPricing = resolvePricing(row.modelId);
        const estimatedCostBreakdown = modelPricing
          ? estimateUsageCostBreakdown(row, modelPricing)
          : undefined;
        return {
          ...row,
          displayName: resolveDisplayName(row.modelId),
          providerName: row.providerId ? providerNameById.get(row.providerId) : undefined,
          estimatedCost: estimatedCostBreakdown?.total,
          estimatedCostBreakdown,
          currency: modelPricing?.currency,
        };
      });
      const rows: UsageSummaryRow[] = scopedRawRows.map((row) => {
        const matchingRequests = requests.filter(
          (request) => request.modelId === row.modelId && request.providerId === row.providerId,
        );
        const pricedRequests = matchingRequests.filter(
          (request) => typeof request.estimatedCost === 'number' && request.currency !== undefined,
        );
        const currencies = new Set(pricedRequests.map((request) => request.currency));
        return {
          ...row,
          displayName: resolveDisplayName(row.modelId),
          providerName: row.providerId ? providerNameById.get(row.providerId) : undefined,
          totalCost:
            pricedRequests.length > 0 && currencies.size === 1
              ? pricedRequests.reduce((sum, request) => sum + (request.estimatedCost ?? 0), 0)
              : undefined,
          currency:
            currencies.size === 1
              ? (pricedRequests[0]?.currency as 'USD' | 'CNY' | undefined)
              : undefined,
        };
      });
      const scopedTools = payload.taskId ? [] : raw.tools;
      const scopedToolModels = payload.taskId ? [] : raw.toolModels;
      const scopedToolFailures = payload.taskId ? [] : raw.toolFailures;
      const toolModels = scopedToolModels.map((row) => ({
        ...row,
        displayName: resolveDisplayName(row.modelId),
      }));
      const toolFailures = scopedToolFailures.map((row) => ({
        ...row,
        displayName: row.modelId ? resolveDisplayName(row.modelId) : undefined,
      }));
      const cachedHits = requests
        .map((row) => row.cachedTokensHit)
        .filter((v): v is number => typeof v === 'number');
      const cachedCreated = requests
        .map((row) => row.cachedTokensCreated)
        .filter((v): v is number => typeof v === 'number');
      const totalReasoningTokens = requests.reduce(
        (sum, row) => sum + (row.reasoningTokens ?? 0),
        0,
      );
      const totalTokens = requests.reduce((sum, row) => sum + row.totalTokens, 0);
      const totalCostByCurrency: UsageSummaryResponse['totalCostByCurrency'] = {};
      for (const request of requests) {
        if (typeof request.estimatedCost !== 'number' || !request.currency) continue;
        totalCostByCurrency[request.currency] =
          (totalCostByCurrency[request.currency] ?? 0) + request.estimatedCost;
      }
      const response: UsageSummaryResponse = {
        rows,
        requests,
        tools: scopedTools,
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
        totalReasoningTokens,
        totalTokens,
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
      sortOrder: workspaceSortOrderFromPrefs(workspace.uiPrefsJson),
      hidden: workspaceHiddenFromPrefs(workspace.uiPrefsJson),
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
                message: `智能体仍有 ${referenced.length} 个对话引用，已归档而非删除`,
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
      // Refuse delete while conversations still reference this team �?historical
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

  /** Lazily hydrate the persisted runId → kernelId map. */
  private ensureRunKernelIdsLoaded(): void {
    if (this.runKernelIdsLoaded) return;
    this.runKernelIdsLoaded = true;
    const record = this.appSettingStore?.get('kernel.runKernelIds');
    if (!record || typeof record.value !== 'object' || record.value === null) return;
    try {
      const parsed = record.value as Record<string, unknown>;
      for (const [runId, kernelId] of Object.entries(parsed)) {
        if (runId && typeof kernelId === 'string' && kernelId) {
          this.runKernelIds.set(runId, kernelId);
        }
      }
    } catch {
      // Corrupt map — ignore and rebuild from future runs.
    }
  }

  /** Persist runId → kernelId so message badges survive process restarts. */
  private recordRunKernel(runId: string, kernelId: string | undefined): void {
    if (!runId || !kernelId) return;
    this.ensureRunKernelIdsLoaded();
    if (this.runKernelIds.get(runId) === kernelId) return;
    this.runKernelIds.set(runId, kernelId);
    try {
      const snapshot: Record<string, string> = {};
      for (const [key, value] of this.runKernelIds) snapshot[key] = value;
      this.appSettingStore?.set('kernel.runKernelIds', snapshot);
    } catch {
      // Best-effort persistence; the in-memory map still serves this session.
    }
  }

  private handleListConversationMessages(socket: Socket, frame: Frame): void {
    const payload = parseConversationListMessagesPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelCommandError(socket, frame, new Error('Conversation store unavailable'));
      return;
    }
    if (!this.workspaceStore) {
      this.writeTeamModelCommandError(socket, frame, new Error('Workspace/task store unavailable'));
      return;
    }
    if (!this.messageStore) {
      this.writeTeamModelCommandError(socket, frame, new Error('Message store unavailable'));
      return;
    }
    try {
      const conversation = this.conversationStore.get(payload.conversationId);
      if (!conversation) {
        throw new Error(`Conversation not found: ${payload.conversationId}`);
      }
      // Conversations that never had a message sent have no task/thread �?return empty page.
      const emptyPage: ConversationListMessagesResponse = { messages: [], hasMore: false };
      if (!conversation.taskId) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'conversation.listMessages',
            payload: emptyPage,
          }),
        );
        return;
      }
      const task = this.workspaceStore.getTask(conversation.taskId);
      if (!task || !task.threadId) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'conversation.listMessages',
            payload: emptyPage,
          }),
        );
        return;
      }
      // 部分对话的消息（大 timeline 工具输出）累计可能超过 1 MiB 帧上限，
      // 直接 encodeFrame 会抛 "frame exceeds max" 导致前端加载失败。
      // 超限时按页降级（减半 limit 重试），保证响应始终可编码、可继续翻页。
      let pageLimit = payload.limit ?? 50;
      let response: ConversationListMessagesResponse = this.messageStore.listMessages(
        task.threadId,
        {
          beforeSequence: payload.beforeSequence,
          limit: pageLimit,
        },
      );
      while (pageLimit > 1 && messagePageJsonBytes(response) > MAX_FRAME_BYTES - 8 * 1024) {
        pageLimit = Math.max(1, Math.floor(pageLimit / 2));
        response = this.messageStore.listMessages(task.threadId, {
          beforeSequence: payload.beforeSequence,
          limit: pageLimit,
        });
      }
      if (response.messages.length > 0) {
        this.ensureRunKernelIdsLoaded();
        // Backfill any runId missing from the persisted map from the event log
        // (run.started carries kernelId) so badges survive restarts even for
        // runs recorded before kernel tracking existed.
        const missingRunIds = response.messages
          .filter((message) => message.runId && !message.kernelId)
          .map((message) => String(message.runId));
        if (missingRunIds.length > 0) {
          const fromEvent = this.messageStore.resolveRunKernelIds(missingRunIds);
          for (const [runId, kernelId] of fromEvent) {
            this.runKernelIds.set(runId, kernelId);
          }
        }
        for (const message of response.messages) {
          if (message.runId && !message.kernelId) {
            const kernelId = this.runKernelIds.get(String(message.runId));
            if (kernelId) message.kernelId = kernelId;
          }
        }
      }
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.listMessages',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private buildRunAgentInstructions(run: DemoRunState, workspaceRoot?: string): string[] {
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
    const skillPrompt =
      run.skillPromptBlocks && run.skillPromptBlocks.length > 0
        ? [
            'Bound Skills (follow these instructions when relevant):',
            ...run.skillPromptBlocks,
          ].join('\n\n')
        : undefined;
    return [
      agentIdentityPrompt ??
        (workspaceRoot
          ? 'You are a coding assistant with filesystem tools for the bound project folder.'
          : 'You are a helpful assistant.'),
      skillPrompt,
    ].filter((value): value is string => Boolean(value));
  }

  private formatSkillPromptBlock(skill: { name: string; version: string; body: string }): string {
    const heading = `### Skill: ${skill.name}${skill.version ? ` (${skill.version})` : ''}`;
    return skill.body ? `${heading}\n${skill.body}` : heading;
  }

  /** Reload selected immutable Skill bodies after checkpoint/event recovery. */
  private hydrateRunSkillContext(run: DemoRunState): void {
    const skillVersionIds = run.skillVersionIds ?? [];
    if (skillVersionIds.length === 0) {
      run.skillPromptBlocks = undefined;
      return;
    }
    if (!this.skillStore) {
      throw new Error('Skill store is required to restore this Run');
    }

    const resolved = resolveAllowedSkillSources({
      skillVersionIds,
      maxSkills: 8,
      getSkill: (skillVersionId) => {
        const row = this.skillStore?.getVersion(skillVersionId);
        if (!row || row.archivedAt) return undefined;
        if (this.skillStore?.isPermissionApproved(row.id) !== true) {
          throw new Error(`Skill version is not approved: ${skillVersionId}`);
        }
        return {
          id: row.id,
          name: row.name,
          version: row.version,
          description: row.description,
          body: row.body,
          contentFingerprint: row.contentFingerprint,
          allowedTools: row.allowedTools,
          hasScripts: row.hasScripts,
        };
      },
    });
    if (
      resolved.missingSkillVersionIds.length > 0 ||
      resolved.resolvedSkillVersionIds.length !== skillVersionIds.length
    ) {
      throw new Error(
        `Skill version not found during Run recovery: ${resolved.missingSkillVersionIds[0] ?? 'unknown'}`,
      );
    }

    const expectedFingerprints = new Map(
      (run.skillSnapshots ?? []).map((snapshot) => [
        snapshot.skillVersionId,
        snapshot.contentFingerprint,
      ]),
    );
    for (const skill of resolved.resolvedSkills) {
      const expected = expectedFingerprints.get(skill.skillVersionId);
      if (expected && expected !== skill.contentFingerprint) {
        throw new Error(`Skill version integrity mismatch: ${skill.skillVersionId}`);
      }
    }
    run.skillSnapshots = resolved.resolvedSkills.map((skill) => ({
      skillVersionId: skill.skillVersionId,
      contentFingerprint: skill.contentFingerprint,
    }));
    run.skillPromptBlocks = resolved.resolvedSkills.map((skill) =>
      this.formatSkillPromptBlock(skill),
    );
    const promptBySourceId = new Map(
      resolved.resolvedSkills.map(
        (skill) => [skill.sourceId, this.formatSkillPromptBlock(skill)] as const,
      ),
    );
    run.contextSources = run.contextSources?.map((source) =>
      source.kind === 'skill-definition' && source.disposition === 'included'
        ? { ...source, content: promptBySourceId.get(source.id) }
        : source,
    );
  }

  private getOrBuildConversationContextSnapshot(input: {
    threadId: string;
    modelId?: string;
    track?: 'model' | 'agent' | 'team';
    globalAgentId?: string;
    teamId?: string;
  }): ContextSnapshot {
    const cached = input.modelId
      ? this.contextSnapshotByThread.get(input.threadId)?.get(input.modelId)
      : undefined;
    if (cached) return cached;

    const prepared = this.prepareRunBinding({
      runId: ulid() as RunId,
      threadId: input.threadId,
      userText: '',
      modelId: input.modelId,
      track: input.track,
      globalAgentId: input.globalAgentId,
      teamId: input.teamId,
      skillVersionIds: [],
      skillContextMode: 'maintenance',
    });
    const messages = this.buildChatProviderMessages(prepared.run);
    const workspaceRoot = this.resolveChatWorkspaceRoot(input.threadId);
    const executionMode = this.resolveChatExecutionMode(input.threadId);
    const networkEnabled = prepared.run.networkEnabled === true;
    const agentToolsEnabled = Boolean(this.globalAgentStore);
    const desktopToolsEnabled = this.isComputerUsePluginEnabled();
    const browserWorkflowToolsEnabled = Boolean(this.browserWorkflowService);
    const toolsEnabled =
      Boolean(workspaceRoot) ||
      networkEnabled ||
      agentToolsEnabled ||
      desktopToolsEnabled ||
      browserWorkflowToolsEnabled;
    const snapshot = this.buildDefaultProviderContextSnapshot(prepared.run, {
      messages,
      toolsEnabled,
      workspaceRoot,
      executionMode,
      networkEnabled,
    });
    this.setConversationContextSnapshot(input.threadId, snapshot);
    return snapshot;
  }

  private setConversationContextSnapshot(threadId: string, snapshot: ContextSnapshot): void {
    let snapshotsByModel = this.contextSnapshotByThread.get(threadId);
    if (!snapshotsByModel) {
      snapshotsByModel = new Map<string, ContextSnapshot>();
      this.contextSnapshotByThread.set(threadId, snapshotsByModel);
    }
    snapshotsByModel.set(snapshot.status.modelId, snapshot);
  }

  private handleGetConversationContextStatus(socket: Socket, frame: Frame): void {
    let payload: ReturnType<typeof parseConversationGetContextStatusPayload>;
    try {
      payload = parseConversationGetContextStatusPayload(frame.payload);
    } catch {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelCommandError(socket, frame, new Error('Conversation store unavailable'));
      return;
    }
    try {
      const conversation = this.conversationStore.get(payload.conversationId);
      if (!conversation) throw new Error(`Conversation not found: ${payload.conversationId}`);
      const task =
        conversation.taskId && this.workspaceStore
          ? this.workspaceStore.getTask(conversation.taskId)
          : undefined;
      const threadId = task?.threadId ? String(task.threadId) : String(conversation.id);
      // plan/exec 路由的模型与对话模式一致，上下文预览也按路由后的模型估算。
      const planActRoute = this.resolvePlanActRouteForThread(threadId);
      const contextModelId =
        planActRoute.applied && planActRoute.modelId
          ? planActRoute.modelId
          : (payload.modelId ?? this.resolveConversationDefaultModelId(conversation));
      const snapshot = this.getOrBuildConversationContextSnapshot({
        threadId,
        modelId: contextModelId,
        track: conversation.track,
        globalAgentId: conversation.track === 'agent' ? conversation.targetRef : undefined,
        teamId: conversation.track === 'team' ? conversation.targetRef : undefined,
      });
      const response: ConversationGetContextStatusResponse = {
        modelId: snapshot.status.modelId,
        contextWindow: snapshot.status.contextWindow,
        ...(snapshot.status.contextWindowEstimated === true
          ? { contextWindowEstimated: true }
          : {}),
        estimatedUsedTokens: snapshot.status.estimatedUsedTokens,
        usageRatio: snapshot.status.usageRatio,
        compactThreshold: snapshot.status.compactThreshold,
        ...(snapshot.status.compactedAt ? { compactedAt: snapshot.status.compactedAt } : {}),
        sections: snapshot.status.sections.map((section) => ({ ...section })),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.getContextStatus',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleGetConversationRunProcess(socket: Socket, frame: Frame): void {
    const payload = parseConversationGetRunProcessPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.stateStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const events = this.stateStore.listEventsByRun
        ? this.stateStore.listEventsByRun(payload.runId)
        : this.events.filter((event) => event.runId === payload.runId);
      const response: ConversationGetRunProcessResponse = {
        process: projectRunProcess(payload.runId, events),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.getRunProcess',
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

  private handleSetConversationInteractionMode(socket: Socket, frame: Frame): void {
    const payload = parseSetConversationInteractionModePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const updated = this.conversationStore.setInteractionMode(
        payload.conversationId,
        payload.interactionMode,
      );
      const conversation = this.toConversationSummary(updated);
      const event = this.appendEvent('system', 'conversation.interaction_mode_changed', {
        conversationId: conversation.id,
        interactionMode: conversation.interactionMode,
      });
      this.publishEvent(event);
      const response: ConversationResponse = { conversation };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.setInteractionMode',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  // ── Conversation plan (chat planning mode) ────────────────────────────────

  private handleConversationPlanSubmit(socket: Socket, frame: Frame): void {
    const payload = parseConversationPlanSubmitPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const plan = this.conversationStore.submitConversationPlan(
        payload.conversationId,
        payload.plan,
      );
      const conversation = this.conversationStore.get(payload.conversationId);
      if (!conversation) throw new Error('conversation not found');
      const response: ConversationPlanResponse = {
        conversation: this.toConversationSummary(conversation),
        plan,
      };
      const event = this.appendEvent('system', 'conversation.plan_submitted', {
        conversationId: payload.conversationId,
        revision: plan.currentRevision,
      });
      this.publishEvent(event);
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.plan.submit',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleConversationPlanGet(socket: Socket, frame: Frame): void {
    const payload = parseConversationPlanGetPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const plan = this.conversationStore.getConversationPlan(payload.conversationId);
      const conversation = this.conversationStore.get(payload.conversationId);
      if (!conversation) throw new Error('conversation not found');
      const response: ConversationPlanResponse = {
        conversation: this.toConversationSummary(conversation),
        plan,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.plan.get',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleConversationPlanApprove(socket: Socket, frame: Frame): void {
    const payload = parseConversationPlanApprovePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const plan = this.conversationStore.approveConversationPlan(
        payload.conversationId,
        payload.revision,
      );
      // Approving the plan exits planning mode: the follow-up execution run
      // must run with full tools. The desktop immediately starts it through the
      // normal message flow (appendMessage) after this command returns.
      this.conversationStore.setInteractionMode(payload.conversationId, 'execute');
      const conversation = this.conversationStore.get(payload.conversationId);
      if (!conversation) throw new Error('conversation not found');
      const response: ConversationPlanApproveResponse = {
        conversation: this.toConversationSummary(conversation),
        plan,
        createdRun: false,
      };
      const event = this.appendEvent('system', 'conversation.plan_approved', {
        conversationId: payload.conversationId,
        revision: plan.currentRevision,
      });
      this.publishEvent(event);
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.plan.approve',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleConversationPlanRevise(socket: Socket, frame: Frame): void {
    const payload = parseConversationPlanRevisePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const plan = this.conversationStore.reviseConversationPlan(
        payload.conversationId,
        payload.expectedRevision,
        payload.plan,
      );
      const conversation = this.conversationStore.get(payload.conversationId);
      if (!conversation) throw new Error('conversation not found');
      const response: ConversationPlanResponse = {
        conversation: this.toConversationSummary(conversation),
        plan,
      };
      const event = this.appendEvent('system', 'conversation.plan_revised', {
        conversationId: payload.conversationId,
        revision: plan.currentRevision,
      });
      this.publishEvent(event);
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.plan.revise',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleConversationPlanCancel(socket: Socket, frame: Frame): void {
    const payload = parseConversationPlanCancelPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.conversationStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    try {
      const plan = this.conversationStore.cancelConversationPlan(payload.conversationId);
      const conversation = this.conversationStore.get(payload.conversationId);
      if (!conversation) throw new Error('conversation not found');
      const response: ConversationPlanResponse = {
        conversation: this.toConversationSummary(conversation),
        plan,
      };
      const event = this.appendEvent('system', 'conversation.plan_cancelled', {
        conversationId: payload.conversationId,
      });
      this.publishEvent(event);
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.plan.cancel',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  // ── Conversation ask（模型主动问询） ─────────────────────────────────────

  private handleConversationAskAnswer(socket: Socket, frame: Frame): void {
    const payload = parseConversationAskAnswerPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const entry = this.pendingAsks.get(payload.askId);
    if (!entry) {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.ask.answer',
          payload: {},
          error: {
            code: ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
            message: 'Ask not found or already settled',
          },
        }),
      );
      return;
    }
    this.pendingAsks.delete(payload.askId);
    entry.resolve({ ok: true, content: JSON.stringify({ answers: payload.answers }) });
    this.publishEvent(
      this.appendEvent('system', 'conversation.ask_answered', {
        askId: payload.askId,
        threadId: entry.threadId,
        runId: entry.runId,
        answers: payload.answers,
        questions: entry.questions,
      }),
    );
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'conversation.ask.answer',
        payload: { askId: payload.askId },
      }),
    );
  }

  private handleConversationAskCancel(socket: Socket, frame: Frame): void {
    const payload = parseConversationAskCancelPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const entry = this.pendingAsks.get(payload.askId);
    if (!entry) {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'conversation.ask.cancel',
          payload: {},
          error: {
            code: ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
            message: 'Ask not found or already settled',
          },
        }),
      );
      return;
    }
    this.pendingAsks.delete(payload.askId);
    entry.resolve({ ok: false, error: 'ask_user_question cancelled' });
    this.publishEvent(
      this.appendEvent('system', 'conversation.ask_cancelled', {
        askId: payload.askId,
        threadId: entry.threadId,
        runId: entry.runId,
        reason: 'user-cancelled',
      }),
    );
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'conversation.ask.cancel',
        payload: { askId: payload.askId },
      }),
    );
  }

  private handleConversationAskPending(socket: Socket, frame: Frame): void {
    const payload = parseConversationAskPendingPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const entries = [...this.pendingAsks.values()].filter(
      (entry) => entry.threadId === payload.threadId,
    );
    const latest = entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const response: ConversationAskPendingResponse = latest
      ? {
          ask: {
            askId: latest.askId,
            threadId: latest.threadId,
            runId: latest.runId,
            questions: latest.questions,
            createdAt: latest.createdAt,
          },
        }
      : {};
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'conversation.ask.pending',
        payload: response,
      }),
    );
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
   * conversation.rebindTarget �?free retarget of "who this conversation talks
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
      const conversation = this.conversationStore.get(payload.conversationId);
      const sessionScopeIds = [String(payload.conversationId)];
      if (conversation?.taskId) {
        const threadId = this.workspaceStore?.getTask(conversation.taskId)?.threadId;
        if (threadId) sessionScopeIds.push(String(threadId));
      }
      this.clearKernelConversationSessionsForScopeIds(sessionScopeIds);
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
   * 1) User types /compact (or auto at ~70% window) �?runtime receives conversation.compact
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
      const events = this.stateStore.listEventsByTask
        ? this.stateStore.listEventsByTask(task.id)
        : this.stateStore.listAllEvents
          ? this.stateStore.listAllEvents(0)
          : this.stateStore.listEvents(this.workspaceId, 0);
      const compactModelId = this.resolveConversationDefaultModelId(conversation);
      const snapshot = this.getOrBuildConversationContextSnapshot({
        threadId,
        modelId: compactModelId,
        track: conversation.track,
        globalAgentId: conversation.track === 'agent' ? conversation.targetRef : undefined,
        teamId: conversation.track === 'team' ? conversation.targetRef : undefined,
      });
      const history = collectThreadChatHistory(events, threadId);
      const beforeTokens = snapshot.status.estimatedUsedTokens;
      const messageTokens =
        snapshot.status.sections.find((section) => section.type === 'messages')?.tokens ?? 0;
      const fixedContextTokens = Math.max(0, beforeTokens - messageTokens);
      const mode = payload.mode === 'auto' ? 'auto' : 'manual';
      const onlyIfNeeded = payload.onlyIfNeeded === true || mode === 'auto';
      if (onlyIfNeeded && !snapshot.status.shouldAutoCompact) {
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
              beforeTokens,
              afterTokens: beforeTokens,
              foldedCount: 0,
              durationMs: Date.now() - startedAt,
            },
          }),
        );
        return;
      }

      // Primary: model-generated structured summary (NewMax / Claude Code path).
      // Compare the compacted message estimate against the same full-request snapshot
      // used by the context ring; project/system/tool tokens remain fixed.
      let summaryText = '';
      let summarySource: 'model' | 'local' = 'local';
      let afterTokens = beforeTokens;

      const local = buildLocalCompactSummary({
        messages: history.messages,
        keepRecent,
        contextWindow: snapshot.status.contextWindow,
      });

      const modelSummary = await this.generateModelCompactSummary({
        threadId,
        conversationId: String(payload.conversationId),
        olderMessages: split.older,
        modelId: compactModelId,
      });
      if (modelSummary) {
        const wrapped = wrapModelCompactSummary(modelSummary);
        const modelAfter =
          fixedContextTokens + estimateCompactAfterTokens(wrapped, split.keptMessages);
        // Require a real reduction; otherwise local truncate is better for the ring.
        if (wrapped && isMeaningfulCompactReduction(beforeTokens, modelAfter)) {
          summaryText = wrapped;
          summarySource = 'model';
          afterTokens = modelAfter;
        }
      }
      if (!summaryText) {
        // Local path already rejects non-shrinking summaries (empty summaryText).
        summaryText = local.summaryText;
        summarySource = 'local';
        afterTokens = fixedContextTokens + local.afterTokens;
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
      // Prefer durable task.version �?same source appendMessage uses for OCC.
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
      this.latestCompactByThread.set(threadId, {
        summaryText,
        compactedAt: written.compactEvent.occurredAt,
      });
      this.contextSnapshotByThread.delete(threadId);
      this.contextRunByThread.delete(threadId);
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
   * Resolve the durable default model for context previews and compact summaries.
   * Model track �?targetRef; agent track �?agent.defaultModelId;
   * team track �?coordinator agent default model (fallback: undefined �?fake/default).
   */
  private resolveConversationDefaultModelId(conversation: {
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
        agent && typeof agent.defaultModelId === 'string'
          ? String(agent.defaultModelId).trim()
          : '';
      return modelId || undefined;
    }
    if (track === 'team') {
      const team = this.teamStore?.get(targetRef as TeamId);
      const coordinatorId =
        team && typeof team.coordinatorAgentId === 'string' ? team.coordinatorAgentId : undefined;
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
   * Tools are intentionally disabled �?compaction agents must only produce text.
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
        skillVersionIds: [],
        // Compaction summarizes transcripts; thinking tokens are wasted here
        // and push the 90s budget. 'off' is the explicit opt-out.
        reasoningEffort: 'off',
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
      interactionMode: record.interactionMode,
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
   * Thread-scoped Manifest amend (protocol context.packet.amend, design �?0.3).
   * Stores force-exclude overrides applied on next peek / run. Protected kinds
   * (�?0.9) cannot be force-excluded; refused ids are returned for observability.
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
      const task = this.resolveTaskForThread(payload.threadId);
      const conversation =
        task && this.conversationStore ? this.conversationStore.getByTaskId(task.id) : undefined;
      const userText =
        typeof payload.userText === 'string' && payload.userText.trim().length > 0
          ? payload.userText
          : '（预览：尚未发送的上下文）';
      const prepared = this.prepareRunBinding({
        runId: peekRunId,
        threadId: payload.threadId,
        userText,
        modelId: typeof payload.modelId === 'string' ? payload.modelId : undefined,
        credentialRefId:
          typeof payload.credentialRefId === 'string' ? payload.credentialRefId : undefined,
        agentVersionId:
          typeof payload.agentVersionId === 'string' ? payload.agentVersionId : undefined,
        track: conversation?.track,
        globalAgentId: conversation?.track === 'agent' ? conversation.targetRef : undefined,
        teamId: conversation?.track === 'team' ? conversation.targetRef : undefined,
        skillVersionIds: [],
        skillContextMode: 'maintenance',
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
   * �?.1 / �?.3: Import never auto-allowlists. After a human approves a
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

  private toSkillVersionSummary(
    record: SkillVersionRecord | SkillVersionMetadataRecord,
  ): SkillVersionSummary {
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
      enabled: record.enabled,
      originType: record.originType,
      originRef: record.originRef,
      derivedFromSkillVersionId: record.derivedFromSkillVersionId,
      createdAt: record.createdAt,
    };
  }

  /**
   * Import SKILL.md as a content-addressed library entry (�?.2).
   * Parse-only: scripts/shell tools are recorded, never executed on import.
   * Installing a Skill does not auto-allowlist it for any Agent (�?.1).
   */
  /**
   * Shared SKILL.md import core used by the skill.import command and the
   * create_skill / update_skill chat tools. Parses text only �?never executes
   * scripts. Emits skill.imported (+ optional reapproval) events.
   */
  private importSkillMdCore(skillMd: string): ImportSkillResponse {
    if (!this.skillStore) throw new Error('Skill store is not configured on this Runtime.');
    const parsed = parseSkillMd(skillMd);
    return this.finishSkillImport(skillMd, parsed);
  }

  /** Fetch and import a remote SKILL.md. Fetching is bounded and parse-only. */
  private async handleImportRemoteSkill(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseImportRemoteSkillPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.skillStore) {
      this.writeSkillStoreUnavailable(socket, frame);
      return;
    }
    try {
      const fetched = await fetchRemoteSkillMd(payload.url);
      let parsed: ReturnType<typeof parseSkillMd>;
      try {
        parsed = parseSkillMd(fetched.skillMd);
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
              type: 'skill.importRemote',
              payload: {},
              error: { code, message: error.message },
            }),
          );
          return;
        }
        throw error;
      }
      const imported = this.finishSkillImport(fetched.skillMd, parsed, {
        originType: 'market',
        originRef: payload.originRef ?? fetched.url,
        skillId: payload.skillId,
      });
      const response: ImportRemoteSkillResponse = {
        ...imported,
        sourceUrl: fetched.url,
        fetchedBytes: fetched.fetchedBytes,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'skill.importRemote',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
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
      const response = this.finishSkillImport(payload.skillMd, parsed, payload);
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

  // ── 本地 Skill 发现（约定目录 ~/.sync-think/skills） ───────────────────────

  private localSkillWatchCleanup?: () => void;
  private localSkillCache: LocalSkillCandidate[] = [];

  private handleSkillLocalScan(socket: Socket, frame: Frame): void {
    const payload = (frame.payload ?? {}) as SkillLocalScanPayload;
    if (payload.refresh === true || this.localSkillCache.length === 0) {
      this.refreshLocalSkillCache();
    }
    const response: SkillLocalScanResponse = {
      directory: localSkillsDirectory(),
      candidates: this.localSkillCache,
      exists: existsSync(localSkillsDirectory()),
      watching: Boolean(this.localSkillWatchCleanup),
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'skill.local.scan',
        payload: response,
      }),
    );
  }

  private handleSkillLocalImport(socket: Socket, frame: Frame): void {
    const payload = frame.payload as SkillLocalImportPayload | undefined;
    if (!payload || typeof payload.path !== 'string' || payload.path.length === 0) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.skillStore) {
      this.writeSkillStoreUnavailable(socket, frame);
      return;
    }
    const root = localSkillsDirectory();
    const relativePath = relative(root, payload.path);
    if (
      relativePath.startsWith('..') ||
      relativePath.startsWith('.' + sep) ||
      relativePath === '..'
    ) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    try {
      const skillMd = readFileSync(payload.path, 'utf8');
      const parsed = parseSkillMd(skillMd);
      const imported = this.finishSkillImport(skillMd, parsed, {
        originType: 'local',
        originRef: payload.path,
      });
      this.refreshLocalSkillCache();
      this.publishEvent(
        this.appendEvent('system', 'skill.local_changed', {
          action: 'import',
          path: payload.path,
        }),
      );
      const response: SkillLocalImportResponse = { ...imported, path: payload.path };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'skill.local.import',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private refreshLocalSkillCache(): void {
    if (!this.skillStore) return;
    const candidates = scanLocalSkills(localSkillsDirectory());
    for (const candidate of candidates) {
      const existing = this.skillStore.findLatestByName(candidate.name ?? candidate.folderName);
      candidate.imported = Boolean(existing);
      candidate.skillId = existing?.skillId;
    }
    this.localSkillCache = candidates;
  }

  private startLocalSkillWatch(): void {
    if (this.localSkillWatchCleanup || !this.skillStore) return;
    const root = localSkillsDirectory();
    if (!existsSync(root)) return;
    this.localSkillWatchCleanup = watchLocalSkills(root, () => {
      this.refreshLocalSkillCache();
      this.publishEvent(
        this.appendEvent('system', 'skill.local_changed', {
          action: 'scan',
          directory: root,
        }),
      );
    });
  }

  /** Fingerprint + persist + permission diff + events for a parsed SKILL.md. */
  private finishSkillImport(
    skillMd: string,
    parsed: ReturnType<typeof parseSkillMd>,
    lineage: Pick<
      ImportSkillPayload,
      'originType' | 'originRef' | 'derivedFromSkillVersionId' | 'skillId'
    > = {},
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
        originType: lineage.originType,
        originRef: lineage.originRef,
        derivedFromSkillVersionId: lineage.derivedFromSkillVersionId,
        skillId: lineage.skillId as import('@sync-think/shared').SkillId | undefined,
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

  private handleSetSkillEnabled(socket: Socket, frame: Frame): void {
    const payload = parseSetSkillEnabledPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.skillStore) {
      this.writeSkillStoreUnavailable(socket, frame);
      return;
    }
    try {
      const updated = this.skillStore.setEnabled(payload.skillVersionId, payload.enabled);
      if (!updated) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'skill.setEnabled',
            payload: {},
            error: {
              code: ErrorCode.RUN_NOT_FOUND,
              message: `Skill version not found: ${payload.skillVersionId}`,
            },
          }),
        );
        return;
      }
      const skill = this.toSkillVersionSummary(updated);
      const event = this.appendEvent('provider', 'skill.enabledChanged', {
        skillVersionId: skill.skillVersionId,
        skillId: skill.skillId,
        name: skill.name,
        enabled: skill.enabled,
      });
      this.publishEvent(event);
      const response: SetSkillEnabledResponse = { skill };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'skill.setEnabled',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private skillQueryContext(): SkillQueryContext {
    return {
      skillStore: this.skillStore,
      capabilityStore: this.capabilityStore,
      mcpStore: this.mcpStore,
      writeMalformedPayload: (socket, frame) => this.writeMalformedPayload(socket, frame),
      writeSkillStoreUnavailable: (socket, frame) => this.writeSkillStoreUnavailable(socket, frame),
      writeMcpStoreUnavailable: (socket, frame) => this.writeMcpStoreUnavailable(socket, frame),
      writeProviderCommandError: (socket, frame, error) =>
        this.writeProviderCommandError(socket, frame, error),
      toSkillVersionSummary: (record) => this.toSkillVersionSummary(record),
      toMcpServerSummary: (record) => this.toMcpServerSummary(record),
    };
  }

  /** Read one Skill version's full SKILL.md source for display (never executed). */
  private handleGetSkill(socket: Socket, frame: Frame): void {
    skillQueries.handleGetSkill(this.skillQueryContext(), socket, frame);
  }

  private handleListSkills(socket: Socket, frame: Frame): void {
    skillQueries.handleListSkills(this.skillQueryContext(), socket, frame);
  }

  private mcpAuthSettingKey(mcpServerId: string): string {
    return `mcp.auth.${String(mcpServerId).trim()}`;
  }

  private readMcpAuthConfig(
    mcpServerId: string,
  ): { key?: string; storeHandle?: string; authScheme: string } | undefined {
    const id = String(mcpServerId ?? '').trim();
    if (!id) return undefined;
    const memory = this.mcpAuthHandles.get(id);
    if (memory) return memory;
    const stored = this.appSettingStore?.get(this.mcpAuthSettingKey(id))?.value;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return undefined;
    const rec = stored as Record<string, unknown>;
    const authScheme =
      typeof rec.authScheme === 'string' && rec.authScheme.trim()
        ? rec.authScheme.trim()
        : 'bearer';
    // Plaintext key (current format) takes precedence; legacy SecureStore
    // handle remains readable for previously stored keys.
    const plainKey = typeof rec.key === 'string' ? rec.key.trim() : '';
    const handle = typeof rec.storeHandle === 'string' ? rec.storeHandle.trim() : '';
    if (!plainKey && !handle) return undefined;
    const config = plainKey ? { key: plainKey, authScheme } : { storeHandle: handle, authScheme };
    this.mcpAuthHandles.set(id, config);
    return config;
  }

  private async persistMcpAuth(
    mcpServerId: string,
    key: string | undefined,
    authScheme: string | undefined,
  ): Promise<{ configured: boolean; authScheme: string }> {
    const previous = this.readMcpAuthConfig(mcpServerId);
    if (!key || !key.trim()) {
      return {
        configured: Boolean(previous),
        authScheme: previous?.authScheme ?? (String(authScheme ?? 'bearer').trim() || 'bearer'),
      };
    }
    const scheme = String(authScheme ?? previous?.authScheme ?? 'bearer').trim() || 'bearer';
    // Plaintext storage: the product echoes the latest key back into the
    // register dialog, so SecureStore handles no longer apply to new writes.
    const config = { key: key.trim(), authScheme: scheme };
    this.appSettingStore?.set(this.mcpAuthSettingKey(mcpServerId), config);
    this.mcpAuthHandles.set(String(mcpServerId), config);
    return { configured: true, authScheme: scheme };
  }

  private rollbackMcpRegistration(
    created: import('@sync-think/storage').McpServerRecord,
    previous: import('@sync-think/storage').McpServerRecord | undefined,
  ): void {
    if (!this.mcpStore) return;
    if (!previous) {
      this.mcpStore.delete(created.id);
      return;
    }
    this.mcpStore.register({
      id: previous.id,
      name: previous.name,
      transport: previous.transport,
      endpoint: previous.endpoint,
      tools: previous.tools,
      trusted: previous.trusted,
      maxOutputBytes: previous.maxOutputBytes,
      timeoutMs: previous.timeoutMs,
      notes: previous.notes,
    });
    this.mcpStore.setEnabled(previous.id, previous.enabled, previous.updatedAt);
  }

  private async retrieveMcpAuth(
    mcpServerId: string,
  ): Promise<{ key: string; authScheme: string } | undefined> {
    const config = this.readMcpAuthConfig(mcpServerId);
    if (!config) return undefined;
    // Plaintext key (current format).
    if (config.key) {
      return { key: config.key, authScheme: config.authScheme };
    }
    // Legacy SecureStore handle.
    if (config.storeHandle && this.secureStore) {
      try {
        const key = await this.secureStore.retrieveSecret(config.storeHandle);
        return key.trim() ? { key, authScheme: config.authScheme } : undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /** Register a remote HTTP MCP endpoint; key storage and tool discovery are best effort. */
  private async handleRegisterRemoteMcp(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseRegisterRemoteMcpPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.mcpStore) {
      this.writeMcpStoreUnavailable(socket, frame);
      return;
    }
    try {
      const endpoint = parseRemoteHttpUrl(payload.endpoint).toString();
      const key = payload.key?.trim() || payload.apiKey?.trim() || undefined;
      const before = this.mcpStore.list(500);
      const existing = before.find((row) => row.name === payload.name && row.endpoint === endpoint);
      const suppliedTools = payload.tools?.length ? payload.tools : undefined;
      let tools = suppliedTools ?? existing?.tools;
      let discovered = false;
      let discoveryError: string | undefined;
      if (payload.discoverTools !== false && !suppliedTools) {
        try {
          const credentials = key
            ? { key, authScheme: payload.authScheme ?? 'bearer' }
            : existing
              ? await this.retrieveMcpAuth(existing.id)
              : undefined;
          tools = await discoverRemoteMcpTools(endpoint, {
            auth: credentials
              ? { key: credentials.key, scheme: credentials.authScheme }
              : undefined,
            maxTools: 64,
          });
          discovered = true;
        } catch (error) {
          discoveryError = redactRemoteCapabilityError(error, key ? [key] : []);
        }
      }
      const record = this.mcpStore.register({
        id: existing?.id,
        name: payload.name,
        transport: 'remote-http',
        endpoint,
        tools: tools?.map((t) => ({
          name: t.name,
          description: t.description ?? '',
          inputSchemaJson: t.inputSchemaJson,
        })),
        trusted: payload.trusted,
        maxOutputBytes: payload.maxOutputBytes,
        timeoutMs: payload.timeoutMs,
        notes: payload.notes,
      });
      let storedAuth: { configured: boolean; authScheme: string };
      try {
        storedAuth = await this.persistMcpAuth(record.id, key, payload.authScheme);
      } catch (error) {
        this.rollbackMcpRegistration(record, existing);
        void error;
        throw new Error('MCP credential could not be stored securely');
      }
      const summary = this.toMcpServerSummary(record);
      const event = this.appendEvent('provider', 'mcp.registered', {
        mcpServerId: summary.mcpServerId,
        name: summary.name,
        transport: summary.transport,
        toolCount: summary.tools.length,
        trusted: summary.trusted,
        updated: Boolean(existing),
        remote: true,
        authConfigured: storedAuth.configured,
        discovered,
      });
      this.publishEvent(event);
      const response: RegisterRemoteMcpResponse = {
        server: {
          ...summary,
          authConfigured: storedAuth.configured,
          authScheme: storedAuth.authScheme,
        },
        updated: Boolean(existing),
        endpoint,
        authConfigured: storedAuth.configured,
        discovered,
        ...(discoveryError ? { discoveryError } : {}),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'mcp.registerRemote',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  /**
   * Register MCP server metadata (�?.3). Does not spawn process or call remote tools.
   * Tool schemas are recorded for later allowlisted Context Packet injection.
   */
  private async handleRegisterMcpServer(socket: Socket, frame: Frame): Promise<void> {
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
      const key = payload.key?.trim() || payload.apiKey?.trim() || undefined;
      let auth: { configured: boolean; authScheme: string };
      try {
        auth = await this.persistMcpAuth(record.id, key, payload.authScheme);
      } catch (error) {
        this.rollbackMcpRegistration(record, existing);
        void error;
        throw new Error('MCP credential could not be stored securely');
      }
      const summary = this.toMcpServerSummary(record);
      const event = this.appendEvent('provider', 'mcp.registered', {
        mcpServerId: summary.mcpServerId,
        name: summary.name,
        transport: summary.transport,
        toolCount: summary.tools.length,
        trusted: summary.trusted,
        updated: Boolean(existing),
        authConfigured: auth.configured,
      });
      this.publishEvent(event);
      const response: RegisterMcpServerResponse = {
        server: {
          ...summary,
          ...(auth.configured ? { authConfigured: true, authScheme: auth.authScheme } : {}),
        },
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

  private async hydrateLegacyMcpAuthKeys(): Promise<void> {
    if (!this.mcpStore || !this.secureStore) return;
    for (const server of this.mcpStore.list(500)) {
      const auth = this.readMcpAuthConfig(server.id);
      if (!auth?.storeHandle || auth.key) continue;
      try {
        const key = (await this.secureStore.retrieveSecret(auth.storeHandle)).trim();
        if (!key) continue;
        const migrated = { key, authScheme: auth.authScheme };
        this.mcpAuthHandles.set(String(server.id), migrated);
        try {
          this.appSettingStore?.set(this.mcpAuthSettingKey(server.id), migrated);
        } catch {
          // The in-memory value still lets this session display and use the key.
        }
      } catch {
        // Keep legacy auth status when its stored secret is no longer readable.
      }
    }
  }

  private async handleListMcpServers(socket: Socket, frame: Frame): Promise<void> {
    await this.hydrateLegacyMcpAuthKeys();
    skillQueries.handleListMcpServers(this.skillQueryContext(), socket, frame);
  }

  private handleSetMcpServerEnabled(socket: Socket, frame: Frame): void {
    const payload = parseSetMcpServerEnabledPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.mcpStore) {
      this.writeMcpStoreUnavailable(socket, frame);
      return;
    }
    try {
      const updated = this.mcpStore.setEnabled(payload.mcpServerId, payload.enabled);
      if (!updated) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'mcp.setEnabled',
            payload: {},
            error: {
              code: ErrorCode.RUN_NOT_FOUND,
              message: `MCP server not found: ${payload.mcpServerId}`,
            },
          }),
        );
        return;
      }
      const server = this.toMcpServerSummary(updated);
      const event = this.appendEvent('provider', 'mcp.enabledChanged', {
        mcpServerId: server.mcpServerId,
        name: server.name,
        enabled: server.enabled,
        toolCount: server.tools.length,
      });
      this.publishEvent(event);
      const response: SetMcpServerEnabledResponse = { server };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'mcp.setEnabled',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  /** Remove a registered MCP server; also drops agent allowlist references and auth config. */
  private handleDeleteMcpServer(socket: Socket, frame: Frame): void {
    const payload = parseDeleteMcpServerPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.mcpStore) {
      this.writeMcpStoreUnavailable(socket, frame);
      return;
    }
    try {
      const existing = this.mcpStore.get(payload.mcpServerId);
      if (!existing) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'mcp.delete',
            payload: { mcpServerId: payload.mcpServerId, deleted: false },
          }),
        );
        return;
      }
      // Drop the server from every global Agent allowlist (mcpServerIds).
      if (this.globalAgentStore) {
        const agents = this.globalAgentStore.list();
        for (const agent of agents) {
          if (!agent.mcpServerIds.includes(payload.mcpServerId)) continue;
          this.globalAgentStore.update({
            agentId: agent.id,
            mcpServerIds: agent.mcpServerIds.filter((id) => id !== payload.mcpServerId),
          });
        }
      }
      // Clear persisted auth config (plaintext key / legacy handle). The
      // settings store has no delete; an empty record makes readMcpAuthConfig
      // return undefined, which matches "no key configured".
      this.appSettingStore?.set(this.mcpAuthSettingKey(payload.mcpServerId), {
        key: '',
        authScheme: '',
      });
      this.mcpAuthHandles.delete(payload.mcpServerId);

      const deleted = this.mcpStore.delete(payload.mcpServerId);
      const event = this.appendEvent('provider', 'mcp.deleted', {
        mcpServerId: existing.id,
        name: existing.name,
        toolCount: existing.tools.length,
      });
      this.publishEvent(event);
      const response: DeleteMcpServerResponse = {
        mcpServerId: existing.id,
        deleted,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'mcp.delete',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private toCapabilityWorkspaceActivationSummary(
    record: import('@sync-think/storage').CapabilityWorkspaceActivationRecord,
  ): CapabilityWorkspaceActivationSummary {
    return {
      capabilityType: record.capabilityType,
      capabilityId: record.capabilityId,
      workspaceId: record.workspaceId,
      active: record.active,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private toCapabilityUsageSummary(
    record: import('@sync-think/storage').CapabilityUsageSummary,
  ): CapabilityUsageSummary {
    return {
      capabilityType: record.capabilityType,
      capabilityId: record.capabilityId,
      callCount: record.callCount,
      successCount: record.successCount,
      failedCount: record.failedCount,
      cancelledCount: record.cancelledCount,
      problemCount: record.problemCount,
      contextTokens: record.contextTokens,
      lastUsedAt: record.lastUsedAt,
    };
  }

  private toSkillPublishDraftSummary(
    record: import('@sync-think/storage').SkillPublishDraftRecord,
  ): SkillPublishDraftSummary {
    return {
      id: record.id,
      skillVersionId: record.skillVersionId,
      skillId: record.skillId,
      displayName: record.displayName,
      description: record.description,
      skillMd: record.skillMd,
      category: record.category,
      version: record.version,
      icon: record.icon,
      attachments: record.attachments.map((attachment) => ({
        name: attachment.name,
        size: attachment.size,
      })),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private toCapabilityOrganizeReportSummary(
    record: import('@sync-think/storage').CapabilityOrganizeReportRecord,
  ): CapabilityOrganizeReportSummary {
    return {
      id: record.id,
      workspaceId: record.workspaceId,
      contextBudgetTokens: record.contextBudgetTokens,
      categories: {
        unused: [...record.categories.unused],
        inactive: [...record.categories.inactive],
        problematic: [...record.categories.problematic],
        contextWarning: [...record.categories.contextWarning],
        highContext: [...record.categories.highContext],
      },
      summary: { ...record.summary },
      createdAt: record.createdAt,
    };
  }

  private handleListCapabilityWorkspaceActivations(socket: Socket, frame: Frame): void {
    const payload = parseCapabilityWorkspaceListPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.capabilityStore) {
      this.writeCapabilityStoreUnavailable(socket, frame);
      return;
    }
    try {
      const response: CapabilityWorkspaceListResponse = {
        activations: this.capabilityStore
          .listWorkspaceActivations(payload.workspaceId, payload.capabilityType)
          .map((record) => this.toCapabilityWorkspaceActivationSummary(record)),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'capability.workspace.list',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleSetCapabilityWorkspaceActive(socket: Socket, frame: Frame): void {
    const payload = parseCapabilityWorkspaceSetActivePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.capabilityStore || !this.skillStore || !this.mcpStore) {
      this.writeCapabilityStoreUnavailable(socket, frame);
      return;
    }
    try {
      const exists =
        payload.capabilityType === 'skill'
          ? Boolean(this.skillStore.getVersion(payload.capabilityId))
          : Boolean(this.mcpStore.get(payload.capabilityId));
      if (!exists) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'capability.workspace.setActive',
            payload: {},
            error: {
              code: ErrorCode.RUN_NOT_FOUND,
              message: `Capability not found: ${payload.capabilityType}:${payload.capabilityId}`,
            },
          }),
        );
        return;
      }
      const activation = this.capabilityStore.setWorkspaceActivation(payload);
      const response: CapabilityWorkspaceSetActiveResponse = {
        activation: this.toCapabilityWorkspaceActivationSummary(activation),
      };
      const event = this.appendEvent('provider', 'capability.workspaceActivationChanged', {
        ...response.activation,
      });
      this.publishEvent(event);
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'capability.workspace.setActive',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleListCapabilityGovernance(socket: Socket, frame: Frame): void {
    const payload = parseCapabilityGovernanceListPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.capabilityStore || !this.skillStore || !this.mcpStore) {
      this.writeCapabilityStoreUnavailable(socket, frame);
      return;
    }
    try {
      const skills = this.skillStore.listVersionMetadata(500);
      const mcpServers = this.mcpStore.list(500);
      const activations = this.capabilityStore.listWorkspaceActivations(payload.workspaceId);
      const activeIds = new Set(
        activations
          .filter((activation) => activation.active)
          .map((activation) => `${activation.capabilityType}:${activation.capabilityId}`),
      );
      const skillUsage = new Map(
        this.capabilityStore
          .summarizeUsage({
            capabilityType: 'skill',
            capabilityIds: skills.map((skill) => skill.id),
            workspaceId: payload.workspaceId,
            now: payload.now,
            windowDays: 45,
          })
          .map((usage) => [usage.capabilityId, this.toCapabilityUsageSummary(usage)] as const),
      );
      const mcpUsage = new Map(
        this.capabilityStore
          .summarizeUsage({
            capabilityType: 'mcp',
            capabilityIds: mcpServers.map((server) => server.id),
            workspaceId: payload.workspaceId,
            now: payload.now,
            windowDays: 45,
          })
          .map((usage) => [usage.capabilityId, this.toCapabilityUsageSummary(usage)] as const),
      );
      const response: CapabilityGovernanceListResponse = {
        workspaceId: payload.workspaceId,
        windowDays: 45,
        skills: skills.map((skill) => ({
          skill: this.toSkillVersionSummary(skill),
          workspaceActive: activeIds.has(`skill:${skill.id}`),
          usage: skillUsage.get(skill.id)!,
        })),
        mcpServers: mcpServers.map((server) => ({
          server: this.toMcpServerSummary(server),
          workspaceActive: activeIds.has(`mcp:${server.id}`),
          usage: mcpUsage.get(server.id)!,
        })),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'capability.governance.list',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleSaveSkillPublishDraft(socket: Socket, frame: Frame): void {
    const payload = parseSaveSkillPublishDraftPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.capabilityStore || !this.skillStore) {
      this.writeCapabilityStoreUnavailable(socket, frame);
      return;
    }
    try {
      const skill = this.skillStore.getVersion(payload.skillVersionId);
      if (!skill || skill.skillId !== payload.skillId) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'capability.publishDraft.save',
            payload: {},
            error: {
              code: ErrorCode.RUN_NOT_FOUND,
              message: `Skill version not found: ${payload.skillVersionId}`,
            },
          }),
        );
        return;
      }
      const draft = this.capabilityStore.saveSkillPublishDraft({
        ...payload,
        attachments: (payload.attachments ?? []).map((attachment) => ({
          name: attachment.name,
          size: attachment.size,
        })),
      });
      const response: SaveSkillPublishDraftResponse = {
        draft: this.toSkillPublishDraftSummary(draft),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'capability.publishDraft.save',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleListSkillPublishDrafts(socket: Socket, frame: Frame): void {
    const payload = parseListSkillPublishDraftsPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.capabilityStore) {
      this.writeCapabilityStoreUnavailable(socket, frame);
      return;
    }
    try {
      const response: ListSkillPublishDraftsResponse = {
        drafts: this.capabilityStore
          .listSkillPublishDrafts(payload.skillId, payload.limit ?? 100)
          .map((draft) => this.toSkillPublishDraftSummary(draft)),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'capability.publishDraft.list',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleGetSkillPublishDraft(socket: Socket, frame: Frame): void {
    const payload = parseGetSkillPublishDraftPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.capabilityStore) {
      this.writeCapabilityStoreUnavailable(socket, frame);
      return;
    }
    try {
      const draft = this.capabilityStore.getSkillPublishDraft(payload.id);
      if (!draft) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'capability.publishDraft.get',
            payload: {},
            error: {
              code: ErrorCode.RUN_NOT_FOUND,
              message: `Skill publish draft not found: ${payload.id}`,
            },
          }),
        );
        return;
      }
      const response: GetSkillPublishDraftResponse = {
        draft: this.toSkillPublishDraftSummary(draft),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'capability.publishDraft.get',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleSubmitSkillPublishDraft(socket: Socket, frame: Frame): void {
    const payload = parseSubmitSkillPublishDraftPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.capabilityStore) {
      this.writeCapabilityStoreUnavailable(socket, frame);
      return;
    }
    try {
      const draft = this.capabilityStore.getSkillPublishDraft(payload.id);
      if (!draft) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'capability.publishDraft.submit',
            payload: {},
            error: {
              code: ErrorCode.RUN_NOT_FOUND,
              message: `Skill publish draft not found: ${payload.id}`,
            },
          }),
        );
        return;
      }
      const result = this.capabilityStore.submitSkillPublishDraft(payload.id);
      const response: SubmitSkillPublishDraftResponse = {
        ...result,
        draft: this.toSkillPublishDraftSummary(draft),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'capability.publishDraft.submit',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handlePreviewCapabilityOrganize(socket: Socket, frame: Frame): void {
    const payload = parsePreviewCapabilityOrganizePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.capabilityStore) {
      this.writeCapabilityStoreUnavailable(socket, frame);
      return;
    }
    try {
      const report = this.capabilityStore.generateOrganizeReport(payload);
      const response: PreviewCapabilityOrganizeResponse = {
        report: this.toCapabilityOrganizeReportSummary(report),
        readOnly: true,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'capability.organize.preview',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  private handleGetLatestCapabilityOrganize(socket: Socket, frame: Frame): void {
    const payload = parseGetLatestCapabilityOrganizePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.capabilityStore) {
      this.writeCapabilityStoreUnavailable(socket, frame);
      return;
    }
    try {
      const report = this.capabilityStore.getLatestOrganizeReport(payload.workspaceId);
      const response: GetLatestCapabilityOrganizeResponse = {
        report: report ? this.toCapabilityOrganizeReportSummary(report) : undefined,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'capability.organize.getLatest',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  /**
   * Probe MCP process policy without spawning (�?.3).
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
          : '[probe] MCP policy dry-run �?no process spawn';
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
   * Soft craft MCP tool *request* (�?.3 �?�?3).
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
   * Real MCP JSON-RPC tool call (�?.3 / �?3 / �?4).
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
          labelZh: '缺少 mcpServerId/toolName',
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

    if (row.transport === 'remote-http') {
      const startedAt = Date.now();
      let startFailure = '';
      let failure = '';
      let started = false;
      try {
        const start = this.productionExecutionStore.startMcpAction(actionFence);
        started = start.startedNow;
        if (!started) startFailure = 'mcp.action_fence_not_started';
      } catch (error) {
        startFailure = error instanceof Error ? error.message : 'mcp.action_fence_mismatch';
      }

      let remoteResult: Awaited<ReturnType<typeof callRemoteMcpTool>> | undefined;
      let remoteAuthKey: string | undefined;
      if (started && !gate.signal.aborted) {
        try {
          const auth = await this.retrieveMcpAuth(row.id);
          remoteAuthKey = auth?.key;
          remoteResult = await callRemoteMcpTool(row.endpoint, input.toolName, toolArguments, {
            auth: auth ? { key: auth.key, scheme: auth.authScheme } : undefined,
            signal: gate.signal,
            timeoutMs: policy.timeoutMs,
            maxBytes: policy.maxOutputBytes,
          });
        } catch (error) {
          failure = redactRemoteCapabilityError(error, remoteAuthKey ? [remoteAuthKey] : []);
        }
      }

      const enforced = enforceMcpOutputLimit(remoteResult?.text ?? '', policy, {
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
        transport: row.transport,
        timedOut: /abort|timeout/i.test(failure),
      });
      const result = {
        ok: Boolean(remoteResult?.ok),
        timedOut: /abort|timeout/i.test(failure),
        truncated: enforced.truncated,
        contentTrust: enforced.contentTrust,
        rawBytes: enforced.rawBytes,
        keptBytes: enforced.keptBytes,
        policyLabel: formatMcpPolicyLabel(policy),
        preview: previewMcpOutput(enforced.text),
        auditNote: failure || enforced.audit.note,
        spawned: false,
        exitCode: null,
        elapsedMs: Date.now() - startedAt,
        command: `POST ${row.endpoint}`,
        jsonRpcOk: Boolean(remoteResult),
        toolResultText: enforced.text,
        protocol: 'mcp-jsonrpc' as const,
      };

      let completedFence = false;
      let calledEvent: Event | undefined;
      if (result.ok && result.jsonRpcOk && !gate.signal.aborted && !startFailure && !failure) {
        try {
          calledEvent = this.completeMcpActionWithAudit(
            actionFence,
            {
              mcpServerId: input.mcpServerId,
              toolName: input.toolName,
              ok: true,
              timedOut: false,
              truncated: result.truncated,
              contentTrust: result.contentTrust,
              remote: true,
              jsonRpcOk: true,
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
          failure = error instanceof Error ? error.message : 'mcp.action_completion_rejected';
        }
      }

      const refusalReason = completedFence
        ? undefined
        : startFailure ||
          (gate.signal.aborted ? 'mcp.action_cancelled' : '') ||
          failure ||
          (remoteResult?.ok === false ? 'mcp.remote_tool_returned_error' : '') ||
          'mcp.action_execution_failed';
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
        result: { ...result, ok: completedFence && result.ok },
      };
      if (calledEvent) {
        this.publishEvent(calledEvent);
      } else {
        this.publishEvent(
          this.appendOrchestrationMcpAudit(
            'mcp.tool_refused',
            {
              mcpServerId: input.mcpServerId,
              toolName: input.toolName,
              reason: refusalReason,
              source: input.source,
              remote: true,
              jsonRpcOk: result.jsonRpcOk,
              timedOut: result.timedOut,
              simulated: false,
            },
            validatedScope,
            gate.actionDigest,
          ),
        );
      }
      return response;
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
   * Refresh MCP tool catalog via real JSON-RPC tools/list (�?.3).
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
      if (row.transport === 'remote-http') {
        await this.handleRefreshRemoteMcpTools(socket, frame, row, payload);
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

  private async handleRefreshRemoteMcpTools(
    socket: Socket,
    frame: Frame,
    row: import('@sync-think/storage').McpServerRecord,
    payload: RefreshMcpToolsPayload,
  ): Promise<void> {
    const started = Date.now();
    const previousToolCount = row.tools.length;
    const previousNames = new Set(row.tools.map((tool) => tool.name));
    const policy = normalizeMcpProcessPolicy({
      maxOutputBytes: payload.maxOutputBytes ?? row.maxOutputBytes,
      timeoutMs: payload.timeoutMs ?? row.timeoutMs,
      trusted: row.trusted,
    });
    const auth = await this.retrieveMcpAuth(row.id);
    let response: RefreshMcpToolsResponse;
    try {
      const discovered = await discoverRemoteMcpTools(row.endpoint, {
        auth: auth ? { key: auth.key, scheme: auth.authScheme } : undefined,
        timeoutMs: policy.timeoutMs,
        maxBytes: policy.maxOutputBytes,
        maxTools: payload.maxTools,
      });
      const updated = this.mcpStore!.register({
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
      const server = this.toMcpServerSummary(updated);
      const names = new Set(updated.tools.map((tool) => tool.name));
      const addedToolNames = updated.tools
        .map((tool) => tool.name)
        .filter((name) => !previousNames.has(name));
      const removedToolNames = [...previousNames].filter((name) => !names.has(name));
      response = {
        ok: true,
        simulated: false,
        spawned: false,
        jsonRpcOk: true,
        timedOut: false,
        truncated: false,
        contentTrust: row.trusted ? 'trusted' : 'untrusted',
        mcpServerId: row.id,
        serverName: row.name,
        endpoint: row.endpoint,
        transport: row.transport,
        tools: server.tools,
        previousToolCount,
        toolCount: server.tools.length,
        addedToolNames,
        removedToolNames,
        policyLabel: formatMcpPolicyLabel(policy),
        preview: server.tools
          .map((tool) => tool.name)
          .join(', ')
          .slice(0, 512),
        auditNote: 'remote-http initialize -> notifications/initialized -> tools/list',
        elapsedMs: Date.now() - started,
        command: `POST ${row.endpoint}`,
        args: [],
        server,
      };
    } catch (error) {
      const reason = redactRemoteCapabilityError(error, auth?.key ? [auth.key] : []);
      response = {
        ok: false,
        simulated: false,
        spawned: false,
        jsonRpcOk: false,
        timedOut: /abort|timeout/i.test(reason),
        truncated: false,
        contentTrust: row.trusted ? 'trusted' : 'untrusted',
        mcpServerId: row.id,
        serverName: row.name,
        endpoint: row.endpoint,
        transport: row.transport,
        tools: this.toMcpServerSummary(row).tools,
        previousToolCount,
        toolCount: previousToolCount,
        addedToolNames: [],
        removedToolNames: [],
        policyLabel: formatMcpPolicyLabel(policy),
        preview: '',
        auditNote: reason,
        elapsedMs: Date.now() - started,
        command: `POST ${row.endpoint}`,
        args: [],
        refuseReason: reason,
      };
    }
    this.publishEvent(
      this.appendEvent('provider', 'mcp.tools_refreshed', {
        mcpServerId: row.id,
        serverName: row.name,
        transport: row.transport,
        ok: response.ok,
        jsonRpcOk: response.jsonRpcOk,
        toolCount: response.toolCount,
        previousToolCount,
        addedToolNames: response.addedToolNames,
        removedToolNames: response.removedToolNames,
        elapsedMs: response.elapsedMs,
        refuseReason: response.refuseReason ?? null,
        remote: true,
        simulated: false,
      }),
    );
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'mcp.tools.refresh',
        payload: response,
      }),
    );
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

  private writeCapabilityStoreUnavailable(socket: Socket, frame: Frame): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code: ErrorCode.STORAGE_WRITE_FAILED,
          message: 'Capability governance store is not configured on this Runtime',
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
      enabled: record.enabled,
      maxOutputBytes: record.maxOutputBytes,
      timeoutMs: record.timeoutMs,
      notes: record.notes,
      ...(this.readMcpAuthConfig(record.id)
        ? {
            authConfigured: true,
            authScheme: this.readMcpAuthConfig(record.id)!.authScheme,
            // Plaintext echo for the register dialog; only meaningful for
            // remote-http servers (local-stdio carries no auth key).
            ...(record.transport === 'remote-http' && this.readMcpAuthConfig(record.id)!.key
              ? { authKey: this.readMcpAuthConfig(record.id)!.key }
              : {}),
          }
        : {}),
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
      this.mergeDurableMessageImages(messageId as MessageId, images);
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
    if (payload.role === 'user') {
      try {
        this.authorizeRunSkillSelection({
          workspaceId: this.resolveEventWorkspaceId(payload.threadId),
          track: boundConversation?.track,
          agentVersionId:
            typeof payload.agentVersionId === 'string' ? payload.agentVersionId : undefined,
          globalAgentId,
          teamId,
          skillVersionIds: payload.skillVersionIds,
        });
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
      // Per-thread serialization: a new user message supersedes any in-flight
      // run on the same thread. Without this, overlapping streams interleave
      // events and two assistant turns fight over the same transcript.
      const superseded = [...this.demoRuns.entries()].filter(
        ([activeRunId, activeRun]) =>
          activeRun.threadId === payload.threadId && this.inFlight.has(activeRunId),
      );
      for (const [supersededRunId, supersededRun] of superseded) {
        this.demoRunAborts.get(supersededRunId)?.abort();
        this.demoRunAborts.delete(supersededRunId);
        for (const [approvalId, pending] of this.pendingToolApprovals) {
          if (pending.runId !== supersededRunId) continue;
          this.pendingToolApprovals.delete(approvalId);
          this.emitToolApprovalDecided({
            approvalId,
            threadId: pending.threadId,
            runId: pending.runId,
            decision: 'deny',
            reason: 'superseded-by-new-message',
            toolCallId: pending.pendingToolCalls[pending.currentIndex]?.id,
            toolName: pending.pendingToolCalls[pending.currentIndex]?.name,
          });
          pending.resolve('deny');
        }
        // Persist the superseded run's partial output (text + reasoning) as a
        // cancelled message — interjecting must not discard the visible trace,
        // matching manual-stop semantics.
        this.persistAssistantTerminalMessage(supersededRunId as RunId, supersededRun, 'cancelled');
        this.demoRuns.delete(supersededRunId);
        const projectedRuns = new Map(this.demoRuns);
        const event = this.persistProjectedEvent(
          {
            id: ulid() as Event['id'],
            workspaceId: this.resolveEventWorkspaceId(payload.threadId),
            taskId: this.resolveEventTaskId(payload.threadId),
            runId: supersededRunId as RunId,
            category: 'run',
            type: 'run.cancelled',
            occurredAt: new Date().toISOString(),
            payload: {
              threadId: payload.threadId,
              reason: 'superseded-by-new-message',
              assistantText: supersededRun.assistantText,
              idempotencyKey: supersededRunId,
            },
          },
          projectedRuns,
        );
        this.publishEvent(event);
      }
      demoRunId = ulid() as RunId;
      const explicitModelId =
        typeof payload.modelId === 'string' && payload.modelId.trim()
          ? payload.modelId.trim()
          : conversationModelId;
      let prepared: ReturnType<typeof this.prepareRunBinding>;
      try {
        prepared = this.prepareRunBinding({
          runId: demoRunId,
          threadId: payload.threadId,
          userText: payload.text,
          kernelId: typeof payload.kernelId === 'string' ? payload.kernelId : undefined,
          modelId: explicitModelId,
          credentialRefId:
            typeof payload.credentialRefId === 'string' ? payload.credentialRefId : undefined,
          agentVersionId:
            typeof payload.agentVersionId === 'string' ? payload.agentVersionId : undefined,
          track: boundConversation?.track,
          globalAgentId,
          teamId,
          skillVersionIds: payload.skillVersionIds,
          reasoningEffort:
            typeof payload.reasoningEffort === 'string' ? payload.reasoningEffort : undefined,
          networkEnabled: payload.networkEnabled === true ? true : undefined,
          planExecuting: payload.planExecuting === true ? true : undefined,
          images: Array.isArray(payload.images)
            ? payload.images.map((raw) => ({
                name: raw.name,
                mimeType: raw.mimeType,
                ...(typeof raw.stagingPath === 'string' ? { stagingPath: raw.stagingPath } : {}),
                ...(typeof raw.dataUrl === 'string' ? { dataUrl: raw.dataUrl } : {}),
              }))
            : undefined,
        });
      } catch (error) {
        this.writeProviderCommandError(socket, frame, error);
        return;
      }
      demoRun = prepared.run;
      projectedRuns.set(demoRunId, demoRun);
      eventDrafts.push({
        id: ulid() as Event['id'],
        workspaceId: persistedTask?.workspaceId ?? this.workspaceId,
        taskId: persistedTask?.id,
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
          kernelId: demoRun.kernelId,
          resolutionSource: demoRun.resolutionSource,
          credentialRefId: demoRun.credentialRefId,
          credentialResolutionSource: demoRun.credentialResolutionSource,
          agentVersionId: demoRun.agentVersionId,
          agentVersion: prepared.agentVersion,
          requestedSkillVersionIds: prepared.requestedSkillVersionIds,
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
      this.recordRunKernel(demoRunId, demoRun.kernelId);
      eventDrafts.push({
        id: ulid() as Event['id'],
        workspaceId: persistedTask?.workspaceId ?? this.workspaceId,
        taskId: persistedTask?.id,
        runId: demoRunId,
        category: 'run',
        type: 'run.started',
        occurredAt: new Date().toISOString(),
        payload: {
          threadId: payload.threadId,
          modelId: demoRun.modelId,
          providerModelId: demoRun.providerModelId,
          kernelId: demoRun.kernelId,
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
          ...(demoRun.kernelSessionPlan
            ? {
                sessionMode: demoRun.kernelSessionPlan.mode,
                gapCount: demoRun.kernelSessionPlan.gapCount,
              }
            : {}),
          ...(demoRun.effectiveContextWindow !== undefined
            ? { effectiveContextWindow: demoRun.effectiveContextWindow }
            : {}),
          ...(demoRun.contextWindowSource
            ? { contextWindowSource: demoRun.contextWindowSource }
            : {}),
          run: serializeDemoRun(demoRun),
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

    // Durable Message Store write (S1): final user/system/tool text message.
    // Images are attached later via message.attachImages (Desktop promotes staging �?storageRef).
    this.persistFinalChatMessage({
      id: messageId,
      threadId: payload.threadId as ThreadId,
      role: payload.role,
      text: payload.text,
      agentVersionId:
        typeof payload.agentVersionId === 'string'
          ? (payload.agentVersionId as AgentVersionId)
          : undefined,
      modelId:
        typeof payload.modelId === 'string' && payload.modelId.trim()
          ? (payload.modelId.trim() as ModelId)
          : undefined,
      credentialRefId:
        typeof payload.credentialRefId === 'string'
          ? (payload.credentialRefId as CredentialRefId)
          : undefined,
      createdAt: messageEventDraft.occurredAt,
    });

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
    if (demoRunId) void this.executeKernelRun(demoRunId);
  }

  // ===== Goal mode (NewMax-style /goal) =====

  private readonly activeGoals = new Map<string, GoalStatus>();

  private loadGoal(conversationId: string): GoalStatus | undefined {
    const inMemory = this.activeGoals.get(conversationId);
    if (inMemory) return inMemory;
    const record = this.appSettingStore?.get(`goal.${conversationId}`);
    if (!record) return undefined;
    const goal = record.value as GoalStatus | undefined;
    if (!goal || typeof goal !== 'object' || typeof goal.condition !== 'string') return undefined;
    this.activeGoals.set(conversationId, goal);
    return goal;
  }

  private saveGoal(goal: GoalStatus): void {
    this.activeGoals.set(goal.conversationId, goal);
    this.appSettingStore?.set(`goal.${goal.conversationId}`, goal);
  }

  /** Evaluator model id from settings; goal mode stays inert until configured. */
  private evaluatorModelId(): string | undefined {
    const record = this.appSettingStore?.get('goal.evaluator-model');
    const value = record?.value as string | undefined;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private handleGoalSet(socket: Socket, frame: Frame): void {
    const payload = parseGoalSetPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const now = new Date().toISOString();
    const goal: GoalStatus = {
      conversationId: payload.conversationId,
      condition: payload.condition,
      status: 'active',
      startedAt: now,
      turnCount: 0,
      tokensIn: 0,
      tokensOut: 0,
      maxGoalRounds: payload.maxGoalRounds ?? DEFAULT_GOAL_MAX_ROUNDS,
    };
    this.saveGoal(goal);
    const evaluatorConfigured = Boolean(this.evaluatorModelId());
    const started = evaluatorConfigured;
    if (started) void this.triggerGoalTurn(payload.conversationId, goal);
    const response: GoalSetResponse = { goal, started, evaluatorConfigured };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'goal.set',
        payload: response,
      }),
    );
  }

  private handleGoalPause(socket: Socket, frame: Frame): void {
    const payload = parseGoalPausePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const goal = this.loadGoal(payload.conversationId);
    if (goal && goal.status === 'active') {
      this.saveGoal({ ...goal, status: 'paused', pausedAt: new Date().toISOString() });
    }
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'goal.pause',
        payload: { goal: this.loadGoal(payload.conversationId) },
      }),
    );
  }

  private handleGoalResume(socket: Socket, frame: Frame): void {
    const payload = parseGoalResumePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const current = this.loadGoal(payload.conversationId);
    const evaluatorConfigured = Boolean(this.evaluatorModelId());
    if (current && (current.status === 'paused' || current.status === 'blocked')) {
      const resumed: GoalStatus = {
        ...current,
        status: 'active',
        pausedAt: undefined,
        blockedAt: undefined,
        blockedReason: undefined,
      };
      this.saveGoal(resumed);
      const started = evaluatorConfigured;
      if (started) void this.triggerGoalTurn(payload.conversationId, resumed);
      const response: GoalResumeResponse = { goal: resumed, started, evaluatorConfigured };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'goal.resume',
          payload: response,
        }),
      );
      return;
    }
    const response: GoalResumeResponse = {
      goal: current ?? {
        conversationId: payload.conversationId,
        condition: '',
        status: 'cleared',
        startedAt: new Date().toISOString(),
        turnCount: 0,
        tokensIn: 0,
        tokensOut: 0,
      },
      started: false,
      evaluatorConfigured,
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'goal.resume',
        payload: response,
      }),
    );
  }

  private handleGoalGet(socket: Socket, frame: Frame): void {
    const payload = parseGoalGetPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const response: GoalGetResponse = {
      goal: this.loadGoal(payload.conversationId),
      evaluatorConfigured: Boolean(this.evaluatorModelId()),
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'goal.get',
        payload: response,
      }),
    );
  }

  private handleGoalClear(socket: Socket, frame: Frame): void {
    const payload = parseGoalClearPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const goal = this.loadGoal(payload.conversationId);
    let cleared = false;
    if (goal && goal.status === 'active') {
      this.saveGoal({ ...goal, status: 'cleared' });
      cleared = true;
    }
    const response: GoalClearResponse = { cleared, goal };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'goal.clear',
        payload: response,
      }),
    );
  }

  // ── 定时任务命令（scheduledTask.*） ───────────────────────────────────────

  private validateTaskRule(rule: TaskRule): string | undefined {
    if (
      rule.kind === 'every' &&
      (!Number.isInteger(rule.intervalMinutes) || rule.intervalMinutes < 5)
    ) {
      return 'intervalMinutes 必须为 ≥5 的整数';
    }
    if (rule.kind === 'every' && rule.windowStart !== undefined && rule.windowEnd !== undefined) {
      const hm =
        /^([01]\d|2[0-3]):[0-5]\d$/.test(rule.windowStart) &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(rule.windowEnd);
      if (!hm) return 'every 的 windowStart/windowEnd 必须是 HH:mm';
      const startMin =
        Number(rule.windowStart.slice(0, 2)) * 60 + Number(rule.windowStart.slice(3, 5));
      const endMin = Number(rule.windowEnd.slice(0, 2)) * 60 + Number(rule.windowEnd.slice(3, 5));
      if (endMin <= startMin) return 'every 的 windowEnd 必须晚于 windowStart';
    }
    if (
      rule.kind === 'random' &&
      (!Number.isInteger(rule.minTimes) ||
        !Number.isInteger(rule.maxTimes) ||
        rule.minTimes < 1 ||
        rule.maxTimes < rule.minTimes)
    ) {
      return 'random 的 minTimes/maxTimes 非法';
    }
    if (rule.kind === 'cron' && !rule.expression.trim()) {
      return 'cron 表达式不能为空';
    }
    return undefined;
  }

  private handleCreateScheduledTask(socket: Socket, frame: Frame): void {
    const payload = frame.payload as CreateScheduledTaskPayload | undefined;
    if (!payload || typeof payload.name !== 'string' || typeof payload.instruction !== 'string') {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.scheduledTaskStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    const target = payload.target;
    const rule = payload.rule;
    const ruleError = this.validateTaskRule(rule);
    if (!target || !rule || ruleError) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    try {
      const id = `task-${ulid()}`;
      const timeZone = payload.timeZone?.trim() || 'UTC';
      const workspaceId =
        typeof payload.workspaceId === 'string' && payload.workspaceId.trim()
          ? payload.workspaceId.trim()
          : undefined;
      if (workspaceId && !this.workspaceStore?.getWorkspace(workspaceId as WorkspaceId)) {
        this.writeMalformedPayload(socket, frame);
        return;
      }
      const skillVersionIds = Array.isArray(payload.skillVersionIds)
        ? payload.skillVersionIds.filter((item): item is string => typeof item === 'string')
        : undefined;
      const task: ScheduledTask = {
        id,
        name: payload.name.trim(),
        instruction: payload.instruction.trim(),
        target,
        rule,
        timeZone,
        enabled: payload.enabled !== false,
        ...(workspaceId ? { workspaceId } : {}),
        ...(skillVersionIds && skillVersionIds.length > 0 ? { skillVersionIds } : {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const nextRunAt = payload.nextRunAt ?? initialNextRunAt(task);
      const stored = this.scheduledTaskStore.create({
        id,
        name: task.name,
        instruction: task.instruction,
        target,
        rule,
        timeZone,
        enabled: task.enabled,
        ...(workspaceId ? { workspaceId } : {}),
        ...(skillVersionIds ? { skillVersionIds } : {}),
        ...(nextRunAt ? { nextRunAt } : {}),
      });
      this.publishTaskEvent('scheduledTask.updated', id, { taskId: id, action: 'create' });
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'scheduledTask.create',
          payload: { task: stored },
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleListScheduledTasks(socket: Socket, frame: Frame): void {
    if (!this.scheduledTaskStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    const payload = (frame.payload ?? {}) as ListScheduledTasksPayload;
    const tasks = this.scheduledTaskStore.list(payload.includeDisabled !== false);
    const response: ListScheduledTasksResponse = { tasks };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'scheduledTask.list',
        payload: response,
      }),
    );
  }

  private handleUpdateScheduledTask(socket: Socket, frame: Frame): void {
    const payload = frame.payload as UpdateScheduledTaskPayload | undefined;
    if (!payload || typeof payload.taskId !== 'string' || !payload.patch) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.scheduledTaskStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    const patch = payload.patch;
    if (patch.rule) {
      const ruleError = this.validateTaskRule(patch.rule);
      if (ruleError) {
        this.writeMalformedPayload(socket, frame);
        return;
      }
    }
    if (
      patch.workspaceId !== undefined &&
      patch.workspaceId !== null &&
      !this.workspaceStore?.getWorkspace(patch.workspaceId as WorkspaceId)
    ) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    try {
      let nextRunAt: string | null | undefined;
      if (patch.rule || patch.nextRunAt !== undefined) {
        const current = this.scheduledTaskStore.get(payload.taskId);
        if (current) {
          const rule = patch.rule ?? current.rule;
          const timeZone = patch.timeZone ?? current.timeZone;
          nextRunAt =
            patch.nextRunAt === null
              ? null
              : (patch.nextRunAt ?? initialNextRunAt({ ...current, rule, timeZone }));
        }
      }
      const updated = this.scheduledTaskStore.update(payload.taskId, {
        ...patch,
        ...(nextRunAt !== undefined ? { nextRunAt } : {}),
      });
      if (!updated) {
        socket.write(
          encodeFrame({
            id: frame.id,
            kind: 'response',
            type: 'scheduledTask.update',
            payload: {},
            error: { code: ErrorCode.TASK_NOT_FOUND, message: 'Scheduled task not found' },
          }),
        );
        return;
      }
      this.publishTaskEvent('scheduledTask.updated', updated.id, {
        taskId: updated.id,
        action: 'update',
      });
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'scheduledTask.update',
          payload: { task: updated },
        }),
      );
    } catch (error) {
      this.writeTeamModelCommandError(socket, frame, error);
    }
  }

  private handleDeleteScheduledTask(socket: Socket, frame: Frame): void {
    const payload = frame.payload as DeleteScheduledTaskPayload | undefined;
    if (!payload || typeof payload.taskId !== 'string') {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.scheduledTaskStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    const deleted = this.scheduledTaskStore.delete(payload.taskId);
    this.publishTaskEvent('scheduledTask.updated', payload.taskId, {
      taskId: payload.taskId,
      action: 'delete',
    });
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'scheduledTask.delete',
        payload: { deleted },
      }),
    );
  }

  private handleListScheduledTaskHistory(socket: Socket, frame: Frame): void {
    const payload = frame.payload as ListScheduledTaskHistoryPayload | undefined;
    if (!payload || typeof payload.taskId !== 'string') {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.scheduledTaskStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    const limit =
      typeof payload.limit === 'number' && Number.isInteger(payload.limit)
        ? Math.min(Math.max(payload.limit, 1), 100)
        : 20;
    const entries = this.scheduledTaskStore.listHistory(payload.taskId, limit);
    const response: ListScheduledTaskHistoryResponse = { entries };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'scheduledTask.history',
        payload: response,
      }),
    );
  }

  private async handleTriggerScheduledTask(socket: Socket, frame: Frame): Promise<void> {
    const payload = frame.payload as TriggerScheduledTaskPayload | undefined;
    if (!payload || typeof payload.taskId !== 'string') {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.scheduledTaskStore) {
      this.writeTeamModelStoreUnavailable(socket, frame);
      return;
    }
    const task = this.scheduledTaskStore.get(payload.taskId);
    if (!task) {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'scheduledTask.trigger',
          payload: {},
          error: { code: ErrorCode.TASK_NOT_FOUND, message: 'Scheduled task not found' },
        }),
      );
      return;
    }
    const result = await this.fireScheduledTask(task);
    const refreshed = this.scheduledTaskStore.get(payload.taskId);
    const response: TriggerScheduledTaskResponse = {
      task: refreshed ?? task,
      fired: result.fired,
      ...(result.reason ? { reason: result.reason } : {}),
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'scheduledTask.trigger',
        payload: response,
      }),
    );
  }

  /**
   * 守护进程投递任务（T7）：校验帧 → 立即 ack（不等执行完成）→ 异步执行。
   * 投递帧契约见 daemon/protocol.ts（task.dispatch）。
   */
  private handleTaskDispatch(socket: Socket, frame: Frame): void {
    const parsed = parseTaskFrame(frame);
    if (!parsed.ok) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (parsed.frame.type !== 'task.dispatch') {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const { taskId } = parsed.frame.payload;
    const dispatchTask = this.scheduledTaskStore?.get(taskId);
    const rejectionReason = dispatchTask
      ? this.scheduledTaskDispatchRejection(dispatchTask)
      : '任务不存在';
    // 立即 ack（spec：桌面收到指令立即回复，不等执行完成）。
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'task.dispatch.ack',
        payload: {
          taskId,
          accepted: !rejectionReason,
          ...(rejectionReason ? { reason: rejectionReason } : {}),
        },
      }),
    );
    if (rejectionReason) {
      console.warn(`[runtime] task.dispatch: task ${taskId} rejected: ${rejectionReason}`);
      if (dispatchTask && (rejectionReason === '并发上限' || rejectionReason === '会话忙')) {
        const skippedAt = new Date().toISOString();
        this.recordTaskSkipped(dispatchTask, skippedAt, rejectionReason);
        this.recordTaskHistory(dispatchTask, 'skipped', skippedAt, undefined, rejectionReason);
      }
      return;
    }
    // 异步执行：校验任务存在 → fireScheduledTask（历史落库 + 摘要回填）。
    void (async () => {
      if (!this.scheduledTaskStore) return;
      const task = this.scheduledTaskStore.get(taskId) ?? dispatchTask;
      if (!task) {
        console.warn(`[runtime] task.dispatch: task ${taskId} not found`);
        return;
      }
      // Register before starting the run so a very fast provider completion
      // cannot race the tracker update.
      this.dispatchedTasks.add(taskId);
      const result = await this.fireScheduledTask(task);
      if (!result.fired) {
        this.dispatchedTasks.delete(taskId);
        console.warn(`[runtime] task.dispatch: ${taskId} not fired: ${result.reason ?? 'unknown'}`);
        return;
      }
    })();
  }

  private scheduledTaskDispatchRejection(task: ScheduledTask): string | undefined {
    if (!task.enabled) return '任务已停用';
    if (this.taskRuns.size >= this.taskMaxConcurrent()) return '并发上限';
    const threadId = task.conversationId
      ? this.resolveConversationThreadId(task.conversationId)
      : undefined;
    if (
      threadId &&
      [...this.demoRuns.values()].some(
        (run) => run.threadId === threadId && this.inFlight.has(String(run.runId)),
      )
    ) {
      return '会话忙';
    }
    return undefined;
  }

  /** Accept a daemon lease, bind it to one durable conversation/run, then execute asynchronously. */
  private handleExternalEventDispatch(socket: Socket, frame: Frame): void {
    const parsed = parseExternalEventFrame(frame);
    if (!parsed.ok || parsed.frame.type !== 'external.event.dispatch') {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    const payload = parsed.frame.payload;
    const event = payload.event;
    const existing = this.loadExternalEventExecution(event.id);
    if (existing) {
      this.registerExternalEventExecution(event.id, payload.leaseToken, existing.runId);
      this.writeExternalEventAck(socket, frame, payload, true, existing.runId);
      return;
    }

    const rejectionReason = this.externalEventDispatchRejection();
    if (rejectionReason) {
      this.writeExternalEventAck(socket, frame, payload, false, undefined, rejectionReason);
      return;
    }

    try {
      const conversationId = this.getOrCreateExternalEventConversation(event);
      const threadId = this.resolveConversationThreadId(conversationId);
      if (!threadId || !this.stateStore || !this.workspaceStore) {
        this.writeExternalEventAck(socket, frame, payload, false, undefined, '事件会话尚未就绪');
        return;
      }

      const runId = ulid() as RunId;
      const prompt = this.externalEventPrompt(event);
      const prepared = this.prepareRunBinding({
        runId,
        threadId: threadId as ThreadId,
        userText: prompt,
        skillVersionIds: event.skillVersionIds,
        ...(event.target.kind === 'model' ? { modelId: event.target.modelId } : {}),
        ...(event.target.kind === 'agent' ? { globalAgentId: event.target.agentId } : {}),
        ...(event.target.kind === 'team' ? { teamId: event.target.teamId } : {}),
      });
      const occurredAt = new Date().toISOString();
      const workspaceTask = this.workspaceStore.getTaskByThreadId(threadId as ThreadId);
      const sourceLabel = event.source.name ?? event.source.kind;
      const eventDrafts: [EventDraft, EventDraft] = [
        {
          id: ulid() as Event['id'],
          workspaceId: workspaceTask?.workspaceId ?? this.workspaceId,
          taskId: workspaceTask?.id,
          runId,
          category: 'message',
          type: 'message.appended',
          occurredAt,
          payload: {
            threadId,
            role: 'user',
            text: `【外部事件 · ${sourceLabel}】${prompt}`,
            externalEventId: event.id,
            externalEventDedupeKey: event.dedupeKey,
          },
        },
        {
          id: ulid() as Event['id'],
          workspaceId: workspaceTask?.workspaceId ?? this.workspaceId,
          taskId: workspaceTask?.id,
          runId,
          category: 'context',
          type: 'context.packet.built',
          occurredAt,
          payload: {
            threadId,
            packetId: prepared.packetId,
            proofHash: prepared.proofHash,
            modelId: prepared.run.modelId,
            providerModelId: prepared.run.providerModelId,
            resolutionSource: prepared.run.resolutionSource,
            credentialRefId: prepared.run.credentialRefId,
            skillVersionIds: prepared.skillVersionIds,
            mcpServerIds: prepared.mcpServerIds,
            externalEventId: event.id,
            externalEventSource: event.source.kind,
          },
        },
      ];
      const projectedRuns = new Map(this.demoRuns);
      projectedRuns.set(runId, prepared.run);
      const events = this.persistProjectedEvents(
        eventDrafts,
        new Map(this.threadVersions),
        projectedRuns,
      );
      this.recordCommittedEvents(events);
      this.demoRuns.set(runId, prepared.run);
      this.saveExternalEventExecution(event.id, conversationId, runId);
      this.registerExternalEventExecution(event.id, payload.leaseToken, runId);
      this.writeExternalEventAck(socket, frame, payload, true, runId);
      for (const committed of events) this.publishEvent(committed);
      void this.executeKernelRun(runId);
    } catch (error) {
      console.warn('[runtime] external.event.dispatch rejected', error);
      this.writeExternalEventAck(socket, frame, payload, false, undefined, '事件 Run 启动失败');
    }
  }

  private externalEventDispatchRejection(): string | undefined {
    if (
      !this.stateStore ||
      !this.workspaceStore ||
      !this.conversationStore ||
      !this.appSettingStore
    ) {
      return '持久化存储不可用';
    }
    if (!this.canStartModelRun()) return '无可用模型供应商';
    if (this.externalEventExecutions.size >= this.taskMaxConcurrent()) return '并发上限';
    return undefined;
  }

  private writeExternalEventAck(
    socket: Socket,
    frame: Frame,
    payload: ExternalEventDispatchPayload,
    accepted: boolean,
    runId?: string,
    reason?: string,
  ): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'external.event.ack',
        payload: {
          eventId: payload.event.id,
          leaseToken: payload.leaseToken,
          accepted,
          ...(runId ? { runId } : {}),
          ...(reason ? { reason } : {}),
        },
      }),
    );
  }

  private externalEventPrompt(event: ExternalEventEnvelope): string {
    if (!event.metadata || Object.keys(event.metadata).length === 0) return event.instruction;
    return `${event.instruction}\n\n事件数据：\n${JSON.stringify(event.metadata, null, 2)}`;
  }

  private externalEventSettingKey(kind: 'conversation' | 'execution', identity: string): string {
    const digest = createHash('sha256').update(identity, 'utf8').digest('hex');
    return `external-event.${kind}.${digest}`;
  }

  private getOrCreateExternalEventConversation(event: ExternalEventEnvelope): string {
    if (!this.conversationStore || !this.workspaceStore || !this.appSettingStore) {
      throw new Error('external_event_store_unavailable');
    }
    const targetRef =
      event.target.kind === 'agent'
        ? event.target.agentId
        : event.target.kind === 'team'
          ? event.target.teamId
          : event.target.modelId;
    const conversationIdentity = [
      event.conversationKey ?? event.id,
      event.target.kind,
      targetRef,
      event.workspaceId ?? '',
    ].join('\0');
    const settingKey = this.externalEventSettingKey('conversation', conversationIdentity);
    const persisted = this.appSettingStore.get(settingKey)?.value as
      { conversationId?: unknown } | undefined;
    if (typeof persisted?.conversationId === 'string') {
      const existing = this.conversationStore.get(persisted.conversationId as ConversationId);
      if (existing) return existing.id;
    }

    const now = new Date().toISOString();
    const workspaceId =
      event.workspaceId && this.workspaceStore.getWorkspace(event.workspaceId as WorkspaceId)
        ? (event.workspaceId as WorkspaceId)
        : this.getOrCreateInboxWorkspace();
    const sourceLabel = event.source.name ?? event.source.kind;
    const title = event.title?.trim() || `事件 · ${sourceLabel}`;
    const conversation = this.conversationStore.create({
      target:
        event.target.kind === 'agent'
          ? { track: 'agent', agentId: event.target.agentId as AgentId }
          : event.target.kind === 'team'
            ? { track: 'team', teamId: event.target.teamId as TeamId }
            : { track: 'model', modelId: event.target.modelId as ModelId },
      workspaceId,
      title,
      now,
    });
    const task = this.workspaceStore.createTask({
      workspaceId,
      title,
      goal: event.instruction.slice(0, 200),
      now,
    });
    this.threadVersions.set(task.threadId, task.taskVersion);
    this.conversationStore.bindTask(conversation.id, task.taskId, now);
    this.appSettingStore.set(settingKey, { conversationId: conversation.id }, now);
    return conversation.id;
  }

  private saveExternalEventExecution(eventId: string, conversationId: string, runId: string): void {
    this.appSettingStore?.set(this.externalEventSettingKey('execution', eventId), {
      eventId,
      conversationId,
      runId,
    });
  }

  private loadExternalEventExecution(eventId: string): { runId: string } | undefined {
    const value = this.appSettingStore?.get(
      this.externalEventSettingKey('execution', eventId),
    )?.value;
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Record<string, unknown>;
    if (raw.eventId !== eventId || typeof raw.runId !== 'string') return undefined;
    return { runId: raw.runId };
  }

  private registerExternalEventExecution(eventId: string, leaseToken: string, runId: string): void {
    this.externalEventExecutions.set(eventId, { leaseToken, runId });
    this.externalEventIdByRun.set(runId, eventId);
    this.startExternalEventHeartbeat();
    if (!this.externalEventCleanupRuns.has(runId)) {
      this.externalEventCleanupRuns.add(runId);
      this.attachExternalEventRunCleanup(runId);
    }
    this.sendExternalEventHeartbeat(eventId);
  }

  private startExternalEventHeartbeat(): void {
    if (this.externalEventHeartbeatTimer) return;
    this.externalEventHeartbeatTimer = setInterval(() => {
      for (const eventId of this.externalEventExecutions.keys()) {
        this.sendExternalEventHeartbeat(eventId);
      }
    }, 10_000);
    this.externalEventHeartbeatTimer.unref?.();
  }

  private sendExternalEventHeartbeat(eventId: string): void {
    const execution = this.externalEventExecutions.get(eventId);
    if (!execution || this.runtimeStopped) return;
    void sendExternalEventHeartbeatToDaemon(
      {
        installId: this.installId,
        helloSecret: this.handlers.expectedSecret,
        appVersion: 'sync-think-runtime',
        handshakeTimeoutMs: 2_000,
      },
      {
        eventId,
        leaseToken: execution.leaseToken,
        runId: execution.runId,
      },
    );
  }

  private attachExternalEventRunCleanup(runId: string): void {
    const check = (): void => {
      if (this.runtimeStopped) return;
      const run = this.demoRuns.get(runId as RunId);
      if (run && this.inFlight.has(runId)) {
        setTimeout(check, 50);
        return;
      }
      const eventId = this.externalEventIdByRun.get(runId);
      const execution = eventId ? this.externalEventExecutions.get(eventId) : undefined;
      if (!eventId || !execution || execution.runId !== runId) return;
      const result = this.externalEventRunResult(runId);
      if (!result) {
        setTimeout(check, 50);
        return;
      }
      this.externalEventCleanupRuns.delete(runId);
      this.externalEventIdByRun.delete(runId);
      this.externalEventExecutions.delete(eventId);
      if (this.externalEventExecutions.size === 0 && this.externalEventHeartbeatTimer) {
        clearInterval(this.externalEventHeartbeatTimer);
        this.externalEventHeartbeatTimer = undefined;
      }
      const completion = sendExternalEventCompletionToDaemon(
        {
          installId: this.installId,
          helloSecret: this.handlers.expectedSecret,
          appVersion: 'sync-think-runtime',
          handshakeTimeoutMs: 2_000,
        },
        {
          eventId,
          leaseToken: execution.leaseToken,
          runId,
          status: result.status,
          ...(result.reason ? { reason: result.reason } : {}),
        },
      );
      this.daemonCompletionPromises.add(completion);
      void completion.finally(() => this.daemonCompletionPromises.delete(completion));
    };
    setTimeout(check, 50);
  }

  private externalEventRunResult(
    runId: string,
  ): { status: 'success' | 'failed' | 'cancelled'; reason?: string } | undefined {
    const events = this.stateStore?.listEventsByRun
      ? this.stateStore.listEventsByRun(runId as RunId)
      : this.events.filter((event) => event.runId === runId);
    const terminal = [...(events ?? [])]
      .reverse()
      .find((event) => TERMINAL_RUN_EVENT_TYPES.has(event.type));
    if (!terminal) return undefined;
    const status =
      terminal.type === 'run.completed'
        ? 'success'
        : terminal.type === 'run.cancelled'
          ? 'cancelled'
          : 'failed';
    const payload = terminal.payload as Record<string, unknown>;
    const reason =
      typeof payload.reason === 'string'
        ? payload.reason
        : typeof payload.errorMessage === 'string'
          ? payload.errorMessage
          : undefined;
    return { status, ...(reason ? { reason } : {}) };
  }

  /** Resolve the thread id backing a conversation (goal turns run on its thread). */
  private resolveConversationThreadId(conversationId: string): string | undefined {
    const conversation = this.conversationStore?.get(
      conversationId as import('@sync-think/shared').ConversationId,
    );
    if (!conversation) return undefined;
    if (!conversation.taskId) return undefined;
    const task = this.workspaceStore?.getTask(conversation.taskId);
    return task?.threadId ? String(task.threadId) : undefined;
  }

  /** Conversation id for a thread (goal state is conversation-scoped). */
  private resolveConversationIdForThread(threadId: string): string | undefined {
    const task = this.workspaceStore?.getTaskByThreadId(threadId as ThreadId);
    const conversation =
      task && this.conversationStore ? this.conversationStore.getByTaskId(task.id) : undefined;
    return conversation ? String(conversation.id) : undefined;
  }

  /** True when the conversation backing this thread is in「规划模式」(plan). */
  private isPlanningModeForThread(threadId: string): boolean {
    const conversationId = this.resolveConversationIdForThread(threadId);
    if (!conversationId || !this.conversationStore) return false;
    return this.conversationStore.get(conversationId)?.interactionMode === 'plan';
  }

  /**
   * plan/exec 双模型路由：规划模式 → 规划模型；执行已批准方案的轮次
   * （planExecuting 标志）→ 执行模型；普通 execute 消息不干预（手动覆盖
   * / Agent 默认链照常生效）。
   */
  private resolvePlanActRouteForThread(threadId: string, planExecuting = false): PlanActRoute {
    return resolvePlanActRouteForContext(
      parsePlanActSetting(this.appSettingStore?.get(PLAN_ACT_SETTING_KEY)?.value),
      {
        planningMode: this.isPlanningModeForThread(threadId),
        planExecuting,
      },
    );
  }

  private buildGoalTranscript(threadId: string): string {
    const messages = this.listDurableContextMessages(threadId, 16_000);
    const lines: string[] = [];
    for (const message of messages.slice(-12)) {
      const text = message.blocks
        .map((block) => (typeof block.text === 'string' ? block.text : ''))
        .join(' ')
        .trim();
      if (!text) continue;
      lines.push(`${message.role === 'user' ? '用户' : '助手'}：${text.slice(0, 800)}`);
    }
    return lines.join('\n');
  }

  /**
   * One evaluator call with the configured small model: the completion
   * condition plus the recent transcript → met / not-met + short reason.
   * The evaluator never runs tools; it only judges what the conversation
   * already surfaced (NewMax /goal semantics).
   */
  private async evaluateGoal(
    conversationId: string,
    goal: GoalStatus,
  ): Promise<{ met: boolean; reason: string }> {
    const evaluatorModelId = this.evaluatorModelId();
    if (!evaluatorModelId) return { met: false, reason: '评估模型未配置（goal.evaluator-model）' };
    const threadId = this.resolveConversationThreadId(conversationId);
    if (!threadId) return { met: false, reason: '找不到对话对应的线程' };
    if (!this.providerStore || !this.secureStore)
      return { met: false, reason: 'provider 存储不可用' };
    const model = this.providerStore.getModel(evaluatorModelId as ModelId);
    const provider = model ? this.providerStore.getProvider(model.providerId) : undefined;
    const credentialRef = provider
      ? this.providerStore.getPrimaryCredentialRef(provider.id)
      : undefined;
    const adapter = provider
      ? (this.resolveDiscoveryAdapter(provider.protocol) ?? this.demoProvider)
      : undefined;
    if (!model || !provider || !adapter || !credentialRef) {
      return { met: false, reason: '评估模型配置不完整（模型/供应商/凭据）' };
    }
    const storeHandle = this.providerStore.getCredentialStoreHandle(credentialRef.id);
    if (!storeHandle) return { met: false, reason: '评估凭据不可用' };
    const apiKey = await this.secureStore.retrieveSecret(storeHandle);
    if (!apiKey || apiKey.trim().length === 0) return { met: false, reason: '评估凭据为空' };

    const transcript = this.buildGoalTranscript(threadId);
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), 60_000);
    try {
      const messages: import('@sync-think/adapters').ProviderMessage[] = [
        {
          role: 'system',
          content:
            '你是任务完成条件评估器。只根据对话中已呈现的内容判断完成条件是否满足。' +
            '不调用任何工具。只回答 JSON：{"met": true|false, "reason": "简短原因（≤120字）"}',
        },
        {
          role: 'user',
          content: `完成条件：${goal.condition}\n\n最近对话内容：\n${transcript.slice(0, 12_000)}`,
        },
      ];
      let output = '';
      for await (const event of adapter.call({
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        modelId: model.providerModelId ?? evaluatorModelId,
        apiKey,
        idempotencyKey: `goal-eval-${conversationId}-${Date.now()}`,
        signal: control.signal,
        messages,
        stream: true,
        maxOutputTokens: 300,
        temperature: 0,
      })) {
        if (event.type === 'text-delta') output += event.text;
        if (event.type === 'error') return { met: false, reason: '评估调用失败' };
      }
      return parseGoalEvaluatorOutput(output) ?? { met: false, reason: '评估输出无法解析' };
    } catch {
      return { met: false, reason: '评估调用异常' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** After a run finishes on a thread with an active goal: evaluate → continue or achieve. */
  private maybeEvaluateGoalAfterRun(threadId: string): void {
    const conversationId = this.resolveConversationIdForThread(threadId);
    if (!conversationId) return;
    const goal = this.loadGoal(conversationId);
    if (!goal || goal.status !== 'active') return;
    void this.evaluateAndContinueGoal(conversationId, goal);
  }

  private async evaluateAndContinueGoal(conversationId: string, goal: GoalStatus): Promise<void> {
    const { met, reason } = await this.evaluateGoal(conversationId, goal);
    const current = this.loadGoal(conversationId);
    if (!current || current.status !== 'active') return;
    const roundsStarted = (current.roundsStarted ?? 0) + 1;
    const updated: GoalStatus = {
      ...current,
      turnCount: current.turnCount + 1,
      roundsStarted,
      lastReason: reason,
    };
    if (met) {
      this.saveGoal({ ...updated, status: 'achieved', achievedAt: new Date().toISOString() });
      return;
    }
    // 轮次上限：耗尽自动 blocked（防无限烧 token）。
    const maxRounds = current.maxGoalRounds ?? DEFAULT_GOAL_MAX_ROUNDS;
    if (maxRounds > 0 && roundsStarted >= maxRounds) {
      this.saveGoal({
        ...updated,
        status: 'blocked',
        blockedAt: new Date().toISOString(),
        blockedReason: `已达轮次上限（${maxRounds} 轮）`,
      });
      return;
    }
    this.saveGoal(updated);
    void this.triggerGoalTurn(conversationId, updated);
  }

  /** Start a goal turn: persist the condition as a user message and run it. */
  private triggerGoalTurn(conversationId: string, goal: GoalStatus): void {
    const threadId = this.resolveConversationThreadId(conversationId);
    if (!threadId || !this.stateStore || !this.canStartModelRun()) return;
    const alreadyActive = [...this.demoRuns.values()].some(
      (run) => run.threadId === threadId && this.inFlight.has(String(run.runId)),
    );
    if (alreadyActive) return;
    const runId = ulid() as RunId;
    try {
      const prepared = this.prepareRunBinding({
        runId,
        threadId: threadId as ThreadId,
        userText: goal.condition,
        skillVersionIds: [],
      });
      const demoRun = prepared.run;
      const occurredAt = new Date().toISOString();
      const task = this.workspaceStore?.getTaskByThreadId(threadId as ThreadId);
      const round = (goal.roundsStarted ?? 0) + 1;
      const maxRounds = goal.maxGoalRounds ?? DEFAULT_GOAL_MAX_ROUNDS;
      const messageEventDraft: EventDraft = {
        id: ulid() as Event['id'],
        workspaceId: task?.workspaceId ?? this.workspaceId,
        taskId: task?.id,
        runId,
        category: 'message',
        type: 'message.appended',
        occurredAt,
        payload: {
          threadId,
          role: 'user',
          text: [
            '【目标模式】',
            `<goal_round>\nObjective: ${goal.condition}\nRound: ${round}/${maxRounds}`,
            '',
            'Continue working toward the objective in this same conversation. Inspect the current workspace, tool results and durable session state instead of assuming earlier narration is still current. Make concrete progress and verify the result. Before claiming completion, gather evidence that the whole objective is achieved, read the current goal, and call goal_manage complete. If blocked by an unresolvable obstacle, call goal_manage block with the reason. Otherwise leave the goal active for the next round.',
            '</goal_round>',
            goal.lastReason ? `（上一轮评估：${goal.lastReason}）` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      };
      const projectedRuns = new Map(this.demoRuns);
      projectedRuns.set(runId, demoRun);
      const packetEvent: EventDraft = {
        id: ulid() as Event['id'],
        workspaceId: task?.workspaceId ?? this.workspaceId,
        taskId: task?.id,
        runId,
        category: 'context',
        type: 'context.packet.built',
        occurredAt,
        payload: {
          threadId,
          packetId: prepared.packetId,
          proofHash: prepared.proofHash,
          modelId: demoRun.modelId,
          providerModelId: demoRun.providerModelId,
          resolutionSource: demoRun.resolutionSource,
          credentialRefId: demoRun.credentialRefId,
          skillVersionIds: prepared.skillVersionIds,
          mcpServerIds: prepared.mcpServerIds,
        },
      };
      const events = this.persistProjectedEvents(
        [messageEventDraft, packetEvent],
        new Map(this.threadVersions),
        projectedRuns,
      );
      this.recordCommittedEvents(events);
      this.demoRuns.set(runId, demoRun);
      for (const event of events) this.publishEvent(event);
      void this.executeKernelRun(runId);
    } catch {
      // Goal turns must never break the session; the goal stays active for retry.
    }
  }

  // ── 定时任务调度（0044） ──────────────────────────────────────────────────

  /**
   * 双 tick 让位（T5）：探测守护进程管道——活着 → 不启动自身 tick
   * （守护进程是唯一调度者）；死了/不在 → 启动自身 tick（现状行为）。
   */
  private async probeDaemonAndStartScheduler(): Promise<void> {
    const daemonAlive = await probeDaemonPipe(this.installId);
    if (decideSchedulerHeartbeat({ daemonAlive, daemonWorker: this.daemonWorker })) {
      this.startTaskSchedulerHeartbeat();
      console.log(`[runtime] daemon not detected (probe=${daemonAlive}); own tick active`);
    } else {
      console.log(
        daemonAlive
          ? '[runtime] daemon detected; own tick disabled (unique scheduler)'
          : '[runtime] worker mode; own tick disabled',
      );
    }
  }

  private startTaskSchedulerHeartbeat(): void {
    if (this.taskSchedulerTimer || !this.scheduledTaskStore) return;
    this.taskSchedulerTimer = setInterval(() => {
      void (async () => {
        // A daemon may come online after Runtime's initial probe. Re-check
        // ownership immediately before a local tick to avoid a duplicate fire.
        if (await probeDaemonPipe(this.installId)) {
          this.stopTaskSchedulerHeartbeat();
          console.log('[runtime] daemon appeared; local scheduler yielded');
          return;
        }
        await this.taskSchedulerTick();
      })().catch((error) => console.warn('[runtime] scheduled task tick failed', error));
    }, 30_000);
  }

  private stopTaskSchedulerHeartbeat(): void {
    if (this.taskSchedulerTimer) {
      clearInterval(this.taskSchedulerTimer);
      this.taskSchedulerTimer = undefined;
    }
  }

  /** 任务并发上限（app-setting 'task-scheduler' → {maxConcurrent}，默认 2）。 */
  private taskMaxConcurrent(): number {
    const raw = this.appSettingStore?.get('task-scheduler')?.value;
    const value =
      raw && typeof raw === 'object'
        ? ((raw as Record<string, unknown>).maxConcurrent as number | undefined)
        : undefined;
    const clamped = Number.isFinite(value) ? Math.min(8, Math.max(1, Math.floor(value ?? 2))) : 2;
    return clamped;
  }

  /** 心跳 tick：单飞；处理所有到期任务（错峰触发）。 */
  private async taskSchedulerTick(): Promise<void> {
    if (this.taskSchedulerTicking || !this.scheduledTaskStore) return;
    this.taskSchedulerTicking = true;
    try {
      const now = new Date();
      const due = this.scheduledTaskStore.listDue(now.toISOString());
      if (due.length === 0) return;
      // 错峰：按任务 id 排序逐个触发，间隔 2-5s。
      const ordered = [...due].sort((a, b) => a.id.localeCompare(b.id));
      for (const task of ordered) {
        await this.fireScheduledTask(task, now);
        await new Promise((resolve) =>
          setTimeout(resolve, 2_000 + Math.floor(Math.random() * 3_000)),
        );
      }
    } finally {
      this.taskSchedulerTicking = false;
    }
  }

  /**
   * 触发一个任务：并发/忙检查 → 创建/复用任务会话 → 注入指令启动 run →
   * 更新 nextRunAt（错过 ≤24h 补跑，否则顺延）。返回是否已触发。
   */
  private async fireScheduledTask(
    task: ScheduledTask,
    now: Date = new Date(),
  ): Promise<{ fired: boolean; reason?: string }> {
    if (!this.scheduledTaskStore || !this.conversationStore || !this.workspaceStore) {
      return { fired: false, reason: '存储不可用' };
    }
    const firedAt = now.toISOString();
    const missedMs = now.getTime() - Date.parse(task.nextRunAt ?? firedAt);
    const missedHours = Math.max(0, missedMs / 3_600_000);

    // 并发上限：任务 run 计数（内存近似）。
    if (this.taskRuns.size >= this.taskMaxConcurrent()) {
      this.recordTaskSkipped(task, firedAt, '并发上限');
      this.recordTaskHistory(task, 'skipped', firedAt, undefined, '并发上限');
      return { fired: false, reason: '并发上限' };
    }

    // 会话忙：该任务会话有 in-flight run。
    const conversationId = await this.getOrCreateTaskConversation(task, now);
    if (!conversationId) return { fired: false, reason: '任务会话创建失败' };
    const threadId = this.resolveConversationThreadId(conversationId);
    if (threadId) {
      const busy = [...this.demoRuns.values()].some(
        (run) => run.threadId === threadId && this.inFlight.has(String(run.runId)),
      );
      if (busy) {
        this.recordTaskSkipped(task, firedAt, '会话忙');
        this.recordTaskHistory(task, 'skipped', firedAt, undefined, '会话忙');
        return { fired: false, reason: '会话忙' };
      }
    }

    // 更新状态（先落库再启动，崩溃最多重复一次触发）。
    const nextRunAt = computeNextRunAt(task, firedAt, now);
    const updated = this.scheduledTaskStore.update(task.id, {
      nextRunAt,
      lastRunAt: firedAt,
      ...(conversationId ? { conversationId } : {}),
    });
    this.publishTaskEvent('scheduledTask.fired', task.id, {
      taskId: task.id,
      firedAt,
      nextRunAt: nextRunAt ?? null,
      missedHours: Math.round(missedHours * 10) / 10,
    });

    // 注入指令启动 run（仿 triggerGoalTurn 路径，不经 socket）。
    if (threadId && this.stateStore && this.canStartModelRun()) {
      const runId = ulid() as RunId;
      try {
        const prepared = this.prepareRunBinding({
          runId,
          threadId: threadId as ThreadId,
          userText: task.instruction,
          skillVersionIds: task.skillVersionIds ?? [],
          ...(task.target.kind === 'agent'
            ? { globalAgentId: task.target.agentId }
            : task.target.kind === 'team'
              ? { teamId: task.target.teamId }
              : {}),
        });
        const demoRun = prepared.run;
        const occurredAt = new Date().toISOString();
        const workspaceTask = this.workspaceStore.getTaskByThreadId(threadId as ThreadId);
        const messageEventDraft: EventDraft = {
          id: ulid() as Event['id'],
          workspaceId: workspaceTask?.workspaceId ?? this.workspaceId,
          taskId: workspaceTask?.id,
          runId,
          category: 'message',
          type: 'message.appended',
          occurredAt,
          payload: {
            threadId,
            role: 'user',
            text: `【定时任务 · ${task.name}】${task.instruction}`,
          },
        };
        const projectedRuns = new Map(this.demoRuns);
        projectedRuns.set(runId, demoRun);
        const packetEvent: EventDraft = {
          id: ulid() as Event['id'],
          workspaceId: workspaceTask?.workspaceId ?? this.workspaceId,
          taskId: workspaceTask?.id,
          runId,
          category: 'context',
          type: 'context.packet.built',
          occurredAt,
          payload: {
            threadId,
            packetId: prepared.packetId,
            proofHash: prepared.proofHash,
            modelId: demoRun.modelId,
            providerModelId: demoRun.providerModelId,
            resolutionSource: demoRun.resolutionSource,
            credentialRefId: demoRun.credentialRefId,
            skillVersionIds: prepared.skillVersionIds,
            mcpServerIds: prepared.mcpServerIds,
          },
        };
        const events = this.persistProjectedEvents(
          [messageEventDraft, packetEvent],
          new Map(this.threadVersions),
          projectedRuns,
        );
        this.recordCommittedEvents(events);
        this.demoRuns.set(runId, demoRun);
        this.taskRuns.add(String(runId));
        this.taskIdByRun.set(String(runId), task.id);
        this.scheduledTaskRuns.set(String(runId), { task, firedAt, run: demoRun });
        this.attachTaskRunCleanup(runId);
        for (const event of events) this.publishEvent(event);
        void this.executeKernelRun(runId);
        // The run has been durably prepared and execution has been handed off.
        // Do not fall through to the unavailable-model failure branch below.
        return { fired: true };
      } catch (error) {
        this.scheduledTaskStore.update(task.id, {
          lastResult: {
            status: 'failed',
            firedAt,
            reason: error instanceof Error ? error.message : String(error),
          },
        });
        this.recordTaskHistory(task, 'failed', firedAt, undefined, 'run 启动失败');
        return { fired: false, reason: 'run 启动失败' };
      }
    }
    void updated;
    // 无法启动 run 时如实报告失败（不再静默返回成功）。
    const blockReason = !threadId
      ? '任务会话尚未就绪'
      : !this.stateStore
        ? '状态存储不可用'
        : '无可用模型供应商';
    this.scheduledTaskStore.update(task.id, {
      lastResult: { status: 'failed', firedAt, reason: blockReason },
    });
    this.recordTaskHistory(task, 'failed', firedAt, undefined, blockReason);
    return { fired: false, reason: blockReason };
  }

  /**
   * worker 模式执行单个定时任务（守护进程自拉路径）。
   * 触发任务（fireScheduledTask）→ 等 run 进入终态（taskRuns 清空）→ 返回结果。
   * 返回 { ok, reason }：ok=false 时 reason 为未触发的失败原因。
   */
  async runDaemonTask(taskId: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.daemonWorker) return { ok: false, reason: 'not-worker-mode' };
    const task = this.scheduledTaskStore?.get(taskId);
    if (!task) return { ok: false, reason: '任务不存在' };
    const result = await this.fireScheduledTask(task);
    if (!result.fired) return { ok: false, reason: result.reason };
    // 等待该任务的所有 run 结束（taskRuns 为空 = 无 in-flight 执行）。
    while (this.taskRuns.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    return { ok: true };
  }

  /** 任务 run 结束时从并发计数移除并回填执行摘要（监听终态事件）。 */
  private attachTaskRunCleanup(runId: string): void {
    const check = (): void => {
      if (this.runtimeStopped) return;
      const run = this.demoRuns.get(runId as RunId);
      if (!run || !this.inFlight.has(runId)) {
        this.taskRuns.delete(runId);
        // 投递任务 run 终态：从 dispatchedTasks 移除（完成，无需 abort）。
        const taskId = this.taskIdByRun.get(runId);
        const wasDispatched = taskId ? this.dispatchedTasks.has(taskId) : false;
        if (taskId) {
          this.taskIdByRun.delete(runId);
          this.dispatchedTasks.delete(taskId);
        }
        const result = this.finalizeScheduledTaskRun(runId);
        if (wasDispatched && taskId && result) {
          const completion = sendTaskCompletionToDaemon(
            {
              installId: this.installId,
              helloSecret: this.handlers.expectedSecret,
              appVersion: 'sync-think-runtime',
              handshakeTimeoutMs: 2_000,
            },
            {
              taskId,
              runId,
              status: result.status,
              ...(result.reason ? { reason: result.reason } : {}),
            },
          );
          this.daemonCompletionPromises.add(completion);
          void completion.then(
            () => this.daemonCompletionPromises.delete(completion),
            () => this.daemonCompletionPromises.delete(completion),
          );
        }
        return;
      }
      setTimeout(check, 50);
    };
    setTimeout(check, 50);
  }

  private recordTaskSkipped(task: ScheduledTask, firedAt: string, reason: string): void {
    this.scheduledTaskStore?.update(task.id, {
      lastRunAt: firedAt,
      lastResult: { status: 'skipped', firedAt, reason },
    });
    this.publishTaskEvent('scheduledTask.skipped', task.id, {
      taskId: task.id,
      firedAt,
      reason,
    });
  }

  /** 写入一条任务执行历史；返回条目 id（run 终态时用于回填 summary）。 */
  private recordTaskHistory(
    task: ScheduledTask,
    status: ScheduledTaskRunStatus,
    firedAt: string,
    runId?: string,
    reason?: string,
  ): string | undefined {
    if (!this.scheduledTaskStore) return undefined;
    const entryId = ulid();
    this.scheduledTaskStore.addHistoryEntry({
      id: entryId,
      taskId: task.id,
      status,
      firedAt,
      runId,
      reason,
    });
    return entryId;
  }

  /** run 终态后回填历史 summary：任务会话最后一条非空助手消息前 200 字。 */
  private fillTaskHistorySummary(entryId: string, run: DemoRunState): void {
    if (!this.scheduledTaskStore || !this.messageStore) return;
    // listMessages 按 sequence 倒序，第一页即最新消息。
    const page = this.messageStore.listMessages(run.threadId as ThreadId, { limit: 50 });
    for (const message of page.messages) {
      if (message.role !== 'assistant') continue;
      const text = message.blocks
        .filter((block) => block.type === 'text' && block.text?.trim())
        .map((block) => block.text!.trim())
        .join('\n')
        .trim();
      if (!text) continue;
      this.scheduledTaskStore.updateHistorySummary(entryId, text);
      return;
    }
  }

  /** 将定时任务 run 的终态统一写入任务结果与唯一历史条目。 */
  private finalizeScheduledTaskRun(
    runId: string,
  ): { status: 'success' | 'failed' | 'cancelled'; reason?: string } | undefined {
    const metadata = this.scheduledTaskRuns.get(runId);
    if (!metadata || !this.scheduledTaskStore) return undefined;
    this.scheduledTaskRuns.delete(runId);

    let events: Event[];
    try {
      events = this.stateStore?.listEventsByRun
        ? this.stateStore.listEventsByRun(runId as RunId)
        : this.events.filter((event) => event.runId === runId);
    } catch {
      // Shutdown can close the store while a cleanup timer is pending.
      return undefined;
    }
    const terminal = [...events]
      .reverse()
      .find((event) => TERMINAL_RUN_EVENT_TYPES.has(event.type));
    const status: 'success' | 'failed' | 'cancelled' =
      terminal?.type === 'run.completed'
        ? 'success'
        : terminal?.type === 'run.cancelled'
          ? 'cancelled'
          : 'failed';
    const payload = (terminal?.payload ?? {}) as Record<string, unknown>;
    const reason =
      typeof payload.reason === 'string'
        ? payload.reason
        : typeof payload.errorMessage === 'string'
          ? payload.errorMessage
          : terminal
            ? undefined
            : 'run 未产生终态事件';
    const entryId = this.recordTaskHistory(metadata.task, status, metadata.firedAt, runId, reason);
    this.scheduledTaskStore.update(metadata.task.id, {
      lastResult: {
        status,
        firedAt: metadata.firedAt,
        runId,
        ...(reason ? { reason } : {}),
      },
    });
    if (entryId) this.fillTaskHistorySummary(entryId, metadata.run);
    return { status, ...(reason ? { reason } : {}) };
  }

  private publishTaskEvent(type: string, _taskId: string, payload: Record<string, unknown>): void {
    this.publishEvent(this.appendEvent('system', type, payload));
  }

  /** 任务专属会话：按 target 创建（track agent/model，标题「任务 · {名}」）或复用。 */
  private async getOrCreateTaskConversation(
    task: ScheduledTask,
    now: Date = new Date(),
  ): Promise<string | undefined> {
    if (!this.conversationStore || !this.workspaceStore) return undefined;
    let conversation: import('@sync-think/storage').ConversationRecord | undefined;
    if (task.conversationId) {
      conversation = this.conversationStore.get(task.conversationId as ConversationId);
    }
    if (!conversation) {
      const workspaceId =
        task.workspaceId && this.workspaceStore.getWorkspace(task.workspaceId as WorkspaceId)
          ? (task.workspaceId as WorkspaceId)
          : this.getOrCreateInboxWorkspace();
      conversation = this.conversationStore.create({
        target:
          task.target.kind === 'agent'
            ? { track: 'agent', agentId: task.target.agentId as AgentId }
            : task.target.kind === 'team'
              ? { track: 'team', teamId: task.target.teamId as TeamId }
              : { track: 'model', modelId: task.target.modelId as ModelId },
        workspaceId,
        title: `任务 · ${task.name}`,
        now: now.toISOString(),
      });
      this.scheduledTaskStore?.update(task.id, { conversationId: conversation.id });
    }
    // 懒创建 thread（仿 sendMessage 路径）：会话未绑定 workspace task 时
    // （首次创建或历史遗留会话）创建任务并绑定——否则 resolveConversationThreadId
    // 拿不到 threadId，触发会停在「任务会话尚未就绪」。
    if (!conversation.taskId) {
      const workspaceId = conversation.workspaceId ?? this.getOrCreateInboxWorkspace();
      const created = this.workspaceStore.createTask({
        workspaceId,
        title: `任务 · ${task.name}`,
        goal: task.instruction.slice(0, 200),
      });
      this.threadVersions.set(created.threadId, created.taskVersion);
      this.conversationStore.bindTask(conversation.id, created.taskId);
    }
    return conversation.id;
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
            taskId: this.resolveEventTaskId(run.threadId),
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
        this.persistAssistantTerminalMessage(payload.runId as RunId, run, 'cancelled');
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
          this.resolveEventTaskId(run.threadId),
        );
        this.persistAssistantTerminalMessage(payload.runId as RunId, run, 'cancelled');
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
    this.rememberRecentEvents(events);
  }

  private rememberRecentEvents(events: readonly Event[]): void {
    if (events.length === 0) return;
    this.events.push(...events);
    if (this.events.length > MAX_RECENT_RUNTIME_EVENTS) {
      this.events.splice(0, this.events.length - MAX_RECENT_RUNTIME_EVENTS);
    }
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
      .catch((error) => console.warn(`[runtime] orchestration ${source} failed`, error));
    this.trackBackgroundTask(task);
  }

  private scheduleOrchestrationRecovery(runId: RunId, source: string): void {
    if (!this.scheduler) return;
    const task = this.scheduler
      .recover(runId)
      .then(() => this.syncOrchestrationEvents())
      .catch((error) => console.warn(`[runtime] orchestration ${source} recovery failed`, error));
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
    const durableEventSequence = Math.max(
      this.eventSequence,
      this.stateStore.getLatestEventSequence?.() ?? this.eventSequence,
    );
    const shouldCheckpoint = shouldCreateRuntimeCheckpoint({
      lastCheckpointEventSequence: this.lastCheckpointEventSequence,
      projectedLastEventSequence: durableEventSequence + events.length,
      eventTypes: events.map((event) => event.type),
    });
    const checkpoint: CheckpointDraft | undefined = shouldCheckpoint
      ? {
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
        }
      : undefined;
    const committed = this.stateStore.commitTransition({
      events,
      ...(checkpoint ? { checkpoint } : {}),
    });
    if (committed.events.length === 0) {
      throw new Error('The event store returned an empty transition');
    }
    if (committed.checkpoint) {
      this.lastCheckpointEventSequence = committed.checkpoint.lastEventSequence;
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
      // a bound project folder �?only a configured global agent store.
      const agentToolsEnabled = Boolean(this.globalAgentStore);
      const desktopToolsEnabled = this.isComputerUsePluginEnabled();
      const browserWorkflowToolsEnabled = Boolean(this.browserWorkflowService);
      const toolsEnabled =
        Boolean(workspaceRoot) ||
        networkEnabled ||
        agentToolsEnabled ||
        desktopToolsEnabled ||
        browserWorkflowToolsEnabled;
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
        const providerRequestId = `chat-${ulid()}`;
        let activeRoundTranscript: ProviderRoundTranscript | undefined;
        let activeRoundTranscriptCommitted = false;
        let lastRoundReasoningStart = 0;
        const appendActiveRoundTranscript = (mode: 'complete' | 'visible'): void => {
          if (!activeRoundTranscript || activeRoundTranscriptCommitted) return;
          const messages =
            mode === 'complete'
              ? providerMessagesFromRoundTranscript(activeRoundTranscript)
              : providerVisibleMessagesFromRoundTranscript(activeRoundTranscript);
          if (messages.length > 0) {
            chatMessages = [...chatMessages, ...messages];
          }
          activeRoundTranscriptCommitted = true;
        };

        try {
          let stream: AsyncIterable<import('@sync-think/adapters').AdapterEvent> | undefined;
          const finalTurn = forceFinalAnswer;
          try {
            const providerPolicy = resolveToolLoopProviderPolicy(toolsEnabled, finalTurn);
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
              toolsEnabled: providerPolicy.toolsEnabled,
              toolChoice: providerPolicy.toolChoice,
              workspaceRoot,
              executionMode,
              networkEnabled,
              platformSchemas: nativePlatformToolSchemas({
                planningMode: initialRun.planningMode === true,
              }),
              signal: abort.signal,
            });
            if (process.env.SYNC_THINK_E2E_DEBUG === '1') {
              const schemas = nativePlatformToolSchemas({
                planningMode: initialRun.planningMode === true,
              });
              console.log('[e2e-debug] platformSchemas:', schemas.map((s) => s.name).join(','));
            }
            if (finalTurn) {
              // Consume at most one final no-tool turn.
              forceFinalAnswer = false;
              forceFinalReason = undefined;
            }
          } catch (error) {
            if (abort.signal.aborted || this.isAbortError(error)) return;
            const message = error instanceof Error ? error.message : 'provider stream failed';
            const failureClass = this.classifyThrownFailure(error);
            console.error('[demo-run] provider error', {
              runId,
              failureClass,
              message,
              modelId: attemptRun?.modelId,
              providerModelId: attemptRun?.providerModelId,
              reasoningEffort: attemptRun?.reasoningEffort,
              attempted: attemptRun?.attemptedModelIds,
            });
            // In-place retry on the same model: a stream-establishment failure
            // (nothing emitted yet) with a transient/timeout/rate-limit class
            // retries up to MODEL_RETRY_MAX times with exponential backoff.
            // The run keeps its retry budget across the outer-loop continuation,
            // so all five attempts happen before any fallback-model switch.
            if (
              shouldRetrySameModel({
                failureClass,
                retryCount: this.demoRuns.get(runId)?.retryCount ?? 0,
                hasOutput: Boolean(
                  this.demoRuns.get(runId)?.assistantText ||
                  this.demoRuns.get(runId)?.commentaryText ||
                  this.demoRuns.get(runId)?.legacyPendingText ||
                  this.demoRuns.get(runId)?.reasoningText,
                ),
              })
            ) {
              const retryCount = (this.demoRuns.get(runId)?.retryCount ?? 0) + 1;
              this.publishModelRetryStatus(runId, retryCount, failureClass);
              console.warn(`[demo-run] retrying same model (${retryCount}/${MODEL_RETRY_MAX})`, {
                runId,
                modelId: attemptRun?.providerModelId,
                failureClass,
              });
              await this.sleepForModelRetry(runId, retryCount - 1);
              continue;
            }
            const outcome = this.tryContinueWithFallback(runId, attemptRun, failureClass, message);
            if (outcome === 'continued') continue;
            if (outcome === 'paused') return;
            this.persistDemoRunFailure(runId, failureClass, message);
            return;
          }

          if (!stream) {
            console.error('[demo-run] no provider adapter', {
              runId,
              providerId: attemptRun?.providerId,
              credentialRefId: attemptRun?.credentialRefId,
              protocol: attemptRun?.protocol,
            });
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
          const roundTranscript = createProviderRoundTranscript();
          activeRoundTranscript = roundTranscript;
          // Reasoning start of this provider round: reasoning text is
          // accumulated across rounds on the run, so the per-round delta is
          // the slice from this offset (DSH parity per-message thinking).
          const roundReasoningStart = this.demoRuns.get(runId)?.reasoningText?.length ?? 0;
          lastRoundReasoningStart = roundReasoningStart;

          for await (const adapterEvent of stream) {
            if (abort.signal.aborted || !this.demoRuns.has(runId)) break;
            let currentRun = this.demoRuns.get(runId);
            if (!currentRun) break;

            if (providerEventIndex < currentRun.nextAdapterEventIndex) {
              providerEventIndex++;
              continue;
            }

            // Providers without native Codex phase metadata are buffered until
            // the round reveals whether the text precedes tool requests
            // (commentary) or is the terminal answer (final_answer).
            if (adapterEvent.type === 'text-delta') {
              roundTranscript.legacyText += adapterEvent.text;
              const alreadyBuffered = Boolean(currentRun.legacyPendingText);
              this.demoRuns.set(runId, {
                ...currentRun,
                nextAdapterEventIndex: currentRun.nextAdapterEventIndex + 1,
                legacyPendingText: currentRun.legacyPendingText + adapterEvent.text,
                ...(!alreadyBuffered
                  ? {
                      legacyPendingTextSeq: nextAssistantTimelineSequence(
                        currentRun.assistantTimeline ?? [],
                      ),
                    }
                  : {}),
              });
              // Stream every delta immediately so the UI renders
              // character-by-character instead of buffering the whole
              // response and flushing it as one block.
              this.publishTransientDelta({
                threadId: currentRun.threadId as ThreadId,
                runId,
                kind: 'text',
                textDelta: adapterEvent.text,
                occurredAt: new Date().toISOString(),
              });
              providerEventIndex++;
              continue;
            }

            if (adapterEvent.type === 'tool-call' && currentRun.legacyPendingText) {
              currentRun =
                this.flushLegacyAssistantText({
                  runId,
                  phase: 'commentary',
                  occurredAt: new Date().toISOString(),
                }) ?? currentRun;
              appendProviderRoundLegacyMessage(roundTranscript, 'commentary');
            } else if (adapterEvent.type === 'finished' && currentRun.legacyPendingText) {
              const phase = adapterEvent.reason === 'tool-requests' ? 'commentary' : 'final_answer';
              currentRun =
                this.flushLegacyAssistantText({
                  runId,
                  phase,
                  occurredAt: new Date().toISOString(),
                }) ?? currentRun;
              appendProviderRoundLegacyMessage(roundTranscript, phase);
            } else if (adapterEvent.type === 'error' && currentRun.legacyPendingText) {
              const phase = pendingToolCalls.length > 0 ? 'commentary' : 'final_answer';
              currentRun =
                this.flushLegacyAssistantText({
                  runId,
                  phase,
                  occurredAt: new Date().toISOString(),
                }) ?? currentRun;
              appendProviderRoundLegacyMessage(roundTranscript, phase);
            }

            if (adapterEvent.type === 'assistant-message-start') {
              startProviderRoundAssistantItem(
                roundTranscript,
                adapterEvent.phase,
                adapterEvent.itemId,
              );
            } else if (adapterEvent.type === 'assistant-message-delta') {
              appendProviderRoundAssistantDelta(
                roundTranscript,
                adapterEvent.phase,
                adapterEvent.text,
                adapterEvent.itemId,
              );
            } else if (adapterEvent.type === 'assistant-message-end') {
              endProviderRoundAssistantItem(
                roundTranscript,
                adapterEvent.phase,
                adapterEvent.itemId,
              );
            } else if (adapterEvent.type === 'tool-call') {
              appendProviderRoundToolCall(roundTranscript, adapterEvent.toolCall);
            }

            // section 5.3: retryable / auth / unknown failures walk the configured fallback chain.
            if (adapterEvent.type === 'error') {
              const failureClass = adapterEvent.failureClass as FailureClass;
              const message =
                typeof adapterEvent.message === 'string' ? adapterEvent.message : undefined;
              console.error('[demo-run] provider error event', {
                runId,
                failureClass,
                message,
                modelId: currentRun?.providerModelId,
                reasoningEffort: currentRun?.reasoningEffort,
              });
              // In-place retry on the same model: only when nothing has been
              // emitted yet (no text/reasoning deltas), so a retry can never
              // duplicate partial output.
              if (
                shouldRetrySameModel({
                  failureClass,
                  retryCount: currentRun.retryCount ?? 0,
                  hasOutput: Boolean(
                    currentRun.assistantText ||
                    currentRun.commentaryText ||
                    currentRun.legacyPendingText ||
                    currentRun.reasoningText,
                  ),
                })
              ) {
                const retryCount = (currentRun.retryCount ?? 0) + 1;
                this.publishModelRetryStatus(runId, retryCount, failureClass);
                console.warn(`[demo-run] retrying same model (${retryCount}/${MODEL_RETRY_MAX})`, {
                  runId,
                  modelId: currentRun.providerModelId,
                  failureClass,
                });
                resumeAfterFallback = true;
                await this.sleepForModelRetry(runId, retryCount - 1);
                break;
              }
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
            if (adapterEvent.type === 'finished' && adapterEvent.reason === 'tool-requests') {
              finishedWithToolRequests = true;
            }

            // When tools are requested, do not treat finished as terminal yet:
            // we still need a local tool loop + follow-up model turn.
            const suppressTerminal =
              !finalTurn &&
              finishedWithToolRequests &&
              toolsEnabled &&
              pendingToolCalls.length > 0 &&
              adapterEvent.type === 'finished';

            const projectionOccurredAt = new Date().toISOString();
            const projection = projectAdapterEvent(currentRun, adapterEvent, {
              requestId: providerRequestId,
            });
            if (
              adapterEvent.type === 'assistant-message-delta' &&
              adapterEvent.phase === 'commentary' &&
              projection.nextRun
            ) {
              projection.nextRun = appendCommentaryTimelineDelta(projection.nextRun, {
                textDelta: adapterEvent.text,
                occurredAt: projectionOccurredAt,
                afterSequence: this.eventSequence,
              });
            } else if (
              adapterEvent.type === 'assistant-message-end' &&
              adapterEvent.phase === 'commentary' &&
              projection.nextRun
            ) {
              projection.nextRun = closeCommentaryTimelineSegment(
                projection.nextRun,
                projectionOccurredAt,
              );
            } else if (
              projection.nextRun &&
              (projection.type === 'tool.requested' ||
                projection.type === 'tool.completed' ||
                projection.type === 'tool.failed')
            ) {
              projection.nextRun = closeCommentaryTimelineSegment(
                projection.nextRun,
                projectionOccurredAt,
              );
            }
            if (projection.nextRun) {
              if (adapterEvent.type === 'reasoning-delta') {
                projection.nextRun = appendAssistantThinkingDelta(
                  projection.nextRun,
                  adapterEvent.text,
                  projectionOccurredAt,
                );
              } else if (adapterEvent.type === 'assistant-message-delta') {
                projection.nextRun = appendAssistantTextDelta(
                  projection.nextRun,
                  adapterEvent.phase === 'commentary' ? 'commentary' : 'final_answer',
                  adapterEvent.text,
                  projectionOccurredAt,
                );
              } else if (adapterEvent.type === 'assistant-message-end') {
                projection.nextRun = closeAssistantTimeline(
                  projection.nextRun,
                  projectionOccurredAt,
                );
              } else if (adapterEvent.type === 'tool-call') {
                // §工具实时显示：宣布不入 timeline（模型可能一次宣布多个工具）。
                // 工具行在下方本地工具循环里「实际开始执行时」才入段并推快照，
                // 做到调用哪个显示哪个（§12.17.4 每个工具一行）。
              } else if (adapterEvent.type === 'tool-result') {
                projection.nextRun = completeAssistantTool(projection.nextRun, {
                  toolCallId: adapterEvent.toolCallId,
                  output: adapterEvent.result,
                  failed: projection.type === 'tool.failed',
                  occurredAt: projectionOccurredAt,
                });
              }
            }
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
            if (
              projection.category === 'tool' &&
              projection.type !== 'tool.turn_pending' &&
              typeof projection.payload.threadId !== 'string'
            ) {
              projection.payload = {
                ...projection.payload,
                threadId: currentRun.threadId,
              };
            }

            // First successful event from this model: clear the in-place retry
            // budget. The stream is now healthy and any later failure happens
            // after output has started, where retries are disabled anyway.
            if ((currentRun.retryCount ?? 0) > 0) {
              this.updateDemoRun(runId, { retryCount: 0 });
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
            if (!projection.terminal && projection.nextRun) {
              payload.run = serializeDemoRun(projection.nextRun);
            }
            const isTransientDelta =
              projection.type === 'message.delta' ||
              projection.type === 'message.commentary_delta' ||
              projection.type === 'message.reasoning_delta';
            const isTransientPhaseBoundary =
              projection.type === 'message.phase_started' ||
              projection.type === 'message.phase_ended';
            if (isTransientDelta) {
              if (!projection.nextRun) {
                throw new Error('A transient delta projection requires a next run state');
              }
              this.demoRuns.set(runId, projection.nextRun);
              const occurredAt = new Date().toISOString();
              this.publishTransientDelta({
                threadId: currentRun.threadId as ThreadId,
                runId,
                kind:
                  projection.type === 'message.delta'
                    ? 'text'
                    : projection.type === 'message.commentary_delta'
                      ? 'commentary'
                      : 'reasoning',
                textDelta:
                  typeof payload.textDelta === 'string'
                    ? payload.textDelta
                    : typeof payload.delta === 'string'
                      ? payload.delta
                      : '',
                occurredAt,
                ...(projection.type === 'message.commentary_delta'
                  ? { afterSequence: this.eventSequence }
                  : {}),
              });
              this.updateTransientTextSnapshot({
                threadId: currentRun.threadId as ThreadId,
                runId,
                streamSequence: this.transientSequenceByThread.get(currentRun.threadId) ?? 0,
                text: projection.nextRun.assistantText,
                commentaryText: projection.nextRun.commentaryText,
                commentarySegments: projection.nextRun.commentarySegments,
                reasoningText: projection.nextRun.reasoningText,
                reasoningSegments: projection.nextRun.reasoningSegments,
                assistantTimeline: projection.nextRun.assistantTimeline,
                updatedAt: occurredAt,
              });
              // Skip publishing the intermediate tool-turn marker to keep user UI clean.
            } else if (isTransientPhaseBoundary && projection.nextRun) {
              this.demoRuns.set(runId, projection.nextRun);
            } else if (projection.type !== 'tool.turn_pending') {
              const event = this.persistProjectedEvent(
                {
                  id: ulid() as Event['id'],
                  workspaceId: this.resolveEventWorkspaceId(currentRun.threadId),
                  taskId: this.resolveEventTaskId(currentRun.threadId),
                  runId,
                  category: projection.category,
                  type: projection.type,
                  occurredAt: projectionOccurredAt,
                  payload,
                },
                projectedRuns,
              );

              if (projection.terminal) {
                this.demoRuns.delete(runId);
                this.transientSnapshotByThread.delete(currentRun.threadId);
              } else if (projection.nextRun) this.demoRuns.set(runId, projection.nextRun);
              // Make the durable final visible before consumers observe run.completed.
              // ChatView can then refresh the message page immediately on the terminal event
              // without racing a later message-store write.
              const terminalRun = projection.nextRun ?? currentRun;
              if (projection.terminal && projection.type === 'run.completed') {
                this.persistAssistantFinalMessage(runId, terminalRun, projection.payload, {
                  reasoningDelta: terminalRun.reasoningText.slice(lastRoundReasoningStart),
                  transcriptMessages: activeRoundTranscript?.messages ?? [],
                  hasToolRounds: toolLoopRound > 0,
                });
                // NewMax-style goal mode: after each finished turn, a separate
                // evaluator checks the completion condition and either continues
                // the goal loop or marks the goal achieved.
                this.maybeEvaluateGoalAfterRun(String(currentRun.threadId));
              } else if (projection.terminal && projection.type === 'run.failed') {
                this.persistAssistantTerminalMessage(
                  runId,
                  terminalRun,
                  'failed',
                  typeof projection.payload.errorMessage === 'string'
                    ? projection.payload.errorMessage
                    : undefined,
                );
              }
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

          if (resumeAfterFallback) {
            appendActiveRoundTranscript('visible');
            continue;
          }

          // Local tool loop: execute requested tools and continue the model turn.
          // Project tools need workspaceRoot; network tools only need networkEnabled.
          if (
            !finalTurn &&
            finishedWithToolRequests &&
            toolsEnabled &&
            pendingToolCalls.length > 0 &&
            this.demoRuns.has(runId) &&
            toolLoopRound < MAX_TOOL_ROUNDS
          ) {
            toolLoopRound += 1;
            const currentRun = this.demoRuns.get(runId)!;
            appendActiveRoundTranscript('complete');

            const completedResults: Array<{ toolCallId: string; content: string }> = [];
            const writeSnapshot: import('./chat-tools.js').ChatWriteSnapshot = {};
            for (let toolIndex = 0; toolIndex < pendingToolCalls.length; toolIndex++) {
              const toolCall = pendingToolCalls[toolIndex]!;
              if (abort.signal.aborted || !this.demoRuns.has(runId)) return;

              // §工具实时显示：工具「实际开始执行」时入 timeline 并立即推快照，
              // 前端逐行显示（调用哪个显示哪个）。startAssistantTool 对重复
              // toolCallId 幂等更新，不会重复入段。
              const toolStartOccurredAt = new Date().toISOString();
              const runBeforeTool = this.demoRuns.get(runId);
              if (runBeforeTool) {
                this.demoRuns.set(
                  runId,
                  startAssistantTool(runBeforeTool, {
                    toolCallId: toolCall.id,
                    name: toolCall.name,
                    argumentsJson: toolCall.argumentsJson,
                    occurredAt: toolStartOccurredAt,
                  }),
                );
                this.pushKernelTimelineSnapshot(runId, runBeforeTool.threadId, toolStartOccurredAt);
              }

              const desktopCapabilityEnabled = this.isComputerUsePluginEnabled();
              if (CHAT_DESKTOP_TOOL_NAMES.has(toolCall.name) && !desktopCapabilityEnabled) {
                const disabledText = await executeChatDesktopTool({
                  workspaceRoot,
                  toolCall,
                  capabilityEnabled: false,
                  signal: abort.signal,
                });
                this.publishToolCompleted(runId, currentRun.threadId, toolCall, disabledText);
                completedResults.push({ toolCallId: toolCall.id, content: disabledText });
                chatMessages = [
                  ...chatMessages,
                  { role: 'tool', toolCallId: toolCall.id, content: disabledText },
                ];
                continue;
              }

              let browserApproval: { approvalId: string } | undefined;
              let desktopApproval: { approvalId: string } | undefined;
              if (
                CHAT_BROWSER_TOOL_NAMES.has(toolCall.name) &&
                this.browserController &&
                isChatToolAllowed(executionMode, toolCall.name, {
                  networkEnabled,
                  desktopEnabled: desktopCapabilityEnabled,
                  browserWorkflowEnabled: Boolean(this.browserWorkflowService),
                })
              ) {
                const browserPermissionInput = {
                  toolName: toolCall.name,
                  argumentsJson: toolCall.argumentsJson || '{}',
                  workspaceId: this.resolveEventWorkspaceId(currentRun.threadId),
                  runId,
                  ownerId: currentRun.threadId,
                  idempotencyKey: `browser:${runId}:${toolCall.id}`,
                  ...(workspaceRoot ? { workspaceRoot } : {}),
                };
                const permission =
                  this.browserController.evaluatePermission(browserPermissionInput);
                if (permission.decision === 'approval-required') {
                  if (normalizeChatExecutionMode(executionMode) === 'full-access') {
                    const approvalId = `auto-full-access:${runId}:${toolCall.id}`;
                    this.browserController.recordPermissionDecision(
                      browserPermissionInput,
                      'allow',
                      approvalId,
                    );
                    browserApproval = { approvalId };
                  } else {
                    const approval = await this.requestChatToolApproval({
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
                    this.browserController.recordPermissionDecision(
                      browserPermissionInput,
                      approval.decision === 'approve' ? 'allow' : 'deny',
                      approval.approvalId,
                    );
                    if (approval.decision === 'approve') {
                      browserApproval = { approvalId: approval.approvalId };
                    }
                  }
                }
              } else if (
                CHAT_DESKTOP_TOOL_NAMES.has(toolCall.name) &&
                this.desktopController &&
                isChatToolAllowed(executionMode, toolCall.name, {
                  networkEnabled,
                  desktopEnabled: desktopCapabilityEnabled,
                  browserWorkflowEnabled: Boolean(this.browserWorkflowService),
                })
              ) {
                const permission = this.desktopController.evaluatePermission({
                  executionMode,
                  toolName: toolCall.name,
                  argumentsJson: toolCall.argumentsJson || '{}',
                });
                if (permission.decision === 'deny') {
                  const deniedText = JSON.stringify({
                    ok: false,
                    code: permission.code,
                    error: permission.error,
                    failureClass: permission.failureClass,
                  });
                  this.publishToolCompleted(runId, currentRun.threadId, toolCall, deniedText);
                  completedResults.push({ toolCallId: toolCall.id, content: deniedText });
                  chatMessages = [
                    ...chatMessages,
                    { role: 'tool', toolCallId: toolCall.id, content: deniedText },
                  ];
                  continue;
                }
                if (permission.decision === 'approval-required') {
                  const approval = await this.requestChatToolApproval({
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
                    approvalArguments: permission.risk.approvalArguments,
                    approvalRisk: {
                      level: permission.risk.level,
                      reasonCodes: permission.risk.reasonCodes,
                      ...(permission.risk.humanOnlyAction
                        ? { humanOnlyAction: permission.risk.humanOnlyAction }
                        : {}),
                    },
                    signal: abort.signal,
                  });
                  if (abort.signal.aborted || !this.demoRuns.has(runId)) return;
                  if (approval.decision === 'deny') {
                    const deniedText = JSON.stringify({
                      ok: false,
                      code: 'desktop.approval-denied',
                      error: 'User denied the Desktop action.',
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
                  desktopApproval = { approvalId: approval.approvalId };
                }
              } else if (chatToolRequiresApproval(executionMode, toolCall.name)) {
                const canRunWithoutWorkspace =
                  CHAT_AGENT_TOOL_NAMES.has(toolCall.name) ||
                  CHAT_SKILL_TOOL_NAMES.has(toolCall.name) ||
                  CHAT_MCP_REGISTRY_TOOL_NAMES.has(toolCall.name) ||
                  CHAT_TEAM_TOOL_NAMES.has(toolCall.name) ||
                  CHAT_DESKTOP_TOOL_NAMES.has(toolCall.name) ||
                  CHAT_BROWSER_WORKFLOW_TOOL_NAMES.has(toolCall.name);
                if (!workspaceRoot && !canRunWithoutWorkspace) {
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
                const approval = await this.requestChatToolApproval({
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
                if (approval.decision === 'deny') {
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
                // approved �?fall through to execute
              } else if (
                !isChatToolAllowed(executionMode, toolCall.name, {
                  networkEnabled,
                  desktopEnabled: desktopCapabilityEnabled,
                  browserWorkflowEnabled: Boolean(this.browserWorkflowService),
                })
              ) {
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
                (
                  currentRun as DemoRunState & {
                    mcpToolDispatch?: Map<string, { mcpServerId: string; toolName: string }>;
                  }
                ).mcpToolDispatch?.get(toolCall.name) ?? parseMcpProviderToolName(toolCall.name);
              if (CHAT_PLAN_TOOL_NAMES.has(toolCall.name)) {
                if (CHAT_TASK_PLAN_TOOL_NAMES.has(toolCall.name) && this.taskPlanStore) {
                  const workspaceId = this.resolveEventWorkspaceId(currentRun.threadId);
                  if (toolCall.name === 'TaskCreate') {
                    resultText = executeTaskCreateTool(
                      toolCall.argumentsJson,
                      workspaceId,
                      this.taskPlanStore,
                    );
                  } else if (toolCall.name === 'TaskUpdate') {
                    resultText = executeTaskUpdateTool(toolCall.argumentsJson, this.taskPlanStore);
                  } else {
                    resultText = executeTaskListTool(
                      toolCall.argumentsJson,
                      workspaceId,
                      this.taskPlanStore,
                    );
                  }
                } else {
                  resultText = executeChatPlanTool(toolCall.argumentsJson);
                }
              } else if (CHAT_BROWSER_TOOL_NAMES.has(toolCall.name)) {
                resultText = await this.executeChatBrowserWorkerTool({
                  runId,
                  threadId: currentRun.threadId,
                  toolCall,
                  workspaceRoot,
                  signal: abort.signal,
                  approval: browserApproval,
                });
              } else if (CHAT_BROWSER_WORKFLOW_TOOL_NAMES.has(toolCall.name)) {
                if (toolCall.name === 'browser_workflow_execute') {
                  resultText = await this.executeChatBrowserWorkflowReplay({
                    runId,
                    threadId: currentRun.threadId,
                    toolCall,
                    workspaceRoot,
                    executionMode,
                    signal: abort.signal,
                  });
                } else {
                  resultText = executeChatBrowserWorkflowTool({
                    toolName: toolCall.name,
                    argumentsJson: toolCall.argumentsJson,
                    service: this.browserWorkflowService!,
                  });
                }
              } else if (CHAT_DESKTOP_TOOL_NAMES.has(toolCall.name)) {
                resultText = await this.executeChatDesktopWorkerTool({
                  runId,
                  threadId: currentRun.threadId,
                  toolCall,
                  workspaceRoot,
                  executionMode,
                  approval: desktopApproval,
                  signal: abort.signal,
                });
              } else if (CHAT_AGENT_TOOL_NAMES.has(toolCall.name)) {
                resultText = this.executeChatAgentTool({
                  run: currentRun,
                  toolCall,
                });
              } else if (CHAT_SKILL_TOOL_NAMES.has(toolCall.name)) {
                resultText = await this.executeChatSkillTool({
                  run: currentRun,
                  toolCall,
                });
              } else if (CHAT_MCP_REGISTRY_TOOL_NAMES.has(toolCall.name)) {
                resultText = await this.executeChatRemoteMcpTool({
                  run: currentRun,
                  toolCall,
                });
              } else if (CHAT_TEAM_TOOL_NAMES.has(toolCall.name)) {
                resultText = this.executeChatTeamTool({
                  run: currentRun,
                  toolCall,
                });
              } else if (CHAT_MCP_CATALOG_TOOL_NAMES.has(toolCall.name)) {
                resultText = this.executeChatMcpCatalogTool(currentRun);
              } else if (mcpDispatch) {
                resultText = await this.executeChatBoundMcpTool({
                  run: currentRun,
                  mcpServerId: mcpDispatch.mcpServerId,
                  toolName: mcpDispatch.toolName,
                  toolCallId: toolCall.id,
                  argumentsJson: toolCall.argumentsJson,
                  signal: abort.signal,
                });
              } else {
                resultText = await executeChatBuiltInTool({
                  workspaceRoot,
                  toolCall,
                  signal: abort.signal,
                  networkEnabled,
                  ...(toolCall.name === 'write_file' ? { snapshotOut: writeSnapshot } : {}),
                });
              }
              if (abort.signal.aborted || !this.demoRuns.has(runId)) return;
              // Publish full result for UI/trace; fold only the in-memory provider transcript.
              this.publishToolCompleted(
                runId,
                currentRun.threadId,
                toolCall,
                resultText,
                toolCall.name === 'write_file' && writeSnapshot.previousContent !== undefined
                  ? {
                      previousContent: writeSnapshot.previousContent,
                      ...(writeSnapshot.previousTruncated ? { previousTruncated: true } : {}),
                    }
                  : undefined,
              );
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
              // Soft recovery hint (e.g. first all-unavailable batch) �?keep tools on
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
            // One run stays one durable assistant turn; persist only at terminal.

            continue;
          }

          // Hit the round cap with pending tools still requested: one forced final turn.
          if (
            !finalTurn &&
            finishedWithToolRequests &&
            toolsEnabled &&
            pendingToolCalls.length > 0 &&
            this.demoRuns.has(runId) &&
            toolLoopRound >= MAX_TOOL_ROUNDS &&
            !forceFinalAnswer
          ) {
            forceFinalAnswer = true;
            forceFinalReason = `已达到工具轮次上限（${MAX_TOOL_ROUNDS}）。请停止调用工具，直接根据已有结果回复用户。`;
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
            if (outcome === 'continued') {
              appendActiveRoundTranscript('visible');
              continue;
            }
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

  /**
   * Run dispatch (multi-kernel). Native runs keep the existing in-process loop
   * (zero behavior change); external kernels run in spawned subprocesses.
   */
  private executeKernelRun(runId: RunId): Promise<void> {
    const run = this.demoRuns.get(runId);
    const kernelId = run?.kernelId;
    if (!kernelId || kernelId === 'native') {
      return this.executeDemoRun(runId);
    }
    return this.executeExternalKernelRun(runId);
  }

  /**
   * External kernel run loop (design doc §3.1). The kernel is autonomous — the
   * host only translates events, persists them, bridges permissions and reports
   * usage. Text flows over the transient channel; semantic events persist
   * through the same write-through store the native loop uses.
   */
  private async executeExternalKernelRun(runId: RunId): Promise<void> {
    const initialRun = this.demoRuns.get(runId);
    if (!initialRun || this.inFlight.has(runId)) return;
    this.recordInFlight(runId);
    const abort = new AbortController();
    this.demoRunAborts.set(runId, abort);
    const kernelId = initialRun.kernelId ?? 'native';
    const sessionLease = this.enqueueExternalKernelSession(
      this.kernelConversationSessionKey(kernelId, initialRun),
    );
    let adapter: KernelAdapter | undefined;
    let adapterLease: KernelSessionLease | undefined;
    let broker: KernelMcpBroker | undefined;
    let request: KernelRequest | undefined;
    let reportedSessionId: string | undefined;
    let cancelAdapterPromise: Promise<void> | undefined;
    let abortAdapterListener: (() => void) | undefined;
    let turnCompleted = false;
    const kernelUsageReports: KernelUsage[] = [];
    let usagePersisted = false;
    const persistAuthoritativeUsage = (run: DemoRunState): void => {
      if (usagePersisted) return;
      const gatewayUsage = this.openGateway.consumeRunUsage(runId);
      usagePersisted = true;
      if (gatewayUsage.length > 0) {
        gatewayUsage.forEach((usage, index) => {
          this.persistGatewayUsage(runId, run, usage, index + 1);
        });
      } else {
        kernelUsageReports.forEach((usage, index) => {
          this.persistKernelUsage(runId, run, usage, index + 1);
        });
      }
      kernelUsageReports.length = 0;
    };
    const cancelAdapterOnce = (): Promise<void> => {
      if (!adapter) return Promise.resolve();
      if (!cancelAdapterPromise) {
        const activeAdapter = adapter;
        cancelAdapterPromise = Promise.resolve()
          .then(() => activeAdapter.cancel())
          .catch(() => undefined);
      }
      return cancelAdapterPromise;
    };
    try {
      const hasSessionTurn = await this.waitForExternalKernelSessionTurn(
        sessionLease.waitForTurn,
        abort.signal,
      );
      if (!hasSessionTurn) return;

      if (kernelId === 'codex') {
        adapterLease = await this.codexSessionHost.acquire(
          this.kernelConversationSessionKey(kernelId, initialRun),
          abort.signal,
        );
        adapter = adapterLease.adapter;
      } else {
        adapter = this.kernelAdapterResolver(kernelId);
      }
      if (!adapter) {
        throw new Error(`Kernel adapter not wired: ${kernelId}`);
      }
      abortAdapterListener = () => {
        void cancelAdapterOnce();
      };
      abort.signal.addEventListener('abort', abortAdapterListener, { once: true });
      if (abort.signal.aborted) {
        await cancelAdapterOnce();
        return;
      }

      request = await this.buildKernelRequestForRun(initialRun, runId);
      if (abort.signal.aborted) return;
      // Slice 5: host platform tools ride the MCP channel. The broker lives for
      // exactly this run; the kernel's mcp config embeds its address + token.
      broker = await this.startPlatformMcpBrokerForRun(runId, initialRun, request);
      if (abort.signal.aborted) return;
      this.wireKernelPermissionBridge(runId, initialRun.threadId, adapter, abort.signal);

      let finalStatus: 'completed' | 'failed' | undefined;
      let finalError: string | undefined;
      let exitDiagnostic:
        | {
            code: number | null;
            stderrTail: string;
          }
        | undefined;
      adapter.onExit((code, stderrTail) => {
        exitDiagnostic = { code, stderrTail };
      });
      for await (const event of adapter.start(request)) {
        if (abort.signal.aborted) break;
        switch (event.type) {
          case 'delta':
            this.publishKernelTextDelta(runId, initialRun.threadId, event.text, event.final);
            break;
          case 'reasoning':
            this.publishKernelReasoningDelta(runId, initialRun.threadId, event.text);
            break;
          case 'session-started':
            reportedSessionId ??= this.saveReportedKernelConversationSession(
              initialRun,
              event.sessionId,
              request.session?.id,
            );
            break;
          case 'tool-call':
            this.persistKernelToolEvent(runId, initialRun.threadId, 'tool.requested', event);
            break;
          case 'tool-result':
            this.persistKernelToolEvent(runId, initialRun.threadId, 'tool.completed', event);
            break;
          case 'usage':
            kernelUsageReports.push({ ...event.usage });
            break;
          case 'compacted':
            // The kernel compacted its own context; the host records the
            // boundary and never re-compacts (design §2.3 ②).
            this.persistKernelCompacted(runId, initialRun.threadId);
            break;
          case 'permission-request':
            // Handled through the approval bridge; no durable event here.
            break;
          case 'terminal':
            turnCompleted = true;
            finalStatus = event.status;
            finalError = event.error;
            break;
        }
      }

      if (abort.signal.aborted) return;
      const finalRun = this.demoRuns.get(runId);
      if (!finalRun) return;
      if ((finalStatus ?? 'failed') === 'failed') {
        this.clearFailedKernelConversationSession(finalRun, request, finalError, reportedSessionId);
      } else if (
        finalRun.kernelId === 'claude-code' &&
        request.session?.mode === 'create' &&
        request.session.id &&
        !reportedSessionId
      ) {
        // Older/compatible Claude CLIs may complete without system/init carrying
        // a session_id. A successful terminal proves the requested id is usable.
        this.saveReportedKernelConversationSession(
          finalRun,
          request.session.id,
          request.session.id,
        );
      }
      persistAuthoritativeUsage(finalRun);
      this.finalizeKernelRun(
        runId,
        finalRun,
        finalStatus ?? 'failed',
        finalStatus
          ? finalError
          : exitDiagnostic
            ? formatKernelExitDiagnostic(
                adapter.name,
                exitDiagnostic.code,
                exitDiagnostic.stderrTail,
              )
            : 'kernel process ended before a terminal event',
      );
      // Advance the session watermark AFTER finalize persists the assistant
      // reply, so the next same-kernel run resumes without a phantom gap (see
      // refreshKernelConversationSessionWatermark).
      if (finalStatus === 'completed') {
        this.refreshKernelConversationSessionWatermark(finalRun);
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      const finalRun = this.demoRuns.get(runId);
      if (!finalRun) return;
      const message = error instanceof Error ? error.message : 'kernel run failed';
      if (request) {
        this.clearFailedKernelConversationSession(finalRun, request, message, reportedSessionId);
      }
      persistAuthoritativeUsage(finalRun);
      this.finalizeKernelRun(runId, finalRun, 'failed', message);
    } finally {
      if (abortAdapterListener) {
        abort.signal.removeEventListener('abort', abortAdapterListener);
      }
      if (abort.signal.aborted || !turnCompleted) await cancelAdapterOnce();
      if (broker) await broker.close().catch(() => undefined);
      if (!usagePersisted) {
        const finalRun = this.demoRuns.get(runId);
        if (finalRun) {
          persistAuthoritativeUsage(finalRun);
        } else {
          this.openGateway.consumeRunUsage(runId);
          usagePersisted = true;
        }
      }
      // Revoke the gateway ticket with the run: a leaked ticket id stops working
      // the moment the run it was issued for ends.
      this.openGateway.revokeRun(runId);
      this.platformMcpCatalogByRun.delete(runId);
      this.platformMcpResultsByRun.delete(runId);
      adapterLease?.release();
      sessionLease.release();
      this.demoRunAborts.delete(runId);
      this.forgetInFlight(runId);
    }
  }

  /**
   * Effective context window the kernel should honor. For kernels whose native
   * window is not overridable (Claude Code) the effective window is capped at
   * the kernel's native limit; the configured value wins otherwise. Used for
   * context trimming, kernel injection and the observable run snapshot.
   */
  private effectiveContextWindowForRun(run: DemoRunState): {
    window: number;
    source: 'configured' | 'kernel-capped' | 'estimated';
  } {
    const configured = run.contextWindow ?? 128_000;
    const estimated = run.contextWindowEstimated === true && run.contextWindow === undefined;
    let window = configured;
    let source: 'configured' | 'kernel-capped' | 'estimated' = estimated
      ? 'estimated'
      : 'configured';
    const kernelId = run.kernelId;
    if (kernelId && kernelId !== 'native') {
      const cap = getKernelRegistry().find((entry) => entry.id === kernelId)?.capabilities
        .contextWindow;
      if (
        cap &&
        !cap.overridable &&
        Number.isFinite(cap.nativeLimit) &&
        configured > cap.nativeLimit
      ) {
        window = cap.nativeLimit;
        source = 'kernel-capped';
      }
    }
    return { window, source };
  }

  private async buildKernelRequestForRun(run: DemoRunState, runId?: RunId): Promise<KernelRequest> {
    const workspaceRoot = this.resolveChatWorkspaceRoot(run.threadId);
    const executionMode = this.resolveChatExecutionMode(run.threadId);
    const planningMode = run.planningMode === true || this.isPlanningModeForThread(run.threadId);
    const kernelId = run.kernelId ?? 'native';
    const baseSystemContext = this.buildKernelSystemContext(run, workspaceRoot);
    const sessionResolution = this.resolveKernelConversationSession(
      run,
      kernelId,
      workspaceRoot,
      baseSystemContext,
    );
    const session = sessionResolution.session;
    const responseContinuationScopeId = this.resolveKernelResponseContinuationScopeId(
      run,
      kernelId,
      session,
    );
    const credential = await this.resolveKernelCredential(
      run,
      runId ?? run.runId,
      responseContinuationScopeId,
    );
    const effective = this.effectiveContextWindowForRun(run);
    return {
      kernelId,
      model: run.modelId,
      providerModelId: run.providerModelId,
      userText: run.userText,
      contextWindow: run.contextWindow ?? 128_000,
      effectiveContextWindow: effective.window,
      contextWindowSource: effective.source,
      credential,
      systemContext:
        session?.mode === 'create'
          ? this.buildKernelBootstrapSystemContext(run, baseSystemContext)
          : baseSystemContext,
      // Platform tools ride the MCP channel; the broker address is attached by
      // startPlatformMcpBrokerForRun right after this request is built.
      platformTools: [],
      permissionMode: normalizeChatExecutionMode(executionMode),
      planningMode,
      workspaceDir: workspaceRoot ?? process.cwd(),
      ...(run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
      ...(session ? { session } : {}),
    };
  }

  private kernelConversationSessionKey(kernelId: string, run: DemoRunState): string {
    const scopeId = this.resolveConversationIdForThread(run.threadId) ?? run.threadId;
    return `${KERNEL_SESSION_SETTING_PREFIX}.${kernelId}.${scopeId}`;
  }

  private enqueueExternalKernelSession(key: string): {
    waitForTurn: Promise<void>;
    release: () => void;
  } {
    const previousTail = this.externalKernelSessionTails.get(key) ?? Promise.resolve();
    const waitForTurn = previousTail.catch(() => undefined);
    let resolveTurn!: () => void;
    const turnCompleted = new Promise<void>((resolve) => {
      resolveTurn = resolve;
    });
    const nextTail = waitForTurn.then(() => turnCompleted);
    this.externalKernelSessionTails.set(key, nextTail);
    let released = false;
    return {
      waitForTurn,
      release: () => {
        if (released) return;
        released = true;
        resolveTurn();
        void nextTail.finally(() => {
          if (this.externalKernelSessionTails.get(key) === nextTail) {
            this.externalKernelSessionTails.delete(key);
          }
        });
      },
    };
  }

  private async waitForExternalKernelSessionTurn(
    waitForTurn: Promise<void>,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (signal.aborted) return false;
    let abortListener: (() => void) | undefined;
    const aborted = new Promise<boolean>((resolve) => {
      abortListener = () => resolve(false);
      signal.addEventListener('abort', abortListener, { once: true });
    });
    try {
      return await Promise.race([waitForTurn.then(() => !signal.aborted), aborted]);
    } finally {
      if (abortListener) signal.removeEventListener('abort', abortListener);
    }
  }

  private loadKernelConversationSession(
    key: string,
  ): PersistedKernelConversationSession | undefined {
    const cached = this.kernelConversationSessions.get(key);
    if (cached) return cached;
    const persisted = parsePersistedKernelConversationSession(
      this.appSettingStore?.get(key)?.value,
    );
    if (persisted) this.kernelConversationSessions.set(key, persisted);
    return persisted;
  }

  private saveKernelConversationSession(
    key: string,
    session: PersistedKernelConversationSession,
  ): void {
    const existing = this.loadKernelConversationSession(key);
    if (
      existing?.responseContinuationScopeId &&
      existing.responseContinuationScopeId !== session.responseContinuationScopeId
    ) {
      this.openGateway.clearResponseContinuationScope(existing.responseContinuationScopeId);
    }
    this.kernelConversationSessions.set(key, session);
    this.appSettingStore?.set(key, session);
  }

  private clearKernelConversationSession(run: DemoRunState, expectedSessionId?: string): void {
    if (!expectedSessionId || (run.kernelId !== 'claude-code' && run.kernelId !== 'codex')) {
      return;
    }
    const key = this.kernelConversationSessionKey(run.kernelId, run);
    this.clearKernelConversationSessionByKey(run.kernelId, key, expectedSessionId);
  }

  private clearKernelConversationSessionByKey(
    kernelId: 'claude-code' | 'codex',
    key: string,
    expectedSessionId?: string,
  ): void {
    const existing = this.loadKernelConversationSession(key);
    if (!existing || (expectedSessionId && existing.sessionId !== expectedSessionId)) {
      return;
    }
    this.openGateway.clearResponseContinuationScope(
      existing.responseContinuationScopeId ??
        this.kernelResponseContinuationScopeId(kernelId, existing.sessionId),
    );
    this.kernelConversationSessions.delete(key);
    this.appSettingStore?.set(key, null);
  }

  private clearKernelConversationSessionsForScopeIds(scopeIds: readonly string[]): void {
    for (const scopeId of new Set(scopeIds.filter(Boolean))) {
      this.clearKernelConversationSessionByKey(
        'claude-code',
        `${KERNEL_SESSION_SETTING_PREFIX}.claude-code.${scopeId}`,
      );
      this.clearKernelConversationSessionByKey(
        'codex',
        `${KERNEL_SESSION_SETTING_PREFIX}.codex.${scopeId}`,
      );
    }
  }

  /**
   * Advance the persisted session watermark to the newest durable message after
   * a successful run. `saveReportedKernelConversationSession` records the
   * watermark at session-start (the user message), but the kernel session also
   * absorbs this run's assistant reply before it ends — without this refresh the
   * next same-kernel run would treat that reply as a phantom cross-kernel gap.
   */
  private refreshKernelConversationSessionWatermark(run: DemoRunState): void {
    if (run.kernelId !== 'claude-code' && run.kernelId !== 'codex') return;
    const key = this.kernelConversationSessionKey(run.kernelId, run);
    const existing = this.loadKernelConversationSession(key);
    if (!existing) return;
    const watermark = this.latestDurableMessageWatermark(run.threadId);
    if (!watermark) return;
    this.saveKernelConversationSession(key, {
      ...existing,
      updatedAt: new Date().toISOString(),
      lastMessageSequence: watermark.sequence,
      lastMessageAt: watermark.createdAt,
    });
  }

  private clearFailedKernelConversationSession(
    run: DemoRunState,
    request: KernelRequest,
    error: string | undefined,
    reportedSessionId?: string,
  ): void {
    if (!isInvalidKernelSessionError(error)) return;
    this.clearKernelConversationSession(run, reportedSessionId ?? request.session?.id);
  }

  private kernelConversationSessionFingerprint(
    run: DemoRunState,
    kernelId: string,
    workspaceRoot: string | undefined,
    baseSystemContext: string,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          version: 1,
          kernelId,
          modelId: run.modelId,
          providerId: run.providerId ?? null,
          providerModelId: run.providerModelId,
          protocol: run.protocol,
          credentialRefId: run.credentialRefId ?? null,
          workspaceRoot: workspaceRoot ?? null,
          systemContext: baseSystemContext,
        }),
      )
      .digest('hex');
  }

  /** Latest durable host message watermark for a thread (sequence + timestamp). */
  private latestDurableMessageWatermark(
    threadId: string,
  ): { sequence: number; createdAt: string } | undefined {
    if (!this.messageStore) return undefined;
    const page = this.messageStore.listMessages(threadId as ThreadId, { limit: 1 });
    const latest = page.messages[0];
    return latest ? { sequence: latest.sequence, createdAt: latest.createdAt } : undefined;
  }

  /** Durable messages strictly newer than `afterSequence`, oldest first. */
  private listMessagesAfterSequence(threadId: string, afterSequence: number): Message[] {
    if (!this.messageStore) return [];
    const collected: Message[] = [];
    let beforeSequence: number | undefined;
    for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
      const page = this.messageStore.listMessages(threadId as ThreadId, {
        ...(beforeSequence !== undefined ? { beforeSequence } : {}),
        limit: 100,
      });
      if (page.messages.length === 0) break;
      if (page.messages[0].sequence <= afterSequence) {
        collected.unshift(...page.messages.filter((message) => message.sequence > afterSequence));
        break;
      }
      collected.unshift(...page.messages);
      if (!page.hasMore) break;
      beforeSequence = page.nextCursor;
      if (beforeSequence === undefined) break;
    }
    return collected;
  }

  /**
   * Compute the cross-kernel gap for a resumed kernel session: durable host
   * messages after the session's watermark. A gap that is too large (many
   * turns or a big token share of the effective window) is marked oversized so
   * the caller can rebuild the session instead of patching it.
   */
  private computeKernelSessionGap(
    run: DemoRunState,
    session: PersistedKernelConversationSession,
  ): { count: number; catchUp?: string; oversized: boolean } {
    // Legacy record without a watermark: treat as in sync — no replay, no rebuild.
    if (session.lastMessageSequence === undefined) return { count: 0, oversized: false };
    let gapMessages = this.listMessagesAfterSequence(run.threadId, session.lastMessageSequence);
    // The current user turn is this run's input, not a gap turn — the message
    // store persists it before buildKernelRequestForRun runs, so exclude the
    // newest gap message when it is the current user text.
    const currentUserText = run.userText.trim();
    if (currentUserText) {
      const last = gapMessages[gapMessages.length - 1];
      if (last && last.role === 'user') {
        const text = last.blocks
          .filter((block) => block.type === 'text' || block.type === 'code')
          .map((block) => block.text ?? '')
          .join('\n')
          .trim();
        if (text === currentUserText) gapMessages = gapMessages.slice(0, -1);
      }
    }
    return computeKernelGapFromMessages(
      gapMessages,
      run.effectiveContextWindow ?? run.contextWindow ?? 128_000,
    );
  }

  private saveReportedKernelConversationSession(
    run: DemoRunState,
    sessionId: string,
    requestedSessionId?: string,
  ): string | undefined {
    const kernelId = run.kernelId;
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId || (kernelId !== 'claude-code' && kernelId !== 'codex')) {
      return undefined;
    }
    const workspaceRoot = this.resolveChatWorkspaceRoot(run.threadId);
    const baseSystemContext = this.buildKernelSystemContext(run, workspaceRoot);
    const key = this.kernelConversationSessionKey(kernelId, run);
    const fingerprint = this.kernelConversationSessionFingerprint(
      run,
      kernelId,
      workspaceRoot,
      baseSystemContext,
    );
    const existing = this.loadKernelConversationSession(key);
    const responseContinuationScopeId =
      existing?.sessionId === normalizedSessionId &&
      existing.fingerprint === fingerprint &&
      existing.responseContinuationScopeId
        ? existing.responseContinuationScopeId
        : this.kernelResponseContinuationScopeId(
            kernelId,
            requestedSessionId?.trim() || normalizedSessionId,
          );
    const watermark = this.latestDurableMessageWatermark(run.threadId);
    this.saveKernelConversationSession(key, {
      version: 1,
      sessionId: normalizedSessionId,
      fingerprint,
      updatedAt: new Date().toISOString(),
      responseContinuationScopeId,
      ...(watermark
        ? { lastMessageSequence: watermark.sequence, lastMessageAt: watermark.createdAt }
        : {}),
    });
    return normalizedSessionId;
  }

  private resolveKernelConversationSession(
    run: DemoRunState,
    kernelId: string,
    workspaceRoot: string | undefined,
    baseSystemContext: string,
  ): { session?: KernelRequest['session']; gapCount: number } {
    if (kernelId !== 'claude-code' && kernelId !== 'codex') {
      return { session: undefined, gapCount: 0 };
    }
    const key = this.kernelConversationSessionKey(kernelId, run);
    const fingerprint = this.kernelConversationSessionFingerprint(
      run,
      kernelId,
      workspaceRoot,
      baseSystemContext,
    );
    const existing = this.loadKernelConversationSession(key);
    if (existing?.fingerprint === fingerprint) {
      const gap = this.computeKernelSessionGap(run, existing);
      if (gap.oversized) {
        // Gap too large to patch cheaply → invalidate the native session and
        // rebuild with the full bootstrap transcript.
        this.clearKernelConversationSession(run, existing.sessionId);
        const freshId = kernelId === 'codex' ? undefined : randomUUID();
        return {
          session: { ...(freshId ? { id: freshId } : {}), mode: 'create' },
          gapCount: 0,
        };
      }
      const session: KernelRequest['session'] = { id: existing.sessionId, mode: 'resume' };
      if (gap.catchUp) session.catchUp = gap.catchUp;
      return { session, gapCount: gap.count };
    }
    if (existing) this.clearKernelConversationSession(run, existing.sessionId);
    if (kernelId === 'codex') return { session: { mode: 'create' }, gapCount: 0 };
    return { session: { id: randomUUID(), mode: 'create' }, gapCount: 0 };
  }

  private resolveKernelResponseContinuationScopeId(
    run: DemoRunState,
    kernelId: string,
    session: KernelRequest['session'] | undefined,
  ): string | undefined {
    if (kernelId !== 'claude-code' || !session?.id) return undefined;
    const existing = this.loadKernelConversationSession(
      this.kernelConversationSessionKey(kernelId, run),
    );
    if (
      session.mode === 'resume' &&
      existing?.sessionId === session.id &&
      existing.responseContinuationScopeId
    ) {
      return existing.responseContinuationScopeId;
    }
    return this.kernelResponseContinuationScopeId(kernelId, session.id);
  }

  private kernelResponseContinuationScopeId(kernelId: string, sessionId: string): string {
    const digest = createHash('sha256')
      .update(JSON.stringify({ version: 1, kernelId, sessionId }))
      .digest('base64url');
    return `kernel_${digest}`;
  }

  private gatewayResponseContinuationSettingKey(scopeId: string): string {
    return `${GATEWAY_RESPONSE_CONTINUATION_SETTING_PREFIX}.${scopeId}`;
  }

  private loadGatewayResponseContinuations(
    scopeId: string,
  ): readonly (readonly [callId: string, responseId: string])[] | undefined {
    if (!scopeId.startsWith('kernel_')) return undefined;
    return parsePersistedGatewayResponseContinuations(
      this.appSettingStore?.get(this.gatewayResponseContinuationSettingKey(scopeId))?.value,
    );
  }

  private saveGatewayResponseContinuations(
    scopeId: string,
    items: readonly (readonly [callId: string, responseId: string])[],
  ): void {
    if (!scopeId.startsWith('kernel_')) return;
    this.appSettingStore?.set(this.gatewayResponseContinuationSettingKey(scopeId), {
      version: 2,
      items: items.map(([callId, responseId]) => [callId, responseId]),
      updatedAt: new Date().toISOString(),
    });
  }

  private removeGatewayResponseContinuations(scopeId: string): void {
    if (!scopeId.startsWith('kernel_')) return;
    this.appSettingStore?.set(this.gatewayResponseContinuationSettingKey(scopeId), null);
  }

  private buildKernelBootstrapSystemContext(run: DemoRunState, baseSystemContext: string): string {
    const messages = this.buildChatProviderMessages(run);
    if (isCurrentKernelUserMessage(messages.at(-1), run.userText)) messages.pop();
    const transcript = formatKernelBootstrapTranscript(messages);
    return [baseSystemContext, transcript].filter(Boolean).join('\n\n');
  }

  /**
   * Kernel credential: prefer the kernel's local login state (OAuth bonus,
   * design §7); when the run carries a credential ref, inject its key + baseUrl.
   *
   * When the selected provider speaks a dialect the kernel does not (e.g. a
   * gpt-5.x relay behind Claude Code), the credential is redirected to the open
   * gateway instead: the kernel gets the loopback base URL plus a **per-run
   * ticket** as its key, and the gateway holds the real provider/model/secret.
   * Routing is therefore exact — two providers exposing the same model name can
   * never be confused, because the ticket, not the model string, decides.
   */
  private async resolveKernelCredential(
    run: DemoRunState,
    runId?: RunId,
    responseContinuationScopeId?: string,
  ): Promise<KernelCredential> {
    if (!run.credentialRefId || !this.providerStore || !this.secureStore) {
      return { reuseLocalLogin: true };
    }
    try {
      const storeHandle = this.providerStore.getCredentialStoreHandle(run.credentialRefId);
      if (!storeHandle) return { reuseLocalLogin: true };
      const apiKey = await this.secureStore.retrieveSecret(storeHandle);
      if (!apiKey) return { reuseLocalLogin: true };
      const provider = run.providerId
        ? this.providerStore.getProvider(run.providerId as ProviderId)
        : undefined;
      const direct: KernelCredential = {
        apiKey,
        ...(provider?.baseUrl ? { baseUrl: provider.baseUrl } : {}),
      };
      const gateway = this.resolveGatewayCredential(
        run,
        runId,
        apiKey,
        provider?.baseUrl,
        responseContinuationScopeId,
      );
      return gateway ?? direct;
    } catch {
      return { reuseLocalLogin: true };
    }
  }

  /**
   * Decide whether this run must go through the open gateway and, if so, issue
   * its ticket. Returns undefined whenever the direct path is correct (gateway
   * off, dialects already match, or the provider protocol is untranslatable).
   */
  private resolveGatewayCredential(
    run: DemoRunState,
    runId: RunId | undefined,
    apiKey: string,
    baseUrl: string | undefined,
    responseContinuationScopeId?: string,
  ): KernelCredential | undefined {
    if (!runId || !this.openGateway.running || !baseUrl) return undefined;
    const upstream = toGatewayUpstreamProtocol(run.protocol);
    if (!upstream) return undefined;
    const kernelEntry = getKernelRegistry().find((entry) => entry.id === run.kernelId);
    const kernelProtocols = kernelEntry?.capabilities.protocols ?? [];
    if (!kernelNeedsGateway(kernelProtocols, upstream)) return undefined;
    // The kernel keeps speaking its own dialect; the gateway serves that inbound
    // path and translates on the way out.
    const kernelDialect = kernelProtocols.includes('anthropic-messages')
      ? 'anthropic-messages'
      : 'openai-chat';
    const inboundBaseUrl = this.openGateway.inboundBaseUrl(kernelDialect);
    if (!inboundBaseUrl) return undefined;
    const ticketId = this.openGateway.issueTicket(
      runId,
      {
        baseUrl,
        protocol: upstream,
        providerModelId: run.providerModelId,
        apiKey,
        ...(run.providerId ? { providerId: run.providerId } : {}),
        ...(upstream === 'openai-responses' && responseContinuationScopeId
          ? { responseContinuationScopeId }
          : {}),
      },
      run.kernelId,
    );
    if (!ticketId) return undefined;
    return { baseUrl: inboundBaseUrl, apiKey: ticketId };
  }

  /** Flattened provider+model catalog for gateway name resolution (no secrets). */
  private collectGatewayCatalog(): GatewayCatalogEntry[] {
    if (!this.providerStore) return [];
    try {
      const entries: GatewayCatalogEntry[] = [];
      for (const catalogEntry of this.providerStore.listProviders()) {
        const provider = catalogEntry.provider;
        for (const model of catalogEntry.models) {
          entries.push({
            providerId: provider.id,
            providerName: provider.name,
            sortOrder: provider.sortOrder,
            baseUrl: provider.baseUrl,
            protocol: provider.protocol,
            providerModelId: model.providerModelId,
            modelId: model.id,
            enabled: provider.enabled,
          });
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  /** Primary secret for a provider (external gateway clients only). */
  private async resolveProviderSecret(providerId: string): Promise<string | undefined> {
    if (!this.providerStore || !this.secureStore) return undefined;
    try {
      const ref = this.providerStore.getPrimaryCredentialRef(providerId);
      if (!ref) return undefined;
      return (await this.secureStore.retrieveSecret(ref.storeHandle)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Stable Agent, Skill, workspace and project context owned by an external kernel session. */
  private buildKernelSystemContext(run: DemoRunState, workspaceRoot?: string): string {
    const parts: string[] = [];
    if (workspaceRoot) {
      const facts = collectWorkspaceSharedFacts(workspaceRoot);
      if (facts.block) parts.push(facts.block);
    }
    parts.push(...this.buildRunAgentInstructions(run, workspaceRoot));
    parts.push(
      [
        '## Workspace context',
        workspaceRoot
          ? `Project folder: ${workspaceRoot}`
          : 'No project folder is bound for this conversation.',
        ...(run.projectContextPromptBlocks ?? []),
      ].join('\n\n'),
    );
    parts.push(
      [
        '## Persistent memory',
        'Project memory is injected into the conversation as memory entries, newest first.',
        'When several entries conflict about the same fact, the most recent entry wins — trust it over older ones.',
        'If the user states a new value for a remembered fact, treat the newest statement as the updated truth.',
      ].join('\n'),
    );
    if (run.planningMode === true || this.isPlanningModeForThread(run.threadId)) {
      parts.push(
        [
          '## 规划模式（Planning mode）',
          '你正处于规划模式：只做只读调研，禁止任何写入、编辑、命令执行、浏览器交互或资源变更（宿主会在执行层强制拦截）。',
          '完成调研后，调用 `plan_submit` 提交一份结构化执行方案（title 标题 / goal 目标 / scope 范围 / steps 步骤，每步含验收标准 acceptanceChecks / risks 风险 / finalAcceptanceChecks 总验收），然后简要总结要点并停止，等待用户审批——不要继续执行任何改动。',
          '宿主已禁用 EnterPlanMode / ExitPlanMode / AskUserQuestion（claude-code 内置），不要调用它们，也不要尝试进入 Claude 原生规划流程；方案提交使用宿主提供的 `plan_submit` 工具，中途需要用户决策时使用 `ask_user_question`。',
        ].join('\n'),
      );
    }
    return parts.join('\n\n');
  }

  /**
   * Slice 5: start the platform MCP broker for this kernel run and hand its
   * address to the adapters via KernelRequest.platformBroker. The broker's
   * tool-call handler runs the host approval (three-tier) then executes the
   * platform tool in-process.
   */
  private async startPlatformMcpBrokerForRun(
    runId: RunId,
    run: DemoRunState,
    request: KernelRequest,
  ): Promise<KernelMcpBroker | undefined> {
    const entryPath = this.resolvePlatformMcpServerEntry();
    if (!entryPath) {
      console.warn(
        '[kernel:mcp] platform mcp server entry not found — platform tools disabled for this run',
      );
      return undefined;
    }
    const workspaceRoot = request.workspaceDir;
    // Frozen for this run: capability/permission changes must not widen an
    // in-flight kernel. Desktop tools stay host-only this round; Browser tools
    // follow the 联网 switch and are injected for every kernel (the Browser
    // Worker still enforces origin grants / inspection per command).
    const tools = buildPlatformMcpToolDefinitions({
      executionMode: this.resolveChatExecutionMode(run.threadId),
      networkEnabled: run.networkEnabled === true,
      includeAgentTools: Boolean(this.globalAgentStore),
      includeTaskTools: Boolean(this.taskPlanStore),
      includeMcpTools: Boolean(this.mcpStore),
      includeSkillTools: Boolean(this.skillStore),
      includeTeamTools: Boolean(this.teamStore && this.globalAgentStore),
      includeBrowserTools: run.networkEnabled === true,
      planningMode: request.planningMode === true || run.planningMode === true,
    });
    this.platformMcpCatalogByRun.set(runId, tools);
    const broker = await startKernelMcpBroker({
      workspaceDir: workspaceRoot,
      tools,
      onToolCall: (call) => this.handlePlatformMcpToolCall(runId, run, workspaceRoot, call),
    });
    request.platformBroker = {
      host: broker.host,
      port: broker.port,
      token: broker.token,
      workspaceDir: workspaceRoot,
      // The kernel spawns `node <entry>` (verified: codex requires an
      // executable command + the entry as the first arg).
      command: process.execPath,
      args: [entryPath],
    };
    return broker;
  }

  /** Resolve the platform MCP server entry (self-contained .mjs, no build). */
  private resolvePlatformMcpServerEntry(): string | undefined {
    return resolvePlatformMcpServerEntry(import.meta.url);
  }

  /**
   * Platform MCP tool-call handler. The call must exist in this run's frozen
   * catalog; approval reuses the authoritative native classifier
   * (`chatToolRequiresApproval`) so a workspace-mode kernel cannot bypass the
   * card that the native tool loop would have raised. Execution reuses the
   * existing Runtime business executors — no second implementation.
   */
  private async handlePlatformMcpToolCall(
    runId: RunId,
    run: DemoRunState,
    workspaceRoot: string,
    call: PlatformMcpToolCall,
  ): Promise<{ ok: boolean; content?: string; error?: string }> {
    // Idempotency: the same call id + arguments replays the first result so a
    // kernel retry cannot create a second agent/task/team.
    const argumentsJson = JSON.stringify(call.input ?? {});
    const replayKey = `${call.id}:${createHash('sha256').update(`${call.tool}\n${argumentsJson}`).digest('hex')}`;
    let replayCache = this.platformMcpResultsByRun.get(runId);
    if (!replayCache) {
      replayCache = new Map();
      this.platformMcpResultsByRun.set(runId, replayCache);
    }
    const replayed = replayCache.get(replayKey);
    if (replayed) return replayed;
    const pending = this.executePlatformMcpToolCall(runId, run, workspaceRoot, call, argumentsJson);
    replayCache.set(replayKey, pending);
    const result = await pending;
    // Only successful side effects stay cached; a failure may be retried.
    if (!result.ok) replayCache.delete(replayKey);
    return result;
  }

  private async executePlatformMcpToolCall(
    runId: RunId,
    run: DemoRunState,
    workspaceRoot: string,
    call: PlatformMcpToolCall,
    argumentsJson: string,
  ): Promise<{ ok: boolean; content?: string; error?: string }> {
    const catalog = this.platformMcpCatalogByRun.get(runId) ?? PLATFORM_MCP_TOOL_DEFINITIONS;
    const definition = catalog.find((tool) => tool.name === call.tool);
    if (!definition) return { ok: false, error: `unknown platform tool: ${call.tool}` };
    if (call.signal.aborted) {
      return { ok: false, error: 'platform tool call was cancelled by the kernel' };
    }
    // Planning mode fence: never allow a side-effecting tool even if it slipped
    // into the catalog (second layer behind the catalog filter).
    if (run.planningMode === true && isPlanningDeniedTool(call.tool)) {
      return { ok: false, error: '规划模式只读：此操作需在执行模式中进行' };
    }
    const executionMode = normalizeChatExecutionMode(this.resolveChatExecutionMode(run.threadId));

    // Browser tools ride the network switch and use the Browser Worker's own
    // origin-grant / approval path (visible live page + origin grants), not the
    // generic chat classifier. Injecting them for external kernels makes
    // browser_open/click/type/read/screenshot work identically on every kernel.
    if (CHAT_BROWSER_TOOL_NAMES.has(call.tool)) {
      return this.executeExternalKernelBrowserTool(
        runId,
        run,
        workspaceRoot,
        call,
        argumentsJson,
        executionMode,
      );
    }

    // ask_user_question (模型主动问询): 挂起工具调用等待用户作答，回答回填为
    // 工具结果；plan-review intent 渲染「方案待审」卡，确认后由桌面端发起执行轮。
    if (call.tool === 'ask_user_question') {
      return this.handleAskUserQuestionToolCall(runId, run, call);
    }

    // plan_submit (规划模式, §12.18): 持久化模型提交的结构化方案并发
    // conversation.plan_submitted 事件，前端渲染可编辑方案卡；规划轮随后自然结束。
    if (call.tool === 'plan_submit') {
      return this.handlePlanSubmitToolCall(runId, run, call, argumentsJson);
    }

    // task_schedule (定时任务管理): create/cancel 在 ask-mode 下需审批。
    if (call.tool === 'task_schedule') {
      return this.executeTaskScheduleTool(runId, run, call, executionMode);
    }

    // goal_manage (目标模式): 模型自证完成 / 报受阻 / 记进度。
    if (call.tool === 'goal_manage') {
      return this.executeGoalManageTool(run, call);
    }

    // Host-only file tools keep the ask-mode tier; every chat tool defers to the
    // native classifier (Agent/Skill/Team/MCP writes are gated outside full-access).
    const needsApproval = isPlatformFileToolName(call.tool)
      ? definition.approval === 'ask-mode' && executionMode === 'ask'
      : chatToolRequiresApproval(executionMode, call.tool);
    if (needsApproval) {
      const decision = await this.requestPlatformToolApproval(runId, run.threadId, call);
      if (decision !== 'approve') {
        return {
          ok: false,
          error: isPlatformFileToolName(call.tool)
            ? '宿主已拒绝此操作'
            : chatToolDeniedMessage(executionMode, call.tool, 'denied'),
        };
      }
    }
    // A late approval must not apply a side effect the kernel already abandoned
    // (MCP-side timeout / notifications/cancelled), nor outlive the run.
    if (call.signal.aborted || !this.demoRuns.has(runId)) {
      return { ok: false, error: 'platform tool call was cancelled before execution' };
    }

    const toolCall: ProviderToolCall = {
      id: call.id,
      name: call.tool,
      argumentsJson,
    };
    try {
      const content = await this.executeHostPlatformTool(run, toolCall, workspaceRoot);
      return { ok: true, content };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Execute a Browser Worker tool for an external kernel (codex / claude-code).
   * Mirrors the native loop's browser branch: evaluate the origin grant, ask for
   * approval in non-full-access mode, then run the visible Browser Worker action.
   */
  /**
   * goal_manage executor（目标模式）：模型 complete（自证完成）/ block（受阻）/
   * progress（进度说明）。仅该对话存在 active goal 时可用。
   */
  private executeGoalManageTool(
    run: DemoRunState,
    call: PlatformMcpToolCall,
  ): { ok: boolean; content?: string; error?: string } {
    const conversationId = this.resolveConversationIdForThread(run.threadId);
    const goal = conversationId ? this.loadGoal(conversationId) : undefined;
    if (!goal || goal.status !== 'active') {
      return { ok: false, error: 'goal_manage: 当前对话没有进行中的目标' };
    }
    const input =
      call.input && typeof call.input === 'object' ? (call.input as Record<string, unknown>) : {};
    const action = input.action;
    const reason =
      typeof input.reason === 'string' && input.reason.trim()
        ? input.reason.trim().slice(0, 500)
        : '';
    if (action !== 'complete' && action !== 'block' && action !== 'progress') {
      return { ok: false, error: 'goal_manage: action 必须为 complete/block/progress' };
    }
    const now = new Date().toISOString();
    if (action === 'complete') {
      this.saveGoal({
        ...goal,
        status: 'achieved',
        achievedAt: now,
        lastReason: reason || '模型自证完成',
      });
      return { ok: true, content: '目标已标记完成。' };
    }
    if (action === 'block') {
      if (!reason) return { ok: false, error: 'goal_manage: block 需要 reason' };
      this.saveGoal({
        ...goal,
        status: 'blocked',
        blockedAt: now,
        blockedReason: reason,
        lastReason: reason,
      });
      return { ok: true, content: '已标记受阻，等待用户处理。' };
    }
    this.saveGoal({ ...goal, lastReason: reason || '（进度更新）' });
    return { ok: true, content: '进度已记录。' };
  }

  /**
   * ask_user_question executor（模型主动问询）。挂起工具调用并发出
   * `conversation.ask_pending`（持久化，桌面端据此接管 composer 展示问询
   * 卡片）；用户经 conversation.ask.answer / cancel 命令作答后回填为工具
   * 结果。plan-review intent 由桌面端特例渲染为「方案待审」卡。
   */
  private async handleAskUserQuestionToolCall(
    runId: RunId,
    run: DemoRunState,
    call: PlatformMcpToolCall,
  ): Promise<{ ok: boolean; content?: string; error?: string }> {
    const parsed = parseAskUserQuestionInput(call.input);
    if (!parsed || parsed.questions.length === 0) {
      return { ok: false, error: 'ask_user_question: invalid questions structure' };
    }
    const askId = `ask-${ulid()}`;
    const threadId = run.threadId;
    return new Promise((resolve) => {
      const entry: PendingAskEntry = {
        askId,
        runId,
        threadId,
        questions: parsed.questions,
        createdAt: new Date().toISOString(),
        resolve,
        onAbort: () => {
          if (this.pendingAsks.delete(askId)) {
            this.publishEvent(
              this.appendEvent('system', 'conversation.ask_cancelled', {
                askId,
                threadId,
                runId,
                reason: 'run-cancelled',
              }),
            );
            resolve({ ok: false, error: 'ask_user_question cancelled' });
          }
        },
      };
      this.pendingAsks.set(askId, entry);
      if (call.signal.aborted) {
        entry.onAbort();
        return;
      }
      call.signal.addEventListener('abort', entry.onAbort, { once: true });
      this.publishEvent(
        this.persistProjectedEvent(
          {
            id: ulid() as Event['id'],
            workspaceId: this.resolveEventWorkspaceId(threadId),
            taskId: this.resolveEventTaskId(threadId),
            runId,
            category: 'system',
            type: 'conversation.ask_pending',
            occurredAt: entry.createdAt,
            payload: {
              askId,
              threadId,
              runId,
              questions: parsed.questions,
            },
          },
          new Map(this.demoRuns),
        ),
      );
    });
  }

  /**
   * plan_submit executor（规划模式，§12.18）。把模型提交的结构化方案持久化到
   * conversation 并发 conversation.plan_submitted 事件（前端渲染可编辑方案卡）；
   * 工具结果告知模型停止等待审批，规划轮随后自然结束。
   */
  private async handlePlanSubmitToolCall(
    runId: RunId,
    run: DemoRunState,
    call: PlatformMcpToolCall,
    _argumentsJson: string,
  ): Promise<{ ok: boolean; content?: string; error?: string }> {
    const conversationId = this.resolveConversationIdForThread(run.threadId);
    if (!conversationId || !this.conversationStore) {
      return { ok: false, error: 'conversation store unavailable' };
    }
    const parsed = parseConversationPlanSubmitPayload({
      conversationId,
      plan: call.input,
    });
    if (!parsed) {
      return { ok: false, error: 'plan_submit: invalid plan structure' };
    }
    try {
      const plan = this.conversationStore.submitConversationPlan(
        parsed.conversationId,
        parsed.plan,
      );
      const event = this.appendEvent('system', 'conversation.plan_submitted', {
        conversationId: parsed.conversationId,
        revision: plan.currentRevision,
        runId,
      });
      this.publishEvent(event);
      return {
        ok: true,
        content: JSON.stringify({
          ok: true,
          planSubmitted: true,
          revision: plan.currentRevision,
          message: '计划已提交，等待用户审批。请简要总结计划要点并停止执行，不要继续做任何改动。',
        }),
      };
    } catch (error) {
      return {
        ok: false,
        error: `plan_submit failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * task_schedule executor（定时任务管理）。list 免审批；create/cancel 在
   * ask-mode 下先走工具审批（复用 requestPlatformToolApproval）。
   */
  private async executeTaskScheduleTool(
    runId: RunId,
    run: DemoRunState,
    call: PlatformMcpToolCall,
    executionMode: 'ask' | 'workspace' | 'full-access',
  ): Promise<{ ok: boolean; content?: string; error?: string }> {
    if (!this.scheduledTaskStore) {
      return { ok: false, error: 'task_schedule: 定时任务存储不可用' };
    }
    const input =
      call.input && typeof call.input === 'object' ? (call.input as Record<string, unknown>) : {};
    const action = input.action;
    if (action !== 'create' && action !== 'list' && action !== 'cancel') {
      return { ok: false, error: 'task_schedule: action 必须为 create/list/cancel' };
    }
    if (action === 'create' || action === 'cancel') {
      if (executionMode === 'ask') {
        const decision = await this.requestPlatformToolApproval(runId, run.threadId, call);
        if (decision !== 'approve') {
          return { ok: false, error: '宿主已拒绝此操作' };
        }
      }
      if (call.signal.aborted || !this.demoRuns.has(runId)) {
        return { ok: false, error: 'platform tool call was cancelled before execution' };
      }
    }
    try {
      if (action === 'list') {
        const tasks = this.scheduledTaskStore.list();
        return {
          ok: true,
          content: JSON.stringify(
            tasks.map((task) => ({
              id: task.id,
              name: task.name,
              enabled: task.enabled,
              nextRunAt: task.nextRunAt ?? null,
              lastRunAt: task.lastRunAt ?? null,
              rule: task.rule,
              target: task.target,
            })),
          ),
        };
      }
      if (action === 'cancel') {
        const taskId = typeof input.taskId === 'string' ? input.taskId : '';
        if (!taskId) return { ok: false, error: 'task_schedule: cancel 需要 taskId' };
        const updated = this.scheduledTaskStore.update(taskId, { enabled: false });
        if (!updated) return { ok: false, error: 'task_schedule: 任务不存在' };
        this.publishTaskEvent('scheduledTask.updated', taskId, {
          taskId,
          action: 'cancel',
        });
        return { ok: true, content: JSON.stringify({ cancelled: true, taskId }) };
      }
      // create
      const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : '';
      const instruction =
        typeof input.instruction === 'string' && input.instruction.trim()
          ? input.instruction.trim()
          : '';
      const targetRaw =
        input.target && typeof input.target === 'object'
          ? (input.target as Record<string, unknown>)
          : {};
      const ruleRaw =
        input.rule && typeof input.rule === 'object' ? (input.rule as Record<string, unknown>) : {};
      const targetKind = targetRaw.kind;
      const target: ScheduledTaskTarget | undefined =
        targetKind === 'agent' && typeof targetRaw.agentId === 'string'
          ? { kind: 'agent', agentId: targetRaw.agentId }
          : targetKind === 'model' && typeof targetRaw.modelId === 'string'
            ? { kind: 'model', modelId: targetRaw.modelId }
            : undefined;
      const ruleKind = ruleRaw.kind;
      let rule: TaskRule | undefined;
      if (ruleKind === 'at' && typeof ruleRaw.runAt === 'string') {
        rule = { kind: 'at', runAt: ruleRaw.runAt };
      } else if (
        ruleKind === 'every' &&
        typeof ruleRaw.intervalMinutes === 'number' &&
        Number.isInteger(ruleRaw.intervalMinutes) &&
        ruleRaw.intervalMinutes >= 5
      ) {
        rule = {
          kind: 'every',
          intervalMinutes: ruleRaw.intervalMinutes,
          ...(typeof ruleRaw.firstRunAt === 'string' ? { firstRunAt: ruleRaw.firstRunAt } : {}),
        };
      } else if (
        ruleKind === 'random' &&
        typeof ruleRaw.windowStart === 'string' &&
        typeof ruleRaw.windowEnd === 'string' &&
        typeof ruleRaw.minTimes === 'number' &&
        typeof ruleRaw.maxTimes === 'number'
      ) {
        rule = {
          kind: 'random',
          windowStart: ruleRaw.windowStart,
          windowEnd: ruleRaw.windowEnd,
          minTimes: Math.max(1, Math.floor(ruleRaw.minTimes)),
          maxTimes: Math.max(1, Math.floor(ruleRaw.maxTimes)),
        };
      } else if (ruleKind === 'cron' && typeof ruleRaw.expression === 'string') {
        rule = { kind: 'cron', expression: ruleRaw.expression };
      }
      if (!name || !instruction || !target || !rule) {
        return {
          ok: false,
          error: 'task_schedule: create 需要 name/instruction/target/rule 且参数合法',
        };
      }
      const id = `task-${ulid()}`;
      const timeZone =
        typeof input.timeZone === 'string' && input.timeZone.trim() ? input.timeZone.trim() : 'UTC';
      const task: ScheduledTask = {
        id,
        name,
        instruction,
        target,
        rule,
        timeZone,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const nextRunAt = initialNextRunAt(task);
      const stored = this.scheduledTaskStore.create({
        id,
        name,
        instruction,
        target,
        rule,
        timeZone,
        enabled: true,
        ...(nextRunAt ? { nextRunAt } : {}),
      });
      this.publishTaskEvent('scheduledTask.updated', id, { taskId: id, action: 'create' });
      return {
        ok: true,
        content: JSON.stringify({
          created: true,
          taskId: stored.id,
          name: stored.name,
          nextRunAt: stored.nextRunAt ?? null,
        }),
      };
    } catch (error) {
      return {
        ok: false,
        error: `task_schedule failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async executeExternalKernelBrowserTool(
    runId: RunId,
    run: DemoRunState,
    workspaceRoot: string,
    call: PlatformMcpToolCall,
    argumentsJson: string,
    executionMode: 'ask' | 'workspace' | 'full-access',
  ): Promise<{ ok: boolean; content?: string; error?: string }> {
    if (!this.browserController) {
      return {
        ok: false,
        error: 'browser.worker-unavailable: Browser Worker is not configured on this Runtime.',
      };
    }
    const browserPermissionInput = {
      toolName: call.tool,
      argumentsJson,
      workspaceId: this.resolveEventWorkspaceId(run.threadId),
      runId,
      ownerId: run.threadId,
      idempotencyKey: `browser:${runId}:${call.id}`,
      ...(workspaceRoot ? { workspaceRoot } : {}),
    };
    const permission = this.browserController.evaluatePermission(browserPermissionInput);
    let browserApproval: { approvalId: string } | undefined;
    if (permission.decision === 'approval-required') {
      if (executionMode === 'full-access') {
        const approvalId = `auto-full-access:${runId}:${call.id}`;
        this.browserController.recordPermissionDecision(
          browserPermissionInput,
          'allow',
          approvalId,
        );
        browserApproval = { approvalId };
      } else {
        const decision = await this.requestPlatformToolApproval(runId, run.threadId, call);
        if (call.signal.aborted || !this.demoRuns.has(runId) || decision !== 'approve') {
          this.browserController.recordPermissionDecision(
            browserPermissionInput,
            'deny',
            `deny:${runId}:${call.id}`,
          );
          return { ok: false, error: '宿主已拒绝此浏览器操作' };
        }
        const approvalId = `kappr:${runId}:${call.id}`;
        this.browserController.recordPermissionDecision(
          browserPermissionInput,
          'allow',
          approvalId,
        );
        browserApproval = { approvalId };
      }
    }
    if (call.signal.aborted || !this.demoRuns.has(runId)) {
      return { ok: false, error: 'platform tool call was cancelled before execution' };
    }
    const toolCall: ProviderToolCall = { id: call.id, name: call.tool, argumentsJson };
    try {
      const content = await this.executeChatBrowserWorkerTool({
        runId,
        threadId: run.threadId,
        toolCall,
        workspaceRoot,
        signal: call.signal,
        approval: browserApproval,
      });
      return { ok: true, content };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Dispatch one platform tool for an external kernel. Mirrors the native tool
   * loop's family order and reuses its executors, so validation, store
   * invariants and domain events stay in exactly one place. Tool lifecycle
   * events are NOT published here — the kernel adapter already projects
   * tool.requested/tool.completed for its own stream.
   */
  private async executeHostPlatformTool(
    run: DemoRunState,
    toolCall: ProviderToolCall,
    workspaceRoot: string,
  ): Promise<string> {
    const name = toolCall.name;
    if (CHAT_TASK_PLAN_TOOL_NAMES.has(name) && this.taskPlanStore) {
      const workspaceId = this.resolveEventWorkspaceId(run.threadId);
      if (name === 'TaskCreate') {
        return executeTaskCreateTool(toolCall.argumentsJson, workspaceId, this.taskPlanStore);
      }
      if (name === 'TaskUpdate') {
        return executeTaskUpdateTool(toolCall.argumentsJson, this.taskPlanStore);
      }
      return executeTaskListTool(toolCall.argumentsJson, workspaceId, this.taskPlanStore);
    }
    if (CHAT_PLAN_TOOL_NAMES.has(name)) {
      return executeChatPlanTool(toolCall.argumentsJson);
    }
    if (CHAT_AGENT_TOOL_NAMES.has(name)) {
      return this.executeChatAgentTool({ run, toolCall });
    }
    if (CHAT_SKILL_TOOL_NAMES.has(name)) {
      return this.executeChatSkillTool({ run, toolCall });
    }
    if (CHAT_TEAM_TOOL_NAMES.has(name)) {
      return this.executeChatTeamTool({ run, toolCall });
    }
    if (CHAT_MCP_REGISTRY_TOOL_NAMES.has(name)) {
      return this.executeChatRemoteMcpTool({ run, toolCall });
    }
    if (CHAT_MCP_CATALOG_TOOL_NAMES.has(name)) {
      return this.executeChatMcpCatalogTool(run);
    }
    const ctx: PlatformToolContext = {
      workspaceDir: workspaceRoot,
      runId: run.runId,
      threadId: run.threadId,
      kernelId: run.kernelId,
      taskPlanStore: this.taskPlanStore ?? undefined,
      agentStore: this.agentStore ? this.toPlatformAgentStore(this.agentStore) : undefined,
      resolveWorkspaceId: () => this.resolveEventWorkspaceId(run.threadId),
    };
    let input: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(toolCall.argumentsJson || '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        input = parsed as Record<string, unknown>;
      }
    } catch {
      input = {};
    }
    return executePlatformTool(name, input, ctx);
  }

  /**
   * Raise a tool.approval_requested card and await the shell decision. Mirrors
   * the native `requestChatToolApproval` abort semantics: a kernel-side cancel,
   * MCP timeout or run abort removes the pending card and emits a decided-deny
   * so the shell card collapses instead of waiting forever.
   */
  private requestPlatformToolApproval(
    runId: RunId,
    threadId: string,
    call: PlatformMcpToolCall,
  ): Promise<'approve' | 'deny'> {
    return new Promise((resolve) => {
      const approvalId = `kappr-${ulid()}`;
      const toolCall: ProviderToolCall = {
        id: call.id,
        name: call.tool,
        argumentsJson: JSON.stringify(call.input ?? {}),
      };
      const summary = summarizeToolCallForApproval(call.tool, toolCall.argumentsJson);
      try {
        const event = this.persistProjectedEvent(
          {
            id: ulid() as Event['id'],
            workspaceId: this.resolveEventWorkspaceId(threadId),
            taskId: this.resolveEventTaskId(threadId),
            runId,
            category: 'approval',
            type: 'tool.approval_requested',
            occurredAt: new Date().toISOString(),
            payload: {
              approvalId,
              threadId,
              runId,
              toolCallId: call.id,
              toolName: call.tool,
              arguments: call.input ?? {},
              title: summary.title,
              detail: summary.detail,
              path: summary.path,
              command: summary.command,
              executionMode: normalizeChatExecutionMode(this.resolveChatExecutionMode(threadId)),
            },
          },
          new Map(this.demoRuns),
        );
        this.publishEvent(event);
      } catch {
        // A failed approval persistence must not fail the tool call outright.
      }
      const onAbort = () => {
        if (this.pendingToolApprovals.delete(approvalId)) {
          this.emitToolApprovalDecided({
            approvalId,
            threadId,
            runId,
            decision: 'deny',
            reason: 'kernel-call-cancelled',
            toolCallId: call.id,
            toolName: call.tool,
          });
        }
        resolve('deny');
      };
      if (call.signal.aborted) {
        onAbort();
        return;
      }
      call.signal.addEventListener('abort', onAbort, { once: true });
      this.pendingToolApprovals.set(approvalId, {
        approvalId,
        runId,
        threadId,
        workspaceRoot: '',
        executionMode: '',
        chatMessages: [],
        pendingToolCalls: [toolCall],
        currentIndex: 0,
        completedResults: [],
        toolLoopRound: 0,
        resolve: (decision) => {
          call.signal.removeEventListener('abort', onAbort);
          resolve(decision === 'approve' ? 'approve' : 'deny');
        },
        createdAt: new Date().toISOString(),
      });
    });
  }

  private toPlatformAgentStore(agentStore: SqliteAgentStore): PlatformToolContext['agentStore'] {
    return {
      listLatestVersions: () =>
        agentStore.listLatestVersions().map((record) => ({
          agentId: record.agentId,
          name: record.name,
          version: String(record.version),
        })),
    };
  }

  /**
   * kernel.detect — registry sweep for the kernel selector UI. Each entry
   * probes the local executable (PATH + common install dirs) and reports
   * install state, version, known-good status and declared capabilities.
   */
  private async handleKernelDetect(socket: Socket, frame: Frame): Promise<void> {
    try {
      const kernels = await Promise.all(
        getKernelRegistry().map(async (entry) => {
          try {
            return await entry.detect();
          } catch {
            // A broken probe must not fail the whole sweep — report uninstalled.
            return {
              kernelId: entry.id,
              name: entry.name,
              icon: entry.icon,
              capabilities: entry.capabilities,
              ...(entry.installCommand ? { installCommand: entry.installCommand } : {}),
              installed: false,
              version: null,
              executablePath: null,
              knownGood: false,
            } as KernelDetectionResult;
          }
        }),
      );
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'kernel.detect',
          payload: { kernels } satisfies KernelDetectResponse,
        }),
      );
    } catch (error) {
      this.writeProviderCommandError(socket, frame, error);
    }
  }

  /**
   * Kernel permission bridge: the kernel's can_use_tool request surfaces as the
   * same tool.approval_requested card the native path uses; the shell decision
   * (conversation.decideToolApproval) routes back through respondPermission.
   */
  private wireKernelPermissionBridge(
    runId: RunId,
    threadId: string,
    adapter: KernelAdapter,
    signal: AbortSignal,
  ): void {
    adapter.onPermissionRequest((permission: KernelPermissionRequest) => {
      const run = this.demoRuns.get(runId);
      if (!run || signal.aborted) return;
      const approvalId = `kappr-${ulid()}`;
      const toolCall: ProviderToolCall = {
        id: permission.requestId,
        name: permission.toolName,
        argumentsJson: JSON.stringify(permission.toolInput ?? {}),
      };
      const summary = summarizeToolCallForApproval(permission.toolName, toolCall.argumentsJson);
      try {
        const event = this.persistProjectedEvent(
          {
            id: ulid() as Event['id'],
            workspaceId: this.resolveEventWorkspaceId(threadId),
            taskId: this.resolveEventTaskId(threadId),
            runId,
            category: 'approval',
            type: 'tool.approval_requested',
            occurredAt: new Date().toISOString(),
            payload: {
              approvalId,
              threadId,
              runId,
              toolCallId: permission.requestId,
              toolName: permission.toolName,
              arguments: permission.toolInput ?? {},
              ...(permission.reason ? { reason: permission.reason } : {}),
              title: summary.title,
              detail: summary.detail,
              path: summary.path,
              command: summary.command,
              executionMode: normalizeChatExecutionMode(this.resolveChatExecutionMode(threadId)),
            },
          },
          new Map(this.demoRuns),
        );
        this.publishEvent(event);
      } catch {
        // A failed approval persistence must not kill the kernel stream.
      }
      this.pendingToolApprovals.set(approvalId, {
        approvalId,
        runId,
        threadId,
        workspaceRoot: '',
        executionMode: '',
        chatMessages: [],
        pendingToolCalls: [toolCall],
        currentIndex: 0,
        completedResults: [],
        toolLoopRound: 0,
        resolve: (decision) => {
          adapter.respondPermission(
            permission.requestId,
            decision === 'approve'
              ? { allow: true }
              : { allow: false, message: '宿主已拒绝此操作' },
          );
        },
        createdAt: new Date().toISOString(),
      });
    });
  }

  private publishKernelTextDelta(
    runId: RunId,
    threadId: string,
    text: string,
    final?: boolean,
  ): void {
    const run = this.demoRuns.get(runId);
    if (!run || !text) return;
    const occurredAt = new Date().toISOString();
    if (final) {
      // §12.17.18 exception: the kernel itself declared this text final
      // (codex agentMessage IS the user-facing reply; its working prose rides
      // the reasoning channel). Stream it straight into the answer area — no
      // buffering, no terminal-time jump from process panel to chat bubble.
      // Defensive: fold any unclassified buffered prefix into the answer so
      // ordering survives even if an adapter ever mixes both delta kinds.
      const pending = run.legacyPendingText ?? '';
      let nextRun: DemoRunState = {
        ...run,
        legacyPendingText: '',
        legacyPendingTextSeq: undefined,
        assistantText: run.assistantText + pending + text,
      };
      nextRun = appendAssistantTextDelta(
        nextRun,
        'final_answer',
        pending + text,
        occurredAt,
        pending ? run.legacyPendingTextSeq : undefined,
      );
      nextRun = closeCommentaryTimelineSegment(nextRun, occurredAt);
      this.demoRuns.set(runId, nextRun);
      this.publishTransientDelta({
        threadId: threadId as ThreadId,
        runId,
        kind: 'text',
        textDelta: text,
        occurredAt,
      });
      this.updateTransientTextSnapshot({
        threadId: threadId as ThreadId,
        runId,
        streamSequence: this.transientSequenceByThread.get(threadId) ?? 0,
        text: nextRun.assistantText,
        commentaryText: nextRun.commentaryText,
        commentarySegments: nextRun.commentarySegments,
        reasoningText: nextRun.reasoningText,
        reasoningSegments: nextRun.reasoningSegments,
        assistantTimeline: nextRun.assistantTimeline,
        updatedAt: occurredAt,
      });
      return;
    }
    // §12.17.18: kernel delta carries no phase metadata — buffer it and let
    // the next tool boundary (commentary) or the terminal (final_answer)
    // classify it, so process prose never masquerades as the final answer
    // while streaming. The transient text frame still flows immediately so
    // the renderer shows the unclassified tail in the process panel.
    // Record the timeline position where the buffer started so the flush can
    // insert the classified segment in real emission order.
    const alreadyBuffered = Boolean(run.legacyPendingText);
    this.demoRuns.set(runId, {
      ...run,
      legacyPendingText: `${run.legacyPendingText ?? ''}${text}`,
      ...(!alreadyBuffered
        ? {
            legacyPendingTextSeq: nextAssistantTimelineSequence(run.assistantTimeline ?? []),
          }
        : {}),
    });
    this.publishTransientDelta({
      threadId: threadId as ThreadId,
      runId,
      kind: 'text',
      textDelta: text,
      occurredAt,
    });
  }

  private persistKernelToolEvent(
    runId: RunId,
    threadId: string,
    type: 'tool.requested' | 'tool.completed',
    event: Extract<KernelEvent, { type: 'tool-call' | 'tool-result' }>,
  ): void {
    try {
      const occurredAt = new Date().toISOString();
      if (type === 'tool.requested') {
        // §12.17.20: a tool boundary reclassifies every preceding text as
        // commentary — flush the buffered kernel prose before the tool row so
        // it lands in the process panel, never in the summary panel.
        this.flushLegacyAssistantText({ runId, phase: 'commentary', occurredAt });
      }
      const run = this.demoRuns.get(runId);
      if (run) {
        let nextRun = run;
        // 实时映射：工具行揭示/完成即把最新 timeline 推给前端（调用哪个显示哪个）。
        // claude-code / codex 内核在一条 assistant 消息里批量宣布多个 tool_use，
        // 却顺序执行工具——所以宣布先入待揭示队列，第 1 个立即揭示（kernel 随即
        // 开始执行），之后每个 tool-result 到达时完成当前行并揭示下一个。
        let timelineChanged = false;
        if (type === 'tool.requested') {
          const toolCallId = (event as { toolId: string }).toolId;
          const name = (event as { name: string }).name;
          const argsJson = (event as { argsJson: string }).argsJson;
          const pending = [...(run.pendingKernelToolCalls ?? [])];
          pending.push({ toolCallId, name, argumentsJson: argsJson, announcedAt: occurredAt });
          // 当前没有正在执行的工具行时立即揭示（首个宣布的工具 kernel 随即开始执行）。
          if (!this.hasRunningTimelineTool(run.assistantTimeline)) {
            const announced = pending.shift()!;
            nextRun = startAssistantTool(run, {
              toolCallId: announced.toolCallId,
              name: announced.name,
              argumentsJson: announced.argumentsJson,
              occurredAt: announced.announcedAt,
            });
            timelineChanged = true;
          }
          nextRun = { ...nextRun, pendingKernelToolCalls: pending };
        } else {
          const toolCallId = (event as { toolId: string }).toolId;
          const pending = run.pendingKernelToolCalls ?? [];
          const pendingIndex = pending.findIndex((entry) => entry.toolCallId === toolCallId);
          let pendingAfter = pending;
          if (pendingIndex >= 0) {
            // 乱序防御：该工具尚未揭示但已完成 —— 并行执行的 kernel 中排在它
            // 之前的 pending 工具同样已在执行，一并揭示后再完成当前。
            for (const entry of pending.slice(0, pendingIndex + 1)) {
              nextRun = startAssistantTool(nextRun, {
                toolCallId: entry.toolCallId,
                name: entry.name,
                argumentsJson: entry.argumentsJson,
                occurredAt: entry.announcedAt,
              });
            }
            pendingAfter = pending.slice(pendingIndex + 1);
            timelineChanged = true;
          }
          nextRun = completeAssistantTool(nextRun, {
            toolCallId,
            output: (event as { output: string }).output,
            failed: (event as { isError?: boolean }).isError === true,
            occurredAt,
          });
          // 完成后若没有正在执行的工具行，揭示下一个待执行工具（顺序执行的下一个）。
          if (!this.hasRunningTimelineTool(nextRun.assistantTimeline) && pendingAfter.length > 0) {
            const announced = pendingAfter[0]!;
            nextRun = startAssistantTool(nextRun, {
              toolCallId: announced.toolCallId,
              name: announced.name,
              argumentsJson: announced.argumentsJson,
              occurredAt: announced.announcedAt,
            });
            pendingAfter = pendingAfter.slice(1);
            timelineChanged = true;
          }
          nextRun = { ...nextRun, pendingKernelToolCalls: pendingAfter };
        }
        const history = [...(nextRun.kernelToolEvents ?? [])];
        history.push(
          type === 'tool.requested'
            ? {
                kind: 'tool-call',
                sequence: history.length,
                toolId: (event as { toolId: string }).toolId,
                name: (event as { name: string }).name,
                argsJson: (event as { argsJson: string }).argsJson,
              }
            : {
                kind: 'tool-result',
                sequence: history.length,
                toolId: (event as { toolId: string }).toolId,
                output: (event as { output: string }).output,
                ...((event as { isError?: boolean }).isError ? { failed: true } : {}),
              },
        );
        nextRun = { ...nextRun, kernelToolEvents: history };
        this.demoRuns.set(runId, nextRun);
        if (timelineChanged) {
          this.pushKernelTimelineSnapshot(runId, threadId, occurredAt);
        }
      }
      const draft: EventDraft = {
        id: ulid() as Event['id'],
        workspaceId: this.resolveEventWorkspaceId(threadId),
        taskId: this.resolveEventTaskId(threadId),
        runId,
        category: 'tool',
        type,
        occurredAt,
        payload:
          type === 'tool.requested'
            ? {
                toolCall: {
                  id: (event as { toolId: string }).toolId,
                  name: (event as { name: string }).name,
                  argumentsJson: (event as { argsJson: string }).argsJson,
                },
                ...((event as { partial?: boolean }).partial ? { partial: true } : {}),
              }
            : {
                toolCallId: (event as { toolId: string }).toolId,
                result: (event as { output: string }).output,
                ...((event as { isError?: boolean }).isError ? { failed: true } : {}),
              },
      };
      const committed = this.persistProjectedEvent(draft, new Map(this.demoRuns));
      this.publishEvent(committed);
    } catch {
      // Tool event persistence must never crash the kernel stream.
    }
  }

  /** True when the assistant timeline holds a kernel tool row still running. */
  private hasRunningTimelineTool(timeline: readonly unknown[] | undefined): boolean {
    return (timeline ?? []).some(
      (segment) =>
        typeof segment === 'object' &&
        segment !== null &&
        (segment as { kind?: string }).kind === 'tool' &&
        (segment as { status?: string }).status === 'running',
    );
  }

  /** Push the latest assistant timeline snapshot so tool rows appear live. */
  private pushKernelTimelineSnapshot(runId: RunId, threadId: string, occurredAt: string): void {
    const run = this.demoRuns.get(runId);
    if (!run) return;
    this.updateTransientTextSnapshot({
      threadId: threadId as ThreadId,
      runId,
      streamSequence: this.transientSequenceByThread.get(threadId) ?? 0,
      text: run.assistantText,
      commentaryText: run.commentaryText,
      commentarySegments: run.commentarySegments,
      reasoningText: run.reasoningText,
      reasoningSegments: run.reasoningSegments,
      assistantTimeline: run.assistantTimeline,
      updatedAt: occurredAt,
    });
  }

  /**
   * Kernel reasoning: diagnostic-only, exactly like native provider reasoning.
   * It streams for live visibility but never becomes durable chat text.
   */
  private publishKernelReasoningDelta(runId: RunId, threadId: string, text: string): void {
    const run = this.demoRuns.get(runId);
    if (!run || !text) return;
    const occurredAt = new Date().toISOString();
    const next = appendAssistantThinkingDelta(
      { ...run, reasoningText: `${run.reasoningText ?? ''}${text}` },
      text,
      occurredAt,
    );
    this.demoRuns.set(runId, next);
    this.publishTransientDelta({
      threadId: threadId as ThreadId,
      runId,
      kind: 'reasoning',
      textDelta: text,
      occurredAt,
    });
    this.updateTransientTextSnapshot({
      threadId: threadId as ThreadId,
      runId,
      streamSequence: this.transientSequenceByThread.get(threadId) ?? 0,
      text: next.assistantText,
      reasoningText: next.reasoningText,
      assistantTimeline: next.assistantTimeline,
      updatedAt: occurredAt,
    });
  }

  /**
   * The kernel compacted its own context. The host only records the boundary —
   * it must never run its own compaction on top of a self-managing kernel.
   *
   * Deliberately NOT `context.compacted`: that type truncates the native
   * provider history at its sequence, and an autonomous kernel's internal
   * compaction says nothing about what the host may still replay.
   */
  private persistKernelCompacted(runId: RunId, threadId: string): void {
    try {
      const occurredAt = new Date().toISOString();
      const run = this.demoRuns.get(runId);
      if (run) {
        this.demoRuns.set(
          runId,
          appendAssistantStatus(run, {
            statusType: 'compaction',
            label: '内核已压缩上下文',
            occurredAt,
          }),
        );
      }
      const committed = this.persistProjectedEvent(
        {
          id: ulid() as Event['id'],
          workspaceId: this.resolveEventWorkspaceId(threadId),
          taskId: this.resolveEventTaskId(threadId),
          runId,
          category: 'context',
          type: 'kernel.context_compacted',
          occurredAt,
          payload: {
            threadId,
            kernelId: run?.kernelId ?? 'kernel',
          },
        },
        new Map(this.demoRuns),
      );
      this.publishEvent(committed);
    } catch {
      // Compaction notices are advisory; never crash the kernel stream.
    }
  }

  private persistKernelUsage(
    runId: RunId,
    run: DemoRunState,
    usage: KernelUsage,
    sequence: number,
    preferUsageIdentity = false,
  ): void {
    try {
      const occurredAt = new Date().toISOString();
      const draft: EventDraft = {
        id: ulid() as Event['id'],
        workspaceId: this.resolveEventWorkspaceId(run.threadId),
        taskId: this.resolveEventTaskId(run.threadId),
        runId,
        category: 'provider',
        type: 'provider.usage',
        occurredAt,
        payload: {
          threadId: run.threadId,
          // Stable per usage report: value-derived ids made progressive updates
          // look like separate provider requests in the usage aggregate.
          requestId: usage.requestId ?? `kernel-${runId}-${sequence}`,
          ...(usage.providerResponseId ? { providerResponseId: usage.providerResponseId } : {}),
          providerId: preferUsageIdentity
            ? (usage.providerId ?? run.providerId ?? run.kernelId ?? 'kernel')
            : (run.providerId ?? usage.providerId ?? run.kernelId ?? 'kernel'),
          providerModelId: usage.modelId ?? run.providerModelId,
          purpose: 'normal',
          tokensIn: usage.input ?? usage.real,
          tokensOut: usage.output ?? 0,
          ...(usage.cached !== undefined ? { cachedTokensHit: usage.cached } : {}),
          ...(usage.cachedTokensCreated !== undefined
            ? { cachedTokensCreated: usage.cachedTokensCreated }
            : {}),
          ...(usage.reasoningTokens !== undefined
            ? { reasoningTokens: usage.reasoningTokens }
            : {}),
          totalTokens: usage.real,
        },
      };
      const committed = this.persistProjectedEvent(draft, new Map(this.demoRuns));
      this.publishEvent(committed);
    } catch {
      // Usage accounting must never crash the kernel stream.
    }
  }

  private persistGatewayUsage(
    runId: RunId,
    run: DemoRunState,
    usage: GatewayRunUsage,
    sequence: number,
  ): void {
    this.persistKernelUsage(
      runId,
      run,
      {
        real: usage.totalTokens,
        window: 0,
        input: usage.tokensIn,
        output: usage.tokensOut,
        ...(usage.cachedTokensHit !== undefined ? { cached: usage.cachedTokensHit } : {}),
        ...(usage.cachedTokensCreated !== undefined
          ? { cachedTokensCreated: usage.cachedTokensCreated }
          : {}),
        ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
        requestId: usage.requestId,
        ...(usage.providerResponseId ? { providerResponseId: usage.providerResponseId } : {}),
        ...(usage.providerId ? { providerId: usage.providerId } : {}),
        modelId: usage.providerModelId,
      },
      sequence,
      true,
    );
  }

  private finalizeKernelRun(
    runId: RunId,
    run: DemoRunState,
    status: 'completed' | 'failed',
    error?: string,
  ): void {
    const occurredAt = new Date().toISOString();
    // §12.17.18: at the terminal boundary the remaining buffered kernel text
    // is the final answer — flush it into a final_answer timeline segment so
    // it renders in the summary panel (and survives message persistence).
    const flushedRun = run.legacyPendingText
      ? (this.flushLegacyAssistantText({ runId, phase: 'final_answer', occurredAt }) ?? run)
      : run;
    const terminalRun = closeAssistantTimeline(
      closeCommentaryTimelineSegment(flushedRun, occurredAt),
      occurredAt,
    );
    this.demoRuns.set(runId, terminalRun);
    const failed = status === 'failed';
    const payload: Record<string, unknown> = {
      threadId: terminalRun.threadId,
      ...(failed
        ? { failureClass: 'unknown', errorMessage: error ?? 'kernel failed' }
        : { reason: 'stop' }),
      assistantText: terminalRun.assistantText,
      adapterEventIndex: terminalRun.nextAdapterEventIndex,
      idempotencyKey: run.runId,
      modelId: terminalRun.modelId,
      providerModelId: terminalRun.providerModelId,
      packetId: terminalRun.packetId,
      kernelId: terminalRun.kernelId,
    };
    try {
      const event = this.persistProjectedEvent(
        {
          id: ulid() as Event['id'],
          workspaceId: this.resolveEventWorkspaceId(terminalRun.threadId),
          taskId: this.resolveEventTaskId(terminalRun.threadId),
          runId,
          category: 'run',
          type: failed ? 'run.failed' : 'run.completed',
          occurredAt,
          payload,
        },
        new Map(this.demoRuns),
      );
      if (failed) {
        this.persistAssistantTerminalMessage(runId, terminalRun, 'failed', error);
        // Publish the terminal BEFORE the diagnostic: recordRunDiagnostic emits
        // a later-sequence event, and publishEvent drops anything older than
        // the subscriber's live cursor — reordering here would silently lose
        // run.failed from every live stream (UI stuck on "executing").
        this.publishEvent(event);
        this.recordRunDiagnostic(runId, terminalRun, payload);
      } else {
        this.persistAssistantFinalMessage(runId, terminalRun, payload);
        // Publish the terminal BEFORE the memory proposal: maybeProposeRunMemory
        // appends and publishes a later-sequence memory.change.proposed event,
        // and publishEvent drops anything older than the subscriber's live
        // cursor — publishing run.completed after it would silently lose the
        // terminal event from every live stream (UI stuck on "executing").
        this.publishEvent(event);
        this.maybeProposeRunMemory(runId, terminalRun, payload);
      }
      this.demoRuns.delete(runId);
      this.transientSnapshotByThread.delete(terminalRun.threadId as ThreadId);
    } catch {
      // Finalization must not throw into the run loop.
      // 终态发布失败（如 transient 帧超限）也不能让 run 残留在活动表——
      // 否则 healthcheck inFlightRunIds 会把对话永远标记为「执行中」。
      this.demoRuns.delete(runId);
      this.transientSnapshotByThread.delete(terminalRun.threadId as ThreadId);
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

  /** Authoritative per-turn Skill check, independent of Run/provider availability. */
  private authorizeRunSkillSelection(input: {
    workspaceId: string;
    track?: 'model' | 'agent' | 'team';
    agentVersionId?: string;
    globalAgentId?: string;
    teamId?: string;
    skillVersionIds?: readonly string[];
  }): void {
    const track = input.track ?? (input.teamId ? 'team' : input.globalAgentId ? 'agent' : 'model');
    const isAgentTrack = track === 'agent' || track === 'team';
    let effectiveGlobalAgentId = input.globalAgentId;
    if (input.teamId && this.teamStore) {
      const team = this.teamStore.get(input.teamId as TeamId);
      if (!team) throw new Error(`TEAM_NOT_FOUND: ${input.teamId}`);
      effectiveGlobalAgentId ??= team.coordinatorAgentId ?? team.members[0]?.agentId;
    }
    const globalAgent =
      effectiveGlobalAgentId && this.globalAgentStore
        ? this.globalAgentStore.get(effectiveGlobalAgentId)
        : undefined;
    if (input.globalAgentId && !globalAgent) {
      throw new Error(`AGENT_NOT_FOUND: ${input.globalAgentId}`);
    }

    const agent = this.resolveAgentModelBinding(input.agentVersionId);
    const agentMeta = this.resolveAgentManifestMeta(agent.agentVersionId);
    const agentBoundSkillVersionIds = globalAgent
      ? [...globalAgent.skillIds]
      : agentMeta.skillVersionIds;
    const selectedSkillVersionIds = isAgentTrack
      ? input.skillVersionIds
      : (input.skillVersionIds ?? []);
    const skillSelectionPolicy = this.resolveSkillSelectionPolicy({
      workspaceId: input.workspaceId,
      isAgentTrack,
      agentBoundSkillVersionIds,
      selectedSkillVersionIds,
    });
    this.assertSelectedSkillsWithinEffectiveAllowlist(
      selectedSkillVersionIds,
      skillSelectionPolicy.composeSelectedSkillVersionIds,
    );
    resolveRunSkillSelection({
      allowlistedSkillVersionIds: skillSelectionPolicy.allowlistedSkillVersionIds,
      inheritedSkillVersionIds: isAgentTrack
        ? skillSelectionPolicy.agentDefaultSkillVersionIds
        : undefined,
      selectedSkillVersionIds: skillSelectionPolicy.selectedSkillVersionIds,
      getSkill: (skillVersionId) => {
        const row = this.skillStore?.getVersionMetadata(skillVersionId);
        if (!row) return undefined;
        return {
          id: row.id,
          enabled: row.enabled,
          archived: Boolean(row.archivedAt),
          permissionApproved: this.skillStore?.isPermissionApproved(row.id) === true,
        };
      },
    });
  }

  /** �?0.3 �?Agent / Skill allowlist / policy ids for Manifest inspect. */
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
   * Product �?.4: run > pin > agent group first > provider primary.
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
    /** Agent allowlist �?only these Skill versions become skill-definition sources (�?.1). */
    skillVersionIds?: readonly string[];
    /** Agent MCP allowlist �?only these servers contribute tool-schema sources (�?.3). */
    mcpServerIds?: readonly string[];
  }) {
    const task = this.resolveTaskForThread(input.threadId);
    const candidates: ContextSourceRef[] = [];
    const summaries: Array<{ sourceId: string; summary: string }> = [];
    const contentBySourceId = new Map<string, string>();

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
      contentBySourceId.set(
        `task-goal:${task.id}`,
        `Task goal:
${task.goal.trim()}`,
      );
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
      contentBySourceId.set(`task-status:${task.id}`, `Task status: ${task.status}`);
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
      contentBySourceId.set(
        `acceptance:${task.id}`,
        `Acceptance criteria:
${task.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}`,
      );
    }

    // Explicit cross-task ref via parentTaskId only (�?0.1) �?never sibling scrape.
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
    if (parent && cross.sources.length > 0) {
      contentBySourceId.set(
        `cross-task:${parent.id}`,
        [
          `Parent task: ${parent.title}`,
          `Goal: ${parent.goal}`,
          `Status: ${parent.status}`,
          parent.acceptanceCriteria.length > 0
            ? `Acceptance:
${parent.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    // Approved/active project memory (�?0.1 layer 2) �?explicit durable entries only.
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
            updatedAt: e.updatedAt,
          })),
          maxEntries: 8,
        });
        for (const source of memory.sources) {
          candidates.push(source);
          const entry = entries.find((candidate) => `memory:${candidate.id}` === source.id);
          if (entry) {
            const stamp = entry.updatedAt ? ` · ${entry.updatedAt.slice(0, 10)}` : '';
            contentBySourceId.set(
              source.id,
              `Project memory [${entry.scope}]${stamp} ${entry.key}: ${entry.value}`,
            );
          }
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

    // Allowed Skills only �?install �?available (�?.1 / �?0.2 skill-definition).
    let resolvedSkillVersionIds: string[] = [];
    let missingSkillVersionIds: string[] = [];
    let resolvedSkills: Array<{
      sourceId: string;
      skillVersionId: string;
      name: string;
      version: string;
      body: string;
      contentFingerprint: string;
    }> = [];
    let skillTruncations: Array<{
      sourceId: string;
      reason: string;
      beforeTokens: number;
      afterTokens: number;
    }> = [];
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
              contentFingerprint: row.contentFingerprint,
              allowedTools: row.allowedTools,
              hasScripts: row.hasScripts,
            };
          },
          maxSkills: 8,
        });
        for (const source of skills.sources) {
          candidates.push(source);
        }
        for (const summary of skills.summaries) {
          summaries.push(summary);
        }
        resolvedSkillVersionIds = skills.resolvedSkillVersionIds;
        missingSkillVersionIds = skills.missingSkillVersionIds;
        resolvedSkills = skills.resolvedSkills;
        skillTruncations = skills.truncations;
        for (const skill of resolvedSkills) {
          contentBySourceId.set(skill.sourceId, skill.body);
        }
        if (missingSkillVersionIds.length > 0) {
          console.warn('[runtime] allowlisted skills missing from library', missingSkillVersionIds);
        }
      } catch (err) {
        console.warn('[runtime] skill context load failed', err);
      }
    }

    // Allowed MCP tools only �?register �?available (�?.3 / �?0.2 tool-schema).
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
      resolvedSkills,
      skillTruncations,
      resolvedMcpServerIds,
      missingMcpServerIds,
      toolSchemaCount,
      contentBySourceId,
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
    kernelId?: string;
    modelId?: string;
    credentialRefId?: string;
    agentVersionId?: string;
    track?: 'model' | 'agent' | 'team';
    /** Bound global Agent (mutable agent table) for persona / default model. */
    globalAgentId?: string;
    /** Bound team (team-track conversations) �?coordinator drives the model. */
    teamId?: string;
    /** Exact per-turn subset. Undefined preserves the older full-allowlist behavior. */
    skillVersionIds?: readonly string[];
    /** Read-only status/peek paths must not materialize immutable Skill bodies. */
    skillContextMode?: 'run' | 'maintenance';
    reasoningEffort?: string;
    networkEnabled?: boolean;
    /** 批准方案后的执行轮：强制使用 plan-act 的执行模型（仅本轮）。 */
    planExecuting?: boolean;
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
    requestedSkillVersionIds: string[];
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
        effectiveGlobalAgentId = teamRecord.coordinatorAgentId ?? teamRecord.members[0]?.agentId;
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
              agent?.persona?.trim() ? `\n  人设摘要：${agent.persona.trim().slice(0, 160)}` : '',
              member.dependsOn.length > 0
                ? `\n  依赖：${member.dependsOn
                    .map((id) => this.globalAgentStore?.get(id)?.name ?? id)
                    .join('、')}`
                : '',
            ];
            return parts.join('');
          });
          const coordinatorName = teamRecord.coordinatorAgentId
            ? (this.globalAgentStore?.get(teamRecord.coordinatorAgentId)?.name ??
              teamRecord.coordinatorAgentId)
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
    // When a global agent is bound, its full config wins �?including empty
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
    const agentSkillIds = globalAgent ? [...globalAgent.skillIds] : agentMeta.skillVersionIds;
    const workspaceId = this.resolveEventWorkspaceId(input.threadId);
    const track = input.track ?? (input.teamId ? 'team' : input.globalAgentId ? 'agent' : 'model');
    const isAgentTrack = track === 'agent' || track === 'team';
    const selectedSkillVersionIds =
      input.skillContextMode === 'maintenance'
        ? []
        : isAgentTrack
          ? input.skillVersionIds
          : (input.skillVersionIds ?? []);
    const skillSelectionPolicy = this.resolveSkillSelectionPolicy({
      workspaceId,
      isAgentTrack,
      agentBoundSkillVersionIds: agentSkillIds,
      selectedSkillVersionIds,
    });
    this.assertSelectedSkillsWithinEffectiveAllowlist(
      selectedSkillVersionIds,
      skillSelectionPolicy.composeSelectedSkillVersionIds,
    );
    const skillSelection = resolveRunSkillSelection({
      allowlistedSkillVersionIds: skillSelectionPolicy.allowlistedSkillVersionIds,
      inheritedSkillVersionIds:
        isAgentTrack && input.skillContextMode !== 'maintenance'
          ? skillSelectionPolicy.agentDefaultSkillVersionIds
          : undefined,
      selectedSkillVersionIds: skillSelectionPolicy.selectedSkillVersionIds,
      getSkill: (skillVersionId) => {
        const row = this.skillStore?.getVersionMetadata(skillVersionId);
        if (!row) return undefined;
        return {
          id: row.id,
          enabled: row.enabled !== false,
          archived: Boolean(row.archivedAt),
          permissionApproved: this.skillStore?.isPermissionApproved(row.id) === true,
        };
      },
    });
    const requestedSkillVersionIds = skillSelection.requestedSkillVersionIds;
    const effectiveSkillIds = skillSelection.skillVersionIds;
    const effectiveMcpIds = this.resolveEffectiveMcpServerIds(
      workspaceId,
      globalAgent ? globalAgent.mcpServerIds : agentMeta.mcpServerIds,
    );

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

    // plan/exec 双模型路由：规划模式 → 规划模型；执行已批准方案的轮次
    // （planExecuting 标志）→ 执行模型（+ 对应思考强度）。普通 execute 消息
    // 不干预，手动覆盖 / Agent 默认照常生效。路由后同样允许
    // providerModelId 字符串 → catalog modelId 的映射。
    const planActRoute = this.resolvePlanActRouteForThread(
      input.threadId,
      input.planExecuting === true,
    );
    if (planActRoute.applied && planActRoute.modelId) {
      resolvedModelId = planActRoute.modelId as ModelId;
      source = 'planAct';
      modelRecord = this.providerStore?.getModel(resolvedModelId);
      if (!modelRecord && this.providerStore) {
        for (const entry of this.providerStore.listProviders()) {
          const found = this.providerStore.findModelByProviderModelId(
            entry.provider.id,
            resolvedModelId,
          );
          if (found) {
            modelRecord = found;
            resolvedModelId = found.id as ModelId;
            break;
          }
        }
      }
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
      contentBySourceId,
      resolvedSkills,
      skillTruncations,
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
    const includedSkillSourceIds = new Set(
      included
        .filter((contextSource) => contextSource.kind === 'skill-definition')
        .map((contextSource) => contextSource.id),
    );
    const appliedSkills = resolvedSkills.filter((skill) =>
      includedSkillSourceIds.has(skill.sourceId),
    );
    const appliedSkillVersionIds = appliedSkills.map((skill) => skill.skillVersionId);
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
      truncations: [...skillTruncations, ...selected.truncations],
      summaries: amended.summaries,
      crossTaskRefs: protectedCrossTaskRefs,
      evidenceRefsForMemory: amended.evidenceRefsForMemory,
      skillVersionIds: appliedSkillVersionIds as never,
      policyVersion: agentMeta.policyVersion,
    });

    // Reasoning effort resolution (lowest-precedence → highest):
    // 1. plan/exec 路由强制的思考强度（plan-act 设置，按对话模式）;
    // 2. explicit caller value (UI picker / Compose) wins;
    // 3. else the bound global agent's configured effort (agent-track runs);
    // 4. else product default 'auto' — adapters map it to a default thinking
    //    effort, so unconfigured runs still produce a reasoning trace.
    // 'off' remains the only way to explicitly disable thinking.
    const reasoningEffort =
      (planActRoute.applied && planActRoute.reasoningEffort
        ? planActRoute.reasoningEffort
        : undefined) ??
      input.reasoningEffort ??
      (globalAgent && globalAgent.reasoningEffort ? globalAgent.reasoningEffort : undefined) ??
      'auto';

    const skillPromptBlocks = appliedSkills.map((skill) => this.formatSkillPromptBlock(skill));
    const skillPromptBySourceId = new Map(
      appliedSkills.map((skill) => [skill.sourceId, this.formatSkillPromptBlock(skill)] as const),
    );

    let contextWindow = 128_000;
    let contextWindowEstimated = true;
    if (modelRecord?.limitsJson) {
      try {
        const limits = JSON.parse(modelRecord.limitsJson) as { contextWindow?: unknown };
        if (
          typeof limits.contextWindow === 'number' &&
          Number.isFinite(limits.contextWindow) &&
          limits.contextWindow > 0
        ) {
          contextWindow = Math.round(limits.contextWindow);
          contextWindowEstimated = false;
        }
      } catch {
        // Keep the stable Runtime fallback when provider metadata is malformed.
      }
    }

    const contextSectionForKind = (
      kind: ContextSourceRef['kind'],
    ): ContextSnapshotSource['section'] => {
      if (kind === 'agent-instructions' || kind === 'skill-definition') return 'agent';
      if (kind === 'tool-schema') return 'tools';
      if (kind === 'message-excerpt') return 'messages';
      return 'project';
    };
    const toSnapshotSource = (
      source: ContextSourceRef,
      disposition: ContextSnapshotSource['disposition'],
    ): ContextSnapshotSource => {
      let content = contentBySourceId.get(source.id);
      let toolName: string | undefined;
      if (source.kind === 'skill-definition')
        content = skillPromptBySourceId.get(source.id) ?? content;
      if (source.kind === 'agent-instructions') content = 'You are';
      if (source.kind === 'message-excerpt') content = input.userText;
      if (source.kind === 'tool-schema') {
        const [, serverId, ...toolParts] = source.id.split(':');
        const rawToolName = toolParts.join(':');
        if (serverId && rawToolName) {
          toolName = `mcp__${serverId}__${rawToolName}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        }
      }
      return {
        id: source.id,
        kind: source.kind,
        section: contextSectionForKind(source.kind),
        disposition,
        ...(content ? { content } : {}),
        ...(toolName ? { toolName } : {}),
        tokens: disposition === 'included' ? source.tokenEstimate : 0,
      };
    };
    const contextSources: ContextSnapshotSource[] = [
      ...included.map((source) => toSnapshotSource(source, 'included')),
      ...built.packet.excludedSources.map((source) => toSnapshotSource(source, 'audit-only')),
    ];
    const projectContextPromptBlocks = contextSources
      .filter(
        (source) =>
          source.disposition === 'included' &&
          source.section === 'project' &&
          typeof source.content === 'string',
      )
      .map((source) => source.content!);

    const run = createDemoRun(input.runId, input.threadId, input.userText, {
      kernelId: input.kernelId,
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
      requestedSkillVersionIds,
      skillVersionIds: appliedSkillVersionIds,
      skillSnapshots: appliedSkills.map((skill) => ({
        skillVersionId: skill.skillVersionId,
        contentFingerprint: skill.contentFingerprint,
      })),
      mcpServerIds: effectiveMcpIds,
      contextWindow,
      contextWindowEstimated,
      projectContextPromptBlocks,
      contextSources,
      reasoningEffort,
      networkEnabled: input.networkEnabled === true ? true : undefined,
      planningMode: this.isPlanningModeForThread(input.threadId),
      images: input.images,
      packetId: built.packet.id,
      proofHash: built.packet.proofHash,
      useFakeProvider: useFake,
    });

    const effective = this.effectiveContextWindowForRun(run);
    run.effectiveContextWindow = effective.window;
    run.contextWindowSource = effective.source;
    // Pre-resolve the kernel session plan so run.started can report the
    // create/resume decision and the cross-kernel gap before the run executes.
    if (run.kernelId && run.kernelId !== 'native') {
      const planWorkspaceRoot = this.resolveChatWorkspaceRoot(run.threadId);
      const planBaseContext = this.buildKernelSystemContext(run, planWorkspaceRoot);
      const planResolution = this.resolveKernelConversationSession(
        run,
        run.kernelId,
        planWorkspaceRoot,
        planBaseContext,
      );
      run.kernelSessionPlan = {
        mode: planResolution.session?.mode ?? 'create',
        gapCount: planResolution.gapCount,
      };
    }

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
      requestedSkillVersionIds: [...requestedSkillVersionIds],
      skillVersionIds: [...appliedSkillVersionIds],
      mcpServerIds: [...effectiveMcpIds],
      policyId: agentMeta.policyId,
      agentVersion: agentMeta.agentVersion,
    };
  }

  private resolveSkillSelectionPolicy(input: {
    workspaceId: string;
    isAgentTrack: boolean;
    agentBoundSkillVersionIds: readonly string[];
    selectedSkillVersionIds?: readonly string[];
  }): {
    selectedSkillVersionIds: string[];
    agentDefaultSkillVersionIds: string[];
    composeSelectedSkillVersionIds: string[];
    allowlistedSkillVersionIds: string[];
  } {
    const selectedSkillVersionIds = [
      ...new Set(
        (input.selectedSkillVersionIds ?? []).map((skillVersionId) =>
          String(skillVersionId ?? '').trim(),
        ),
      ),
    ].filter(Boolean);
    const agentDefaultSkillVersionIds = input.isAgentTrack
      ? this.capabilityStore
        ? this.capabilityStore.resolveAgentSkillVersionIds(input.agentBoundSkillVersionIds)
        : [...new Set(input.agentBoundSkillVersionIds.map(String).filter(Boolean))]
      : [];
    const composeSelectedSkillVersionIds = this.capabilityStore
      ? this.capabilityStore.resolveComposeSkillVersionIds(
          input.workspaceId,
          selectedSkillVersionIds,
        )
      : [...selectedSkillVersionIds];
    const allowlistedSkillVersionIds = [
      ...new Set([...agentDefaultSkillVersionIds, ...composeSelectedSkillVersionIds]),
    ];
    return {
      selectedSkillVersionIds,
      agentDefaultSkillVersionIds,
      composeSelectedSkillVersionIds,
      allowlistedSkillVersionIds,
    };
  }

  private assertSelectedSkillsWithinEffectiveAllowlist(
    selectedSkillVersionIds: readonly string[] | undefined,
    effectiveAllowlist: readonly string[],
  ): void {
    if (!this.capabilityStore || selectedSkillVersionIds === undefined) return;
    const allowed = new Set(effectiveAllowlist);
    const denied = [...new Set(selectedSkillVersionIds.map(String))].find(
      (skillVersionId) => !allowed.has(skillVersionId),
    );
    if (denied) {
      throw new Error(`Skill version is not on the current Skill allowlist: ${denied}`);
    }
  }

  /**
   * After a model call failure:
   * 1) Same-provider priority chain �?walk *forward only* from the failed model
   *    (e.g. spare-1 �?spare-2, never back to primary).
   * 2) Agent-configured fallbackModelIds (§5.3).
   * Never silent-swaps models; pauses when both chains are empty or exhausted.
   */
  /** Merge fields into the in-memory run state (used by the in-place retry bookkeeping). */
  private updateDemoRun(runId: RunId, patch: Partial<DemoRunState>): void {
    const run = this.demoRuns.get(runId);
    if (!run) return;
    this.demoRuns.set(runId, { ...run, ...patch });
  }

  private publishModelRetryStatus(
    runId: RunId,
    retryCount: number,
    failureClass: FailureClass,
  ): void {
    this.updateDemoRun(runId, { retryCount });
    const currentRun = this.demoRuns.get(runId);
    if (!currentRun) return;
    const occurredAt = new Date().toISOString();
    const run = appendAssistantStatus(currentRun, {
      statusType: 'retry',
      label: `正在重试当前模型（${retryCount}/${MODEL_RETRY_MAX}）`,
      detail: failureClass,
      occurredAt,
    });
    this.demoRuns.set(runId, run);

    try {
      const event = this.persistProjectedEvent(
        {
          id: ulid() as Event['id'],
          workspaceId: this.resolveEventWorkspaceId(run.threadId),
          taskId: this.resolveEventTaskId(run.threadId),
          runId,
          category: 'run',
          type: 'run.retrying',
          occurredAt,
          payload: {
            threadId: run.threadId,
            attempt: retryCount,
            maxAttempts: MODEL_RETRY_MAX,
            modelId: run.modelId,
            providerModelId: run.providerModelId,
            failureClass,
            run: serializeDemoRun(run),
          },
        },
        new Map(this.demoRuns),
      );
      this.publishEvent(event);
    } catch (error) {
      console.warn('[runtime] model retry status could not be persisted', {
        runId,
        retryCount,
        error,
      });
    }
  }

  private sleepForModelRetry(runId: RunId, retryIndex: number): Promise<void> {
    const delayMs =
      this.modelRetryBaseDelayMs <= 0
        ? 0
        : Math.min(8_000, this.modelRetryBaseDelayMs * 2 ** retryIndex);
    const abort = this.demoRunAborts.get(runId);
    return new Promise((resolve) => {
      if (abort?.signal.aborted) {
        resolve();
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        abort?.signal.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      abort?.signal.addEventListener('abort', onAbort);
    });
  }

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
    const failedRecord = this.providerStore?.getModel(failedModelId);
    const providerFailureCounts = { ...(run.providerFailureCounts ?? {}) };
    const providerFailureCount = failedRecord
      ? (providerFailureCounts[failedRecord.providerId] ?? 0) + 1
      : 1;
    if (failedRecord) providerFailureCounts[failedRecord.providerId] = providerFailureCount;
    const failedRun: DemoRunState = {
      ...run,
      providerFailureCounts,
    };
    const attemptedModelIds = Array.from(
      new Set([...(failedRun.attemptedModelIds ?? []), failedRun.modelId]),
    ) as ModelId[];
    const skipSameProvider = shouldSkipSameProviderFallback(failureClass, providerFailureCount);

    // Layer 1: same-provider priority chain (forward-only from current model).
    if (this.providerStore && !skipSameProvider) {
      if (failedRecord) {
        const ordered = this.providerStore
          .listModels(failedRecord.providerId)
          .filter((model) =>
            isTextFallbackCompatibleModel({
              providerModelId: model.providerModelId,
              protocol: model.protocol,
              capabilities: model.capabilities,
            }),
          )
          .slice()
          .sort((a, b) => a.priority - b.priority);
        const providerNext = resolveProviderPriorityFallback({
          orderedModelIds: ordered.map((m) => m.id as ModelId),
          failedModelId,
          attemptedModelIds,
        });
        if (providerNext) {
          const nextRun = this.rebindRunToModel(
            failedRun,
            providerNext.modelId,
            'providerFallback',
          );
          return this.persistFallbackContinuation(runId, failedRun, nextRun, {
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
    const textCompatibleAgent = {
      ...agent,
      fallbackModelIds: agent.fallbackModelIds.filter((modelId) => {
        if (!this.providerStore) return true;
        const model = this.providerStore.getModel(modelId);
        return Boolean(
          model &&
          (!skipSameProvider || model.providerId !== failedRecord?.providerId) &&
          isTextFallbackCompatibleModel({
            providerModelId: model.providerModelId,
            protocol: model.protocol,
            capabilities: model.capabilities,
          }),
        );
      }),
    };
    const resolution = resolveModelBinding({
      agent: textCompatibleAgent,
      failedModelId,
      failureClass,
      attemptedModelIds,
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

    const nextRun = this.rebindRunToModel(failedRun, resolution.modelId, resolution.source);
    return this.persistFallbackContinuation(runId, failedRun, nextRun, {
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
  ): 'continued' | 'paused' | 'failed' {
    const currentRun = this.demoRuns.get(runId);
    if (currentRun?.modelId === nextRun.modelId && currentRun.packetId === nextRun.packetId) {
      return 'continued';
    }

    const alreadyAttempted = new Set([...(run.attemptedModelIds ?? []), run.modelId]);
    if (alreadyAttempted.has(nextRun.modelId)) {
      this.persistDemoRunPaused(runId, {
        reason: 'fallback_exhausted',
        failedModelId: run.modelId,
        failureClass: details.failureClass,
        errorMessage: details.scrubbedMessage,
      });
      return 'paused';
    }

    const occurredAt = new Date().toISOString();
    nextRun = appendAssistantStatus(nextRun, {
      statusType: 'model_switch',
      label: '已切换模型',
      detail: `${run.providerModelId || run.modelId} → ${nextRun.providerModelId || nextRun.modelId}`,
      occurredAt,
    });
    const projectedRuns = new Map(this.demoRuns);
    projectedRuns.set(runId, nextRun);

    try {
      // Build the fallback Manifest before persistence so the fallback selection and
      // its context packet enter SQLite as one all-or-nothing transition.
      const fallbackAgentMeta = this.resolveAgentManifestMeta(String(nextRun.agentVersionId));
      const fallbackContextSelection = this.buildProtectedContextSelection({
        runId,
        threadId: nextRun.threadId,
        userText: nextRun.userText,
        skillVersionIds: nextRun.skillVersionIds ?? [],
        mcpServerIds: nextRun.mcpServerIds ?? [],
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
      const committedEvents = this.persistProjectedEvents(
        [
          {
            id: ulid() as Event['id'],
            workspaceId: this.workspaceId,
            runId,
            category: 'run',
            type: 'run.fallback.selected',
            occurredAt,
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
              run: serializeDemoRun(nextRun),
            },
          },
          {
            id: ulid() as Event['id'],
            workspaceId: this.workspaceId,
            runId,
            category: 'context',
            type: 'context.packet.built',
            occurredAt,
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
              requestedSkillVersionIds: nextRun.requestedSkillVersionIds ?? [],
              skillVersionIds: nextRun.skillVersionIds ?? [],
              mcpServerIds: nextRun.mcpServerIds ?? [],
              policyId: fallbackAgentMeta.policyId,
              includedSourceIds: fallbackAmended.included.map((source) => source.id),
              excludedSourceIds: fallbackAmended.excluded.map((source) => source.id),
              includedSources: fallbackAmended.included.map((source) => ({
                id: source.id,
                kind: source.kind,
                tokenEstimate: source.tokenEstimate,
              })),
              excludedSources: fallbackAmended.excluded.map((source) => ({
                id: source.id,
                kind: source.kind,
                tokenEstimate: source.tokenEstimate,
              })),
              summaries: fallbackAmended.summaries,
              truncations: [
                ...fallbackContextSelection.skillTruncations,
                ...fallbackContextSelection.selected.truncations,
              ].map((truncation) => ({
                sourceId: truncation.sourceId,
                reason: truncation.reason,
                beforeTokens: truncation.beforeTokens,
                afterTokens: truncation.afterTokens,
              })),
              crossTaskRefs: fallbackContextSelection.crossTaskRefs ?? [],
              evidenceRefsForMemory: fallbackAmended.evidenceRefsForMemory,
              tokenEstimate: fallbackAmended.tokenEstimate,
            },
          },
        ],
        this.threadVersions,
        projectedRuns,
      );
      this.demoRuns.set(runId, nextRun);
      for (const event of committedEvents) this.publishEvent(event);
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
    // A fallback is still the same user-visible assistant turn. Preserve the
    // commentary that has already reached the user, but close its active
    // segment so commentary from the next model starts at a new boundary.
    const visibleRun = closeCommentaryTimelineSegment(run, new Date().toISOString());
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
      skillTruncations,
    } = this.buildProtectedContextSelection({
      runId: run.runId,
      threadId: run.threadId,
      userText: run.userText,
      skillVersionIds: run.skillVersionIds ?? [],
      mcpServerIds: run.mcpServerIds ?? [],
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
      truncations: [...skillTruncations, ...selected.truncations],
      summaries: protectedSummaries,
      crossTaskRefs: protectedCrossTaskRefs,
      evidenceRefsForMemory: protectedMemoryEvidenceRefs,
      skillVersionIds: (run.skillVersionIds ?? []) as never,
      policyVersion: rebindAgentMeta.policyVersion,
    });

    const reboundModelId = (modelRecord?.id ?? modelId) as string;
    return {
      ...visibleRun,
      modelId: reboundModelId,
      providerModelId: modelRecord?.providerModelId ?? modelId,
      protocol: modelRecord?.protocol ?? run.protocol,
      baseUrl: provider?.baseUrl ?? run.baseUrl,
      providerId: provider?.id,
      credentialRefId: credential?.id as string | undefined,
      credentialResolutionSource: credentialResolution.source,
      resolutionSource: source,
      attemptedModelIds: Array.from(
        new Set([...(run.attemptedModelIds ?? []), run.modelId, reboundModelId]),
      ),
      reasoningEffort: run.reasoningEffort,
      // Keep network + images on rebind so vision/web turns survive fallback walks.
      networkEnabled: run.networkEnabled === true ? true : undefined,
      images: run.images,
      packetId: built.packet.id,
      proofHash: built.packet.proofHash,
      nextAdapterEventIndex: 0,
      assistantText: '',
      commentaryText: visibleRun.commentaryText,
      commentarySegments: visibleRun.commentarySegments,
      legacyPendingText: '',
      reasoningText: '',
      reasoningSegments: [],
      // A fresh model gets a fresh retry budget.
      retryCount: 0,
      useFakeProvider: useFake,
    };
  }

  private persistDemoRunPaused(
    runId: RunId,
    details: {
      reason: 'no_fallback_configured' | 'fallback_exhausted' | 'recovery_expired';
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

  private resolveLatestCompactBoundary(
    threadId: string,
  ): { summaryText: string; compactedAt: string } | undefined {
    const cached = this.latestCompactByThread.get(threadId);
    if (cached) return cached;
    if (!this.stateStore) return undefined;
    const task = this.workspaceStore?.getTaskByThreadId(threadId as ThreadId);
    const events =
      task && this.stateStore.listEventsByTask
        ? this.stateStore.listEventsByTask(task.id)
        : this.stateStore.listAllEvents
          ? this.stateStore.listAllEvents(0)
          : this.stateStore.listEvents(this.workspaceId, 0);
    let latest: { summaryText: string; compactedAt: string; sequence: number } | undefined;
    for (const event of events) {
      if (event.type !== 'context.compacted' || event.payload.threadId !== threadId) continue;
      const summaryText =
        typeof event.payload.summaryText === 'string' ? event.payload.summaryText.trim() : '';
      if (!summaryText || (latest && latest.sequence >= event.sequence)) continue;
      latest = { summaryText, compactedAt: event.occurredAt, sequence: event.sequence };
    }
    if (!latest) return undefined;
    const value = { summaryText: latest.summaryText, compactedAt: latest.compactedAt };
    this.latestCompactByThread.set(threadId, value);
    return value;
  }

  private listDurableContextMessages(
    threadId: string,
    contextWindow: number,
    compact?: { compactedAt: string },
  ): Message[] {
    if (!this.messageStore) return [];
    const collected: Message[] = [];
    let beforeSequence: number | undefined;
    let roughTokens = 0;
    const compactedAtMs = compact ? Date.parse(compact.compactedAt) : Number.NaN;
    for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
      const page = this.messageStore.listMessages(threadId as ThreadId, {
        ...(beforeSequence !== undefined ? { beforeSequence } : {}),
        limit: 100,
      });
      collected.unshift(...page.messages);
      roughTokens += page.messages.reduce(
        (sum, message) => sum + Math.ceil(JSON.stringify(message.blocks).length / 4),
        0,
      );
      const crossedCompact =
        Number.isFinite(compactedAtMs) &&
        page.messages.some((message) => Date.parse(message.createdAt) <= compactedAtMs);
      if (!page.hasMore || crossedCompact || roughTokens >= contextWindow * 1.25) break;
      beforeSequence = page.nextCursor;
      if (beforeSequence === undefined) break;
    }
    return collected;
  }

  private buildChatProviderMessages(
    run: DemoRunState,
  ): import('@sync-think/adapters').ProviderMessage[] {
    const compact = this.resolveLatestCompactBoundary(run.threadId);
    const resolvedImages = run.images
      ?.map((image) => {
        const dataUrl = resolveAppendMessageImageDataUrl(image);
        return dataUrl ? { name: image.name, mimeType: image.mimeType, dataUrl } : undefined;
      })
      .filter((image): image is { name: string; mimeType: string; dataUrl: string } =>
        Boolean(image),
      );
    const effectiveWindow = run.effectiveContextWindow ?? run.contextWindow ?? 128_000;
    const durableMessages = this.listDurableContextMessages(run.threadId, effectiveWindow, compact);
    const built = buildProviderMessagesFromDurableMessages({
      messages: durableMessages,
      compact,
      currentUserText: run.userText,
      currentImages: resolvedImages,
      resolveImageDataUrl: (storageRef, mimeType) =>
        resolveHistoricalMessageImageDataUrl(storageRef, mimeType),
      toolTracesByRunId: this.collectInterruptedRunToolTraces(durableMessages),
    });
    // NewMax-style: the persisted task checklist is part of the model context
    // so the model can read back its own plan every turn (not just a UI
    // signal). Prefer the workspace-scoped persisted plan (TaskCreate/
    // TaskUpdate/TaskList); fall back to the event-extracted run plan for
    // conversations that still use update_task_plan.
    const persistedPlan = this.taskPlanStore
      ? this.taskPlanStore.list(this.resolveEventWorkspaceId(run.threadId), {
          statuses: ['pending', 'in_progress', 'completed'],
        })
      : [];
    if (persistedPlan.length > 0) {
      const plan: ModelTaskPlan = {
        items: persistedPlan.map((row) => ({
          title: row.title,
          status:
            row.status === 'in_progress' || row.status === 'completed'
              ? (row.status as 'in_progress' | 'completed')
              : 'pending',
        })),
        total: persistedPlan.length,
        completed: persistedPlan.filter((row) => row.status === 'completed').length,
      };
      built.messages.unshift({ role: 'system', content: formatTaskPlanForModel(plan) });
    } else {
      const taskPlan = extractLatestTaskPlanFromEvents(this.events, run.threadId);
      if (taskPlan) {
        built.messages.unshift({ role: 'system', content: formatTaskPlanForModel(taskPlan) });
      }
    }
    run.compactSummary = built.compactSummary;
    run.compactedAt = built.compactedAt;
    return selectRecentMessagesWithinBudget(
      built.messages,
      Math.max(1, Math.floor((run.effectiveContextWindow ?? run.contextWindow ?? 128_000) * 0.82)),
    );
  }

  /**
   * Restore the executed tool calls of previously interrupted (cancelled)
   * runs from durable events, so a follow-up "continue" message can pick up
   * the work with full context (NewMax-style session continuity). Only
   * cancelled assistant messages in the current context window are queried.
   */
  private collectInterruptedRunToolTraces(
    messages: readonly import('@sync-think/shared').Message[],
  ): ReadonlyMap<string, readonly InterruptedRunToolTrace[]> | undefined {
    const cancelledRunIds = new Set<string>();
    for (const message of messages) {
      if (message.role !== 'assistant' || !message.runId) continue;
      const cancelled = message.blocks.some(
        (block) =>
          block.type === 'error' &&
          block.payload !== undefined &&
          block.payload !== null &&
          typeof block.payload === 'object' &&
          (block.payload as { terminalState?: unknown }).terminalState === 'cancelled',
      );
      if (cancelled) cancelledRunIds.add(String(message.runId));
    }
    if (cancelledRunIds.size === 0 || !this.stateStore?.listEventsByRun) return undefined;

    const tracesByRunId = new Map<string, readonly InterruptedRunToolTrace[]>();
    for (const runId of cancelledRunIds) {
      const events = this.stateStore.listEventsByRun(runId as import('@sync-think/shared').RunId);
      const requestedByCallId = new Map<string, { name: string; argumentsText?: string }>();
      const traces: InterruptedRunToolTrace[] = [];
      for (const event of events) {
        if (event.category !== 'tool') continue;
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        if (event.type === 'tool.requested') {
          const callId = String(payload.toolCallId ?? '');
          let argumentsText = '';
          if (payload.arguments && typeof payload.arguments === 'object') {
            argumentsText = JSON.stringify(payload.arguments);
          } else if (payload.toolCall && typeof payload.toolCall === 'object') {
            argumentsText = String(
              (payload.toolCall as { argumentsJson?: unknown }).argumentsJson ?? '',
            );
          }
          requestedByCallId.set(callId, {
            name: String(payload.toolName ?? 'unknown'),
            argumentsText,
          });
        } else if (event.type === 'tool.completed' || event.type === 'tool.failed') {
          const callId = String(payload.toolCallId ?? '');
          const requested = requestedByCallId.get(callId);
          const resultText =
            typeof payload.result === 'string'
              ? payload.result
              : typeof payload.errorSummary === 'string'
                ? payload.errorSummary
                : undefined;
          traces.push({
            toolName: requested?.name ?? String(payload.toolName ?? 'unknown'),
            argumentsText: requested?.argumentsText,
            resultText,
            failed: event.type === 'tool.failed' || payload.failed === true,
          });
        }
      }
      if (traces.length > 0) tracesByRunId.set(runId, traces);
    }
    return tracesByRunId.size > 0 ? tracesByRunId : undefined;
  }

  /**
   * Chat-loop MCP dispatch (no orchestration step fence).
   * Bound servers only �?schemas were already filtered by run.mcpServerIds.
   */
  private resolveEffectiveMcpServerIds(
    workspaceId: string,
    boundIds: readonly string[] | undefined,
  ): string[] {
    if (!this.mcpStore) return [];
    if (this.capabilityStore) {
      return this.capabilityStore.resolveEffectiveMcpServerIds(workspaceId, boundIds ?? []);
    }
    return [...new Set((boundIds ?? []).map(String))].filter(
      (id) => this.mcpStore?.get(id)?.enabled === true,
    );
  }

  private executeChatMcpCatalogTool(run: DemoRunState): string {
    if (!this.mcpStore) {
      return JSON.stringify({
        ok: true,
        catalogState: 'store-unavailable',
        servers: [],
        serverCount: 0,
        toolCount: 0,
      });
    }
    const servers = (run.mcpServerIds ?? [])
      .map((id) => this.mcpStore?.get(id))
      .filter((server): server is NonNullable<typeof server> => Boolean(server?.enabled))
      .map((server) => ({
        mcpServerId: server.id,
        name: server.name,
        transport: server.transport,
        enabled: server.enabled,
        toolCount: server.tools.length,
        tools: server.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
      }));
    return JSON.stringify({
      ok: true,
      catalogState: servers.length > 0 ? 'ready' : 'no-enabled-servers',
      servers,
      serverCount: servers.length,
      toolCount: servers.reduce((total, server) => total + server.toolCount, 0),
    });
  }

  private async executeChatBoundMcpTool(input: {
    run: DemoRunState;
    mcpServerId: string;
    toolName: string;
    toolCallId: string;
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
    // The frozen Run allowlist is authoritative, including an explicitly empty list.
    if (!(input.run.mcpServerIds ?? []).includes(input.mcpServerId)) {
      return JSON.stringify({
        ok: false,
        error: `MCP server ${input.mcpServerId} is not on this Agent's allowlist`,
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
      });
    }
    const row = this.mcpStore.get(input.mcpServerId);
    if (!row) {
      this.recordMcpCallUsage(input, 'failed');
      return JSON.stringify({
        ok: false,
        error: `MCP server not found: ${input.mcpServerId}`,
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
      });
    }
    if (!row.enabled) {
      this.recordMcpCallUsage(input, 'failed');
      return JSON.stringify({
        ok: false,
        error: `MCP server is disabled: ${row.name}`,
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
      });
    }
    const registered = (row.tools ?? []).map((t) => t.name);
    if (registered.length > 0 && !registered.includes(input.toolName)) {
      this.recordMcpCallUsage(input, 'failed');
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
    if (row.transport === 'remote-http') {
      let remoteAuthKey: string | undefined;
      try {
        const auth = await this.retrieveMcpAuth(row.id);
        remoteAuthKey = auth?.key;
        const remote = await callRemoteMcpTool(row.endpoint, input.toolName, toolArguments, {
          auth: auth ? { key: auth.key, scheme: auth.authScheme } : undefined,
          signal: input.signal,
          timeoutMs: policy.timeoutMs,
          maxBytes: policy.maxOutputBytes,
        });
        const enforced = enforceMcpOutputLimit(remote.text, policy, {
          mcpServerId: input.mcpServerId,
          toolName: input.toolName,
          transport: row.transport,
          timedOut: false,
        });
        this.recordMcpCallUsage(input, remote.ok ? 'success' : 'failed');
        return JSON.stringify({
          ok: remote.ok,
          mcpServerId: input.mcpServerId,
          toolName: input.toolName,
          serverName: row.name,
          result: {
            remote: true,
            jsonRpcOk: true,
            contentTrust: enforced.contentTrust,
            truncated: enforced.truncated,
            rawBytes: enforced.rawBytes,
            keptBytes: enforced.keptBytes,
            preview: previewMcpOutput(enforced.text),
            toolResultText: enforced.text,
            auditNote: enforced.audit.note,
          },
        });
      } catch (error) {
        const failure = redactRemoteCapabilityError(error, remoteAuthKey ? [remoteAuthKey] : []);
        this.recordMcpCallUsage(input, input.signal?.aborted ? 'cancelled' : 'failed');
        return JSON.stringify({
          ok: false,
          error: failure,
          mcpServerId: input.mcpServerId,
          toolName: input.toolName,
          serverName: row.name,
          transport: 'remote-http',
        });
      }
    }
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
      this.recordMcpCallUsage(input, input.signal?.aborted ? 'cancelled' : 'failed');
      return JSON.stringify({
        ok: false,
        error: failMessage,
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
        serverName: row.name,
      });
    }
    this.recordMcpCallUsage(input, 'success');
    return JSON.stringify({
      ok: true,
      mcpServerId: input.mcpServerId,
      toolName: input.toolName,
      serverName: row.name,
      result: completedOut ?? {},
    });
  }

  private recordMcpCallUsage(
    input: {
      run: DemoRunState;
      mcpServerId: string;
      toolCallId: string;
    },
    outcome: 'success' | 'failed' | 'cancelled',
  ): void {
    const usageKey = `${input.run.runId}:mcp:${input.mcpServerId}:mcp-call:${input.toolCallId}`;
    this.appendCapabilityUsageOnce(usageKey, {
      capabilityType: 'mcp',
      capabilityId: input.mcpServerId,
      run: input.run,
      outcome,
    });
  }

  private appendCapabilityUsageOnce(
    usageKey: string,
    input: {
      capabilityType: 'skill' | 'mcp';
      capabilityId: string;
      run: DemoRunState;
      outcome: 'success' | 'failed' | 'cancelled';
      contextTokens?: number;
    },
  ): void {
    if (!this.capabilityStore || this.recordedCapabilityUsageKeys.has(usageKey)) return;
    this.capabilityStore.appendUsageEvent({
      id: usageKey,
      capabilityType: input.capabilityType,
      capabilityId: input.capabilityId,
      workspaceId: this.resolveEventWorkspaceId(input.run.threadId),
      agentId: input.run.globalAgentId,
      agentVersionId: input.run.agentVersionId,
      runId: input.run.runId,
      outcome: input.outcome,
      contextTokens: input.contextTokens,
    });
    this.recordedCapabilityUsageKeys.add(usageKey);
  }

  private recordProviderContextCapabilityUsage(run: DemoRunState, snapshot: ContextSnapshot): void {
    const includedSources = snapshot.sources.filter((source) => source.disposition === 'included');
    for (const skillVersionId of run.skillVersionIds ?? []) {
      const source = includedSources.find(
        (candidate) =>
          candidate.kind === 'skill-definition' && candidate.id === `skill:${skillVersionId}`,
      );
      if (!source) continue;
      this.appendCapabilityUsageOnce(`${run.runId}:skill:${skillVersionId}:skill-context`, {
        capabilityType: 'skill',
        capabilityId: skillVersionId,
        run,
        outcome: 'success',
        contextTokens: source.tokens,
      });
    }
    for (const mcpServerId of run.mcpServerIds ?? []) {
      const contextTokens = includedSources.reduce(
        (total, source) =>
          source.kind === 'tool-schema' && source.id.startsWith(`tool:${mcpServerId}:`)
            ? total + source.tokens
            : total,
        0,
      );
      if (contextTokens <= 0) continue;
      this.appendCapabilityUsageOnce(`${run.runId}:mcp:${mcpServerId}:mcp-schema`, {
        capabilityType: 'mcp',
        capabilityId: mcpServerId,
        run,
        outcome: 'success',
        contextTokens,
      });
    }
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

  private isComputerUsePluginEnabled(): boolean {
    return isComputerUsePluginSettingEnabled(
      this.appSettingStore?.get(COMPUTER_USE_PLUGIN_SETTING_KEY)?.value,
    );
  }

  /**
   * Converge the open gateway to the persisted setting. Called on boot and after
   * every `settings.set` touching the gateway key, so the listener follows the
   * switch and port without a restart.
   */
  private async syncOpenGatewayFromSettings(): Promise<void> {
    const setting = normalizeOpenGatewaySetting(
      this.appSettingStore?.get(OPEN_GATEWAY_SETTING_KEY)?.value,
    );
    await this.openGateway.applySetting(setting);
    // External CLI clients route by model name, which needs keys resolved ahead
    // of time because routing itself is synchronous.
    if (setting.enabled) await this.openGateway.warmExternalSecrets();
  }

  private handleGatewayStatus(socket: Socket, frame: Frame): void {
    const payload: OpenGatewayStatusResponse = this.openGateway.status();
    socket.write(encodeFrame({ id: frame.id, kind: 'response', type: 'gateway.status', payload }));
  }

  private handleGatewayLogs(socket: Socket, frame: Frame): void {
    const raw = frame.payload as
      | {
          offset?: unknown;
          limit?: unknown;
          filter?: { kernelId?: unknown; status?: unknown; converted?: unknown };
        }
      | undefined;
    const query: GatewayLogsQuery = {
      ...(raw && Number.isSafeInteger(raw.offset) ? { offset: raw.offset as number } : {}),
      ...(raw && Number.isSafeInteger(raw.limit) ? { limit: raw.limit as number } : {}),
      ...(raw?.filter
        ? {
            filter: {
              ...(typeof raw.filter.kernelId === 'string' && raw.filter.kernelId.length > 0
                ? { kernelId: raw.filter.kernelId }
                : {}),
              ...(raw.filter.status === 'success' || raw.filter.status === 'error'
                ? { status: raw.filter.status }
                : {}),
              ...(typeof raw.filter.converted === 'boolean'
                ? { converted: raw.filter.converted }
                : {}),
            },
          }
        : {}),
    };
    const payload: GatewayLogsResponse = this.openGateway.listLogs(query);
    socket.write(encodeFrame({ id: frame.id, kind: 'response', type: 'gateway.logs', payload }));
  }

  private handleGatewayLogsClear(socket: Socket, frame: Frame): void {
    this.openGateway.clearLogs();
    socket.write(
      encodeFrame({ id: frame.id, kind: 'response', type: 'gateway.logs.clear', payload: {} }),
    );
  }

  private resolveEventWorkspaceId(threadId: string): WorkspaceId {
    const task = this.workspaceStore?.getTaskByThreadId(threadId as ThreadId);
    return task?.workspaceId ?? this.workspaceId;
  }

  private resolveEventTaskId(threadId: string): TaskId | undefined {
    return this.workspaceStore?.getTaskByThreadId(threadId as ThreadId)?.id;
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
    snapshot?: { previousContent: string; previousTruncated?: boolean },
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
    const persistedResult = CHAT_BROWSER_TOOL_NAMES.has(toolCall.name)
      ? this.sanitizeBrowserResultForPersistence(resultText)
      : resultText;
    const persistedErrorSummary = errorSummary
      ? CHAT_BROWSER_TOOL_NAMES.has(toolCall.name)
        ? this.browserFailureSummaryFromPersistedResult(persistedResult)
        : this.scrubDiagnosticMessage(errorSummary)
      : undefined;
    const liveRun = this.demoRuns.get(runId);
    if (liveRun) {
      this.demoRuns.set(
        runId,
        completeAssistantTool(liveRun, {
          toolCallId: toolCall.id,
          output: persistedResult,
          failed,
          occurredAt: new Date().toISOString(),
        }),
      );
      // §工具实时显示：工具完成立即推最新 timeline（完成态实时映射）。
      this.pushKernelTimelineSnapshot(runId, threadId, new Date().toISOString());
    }
    const completedEvent = this.persistProjectedEvent(
      {
        id: ulid() as Event['id'],
        workspaceId: this.resolveEventWorkspaceId(threadId),
        taskId: this.resolveEventTaskId(threadId),
        runId,
        category: 'tool',
        type: 'tool.completed',
        occurredAt: new Date().toISOString(),
        payload: {
          threadId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: persistedResult,
          ...(failed ? { failed: true } : {}),
          ...(persistedErrorSummary ? { errorSummary: persistedErrorSummary } : {}),
          ...(snapshot && toolCall.name === 'write_file'
            ? {
                previousContent: snapshot.previousContent,
                ...(snapshot.previousTruncated ? { previousTruncated: true } : {}),
              }
            : {}),
        },
      },
      new Map(this.demoRuns),
    );
    this.publishEvent(completedEvent);
  }

  private sanitizeBrowserResultForPersistence(resultText: string): string {
    try {
      const parsed = JSON.parse(resultText) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return JSON.stringify({ ok: false, error: 'Malformed Browser Worker result.' });
      }
      const result = parsed as Record<string, unknown>;
      const sanitized: Record<string, unknown> = { ok: result.ok === true };
      for (const key of [
        'code',
        'failureClass',
        'profileId',
        'leaseId',
        'pageId',
        'matched',
        'relativePath',
        'absolutePath',
        'embedUrl',
      ]) {
        if (typeof result[key] === 'string' || typeof result[key] === 'boolean') {
          sanitized[key] = result[key];
        }
      }
      if (result.ok === true && typeof result.message === 'string') {
        sanitized.message = result.message;
      } else if (result.ok !== true) {
        sanitized.error = browserFailureMessage(result.code, result.failureClass);
      }
      if (typeof result.url === 'string') {
        try {
          const url = new URL(result.url);
          if (url.protocol === 'http:' || url.protocol === 'https:') {
            url.username = '';
            url.password = '';
            url.search = '';
            url.hash = '';
            sanitized.url = url.toString();
          }
        } catch {
          // Malformed or internal URLs are omitted from durable browser events.
        }
      }
      if (typeof result.text === 'string') sanitized.textChars = result.text.length;
      if (Array.isArray(result.links)) sanitized.linkCount = result.links.length;
      if (Array.isArray(result.buttons)) sanitized.buttonCount = result.buttons.length;
      if (Array.isArray(result.inputs)) sanitized.inputCount = result.inputs.length;
      return JSON.stringify(sanitized);
    } catch {
      return JSON.stringify({ ok: false, error: 'Malformed Browser Worker result.' });
    }
  }

  private browserFailureSummaryFromPersistedResult(resultText: string): string {
    try {
      const parsed = JSON.parse(resultText) as { error?: unknown };
      return typeof parsed.error === 'string' ? parsed.error : 'Browser action failed.';
    } catch {
      return 'Browser action failed.';
    }
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
          (skill) => !skill.archivedAt && this.skillStore?.isPermissionApproved(skill.id) === true,
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
    // non-archived agent name. Ambiguity or miss is a hard error �?never guess.
    const resolveAgentTarget = (
      raw: unknown,
    ):
      | { ok: true; agent: NonNullable<ReturnType<SqliteGlobalAgentStore['get']>> }
      | { ok: false; error: string } => {
      const ref = typeof raw === 'string' ? raw.trim() : '';
      if (!ref) {
        return {
          ok: false,
          error: 'agent is required: pass an exact agent id or unique agent name.',
        };
      }
      const byId = this.globalAgentStore!.get(ref);
      if (byId) return { ok: true, agent: byId };
      const matches = this.globalAgentStore!.list().filter(
        (a) => a.name.trim().toLowerCase() === ref.toLowerCase(),
      );
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

    // Accept an emoji / short decorative text (≤ 8 chars) or a small
    // data:image data URL (UI avatars are a few KB). Reject remote URLs (the
    // shell CSP blocks them anyway and they leak the model's browsing input)
    // and control characters.
    const resolveAgentAvatar = (
      raw: unknown,
    ): { ok: true; avatar?: string } | { ok: false; error: string } => {
      if (raw === undefined || raw === null) return { ok: true };
      if (typeof raw !== 'string') return { ok: false, error: 'avatar must be a string' };
      const trimmed = raw.trim();
      if (!trimmed) return { ok: true, avatar: '' };
      if (
        [...trimmed].some((char) => {
          const code = char.charCodeAt(0);
          return code <= 0x1f || code === 0x7f;
        })
      ) {
        return { ok: false, error: 'avatar contains control characters' };
      }
      if (trimmed.startsWith('data:image/')) {
        if (trimmed.length > 200_000) {
          return { ok: false, error: 'avatar data URL is too large (max ~200KB)' };
        }
        return { ok: true, avatar: trimmed };
      }
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return {
          ok: false,
          error:
            'avatar must be an emoji, short text, or a data:image URL (remote URLs are not allowed)',
        };
      }
      if (trimmed.length > 8) {
        return { ok: false, error: 'avatar text must be at most 8 characters' };
      }
      return { ok: true, avatar: trimmed };
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
        ['auto', 'off', 'low', 'medium', 'high'].includes(args.reasoningEffort)
          ? args.reasoningEffort
          : undefined;
      try {
        // Same validation as the UI path: �? skills, versions exist & approved.
        this.assertGlobalAgentSkillVersions(resolvedSkillIds);
        const avatarResult = resolveAgentAvatar(args.avatar);
        if (!avatarResult.ok) {
          return JSON.stringify({ ok: false, error: avatarResult.error });
        }
        const created = this.globalAgentStore.create({
          name,
          avatar: avatarResult.avatar,
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
              (a) => a.id !== current.id && a.name.trim().toLowerCase() === nextName!.toLowerCase(),
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
      if (nextPersona !== undefined && nextPersona !== current.persona)
        changedFields.push('persona');
      const nextDescription = typeof args.description === 'string' ? args.description : undefined;
      if (nextDescription !== undefined && nextDescription !== current.description) {
        changedFields.push('description');
      }
      const nextReasoningEffort =
        typeof args.reasoningEffort === 'string' &&
        ['auto', 'off', 'low', 'medium', 'high'].includes(args.reasoningEffort)
          ? args.reasoningEffort
          : undefined;
      if (nextReasoningEffort !== undefined && nextReasoningEffort !== current.reasoningEffort) {
        changedFields.push('reasoningEffort');
      }

      let nextAvatar: string | undefined;
      if (args.avatar !== undefined) {
        const avatarResult = resolveAgentAvatar(args.avatar);
        if (!avatarResult.ok) {
          return JSON.stringify({ ok: false, error: avatarResult.error });
        }
        nextAvatar = avatarResult.avatar;
        if (nextAvatar !== current.avatar) changedFields.push('avatar');
      }

      if (
        nextName === undefined &&
        nextModelId === undefined &&
        nextSkillIds === undefined &&
        nextPersona === undefined &&
        nextDescription === undefined &&
        nextReasoningEffort === undefined &&
        nextAvatar === undefined
      ) {
        return JSON.stringify({
          ok: false,
          error:
            'No fields to update. Pass at least one of name / avatar / persona / description / defaultModelId / skillIds / reasoningEffort.',
        });
      }

      try {
        // Same validation as the UI path: �? skills, versions exist & approved.
        this.assertGlobalAgentSkillVersions(nextSkillIds);
        const updated = this.globalAgentStore.update({
          agentId: current.id,
          name: nextName,
          avatar: nextAvatar,
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
   * Import parses text only �?scripts are never executed (§9.2).
   */
  private async executeChatSkillTool(input: {
    run: DemoRunState;
    toolCall: import('@sync-think/adapters').ProviderToolCall;
  }): Promise<string> {
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

    if (input.toolCall.name === 'import_remote_skill') {
      const url = typeof args.url === 'string' ? args.url.trim() : '';
      if (!url) return JSON.stringify({ ok: false, error: 'url is required' });
      try {
        const fetched = await fetchRemoteSkillMd(url);
        const parsed = parseSkillMd(fetched.skillMd);
        const imported = this.finishSkillImport(fetched.skillMd, parsed, {
          originType: 'market',
          originRef:
            typeof args.originRef === 'string' && args.originRef.trim()
              ? args.originRef.trim()
              : fetched.url,
          skillId:
            typeof args.skillId === 'string' && args.skillId.trim()
              ? args.skillId.trim()
              : undefined,
        });
        return JSON.stringify({
          ok: true,
          sourceUrl: fetched.url,
          fetchedBytes: fetched.fetchedBytes,
          skill: {
            skillVersionId: imported.skill.skillVersionId,
            skillId: imported.skill.skillId,
            name: imported.skill.name,
            version: imported.skill.version,
            allowedTools: imported.skill.allowedTools,
          },
          deduped: imported.deduped,
          requiresReapproval: Boolean(imported.reapprovalRequest),
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: redactRemoteCapabilityError(error),
        });
      }
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
        // update_skill on a name that doesn't exist yet is really a create �?        // surface that so the model can tell the user what actually happened.
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

  /** Chat-tool entry point for one-time remote MCP registration. */
  private async executeChatRemoteMcpTool(input: {
    run: DemoRunState;
    toolCall: import('@sync-think/adapters').ProviderToolCall;
  }): Promise<string> {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(input.toolCall.argumentsJson || '{}') as Record<string, unknown>;
    } catch {
      return JSON.stringify({ ok: false, error: 'Invalid tool arguments JSON' });
    }
    if (!this.mcpStore) {
      return JSON.stringify({ ok: false, error: 'MCP store is not configured on this Runtime.' });
    }
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    const endpointRaw = typeof args.endpoint === 'string' ? args.endpoint.trim() : '';
    if (!name || !endpointRaw) {
      return JSON.stringify({ ok: false, error: 'name and endpoint are required' });
    }
    let endpoint: string;
    try {
      endpoint = parseRemoteHttpUrl(endpointRaw).toString();
    } catch (error) {
      return JSON.stringify({ ok: false, error: redactRemoteCapabilityError(error) });
    }
    const allowedFields = new Set(['name', 'endpoint', 'trusted', 'discoverTools']);
    if (Object.keys(args).some((field) => !allowedFields.has(field))) {
      return JSON.stringify({
        ok: false,
        error: 'mcp.metadata-only',
        note: 'AI 只能登记名称、Endpoint 和可信标记。请让用户在能力中心的密码框配置 Key。',
      });
    }
    const existing = this.mcpStore
      .list(500)
      .find((row) => row.name === name && row.endpoint === endpoint);
    const record = this.mcpStore.register({
      id: existing?.id,
      name,
      transport: 'remote-http',
      endpoint,
      tools: existing?.tools,
      trusted: typeof args.trusted === 'boolean' ? args.trusted : existing?.trusted,
      maxOutputBytes: existing?.maxOutputBytes,
      timeoutMs: existing?.timeoutMs,
      notes: existing?.notes,
    });
    const authConfig = this.readMcpAuthConfig(record.id);
    const auth = {
      configured: Boolean(authConfig),
      authScheme: authConfig?.authScheme ?? 'bearer',
    };
    const summary = this.toMcpServerSummary(record);
    this.publishEvent(
      this.appendEvent('provider', 'mcp.registered', {
        mcpServerId: record.id,
        name: record.name,
        transport: record.transport,
        toolCount: record.tools.length,
        updated: Boolean(existing),
        remote: true,
        registeredVia: 'chat-tool',
        authConfigured: auth.configured,
        discovered: false,
        threadId: input.run.threadId,
      }),
    );
    return JSON.stringify({
      ok: true,
      server: {
        ...summary,
        authConfigured: auth.configured,
        authScheme: auth.authScheme,
      },
      updated: Boolean(existing),
      endpoint,
      authConfigured: auth.configured,
      discovered: false,
      note: auth.configured
        ? '远端 MCP 公开元数据已登记，现有 Key 保持不变。'
        : '远端 MCP 公开元数据已登记；请用户在「能力中心」的专用密码框配置 Key。',
    });
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
    // non-archived agent name. Ambiguity or miss is a hard error �?never guess.
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
      const matches = this.teamStore!.list().filter(
        (t) => t.name.trim().toLowerCase() === ref.toLowerCase(),
      );
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
      const strategy = args.strategy === 'parallel' ? ('parallel' as const) : ('serial' as const);
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
              (t) => t.id !== current.id && t.name.trim().toLowerCase() === nextName!.toLowerCase(),
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
          const finalRoster = nextMembers ?? current.members.map((m) => ({ agentId: m.agentId }));
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
      // this team �?historical chats would silently lose their team identity.
      if (this.conversationStore) {
        const referenced = this.conversationStore
          .list({ track: 'team', includeArchived: true })
          .filter((c) => c.targetRef === current.id && !c.archivedAt);
        if (referenced.length > 0) {
          return JSON.stringify({
            ok: false,
            error: `小队「${current.name}」仍有 ${referenced.length} 个对话引用，请先归档或删除这些对话后再删除小队。`,
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
   * collapses �?including cancel/abort paths that used to deny silently and
   * leave an orphan card that then failed with「没有待处理的工具批准请求�?
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
    approvalId?: string;
    chatMessages: import('@sync-think/adapters').ProviderMessage[];
    pendingToolCalls: import('@sync-think/adapters').ProviderToolCall[];
    currentIndex: number;
    completedResults: Array<{ toolCallId: string; content: string }>;
    toolLoopRound: number;
    toolCall: import('@sync-think/adapters').ProviderToolCall;
    approvalArguments?: Record<string, unknown>;
    approvalRisk?: { level: string; reasonCodes: string[]; humanOnlyAction?: string };
    signal: AbortSignal;
  }): Promise<{ decision: 'approve' | 'deny'; approvalId: string }> {
    const approvalId = input.approvalId ?? `tappr-${ulid()}`;
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
          arguments:
            input.approvalArguments ??
            (() => {
              try {
                return JSON.parse(input.toolCall.argumentsJson || '{}');
              } catch {
                return {};
              }
            })(),
          ...(input.approvalRisk ? { risk: input.approvalRisk } : {}),
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

    return new Promise<{ decision: 'approve' | 'deny'; approvalId: string }>((resolve) => {
      const onAbort = () => {
        // Only emit decided if the pending entry is still ours �?run.cancel
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
        resolve({ decision: 'deny', approvalId });
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
        resolve({ decision: 'deny', approvalId });
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
          resolve({ decision, approvalId });
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
        { threadId: string; runId: RunId; toolCallId?: string; toolName?: string } | undefined;
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
        // Already decided �?idempotent success so double-clicks don't error.
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

  /** Runtime-owned durable Desktop Worker path with user-input interruption fencing. */
  private async executeChatDesktopWorkerTool(input: {
    runId: RunId;
    threadId: string;
    toolCall: import('@sync-think/adapters').ProviderToolCall;
    workspaceRoot?: string;
    executionMode: string;
    approval?: { approvalId: string };
    signal: AbortSignal;
  }): Promise<string> {
    const capabilityEnabled = this.isComputerUsePluginEnabled();
    if (!this.desktopController) {
      return executeChatDesktopTool({
        workspaceRoot: input.workspaceRoot,
        toolCall: input.toolCall,
        capabilityEnabled,
        signal: input.signal,
      });
    }
    const requestId = `dsk-${ulid()}`;
    const result = await this.desktopController.execute({
      capabilityEnabled,
      toolName: input.toolCall.name,
      argumentsJson: input.toolCall.argumentsJson || '{}',
      executionMode: input.executionMode,
      approval: input.approval,
      workspaceId: this.resolveEventWorkspaceId(input.threadId),
      runId: input.runId,
      ownerId: input.threadId,
      idempotencyKey: `desktop:${input.runId}:${input.toolCall.id}`,
      capabilityToken: `desktop:${input.runId}:${input.toolCall.id}`,
      workspaceRoot: input.workspaceRoot,
      signal: input.signal,
      beforeStart: () => !input.signal.aborted && this.demoRuns.has(input.runId),
      beforeExecute: (intent) => {
        const event = this.persistProjectedEvent(
          {
            id: ulid() as Event['id'],
            workspaceId: this.resolveEventWorkspaceId(input.threadId),
            runId: input.runId,
            category: 'tool',
            type: 'desktop.command.started',
            occurredAt: new Date().toISOString(),
            payload: {
              requestId,
              threadId: input.threadId,
              runId: input.runId,
              toolCallId: input.toolCall.id,
              toolName: input.toolCall.name,
              action: intent.action.kind,
              risk: {
                level: intent.risk.level,
                reasonCodes: intent.risk.reasonCodes,
                ...(intent.risk.humanOnlyAction
                  ? { humanOnlyAction: intent.risk.humanOnlyAction }
                  : {}),
              },
              args: intent.eventArgs,
            },
          },
          new Map(this.demoRuns),
        );
        this.publishEvent(event);
      },
    });
    const waiting = parseDesktopWaitingResult(result);
    if (waiting) {
      const event = this.persistProjectedEvent(
        {
          id: ulid() as Event['id'],
          workspaceId: this.resolveEventWorkspaceId(input.threadId),
          runId: input.runId,
          category: 'tool',
          type: 'desktop.command.waiting_user',
          occurredAt: new Date().toISOString(),
          payload: {
            requestId,
            threadId: input.threadId,
            runId: input.runId,
            toolCallId: input.toolCall.id,
            toolName: input.toolCall.name,
            commandId: waiting.commandId,
            errorCode: waiting.code,
          },
        },
        new Map(this.demoRuns),
      );
      this.publishEvent(event);
    }
    return result;
  }

  /**
   * Execute a published Browser Automation Workflow via the replay runner.
   * Permission: the workflow's navigation origins must carry a workflow-scope
   * allow grant. When a grant is missing, the tool returns approval-required
   * (or, in full-access, records an auto grant) before any browser side effect.
   */
  private async executeChatBrowserWorkflowReplay(input: {
    runId: RunId;
    threadId: string;
    toolCall: import('@sync-think/adapters').ProviderToolCall;
    workspaceRoot?: string;
    executionMode?: string;
    signal: AbortSignal;
  }): Promise<string> {
    if (!this.browserWorkflowRunner || !this.browserWorkflowService) {
      return JSON.stringify({
        ok: false,
        code: 'browser.workflow-runner-unavailable',
        error: 'Browser Workflow replay is not configured on this Runtime.',
        failureClass: 'unknown',
      });
    }
    let parsed: { taskId?: unknown; variables?: unknown };
    try {
      parsed = JSON.parse(input.toolCall.argumentsJson || '{}') as {
        taskId?: unknown;
        variables?: unknown;
      };
    } catch {
      return JSON.stringify({
        ok: false,
        code: 'browser.workflow-invalid-arguments',
        error: 'browser_workflow_execute: arguments must be a JSON object.',
        failureClass: 'acceptance',
      });
    }
    const taskId = typeof parsed?.taskId === 'string' ? parsed.taskId.trim() : '';
    if (!taskId) {
      return JSON.stringify({
        ok: false,
        code: 'browser.workflow-task-id-required',
        error: 'browser_workflow_execute: taskId is required.',
        failureClass: 'acceptance',
      });
    }
    let variables: Record<string, string> | undefined;
    if (parsed.variables !== undefined) {
      if (!isPlainRecord(parsed.variables)) {
        return JSON.stringify({
          ok: false,
          code: 'browser.workflow-variables-invalid',
          error: 'browser_workflow_execute: variables must be an object of string values.',
          failureClass: 'acceptance',
        });
      }
      const normalized: Record<string, string> = {};
      for (const [name, value] of Object.entries(parsed.variables as Record<string, unknown>)) {
        if (typeof value !== 'string' || name.trim().length === 0) {
          return JSON.stringify({
            ok: false,
            code: 'browser.workflow-variables-invalid',
            error:
              'browser_workflow_execute: every variable must have a non-empty name and string value.',
            failureClass: 'acceptance',
          });
        }
        normalized[name] = value;
      }
      variables = normalized;
    }
    let workflow;
    try {
      workflow = this.browserWorkflowService.getWorkflow({ taskId });
    } catch (error) {
      return JSON.stringify({
        ok: false,
        code: 'browser.workflow-not-found',
        error: error instanceof Error ? error.message : 'Browser Workflow not found.',
        failureClass: 'unknown',
      });
    }
    if (!workflow.version) {
      return JSON.stringify({
        ok: false,
        code: 'browser.workflow-no-published-version',
        error:
          'This Browser Automation task has no published Version yet. Record it, submit for review, and approve it before executing.',
        failureClass: 'acceptance',
      });
    }
    const versionId = workflow.version.id;
    let permission;
    try {
      permission = this.browserWorkflowRunner.checkPermissions(versionId, taskId);
    } catch (error) {
      return JSON.stringify({
        ok: false,
        code:
          error instanceof BrowserWorkflowRunnerError
            ? error.code
            : 'browser.workflow-permission-failed',
        error: error instanceof Error ? error.message : 'Browser Workflow permission check failed.',
        failureClass: 'permission',
      });
    }
    if (!permission.allowed && permission.missingOrigins.length > 0) {
      const fullAccess = normalizeChatExecutionMode(input.executionMode) === 'full-access';
      if (!fullAccess) {
        return JSON.stringify({
          ok: false,
          code: 'browser.workflow-origin-grant-required',
          error: `This Workflow needs approval to navigate to: ${permission.missingOrigins.join(', ')}.`,
          missingOrigins: permission.missingOrigins,
          failureClass: 'permission',
        });
      }
      this.browserWorkflowRunner.recordApproval(
        taskId,
        permission.missingOrigins,
        `auto-full-access:workflow:${input.runId}:${input.toolCall.id}`,
      );
    }
    try {
      const result = await this.browserWorkflowRunner.replay({
        workflowVersionId: versionId,
        taskId,
        profileId: workflow.task.profileId,
        workspaceId: this.resolveEventWorkspaceId(input.threadId),
        ownerId: input.threadId,
        runId: input.runId,
        capabilityToken: `workflow:${input.runId}:${input.toolCall.id}`,
        signal: input.signal,
        ...(variables ? { variables } : {}),
      });
      return JSON.stringify(result);
    } catch (error) {
      const isVariablesError =
        error instanceof BrowserWorkflowRunnerError &&
        error.code === 'browser.workflow-variables-required';
      return JSON.stringify({
        ok: false,
        code:
          error instanceof BrowserWorkflowRunnerError
            ? error.code
            : 'browser.workflow-replay-failed',
        error: error instanceof Error ? error.message : 'Browser Workflow replay failed.',
        failureClass: error instanceof BrowserWorkflowRunnerError ? error.failureClass : 'unknown',
        ...(isVariablesError ? { missingVariables: true, askUser: true } : {}),
      });
    }
  }

  /** Runtime-owned Browser Worker path. Renderer receives only completed URLs for preview. */
  private async executeChatBrowserWorkerTool(input: {
    runId: RunId;
    threadId: string;
    toolCall: import('@sync-think/adapters').ProviderToolCall;
    workspaceRoot?: string;
    signal: AbortSignal;
    approval?: { approvalId: string };
  }): Promise<string> {
    if (!this.browserController) {
      return JSON.stringify({
        ok: false,
        code: 'browser.worker-unavailable',
        error: 'Browser Worker is not configured on this Runtime.',
        failureClass: 'unknown',
      });
    }
    const requestId = `brw-${ulid()}`;
    return this.browserController.execute({
      toolName: input.toolCall.name,
      argumentsJson: input.toolCall.argumentsJson || '{}',
      workspaceId: this.resolveEventWorkspaceId(input.threadId),
      runId: input.runId,
      ownerId: input.threadId,
      idempotencyKey: `browser:${input.runId}:${input.toolCall.id}`,
      capabilityToken: `browser:${input.runId}:${input.toolCall.id}`,
      workspaceRoot: input.workspaceRoot,
      signal: input.signal,
      approval: input.approval,
      beforeStart: () => !input.signal.aborted && this.demoRuns.has(input.runId),
      beforeExecute: (intent) => {
        const event = this.persistProjectedEvent(
          {
            id: ulid() as Event['id'],
            workspaceId: this.resolveEventWorkspaceId(input.threadId),
            runId: input.runId,
            category: 'tool',
            type: 'browser.command.started',
            occurredAt: new Date().toISOString(),
            payload: {
              requestId,
              threadId: input.threadId,
              runId: input.runId,
              toolCallId: input.toolCall.id,
              toolName: input.toolCall.name,
              profileId: intent.profileId,
              ownerId: intent.ownerId,
              action: intent.action.kind,
              args: intent.auditArgs,
              allowedOrigins: intent.allowedOrigins,
            },
          },
          new Map(this.demoRuns),
        );
        this.publishEvent(event);
      },
    });
  }

  private handleListWaitingDesktopCommands(socket: Socket, frame: Frame): void {
    const payload = parseListWaitingDesktopCommandsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.desktopController) {
      this.writeDesktopCommandQueryError(
        socket,
        frame,
        new Error('Desktop command persistence is not configured on this Runtime.'),
      );
      return;
    }
    try {
      const response: ListWaitingDesktopCommandsResponse = {
        commands: this.desktopController
          .listWaitingCommands(payload)
          .map((command) => this.toDesktopWaitingCommandSummary(command)),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'desktop.command.listWaiting',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeDesktopCommandQueryError(socket, frame, error);
    }
  }

  private handleContinueDesktopCommand(socket: Socket, frame: Frame): void {
    const payload = parseContinueDesktopCommandPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.desktopController) {
      this.writeDesktopCommandQueryError(
        socket,
        frame,
        new Error('Desktop command persistence is not configured on this Runtime.'),
      );
      return;
    }
    try {
      const command = this.desktopController.continueWaitingCommand(payload);
      this.publishDesktopCommandLifecycleEvent('desktop.command.continued', command, {
        replayed: command.replayed,
      });
      const response: ContinueDesktopCommandResponse = {
        status: 'continued',
        commandId: command.id,
        replayed: command.replayed,
        updatedAt: command.updatedAt,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'desktop.command.continue',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeDesktopCommandQueryError(socket, frame, error);
    }
  }

  private handleCancelDesktopCommand(socket: Socket, frame: Frame): void {
    const payload = parseCancelDesktopCommandPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.desktopController) {
      this.writeDesktopCommandQueryError(
        socket,
        frame,
        new Error('Desktop command persistence is not configured on this Runtime.'),
      );
      return;
    }
    try {
      const command = this.desktopController.cancelWaitingCommand(payload);
      this.publishDesktopCommandLifecycleEvent('desktop.command.cancelled', command, {
        replayed: command.replayed,
      });
      const response: CancelDesktopCommandResponse = {
        status: 'cancelled',
        commandId: command.id,
        replayed: command.replayed,
        updatedAt: command.updatedAt,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'desktop.command.cancel',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeDesktopCommandQueryError(socket, frame, error);
    }
  }

  private publishDesktopCommandLifecycleEvent(
    type: 'desktop.command.continued' | 'desktop.command.cancelled',
    command: DesktopCommandRecord,
    payload: Record<string, unknown>,
  ): void {
    const summary = this.toDesktopWaitingCommandSummary(command);
    const event = this.persistProjectedEvent(
      {
        id: ulid() as Event['id'],
        workspaceId: summary.workspaceId,
        ...(summary.taskId ? { taskId: summary.taskId } : {}),
        runId: summary.runId,
        category: 'tool',
        type,
        occurredAt: new Date().toISOString(),
        payload: {
          commandId: command.id,
          toolName: command.toolName,
          action: command.action,
          ...payload,
        },
      },
      new Map(this.demoRuns),
    );
    this.publishEvent(event);
  }

  private toDesktopWaitingCommandSummary(
    command: DesktopCommandRecord,
  ): DesktopWaitingCommandSummary {
    const ownerTask = this.workspaceStore?.getTaskByThreadId(command.ownerId as ThreadId);
    const run = ownerTask ? undefined : this.orchestrationStore?.getRun(command.runId as RunId);
    const runTask = run ? this.workspaceStore?.getTask(run.taskId) : undefined;
    const taskId =
      ownerTask?.workspaceId === command.workspaceId
        ? ownerTask.id
        : runTask?.workspaceId === command.workspaceId
          ? run?.taskId
          : undefined;
    const target = projectDesktopWaitingTarget(command.sanitizedArgs);
    const errorCode = command.errorCode ?? ErrorCode.DESKTOP_COMMAND_INSPECTION_REQUIRED;
    return {
      commandId: command.id,
      workspaceId: command.workspaceId as WorkspaceId,
      ...(taskId ? { taskId } : {}),
      runId: command.runId as RunId,
      toolName: command.toolName,
      action: command.action,
      ...(target ? { target } : {}),
      reason:
        errorCode === ErrorCode.DESKTOP_USER_INPUT_DETECTED
          ? 'user-input-detected'
          : errorCode === ErrorCode.DESKTOP_COMMAND_INSPECTION_REQUIRED
            ? 'restart-inspection'
            : 'attention-required',
      errorCode,
      status: 'waiting_user',
      canContinue: true,
      canCancel: true,
      createdAt: command.createdAt,
      updatedAt: command.updatedAt,
    };
  }

  private handleListBrowserProfiles(socket: Socket, frame: Frame): void {
    const payload = parseListBrowserProfilesPayload(frame.payload ?? {});
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserProfileService) {
      this.writeBrowserProfileCommandError(
        socket,
        frame,
        new RuntimeBrowserProfileError(
          'browser.profile_host_unavailable',
          'Browser Profile services are not configured on this Runtime.',
        ),
      );
      return;
    }
    try {
      const response: ListBrowserProfilesResponse = {
        profiles: this.browserProfileService.listProfiles(),
      };
      this.writeBrowserProfileResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserProfileCommandError(socket, frame, error);
    }
  }

  private handleCreateBrowserProfile(socket: Socket, frame: Frame): void {
    const payload = parseCreateBrowserProfilePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserProfileService) {
      this.writeBrowserProfileUnavailable(socket, frame);
      return;
    }
    try {
      const response: CreateBrowserProfileResponse = {
        profile: this.browserProfileService.createProfile(payload),
      };
      this.writeBrowserProfileResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserProfileCommandError(socket, frame, error);
    }
  }

  private handleRenameBrowserProfile(socket: Socket, frame: Frame): void {
    const payload = parseRenameBrowserProfilePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserProfileService) {
      this.writeBrowserProfileUnavailable(socket, frame);
      return;
    }
    try {
      const response: RenameBrowserProfileResponse = {
        profile: this.browserProfileService.renameProfile(payload),
      };
      this.writeBrowserProfileResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserProfileCommandError(socket, frame, error);
    }
  }

  private async handleDeleteBrowserProfile(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseDeleteBrowserProfilePayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserProfileService) {
      this.writeBrowserProfileUnavailable(socket, frame);
      return;
    }
    try {
      await this.browserProfileService.deleteProfile(payload);
      const response: DeleteBrowserProfileResponse = {
        profileId: payload.profileId,
        deleted: true,
      };
      this.writeBrowserProfileResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserProfileCommandError(socket, frame, error);
    }
  }

  private async handleListBrowserSiteSessions(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseListBrowserSiteSessionsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserProfileService) {
      this.writeBrowserProfileUnavailable(socket, frame);
      return;
    }
    try {
      const response: ListBrowserSiteSessionsResponse =
        await this.browserProfileService.listSiteSessions(payload);
      this.writeBrowserProfileResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserProfileCommandError(socket, frame, error);
    }
  }

  private async handleClearBrowserSiteSession(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseClearBrowserSiteSessionPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserProfileService) {
      this.writeBrowserProfileUnavailable(socket, frame);
      return;
    }
    try {
      const response: ClearBrowserSiteSessionResponse =
        await this.browserProfileService.clearSiteSession(payload);
      this.writeBrowserProfileResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserProfileCommandError(socket, frame, error);
    }
  }

  private writeBrowserProfileResponse(socket: Socket, frame: Frame, payload: unknown): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload,
      }),
    );
  }

  private writeBrowserProfileUnavailable(socket: Socket, frame: Frame): void {
    this.writeBrowserProfileCommandError(
      socket,
      frame,
      new RuntimeBrowserProfileError(
        'browser.profile_host_unavailable',
        'Browser Profile services are not configured on this Runtime.',
      ),
    );
  }

  private writeBrowserProfileCommandError(socket: Socket, frame: Frame, error: unknown): void {
    const rawCode =
      error instanceof RuntimeBrowserProfileError
        ? error.code
        : error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : error instanceof Error
            ? error.message.split(':', 1)[0]
            : undefined;
    const codeByInternalCode: Record<string, (typeof ErrorCode)[keyof typeof ErrorCode]> = {
      'browser.profile_not_found': ErrorCode.BROWSER_PROFILE_NOT_FOUND,
      'browser.profile-not-found': ErrorCode.BROWSER_PROFILE_NOT_FOUND,
      'browser.profile_in_use': ErrorCode.BROWSER_PROFILE_IN_USE,
      'browser.profile-in-use': ErrorCode.BROWSER_PROFILE_IN_USE,
      'browser.profile_has_workflows': ErrorCode.BROWSER_PROFILE_HAS_WORKFLOWS,
      'browser.profile-has-workflows': ErrorCode.BROWSER_PROFILE_HAS_WORKFLOWS,
      'browser.profile_revision_conflict': ErrorCode.BROWSER_PROFILE_REVISION_CONFLICT,
      'browser.default_profile_immutable': ErrorCode.BROWSER_DEFAULT_PROFILE_IMMUTABLE,
      'browser.default-profile-immutable': ErrorCode.BROWSER_DEFAULT_PROFILE_IMMUTABLE,
      'browser.site_session_not_found': ErrorCode.BROWSER_SITE_SESSION_NOT_FOUND,
      'browser.profile_host_unavailable': ErrorCode.BROWSER_PROFILE_HOST_UNAVAILABLE,
      'browser.profile-site-data-unsupported': ErrorCode.BROWSER_PROFILE_HOST_UNAVAILABLE,
      'browser.profile-site-clear-unsupported': ErrorCode.BROWSER_PROFILE_HOST_UNAVAILABLE,
      'browser.profile_delete_unsupported': ErrorCode.BROWSER_PROFILE_HOST_UNAVAILABLE,
    };
    const code =
      (rawCode ? codeByInternalCode[rawCode] : undefined) ??
      ErrorCode.BROWSER_PROFILE_OPERATION_FAILED;
    const message = error instanceof Error ? error.message : 'Browser Profile command failed.';
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code,
          message: message
            .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
            .replace(/Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, 'Bearer [REDACTED]'),
        },
      }),
    );
  }

  private handleListBrowserRecordings(socket: Socket, frame: Frame): void {
    const payload = parseListBrowserRecordingsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserRecordingService) {
      this.writeBrowserRecordingUnavailable(socket, frame);
      return;
    }
    try {
      const response: ListBrowserRecordingsResponse = {
        recordings: this.browserRecordingService.listRecordings(payload),
      };
      this.writeBrowserRecordingResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserRecordingCommandError(socket, frame, error);
    }
  }

  private async handleGetBrowserRecording(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseGetBrowserRecordingPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserRecordingService) {
      this.writeBrowserRecordingUnavailable(socket, frame);
      return;
    }
    try {
      const response: GetBrowserRecordingResponse =
        await this.browserRecordingService.getRecording(payload);
      this.writeBrowserRecordingResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserRecordingCommandError(socket, frame, error);
    }
  }

  private async handleStartBrowserRecording(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseStartBrowserRecordingPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserRecordingService) {
      this.writeBrowserRecordingUnavailable(socket, frame);
      return;
    }
    try {
      const response: StartBrowserRecordingResponse = {
        recording: await this.browserRecordingService.startRecording(payload),
      };
      this.writeBrowserRecordingResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserRecordingCommandError(socket, frame, error);
    }
  }

  private async handleStopBrowserRecording(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseStopBrowserRecordingPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserRecordingService) {
      this.writeBrowserRecordingUnavailable(socket, frame);
      return;
    }
    try {
      const response: StopBrowserRecordingResponse = {
        recording: await this.browserRecordingService.stopRecording(payload),
      };
      this.writeBrowserRecordingResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserRecordingCommandError(socket, frame, error);
    }
  }

  private writeBrowserRecordingResponse(socket: Socket, frame: Frame, payload: unknown): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload,
      }),
    );
  }

  private writeBrowserRecordingUnavailable(socket: Socket, frame: Frame): void {
    this.writeBrowserRecordingCommandError(
      socket,
      frame,
      new RuntimeBrowserRecordingError(
        'browser.recording-host-unavailable',
        'Browser recording is not configured on this Runtime.',
      ),
    );
  }

  private writeBrowserRecordingCommandError(socket: Socket, frame: Frame, error: unknown): void {
    const rawCode = browserRecordingErrorCode(error);
    const codeByInternalCode: Record<string, (typeof ErrorCode)[keyof typeof ErrorCode]> = {
      'browser.recording-not-found': ErrorCode.BROWSER_RECORDING_NOT_FOUND,
      'browser.recording_not_found': ErrorCode.BROWSER_RECORDING_NOT_FOUND,
      'browser.profile_not_found': ErrorCode.BROWSER_PROFILE_NOT_FOUND,
      'browser.profile-not-found': ErrorCode.BROWSER_PROFILE_NOT_FOUND,
      'browser.profile_in_use': ErrorCode.BROWSER_PROFILE_IN_USE,
      'browser.profile-in-use': ErrorCode.BROWSER_PROFILE_IN_USE,
      'browser.recording_profile_in_use': ErrorCode.BROWSER_PROFILE_IN_USE,
      'browser.profile_revision_conflict': ErrorCode.BROWSER_PROFILE_REVISION_CONFLICT,
      'browser.profile-revision-conflict': ErrorCode.BROWSER_PROFILE_REVISION_CONFLICT,
      'browser.recording-host-unavailable': ErrorCode.BROWSER_RECORDING_HOST_UNAVAILABLE,
      'browser.recording-unsupported': ErrorCode.BROWSER_RECORDING_HOST_UNAVAILABLE,
      'browser.recording_id_conflict': ErrorCode.BROWSER_RECORDING_CONFLICT,
      'browser.recording_state_conflict': ErrorCode.BROWSER_RECORDING_CONFLICT,
      'browser.recording-already-started': ErrorCode.BROWSER_RECORDING_CONFLICT,
    };
    const code =
      (rawCode ? codeByInternalCode[rawCode] : undefined) ??
      ErrorCode.BROWSER_RECORDING_OPERATION_FAILED;
    const message = error instanceof Error ? error.message : 'Browser recording command failed.';
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code,
          message: message
            .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
            .replace(/Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, 'Bearer [REDACTED]'),
        },
      }),
    );
  }

  private handleListBrowserWorkflows(socket: Socket, frame: Frame): void {
    const payload = parseListBrowserWorkflowsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserWorkflowService) {
      this.writeBrowserWorkflowUnavailable(socket, frame);
      return;
    }
    try {
      const response: ListBrowserWorkflowsResponse = {
        tasks: this.browserWorkflowService.listWorkflows(payload),
      };
      this.writeBrowserWorkflowResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserWorkflowCommandError(socket, frame, error);
    }
  }

  private handleGetBrowserWorkflow(socket: Socket, frame: Frame): void {
    const payload = parseGetBrowserWorkflowPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserWorkflowService) {
      this.writeBrowserWorkflowUnavailable(socket, frame);
      return;
    }
    try {
      const response: GetBrowserWorkflowResponse = this.browserWorkflowService.getWorkflow(payload);
      this.writeBrowserWorkflowResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserWorkflowCommandError(socket, frame, error);
    }
  }

  private handleCreateBrowserWorkflowDraft(socket: Socket, frame: Frame): void {
    const payload = parseCreateBrowserWorkflowDraftPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserWorkflowService) {
      this.writeBrowserWorkflowUnavailable(socket, frame);
      return;
    }
    try {
      const response: CreateBrowserWorkflowDraftResponse =
        this.browserWorkflowService.createDraft(payload);
      this.writeBrowserWorkflowResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserWorkflowCommandError(socket, frame, error);
    }
  }

  private handleCreateBrowserWorkflowRevisionDraft(socket: Socket, frame: Frame): void {
    const payload = parseCreateBrowserWorkflowRevisionDraftPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserWorkflowService) {
      this.writeBrowserWorkflowUnavailable(socket, frame);
      return;
    }
    try {
      const response: CreateBrowserWorkflowRevisionDraftResponse =
        this.browserWorkflowService.createRevisionDraft(payload);
      this.writeBrowserWorkflowResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserWorkflowCommandError(socket, frame, error);
    }
  }

  private handleSubmitBrowserWorkflowDraft(socket: Socket, frame: Frame): void {
    const payload = parseSubmitBrowserWorkflowDraftPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserWorkflowService) {
      this.writeBrowserWorkflowUnavailable(socket, frame);
      return;
    }
    try {
      const response: SubmitBrowserWorkflowDraftResponse =
        this.browserWorkflowService.submitDraft(payload);
      this.writeBrowserWorkflowResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserWorkflowCommandError(socket, frame, error);
    }
  }

  private handleReviewBrowserWorkflowDraft(socket: Socket, frame: Frame): void {
    const payload = parseReviewBrowserWorkflowDraftPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserWorkflowService) {
      this.writeBrowserWorkflowUnavailable(socket, frame);
      return;
    }
    try {
      const response: ReviewBrowserWorkflowDraftResponse =
        this.browserWorkflowService.reviewDraft(payload);
      this.writeBrowserWorkflowResponse(socket, frame, response);
    } catch (error) {
      this.writeBrowserWorkflowCommandError(socket, frame, error);
    }
  }

  private async handleExecuteBrowserWorkflow(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseExecuteBrowserWorkflowPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserWorkflowService || !this.browserWorkflowRunner) {
      this.writeBrowserWorkflowUnavailable(socket, frame);
      return;
    }
    try {
      let workflow;
      try {
        workflow = this.browserWorkflowService.getWorkflow({ taskId: payload.taskId });
      } catch {
        this.writeBrowserWorkflowResponse(socket, frame, {
          ok: false,
          taskId: payload.taskId,
          stepCount: 0,
          executedStepCount: 0,
          steps: [],
          errorCode: 'browser.workflow-not-found',
          error: 'Browser Workflow not found.',
        } satisfies ExecuteBrowserWorkflowResponse);
        return;
      }
      if (!workflow.version) {
        this.writeBrowserWorkflowResponse(socket, frame, {
          ok: false,
          taskId: payload.taskId,
          stepCount: 0,
          executedStepCount: 0,
          steps: [],
          errorCode: 'browser.workflow-no-published-version',
          error:
            'This Browser Automation task has no published Version yet. Record it, submit for review, and approve it before executing.',
        } satisfies ExecuteBrowserWorkflowResponse);
        return;
      }
      const versionId = workflow.version.id;
      const taskId = workflow.task.id;
      const profileId = workflow.task.profileId;
      const workspaceId = this.workspaceId;
      const ownerId = `workflow-execute:${taskId}`;
      const signal = new AbortController().signal;
      try {
        // Pre-flight permission check: refuse to open the browser when any
        // navigation origin lacks a workflow-scope allow grant. Report the
        // missing origins so the UI can offer an explicit "approve & execute".
        const permission = this.browserWorkflowRunner.checkPermissions(versionId, taskId);
        if (!permission.allowed && permission.missingOrigins.length > 0) {
          this.writeBrowserWorkflowResponse(socket, frame, {
            ok: false,
            taskId,
            stepCount: 0,
            executedStepCount: 0,
            steps: [],
            missingOrigins: permission.missingOrigins,
            errorCode: 'browser.workflow-origin-grant-required',
            error: `This Workflow needs approval to navigate to: ${permission.missingOrigins.join(', ')}.`,
          } satisfies ExecuteBrowserWorkflowResponse);
          return;
        }
        const result = await this.browserWorkflowRunner.replay({
          workflowVersionId: versionId,
          taskId,
          profileId,
          workspaceId,
          ownerId,
          capabilityToken: `workflow-execute:${taskId}:${frame.id}`,
          signal,
          ...(payload.variables ? { variables: payload.variables } : {}),
        });
        this.writeBrowserWorkflowResponse(socket, frame, {
          ok: result.ok,
          taskId,
          ...(result.ok ? { versionId, profileId } : {}),
          stepCount: result.stepCount,
          executedStepCount: result.executedStepCount,
          steps: result.steps.map((step) => ({
            sequence: step.sequence,
            ok: step.ok,
            ...(step.actionKind ? { actionKind: step.actionKind } : {}),
            ...(step.outputUrl ? { outputUrl: step.outputUrl } : {}),
            ...(step.outputTitle ? { outputTitle: step.outputTitle } : {}),
            ...(step.errorCode ? { errorCode: step.errorCode } : {}),
            ...(step.error ? { error: step.error } : {}),
          })),
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
          ...(result.error ? { error: result.error } : {}),
        } satisfies ExecuteBrowserWorkflowResponse);
      } catch (error) {
        const isVariables =
          error instanceof BrowserWorkflowRunnerError &&
          error.code === 'browser.workflow-variables-required';
        this.writeBrowserWorkflowResponse(socket, frame, {
          ok: false,
          taskId,
          stepCount: 0,
          executedStepCount: 0,
          steps: [],
          ...(isVariables ? { missingVariables: extractMissingVariables(error) } : {}),
          errorCode:
            error instanceof BrowserWorkflowRunnerError
              ? error.code
              : 'browser.workflow-replay-failed',
          error: error instanceof Error ? error.message : 'Browser Workflow replay failed.',
        } satisfies ExecuteBrowserWorkflowResponse);
      }
    } catch (error) {
      this.writeBrowserWorkflowCommandError(socket, frame, error);
    }
  }

  /**
   * Approve the listed origins for the workflow's navigate scope and then run
   * the replay. This is the "approve & execute" path used by the workflow
   * panel: the user explicitly granted these origins, so we record the grant
   * and immediately continue into the same replay pipeline as plain execute.
   */
  private async handleApproveExecuteBrowserWorkflow(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseApproveExecuteBrowserWorkflowPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserWorkflowService || !this.browserWorkflowRunner) {
      this.writeBrowserWorkflowUnavailable(socket, frame);
      return;
    }
    try {
      let workflow;
      try {
        workflow = this.browserWorkflowService.getWorkflow({ taskId: payload.taskId });
      } catch {
        this.writeBrowserWorkflowResponse(socket, frame, {
          ok: false,
          taskId: payload.taskId,
          stepCount: 0,
          executedStepCount: 0,
          steps: [],
          errorCode: 'browser.workflow-not-found',
          error: 'Browser Workflow not found.',
        } satisfies ExecuteBrowserWorkflowResponse);
        return;
      }
      if (!workflow.version) {
        this.writeBrowserWorkflowResponse(socket, frame, {
          ok: false,
          taskId: payload.taskId,
          stepCount: 0,
          executedStepCount: 0,
          steps: [],
          errorCode: 'browser.workflow-no-published-version',
          error:
            'This Browser Automation task has no published Version yet. Record it, submit for review, and approve it before executing.',
        } satisfies ExecuteBrowserWorkflowResponse);
        return;
      }
      const versionId = workflow.version.id;
      const taskId = workflow.task.id;
      const profileId = workflow.task.profileId;
      const workspaceId = this.workspaceId;
      const ownerId = `workflow-execute:${taskId}`;
      const signal = new AbortController().signal;

      // Validate the approved origins are a subset of the workflow's actual
      // navigation origins; approving a foreign origin must be ignored.
      const permission = this.browserWorkflowRunner.checkPermissions(versionId, taskId);
      const allowedOrigins = new Set(permission.origins);
      const validApprovals = payload.origins.filter((origin) => allowedOrigins.has(origin));
      if (validApprovals.length > 0) {
        this.browserWorkflowRunner.recordApproval(
          taskId,
          validApprovals,
          `workflow-panel-approve:${frame.id}`,
        );
      }
      try {
        const result = await this.browserWorkflowRunner.replay({
          workflowVersionId: versionId,
          taskId,
          profileId,
          workspaceId,
          ownerId,
          capabilityToken: `workflow-approve-execute:${taskId}:${frame.id}`,
          signal,
          ...(payload.variables ? { variables: payload.variables } : {}),
        });
        this.writeBrowserWorkflowResponse(socket, frame, {
          ok: result.ok,
          taskId,
          ...(result.ok ? { versionId, profileId } : {}),
          stepCount: result.stepCount,
          executedStepCount: result.executedStepCount,
          steps: result.steps.map((step) => ({
            sequence: step.sequence,
            ok: step.ok,
            ...(step.actionKind ? { actionKind: step.actionKind } : {}),
            ...(step.outputUrl ? { outputUrl: step.outputUrl } : {}),
            ...(step.outputTitle ? { outputTitle: step.outputTitle } : {}),
            ...(step.errorCode ? { errorCode: step.errorCode } : {}),
            ...(step.error ? { error: step.error } : {}),
          })),
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
          ...(result.error ? { error: result.error } : {}),
        } satisfies ExecuteBrowserWorkflowResponse);
      } catch (error) {
        const isVariables =
          error instanceof BrowserWorkflowRunnerError &&
          error.code === 'browser.workflow-variables-required';
        this.writeBrowserWorkflowResponse(socket, frame, {
          ok: false,
          taskId,
          stepCount: 0,
          executedStepCount: 0,
          steps: [],
          ...(isVariables ? { missingVariables: extractMissingVariables(error) } : {}),
          errorCode:
            error instanceof BrowserWorkflowRunnerError
              ? error.code
              : 'browser.workflow-replay-failed',
          error: error instanceof Error ? error.message : 'Browser Workflow replay failed.',
        } satisfies ExecuteBrowserWorkflowResponse);
      }
    } catch (error) {
      this.writeBrowserWorkflowCommandError(socket, frame, error);
    }
  }

  private writeBrowserWorkflowResponse(socket: Socket, frame: Frame, payload: unknown): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload,
      }),
    );
  }

  private writeBrowserWorkflowUnavailable(socket: Socket, frame: Frame): void {
    this.writeBrowserWorkflowCommandError(
      socket,
      frame,
      new RuntimeBrowserWorkflowError(
        'browser.workflow-unavailable',
        'Browser workflow storage is not configured on this Runtime.',
      ),
    );
  }

  private writeBrowserWorkflowCommandError(socket: Socket, frame: Frame, error: unknown): void {
    const rawCode = browserWorkflowErrorCode(error);
    const codeByInternalCode: Record<string, (typeof ErrorCode)[keyof typeof ErrorCode]> = {
      'browser.workflow-not-found': ErrorCode.BROWSER_WORKFLOW_NOT_FOUND,
      'browser.workflow_not_found': ErrorCode.BROWSER_WORKFLOW_NOT_FOUND,
      'browser.task_not_found': ErrorCode.BROWSER_WORKFLOW_NOT_FOUND,
      'browser.workflow_draft_not_found': ErrorCode.BROWSER_WORKFLOW_NOT_FOUND,
      'browser.workflow_version_not_found': ErrorCode.BROWSER_WORKFLOW_NOT_FOUND,
      'browser.recording_not_found': ErrorCode.BROWSER_RECORDING_NOT_FOUND,
      'browser.profile_not_found': ErrorCode.BROWSER_PROFILE_NOT_FOUND,
      'browser.workflow-conflict': ErrorCode.BROWSER_WORKFLOW_CONFLICT,
      'browser.workflow_draft_state_conflict': ErrorCode.BROWSER_WORKFLOW_CONFLICT,
      'browser.workflow_recording_mismatch': ErrorCode.BROWSER_WORKFLOW_CONFLICT,
      'browser.workflow_recording_profile_mismatch': ErrorCode.BROWSER_WORKFLOW_CONFLICT,
      'browser.workflow_recording_not_stopped': ErrorCode.BROWSER_WORKFLOW_CONFLICT,
      'browser.workflow_steps_empty': ErrorCode.BROWSER_WORKFLOW_CONFLICT,
      'browser.task_revision_conflict': ErrorCode.BROWSER_WORKFLOW_CONFLICT,
    };
    const code =
      (rawCode ? codeByInternalCode[rawCode] : undefined) ??
      ErrorCode.BROWSER_WORKFLOW_OPERATION_FAILED;
    const message = error instanceof Error ? error.message : 'Browser workflow command failed.';
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code,
          message: message
            .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
            .replace(/Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, 'Bearer [REDACTED]'),
        },
      }),
    );
  }

  private handleListWaitingBrowserHandoffs(socket: Socket, frame: Frame): void {
    const payload = parseListWaitingBrowserHandoffsPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    if (!this.browserController) {
      this.writeBrowserHandoffUnavailable(socket, frame);
      return;
    }
    try {
      const response: ListWaitingBrowserHandoffsResponse = {
        handoffs: this.browserController.listWaitingHandoffs(payload).map((handoff) => {
          const run = this.orchestrationStore?.getRun(handoff.runId as RunId);
          const task = run ? this.workspaceStore?.getTask(run.taskId) : undefined;
          const taskId = task?.workspaceId === handoff.workspaceId ? run?.taskId : undefined;
          return {
            handoffId: handoff.handoffId,
            revision: handoff.revision,
            workspaceId: handoff.workspaceId as WorkspaceId,
            ...(taskId ? { taskId } : {}),
            runId: handoff.runId as RunId,
            ...(handoff.stepId ? { stepId: handoff.stepId as StepId } : {}),
            ...(handoff.agentVersionId
              ? { agentVersionId: handoff.agentVersionId as AgentVersionId }
              : {}),
            siteOrigin: handoff.siteOrigin,
            reason: handoff.reason,
            requestedOutcome: handoff.requestedOutcome,
            onCancel: handoff.onCancel,
            status: handoff.status,
            createdAt: handoff.createdAt,
            updatedAt: handoff.updatedAt,
            canContinue: handoff.canContinue,
            canCancel: handoff.canCancel,
          };
        }),
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'browser.handoff.listWaiting',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeBrowserHandoffCommandError(socket, frame, error);
    }
  }

  private async handleContinueBrowserHandoff(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseContinueBrowserHandoffPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    try {
      const binding = this.resolveBrowserHandoffBinding(payload.handoffId, 'approved');
      const handoffDecision = await this.browserController!.continueHandoff(payload);
      if (binding.handoff.reason === 'login' && this.browserProfileService) {
        try {
          this.browserProfileService.markLoginVerified({
            profileId: binding.handoff.profileId,
            origin: binding.handoff.siteOrigin,
          });
        } catch (error) {
          throw new RuntimeBrowserHandoffError(
            'browser.profile-operation-failed',
            error instanceof Error ? error.message : 'Browser login verification failed.',
          );
        }
      }
      const approvalDecision = this.scheduler!.decideApproval({
        approvalId: binding.approval.id,
        decision: 'approved',
        decidedBy: 'human',
      });
      this.syncOrchestrationEvents();
      this.publishBrowserHandoffLifecycleEvent(
        'browser.handoff.continued',
        binding.handoff,
        approvalDecision.graph.run.taskId,
        {
          approvalId: binding.approval.id,
          replayed: handoffDecision.replayed || approvalDecision.replayed,
        },
      );
      this.scheduleOrchestrationDrain(binding.handoff.runId as RunId, 'browser-handoff-continue');
      const response: ContinueBrowserHandoffResponse = {
        status: 'continued',
        handoffId: binding.handoff.handoffId,
        replayed: handoffDecision.replayed || approvalDecision.replayed,
        runId: binding.handoff.runId as RunId,
        stepId: binding.handoff.stepId as StepId,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'browser.handoff.continue',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeBrowserHandoffCommandError(socket, frame, error);
    }
  }

  private async handleCancelBrowserHandoff(socket: Socket, frame: Frame): Promise<void> {
    const payload = parseCancelBrowserHandoffPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    try {
      const binding = this.resolveBrowserHandoffBinding(payload.handoffId, 'rejected');
      const handoffDecision = await this.browserController!.cancelHandoff(payload);
      const approvalDecision = this.scheduler!.decideApproval({
        approvalId: binding.approval.id,
        decision: 'rejected',
        decidedBy: 'human',
      });
      this.syncOrchestrationEvents();
      this.publishBrowserHandoffLifecycleEvent(
        'browser.handoff.cancelled',
        binding.handoff,
        approvalDecision.graph.run.taskId,
        {
          approvalId: binding.approval.id,
          replayed: handoffDecision.replayed || approvalDecision.replayed,
          leaseDisposition: payload.leaseDisposition ?? 'default',
        },
      );
      const response: CancelBrowserHandoffResponse = {
        status: 'cancelled',
        handoffId: binding.handoff.handoffId,
        replayed: handoffDecision.replayed || approvalDecision.replayed,
        runId: binding.handoff.runId as RunId,
        stepId: binding.handoff.stepId as StepId,
      };
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'browser.handoff.cancel',
          payload: response,
        }),
      );
    } catch (error) {
      this.writeBrowserHandoffCommandError(socket, frame, error);
    }
  }

  private resolveBrowserHandoffBinding(
    handoffId: string,
    decision: 'approved' | 'rejected',
  ): {
    handoff: RuntimeBrowserHandoffContext & { stepId: string; agentVersionId: string };
    approval: import('@sync-think/storage').ApprovalRequestRecord;
  } {
    if (
      !this.browserController ||
      !this.approvalStore ||
      !this.orchestrationStore ||
      !this.productionExecutionStore ||
      !this.scheduler
    ) {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-unavailable',
        'Browser handoff recovery services are not configured on this Runtime.',
      );
    }
    const handoff = this.browserController.inspectHandoff(handoffId);
    if (!handoff.stepId || !handoff.agentVersionId) {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-binding-invalid',
        'Browser handoff is not bound to a durable orchestration Step.',
      );
    }
    const boundHandoff = handoff as RuntimeBrowserHandoffContext & {
      stepId: string;
      agentVersionId: string;
    };
    const graph = this.orchestrationStore.getGraph(handoff.runId as RunId);
    const step = graph?.steps.find((candidate) => candidate.id === handoff.stepId);
    const task = graph ? this.workspaceStore?.getTask(graph.run.taskId) : undefined;
    if (
      !graph ||
      !step ||
      !task ||
      task.workspaceId !== handoff.workspaceId ||
      step.agentVersionId !== handoff.agentVersionId
    ) {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-binding-invalid',
        'Browser handoff Run, Step, AgentVersion, or Workspace binding is invalid.',
      );
    }

    const approval = this.approvalStore
      .list({ workspaceId: handoff.workspaceId as WorkspaceId, limit: 200 })
      .find((candidate) => {
        const details = runtimeRecord(candidate.metadata.actionDetails);
        return (
          candidate.action === 'browser.handoff' &&
          candidate.runId === handoff.runId &&
          candidate.stepId === handoff.stepId &&
          candidate.metadata.source === 'scheduler.step-action' &&
          candidate.metadata.runId === handoff.runId &&
          candidate.metadata.stepId === handoff.stepId &&
          candidate.metadata.agentVersionId === handoff.agentVersionId &&
          details?.handoffId === handoff.handoffId &&
          details.revision === 1
        );
      });
    if (!approval) {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-binding-invalid',
        'Browser handoff approval binding was not found.',
      );
    }
    if (approval.state !== 'pending') {
      if (approval.state === decision && approval.decidedBy === 'human') {
        return { handoff: boundHandoff, approval };
      }
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-conflict',
        'Browser handoff approval has already been decided differently.',
      );
    }
    if (
      step.state !== 'awaitingApproval' ||
      graph.run.state !== 'awaitingToolApproval' ||
      !step.idempotencyKey
    ) {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-binding-invalid',
        'Browser handoff Step is not waiting for a human decision.',
      );
    }

    const reservation = this.productionExecutionStore.getProviderExecution(step.idempotencyKey);
    const checkpoint = runtimeRecord(reservation?.checkpoint);
    const pending = runtimeRecord(checkpoint?.pending);
    const toolCall = runtimeRecord(pending?.toolCall);
    const request = runtimeRecord(pending?.request);
    const details = runtimeRecord(request?.details);
    if (
      !reservation ||
      reservation.idempotencyKey !== step.idempotencyKey ||
      reservation.runId !== graph.run.id ||
      reservation.stepId !== step.id ||
      reservation.agentVersionId !== step.agentVersionId ||
      reservation.executionAttempt !== step.executionAttempt ||
      reservation.state !== 'released' ||
      checkpoint?.version !== 1 ||
      pending?.state !== 'waiting-user' ||
      toolCall?.name !== 'browser_handoff' ||
      request?.action !== 'browser.handoff' ||
      details?.handoffId !== handoff.handoffId ||
      details.revision !== 1
    ) {
      throw new RuntimeBrowserHandoffError(
        'browser.handoff-checkpoint-invalid',
        'Browser handoff Provider checkpoint does not match the waiting Step.',
      );
    }
    return { handoff: boundHandoff, approval };
  }

  private publishBrowserHandoffLifecycleEvent(
    type: 'browser.handoff.continued' | 'browser.handoff.cancelled',
    handoff: RuntimeBrowserHandoffContext,
    taskId: TaskId,
    payload: Record<string, unknown>,
  ): void {
    const draft: EventDraft = {
      id: ulid() as Event['id'],
      workspaceId: handoff.workspaceId as WorkspaceId,
      taskId,
      runId: handoff.runId as RunId,
      stepId: handoff.stepId as StepId,
      category: 'approval',
      type,
      occurredAt: new Date().toISOString(),
      payload: {
        handoffId: handoff.handoffId,
        revision: handoff.revision,
        ...payload,
      },
    };
    if (this.stateStore) {
      const events = this.commitEvents([draft]);
      this.recordCommittedEvents(events);
      for (const event of events) this.publishEvent(event);
      return;
    }
    const event: Event = { ...draft, sequence: ++this.eventSequence };
    this.rememberRecentEvents([event]);
    this.publishEvent(event);
  }

  private writeDesktopCommandQueryError(socket: Socket, frame: Frame, error: unknown): void {
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code:
            error instanceof Error &&
            ['desktop.command_conflict', 'desktop.command_not_waiting'].includes(error.message)
              ? ErrorCode.DESKTOP_COMMAND_CONFLICT
              : ErrorCode.DESKTOP_ACTION_FAILED,
          message:
            error instanceof Error
              ? error.message
                  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
                  .replace(/Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, 'Bearer [REDACTED]')
              : 'Desktop command request failed.',
        },
      }),
    );
  }

  private writeBrowserHandoffUnavailable(socket: Socket, frame: Frame): void {
    this.writeBrowserHandoffCommandError(
      socket,
      frame,
      new RuntimeBrowserHandoffError(
        'browser.handoff-unavailable',
        'Browser handoff is not configured on this Runtime.',
      ),
    );
  }

  private writeBrowserHandoffCommandError(socket: Socket, frame: Frame, error: unknown): void {
    const knownCodes = new Set<string>(Object.values(ErrorCode));
    const rawCode = error instanceof RuntimeBrowserHandoffError ? error.code : undefined;
    const code =
      rawCode && knownCodes.has(rawCode)
        ? (rawCode as (typeof ErrorCode)[keyof typeof ErrorCode])
        : ErrorCode.BROWSER_HANDOFF_CONFLICT;
    const message = error instanceof Error ? error.message : 'Browser handoff command failed.';
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: frame.type,
        payload: {},
        error: {
          code,
          message: message
            .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
            .replace(/Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, 'Bearer [REDACTED]'),
        },
      }),
    );
  }

  /** Legacy Renderer reverse channel retained during migration; no real command waits here. */
  private handleConversationSubmitBrowserResult(socket: Socket, frame: Frame): void {
    const payload = parseConversationSubmitBrowserResultPayload(frame.payload);
    if (!payload) {
      this.writeMalformedPayload(socket, frame);
      return;
    }
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'conversation.submitBrowserResult',
        payload: { requestId: payload.requestId, accepted: false },
      }),
    );
  }

  private buildDefaultProviderContextSnapshot(
    run: DemoRunState,
    options: {
      messages: import('@sync-think/adapters').ProviderMessage[];
      toolsEnabled: boolean;
      workspaceRoot?: string;
      executionMode?: string;
      networkEnabled?: boolean;
    },
  ): ContextSnapshot {
    const executionMode = normalizeChatExecutionMode(options.executionMode);
    const networkEnabled = options.networkEnabled === true || run.networkEnabled === true;
    const hasProjectTools = Boolean(options.toolsEnabled && options.workspaceRoot);
    const mcpExtra = (() => {
      if (!options.toolsEnabled || !this.mcpStore) {
        return {
          tools: [] as import('@sync-think/adapters').ProviderToolSchema[],
          dispatch: new Map<string, { mcpServerId: string; toolName: string }>(),
        };
      }
      const effectiveMcpIds = this.resolveEffectiveMcpServerIds(
        this.resolveEventWorkspaceId(run.threadId),
        run.mcpServerIds,
      );
      run.mcpServerIds = effectiveMcpIds;
      const servers = effectiveMcpIds
        .map((id) => this.mcpStore?.get(id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .map((row) => ({ id: row.id, name: row.name, tools: row.tools }));
      return mcpToolsToProviderSchemas(servers, { maxTools: 16 });
    })();
    (
      run as DemoRunState & {
        mcpToolDispatch?: Map<string, { mcpServerId: string; toolName: string }>;
      }
    ).mcpToolDispatch = mcpExtra.dispatch;
    const agentToolsEnabled = Boolean(options.toolsEnabled && this.globalAgentStore);
    const desktopToolsEnabled = Boolean(options.toolsEnabled && this.isComputerUsePluginEnabled());
    const browserWorkflowToolsEnabled = Boolean(
      options.toolsEnabled && this.browserWorkflowService,
    );
    const mcpCatalogToolsEnabled = Boolean(options.toolsEnabled && this.mcpStore);
    const mcpRegistryToolsEnabled = Boolean(options.toolsEnabled && this.mcpStore);
    const tools =
      options.toolsEnabled &&
      (hasProjectTools ||
        networkEnabled ||
        agentToolsEnabled ||
        desktopToolsEnabled ||
        browserWorkflowToolsEnabled ||
        mcpCatalogToolsEnabled ||
        mcpExtra.tools.length > 0)
        ? toolsForExecutionMode(executionMode, {
            networkEnabled,
            includeProjectTools: hasProjectTools,
            includeAgentTools: agentToolsEnabled,
            includeDesktopTools: desktopToolsEnabled,
            includeBrowserWorkflowTools: browserWorkflowToolsEnabled,
            includeMcpCatalogTools: mcpCatalogToolsEnabled,
            includeMcpRegistryTools: mcpRegistryToolsEnabled,
            extraTools: mcpExtra.tools,
          })
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
    const desktopPrompt = desktopToolsEnabled
      ? [
          'Computer Use tools are ENABLED for this turn.',
          'Use this sequence: desktop_list_windows -> if the requested app has no visible window, desktop_launch_app -> desktop_inspect_window -> desktop_resolve_selector -> one immediate desktop_read_element / desktop_focus_element / desktop_invoke_element / desktop_set_value.',
          'Use desktop_launch_app, never run_command, to open a GUI application. Report that an app opened only when desktop_launch_app returns app-launched with an exact visible window.',
          'After any UI change, inspect and resolve again. If a snapshot or accessibility revision is stale, do not guess, use coordinates, or reuse an old element index.',
          'Do not fall back to OCR, clipboard automation, SendInput, fuzzy selectors, or coordinate clicking.',
          executionMode === 'ask'
            ? 'Permission mode is ask: focus, invoke, and set-value pause for user approval; list, inspect, resolve, and read do not.'
            : 'Permission mode is workspace/full-access: ordinary Computer Use actions execute without an extra approval card.',
        ].join('\n')
      : undefined;
    const agentCreationPrompt = agentToolsEnabled
      ? [
          'Agent Library tools are ENABLED (list_agent_resources, create_agent, update_agent, archive_agent):',
          '- When the user asks to 创建智能体 / 新建智能体 / 入库, FIRST call list_agent_resources to get valid model ids and approved skill versions, THEN call create_agent with a complete draft (name, persona, description, defaultModelId, skillIds).',
          '- When the user asks to 修改/调整某个智能体, FIRST call list_agent_resources to confirm the target agent id, THEN call update_agent with ONLY the fields to change. skillIds is full-replace: include the complete final set.',
          '- When the user asks to 删除/归档某个智能体, use archive_agent (soft-delete, restorable in the Agent Library). There is NO hard-delete tool; never claim you deleted permanently. The agent of the CURRENT conversation cannot be archived.',
          executionMode === 'full-access'
            ? '- Permission mode is full-access: create/update/archive execute immediately without extra confirmation. Still show the user exactly what you changed.'
            : '- Permission mode is NOT full-access: create_agent / update_agent / archive_agent will pause and show the user an approval card. Wait for their decision; if denied, do not retry — hand them the draft/diff instead.',
          '- skillIds must be approved skill version ids from list_agent_resources (max 8). Never invent ids.',
          '- Resolve update/archive targets by exact agent id when possible; names must be unique or the call fails.',
          '- Do NOT search the repository for a hidden createAgent API — use these tools.',
          'Skill capability-center tools are ENABLED (list_skills, read_skill, create_skill, update_skill, delete_skill, import_remote_skill):',
          '- When the user asks to 创建 Skill, write a complete SKILL.md (frontmatter: name / description / version / optional allowed-tools + markdown body with the workflow rules), then call create_skill.',
          '- When the user asks to 修改 Skill, FIRST call read_skill to get the current source, edit it, bump the version, and call update_skill. Old versions are kept; equipped agents stay on their pinned version until rebound.',
          '- When the user asks to 删除/卸载 Skill, call list_skills to find the exact skillVersionId, then delete_skill. If it is still equipped by an agent the call fails — report that instead of retrying.',
          '- Importing only parses text; scripts are never executed. Expanding allowed-tools enqueues a separate permission approval automatically.',
          '- When the user gives a remote SKILL.md URL, call import_remote_skill; it records market origin metadata and returns the exact immutable version.',
          executionMode === 'full-access'
            ? '- Skill mutations execute immediately in full-access mode.'
            : '- Skill mutations (create_skill / update_skill / delete_skill) pause on an approval card outside full-access. If denied, hand the user the SKILL.md draft instead.',
          'Remote MCP registry is ENABLED (list_mcp_tools, register_remote_mcp): call register_remote_mcp with name + endpoint metadata only. Never ask the user for a key in chat and never put a key in tool arguments; after registration, tell the user to configure the key in the capability center password field. Discovery is best effort; do not claim a tool is available when discoveryError is returned.',
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
      '- Titles: short imperative Chinese, ≤20 chars. Do not use it for trivial single-step answers.',
      '- This tool only updates the progress UI — it never touches files and needs no approval.',
    ].join('\n');
    const browserWorkflowPrompt = browserWorkflowToolsEnabled
      ? [
          'Browser Automation Workflow tools are ENABLED (browser_workflow_list, browser_workflow_get, browser_workflow_create_draft):',
          '- When the user asks which browser tasks/workflows exist, call browser_workflow_list. Automation tasks are stored Workflows, not open browser windows and not Browser Recording sessions.',
          '- browser_workflow_create_draft creates only an AI-source Draft. It does not operate the browser, record steps, submit review, approve, or publish.',
          '- After creating a Draft, tell the user to open「浏览器自动化」, record the workflow, submit it for review, and approve it before an immutable WorkflowVersion is published.',
          '- Never bypass the review flow or claim a Draft is recorded/published.',
          executionMode === 'ask'
            ? '- Permission mode is ask: creating a Draft pauses for user approval; list/get remain read-only.'
            : '- Permission mode is workspace/full-access: creating a Draft executes directly, while recording and publish review remain separate product gates.',
        ].join('\n')
      : 'Browser Automation Workflow tools are unavailable in this Runtime.';
    const productBoundaryPrompt = [
      'Product capability boundaries (SYNC-THINK / this desktop shell):',
      CODEX_STYLE_COMMENTARY_PROMPT,
      agentCreationPrompt,
      planToolPrompt,
      browserWorkflowPrompt,
      '- Prefer built-in tools list_files / search_files / read_file / git_status / git_diff. search_files finds file contents by regex — do not call rg/ripgrep/fd/ag — they are often missing on Windows and will fail with ENOENT.',
      '- If a tool fails as unavailable, do not retry the same command; change approach or answer with what you already know.',
      '- Avoid long pure-exploration loops. After a few targeted looks, give the user a useful answer.',
      LANGUAGE_FOLLOW_PROMPT,
    ].join('\n');
    const agentInstructions = this.buildRunAgentInstructions(run, options.workspaceRoot);
    const projectContext = options.workspaceRoot
      ? [
          `Project folder: ${options.workspaceRoot}`,
          `Permission mode: ${executionMode}` +
            (executionMode === 'ask'
              ? ' (「询问批准」 you MAY call write_file / run_command; the user will be prompted to approve each mutating action before it runs. Prefer read-only tools when enough.)'
              : ' (write_file / run_command auto-allowed inside the project folder).'),
          'Use tools when needed. Paths are relative to the project folder. Prefer tools over guessing file contents.',
          ...(run.projectContextPromptBlocks ?? []),
        ]
      : [
          'No project folder is bound for this conversation, so filesystem tools are unavailable.',
          'If the user asks about local project files, tell them to open/select a project folder first.',
          ...(run.projectContextPromptBlocks ?? []),
        ];
    const messageExcerpt = [...options.messages]
      .reverse()
      .find((message) => message.role === 'user');
    const messageExcerptText =
      messageExcerpt && typeof messageExcerpt.content === 'string'
        ? messageExcerpt.content
        : messageExcerpt && Array.isArray(messageExcerpt.content)
          ? messageExcerpt.content
              .filter((part) => part.type === 'text' && typeof part.text === 'string')
              .map((part) => part.text)
              .join('\n')
          : '';
    const actualSources = (run.contextSources ?? []).map((source) => {
      if (source.disposition !== 'included') return source;
      if (
        source.section === 'tools' &&
        (!tools || !source.toolName || !tools.some((tool) => tool.name === source.toolName))
      ) {
        return { ...source, disposition: 'audit-only' as const, tokens: 0 };
      }
      if (source.section === 'agent' && source.kind === 'agent-instructions') {
        return { ...source, content: agentInstructions[0] ?? 'You are' };
      }
      if (source.section === 'messages' && source.kind === 'message-excerpt') {
        return {
          ...source,
          ...(messageExcerptText.trim() ? { content: messageExcerptText } : { content: undefined }),
        };
      }
      return source;
    });
    return new ContextSnapshotBuilder().build({
      modelId: run.modelId,
      contextWindow: run.contextWindow ?? 128_000,
      contextWindowEstimated: run.contextWindowEstimated,
      systemInstructions: [
        productBoundaryPrompt,
        networkPrompt,
        ...(desktopPrompt ? [desktopPrompt] : []),
      ],
      agentInstructions,
      projectContext,
      compactSummary: run.compactSummary,
      messages: options.messages,
      tools,
      sources: actualSources,
      compactedAt: run.compactedAt,
    });
  }

  private async openProviderStream(
    run: DemoRunState,
    options: {
      messages?: import('@sync-think/adapters').ProviderMessage[];
      toolsEnabled?: boolean;
      toolChoice?: import('@sync-think/adapters').ProviderCallRequest['toolChoice'];
      workspaceRoot?: string;
      executionMode?: string;
      networkEnabled?: boolean;
      signal?: AbortSignal;
      /** When set, replaces the default coding/chat system prompt (used by compact). */
      systemPromptOverride?: string;
      /** Native 内核的平台工具 schema（ask_user_question / task_schedule 等）。 */
      platformSchemas?: import('@sync-think/adapters').ProviderToolSchema[];
    } = {},
  ): Promise<AsyncIterable<import('@sync-think/adapters').AdapterEvent> | undefined> {
    const signal = options.signal ?? new AbortController().signal;
    const executionMode = normalizeChatExecutionMode(options.executionMode);
    const networkEnabled = options.networkEnabled === true || run.networkEnabled === true;
    const hasProjectTools = Boolean(options.toolsEnabled && options.workspaceRoot);
    // MCP tools bound on the run �?expose schemas to the provider when tools are on.
    const mcpExtra = (() => {
      if (!options.toolsEnabled || !this.mcpStore) {
        return {
          tools: [] as import('@sync-think/adapters').ProviderToolSchema[],
          dispatch: new Map<string, { mcpServerId: string; toolName: string }>(),
        };
      }
      const effectiveMcpIds = this.resolveEffectiveMcpServerIds(
        this.resolveEventWorkspaceId(run.threadId),
        run.mcpServerIds,
      );
      run.mcpServerIds = effectiveMcpIds;
      const servers = effectiveMcpIds
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
    (
      run as DemoRunState & {
        mcpToolDispatch?: Map<string, { mcpServerId: string; toolName: string }>;
      }
    ).mcpToolDispatch = mcpExtra.dispatch;
    const agentToolsEnabled = Boolean(options.toolsEnabled && this.globalAgentStore);
    const desktopToolsEnabled = Boolean(options.toolsEnabled && this.isComputerUsePluginEnabled());
    const browserWorkflowToolsEnabled = Boolean(
      options.toolsEnabled && this.browserWorkflowService,
    );
    const mcpCatalogToolsEnabled = Boolean(options.toolsEnabled && this.mcpStore);
    const mcpRegistryToolsEnabled = Boolean(options.toolsEnabled && this.mcpStore);
    const tools =
      options.toolsEnabled &&
      (hasProjectTools ||
        networkEnabled ||
        agentToolsEnabled ||
        desktopToolsEnabled ||
        browserWorkflowToolsEnabled ||
        mcpCatalogToolsEnabled ||
        mcpExtra.tools.length > 0)
        ? [
            ...toolsForExecutionMode(executionMode, {
              networkEnabled,
              includeProjectTools: hasProjectTools,
              includeAgentTools: agentToolsEnabled,
              includeDesktopTools: desktopToolsEnabled,
              includeBrowserWorkflowTools: browserWorkflowToolsEnabled,
              includeMcpCatalogTools: mcpCatalogToolsEnabled,
              includeMcpRegistryTools: mcpRegistryToolsEnabled,
              extraTools: [...mcpExtra.tools, ...(options.platformSchemas ?? [])],
            }),
          ]
        : undefined;
    let requestExtras: {
      messages?: import('@sync-think/adapters').ProviderMessage[];
      tools?: import('@sync-think/adapters').ProviderToolSchema[];
      toolChoice?: import('@sync-think/adapters').ProviderCallRequest['toolChoice'];
      systemPrompt: string;
    };
    if (typeof options.systemPromptOverride === 'string' && options.systemPromptOverride.trim()) {
      requestExtras = {
        messages: options.messages,
        tools,
        systemPrompt: options.systemPromptOverride.trim(),
      };
    } else {
      this.hydrateRunSkillContext(run);
      const snapshot = this.buildDefaultProviderContextSnapshot(run, {
        messages: options.messages ?? [{ role: 'user', content: run.userText }],
        toolsEnabled: options.toolsEnabled === true,
        workspaceRoot: options.workspaceRoot,
        executionMode,
        networkEnabled,
      });
      run.contextSnapshot = snapshot;
      this.recordProviderContextCapabilityUsage(run, snapshot);
      this.setConversationContextSnapshot(run.threadId, snapshot);
      this.contextRunByThread.set(run.threadId, {
        run,
        workspaceRoot: options.workspaceRoot,
        executionMode,
        toolsEnabled: options.toolsEnabled === true,
        networkEnabled,
      });
      requestExtras = snapshot.providerRequest;
    }
    if (options.toolChoice) requestExtras.toolChoice = options.toolChoice;

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
      this.persistAssistantTerminalMessage(runId, run, 'failed', scrubbedMessage);
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

  /**
   * Persist a final chat message into SqliteMessageStore (S1 durable message path).
   * Failures are logged but never fail the live chat event stream �?events remain source of truth
   * until ChatView fully switches to the message store.
   */
  private persistFinalChatMessage(input: {
    id: MessageId;
    threadId: ThreadId;
    role: Message['role'];
    text: string;
    blocks?: MessageBlock[];
    runId?: RunId;
    stepId?: StepId;
    agentVersionId?: AgentVersionId;
    modelId?: ModelId;
    credentialRefId?: CredentialRefId;
    createdAt?: string;
    sequence?: number;
  }): void {
    if (!this.messageStore) return;
    let durableMessage: Message | undefined;
    try {
      const text = typeof input.text === 'string' ? input.text : '';
      const blocks: MessageBlock[] =
        input.blocks && input.blocks.length > 0
          ? [...input.blocks]
          : text
            ? [{ type: 'text', text }]
            : [];
      // Empty user messages can still carry images attached later; empty assistant is skipped.
      if (blocks.length === 0 && input.role !== 'user') return;
      if (blocks.length === 0 && input.role === 'user') {
        // Keep a stable empty text block so image attach can updateBlocks later.
        blocks.push({ type: 'text', text: '' });
      }
      const sequence =
        typeof input.sequence === 'number' && Number.isSafeInteger(input.sequence)
          ? input.sequence
          : this.messageStore.nextSequence(input.threadId);
      const message: Message = {
        id: input.id,
        threadId: input.threadId,
        role: input.role,
        sequence,
        blocks,
        createdAt: input.createdAt ?? new Date().toISOString(),
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.stepId ? { stepId: input.stepId } : {}),
        ...(input.agentVersionId ? { agentVersionId: input.agentVersionId } : {}),
        ...(input.modelId ? { modelId: input.modelId } : {}),
        ...(input.credentialRefId ? { credentialRefId: input.credentialRefId } : {}),
      };
      durableMessage = message;
      this.messageStore.createFinalMessage(message);
    } catch (error) {
      if (error instanceof MessageStoreError && error.code === 'message.conflict') {
        // Idempotent retry / same-id replay �?ignore.
        return;
      }
      if (
        durableMessage &&
        input.role === 'assistant' &&
        input.text.trim() &&
        error instanceof MessageStoreError &&
        error.code === 'message.invalid_input'
      ) {
        try {
          this.messageStore.createFinalMessage({
            ...durableMessage,
            blocks: assistantTextFallbackMessageBlocks(input.text),
          });
          console.warn(
            '[runtime] durable assistant details exceeded limits; stored final text only',
          );
          return;
        } catch (fallbackError) {
          if (
            fallbackError instanceof MessageStoreError &&
            fallbackError.code === 'message.conflict'
          ) {
            return;
          }
          console.warn(
            '[runtime] durable assistant text fallback failed:',
            fallbackError instanceof Error ? fallbackError.message : fallbackError,
          );
        }
      }
      console.warn(
        '[runtime] durable message write failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  private persistAssistantFinalMessage(
    runId: RunId,
    run: DemoRunState,
    payload: Record<string, unknown>,
    _round?: {
      reasoningDelta: string;
      transcriptMessages: readonly { phase?: string; content: unknown }[];
      hasToolRounds: boolean;
    },
  ): void {
    const occurredAt = new Date().toISOString();
    const terminalRun = closeAssistantTimeline(
      closeCommentaryTimelineSegment(run, occurredAt),
      occurredAt,
    );
    const timeline = terminalRun.assistantTimeline ?? [];
    const timelineText = assistantTimelineFinalText(timeline);
    const assistantText =
      timelineText ||
      (typeof payload.assistantText === 'string'
        ? payload.assistantText
        : typeof terminalRun.assistantText === 'string'
          ? terminalRun.assistantText
          : '');
    const commentaryText =
      typeof payload.commentaryText === 'string' && payload.commentaryText.trim()
        ? payload.commentaryText
        : typeof terminalRun.commentaryText === 'string' && terminalRun.commentaryText.trim()
          ? terminalRun.commentaryText
          : undefined;
    const commentarySegments = terminalRun.commentarySegments.filter((segment) =>
      segment.text.trim(),
    );
    const reasoningText =
      typeof terminalRun.reasoningText === 'string' && terminalRun.reasoningText.trim()
        ? terminalRun.reasoningText
        : undefined;
    const reasoningSegments = terminalRun.reasoningSegments.filter((segment) =>
      segment.text.trim(),
    );
    const toolBlocks = externalKernelToolEventsToMessageBlocks(terminalRun.kernelToolEvents);
    const blocks =
      timeline.length > 0
        ? assistantTimelineToMessageBlocks(timeline)
        : buildFinalAssistantBlocks({
            commentaryText,
            commentarySegments,
            assistantText,
            reasoningText,
            reasoningSegments,
            toolBlocks,
            reasoningFirst: terminalRun.kernelId === 'native' || !terminalRun.kernelId,
          });
    if (blocks.length === 0) return;
    this.persistFinalChatMessage({
      id: `asst-${runId}` as MessageId,
      threadId: terminalRun.threadId as ThreadId,
      role: 'assistant',
      text: assistantText,
      blocks,
      runId,
      modelId: terminalRun.modelId ? (terminalRun.modelId as ModelId) : undefined,
      credentialRefId: terminalRun.credentialRefId
        ? (terminalRun.credentialRefId as CredentialRefId)
        : undefined,
      agentVersionId: terminalRun.agentVersionId
        ? (terminalRun.agentVersionId as AgentVersionId)
        : undefined,
    });
  }

  private persistAssistantTerminalMessage(
    runId: RunId,
    run: DemoRunState,
    terminalState: 'failed' | 'cancelled',
    errorMessage?: string,
  ): void {
    const occurredAt = new Date().toISOString();
    const classifiedRun = run.legacyPendingText
      ? appendAssistantTextDelta(
          {
            ...run,
            assistantText: run.assistantText + run.legacyPendingText,
            legacyPendingText: '',
          },
          'final_answer',
          run.legacyPendingText,
          occurredAt,
        )
      : run;
    const terminalRun = closeAssistantTimeline(
      closeCommentaryTimelineSegment(classifiedRun, occurredAt),
      occurredAt,
    );
    const timeline = terminalRun.assistantTimeline ?? [];
    const assistantText =
      assistantTimelineFinalText(timeline) ||
      (typeof terminalRun.assistantText === 'string' ? terminalRun.assistantText : '');
    const scrubbedMessage = this.scrubDiagnosticMessage(errorMessage);
    const commentaryText =
      typeof terminalRun.commentaryText === 'string' && terminalRun.commentaryText.trim()
        ? terminalRun.commentaryText
        : undefined;
    const commentarySegments = terminalRun.commentarySegments.filter((segment) =>
      segment.text.trim(),
    );
    const reasoningText =
      typeof terminalRun.reasoningText === 'string' && terminalRun.reasoningText.trim()
        ? terminalRun.reasoningText
        : undefined;
    const reasoningSegments = terminalRun.reasoningSegments.filter((segment) =>
      segment.text.trim(),
    );
    const toolBlocks = externalKernelToolEventsToMessageBlocks(terminalRun.kernelToolEvents);
    const contentBlocks =
      timeline.length > 0
        ? assistantTimelineToMessageBlocks(timeline)
        : buildFinalAssistantBlocks({
            commentaryText,
            commentarySegments,
            assistantText,
            reasoningText,
            reasoningSegments,
            toolBlocks,
            reasoningFirst: terminalRun.kernelId === 'native' || !terminalRun.kernelId,
          });
    if (contentBlocks.length === 0) return;
    this.persistFinalChatMessage({
      id: `asst-${runId}` as MessageId,
      threadId: terminalRun.threadId as ThreadId,
      role: 'assistant',
      text: assistantText,
      blocks: [
        ...contentBlocks,
        {
          type: 'error',
          payload: {
            terminalState,
            ...(scrubbedMessage ? { errorMessage: scrubbedMessage } : {}),
          },
        },
      ],
      runId,
      modelId: terminalRun.modelId ? (terminalRun.modelId as ModelId) : undefined,
      credentialRefId: terminalRun.credentialRefId
        ? (terminalRun.credentialRefId as CredentialRefId)
        : undefined,
      agentVersionId: terminalRun.agentVersionId
        ? (terminalRun.agentVersionId as AgentVersionId)
        : undefined,
    });
  }

  private mergeDurableMessageImages(
    messageId: MessageId,
    images: Array<{ id: string; name: string; mimeType: string; storageRef: string }>,
  ): void {
    if (!this.messageStore || images.length === 0) return;
    const existing = this.messageStore.getMessage(messageId);
    if (!existing) {
      console.warn('[runtime] message.attachImages: durable message missing', messageId);
      return;
    }
    const blocks: MessageBlock[] = existing.blocks.filter((block) => block.type !== 'image');
    // Preserve non-image blocks (usually a leading text block).
    if (!blocks.some((block) => block.type === 'text')) {
      blocks.unshift({ type: 'text', text: '' });
    }
    for (const image of images) {
      blocks.push({
        type: 'image',
        payload: {
          id: image.id,
          name: image.name,
          mimeType: image.mimeType,
          storageRef: image.storageRef,
        },
      });
    }
    this.messageStore.updateBlocks(messageId, blocks);
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
    const now = new Date().toISOString();
    for (const run of [...this.demoRuns.values()]) {
      const events = this.stateStore?.listEventsByRun
        ? this.stateStore.listEventsByRun(run.runId)
        : this.events.filter((event) => event.runId === run.runId);
      if (events.some((event) => TERMINAL_RUN_EVENT_TYPES.has(event.type))) {
        this.demoRuns.delete(run.runId);
        continue;
      }
      const lastActivityAt = events.at(-1)?.occurredAt;
      if (isDemoRunRecoveryExpired({ lastActivityAt, now })) {
        this.browserController?.expireRunCommands(run.runId, now);
        this.persistDemoRunPaused(run.runId, {
          reason: 'recovery_expired',
          failedModelId: run.modelId,
          failureClass: 'unknown',
          errorMessage: '历史请求已过期，已暂停自动恢复。',
        });
        continue;
      }
      void this.executeKernelRun(run.runId);
    }
  }

  private scrubDiagnosticMessage(message: string | undefined): string | undefined {
    if (!message) return undefined;
    let out = message;
    out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
    out = out.replace(/Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, 'Bearer [REDACTED]');
    out = out.replace(/plaintext-secret/gi, '[REDACTED]');
    out = out.replace(/api[_-]?key["'\s:=]+[A-Za-z0-9._-]{8,}/gi, 'api_key=[REDACTED]');
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
    this.rememberRecentEvents([event]);
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
    this.rememberRecentEvents([event]);
    return event;
  }

  private appendEvent(
    category: EventCategory,
    type: string,
    payload: Record<string, unknown>,
    messageId?: MessageId,
    runId?: RunId,
    taskId?: TaskId,
    stepId?: StepId,
  ): Event {
    const draft: EventDraft = {
      id: ulid() as Event['id'],
      workspaceId: this.workspaceId,
      taskId,
      stepId,
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
      this.rememberRecentEvents([event]);
      this.eventSequence = Math.max(this.eventSequence, event.sequence);
      return event;
    }

    const event: Event = {
      ...draft,
      sequence: ++this.eventSequence,
    };
    this.rememberRecentEvents([event]);
    return event;
  }

  private publishEvent(event: Event): void {
    for (const [streamId, sub] of this.subscriptions) {
      const eventCursor = cursorForEvent(event);
      if (
        sub.socket.destroyed ||
        sub.phase === 'catching-up' ||
        compareCursor(eventCursor, sub.liveCursor) <= 0
      ) {
        continue;
      }
      sub.liveCursor = eventCursor;
      if (!this.subscriptionMatches(sub, event)) continue;
      this.writeLiveEvent(sub.socket, streamId, event);
    }
    this.publishTransientProjection(event);
  }

  private flushLegacyAssistantText(input: {
    runId: RunId;
    phase: 'commentary' | 'final_answer';
    occurredAt: string;
  }): DemoRunState | undefined {
    const current = this.demoRuns.get(input.runId);
    if (!current?.legacyPendingText) return current;

    const textDelta = current.legacyPendingText;
    let nextRun: DemoRunState = {
      ...current,
      legacyPendingText: '',
      legacyPendingTextSeq: undefined,
      ...(input.phase === 'commentary'
        ? { commentaryText: current.commentaryText + textDelta }
        : { assistantText: current.assistantText + textDelta }),
    };
    // 段插入到缓冲文本首次到达的 timeline 位置（真实发射顺序），
    // 而不是 flush 时刻的尾部——中间可能已有 compaction 等后续段。
    nextRun = appendAssistantTextDelta(
      nextRun,
      input.phase,
      textDelta,
      input.occurredAt,
      current.legacyPendingTextSeq,
    );
    if (input.phase === 'commentary') {
      nextRun = appendCommentaryTimelineDelta(nextRun, {
        textDelta,
        occurredAt: input.occurredAt,
        afterSequence: this.eventSequence,
      });
    } else {
      nextRun = closeCommentaryTimelineSegment(nextRun, input.occurredAt);
    }

    this.demoRuns.set(input.runId, nextRun);
    // The full text was already streamed live delta-by-delta; only the
    // commentary phase emits a boundary frame (empty delta + afterSequence)
    // so the UI can close the segment without re-rendering duplicate text.
    if (input.phase === 'commentary') {
      this.publishTransientDelta({
        threadId: nextRun.threadId as ThreadId,
        runId: input.runId,
        kind: 'commentary',
        textDelta: '',
        afterSequence: this.eventSequence,
        occurredAt: input.occurredAt,
      });
    }
    this.updateTransientTextSnapshot({
      threadId: nextRun.threadId as ThreadId,
      runId: input.runId,
      streamSequence: this.transientSequenceByThread.get(nextRun.threadId) ?? 0,
      text: nextRun.assistantText,
      commentaryText: nextRun.commentaryText,
      commentarySegments: nextRun.commentarySegments,
      reasoningText: nextRun.reasoningText,
      reasoningSegments: nextRun.reasoningSegments,
      assistantTimeline: nextRun.assistantTimeline,
      updatedAt: input.occurredAt,
    });
    return nextRun;
  }

  private publishTransientDelta(input: {
    threadId: ThreadId;
    runId: RunId;
    kind: 'text' | 'commentary' | 'reasoning';
    textDelta: string;
    afterSequence?: number;
    occurredAt: string;
  }): void {
    const run = this.demoRuns.get(input.runId);
    this.publishTransientFrame({
      threadId: input.threadId,
      runId: input.runId,
      kind: input.kind,
      textDelta: input.textDelta,
      ...(input.afterSequence !== undefined ? { afterSequence: input.afterSequence } : {}),
      ...(run?.assistantTimeline?.length
        ? { assistantTimeline: run.assistantTimeline.map((segment) => ({ ...segment })) }
        : {}),
      occurredAt: input.occurredAt,
    });
  }

  private updateTransientTextSnapshot(input: {
    threadId: ThreadId;
    runId: RunId;
    streamSequence: number;
    text: string;
    commentaryText?: string;
    commentarySegments?: ConversationTransientSnapshot['commentarySegments'];
    reasoningText?: string;
    reasoningSegments?: ConversationTransientSnapshot['reasoningSegments'];
    assistantTimeline?: ConversationTransientSnapshot['assistantTimeline'];
    updatedAt: string;
  }): void {
    const current = this.transientSnapshotByThread.get(input.threadId);
    this.transientSnapshotByThread.set(input.threadId, {
      threadId: input.threadId,
      runId: input.runId,
      streamSequence: input.streamSequence,
      text: input.text,
      ...(input.commentaryText ? { commentaryText: input.commentaryText } : {}),
      ...(input.commentarySegments && input.commentarySegments.length > 0
        ? { commentarySegments: input.commentarySegments.map((segment) => ({ ...segment })) }
        : {}),
      ...(input.reasoningText ? { reasoningText: input.reasoningText } : {}),
      ...(input.reasoningSegments && input.reasoningSegments.length > 0
        ? { reasoningSegments: input.reasoningSegments.map((segment) => ({ ...segment })) }
        : {}),
      ...(input.assistantTimeline && input.assistantTimeline.length > 0
        ? { assistantTimeline: input.assistantTimeline.map((segment) => ({ ...segment })) }
        : {}),
      ...(current?.runId === input.runId && current.process ? { process: current.process } : {}),
      updatedAt: input.updatedAt,
    });
  }

  private publishTransientProjection(event: Event): void {
    const threadId =
      typeof event.payload.threadId === 'string' ? (event.payload.threadId as ThreadId) : undefined;
    if (!threadId || !event.runId) return;

    let projection:
      | Pick<
          ConversationTransientFrame,
          'kind' | 'textDelta' | 'afterSequence' | 'terminalState' | 'errorMessage' | 'process'
        >
      | undefined;
    const runProcess = (): ConversationGetRunProcessResponse['process'] => {
      const events = this.stateStore?.listEventsByRun
        ? this.stateStore.listEventsByRun(event.runId!)
        : this.events.filter((candidate) => candidate.runId === event.runId);
      return projectRunProcess(event.runId!, events);
    };
    if (event.type === 'message.delta') {
      const textDelta =
        typeof event.payload.textDelta === 'string'
          ? event.payload.textDelta
          : typeof event.payload.delta === 'string'
            ? event.payload.delta
            : undefined;
      if (textDelta === undefined) return;
      projection = { kind: 'text', textDelta };
    } else if (event.type === 'message.commentary_delta') {
      const textDelta =
        typeof event.payload.textDelta === 'string'
          ? event.payload.textDelta
          : typeof event.payload.delta === 'string'
            ? event.payload.delta
            : undefined;
      if (textDelta === undefined) return;
      projection = {
        kind: 'commentary',
        textDelta,
        afterSequence:
          typeof event.payload.afterSequence === 'number'
            ? event.payload.afterSequence
            : event.sequence,
      };
    } else if (event.type === 'message.reasoning_delta') {
      const textDelta =
        typeof event.payload.textDelta === 'string'
          ? event.payload.textDelta
          : typeof event.payload.reasoningDelta === 'string'
            ? event.payload.reasoningDelta
            : typeof event.payload.delta === 'string'
              ? event.payload.delta
              : undefined;
      if (textDelta === undefined) return;
      projection = {
        kind: 'reasoning',
        textDelta,
        afterSequence:
          typeof event.payload.afterSequence === 'number'
            ? event.payload.afterSequence
            : event.sequence,
      };
    } else if (event.type === 'run.completed') {
      projection = { kind: 'terminal', terminalState: 'completed', process: runProcess() };
    } else if (event.type === 'run.failed') {
      projection = {
        kind: 'terminal',
        terminalState: 'failed',
        process: runProcess(),
        ...(typeof event.payload.errorMessage === 'string'
          ? { errorMessage: event.payload.errorMessage }
          : {}),
      };
    } else if (event.type === 'run.cancelled') {
      projection = { kind: 'terminal', terminalState: 'cancelled', process: runProcess() };
    } else if (
      event.type === 'run.started' ||
      event.type === 'run.retrying' ||
      event.type === 'run.fallback.selected' ||
      event.type === 'kernel.context_compacted' ||
      event.type === 'provider.usage' ||
      event.type === 'tool.requested' ||
      event.type === 'tool.completed' ||
      event.type === 'tool.failed' ||
      event.type === 'execution.tool.requested' ||
      event.type === 'execution.tool.completed' ||
      event.type === 'execution.tool.failed' ||
      event.type.startsWith('mcp.tool_')
    ) {
      projection = { kind: 'process', process: runProcess(), afterSequence: event.sequence };
    } else {
      return;
    }

    const liveRun = this.demoRuns.get(event.runId);
    const transientFrame = this.publishTransientFrame({
      threadId,
      runId: event.runId,
      occurredAt: event.occurredAt,
      ...projection,
      ...(liveRun?.assistantTimeline?.length
        ? { assistantTimeline: liveRun.assistantTimeline.map((segment) => ({ ...segment })) }
        : {}),
    });
    if (projection.kind === 'terminal') {
      this.transientSnapshotByThread.delete(threadId);
    } else if (projection.process) {
      const current = this.transientSnapshotByThread.get(threadId);
      this.transientSnapshotByThread.set(threadId, {
        threadId,
        runId: event.runId,
        streamSequence: transientFrame.streamSequence,
        text: current?.runId === event.runId ? current.text : '',
        ...(current?.runId === event.runId && current.commentaryText
          ? { commentaryText: current.commentaryText }
          : {}),
        ...(current?.runId === event.runId && current.commentarySegments
          ? {
              commentarySegments: current.commentarySegments.map((segment) => ({
                ...segment,
              })),
            }
          : {}),
        ...(current?.runId === event.runId && current.reasoningText
          ? { reasoningText: current.reasoningText }
          : {}),
        ...(current?.runId === event.runId && current.reasoningSegments
          ? {
              reasoningSegments: current.reasoningSegments.map((segment) => ({
                ...segment,
              })),
            }
          : {}),
        ...(liveRun?.assistantTimeline?.length
          ? { assistantTimeline: liveRun.assistantTimeline.map((segment) => ({ ...segment })) }
          : current?.runId === event.runId && current.assistantTimeline
            ? { assistantTimeline: current.assistantTimeline.map((segment) => ({ ...segment })) }
            : {}),
        process: projection.process,
        updatedAt: event.occurredAt,
      });
    }
  }

  private publishTransientFrame(
    input: Omit<ConversationTransientFrame, 'streamSequence'>,
  ): ConversationTransientFrame {
    const streamSequence = (this.transientSequenceByThread.get(input.threadId) ?? 0) + 1;
    this.transientSequenceByThread.set(input.threadId, streamSequence);
    const transientFrame: ConversationTransientFrame = {
      ...input,
      streamSequence,
    };
    this.transientReplay.push(transientFrame);
    if (this.transientReplay.length > MAX_TRANSIENT_REPLAY_FRAMES) {
      this.transientReplay.splice(0, this.transientReplay.length - MAX_TRANSIENT_REPLAY_FRAMES);
    }

    for (const [streamId, subscription] of this.transientSubscriptions) {
      if (
        subscription.socket.destroyed ||
        subscription.threadId !== input.threadId ||
        transientFrame.streamSequence <= subscription.liveCursor
      ) {
        continue;
      }
      subscription.liveCursor = transientFrame.streamSequence;
      const writeFrame = (candidate: ConversationTransientFrame): boolean => {
        try {
          subscription.socket.write(
            encodeFrame({
              id: streamId,
              kind: 'event',
              type: 'conversation.transientFrame',
              payload: { streamId, frame: candidate },
            }),
          );
          return true;
        } catch {
          // 帧超限（大 timeline/process）会抛 "frame exceeds max"。
          return false;
        }
      };
      if (writeFrame(transientFrame)) continue;
      // 超限降级：compact timeline 后重试一次；仍失败则跳过该订阅者
      // （live 终态事件 run.completed/failed 独立发送，不会因此丢失）。
      const degraded: ConversationTransientFrame = {
        ...transientFrame,
        ...(transientFrame.assistantTimeline?.length
          ? {
              assistantTimeline: compactAssistantTimeline(
                transientFrame.assistantTimeline.map((segment) => ({ ...segment })),
                { maxSegments: 32, detailCharacters: 512, finalAnswerCharacters: 8_192 },
              ),
            }
          : {}),
      };
      writeFrame(degraded);
    }
    return transientFrame;
  }

  private subscriptionMatches(subscription: RuntimeEventSubscription, event: Event): boolean {
    return !subscription.categories || subscription.categories.has(event.category);
  }

  private writeLiveEvent(socket: Socket, streamId: string, event: Event): void {
    try {
      socket.write(
        encodeFrame({
          id: streamId,
          kind: 'event',
          type: 'runtime.event',
          payload: { streamId, event },
        }),
      );
    } catch {
      // 单帧超限（超大 payload）：跳过该订阅者，不中断 publishEvent 循环，
      // 也不让 run 循环因帧编码异常而崩（liveCursor 已前移，不重发）。
    }
  }

  start(): Promise<void> {
    // worker 模式（守护进程自拉）：不监听管道（避免与桌面/守护进程抢
    // pipe 名）、不恢复 run、不开网关、不启动调度 tick（唯一调度者约束）。
    if (this.daemonWorker) {
      void this.startedAt; // 保持 startedAt 引用（健康检查依赖启动时间）
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.server = createPipeServer(this.handlers, this.installId);
      const path = pipePathPortable(this.installId);
      this.server.listen(path, () => {
        this.handlers.onReady(path);
        this.resumeDemoRuns();
        // Open gateway: bind on boot when the persisted setting has it enabled,
        // so external CLIs pointed at the fixed port work without opening the UI.
        this.trackBackgroundTask(
          this.syncOpenGatewayFromSettings().catch((error) =>
            console.warn('[runtime] open gateway start failed', error),
          ),
        );
        if (this.scheduler) {
          const recovery = this.scheduler
            .recoverAll()
            .then(() => this.syncOrchestrationEvents())
            .catch((error) => console.warn('[runtime] orchestration recovery failed', error));
          this.trackBackgroundTask(recovery);
        }
        // 双 tick 让位（T5）：守护进程活着 → 关自身调度 tick（唯一调度者）。
        void this.probeDaemonAndStartScheduler().catch((error) =>
          console.warn('[runtime] daemon probe failed, falling back to own tick', error),
        );
        this.startLocalSkillWatch();
        resolve();
      });
      this.server.on('error', (e) => reject(e));
    });
  }

  async stop(): Promise<void> {
    this.runtimeStopped = true;
    this.stopTaskSchedulerHeartbeat();
    if (this.externalEventHeartbeatTimer) {
      clearInterval(this.externalEventHeartbeatTimer);
      this.externalEventHeartbeatTimer = undefined;
    }
    this.localSkillWatchCleanup?.();
    this.localSkillWatchCleanup = undefined;
    // Explicit Runtime/daemon shutdown owns the Kernel process lifecycle. A
    // normal Desktop window close never calls Runtime.stop(), so active turns
    // remain alive across UI disconnects. Durable thread ids remain persisted;
    // only resident app-server processes are stopped here.
    // Explicit shutdown cancels active/queued runs before stopping resident
    // app-server processes. Their finally blocks release both the per-session
    // turn queue and the bounded host lease.
    for (const controller of this.demoRunAborts.values()) controller.abort();
    await this.codexSessionHost.stopAll();
    if (this.externalKernelSessionTails.size > 0) {
      await Promise.allSettled([...this.externalKernelSessionTails.values()]);
    }
    // 投递任务尚未完成 → 向守护进程发 abort（用户主动关闭，app-closed）。
    if (this.dispatchedTasks.size > 0 && !this.daemonWorker) {
      const taskIds = [...this.dispatchedTasks];
      try {
        await sendAbortToDaemon(
          {
            installId: this.installId,
            helloSecret: this.handlers.expectedSecret,
            appVersion: 'sync-think-runtime',
            handshakeTimeoutMs: 2_000,
          },
          taskIds,
        );
      } catch {
        /* 尽力而为；连接超时由客户端内部有界返回。 */
      }
    }
    if (this.daemonCompletionPromises.size > 0) {
      await Promise.allSettled([...this.daemonCompletionPromises]);
    }
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      const server = this.server;
      this.server = null;
      this.subscriptions.clear();
      this.transientSubscriptions.clear();
      server.destroyConnections();
      server.close(() => resolve());
    });
    await this.scheduler?.shutdown();
    await this.openGateway.dispose();
    await Promise.allSettled([...this.backgroundTasks]);
    const preserveBrowserSessions = (this.browserController?.listWaitingHandoffs().length ?? 0) > 0;
    await this.browserHost?.shutdown({ preserveSessions: preserveBrowserSessions });
  }
}

function extractMissingVariables(error: unknown): string[] | undefined {
  const message = error instanceof Error ? error.message : '';
  const match = /variable\(s\):\s*([^.\n]+)/u.exec(message);
  if (!match) return undefined;
  return match[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function browserRecordingErrorCode(error: unknown): string | undefined {
  if (error instanceof RuntimeBrowserRecordingError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code ?? '').trim();
    if (code) return code;
  }
  if (error instanceof Error) {
    const match = /^(browser\.[a-z0-9._-]{1,120})(?::|$)/u.exec(error.message.trim());
    return match?.[1];
  }
  return undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function browserWorkflowErrorCode(error: unknown): string | undefined {
  if (error instanceof RuntimeBrowserWorkflowError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code ?? '').trim();
    if (code) return code;
  }
  if (error instanceof Error) {
    const match = /^(browser\.[a-z0-9._-]{1,120})(?::|$)/u.exec(error.message.trim());
    return match?.[1];
  }
  return undefined;
}

function parseDesktopWaitingResult(value: string): { commandId: string; code: string } | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.commandId !== 'string' ||
      (record.code !== ErrorCode.DESKTOP_USER_INPUT_DETECTED &&
        record.code !== ErrorCode.DESKTOP_COMMAND_INSPECTION_REQUIRED)
    ) {
      return undefined;
    }
    return { commandId: record.commandId, code: record.code };
  } catch {
    return undefined;
  }
}

function projectDesktopWaitingTarget(
  sanitizedArgs: Record<string, unknown>,
): DesktopWaitingCommandSummary['target'] | undefined {
  const target = sanitizedArgs.target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return undefined;
  const window = (target as Record<string, unknown>).window;
  if (!window || typeof window !== 'object' || Array.isArray(window)) return undefined;
  const record = window as Record<string, unknown>;
  const processId =
    typeof record.processId === 'number' &&
    Number.isSafeInteger(record.processId) &&
    record.processId > 0
      ? record.processId
      : undefined;
  const title =
    typeof record.title === 'string' && record.title.trim()
      ? record.title.trim().slice(0, 512)
      : undefined;
  const appId =
    typeof record.appId === 'string' && record.appId.trim()
      ? record.appId.trim().slice(0, 256)
      : undefined;
  if (processId === undefined && title === undefined && appId === undefined) return undefined;
  return {
    ...(processId !== undefined ? { processId } : {}),
    ...(title ? { title } : {}),
    ...(appId ? { appId } : {}),
  };
}

function browserFailureMessage(code: unknown, failureClass: unknown): string {
  if (code === 'browser.origin-denied') return 'Browser origin was denied.';
  if (code === 'browser.profile-path-invalid') return 'Browser Profile path was rejected.';
  if (failureClass === 'timeout') return 'Browser action timed out.';
  if (failureClass === 'crashed') return 'Browser page or session crashed.';
  if (failureClass === 'permission') return 'Browser action was blocked by policy.';
  if (failureClass === 'acceptance') return 'Browser action was not accepted.';
  return 'Browser action failed.';
}
