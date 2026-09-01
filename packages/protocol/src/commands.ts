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
  KernelId,
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
  BrowserRecordingStatus,
  BrowserRecordingStepInput,
  BrowserRecordingStepRecord,
  BrowserRecordingStopReason,
} from '@sync-think/shared';
import { ulid } from '@sync-think/shared';
import type { Feature } from './version.js';

// Command/query separation. Commands carry an `expectedTaskVersion` for
// optimistic concurrency on the shared task state.

export type CommandType =
  | 'runtime.healthcheck'
  | 'runtime.shutdown'
  | 'workspace.create'
  | 'workspace.bindFolder'
  | 'workspace.list'
  | 'workspace.update'
  | 'workspace.delete'
  | 'task.create'
  | 'task.list'
  | 'task.open'
  | 'task.search'
  | 'task.archive'
  | 'task.unarchive'
  | 'task.setParticipationMode'
  | 'task.appendMessage'
  | 'message.attachImages'
  | 'runtime.subscribeEvents'
  | 'runtime.continueEventReplay'
  | 'runtime.unsubscribeEvents'
  | 'conversation.subscribeTransientStream'
  | 'conversation.unsubscribeTransientStream'
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
  | 'provider.reorder'
  | 'provider.addCredential'
  | 'provider.removeCredential'
  | 'provider.revealCredential'
  | 'provider.updateCredential'
  | 'provider.setModelPriorities'
  | 'provider.updateModel'
  | 'provider.removeModel'
  | 'settings.get'
  | 'settings.set'
  | 'bot.channel.get'
  | 'bot.channel.save'
  | 'bot.channel.test'
  | 'bot.channel.wechat.qr.request'
  | 'bot.channel.wechat.qr.check'
  | 'usage.summary'
  | 'agent.get'
  | 'agent.updateBinding'
  | 'agent.list'
  | 'agent.create'
  | 'agent.listVersions'
  | 'agent.createVersion'
  | 'globalAgent.list'
  | 'globalAgent.create'
  | 'globalAgent.update'
  | 'globalAgent.delete'
  | 'team.list'
  | 'team.create'
  | 'team.update'
  | 'team.delete'
  | 'team.startRun'
  | 'team.setRunStatus'
  | 'conversation.list'
  | 'conversation.listMessages'
  | 'conversation.getContextStatus'
  | 'conversation.setContextWindowOverride'
  | 'conversation.getRunProcess'
  | 'conversation.create'
  | 'conversation.rename'
  | 'conversation.setPinned'
  | 'conversation.setArchived'
  | 'conversation.setExecutionMode'
  | 'conversation.setInteractionMode'
  | 'conversation.plan.submit'
  | 'conversation.plan.get'
  | 'conversation.plan.approve'
  | 'conversation.plan.revise'
  | 'conversation.plan.cancel'
  | 'conversation.ask.answer'
  | 'conversation.ask.cancel'
  | 'conversation.ask.pending'
  | 'conversation.upgradeTrack'
  | 'conversation.rebindTarget'
  | 'conversation.delete'
  | 'conversation.sendMessage'
  | 'conversation.compact'
  | 'prompt.enhance'
  | 'prompt.enhance.cancel'
  | 'conversation.listPendingToolApprovals'
  | 'conversation.decideToolApproval'
  | 'conversation.submitBrowserResult'
  | 'browser.profile.list'
  | 'browser.profile.create'
  | 'browser.profile.rename'
  | 'browser.profile.delete'
  | 'browser.profile.listSiteSessions'
  | 'browser.profile.clearSiteSession'
  | 'browser.recording.list'
  | 'browser.recording.get'
  | 'browser.recording.start'
  | 'browser.recording.stop'
  | 'browser.workflow.list'
  | 'browser.workflow.get'
  | 'browser.workflow.createDraft'
  | 'browser.workflow.createRevisionDraft'
  | 'browser.workflow.submit'
  | 'browser.workflow.review'
  | 'browser.workflow.execute'
  | 'browser.workflow.approveAndExecute'
  | 'browser.handoff.listWaiting'
  | 'browser.handoff.continue'
  | 'browser.handoff.cancel'
  | 'desktop.command.listWaiting'
  | 'desktop.command.continue'
  | 'desktop.command.cancel'
  | 'skill.import'
  | 'skill.importRemote'
  | 'skill.market.list'
  | 'skill.market.install'
  | 'skill.local.inspect'
  | 'skill.local.scan'
  | 'skill.local.import'
  | 'skill.list'
  | 'skill.get'
  | 'skill.delete'
  | 'skill.setEnabled'
  | 'mcp.register'
  | 'mcp.registerRemote'
  | 'mcp.list'
  | 'mcp.setEnabled'
  | 'mcp.delete'
  | 'capability.workspace.list'
  | 'capability.workspace.setActive'
  | 'capability.governance.list'
  | 'capability.publishDraft.save'
  | 'capability.publishDraft.list'
  | 'capability.publishDraft.get'
  | 'capability.publishDraft.submit'
  | 'capability.organize.preview'
  | 'capability.organize.getLatest'
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
  | 'goal.set'
  | 'goal.get'
  | 'goal.clear'
  | 'goal.pause'
  | 'goal.resume'
  | 'scheduledTask.create'
  | 'scheduledTask.list'
  | 'scheduledTask.update'
  | 'scheduledTask.delete'
  | 'scheduledTask.trigger'
  | 'scheduledTask.history'
  | 'activity.listRuns'
  | 'activity.listExternalEvents'
  | 'activity.retryAnchor'
  | 'kernel.detect'
  | 'kernel.recycle'
  | 'gateway.status'
  | 'gateway.logs'
  | 'gateway.logs.clear'
  | 'data.storageStats'
  | 'data.export'
  | 'data.import'
  | 'data.backup'
  | 'data.compactStorage'
  | 'data.cleanConversations'
  | 'data.cleanEmptyAttachmentDirectories';

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

/** Empty for Phase 0; later carries negotiated feature masks. */
export type HealthcheckPayload = Record<string, never>;

export interface HealthcheckResponse {
  runtimePid: number;
  uptimeMs: number;
  protocolVersion: number;
  features: Feature[];
  inFlightRuns: number;
  inFlightRunIds: string[];
  eventSequence: number;
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

/** Reserved for future filters; currently unused. */
export type ListWorkspacesPayload = Record<string, never>;

export interface WorkspaceSummary {
  workspaceId: WorkspaceId;
  folderPath?: string;
  name: string;
  /** Optional emoji / short icon glyph (stored in ui prefs). */
  icon?: string;
  /** Custom sort position in the folder tab row (stored in ui prefs). */
  sortOrder?: number;
  /** Hidden from the folder tab row (stored in ui prefs; data untouched). */
  hidden?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListWorkspacesResponse {
  workspaces: WorkspaceSummary[];
}

export interface UpdateWorkspacePayload {
  workspaceId: WorkspaceId;
  name?: string;
  /** Set/replace bound folder path. */
  folderPath?: string;
  /**
   * Workspace icon glyph. Pass null to clear; omit to keep current.
   * Stored in workspace.ui_prefs_json.
   */
  icon?: string | null;
  /**
   * Custom sort position in the folder tab row. Omit to keep current.
   * Stored in workspace.ui_prefs_json.
   */
  sortOrder?: number;
  /**
   * Hide from the folder tab row (does not delete the workspace or its data).
   * Omit to keep current. Stored in workspace.ui_prefs_json.
   */
  hidden?: boolean;
}

export interface UpdateWorkspaceResponse {
  workspace: WorkspaceSummary;
}

export interface DeleteWorkspacePayload {
  workspaceId: WorkspaceId;
}

export interface DeleteWorkspaceResponse {
  workspaceId: WorkspaceId;
  deleted: boolean;
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

/**
 * Local image attachment for multimodal chat (live run only).
 * Prefer `stagingPath` so large images do not exceed the 1 MiB pipe frame.
 * `dataUrl` remains as a small-image fallback.
 */
export interface AppendMessageImage {
  /** Stable compose attachment id; used as the workspace filename when available. */
  id?: string;
  name: string;
  mimeType: string;
  /** Absolute path written by Desktop under the shared staging directory. */
  stagingPath?: string;
  /** data:image/...;base64,... — only for small images that fit the pipe frame. */
  dataUrl?: string;
}

/** Desktop-only context used to materialize pasted images before Runtime dispatch. */
export interface AppendMessageAttachmentContext {
  conversationId: string;
  workspacePath?: string;
}

/** Durable lightweight image reference embedded in `message.appended`. */
export interface MessageImageReference {
  id: string;
  name: string;
  mimeType: string;
  /** Opaque basename under the application-managed chat image directory. */
  storageRef: string;
}

export interface AppendMessagePayload {
  threadId: ThreadId;
  /** Optimistic concurrency: must match last seen task version. */
  expectedTaskVersion: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  /** May be empty when images are provided. */
  text: string;
  /** Resolve model via priority 搂5.3. If absent, use Agent default. */
  agentVersionId?: AgentVersionId;
  modelId?: ModelId;
  credentialRefId?: CredentialRefId;
  /**
   * Kernel selected for this turn (model-picker kernel grouping). Absent keeps
   * the conversation's previous kernel; 'native' is the in-process runtime.
   */
  kernelId?: KernelId;
  /**
   * Compose 推理强度（auto/off/low/medium/high…）。
   * Runtime 透传到 ProviderCallRequest.reasoningEffort；auto 时 adapter 不带参。
   */
  reasoningEffort?: string;
  /**
   * Compose 联网开关。为 true 时本轮 run 暴露 web_search / web_fetch 工具。
   * 不落库；仅影响当前 live run。
   */
  networkEnabled?: boolean;
  /**
   * 批准方案后的执行轮标志。为 true 时本轮 run 强制使用 plan-act 设置中的
   * 执行模型（actModelId + actReasoningEffort）；普通 execute 模式消息不带
   * 此标志，plan-act 不干预。不落库；仅影响当前 live run。
   */
  planExecuting?: boolean;
  /**
   * Built-in product-help turn. Runtime adds the SYNC-THINK help contract to
   * the system instructions; the flag is transient and never changes mode.
   */
  helpMode?: boolean;
  /**
   * Exact immutable Skill versions selected for this turn.
   * Undefined keeps the legacy Agent-default behavior; [] explicitly loads none.
   */
  skillVersionIds?: string[];
  /** Optional vision inputs for this user turn (live run only). */
  images?: AppendMessageImage[];
  /** Removed by Desktop after images are materialized; never enters model context. */
  attachmentContext?: AppendMessageAttachmentContext;
  /** Set when assistant message originates from a Run step. */
  runId?: RunId;
  stepId?: string;
}

export interface AppendMessageResponse {
  messageId: MessageId;
  taskVersion: number;
  /** Present when the first user request replaced a generated placeholder title. */
  taskTitle?: string;
  taskGoal?: string;
  /** Optional: streaming id assigned if this user message triggers a model call. */
  streamId?: string;
  /** Desktop-resolved durable image URLs returned after staging. */
  images?: Array<MessageImageReference & { url?: string }>;
  /**
   * How attached images reached the run: 'forwarded' (vision-capable model),
   * 'materialized' (legacy: saved into the workspace), 'described' (replaced
   * by a configured vision-model description), 'ocr' (replaced by host-side
   * Windows OCR text), or 'failed' (no usable image-derived text).
   */
  imagesMode?: 'forwarded' | 'materialized' | 'described' | 'ocr' | 'failed';
}

/** kernel.detect response: registry sweep with install state + capabilities. */
export interface KernelDetectResponse {
  kernels: import('@sync-think/shared').KernelDetectionResult[];
}

export interface KernelRecycleResponse {
  kernelId: 'codex' | 'claude-code';
  recycled: number;
  deferred: number;
}

export interface AttachMessageImagesPayload {
  threadId: ThreadId;
  messageId: MessageId;
  images: MessageImageReference[];
}

export interface AttachMessageImagesResponse {
  attached: number;
}

export interface SubscribeEventsPayload {
  /** Only send events with workspace-scoped sequence greater than cursor. */
  afterCursor: number;
  /** Optional tie-breaker for legacy rows that share afterCursor. */
  afterEventId?: string;
  /** Filters by category / source; empty = all. */
  categories?: import('@sync-think/shared').EventCategory[];
}

export interface ContinueEventReplayPayload {
  streamId: string;
  /** Must equal the last page cursor committed for this stream. */
  afterCursor: number;
  /** Must equal the last page event-id cursor when one was returned. */
  afterEventId?: string;
}

export interface UnsubscribeEventsPayload {
  streamId: string;
}

/**
 * Subscribe to non-durable chat output for one message thread. The cursor is
 * thread-local and independent from the durable Runtime event sequence.
 */
export interface SubscribeConversationTransientStreamPayload {
  threadId: ThreadId;
  /** Only replay frames whose thread-local streamSequence is greater than this cursor. */
  afterStreamSequence?: number;
}

export interface UnsubscribeConversationTransientStreamPayload {
  streamId: string;
}

export type ConversationTransientFrameKind =
  'text' | 'commentary' | 'reasoning' | 'process' | 'terminal';
export type ConversationTransientTerminalState = 'completed' | 'failed' | 'cancelled';

/**
 * One contiguous user-visible assistant commentary fragment between durable
 * execution boundaries. `afterSequence` identifies the latest durable event
 * that had happened when the fragment started, which lets Desktop interleave it
 * with projected tool steps without persisting every provider token as an Event.
 */
export interface CommentaryTimelineSegment {
  id: string;
  text: string;
  startedAt: string;
  completedAt?: string;
  afterSequence?: number;
}

/**
 * Legacy persisted provider reasoning-summary segment. New user-visible
 * execution timelines use CommentaryTimelineSegment instead.
 */
export type ReasoningTimelineSegment = CommentaryTimelineSegment;

/** Short-lived output frame. It is never written to the durable event store. */
export interface ConversationTransientFrame {
  threadId: ThreadId;
  runId: RunId;
  /** Monotonic within threadId only. */
  streamSequence: number;
  kind: ConversationTransientFrameKind;
  textDelta?: string;
  /** Latest durable Runtime event sequence when this transient frame was emitted. */
  afterSequence?: number;
  terminalState?: ConversationTransientTerminalState;
  errorMessage?: string;
  /** Already-projected run-local process snapshot; never raw durable events. */
  process?: RunProcessView;
  /** Exact ordered assistant turn snapshot after this frame. */
  assistantTimeline?: import('./assistant-turn.js').AssistantTurnSegment[];
  occurredAt: string;
}

export interface ConversationTransientSnapshot {
  threadId: ThreadId;
  runId: RunId;
  /** Latest thread cursor represented by this snapshot. */
  streamSequence: number;
  text: string;
  commentaryText?: string;
  commentarySegments?: CommentaryTimelineSegment[];
  /** Provider reasoning summary kept for diagnostics and legacy recovery only. */
  reasoningText?: string;
  /** Legacy provider reasoning timeline kept for backward-compatible snapshots. */
  reasoningSegments?: ReasoningTimelineSegment[];
  /** Exact ordered assistant turn snapshot; preferred by new renderers. */
  assistantTimeline?: import('./assistant-turn.js').AssistantTurnSegment[];
  process?: RunProcessView;
  updatedAt: string;
}

export interface SubscribeConversationTransientStreamResponse {
  streamId: string;
  threadId: ThreadId;
  replayedFrames: ConversationTransientFrame[];
  /** Current active run state; lets reset/reconnect recover without durable deltas. */
  snapshot?: ConversationTransientSnapshot;
  /** Greatest retained/current sequence observed for this thread. */
  latestStreamSequence: number;
  /** True when the requested cursor predates the bounded replay window. */
  resetRequired: boolean;
}

export interface UnsubscribeConversationTransientStreamResponse {
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
  /** 0026: priority chain position inside the provider — 0 is the primary model. */
  priority: number;
  /** 0026: optional pinned credential for this model (relay-station key groups). */
  credentialRefId?: import('@sync-think/shared').CredentialRefId;
  /** Parsed from limitsJson when present (e.g. 372000 → “372k 上下文”). */
  contextWindow?: number;
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
  /** 0026: entry toggle — disabled entries hide from pickers but keep config. */
  enabled: boolean;
  /** 0026: manual ordering; first enabled provider is the default entry. */
  sortOrder: number;
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
  /** 0026: toggle the entry on/off (disabled hides from pickers). */
  enabled?: boolean;
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

/** Reserved for filters. */
export type ListProvidersPayload = Record<string, never>;

export interface ListProvidersResponse {
  providers: ProviderSummary[];
}

export interface DiscoverModelsPayload {
  providerId: import('@sync-think/shared').ProviderId;
  /** Prefer a specific credential; defaults to first in default group. */
  credentialRefId?: import('@sync-think/shared').CredentialRefId;
  /**
   * When false, only probe the provider and return discovered ids —
   * do NOT write models into the local catalog. Used by the NewMax-style
   * "import models" picker and connection test. Default true for back-compat.
   */
  persist?: boolean;
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
  /** Wall-clock latency of the discovery hop in milliseconds. */
  latencyMs?: number;
}

export interface AddModelsPayload {
  providerId: import('@sync-think/shared').ProviderId;
  protocol: import('@sync-think/shared').ProtocolFamily;
  models: Array<{
    providerModelId: string;
    displayName?: string;
    capabilities?: import('@sync-think/shared').CapabilityTag[];
    /** Optional context window size in tokens (persisted into limitsJson). */
    contextWindow?: number;
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

// --- 0026: model-source config (NewMax-parity settings > models) ---

export interface ReorderProvidersPayload {
  /** Full desired order; providers not listed keep relative order after these. */
  orderedProviderIds: string[];
}

export interface ReorderProvidersResponse {
  providers: ProviderSummary[];
}

export interface AddProviderCredentialPayload {
  providerId: import('@sync-think/shared').ProviderId;
  /** Plaintext only for this hop; Runtime stores into secure-store and never echoes it. */
  apiKey: string;
  label?: string;
}

export interface AddProviderCredentialResponse {
  provider: ProviderSummary;
  credentialRefId: import('@sync-think/shared').CredentialRefId;
}

export interface RemoveProviderCredentialPayload {
  providerId: import('@sync-think/shared').ProviderId;
  credentialRefId: import('@sync-think/shared').CredentialRefId;
}

export interface RemoveProviderCredentialResponse {
  provider: ProviderSummary;
  removed: boolean;
}

/**
 * Explicit short-lived reveal for a single saved credential.
 * Only returned on this dedicated hop — never on list/summary responses.
 * Renderer must clear plaintext on hide, blur, provider switch, and timeout.
 */
export interface RevealProviderCredentialPayload {
  providerId: import('@sync-think/shared').ProviderId;
  credentialRefId: import('@sync-think/shared').CredentialRefId;
}

export interface RevealProviderCredentialResponse {
  providerId: import('@sync-think/shared').ProviderId;
  credentialRefId: import('@sync-think/shared').CredentialRefId;
  label: string;
  /** Plaintext only for this reveal hop. */
  apiKey: string;
  /** Suggested client-side hide deadline (ISO). */
  expiresAt: string;
}

/**
 * Update one credential by id: optional label and/or secret replacement.
 * Plaintext apiKey is hop-only; Runtime stores into secure-store and never echoes it.
 */
export interface UpdateProviderCredentialPayload {
  providerId: import('@sync-think/shared').ProviderId;
  credentialRefId: import('@sync-think/shared').CredentialRefId;
  label?: string;
  /** Optional plaintext secret replacement; omit/empty keeps existing secret. */
  apiKey?: string;
}

export interface UpdateProviderCredentialResponse {
  provider: ProviderSummary;
  credentialRefId: import('@sync-think/shared').CredentialRefId;
  secretRotated: boolean;
}

export interface SetModelPrioritiesPayload {
  providerId: import('@sync-think/shared').ProviderId;
  /** Desired chain order; index 0 is the primary model. */
  entries: Array<{
    modelId: import('@sync-think/shared').ModelId;
    /** Pin a credential for this model; null clears the pin; omit keeps current. */
    credentialRefId?: import('@sync-think/shared').CredentialRefId | null;
  }>;
}

export interface SetModelPrioritiesResponse {
  providerId: import('@sync-think/shared').ProviderId;
  models: ProviderModelSummary[];
}

export interface UpdateModelPayload {
  providerId: import('@sync-think/shared').ProviderId;
  modelId: import('@sync-think/shared').ModelId;
  displayName?: string;
  /**
   * Context window in tokens. Pass null to clear; omit to keep current.
   * Persisted into model.limitsJson.contextWindow.
   */
  contextWindow?: number | null;
}

export interface UpdateModelResponse {
  providerId: import('@sync-think/shared').ProviderId;
  model: ProviderModelSummary;
}

export interface RemoveModelPayload {
  providerId: import('@sync-think/shared').ProviderId;
  modelId: import('@sync-think/shared').ModelId;
}

export interface RemoveModelResponse {
  providerId: import('@sync-think/shared').ProviderId;
  removed: boolean;
}

// --- 0026: app-level settings (vision fallback, plan & act) ---

export interface GetSettingsPayload {
  /** Omit for all settings. */
  keys?: string[];
}

export interface GetSettingsResponse {
  settings: Record<string, unknown>;
}

export interface SetSettingPayload {
  key: string;
  value: unknown;
}

export interface SetSettingResponse {
  key: string;
  value: unknown;
  updatedAt: string;
}

// --- 0026: usage statistics (aggregated from durable runtime events) ---

export interface UsageSummaryPayload {
  /** Restrict to the trailing N days; omit for all time. */
  sinceDays?: number;
  /** Restrict provider request usage to one durable Task. */
  taskId?: string;
}

export interface UsageSummaryRow {
  modelId: string;
  providerId?: string;
  providerModelId?: string;
  purpose?: import('@sync-think/shared').ProviderUsagePurpose;
  displayName?: string;
  providerName?: string;
  requests: number;
  succeededRequests: number;
  failedRequests: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokensHit?: number;
  cachedTokensCreated?: number;
  reasoningTokens: number;
  totalTokens: number;
  totalCost?: number;
  currency?: 'USD' | 'CNY';
  averageLatencyMs?: number;
  lastUsedAt?: string;
}

/** One real provider request reconstructed from provider.usage + terminal run events. */
export interface UsageRequestRow {
  requestId: string;
  taskId?: string;
  runId?: string;
  stepId?: string;
  agentContextThreadId?: string;
  contextEpochId?: string;
  occurredAt: string;
  modelId: string;
  providerId?: string;
  providerModelId?: string;
  purpose?: import('@sync-think/shared').ProviderUsagePurpose;
  displayName?: string;
  providerName?: string;
  tokensIn: number;
  tokensOut: number;
  /** Present only when the provider reports cache usage. */
  cachedTokensHit?: number;
  cachedTokensCreated?: number;
  reasoningTokens?: number;
  totalTokens: number;
  /** Runtime event-level outcome; this is not fabricated from HTTP status codes. */
  status: 'success' | 'failed' | 'unknown';
  latencyMs?: number;
  errorMessage?: string;
  estimatedCost?: number;
  estimatedCostBreakdown?: {
    input: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
    total: number;
  };
  currency?: 'USD' | 'CNY';
}

export interface UsageToolFailureRow {
  occurredAt: string;
  toolName: string;
  modelId?: string;
  displayName?: string;
  conversationTitle?: string;
  errorSummary: string;
}

export interface UsageToolRow {
  toolName: string;
  calls: number;
  successes: number;
  failures: number;
  successRate: number;
  lastUsedAt?: string;
}

export interface UsageToolModelRow {
  modelId: string;
  providerId?: string;
  displayName?: string;
  calls: number;
  successes: number;
  failures: number;
  successRate: number;
}

export interface ModelPricingEntry {
  modelId: string;
  displayName: string;
  currency: 'USD' | 'CNY';
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
}

/**
 * Official-ish baseline prices (USD / 1M tokens) used when the user has not
 * customized `app_setting['model-pricing']` yet.
 *
 * Sources (as of 2026-07):
 * - Anthropic Claude API pricing (platform.claude.com) — 5m cache write = 1.25× input, cache hit = 0.1× input
 * - OpenAI API pricing (developers.openai.com) — standard short-context tier; cache write not billed separately → 0
 * - xAI Grok pricing (docs.x.ai) — <200k context tier
 *
 * modelId is matched against both internal ModelId and providerModelId.
 */
export const DEFAULT_MODEL_PRICING: readonly ModelPricingEntry[] = [
  // ── Anthropic Claude ────────────────────────────────────────────────────
  {
    modelId: 'claude-fable-5',
    displayName: 'Claude Fable 5',
    currency: 'USD',
    inputPerMillion: 10,
    outputPerMillion: 50,
    cacheReadPerMillion: 1,
    cacheWritePerMillion: 12.5,
  },
  {
    modelId: 'claude-mythos-5',
    displayName: 'Claude Mythos 5',
    currency: 'USD',
    inputPerMillion: 10,
    outputPerMillion: 50,
    cacheReadPerMillion: 1,
    cacheWritePerMillion: 12.5,
  },
  {
    modelId: 'claude-opus-5',
    displayName: 'Claude Opus 5',
    currency: 'USD',
    inputPerMillion: 5,
    outputPerMillion: 25,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 6.25,
  },
  {
    modelId: 'claude-opus-4-8',
    displayName: 'Claude Opus 4.8',
    currency: 'USD',
    inputPerMillion: 5,
    outputPerMillion: 25,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 6.25,
  },
  {
    modelId: 'claude-opus-4-7',
    displayName: 'Claude Opus 4.7',
    currency: 'USD',
    inputPerMillion: 5,
    outputPerMillion: 25,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 6.25,
  },
  {
    modelId: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    currency: 'USD',
    inputPerMillion: 5,
    outputPerMillion: 25,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 6.25,
  },
  {
    modelId: 'claude-opus-4-5',
    displayName: 'Claude Opus 4.5',
    currency: 'USD',
    inputPerMillion: 5,
    outputPerMillion: 25,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 6.25,
  },
  {
    modelId: 'claude-opus-4-5-20251101',
    displayName: 'Claude Opus 4.5',
    currency: 'USD',
    inputPerMillion: 5,
    outputPerMillion: 25,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 6.25,
  },
  {
    modelId: 'claude-opus-4-1',
    displayName: 'Claude Opus 4.1',
    currency: 'USD',
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
  },
  {
    modelId: 'claude-opus-4-1-20250805',
    displayName: 'Claude Opus 4.1',
    currency: 'USD',
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
  },
  {
    modelId: 'claude-opus-4',
    displayName: 'Claude Opus 4',
    currency: 'USD',
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
  },
  {
    modelId: 'claude-opus-4-20250514',
    displayName: 'Claude Opus 4',
    currency: 'USD',
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
  },
  {
    // Introductory $2/$10 through 2026-08-31; store intro rate while it is active.
    modelId: 'claude-sonnet-5',
    displayName: 'Claude Sonnet 5',
    currency: 'USD',
    inputPerMillion: 2,
    outputPerMillion: 10,
    cacheReadPerMillion: 0.2,
    cacheWritePerMillion: 2.5,
  },
  {
    modelId: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    currency: 'USD',
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  {
    modelId: 'claude-sonnet-4-5',
    displayName: 'Claude Sonnet 4.5',
    currency: 'USD',
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  {
    modelId: 'claude-sonnet-4-5-20250929',
    displayName: 'Claude Sonnet 4.5',
    currency: 'USD',
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  {
    modelId: 'claude-sonnet-4',
    displayName: 'Claude Sonnet 4',
    currency: 'USD',
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  {
    modelId: 'claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5',
    currency: 'USD',
    inputPerMillion: 1,
    outputPerMillion: 5,
    cacheReadPerMillion: 0.1,
    cacheWritePerMillion: 1.25,
  },
  {
    modelId: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    currency: 'USD',
    inputPerMillion: 1,
    outputPerMillion: 5,
    cacheReadPerMillion: 0.1,
    cacheWritePerMillion: 1.25,
  },
  {
    modelId: 'claude-3-5-haiku-20241022',
    displayName: 'Claude 3.5 Haiku',
    currency: 'USD',
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheReadPerMillion: 0.08,
    cacheWritePerMillion: 1,
  },
  {
    modelId: 'claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet',
    currency: 'USD',
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },

  // ── OpenAI GPT-5 family (standard short-context tier) ───────────────────
  {
    modelId: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    currency: 'USD',
    inputPerMillion: 5,
    outputPerMillion: 30,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    currency: 'USD',
    inputPerMillion: 2.5,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.25,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    currency: 'USD',
    inputPerMillion: 1,
    outputPerMillion: 6,
    cacheReadPerMillion: 0.1,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'gpt-5.5',
    displayName: 'GPT-5.5',
    currency: 'USD',
    inputPerMillion: 5,
    outputPerMillion: 30,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'gpt-5.5-pro',
    displayName: 'GPT-5.5 Pro',
    currency: 'USD',
    inputPerMillion: 30,
    outputPerMillion: 180,
    cacheReadPerMillion: 0,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'gpt-5.4',
    displayName: 'GPT-5.4',
    currency: 'USD',
    inputPerMillion: 2.5,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.25,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'gpt-5.4-mini',
    displayName: 'GPT-5.4 Mini',
    currency: 'USD',
    inputPerMillion: 0.75,
    outputPerMillion: 4.5,
    cacheReadPerMillion: 0.075,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'gpt-5.4-nano',
    displayName: 'GPT-5.4 Nano',
    currency: 'USD',
    inputPerMillion: 0.2,
    outputPerMillion: 1.25,
    cacheReadPerMillion: 0.02,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'gpt-5.4-pro',
    displayName: 'GPT-5.4 Pro',
    currency: 'USD',
    inputPerMillion: 30,
    outputPerMillion: 180,
    cacheReadPerMillion: 0,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'gpt-5.3-codex',
    displayName: 'GPT-5.3 Codex',
    currency: 'USD',
    inputPerMillion: 1.75,
    outputPerMillion: 14,
    cacheReadPerMillion: 0.175,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'gpt-4o',
    displayName: 'GPT-4o',
    currency: 'USD',
    inputPerMillion: 2.5,
    outputPerMillion: 10,
    cacheReadPerMillion: 1.25,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    currency: 'USD',
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cacheReadPerMillion: 0.075,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'gpt-4.1',
    displayName: 'GPT-4.1',
    currency: 'USD',
    inputPerMillion: 2,
    outputPerMillion: 8,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 Mini',
    currency: 'USD',
    inputPerMillion: 0.4,
    outputPerMillion: 1.6,
    cacheReadPerMillion: 0.1,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'o3',
    displayName: 'o3',
    currency: 'USD',
    inputPerMillion: 2,
    outputPerMillion: 8,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'o4-mini',
    displayName: 'o4-mini',
    currency: 'USD',
    inputPerMillion: 1.1,
    outputPerMillion: 4.4,
    cacheReadPerMillion: 0.275,
    cacheWritePerMillion: 0,
  },

  // ── xAI Grok (<200k context tier) ───────────────────────────────────────
  {
    modelId: 'grok-4.5',
    displayName: 'Grok 4.5',
    currency: 'USD',
    inputPerMillion: 2,
    outputPerMillion: 6,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'grok-4.3',
    displayName: 'Grok 4.3',
    currency: 'USD',
    inputPerMillion: 1.25,
    outputPerMillion: 2.5,
    cacheReadPerMillion: 0.2,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'grok-4.20-0309-reasoning',
    displayName: 'Grok 4.20 Reasoning',
    currency: 'USD',
    inputPerMillion: 1.25,
    outputPerMillion: 2.5,
    cacheReadPerMillion: 0.2,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'grok-4.20-0309-non-reasoning',
    displayName: 'Grok 4.20',
    currency: 'USD',
    inputPerMillion: 1.25,
    outputPerMillion: 2.5,
    cacheReadPerMillion: 0.2,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'grok-build-0.1',
    displayName: 'Grok Build 0.1',
    currency: 'USD',
    inputPerMillion: 1,
    outputPerMillion: 2,
    cacheReadPerMillion: 0.2,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'grok-4',
    displayName: 'Grok 4',
    currency: 'USD',
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.75,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'grok-3',
    displayName: 'Grok 3',
    currency: 'USD',
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.75,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'grok-3-mini',
    displayName: 'Grok 3 Mini',
    currency: 'USD',
    inputPerMillion: 0.3,
    outputPerMillion: 0.5,
    cacheReadPerMillion: 0.075,
    cacheWritePerMillion: 0,
  },

  // ── Zhipu / GLM (public CNY list prices converted at face value as CNY) ─
  {
    modelId: 'z-ai/glm-5.2',
    displayName: 'GLM-5.2',
    currency: 'CNY',
    inputPerMillion: 4,
    outputPerMillion: 16,
    cacheReadPerMillion: 0,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'glm-5.2',
    displayName: 'GLM-5.2',
    currency: 'CNY',
    inputPerMillion: 4,
    outputPerMillion: 16,
    cacheReadPerMillion: 0,
    cacheWritePerMillion: 0,
  },
  {
    modelId: 'glm-4.5',
    displayName: 'GLM-4.5',
    currency: 'CNY',
    inputPerMillion: 2,
    outputPerMillion: 8,
    cacheReadPerMillion: 0,
    cacheWritePerMillion: 0,
  },
];

export interface UsageSummaryResponse {
  rows: UsageSummaryRow[];
  requests: UsageRequestRow[];
  tools: UsageToolRow[];
  toolModels: UsageToolModelRow[];
  toolFailures: UsageToolFailureRow[];
  pricing: ModelPricingEntry[];
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostByCurrency: Partial<Record<'USD' | 'CNY', number>>;
  /** Absent until the active providers report cache accounting. */
  totalCachedTokensHit?: number;
  totalCachedTokensCreated?: number;
  totalReasoningTokens: number;
  totalTokens: number;
}

// --- Agent binding (persistent default / fallback 搂5.3) ---

export interface AgentBindingSummary {
  agentId: import('@sync-think/shared').AgentId;
  agentVersionId: import('@sync-think/shared').AgentVersionId;
  version: number;
  name: string;
  role: string;
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

/** Reserved for future workspace/role filters. */
export type ListAgentsPayload = Record<string, never>;

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

export type SkillOriginType = 'local' | 'market' | 'derived';

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
  /** Global Compose/runtime availability. */
  enabled: boolean;
  /** Installation lineage used by the capability center. */
  originType: SkillOriginType;
  /** Stable source pointer, for example market://skills/project-bootstrap. */
  originRef?: string;
  /** Immutable market/local version this local derived copy was created from. */
  derivedFromSkillVersionId?: string;
  createdAt: string;
}

export interface ImportSkillPayload {
  /** Full SKILL.md source text (frontmatter + body). */
  skillMd: string;
  /** Defaults to local. Market edits must be imported as derived. */
  originType?: SkillOriginType;
  /** Stable source pointer for market and derived versions. */
  originRef?: string;
  /** Required when originType is derived. */
  derivedFromSkillVersionId?: string;
  /** Preserve the immutable Skill family when creating a new local version. */
  skillId?: string;
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

/** Fetch a remote SKILL.md and import it as an immutable market version. */
export interface ImportRemoteSkillPayload {
  /** Absolute HTTP(S) URL to a SKILL.md document (GitHub blob URLs are normalized). */
  url: string;
  /** Optional stable source pointer; defaults to the normalized response URL. */
  originRef?: string;
  /** Preserve an existing Skill family when importing a remote update. */
  skillId?: string;
}

export interface ImportRemoteSkillResponse extends ImportSkillResponse {
  sourceUrl: string;
  fetchedBytes: number;
}

// --- 作者 Skill 市场（Runtime 持有目录和完整安装语义） ---

export interface SkillMarketItemSummary {
  /** Stable publisher-scoped package id. */
  id: string;
  /** Filesystem-safe package slug. */
  slug: string;
  name: string;
  category: string;
  description: string;
  author: string;
  version: string;
  icon?: string;
  installCount?: number;
}

export interface ListSkillMarketResponse {
  items: SkillMarketItemSummary[];
}

export interface InstallSkillMarketPayload {
  marketSkillId: string;
}

export interface InstallSkillMarketResponse extends ImportSkillResponse {
  item: SkillMarketItemSummary;
  /** Complete package directories copied into the managed Skill library. */
  installedPaths: string[];
}

// --- 本地 Skill 发现与目录安装（对齐 NewMax 的 Skill library 语义） ---

export type LocalSkillSourceType = 'global' | 'workspace' | 'plugin' | 'user';

export interface LocalSkillSourceSummary {
  /** Skill 根目录绝对路径。 */
  directory: string;
  type: LocalSkillSourceType;
  label: string;
  workspaceId?: string;
  exists: boolean;
  watching: boolean;
}

export interface LocalSkillCandidate {
  /** 文件绝对路径。 */
  path: string;
  /** 包含 SKILL.md 及 scripts/assets 的完整 Skill 文件夹。 */
  skillDirectory: string;
  /** SKILL.md 所在目录名（skill 名候选）。 */
  folderName: string;
  /** frontmatter 解析的 name（若有）。 */
  name?: string;
  description?: string;
  /** 指令正文首行摘要（≤120 字）。 */
  summary?: string;
  /** 是否已导入（skillId 去重）。 */
  imported: boolean;
  /** 已导入时的 skillId。 */
  skillId?: string;
  sizeBytes: number;
  modifiedAt: string;
  sourceType?: LocalSkillSourceType;
  sourceLabel?: string;
  workspaceId?: string;
  /** 同一物理 Skill 由多个工作区插件配置启用时的全部工作区。 */
  workspaceIds?: string[];
}

export interface SkillLocalScanPayload {
  /** 是否强制重扫（默认返回缓存 + watch 增量）。 */
  refresh?: boolean;
}

export interface SkillLocalScanResponse {
  /** SYNC-THINK 全局 Skill 库路径（兼容旧客户端）。 */
  directory: string;
  candidates: LocalSkillCandidate[];
  /** 全局 Skill 库是否存在（兼容旧客户端）。 */
  exists: boolean;
  /** 任一来源 watch 是否生效（兼容旧客户端）。 */
  watching: boolean;
  sources: LocalSkillSourceSummary[];
}

export interface SkillLocalInspectPayload {
  /** 用户选择的 Skill 文件夹、SKILL.md 或 ZIP 文件。 */
  path: string;
}

export interface SkillLocalInspectItem {
  folderName: string;
  name: string;
  description: string;
  skillDirectory: string;
  skillMdPath: string;
  hasScripts: boolean;
}

export interface SkillLocalInspectResponse {
  sourcePath: string;
  sourceType: 'folder' | 'file' | 'zip';
  skills: SkillLocalInspectItem[];
}

export type SkillLocalInstallScope =
  { type: 'global' } | { type: 'workspace'; workspaceId: string };

export interface SkillLocalImportPayload {
  /** 用户选择的 Skill 文件夹、SKILL.md 或 ZIP 文件。 */
  path: string;
  scope?: SkillLocalInstallScope;
  overwrite?: boolean;
}

export interface SkillLocalImportResponse {
  /** 第一个导入结果，保留旧调用方读取方式。 */
  skill?: SkillVersionSummary;
  deduped?: boolean;
  permissionDiff?: SkillPermissionDiffSummary;
  reapprovalRequest?: ApprovalRequestSummary;
  path: string;
  sourcePath: string;
  installedPaths: string[];
  skillNames: string[];
  imports: ImportSkillResponse[];
  conflictNames: string[];
  scope: SkillLocalInstallScope;
}

export interface ListSkillsPayload {
  limit?: number;
  /** Current workspace for ordinary Compose and "/" discovery. */
  workspaceId?: string;
  /** Exact immutable versions for an Agent picker; metadata only, max Agent allowlist size. */
  skillVersionIds?: string[];
}

export interface ListSkillsResponse {
  skills: SkillVersionSummary[];
}

export interface GetSkillPayload {
  /** Exact immutable Skill version to read. */
  skillVersionId: string;
}

export interface GetSkillResponse {
  skill: SkillVersionSummary;
  /** Full SKILL.md source (frontmatter + body) — display only, never executed. */
  sourceMd: string;
  /** Parsed body without frontmatter. */
  body: string;
}

export interface DeleteSkillPayload {
  /** Exact immutable Skill version to remove. */
  skillVersionId: string;
}

export interface DeleteSkillResponse {
  deleted: boolean;
  skillVersionId: string;
}

export interface SetSkillEnabledPayload {
  skillVersionId: string;
  enabled: boolean;
}

export interface SetSkillEnabledResponse {
  skill: SkillVersionSummary;
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
  /** Global availability for automatic MCP discovery. */
  enabled: boolean;
  maxOutputBytes: number;
  timeoutMs: number;
  notes: string;
  /** True when a remote authentication key is configured. */
  authConfigured?: boolean;
  /** Header scheme used for the stored key. */
  authScheme?: 'bearer' | 'api-key' | string;
  /**
   * Plaintext remote auth key, echoed back for the register/update dialog.
   * Product requirement: the latest key is shown again when reopening the
   * dialog, so keys are stored in plaintext app settings (not SecureStore).
   */
  authKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterMcpServerPayload {
  name: string;
  transport?: 'local-stdio' | 'remote-http' | string;
  endpoint?: string;
  /** Optional remote auth key; accepted for backwards-compatible registration. */
  key?: string;
  /** Alias for key used by provider integrations. */
  apiKey?: string;
  authScheme?: 'bearer' | 'api-key' | string;
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

/** Register a remote HTTP MCP endpoint and optionally persist its key securely. */
export interface RegisterRemoteMcpPayload {
  name: string;
  endpoint: string;
  /** User-provided key. It is written to SecureStore and never echoed back. */
  key?: string;
  /** Alias accepted for integrations that call the field apiKey. */
  apiKey?: string;
  /** How the key is sent to the server (default: bearer). */
  authScheme?: 'bearer' | 'api-key' | string;
  /** Discover tools via tools/list after registration (best effort, default true). */
  discoverTools?: boolean;
  tools?: McpToolSchemaSummary[];
  trusted?: boolean;
  maxOutputBytes?: number;
  timeoutMs?: number;
  notes?: string;
}

export interface RegisterRemoteMcpResponse extends RegisterMcpServerResponse {
  endpoint: string;
  authConfigured: boolean;
  discovered: boolean;
  discoveryError?: string;
}

export interface ListMcpServersPayload {
  limit?: number;
}

export interface ListMcpServersResponse {
  servers: McpServerSummary[];
}

export interface SetMcpServerEnabledPayload {
  mcpServerId: string;
  enabled: boolean;
}

export interface SetMcpServerEnabledResponse {
  server: McpServerSummary;
}

export interface DeleteMcpServerPayload {
  mcpServerId: string;
}

export interface DeleteMcpServerResponse {
  mcpServerId: string;
  /** True when the row was removed; false when the server did not exist. */
  deleted: boolean;
}

// --- Bot conversation channels ------------------------------------------------

export type BotChannelPlatform =
  'telegram' | 'feishu' | 'wecom' | 'wechat' | 'discord' | 'dingtalk' | 'qq';

export type BotChannelConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export type BotChannelCheckVerdict = 'pass' | 'warn' | 'fail';

export interface BotChannelTestCheck {
  id: string;
  label: string;
  verdict: BotChannelCheckVerdict;
  detail?: string;
}

/** Public channel state. Bot tokens remain behind the Runtime/SecureStore boundary. */
export interface BotChannelConfigSummary {
  platform: BotChannelPlatform;
  enabled: boolean;
  credentialsConfigured: boolean;
  connected: boolean;
  state: BotChannelConnectionState;
  /** Telegram and Discord only. */
  proxyUrl?: string;
  /** Feishu/Lark only. */
  domain?: 'feishu' | 'lark';
  /** Feishu only. */
  renderMode?: 'card' | 'text';
  /** Public application identity; secrets are never returned. */
  appId?: string;
  botId?: string;
  clientId?: string;
  /** WeChat iLink service root; the Bot Token remains in SecureStore. */
  baseUrl?: string;
  botUsername?: string;
  botDisplayName?: string;
  lastError?: string;
  updatedAt?: string;
}

export interface GetBotChannelConfigPayload {
  platform: BotChannelPlatform;
}

export type GetBotChannelConfigResponse = BotChannelConfigSummary;

export interface SaveBotChannelConfigPayload {
  platform: BotChannelPlatform;
  /** Telegram/Discord replacement token. Omit to keep the SecureStore entry. */
  token?: string;
  /** WeChat iLink replacement token. */
  botToken?: string;
  /** Feishu/QQ public application id. */
  appId?: string;
  /** Feishu/QQ replacement application secret. */
  appSecret?: string;
  /** WeCom public bot id. */
  botId?: string;
  /** WeCom replacement secret. */
  secret?: string;
  /** DingTalk public client id. */
  clientId?: string;
  /** DingTalk replacement client secret. */
  clientSecret?: string;
  proxyUrl?: string;
  domain?: 'feishu' | 'lark';
  renderMode?: 'card' | 'text';
  baseUrl?: string;
  enabled: boolean;
  /** Test the saved/current credential before committing this update. */
  testConnection?: boolean;
}

export interface SaveBotChannelConfigResponse {
  config: BotChannelConfigSummary;
}

export interface TestBotChannelPayload {
  platform: BotChannelPlatform;
  token?: string;
  botToken?: string;
  appId?: string;
  appSecret?: string;
  botId?: string;
  secret?: string;
  clientId?: string;
  clientSecret?: string;
  proxyUrl?: string;
  domain?: 'feishu' | 'lark';
  renderMode?: 'card' | 'text';
  baseUrl?: string;
}

export interface TestBotChannelResponse {
  platform: BotChannelPlatform;
  connected: boolean;
  overall: BotChannelCheckVerdict;
  checks: BotChannelTestCheck[];
  botUsername?: string;
  botDisplayName?: string;
}

export interface RequestWechatBotQrPayload {
  baseUrl?: string;
}

export interface RequestWechatBotQrResponse {
  qrcode: string;
  qrcodeImage: string;
}

export interface CheckWechatBotQrPayload {
  qrcode: string;
  baseUrl?: string;
}

export interface CheckWechatBotQrResponse {
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'cancelled';
  /** Present after confirmation. Credentials stay in Runtime/SecureStore. */
  config?: BotChannelConfigSummary;
}

// --- Capability governance (global enablement ∩ workspace activation ∩ Agent binding) ---

export type GovernedCapabilityType = 'skill' | 'mcp';

export interface CapabilityWorkspaceActivationSummary {
  capabilityType: GovernedCapabilityType;
  capabilityId: string;
  workspaceId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityWorkspaceListPayload {
  workspaceId: string;
  capabilityType?: GovernedCapabilityType;
}

export interface CapabilityWorkspaceListResponse {
  activations: CapabilityWorkspaceActivationSummary[];
}

export interface CapabilityWorkspaceSetActivePayload {
  workspaceId: string;
  capabilityType: GovernedCapabilityType;
  capabilityId: string;
  active: boolean;
}

export interface CapabilityWorkspaceSetActiveResponse {
  activation: CapabilityWorkspaceActivationSummary;
}

export interface CapabilityUsageSummary {
  capabilityType: GovernedCapabilityType;
  capabilityId: string;
  callCount: number;
  successCount: number;
  failedCount: number;
  cancelledCount: number;
  problemCount: number;
  contextTokens: number;
  lastUsedAt?: string;
}

export interface GovernedSkillSummary {
  skill: SkillVersionSummary;
  workspaceActive: boolean;
  /** Human-readable names of every workspace where this Skill is active. */
  activeWorkspaceNames?: string[];
  usage: CapabilityUsageSummary;
}

export interface GovernedMcpServerSummary {
  server: McpServerSummary;
  workspaceActive: boolean;
  /** Human-readable names of every workspace where this MCP is active. */
  activeWorkspaceNames?: string[];
  usage: CapabilityUsageSummary;
}

export interface CapabilityGovernanceListPayload {
  workspaceId: string;
  /** Deterministic tests and diagnostics; production callers omit it. */
  now?: string;
}

export interface CapabilityGovernanceListResponse {
  workspaceId: string;
  windowDays: 45;
  skills: GovernedSkillSummary[];
  mcpServers: GovernedMcpServerSummary[];
}

export interface SkillPublishAttachmentSummary {
  name: string;
  size: number;
}

export interface SkillPublishDraftSummary {
  id: string;
  skillVersionId: string;
  skillId: string;
  displayName: string;
  description: string;
  skillMd: string;
  category: string;
  version: string;
  icon: string;
  attachments: SkillPublishAttachmentSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveSkillPublishDraftPayload {
  id?: string;
  skillVersionId: string;
  skillId: string;
  displayName: string;
  description: string;
  skillMd: string;
  category: string;
  version: string;
  icon: string;
  attachments?: SkillPublishAttachmentSummary[];
}

export interface SaveSkillPublishDraftResponse {
  draft: SkillPublishDraftSummary;
}

export interface ListSkillPublishDraftsPayload {
  skillId?: string;
  limit?: number;
}

export interface ListSkillPublishDraftsResponse {
  drafts: SkillPublishDraftSummary[];
}

export interface GetSkillPublishDraftPayload {
  id: string;
}

export interface GetSkillPublishDraftResponse {
  draft: SkillPublishDraftSummary;
}

export interface SubmitSkillPublishDraftPayload {
  id: string;
}

export interface SubmitSkillPublishDraftResponse {
  submitted: false;
  reason: 'channel-unavailable';
  message: string;
  draft: SkillPublishDraftSummary;
}

export interface CapabilityOrganizeCategoriesSummary {
  unused: string[];
  inactive: string[];
  problematic: string[];
  contextWarning: string[];
  highContext: string[];
}

export interface CapabilityOrganizeReportSummary {
  id: string;
  workspaceId: string;
  contextBudgetTokens: number;
  categories: CapabilityOrganizeCategoriesSummary;
  summary: {
    capabilityCount: number;
    unusedCount: number;
    inactiveCount: number;
    problematicCount: number;
    contextWarningCount: number;
    highContextCount: number;
  };
  createdAt: string;
}

export interface PreviewCapabilityOrganizePayload {
  workspaceId: string;
  contextBudgetTokens: number;
  /** Deterministic tests and diagnostics; production callers omit it. */
  now?: string;
}

export interface PreviewCapabilityOrganizeResponse {
  report: CapabilityOrganizeReportSummary;
  readOnly: true;
}

export interface GetLatestCapabilityOrganizePayload {
  workspaceId: string;
}

export interface GetLatestCapabilityOrganizeResponse {
  report?: CapabilityOrganizeReportSummary;
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
  /** Tool catalog after refresh; the previous catalog is preserved on failure. */
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

export type PauseResumeCancelResponse = {
  runId: RunId;
  state: import('@sync-think/shared').RunState;
};

// --- mutable global Agent / Team / Conversation commands (2026-07-22 model) ---
// Permission is NEVER configured on agents/teams; it lives on the conversation
// (executionMode) only.

export interface ListGlobalAgentsPayload {
  includeArchived?: boolean;
}
export interface ListGlobalAgentsResponse {
  agents: import('@sync-think/shared').GlobalAgent[];
}

export interface CreateGlobalAgentPayload {
  name: string;
  defaultModelId: ModelId;
  avatar?: string;
  persona?: string;
  description?: string;
  fallbackModelIds?: ModelId[];
  skillIds?: string[];
  mcpServerIds?: string[];
  reasoningEffort?: string;
}
export interface UpdateGlobalAgentPayload extends Partial<CreateGlobalAgentPayload> {
  agentId: import('@sync-think/shared').AgentId;
  archived?: boolean;
}
export interface GlobalAgentResponse {
  agent: import('@sync-think/shared').GlobalAgent;
}
export interface DeleteGlobalAgentPayload {
  agentId: import('@sync-think/shared').AgentId;
}

export interface TeamMemberDraft {
  agentId: import('@sync-think/shared').AgentId;
  role?: string;
  title?: string;
  dependsOn?: import('@sync-think/shared').AgentId[];
}
export interface CreateTeamPayload {
  name: string;
  avatar?: string;
  mission?: string;
  strategy?: import('@sync-think/shared').TeamStrategy;
  coordinatorAgentId?: import('@sync-think/shared').AgentId;
  members?: TeamMemberDraft[];
}
export interface UpdateTeamPayload extends Partial<CreateTeamPayload> {
  teamId: import('@sync-think/shared').TeamId;
}
export interface TeamResponse {
  team: import('@sync-think/shared').Team;
}
export interface ListTeamsResponse {
  teams: import('@sync-think/shared').Team[];
}
export interface DeleteTeamPayload {
  teamId: import('@sync-think/shared').TeamId;
}
export interface StartTeamRunPayload {
  teamId: import('@sync-think/shared').TeamId;
  conversationId: import('@sync-think/shared').ConversationId;
}
export interface SetTeamRunStatusPayload {
  runId: string;
  status: import('@sync-think/shared').TeamRunStatus;
}
export interface TeamRunResponse {
  run: import('@sync-think/shared').TeamRun;
}

export interface ListConversationsPayload {
  track?: import('@sync-think/shared').ConversationTrack;
  workspaceId?: WorkspaceId;
  includeArchived?: boolean;
}
export interface ListConversationsResponse {
  conversations: import('@sync-think/shared').Conversation[];
}

/** Wire-safe aliases of the shared durable message model. */
export type MessageBlock = import('@sync-think/shared').MessageBlock;
export type MessageSummary = import('@sync-think/shared').Message;

export interface ConversationListMessagesPayload {
  conversationId: import('@sync-think/shared').ConversationId;
  /** Exclusive thread-local sequence cursor. */
  beforeSequence?: number;
  /** Defaults to 50; valid range is 1..100. */
  limit?: number;
}

export interface ConversationListMessagesResponse {
  messages: MessageSummary[];
  nextCursor?: number;
  hasMore: boolean;
}
export type ContextStatusSectionType =
  'system' | 'agent' | 'project' | 'summary' | 'messages' | 'tools';

/** Audit-only context composition data. It must never contain prompt text or reasoning. */
export interface ContextStatusSection {
  type: ContextStatusSectionType;
  tokens: number;
}

export interface ConversationGetContextStatusPayload {
  conversationId: import('@sync-think/shared').ConversationId;
  /** Optional compose-time model override used to calculate the current window capacity. */
  modelId?: string;
  /** Optional compose-time kernel used to apply a non-overridable native limit. */
  kernelId?: import('@sync-think/shared').KernelId;
}

export type ConversationContextWindowSource =
  'model-default' | 'conversation-override' | 'kernel-limit';

export interface ConversationGetContextStatusResponse {
  modelId: string;
  /** Effective capacity used by the current model + kernel combination. */
  contextWindow: number;
  /** Capacity declared by the selected model before conversation/kernel overrides. */
  modelContextWindow: number;
  /** Persisted conversation override, when one is active. */
  contextWindowOverride?: number;
  /** Why contextWindow has its current value. */
  contextWindowSource: ConversationContextWindowSource;
  /** Non-overridable kernel ceiling when it is the effective source. */
  kernelContextWindowLimit?: number;
  /**
   * True when the model record has no configured contextWindow and the runtime
   * fell back to its 128k default. The UI renders this capacity as an estimate.
   */
  contextWindowEstimated?: boolean;
  estimatedUsedTokens: number;
  usageRatio: number;
  compactThreshold: 0.7;
  compactedAt?: string;
  sections: ContextStatusSection[];
}

export type ProcessStepStatus = 'running' | 'done' | 'error';
export type ProcessToolKind =
  'read' | 'list' | 'write' | 'bash' | 'git' | 'browser' | 'search' | 'mcp' | 'other';

export interface ExecutionProcessStep {
  id: string;
  label: string;
  verb: string;
  zh: string;
  toolName: string;
  kind: ProcessToolKind;
  status: ProcessStepStatus;
  path?: string;
  command?: string;
  url?: string;
  /** Bounded summary only. Full output is loaded separately when an artifactRef exists. */
  preview?: string;
  artifactRef?: string;
  exitCode?: number;
  error?: string;
  count?: number;
  /** First durable event sequence represented by this projected step. */
  sequence?: number;
  /** First observed tool boundary. */
  startedAt?: string;
  /** Terminal tool boundary, when reported. */
  completedAt?: string;
  /** Latest observed boundary retained for backwards compatibility. */
  occurredAt?: string;
}

export interface FileChangeItem {
  path: string;
  action: 'created' | 'edited' | 'deleted';
  toolCallId?: string;
  preview?: string;
  artifactRef?: string;
  /** Full pre-write content when a snapshot was taken (existing text file). */
  previousContent?: string;
  /** True when previousContent was truncated to bound the event payload. */
  previousTruncated?: boolean;
  /** Full post-write content when the written body was captured from the tool call. */
  content?: string;
}

export interface ConversationGetFileDiffPayload {
  runId: RunId;
  path: string;
}

export interface FileDiffView {
  path: string;
  action: 'created' | 'edited' | 'deleted';
  /** Old content. Empty string when the file did not exist before (created). */
  oldContent: string;
  /** New content. Empty string when the file was deleted. */
  newContent: string;
  /** True when no snapshot was taken (binary / oversized) — UI must degrade. */
  unavailable: boolean;
  reason?: 'binary' | 'oversized' | 'not-found';
}

export interface ConversationGetFileDiffResponse {
  diff: FileDiffView;
}

export interface TaskPlanItem {
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface TaskPlanView {
  items: TaskPlanItem[];
  completed: number;
  total: number;
}

export interface RunProcessView {
  runId: RunId;
  steps: ExecutionProcessStep[];
  fileChanges: FileChangeItem[];
  taskPlan?: TaskPlanView;
  running: boolean;
  doneCount: number;
  errorCount: number;
  tokensIn?: number;
  tokensOut?: number;
  cachedTokensHit?: number;
  cachedTokensCreated?: number;
  /**
   * Context occupancy of the LAST provider request in this run (totalInput +
   * output), not the billing cumulative. Distinct from tokensIn/tokensOut,
   * which sum every request and inflate when a tool loop re-sends the prefix.
   */
  contextWatermarkTokens?: number;
  /**
   * Per-request usage of the LAST provider request in this run (single-request
   * granularity), for showing real input/cache/output in the footer without the
   * tool-loop cumulative inflation.
   */
  lastRequestUsage?: {
    tokensIn?: number;
    tokensOut?: number;
    cachedTokensHit?: number;
    cachedTokensCreated?: number;
  };
  durationMs?: number;
  providerModelId?: string;
  modelId?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ConversationGetRunProcessPayload {
  runId: RunId;
}

export interface ConversationGetRunProcessResponse {
  process: RunProcessView;
}
export interface CreateConversationPayload {
  track: import('@sync-think/shared').ConversationTrack;
  /** modelId / agentId / teamId matching the track. */
  targetRef: string;
  workspaceId?: WorkspaceId;
  title?: string;
  executionMode?: string;
}
export interface ConversationResponse {
  conversation: import('@sync-think/shared').Conversation;
}
export interface RenameConversationPayload {
  conversationId: import('@sync-think/shared').ConversationId;
  title: string;
}
export interface SetConversationPinnedPayload {
  conversationId: import('@sync-think/shared').ConversationId;
  pinned: boolean;
}
export interface SetConversationArchivedPayload {
  conversationId: import('@sync-think/shared').ConversationId;
  archived: boolean;
}
export interface SetConversationExecutionModePayload {
  conversationId: import('@sync-think/shared').ConversationId;
  executionMode: string;
}

// --- Conversation interaction work mode ('plan' | 'execute') ---
// Independent of executionMode (permission knob). Plan mode makes the kernel
// analyse read-only and submit an approvable plan before side-effecting work.

export interface SetConversationInteractionModePayload {
  conversationId: import('@sync-think/shared').ConversationId;
  interactionMode: import('@sync-think/shared').InteractionMode;
}

export interface SetConversationContextWindowOverridePayload {
  conversationId: import('@sync-think/shared').ConversationId;
  /** Integer tokens in [1024, 10000000]; null restores the model default. */
  contextWindowOverride: number | null;
}

// --- Conversation-level plan lifecycle (chat planning mode) ---

export interface ConversationPlanSubmitPayload {
  conversationId: import('@sync-think/shared').ConversationId;
  plan: import('@sync-think/shared').ChatPlanSubmission;
}

export interface ConversationPlanGetPayload {
  conversationId: import('@sync-think/shared').ConversationId;
}

export interface ConversationPlanApprovePayload {
  conversationId: import('@sync-think/shared').ConversationId;
  revision: number;
}

export interface ConversationPlanRevisePayload {
  conversationId: import('@sync-think/shared').ConversationId;
  expectedRevision: number;
  plan: import('@sync-think/shared').ChatPlanSubmission;
}

export interface ConversationPlanCancelPayload {
  conversationId: import('@sync-think/shared').ConversationId;
}

export interface ConversationPlanResponse {
  conversation: import('@sync-think/shared').Conversation;
  plan?: import('@sync-think/shared').ConversationPlanSummary;
}

export interface ConversationPlanApproveResponse {
  conversation: import('@sync-think/shared').Conversation;
  plan: import('@sync-think/shared').ConversationPlanSummary;
  /** Fresh execution run created for the approved revision (idempotent). */
  runId?: import('@sync-think/shared').RunId;
  /** True when a new execution run was created; false when it already existed. */
  createdRun: boolean;
}

// --- Conversation-level ask (模型主动问询, ask_user_question 工具) ---
// 模型调用平台工具 ask_user_question 后，宿主挂起工具调用并发出
// `conversation.ask_pending` 事件；桌面端接管 composer 展示问询卡片；
// 用户作答后经 answer/cancel 命令回填为工具结果。plan-review intent
// 渲染为「方案待审」特例卡（确认执行 → 桌面端切执行模式并发起执行轮）。

export interface AskQuestionIntent {
  /** 'plan-review' 时渲染方案审阅特例卡。 */
  kind?: 'plan-review' | string;
  /** plan-review：确认按钮的选项 label（须与 options 中某一 label 一致）。 */
  approve?: string;
}

export interface AskQuestionOption {
  /** 用户可见文案；推荐项以「（推荐）」/「(Recommended)」后缀标记并置于首位。 */
  label: string;
  /** 一句话说明权衡或影响。 */
  description?: string;
}

export interface AskQuestion {
  /** 稳定 id，答案中回显。 */
  id: string;
  question: string;
  /** 可选短标题（如 "Confirm" / "Choose Mode"）。 */
  header?: string;
  /** 可选 Markdown 补充说明 / 方案全文。 */
  detail?: string;
  intent?: AskQuestionIntent;
  options?: AskQuestionOption[];
  multiSelect?: boolean;
}

export interface AskQuestionAnswer {
  id: string;
  /** 用户选择的选项 label；跳过时为 []。 */
  selected: string[];
  /** 自定义答案（与 selected 二选一）。 */
  custom?: string;
}

export interface ConversationAskAnswerPayload {
  askId: string;
  answers: AskQuestionAnswer[];
}

export interface ConversationAskCancelPayload {
  askId: string;
}

export interface ConversationAskPendingPayload {
  threadId: string;
}

export interface ConversationAskPendingResponse {
  ask?: {
    askId: string;
    threadId: string;
    runId: string;
    questions: AskQuestion[];
    createdAt: string;
  };
}
/** Requires an explicit user confirmation upstream — never a silent upgrade. */
export interface UpgradeConversationTrackPayload {
  conversationId: import('@sync-think/shared').ConversationId;
  track: 'agent' | 'team';
  targetRef: string;
}
/**
 * Rebind "who this conversation talks to". Unlike upgradeTrack (one-way
 * model→agent/team), this allows same-track retargeting and any cross-track
 * switch; targetRef is the modelId / agentId / teamId matching the track.
 * Response: ConversationResponse (updated conversation summary).
 */
export interface RebindConversationTargetPayload {
  conversationId: import('@sync-think/shared').ConversationId;
  track: import('@sync-think/shared').ConversationTrack;
  targetRef: string;
}
export interface DeleteConversationPayload {
  conversationId: import('@sync-think/shared').ConversationId;
}

/**
 * High-level "send a message in a conversation" — handles lazy task creation
 * and inbox workspace provisioning internally so the desktop only makes one call.
 */
export interface ConversationSendMessagePayload {
  conversationId: import('@sync-think/shared').ConversationId;
  text: string;
  /** Override the conversation's bound model for this message. */
  modelId?: import('@sync-think/shared').ModelId;
}

export interface ConversationSendMessageResponse {
  /** Thread backing this conversation's task. Use for subsequent appendMessage. */
  threadId: import('@sync-think/shared').ThreadId;
  /** Current task version — pass as expectedTaskVersion to appendMessage. */
  taskVersion: number;
  /** Present on first message — the auto-derived conversation title. */
  conversationTitle?: string;
}

/**
 * Rewrite a composer draft without creating a conversation message or run.
 * `requestId` is stable across the enhance/cancel pair and is independent of
 * the command envelope id used by the transport.
 */
export interface PromptEnhancePayload {
  requestId: string;
  text: string;
  /** Preferred catalog model. Runtime falls back to an available model when omitted or stale. */
  modelId?: import('@sync-think/shared').ModelId;
}

export interface PromptEnhanceResponse {
  requestId: string;
  text: string;
  /** Catalog model actually used for the rewrite. */
  modelId: import('@sync-think/shared').ModelId;
}

export interface PromptEnhanceCancelPayload {
  requestId: string;
}

export interface PromptEnhanceCancelResponse {
  requestId: string;
  cancelled: boolean;
}

/**
 * Compact earlier conversation context (NewMax / Claude Code style).
 * Primary path: model-generated structured summary of older turns.
 * Local truncate summary is only a degraded fallback.
 * Writes a durable context.compacted boundary and keeps recent turns.
 */
export interface ConversationCompactPayload {
  conversationId: import('@sync-think/shared').ConversationId;
  /** manual = user /compact; auto = threshold-triggered. */
  mode?: 'manual' | 'auto';
  /** Legacy renderer hint retained for compatibility; Runtime snapshot is authoritative. */
  contextWindow?: number;
  /** Legacy renderer hint retained for compatibility; Runtime snapshot is authoritative. */
  usedTokens?: number;
  /** Keep this many newest messages verbatim after the summary. */
  keepRecent?: number;
  /**
   * When true, compact only if occupancy is at/above the auto threshold.
   * Used by auto-trigger paths so no-op conversations stay untouched.
   */
  onlyIfNeeded?: boolean;
}

export interface ConversationCompactResponse {
  conversationId: import('@sync-think/shared').ConversationId;
  threadId: import('@sync-think/shared').ThreadId;
  /** False when onlyIfNeeded=true and occupancy was still under threshold. */
  compacted: boolean;
  mode: 'manual' | 'auto';
  beforeTokens: number;
  afterTokens: number;
  foldedCount: number;
  durationMs: number;
  /** Present when a compact boundary was written. */
  summaryText?: string;
  messageId?: string;
}

export type ToolApprovalScope = 'once' | 'session' | 'always-app';

export interface ToolApprovalRiskSummary {
  level: string;
  reasonCodes: string[];
  humanOnlyAction?: string;
}

export interface PendingToolApprovalSummary {
  approvalId: string;
  threadId: ThreadId;
  runId: RunId;
  toolCallId?: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  title: string;
  detail: string;
  path?: string;
  command?: string;
  risk?: ToolApprovalRiskSummary;
  /** Runtime-authoritative scopes for this exact pending request. */
  allowedScopes: ToolApprovalScope[];
  status: 'pending';
  createdAt: string;
}

export interface ListPendingToolApprovalsPayload {
  threadId: ThreadId;
  runId?: RunId;
}

export interface ListPendingToolApprovalsResponse {
  approvals: PendingToolApprovalSummary[];
}

/**
 * Resolve a chat tool approval that was paused under「询问批准」.
 * approvalId comes from the tool.approval_requested event payload.
 */
export interface ConversationDecideToolApprovalPayload {
  approvalId: string;
  decision: 'approve' | 'deny';
  /** Omitted by legacy clients and normalized to once by Runtime. */
  scope?: ToolApprovalScope;
}

export interface ConversationDecideToolApprovalResponse {
  approvalId: string;
  decision: 'approve' | 'deny';
  scope: ToolApprovalScope;
  runId?: RunId;
}

/**
 * Renderer → Runtime reply for an interactive browser tool command
 * (browser_click / browser_type / browser_read / browser_screenshot).
 * requestId comes from the browser.command_requested event payload;
 * resultJson is the JSON-serialized outcome from the <webview> (capped ~64KB).
 */
export interface ConversationSubmitBrowserResultPayload {
  requestId: string;
  ok: boolean;
  /** JSON string with the command outcome (page text / click ack / screenshot path). */
  resultJson?: string;
  /** Human-readable error when ok=false (webview missing, element not found …). */
  error?: string;
}

export interface ConversationSubmitBrowserResultResponse {
  requestId: string;
  accepted: boolean;
}

export interface BrowserProfileSummary {
  id: string;
  name: string;
  revision: number;
  isDefault: boolean;
  inUse: boolean;
  siteCount: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export type BrowserSiteSessionState = 'data_present' | 'verified' | 'reauth_required';

export interface BrowserSiteSessionSummary {
  profileId: string;
  siteKey: string;
  origins: string[];
  state: BrowserSiteSessionState;
  cookieCount: number;
  storageBytes: number;
  storageTypes: string[];
  lastSeenAt?: string;
  lastVerifiedAt?: string;
  lastCheckedAt: string;
  updatedAt: string;
}

export type ListBrowserProfilesPayload = Record<string, never>;

export interface ListBrowserProfilesResponse {
  profiles: BrowserProfileSummary[];
}

export interface CreateBrowserProfilePayload {
  name: string;
}

export interface CreateBrowserProfileResponse {
  profile: BrowserProfileSummary;
}

export interface RenameBrowserProfilePayload {
  profileId: string;
  name: string;
  expectedRevision: number;
}

export interface RenameBrowserProfileResponse {
  profile: BrowserProfileSummary;
}

export interface DeleteBrowserProfilePayload {
  profileId: string;
  expectedRevision: number;
}

export interface DeleteBrowserProfileResponse {
  profileId: string;
  deleted: true;
}

export interface ListBrowserSiteSessionsPayload {
  profileId: string;
  refresh?: boolean;
}

export interface ListBrowserSiteSessionsResponse {
  profile: BrowserProfileSummary;
  sessions: BrowserSiteSessionSummary[];
  refreshed: boolean;
  checkedAt?: string;
}

export interface ClearBrowserSiteSessionPayload {
  profileId: string;
  siteKey: string;
}

export interface ClearBrowserSiteSessionResponse {
  profileId: string;
  siteKey: string;
  clearedOrigins: string[];
  deletedCookieCount: number;
  checkedAt: string;
}

export interface BrowserRecordingSummary {
  id: string;
  profileId: string;
  status: BrowserRecordingStatus;
  revision: number;
  stepCount: number;
  startUrl?: string;
  currentUrl?: string;
  stopReason?: BrowserRecordingStopReason;
  errorCode?: string;
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
  updatedAt: string;
}

export interface ListBrowserRecordingsPayload {
  profileId: string;
  limit?: number;
}

export interface ListBrowserRecordingsResponse {
  recordings: BrowserRecordingSummary[];
}

export interface GetBrowserRecordingPayload {
  recordingId: string;
  afterSequence?: number;
  limit?: number;
}

export interface GetBrowserRecordingResponse {
  recording: BrowserRecordingSummary;
  steps: BrowserRecordingStepRecord[];
}

export interface StartBrowserRecordingPayload {
  profileId: string;
  expectedProfileRevision: number;
  startUrl?: string;
  draftId?: string;
}

export interface StartBrowserRecordingResponse {
  recording: BrowserRecordingSummary;
}

export interface StopBrowserRecordingPayload {
  recordingId: string;
}

export interface StopBrowserRecordingResponse {
  recording: BrowserRecordingSummary;
}

export type BrowserAutomationSource = 'manual' | 'ai';

export type BrowserAutomationTaskStatus =
  'draft' | 'pending_review' | 'enabled' | 'disabled' | 'failed';

export type BrowserWorkflowDraftStatus = 'editing' | 'pending_review' | 'approved' | 'rejected';

export interface BrowserAutomationTaskSummary {
  id: string;
  profileId: string;
  name: string;
  instruction: string;
  startUrl: string;
  source: BrowserAutomationSource;
  status: BrowserAutomationTaskStatus;
  revision: number;
  currentDraftId?: string;
  publishedVersionId?: string;
  lastRunAt?: string;
  successCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserWorkflowDraftSummary {
  id: string;
  taskId: string;
  recordingId?: string;
  status: BrowserWorkflowDraftStatus;
  revision: number;
  steps: BrowserRecordingStepInput[];
  stepCount: number;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  reviewedAt?: string;
}

export interface BrowserWorkflowVersionSummary {
  id: string;
  taskId: string;
  draftId: string;
  versionNumber: number;
  steps: BrowserRecordingStepInput[];
  stepCount: number;
  createdAt: string;
  publishedAt: string;
}

export interface BrowserWorkflowReviewSummary {
  id: string;
  draftId: string;
  decision: 'approve' | 'reject';
  note?: string;
  createdAt: string;
}

export interface ListBrowserWorkflowsPayload {
  profileId?: string;
  status?: BrowserAutomationTaskStatus;
  query?: string;
  limit?: number;
}

export interface ListBrowserWorkflowsResponse {
  tasks: BrowserAutomationTaskSummary[];
}

export interface GetBrowserWorkflowPayload {
  taskId: string;
}

export interface GetBrowserWorkflowResponse {
  task: BrowserAutomationTaskSummary;
  draft?: BrowserWorkflowDraftSummary;
  version?: BrowserWorkflowVersionSummary;
  reviews: BrowserWorkflowReviewSummary[];
  reviewsTruncated: boolean;
}

export interface CreateBrowserWorkflowDraftPayload {
  profileId: string;
  name: string;
  instruction: string;
  startUrl: string;
  source: BrowserAutomationSource;
}

export interface CreateBrowserWorkflowDraftResponse {
  task: BrowserAutomationTaskSummary;
  draft: BrowserWorkflowDraftSummary;
}

export interface CreateBrowserWorkflowRevisionDraftPayload {
  taskId: string;
  expectedTaskRevision: number;
}

export interface CreateBrowserWorkflowRevisionDraftResponse {
  task: BrowserAutomationTaskSummary;
  draft: BrowserWorkflowDraftSummary;
}

export interface SubmitBrowserWorkflowDraftPayload {
  draftId: string;
  recordingId: string;
}

export interface SubmitBrowserWorkflowDraftResponse {
  task: BrowserAutomationTaskSummary;
  draft: BrowserWorkflowDraftSummary;
}

export interface ReviewBrowserWorkflowDraftPayload {
  draftId: string;
  decision: 'approve' | 'reject';
  note?: string;
}

export interface ReviewBrowserWorkflowDraftResponse {
  task: BrowserAutomationTaskSummary;
  draft: BrowserWorkflowDraftSummary;
  version?: BrowserWorkflowVersionSummary;
}

export interface ExecuteBrowserWorkflowPayload {
  taskId: string;
  variables?: Record<string, string>;
}

export interface BrowserWorkflowReplayStepSummary {
  sequence: number;
  ok: boolean;
  actionKind?: string;
  outputUrl?: string;
  outputTitle?: string;
  errorCode?: string;
  error?: string;
}

export interface ExecuteBrowserWorkflowResponse {
  ok: boolean;
  taskId: string;
  versionId?: string;
  profileId?: string;
  stepCount: number;
  executedStepCount: number;
  steps: BrowserWorkflowReplayStepSummary[];
  missingVariables?: string[];
  /** Origins that still need approval before the workflow can run. */
  missingOrigins?: string[];
  errorCode?: string;
  error?: string;
}

export interface ApproveExecuteBrowserWorkflowPayload {
  taskId: string;
  /** Origins the user is approving. Must be a subset of the workflow's navigation origins. */
  origins: string[];
  variables?: Record<string, string>;
}

export type BrowserHandoffReason =
  'login' | 'captcha' | 'payment' | 'device-confirmation' | 'manual';

export interface BrowserHandoffSummary {
  handoffId: string;
  revision: 1;
  workspaceId: WorkspaceId;
  taskId?: TaskId;
  runId: RunId;
  stepId?: StepId;
  agentVersionId?: AgentVersionId;
  siteOrigin: string;
  reason: BrowserHandoffReason;
  requestedOutcome: string;
  onCancel: 'keep-open' | 'close-page';
  status: 'waiting_user';
  createdAt: string;
  updatedAt: string;
  canContinue: true;
  canCancel: true;
}

export interface ListWaitingBrowserHandoffsPayload {
  workspaceId?: WorkspaceId;
  runId?: RunId;
}

export interface ListWaitingBrowserHandoffsResponse {
  handoffs: BrowserHandoffSummary[];
}

export type DesktopWaitingReason =
  'user-input-detected' | 'restart-inspection' | 'attention-required';

export interface DesktopWaitingCommandSummary {
  commandId: string;
  workspaceId: WorkspaceId;
  taskId?: TaskId;
  runId: RunId;
  toolName: string;
  action: string;
  target?: {
    processId?: number;
    title?: string;
    appId?: string;
  };
  reason: DesktopWaitingReason;
  errorCode: string;
  status: 'waiting_user';
  canContinue: boolean;
  canCancel: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListWaitingDesktopCommandsPayload {
  workspaceId?: WorkspaceId;
  runId?: RunId;
}

export interface ListWaitingDesktopCommandsResponse {
  commands: DesktopWaitingCommandSummary[];
}

export interface ContinueDesktopCommandPayload {
  commandId: string;
  expectedUpdatedAt: string;
}

export interface ContinueDesktopCommandResponse {
  status: 'continued';
  commandId: string;
  replayed: boolean;
  updatedAt: string;
}

export interface CancelDesktopCommandPayload {
  commandId: string;
  expectedUpdatedAt: string;
}

export interface CancelDesktopCommandResponse {
  status: 'cancelled';
  commandId: string;
  replayed: boolean;
  updatedAt: string;
}

export interface ContinueBrowserHandoffPayload {
  handoffId: string;
  expectedRevision: number;
}

export interface ContinueBrowserHandoffResponse {
  status: 'continued';
  handoffId: string;
  replayed: boolean;
  runId: RunId;
  stepId: StepId;
}

export interface CancelBrowserHandoffPayload {
  handoffId: string;
  expectedRevision: number;
  leaseDisposition?: 'preserve' | 'release';
}

export interface CancelBrowserHandoffResponse {
  status: 'cancelled';
  handoffId: string;
  replayed: boolean;
  runId: RunId;
  stepId: StepId;
}

// --- Goal mode (NewMax-style /goal: the selected work model reports a
// GOAL_STATUS marker after every turn and keeps working until terminal) ---

export type GoalStatusState = 'active' | 'paused' | 'blocked' | 'achieved' | 'cleared';

export interface GoalStatus {
  /** Conversation-scoped goal identity (conversation id). */
  conversationId: string;
  /** User-visible objective shown throughout the goal lifecycle. */
  condition: string;
  /** Optional completion criterion included in every work-model Goal prompt. */
  stopCondition?: string;
  status: GoalStatusState;
  startedAt: string;
  /** Number of turns evaluated so far; pause/resume preserves the count. */
  turnCount: number;
  tokensIn: number;
  tokensOut: number;
  /** Most recent work-model Goal status summary. */
  lastReason?: string;
  achievedAt?: string;
  /** Resolved round limit; new goals default to 10 and block when exhausted. */
  maxGoalRounds?: number;
  /** 已启动的自动轮次数。 */
  roundsStarted?: number;
  /** Total token budget across work-model Goal turns; new goals default to 1000000. */
  maxGoalTokens?: number;
  pausedAt?: string;
  blockedAt?: string;
  blockedReason?: string;
  /** Consecutive GOAL_STATUS: blocked reports; NewMax stops after three. */
  blockedStreak?: number;
  /** Composer model pinned when the goal was created; reused by every automatic round. */
  modelId?: ModelId;
  /** Composer kernel pinned when the goal was created. */
  kernelId?: KernelId;
  /** Composer reasoning setting pinned for automatic rounds. */
  reasoningEffort?: string;
  /** Composer network setting pinned for automatic rounds. */
  networkEnabled?: boolean;
}

export interface GoalSetPayload {
  conversationId: string;
  /** Completion condition, up to 4000 chars. Setting a new goal replaces the active one. */
  condition: string;
  /** Optional completion criterion included in every Goal turn, up to 4000 chars. */
  stopCondition?: string;
  /** 轮次上限（1..50）；缺省用默认值（10）。 */
  maxGoalRounds?: number;
  /** Total goal token budget (integer >= 10000; defaults to 1000000). */
  maxGoalTokens?: number;
  /** Route every automatic round through the model selected in the composer. */
  modelId?: ModelId;
  /** Route every automatic round through the kernel selected in the composer. */
  kernelId?: KernelId;
  reasoningEffort?: string;
  networkEnabled?: boolean;
}

export interface GoalSetResponse {
  goal: GoalStatus;
  /** Immediately starts a Goal turn when the selected work route is available. */
  started: boolean;
  /** Legacy compatibility bit; true because the work model now self-reports status. */
  evaluatorConfigured: boolean;
}

export interface GoalGetPayload {
  conversationId: string;
}

export interface GoalGetResponse {
  goal?: GoalStatus;
  evaluatorConfigured: boolean;
}

export interface GoalClearPayload {
  conversationId: string;
}

export interface GoalClearResponse {
  cleared: boolean;
  goal?: GoalStatus;
}

export interface GoalPausePayload {
  conversationId: string;
}

export interface GoalResumePayload extends Pick<
  GoalSetPayload,
  'modelId' | 'kernelId' | 'reasoningEffort' | 'networkEnabled'
> {
  conversationId: string;
}

export interface GoalResumeResponse {
  goal: GoalStatus;
  /** 恢复后立即启动下一轮。 */
  started: boolean;
  /** Legacy compatibility bit; true because the work model now self-reports status. */
  evaluatorConfigured: boolean;
}

// --- 定时任务（scheduledTask） ---
// 任务 = 专属会话 + 触发规则（at/every/random/cron）+ 指令；runtime 心跳
// 检查 nextRunAt 到期后向任务会话注入指令启动 run。规则/目标类型见
// @sync-think/shared 的 scheduled-task。

export interface CreateScheduledTaskPayload {
  name: string;
  instruction: string;
  target: import('@sync-think/shared').ScheduledTaskTarget;
  rule: import('@sync-think/shared').TaskRule;
  timeZone?: string;
  enabled?: boolean;
  /** 绑定工作区 id；缺省 = 全局任务。 */
  workspaceId?: string;
  /** 触发时注入的 skill 版本 id（缺省 = 不注入）。 */
  skillVersionIds?: string[];
  /** 单次/首次触发时间（UTC 绝对时刻）；缺省按规则推算。 */
  nextRunAt?: string;
}

export interface ListScheduledTasksPayload {
  includeDisabled?: boolean;
}

export interface ListScheduledTasksResponse {
  tasks: import('@sync-think/shared').ScheduledTask[];
}

export interface UpdateScheduledTaskPayload {
  taskId: string;
  patch: Partial<{
    name: string;
    instruction: string;
    target: import('@sync-think/shared').ScheduledTaskTarget;
    rule: import('@sync-think/shared').TaskRule;
    timeZone: string;
    enabled: boolean;
    /** null = 解绑（改为全局）。 */
    workspaceId: string | null;
    /** null = 清空 skill 注入。 */
    skillVersionIds: string[] | null;
    nextRunAt: string | null;
  }>;
}

export interface DeleteScheduledTaskPayload {
  taskId: string;
}

/** 立即触发一次（手动测试，独立于规则）。 */
export interface TriggerScheduledTaskPayload {
  taskId: string;
}

export interface TriggerScheduledTaskResponse {
  task: import('@sync-think/shared').ScheduledTask;
  fired: boolean;
  /** 未触发原因（并发上限 / 会话忙 / 不可用）。 */
  reason?: string;
}

/** 查询某任务的执行历史（按 firedAt 倒序，最多 limit 条）。 */
export interface ListScheduledTaskHistoryPayload {
  taskId: string;
  limit?: number;
}

export interface ListScheduledTaskHistoryResponse {
  entries: import('@sync-think/shared').ScheduledTaskHistoryEntry[];
}

// --- Activity centre (TD-048) ---------------------------------------------
// Background runs and external events are read through a dedicated projection
// rather than the orchestration `run` table, which never holds conversation
// runs and carries no kernel/model/timing/failure columns.

export interface ActivityListRunsPayload {
  workspaceId?: string;
  conversationId?: string;
  states?: import('@sync-think/shared').RunIndexState[];
  sources?: import('@sync-think/shared').RunIndexSource[];
  /** Opaque cursor returned by a previous page. */
  cursor?: string;
  limit?: number;
}

export interface ActivityListRunsResponse {
  entries: import('@sync-think/shared').RunIndexEntry[];
  nextCursor?: string;
  /** Per-state totals for the same workspace scope, for filter chips. */
  counts: Record<import('@sync-think/shared').RunIndexState, number>;
}

/**
 * External event view for the activity centre.
 *
 * Deliberately not `ExternalEventRecord`: that type carries `leaseToken`, a
 * fencing credential that must never leave the daemon/Runtime boundary.
 */
export interface ActivityExternalEventSummary {
  id: string;
  dedupeKey: string;
  sourceKind: import('@sync-think/shared').ExternalEventSourceKind;
  sourceName?: string;
  title?: string;
  state: import('@sync-think/shared').ExternalEventState;
  attemptCount: number;
  runId?: string;
  workspaceId?: string;
  resultStatus?: import('@sync-think/shared').ExternalEventTerminalStatus;
  resultReason?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ActivityListExternalEventsPayload {
  workspaceId?: string;
  states?: import('@sync-think/shared').ExternalEventState[];
  limit?: number;
}

export interface ActivityListExternalEventsResponse {
  entries: ActivityExternalEventSummary[];
}

export interface ActivityRetryAnchorPayload {
  runId: string;
}

/**
 * Resolves what a failed run should re-send, without starting the run here.
 *
 * Retry deliberately does not open a second run-start path: `task.appendMessage`
 * already owns task-version fencing, kernel/agent resolution and approval
 * checks, and duplicating that machinery is how those fences get out of sync.
 * The caller replays through the normal command instead.
 */
export interface ActivityRetryAnchorResponse {
  runId: string;
  conversationId: string;
  /** Message to re-send. Absent when the original prompt is no longer durable. */
  messageId?: string;
  text?: string;
  /** False when the run cannot be retried, with `reason` explaining why. */
  retryable: boolean;
  reason?: string;
}

// Helper: build a typed request envelope.
export function req<T>(
  type: CommandType,
  payload: T,
  requestId: string = ulid(),
): CommandRequest<T> {
  return { type, payload, requestId };
}
