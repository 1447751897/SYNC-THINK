// Preload runs in the renderer with contextIsolation: true. Bridge exposes a
// narrow window.api so the renderer never touches Node directly (搂19).
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  ExportDesktopDiagnosticsPayload,
  ExportDesktopDiagnosticsResponse,
} from '../diagnostics-export-contract.js';
import type {
  DesktopUpdateAutoCheckPreference,
  DesktopUpdateOpenResult,
} from '../desktop-update-contract.js';
import type {
  ExportDesktopDataPayload,
  ExportDesktopDataResponse,
  ImportDesktopDataPayload,
  ImportDesktopDataResponse,
  OpenDesktopDataDirectoryResponse,
} from '../data-management-contract.js';
import type {
  ProjectGitActionResult,
  ProjectGitCheckoutResult,
  ProjectGitCommitResult,
  ProjectGitInfo,
  ProjectGitPushResult,
  ProjectGitReview,
} from '../project-git-contract.js';
import type {
  DataBackupPayload,
  DataBackupResponse,
  DataCleanConversationsPayload,
  DataCleanConversationsResponse,
  DataCleanEmptyAttachmentDirectoriesResponse,
  DataCompactStorageResponse,
  DataStorageStatsResponse,
} from '@sync-think/protocol';
import type {
  AppendMessagePayload,
  AppendMessageResponse,
  BindWorkspaceFolderPayload,
  BindWorkspaceFolderResponse,
  CancelRunPayload,
  CreateTaskPayload,
  CreateTaskResponse,
  CreateWorkspacePayload,
  CreateWorkspaceResponse,
  UpdateWorkspacePayload,
  UpdateWorkspaceResponse,
  DeleteWorkspacePayload,
  DeleteWorkspaceResponse,
  ListTasksPayload,
  ListTasksResponse,
  ListWorkspacesPayload,
  ListWorkspacesResponse,
  OpenTaskPayload,
  OpenTaskResponse,
  PauseResumeCancelResponse,
  SearchTasksPayload,
  SearchTasksResponse,
  CreateProviderResponse,
  UpdateProviderResponse,
  PreviewCcSwitchImportPayload,
  PreviewCcSwitchImportResponse,
  ImportCcSwitchPayload,
  ImportCcSwitchResponse,
  ListProvidersPayload,
  ListProvidersResponse,
  DiscoverModelsPayload,
  DiscoverModelsResponse,
  AddModelsPayload,
  AddModelsResponse,
  ProbeCapabilitiesPayload,
  ProbeCapabilitiesResponse,
  ConfirmCapabilitiesPayload,
  ConfirmCapabilitiesResponse,
  ReorderProvidersPayload,
  ReorderProvidersResponse,
  AddProviderCredentialResponse,
  RemoveProviderCredentialPayload,
  RemoveProviderCredentialResponse,
  RevealProviderCredentialPayload,
  RevealProviderCredentialResponse,
  UpdateProviderCredentialResponse,
  SetModelPrioritiesPayload,
  SetModelPrioritiesResponse,
  UpdateModelPayload,
  UpdateModelResponse,
  RemoveModelPayload,
  RemoveModelResponse,
  GetSettingsPayload,
  GetSettingsResponse,
  SetSettingPayload,
  SetSettingResponse,
  UsageSummaryPayload,
  UsageSummaryResponse,
  GetAgentPayload,
  GetAgentResponse,
  UpdateAgentBindingPayload,
  UpdateAgentBindingResponse,
  ImportSkillPayload,
  ImportSkillResponse,
  ImportRemoteSkillPayload,
  ImportRemoteSkillResponse,
  ListSkillMarketResponse,
  InstallSkillMarketPayload,
  InstallSkillMarketResponse,
  ListSkillsPayload,
  ListSkillsResponse,
  DeleteSkillPayload,
  DeleteSkillResponse,
  SetSkillEnabledPayload,
  SetSkillEnabledResponse,
  GetSkillPayload,
  GetSkillResponse,
  RegisterMcpServerPayload,
  RegisterMcpServerResponse,
  RegisterRemoteMcpPayload,
  RegisterRemoteMcpResponse,
  ListMcpServersPayload,
  ListMcpServersResponse,
  SetMcpServerEnabledPayload,
  SetMcpServerEnabledResponse,
  DeleteMcpServerPayload,
  DeleteMcpServerResponse,
  GetBotChannelConfigPayload,
  GetBotChannelConfigResponse,
  SaveBotChannelConfigPayload,
  SaveBotChannelConfigResponse,
  TestBotChannelPayload,
  TestBotChannelResponse,
  RequestWechatBotQrPayload,
  RequestWechatBotQrResponse,
  CheckWechatBotQrPayload,
  CheckWechatBotQrResponse,
  CapabilityWorkspaceListPayload,
  CapabilityWorkspaceListResponse,
  CapabilityWorkspaceSetActivePayload,
  CapabilityWorkspaceSetActiveResponse,
  CapabilityGovernanceListPayload,
  CapabilityGovernanceListResponse,
  SaveSkillPublishDraftPayload,
  SaveSkillPublishDraftResponse,
  ListSkillPublishDraftsPayload,
  ListSkillPublishDraftsResponse,
  GetSkillPublishDraftPayload,
  GetSkillPublishDraftResponse,
  SubmitSkillPublishDraftPayload,
  SubmitSkillPublishDraftResponse,
  PreviewCapabilityOrganizePayload,
  PreviewCapabilityOrganizeResponse,
  GetLatestCapabilityOrganizePayload,
  GetLatestCapabilityOrganizeResponse,
  ProbeMcpPolicyPayload,
  ProbeMcpPolicyResponse,
  RequestMcpToolPayload,
  RequestMcpToolResponse,
  ProbeMcpSpawnPayload,
  CallMcpToolPayload,
  CallMcpToolResponse,
  RefreshMcpToolsPayload,
  RefreshMcpToolsResponse,
  ProbeMcpSpawnResponse,
  ListMemoryPayload,
  ListMemoryResponse,
  DecideMemoryPayload,
  RollbackMemoryPayload,
  RollbackMemoryResponse,
  DecideMemoryResponse,
  ListDiagnosticsPayload,
  ListDiagnosticsResponse,
  ListApprovalsPayload,
  ListApprovalsResponse,
  EvaluateApprovalPayload,
  EvaluateApprovalResponse,
  EnqueueApprovalPayload,
  EnqueueApprovalResponse,
  DecideApprovalPayload,
  DecideApprovalResponse,
  ListWaitingBrowserHandoffsPayload,
  ListWaitingBrowserHandoffsResponse,
  ListWaitingDesktopCommandsPayload,
  ListWaitingDesktopCommandsResponse,
  ContinueDesktopCommandPayload,
  ContinueDesktopCommandResponse,
  CancelDesktopCommandPayload,
  CancelDesktopCommandResponse,
  ContinueBrowserHandoffPayload,
  ContinueBrowserHandoffResponse,
  CancelBrowserHandoffPayload,
  CancelBrowserHandoffResponse,
  ListBrowserProfilesPayload,
  ListBrowserProfilesResponse,
  CreateBrowserProfilePayload,
  CreateBrowserProfileResponse,
  RenameBrowserProfilePayload,
  RenameBrowserProfileResponse,
  DeleteBrowserProfilePayload,
  DeleteBrowserProfileResponse,
  ListBrowserSiteSessionsPayload,
  ListBrowserSiteSessionsResponse,
  ClearBrowserSiteSessionPayload,
  ClearBrowserSiteSessionResponse,
  ListBrowserRecordingsPayload,
  ListBrowserRecordingsResponse,
  GetBrowserRecordingPayload,
  GetBrowserRecordingResponse,
  StartBrowserRecordingPayload,
  StartBrowserRecordingResponse,
  StopBrowserRecordingPayload,
  StopBrowserRecordingResponse,
  ListBrowserWorkflowsPayload,
  ListBrowserWorkflowsResponse,
  GetBrowserWorkflowPayload,
  GetBrowserWorkflowResponse,
  CreateBrowserWorkflowDraftPayload,
  CreateBrowserWorkflowDraftResponse,
  CreateBrowserWorkflowRevisionDraftPayload,
  CreateBrowserWorkflowRevisionDraftResponse,
  SubmitBrowserWorkflowDraftPayload,
  SubmitBrowserWorkflowDraftResponse,
  ReviewBrowserWorkflowDraftPayload,
  ReviewBrowserWorkflowDraftResponse,
  ApproveExecuteBrowserWorkflowPayload,
  ExecuteBrowserWorkflowPayload,
  ExecuteBrowserWorkflowResponse,
  PeekContextPacketPayload,
  PeekContextPacketResponse,
  AmendContextPacketPayload,
  AmendContextPacketResponse,
  SetParticipationModePayload,
  SetParticipationModeResponse,
  PlanDraftPayload,
  PlanDraftResponse,
  PlanRevisePayload,
  PlanReviseResponse,
  PlanListRevisionsPayload,
  PlanListRevisionsResponse,
  PlanApprovePayload,
  PlanApproveResponse,
  RunGetGraphPayload,
  RunGetGraphResponse,
  OrchestrationRunMutationPayload,
  OrchestrationRunMutationResponse,
  SavePolicyPayload,
  SavePolicyResponse,
  ListPoliciesPayload,
  ListPoliciesResponse,
  GetArtifactVersionPayload,
  ListArtifactsPayload,
  ListArtifactsResponse,
  CompareArtifactVersionsPayload,
  CompareArtifactVersionsResponse,
  SelectArtifactVersionPayload,
  SelectArtifactVersionResponse,
  MergeArtifactVersionsPayload,
  MergeArtifactVersionsResponse,
  ListArtifactMergeConflictsPayload,
  ListArtifactMergeConflictsResponse,
  ResolveArtifactMergeConflictPayload,
  ResolveArtifactMergeConflictResponse,
  ListAgentsPayload,
  ListAgentsResponse,
  CreateAgentPayload,
  CreateAgentResponse,
  ListAgentVersionsPayload,
  ListAgentVersionsResponse,
  CreateAgentVersionPayload,
  CreateAgentVersionResponse,
  ListGlobalAgentsPayload,
  ListGlobalAgentsResponse,
  CreateGlobalAgentPayload,
  UpdateGlobalAgentPayload,
  DeleteGlobalAgentPayload,
  GlobalAgentResponse,
  ListTeamsResponse,
  CreateTeamPayload,
  UpdateTeamPayload,
  DeleteTeamPayload,
  StartTeamRunPayload,
  SetTeamRunStatusPayload,
  TeamRunResponse,
  TeamResponse,
  ListConversationsPayload,
  ListConversationsResponse,
  ConversationListMessagesPayload,
  ConversationListMessagesResponse,
  ConversationGetContextStatusPayload,
  ConversationGetContextStatusResponse,
  ConversationGetRunProcessPayload,
  ConversationGetRunProcessResponse,
  ConversationTransientFrame,
  ConversationTransientSnapshot,
  CreateConversationPayload,
  ConversationResponse,
  RenameConversationPayload,
  SetConversationPinnedPayload,
  SetConversationArchivedPayload,
  SetConversationExecutionModePayload,
  SetConversationInteractionModePayload,
  SetConversationContextWindowOverridePayload,
  ConversationPlanSubmitPayload,
  ConversationPlanGetPayload,
  ConversationPlanApprovePayload,
  ConversationPlanRevisePayload,
  ConversationPlanCancelPayload,
  ConversationPlanResponse,
  ConversationPlanApproveResponse,
  ConversationAskAnswerPayload,
  ConversationAskCancelPayload,
  ConversationAskPendingPayload,
  ConversationAskPendingResponse,
  CreateScheduledTaskPayload,
  ListScheduledTasksPayload,
  ListScheduledTasksResponse,
  ListScheduledTaskHistoryPayload,
  ListScheduledTaskHistoryResponse,
  ActivityListRunsPayload,
  ActivityListRunsResponse,
  ActivityListExternalEventsPayload,
  ActivityListExternalEventsResponse,
  ActivityRetryAnchorPayload,
  ActivityRetryAnchorResponse,
  UpdateScheduledTaskPayload,
  DeleteScheduledTaskPayload,
  TriggerScheduledTaskPayload,
  TriggerScheduledTaskResponse,
  GoalPausePayload,
  GoalResumePayload,
  GoalResumeResponse,
  GoalStatus,
  SkillLocalInspectPayload,
  SkillLocalInspectResponse,
  SkillLocalScanPayload,
  SkillLocalScanResponse,
  SkillLocalImportPayload,
  SkillLocalImportResponse,
  UpgradeConversationTrackPayload,
  RebindConversationTargetPayload,
  DeleteConversationPayload,
  ConversationDecideToolApprovalPayload,
  ConversationDecideToolApprovalResponse,
  ListPendingToolApprovalsPayload,
  ListPendingToolApprovalsResponse,
  KernelDetectResponse,
  OpenGatewayStatusResponse,
  GatewayLogsResponse,
} from '@sync-think/protocol';
import type { ArtifactImagePreviewResponse } from '../artifact-image-preview-contract.js';
import type {
  RendererCreateProviderPayload,
  RendererUpdateProviderPayload,
  RendererUpdateProviderCredentialPayload,
} from '../provider-payloads.js';
import type { Event } from '@sync-think/shared';
import type {
  CancelProjectTerminalPayload,
  CancelProjectTerminalResult,
  ProjectTerminalEvent,
  SearchProjectContentPayload,
  SearchProjectContentResult,
  StartProjectTerminalPayload,
  StartProjectTerminalResult,
} from '../workspace-tools-contract.js';
import {
  CAPABILITY_RUNTIME_IPC_CHANNELS,
  type RuntimeConnectOutcome,
} from '../runtime-bridge-contract.js';
import type {
  DesktopUpdateActionResult,
  DesktopUpdateSnapshot,
} from '../desktop-update-contract.js';
import type { OpenExternalUrlResult } from '../external-link-contract.js';
import type {
  ManagedKernelUpdateActionResult,
  ManagedKernelUpdateBridge,
  ManagedKernelUpdateSnapshot,
} from '../kernel-update-contract.js';

const api = {
  runtime: {
    connect: async (): Promise<RuntimeConnectOutcome> => {
      try {
        return (await ipcRenderer.invoke('runtime:connect')) as RuntimeConnectOutcome;
      } catch {
        return {
          ok: false,
          error: { code: 'desktop.bridge-error', retryable: false },
        };
      }
    },
    appendMessage: (payload: AppendMessagePayload) =>
      ipcRenderer.invoke('runtime:append-message', payload) as Promise<AppendMessageResponse>,
    openExternalUrl: (url: string) =>
      ipcRenderer.invoke('desktop:open-external-url', url) as Promise<OpenExternalUrlResult>,
    detectKernels: () =>
      ipcRenderer.invoke('runtime:kernel-detect') as Promise<KernelDetectResponse>,
    getGatewayStatus: () =>
      ipcRenderer.invoke('runtime:gateway-status') as Promise<OpenGatewayStatusResponse>,
    getGatewayLogs: (query?: { offset?: number; limit?: number }) =>
      ipcRenderer.invoke('runtime:gateway-logs', query ?? {}) as Promise<GatewayLogsResponse>,
    clearGatewayLogs: () => ipcRenderer.invoke('runtime:gateway-logs-clear') as Promise<void>,
    installKernel: (kernelId: string) =>
      ipcRenderer.invoke('desktop:kernel-install', kernelId) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    cancelRun: (payload: CancelRunPayload) =>
      ipcRenderer.invoke('runtime:run-cancel', payload) as Promise<PauseResumeCancelResponse>,
    createWorkspace: (payload: CreateWorkspacePayload) =>
      ipcRenderer.invoke('runtime:workspace-create', payload) as Promise<CreateWorkspaceResponse>,
    bindWorkspaceFolder: (payload: BindWorkspaceFolderPayload) =>
      ipcRenderer.invoke(
        'runtime:workspace-bind-folder',
        payload,
      ) as Promise<BindWorkspaceFolderResponse>,
    listWorkspaces: (payload: ListWorkspacesPayload = {}) =>
      ipcRenderer.invoke('runtime:workspace-list', payload) as Promise<ListWorkspacesResponse>,
    updateWorkspace: (payload: UpdateWorkspacePayload) =>
      ipcRenderer.invoke('runtime:workspace-update', payload) as Promise<UpdateWorkspaceResponse>,
    deleteWorkspace: (payload: DeleteWorkspacePayload) =>
      ipcRenderer.invoke('runtime:workspace-delete', payload) as Promise<DeleteWorkspaceResponse>,
    createTask: (payload: CreateTaskPayload) =>
      ipcRenderer.invoke('runtime:task-create', payload) as Promise<CreateTaskResponse>,
    listTasks: (payload: ListTasksPayload) =>
      ipcRenderer.invoke('runtime:task-list', payload) as Promise<ListTasksResponse>,
    openTask: (payload: OpenTaskPayload) =>
      ipcRenderer.invoke('runtime:task-open', payload) as Promise<OpenTaskResponse>,
    searchTasks: (payload: SearchTasksPayload) =>
      ipcRenderer.invoke('runtime:task-search', payload) as Promise<SearchTasksResponse>,
    setParticipationMode: (payload: SetParticipationModePayload) =>
      ipcRenderer.invoke('runtime:mode-set', payload) as Promise<SetParticipationModeResponse>,
    archiveTask: (payload: import('@sync-think/protocol').ArchiveTaskPayload) =>
      ipcRenderer.invoke('runtime:task-archive', payload) as Promise<
        import('@sync-think/protocol').ArchiveTaskResponse
      >,
    unarchiveTask: (payload: import('@sync-think/protocol').UnarchiveTaskPayload) =>
      ipcRenderer.invoke('runtime:task-unarchive', payload) as Promise<
        import('@sync-think/protocol').UnarchiveTaskResponse
      >,
    createPlan: (payload: PlanDraftPayload) =>
      ipcRenderer.invoke('runtime:plan-create', payload) as Promise<PlanDraftResponse>,
    revisePlan: (payload: PlanRevisePayload) =>
      ipcRenderer.invoke('runtime:plan-revise', payload) as Promise<PlanReviseResponse>,
    listPlanRevisions: (payload: PlanListRevisionsPayload) =>
      ipcRenderer.invoke('runtime:plan-list', payload) as Promise<PlanListRevisionsResponse>,
    approvePlan: (payload: PlanApprovePayload) =>
      ipcRenderer.invoke('runtime:plan-approve', payload) as Promise<PlanApproveResponse>,
    getRunGraph: (payload: RunGetGraphPayload) =>
      ipcRenderer.invoke('runtime:run-graph', payload) as Promise<RunGetGraphResponse>,
    pauseOrchestrationRun: (payload: OrchestrationRunMutationPayload) =>
      ipcRenderer.invoke(
        'runtime:orchestration-run-pause',
        payload,
      ) as Promise<OrchestrationRunMutationResponse>,
    resumeOrchestrationRun: (payload: OrchestrationRunMutationPayload) =>
      ipcRenderer.invoke(
        'runtime:orchestration-run-resume',
        payload,
      ) as Promise<OrchestrationRunMutationResponse>,
    cancelOrchestrationRun: (payload: OrchestrationRunMutationPayload) =>
      ipcRenderer.invoke(
        'runtime:orchestration-run-cancel',
        payload,
      ) as Promise<OrchestrationRunMutationResponse>,
    savePolicy: (payload: SavePolicyPayload) =>
      ipcRenderer.invoke('runtime:policy-save', payload) as Promise<SavePolicyResponse>,
    listPolicies: (payload: ListPoliciesPayload) =>
      ipcRenderer.invoke('runtime:policy-list', payload) as Promise<ListPoliciesResponse>,
    getArtifactImagePreview: (payload: GetArtifactVersionPayload) =>
      ipcRenderer.invoke(
        'runtime:artifact-image-preview',
        payload,
      ) as Promise<ArtifactImagePreviewResponse>,
    listArtifacts: (payload: ListArtifactsPayload) =>
      ipcRenderer.invoke('runtime:artifact-list', payload) as Promise<ListArtifactsResponse>,
    compareArtifactVersions: (payload: CompareArtifactVersionsPayload) =>
      ipcRenderer.invoke(
        'runtime:artifact-compare',
        payload,
      ) as Promise<CompareArtifactVersionsResponse>,
    selectArtifactVersion: (payload: SelectArtifactVersionPayload) =>
      ipcRenderer.invoke(
        'runtime:artifact-select',
        payload,
      ) as Promise<SelectArtifactVersionResponse>,
    mergeArtifactVersions: (payload: MergeArtifactVersionsPayload) =>
      ipcRenderer.invoke(
        'runtime:artifact-merge',
        payload,
      ) as Promise<MergeArtifactVersionsResponse>,
    listArtifactMergeConflicts: (payload: ListArtifactMergeConflictsPayload) =>
      ipcRenderer.invoke(
        'runtime:artifact-conflict-list',
        payload,
      ) as Promise<ListArtifactMergeConflictsResponse>,
    resolveArtifactMergeConflict: (payload: ResolveArtifactMergeConflictPayload) =>
      ipcRenderer.invoke(
        'runtime:artifact-conflict-resolve',
        payload,
      ) as Promise<ResolveArtifactMergeConflictResponse>,
    createProvider: (payload: RendererCreateProviderPayload) =>
      ipcRenderer.invoke('runtime:provider-create', payload) as Promise<CreateProviderResponse>,
    updateProvider: (payload: RendererUpdateProviderPayload) =>
      ipcRenderer.invoke('runtime:provider-update', payload) as Promise<UpdateProviderResponse>,
    previewCcSwitchImport: (payload: PreviewCcSwitchImportPayload = {}) =>
      ipcRenderer.invoke(
        'runtime:provider-preview-cc-switch',
        payload,
      ) as Promise<PreviewCcSwitchImportResponse>,
    importCcSwitch: (payload: ImportCcSwitchPayload) =>
      ipcRenderer.invoke(
        'runtime:provider-import-cc-switch',
        payload,
      ) as Promise<ImportCcSwitchResponse>,
    listProviders: (payload: ListProvidersPayload = {}) =>
      ipcRenderer.invoke('runtime:provider-list', payload) as Promise<ListProvidersResponse>,
    discoverModels: (payload: DiscoverModelsPayload) =>
      ipcRenderer.invoke('runtime:provider-discover', payload) as Promise<DiscoverModelsResponse>,
    addModels: (payload: AddModelsPayload) =>
      ipcRenderer.invoke('runtime:provider-add-models', payload) as Promise<AddModelsResponse>,
    probeCapabilities: (payload: ProbeCapabilitiesPayload) =>
      ipcRenderer.invoke(
        'runtime:provider-probe-capabilities',
        payload,
      ) as Promise<ProbeCapabilitiesResponse>,
    confirmCapabilities: (payload: ConfirmCapabilitiesPayload) =>
      ipcRenderer.invoke(
        'runtime:provider-confirm-capabilities',
        payload,
      ) as Promise<ConfirmCapabilitiesResponse>,
    reorderProviders: (payload: ReorderProvidersPayload) =>
      ipcRenderer.invoke('runtime:provider-reorder', payload) as Promise<ReorderProvidersResponse>,
    addProviderCredential: (payload: { providerId: string; label?: string }) =>
      ipcRenderer.invoke(
        'runtime:provider-add-credential',
        payload,
      ) as Promise<AddProviderCredentialResponse>,
    removeProviderCredential: (payload: RemoveProviderCredentialPayload) =>
      ipcRenderer.invoke(
        'runtime:provider-remove-credential',
        payload,
      ) as Promise<RemoveProviderCredentialResponse>,
    revealProviderCredential: (payload: RevealProviderCredentialPayload) =>
      ipcRenderer.invoke(
        'runtime:provider-reveal-credential',
        payload,
      ) as Promise<RevealProviderCredentialResponse>,
    updateProviderCredential: (payload: RendererUpdateProviderCredentialPayload) =>
      ipcRenderer.invoke(
        'runtime:provider-update-credential',
        payload,
      ) as Promise<UpdateProviderCredentialResponse>,
    setModelPriorities: (payload: SetModelPrioritiesPayload) =>
      ipcRenderer.invoke(
        'runtime:provider-set-model-priorities',
        payload,
      ) as Promise<SetModelPrioritiesResponse>,
    updateModel: (payload: UpdateModelPayload) =>
      ipcRenderer.invoke('runtime:provider-update-model', payload) as Promise<UpdateModelResponse>,
    removeProviderModel: (payload: RemoveModelPayload) =>
      ipcRenderer.invoke('runtime:provider-remove-model', payload) as Promise<RemoveModelResponse>,
    getSettings: (payload: GetSettingsPayload = {}) =>
      ipcRenderer.invoke('runtime:settings-get', payload) as Promise<GetSettingsResponse>,
    setSetting: (payload: SetSettingPayload) =>
      ipcRenderer.invoke('runtime:settings-set', payload) as Promise<SetSettingResponse>,
    getDataStorageStats: () =>
      ipcRenderer.invoke('runtime:data-storage-stats', {}) as Promise<DataStorageStatsResponse>,
    exportData: (payload: ExportDesktopDataPayload = {}) =>
      ipcRenderer.invoke('desktop:data-export', payload) as Promise<ExportDesktopDataResponse>,
    importData: (payload: ImportDesktopDataPayload) =>
      ipcRenderer.invoke('desktop:data-import', payload) as Promise<ImportDesktopDataResponse>,
    backupData: (payload: DataBackupPayload) =>
      ipcRenderer.invoke('runtime:data-backup', payload) as Promise<DataBackupResponse>,
    compactDataStorage: () =>
      ipcRenderer.invoke('runtime:data-compact-storage', {}) as Promise<DataCompactStorageResponse>,
    cleanConversations: (payload: DataCleanConversationsPayload = {}) =>
      ipcRenderer.invoke(
        'runtime:data-clean-conversations',
        payload,
      ) as Promise<DataCleanConversationsResponse>,
    cleanEmptyAttachmentDirectories: () =>
      ipcRenderer.invoke(
        'runtime:data-clean-empty-attachment-directories',
        {},
      ) as Promise<DataCleanEmptyAttachmentDirectoriesResponse>,
    openDataDirectory: () =>
      ipcRenderer.invoke(
        'desktop:data-open-directory',
      ) as Promise<OpenDesktopDataDirectoryResponse>,
    getUsageSummary: (payload: UsageSummaryPayload = {}) =>
      ipcRenderer.invoke('runtime:usage-summary', payload) as Promise<UsageSummaryResponse>,
    getAgent: (payload: GetAgentPayload = {}) =>
      ipcRenderer.invoke('runtime:agent-get', payload) as Promise<GetAgentResponse>,
    updateAgentBinding: (payload: UpdateAgentBindingPayload) =>
      ipcRenderer.invoke(
        'runtime:agent-update-binding',
        payload,
      ) as Promise<UpdateAgentBindingResponse>,
    listAgents: (payload: ListAgentsPayload = {}) =>
      ipcRenderer.invoke('runtime:agent-list', payload) as Promise<ListAgentsResponse>,
    createAgent: (payload: CreateAgentPayload) =>
      ipcRenderer.invoke('runtime:agent-create', payload) as Promise<CreateAgentResponse>,
    listAgentVersions: (payload: ListAgentVersionsPayload) =>
      ipcRenderer.invoke(
        'runtime:agent-list-versions',
        payload,
      ) as Promise<ListAgentVersionsResponse>,
    createAgentVersion: (payload: CreateAgentVersionPayload) =>
      ipcRenderer.invoke(
        'runtime:agent-create-version',
        payload,
      ) as Promise<CreateAgentVersionResponse>,
    // Mutable global Agent / Team / Conversation bridge (2026-07-22 model).
    listGlobalAgents: (payload: ListGlobalAgentsPayload = {}) =>
      ipcRenderer.invoke('runtime:global-agent-list', payload) as Promise<ListGlobalAgentsResponse>,
    createGlobalAgent: (payload: CreateGlobalAgentPayload) =>
      ipcRenderer.invoke('runtime:global-agent-create', payload) as Promise<GlobalAgentResponse>,
    updateGlobalAgent: (payload: UpdateGlobalAgentPayload) =>
      ipcRenderer.invoke('runtime:global-agent-update', payload) as Promise<GlobalAgentResponse>,
    deleteGlobalAgent: (payload: DeleteGlobalAgentPayload) =>
      ipcRenderer.invoke('runtime:global-agent-delete', payload) as Promise<Record<string, never>>,
    listTeams: () => ipcRenderer.invoke('runtime:team-list') as Promise<ListTeamsResponse>,
    createTeam: (payload: CreateTeamPayload) =>
      ipcRenderer.invoke('runtime:team-create', payload) as Promise<TeamResponse>,
    updateTeam: (payload: UpdateTeamPayload) =>
      ipcRenderer.invoke('runtime:team-update', payload) as Promise<TeamResponse>,
    deleteTeam: (payload: DeleteTeamPayload) =>
      ipcRenderer.invoke('runtime:team-delete', payload) as Promise<Record<string, never>>,
    startTeamRun: (payload: StartTeamRunPayload) =>
      ipcRenderer.invoke('runtime:team-start-run', payload) as Promise<TeamRunResponse>,
    setTeamRunStatus: (payload: SetTeamRunStatusPayload) =>
      ipcRenderer.invoke('runtime:team-set-run-status', payload) as Promise<TeamRunResponse>,
    listConversations: (payload: ListConversationsPayload = {}) =>
      ipcRenderer.invoke(
        'runtime:conversation-list',
        payload,
      ) as Promise<ListConversationsResponse>,
    listConversationMessages: (payload: ConversationListMessagesPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-list-messages',
        payload,
      ) as Promise<ConversationListMessagesResponse>,
    getConversationContextStatus: (payload: ConversationGetContextStatusPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-get-context-status',
        payload,
      ) as Promise<ConversationGetContextStatusResponse>,
    getConversationRunProcess: (payload: ConversationGetRunProcessPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-get-run-process',
        payload,
      ) as Promise<ConversationGetRunProcessResponse>,
    subscribeConversationTransientStream: (
      payload: { threadId: string; afterStreamSequence?: number },
      listener: (
        event:
          | { type: 'frame'; frame: ConversationTransientFrame }
          | {
              type: 'reset';
              latestStreamSequence: number;
              snapshot?: ConversationTransientSnapshot;
            },
      ) => void,
    ) => {
      const subscriptionId = `renderer-transient-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const channel = 'runtime:conversation-transient';
      const handler = (
        _event: Electron.IpcRendererEvent,
        event: { subscriptionId: string } & (
          | { type: 'frame'; frame: ConversationTransientFrame }
          | {
              type: 'reset';
              latestStreamSequence: number;
              snapshot?: ConversationTransientSnapshot;
            }
        ),
      ) => {
        if (event.subscriptionId !== subscriptionId) return;
        if (event.type === 'frame') listener({ type: 'frame', frame: event.frame });
        else
          listener({
            type: 'reset',
            latestStreamSequence: event.latestStreamSequence,
            ...(event.snapshot ? { snapshot: event.snapshot } : {}),
          });
      };
      ipcRenderer.on(channel, handler);
      const ready = ipcRenderer.invoke('runtime:conversation-subscribe-transient', {
        ...payload,
        subscriptionId,
      }) as Promise<{ subscriptionId: string }>;
      let closed = false;
      return {
        ready,
        unsubscribe: async () => {
          if (closed) return;
          closed = true;
          ipcRenderer.removeListener(channel, handler);
          await ready.catch(() => undefined);
          await ipcRenderer
            .invoke('runtime:conversation-unsubscribe-transient', { subscriptionId })
            .catch(() => undefined);
        },
      };
    },
    createConversation: (payload: CreateConversationPayload) =>
      ipcRenderer.invoke('runtime:conversation-create', payload) as Promise<ConversationResponse>,
    renameConversation: (payload: RenameConversationPayload) =>
      ipcRenderer.invoke('runtime:conversation-rename', payload) as Promise<ConversationResponse>,
    setConversationPinned: (payload: SetConversationPinnedPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-set-pinned',
        payload,
      ) as Promise<ConversationResponse>,
    setConversationArchived: (payload: SetConversationArchivedPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-set-archived',
        payload,
      ) as Promise<ConversationResponse>,
    setConversationExecutionMode: (payload: SetConversationExecutionModePayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-set-execution-mode',
        payload,
      ) as Promise<ConversationResponse>,
    setConversationInteractionMode: (payload: SetConversationInteractionModePayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-set-interaction-mode',
        payload,
      ) as Promise<ConversationResponse>,
    setConversationContextWindowOverride: (payload: SetConversationContextWindowOverridePayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-set-context-window-override',
        payload,
      ) as Promise<ConversationResponse>,
    conversationPlanSubmit: (payload: ConversationPlanSubmitPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-plan-submit',
        payload,
      ) as Promise<ConversationPlanResponse>,
    conversationPlanGet: (payload: ConversationPlanGetPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-plan-get',
        payload,
      ) as Promise<ConversationPlanResponse>,
    conversationPlanApprove: (payload: ConversationPlanApprovePayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-plan-approve',
        payload,
      ) as Promise<ConversationPlanApproveResponse>,
    conversationPlanRevise: (payload: ConversationPlanRevisePayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-plan-revise',
        payload,
      ) as Promise<ConversationPlanResponse>,
    conversationPlanCancel: (payload: ConversationPlanCancelPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-plan-cancel',
        payload,
      ) as Promise<ConversationPlanResponse>,
    conversationAskAnswer: (payload: ConversationAskAnswerPayload) =>
      ipcRenderer.invoke('runtime:conversation-ask-answer', payload) as Promise<{ askId: string }>,
    conversationAskCancel: (payload: ConversationAskCancelPayload) =>
      ipcRenderer.invoke('runtime:conversation-ask-cancel', payload) as Promise<{ askId: string }>,
    conversationAskPending: (payload: ConversationAskPendingPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-ask-pending',
        payload,
      ) as Promise<ConversationAskPendingResponse>,
    createScheduledTask: (payload: CreateScheduledTaskPayload) =>
      ipcRenderer.invoke('runtime:scheduled-task-create', payload) as Promise<{
        task: import('@sync-think/shared').ScheduledTask;
      }>,
    listScheduledTasks: (payload?: ListScheduledTasksPayload) =>
      ipcRenderer.invoke(
        'runtime:scheduled-task-list',
        payload ?? {},
      ) as Promise<ListScheduledTasksResponse>,
    updateScheduledTask: (payload: UpdateScheduledTaskPayload) =>
      ipcRenderer.invoke('runtime:scheduled-task-update', payload) as Promise<{
        task: import('@sync-think/shared').ScheduledTask;
      }>,
    deleteScheduledTask: (payload: DeleteScheduledTaskPayload) =>
      ipcRenderer.invoke('runtime:scheduled-task-delete', payload) as Promise<{ deleted: boolean }>,
    triggerScheduledTask: (payload: TriggerScheduledTaskPayload) =>
      ipcRenderer.invoke(
        'runtime:scheduled-task-trigger',
        payload,
      ) as Promise<TriggerScheduledTaskResponse>,
    scheduledTaskHistory: (payload: ListScheduledTaskHistoryPayload) =>
      ipcRenderer.invoke(
        'runtime:scheduled-task-history',
        payload,
      ) as Promise<ListScheduledTaskHistoryResponse>,
    activityListRuns: (payload: ActivityListRunsPayload) =>
      ipcRenderer.invoke(
        'runtime:activity-list-runs',
        payload ?? {},
      ) as Promise<ActivityListRunsResponse>,
    activityListExternalEvents: (payload: ActivityListExternalEventsPayload) =>
      ipcRenderer.invoke(
        'runtime:activity-list-external-events',
        payload ?? {},
      ) as Promise<ActivityListExternalEventsResponse>,
    activityRetryAnchor: (payload: ActivityRetryAnchorPayload) =>
      ipcRenderer.invoke(
        'runtime:activity-retry-anchor',
        payload,
      ) as Promise<ActivityRetryAnchorResponse>,
    goalPause: (payload: GoalPausePayload) =>
      ipcRenderer.invoke('runtime:goal-pause', payload) as Promise<{ goal?: GoalStatus }>,
    goalResume: (payload: GoalResumePayload) =>
      ipcRenderer.invoke('runtime:goal-resume', payload) as Promise<GoalResumeResponse>,
    requestDaemonStatus: () =>
      ipcRenderer.invoke('daemon:get-status') as Promise<{
        ok: boolean;
        payload?: unknown;
        error?: string;
      }>,
    daemonStart: () =>
      ipcRenderer.invoke('daemon:start') as Promise<{ ok: boolean; spawned: boolean }>,
    daemonStop: () => ipcRenderer.invoke('daemon:stop') as Promise<{ ok: boolean }>,
    daemonSetAutostart: (payload: { enabled: boolean }) =>
      ipcRenderer.invoke('daemon:set-autostart', payload) as Promise<{ ok: boolean }>,
    daemonSetMaxConcurrent: (payload: { maxConcurrent: number }) =>
      ipcRenderer.invoke('daemon:set-max-concurrent', payload) as Promise<{
        ok: boolean;
        maxConcurrent: number;
      }>,
    daemonLogs: () => ipcRenderer.invoke('daemon:get-logs') as Promise<string[]>,
    skillLocalScan: (payload?: SkillLocalScanPayload) =>
      ipcRenderer.invoke(
        'runtime:skill-local-scan',
        payload ?? {},
      ) as Promise<SkillLocalScanResponse>,
    skillLocalInspect: (payload: SkillLocalInspectPayload) =>
      ipcRenderer.invoke(
        'runtime:skill-local-inspect',
        payload,
      ) as Promise<SkillLocalInspectResponse>,
    skillLocalImport: (payload: SkillLocalImportPayload) =>
      ipcRenderer.invoke(
        'runtime:skill-local-import',
        payload,
      ) as Promise<SkillLocalImportResponse>,
    decideToolApproval: (payload: ConversationDecideToolApprovalPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-decide-tool-approval',
        payload,
      ) as Promise<ConversationDecideToolApprovalResponse>,
    listPendingToolApprovals: (payload: ListPendingToolApprovalsPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-list-pending-tool-approvals',
        payload,
      ) as Promise<ListPendingToolApprovalsResponse>,
    /** AI 浏览器命令（click/type/read/screenshot）结果回传给 runtime 工具循环。 */
    submitBrowserResult: (payload: {
      requestId: string;
      ok: boolean;
      resultJson?: string;
      error?: string;
    }) =>
      ipcRenderer.invoke('runtime:conversation-submit-browser-result', payload) as Promise<{
        requestId: string;
        accepted: boolean;
      }>,
    /** AI browser_screenshot：主进程 capturePage + PNG 写入项目 .sync-think/screenshots/。 */
    saveBrowserScreenshot: (payload: { root: string; webContentsId: number }) =>
      ipcRenderer.invoke('desktop:save-browser-screenshot', payload) as Promise<{
        ok: boolean;
        path?: string;
        relativePath?: string;
        embedUrl?: string;
        pageUrl?: string;
        error?: string;
      }>,
    upgradeConversationTrack: (payload: UpgradeConversationTrackPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-upgrade-track',
        payload,
      ) as Promise<ConversationResponse>,
    /** 对话内切换目标：同轨换绑或跨轨切换（model/agent/team 全放开）。 */
    rebindConversationTarget: (payload: RebindConversationTargetPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-rebind-target',
        payload,
      ) as Promise<ConversationResponse>,
    deleteConversation: (payload: DeleteConversationPayload) =>
      ipcRenderer.invoke('runtime:conversation-delete', payload) as Promise<Record<string, never>>,
    sendConversationMessage: (payload: {
      conversationId: string;
      text: string;
      modelId?: string;
    }) =>
      ipcRenderer.invoke('runtime:conversation-send-message', payload) as Promise<{
        messageId: string;
        threadId: string;
        taskVersion: number;
        streamId?: string;
        conversationTitle?: string;
      }>,
    compactConversation: (payload: import('@sync-think/protocol').ConversationCompactPayload) =>
      ipcRenderer.invoke('runtime:conversation-compact', payload) as Promise<
        import('@sync-think/protocol').ConversationCompactResponse
      >,
    setGoal: (payload: import('@sync-think/protocol').GoalSetPayload) =>
      ipcRenderer.invoke('runtime:goal-set', payload) as Promise<
        import('@sync-think/protocol').GoalSetResponse
      >,
    getGoal: (payload: import('@sync-think/protocol').GoalGetPayload) =>
      ipcRenderer.invoke('runtime:goal-get', payload) as Promise<
        import('@sync-think/protocol').GoalGetResponse
      >,
    clearGoal: (payload: import('@sync-think/protocol').GoalClearPayload) =>
      ipcRenderer.invoke('runtime:goal-clear', payload) as Promise<
        import('@sync-think/protocol').GoalClearResponse
      >,
    importSkill: (payload: ImportSkillPayload) =>
      ipcRenderer.invoke('runtime:skill-import', payload) as Promise<ImportSkillResponse>,
    importRemoteSkill: (payload: ImportRemoteSkillPayload) =>
      ipcRenderer.invoke(
        'runtime:skill-import-remote',
        payload,
      ) as Promise<ImportRemoteSkillResponse>,
    listSkillMarket: () =>
      ipcRenderer.invoke('runtime:skill-market-list') as Promise<ListSkillMarketResponse>,
    installSkillMarket: (payload: InstallSkillMarketPayload) =>
      ipcRenderer.invoke(
        'runtime:skill-market-install',
        payload,
      ) as Promise<InstallSkillMarketResponse>,
    listSkills: (payload: ListSkillsPayload = {}) =>
      ipcRenderer.invoke('runtime:skill-list', payload) as Promise<ListSkillsResponse>,
    deleteSkill: (payload: DeleteSkillPayload) =>
      ipcRenderer.invoke('runtime:skill-delete', payload) as Promise<DeleteSkillResponse>,
    getSkill: (payload: GetSkillPayload) =>
      ipcRenderer.invoke('runtime:skill-get', payload) as Promise<GetSkillResponse>,
    setSkillEnabled: (payload: SetSkillEnabledPayload) =>
      ipcRenderer.invoke('runtime:skill-set-enabled', payload) as Promise<SetSkillEnabledResponse>,
    registerMcpServer: (payload: RegisterMcpServerPayload) =>
      ipcRenderer.invoke('runtime:mcp-register', payload) as Promise<RegisterMcpServerResponse>,
    registerRemoteMcpServer: (payload: RegisterRemoteMcpPayload) =>
      ipcRenderer.invoke(
        'runtime:mcp-register-remote',
        payload,
      ) as Promise<RegisterRemoteMcpResponse>,
    listMcpServers: (payload: ListMcpServersPayload = {}) =>
      ipcRenderer.invoke('runtime:mcp-list', payload) as Promise<ListMcpServersResponse>,
    setMcpServerEnabled: (payload: SetMcpServerEnabledPayload) =>
      ipcRenderer.invoke(
        'runtime:mcp-set-enabled',
        payload,
      ) as Promise<SetMcpServerEnabledResponse>,
    deleteMcpServer: (payload: DeleteMcpServerPayload) =>
      ipcRenderer.invoke('runtime:mcp-delete', payload) as Promise<DeleteMcpServerResponse>,
    getBotChannelConfig: (payload: GetBotChannelConfigPayload) =>
      ipcRenderer.invoke(
        'runtime:bot-channel-get',
        payload,
      ) as Promise<GetBotChannelConfigResponse>,
    saveBotChannelConfig: (payload: SaveBotChannelConfigPayload) =>
      ipcRenderer.invoke(
        'runtime:bot-channel-save',
        payload,
      ) as Promise<SaveBotChannelConfigResponse>,
    testBotChannel: (payload: TestBotChannelPayload) =>
      ipcRenderer.invoke('runtime:bot-channel-test', payload) as Promise<TestBotChannelResponse>,
    requestWechatBotQr: (payload: RequestWechatBotQrPayload = {}) =>
      ipcRenderer.invoke(
        'runtime:bot-channel-wechat-qr-request',
        payload,
      ) as Promise<RequestWechatBotQrResponse>,
    checkWechatBotQr: (payload: CheckWechatBotQrPayload) =>
      ipcRenderer.invoke(
        'runtime:bot-channel-wechat-qr-check',
        payload,
      ) as Promise<CheckWechatBotQrResponse>,
    probeMcpPolicy: (payload: ProbeMcpPolicyPayload = {}) =>
      ipcRenderer.invoke('runtime:mcp-policy-probe', payload) as Promise<ProbeMcpPolicyResponse>,
    requestMcpTool: (payload: RequestMcpToolPayload) =>
      ipcRenderer.invoke('runtime:mcp-tool-request', payload) as Promise<RequestMcpToolResponse>,
    probeMcpSpawn: (payload: ProbeMcpSpawnPayload = {}) =>
      ipcRenderer.invoke('runtime:mcp-spawn-probe', payload) as Promise<ProbeMcpSpawnResponse>,
    callMcpTool: (payload: CallMcpToolPayload) =>
      ipcRenderer.invoke('runtime:mcp-tool-call', payload) as Promise<CallMcpToolResponse>,
    refreshMcpTools: (payload: RefreshMcpToolsPayload) =>
      ipcRenderer.invoke('runtime:mcp-tools-refresh', payload) as Promise<RefreshMcpToolsResponse>,
    listCapabilityWorkspaceActivations: (payload: CapabilityWorkspaceListPayload) =>
      ipcRenderer.invoke(
        CAPABILITY_RUNTIME_IPC_CHANNELS.listWorkspaceActivations,
        payload,
      ) as Promise<CapabilityWorkspaceListResponse>,
    setCapabilityWorkspaceActive: (payload: CapabilityWorkspaceSetActivePayload) =>
      ipcRenderer.invoke(
        CAPABILITY_RUNTIME_IPC_CHANNELS.setWorkspaceActive,
        payload,
      ) as Promise<CapabilityWorkspaceSetActiveResponse>,
    listCapabilityGovernance: (payload: CapabilityGovernanceListPayload) =>
      ipcRenderer.invoke(
        CAPABILITY_RUNTIME_IPC_CHANNELS.listGovernance,
        payload,
      ) as Promise<CapabilityGovernanceListResponse>,
    saveSkillPublishDraft: (payload: SaveSkillPublishDraftPayload) =>
      ipcRenderer.invoke(
        CAPABILITY_RUNTIME_IPC_CHANNELS.savePublishDraft,
        payload,
      ) as Promise<SaveSkillPublishDraftResponse>,
    listSkillPublishDrafts: (payload: ListSkillPublishDraftsPayload = {}) =>
      ipcRenderer.invoke(
        CAPABILITY_RUNTIME_IPC_CHANNELS.listPublishDrafts,
        payload,
      ) as Promise<ListSkillPublishDraftsResponse>,
    getSkillPublishDraft: (payload: GetSkillPublishDraftPayload) =>
      ipcRenderer.invoke(
        CAPABILITY_RUNTIME_IPC_CHANNELS.getPublishDraft,
        payload,
      ) as Promise<GetSkillPublishDraftResponse>,
    submitSkillPublishDraft: (payload: SubmitSkillPublishDraftPayload) =>
      ipcRenderer.invoke(
        CAPABILITY_RUNTIME_IPC_CHANNELS.submitPublishDraft,
        payload,
      ) as Promise<SubmitSkillPublishDraftResponse>,
    previewCapabilityOrganize: (payload: PreviewCapabilityOrganizePayload) =>
      ipcRenderer.invoke(
        CAPABILITY_RUNTIME_IPC_CHANNELS.previewOrganize,
        payload,
      ) as Promise<PreviewCapabilityOrganizeResponse>,
    getLatestCapabilityOrganize: (payload: GetLatestCapabilityOrganizePayload) =>
      ipcRenderer.invoke(
        CAPABILITY_RUNTIME_IPC_CHANNELS.getLatestOrganize,
        payload,
      ) as Promise<GetLatestCapabilityOrganizeResponse>,
    listWaitingDesktopCommands: (payload: ListWaitingDesktopCommandsPayload = {}) =>
      ipcRenderer.invoke(
        'runtime:desktop-command-list-waiting',
        payload,
      ) as Promise<ListWaitingDesktopCommandsResponse>,
    continueDesktopCommand: (payload: ContinueDesktopCommandPayload) =>
      ipcRenderer.invoke(
        'runtime:desktop-command-continue',
        payload,
      ) as Promise<ContinueDesktopCommandResponse>,
    cancelDesktopCommand: (payload: CancelDesktopCommandPayload) =>
      ipcRenderer.invoke(
        'runtime:desktop-command-cancel',
        payload,
      ) as Promise<CancelDesktopCommandResponse>,
    listBrowserProfiles: (payload: ListBrowserProfilesPayload = {}) =>
      ipcRenderer.invoke(
        'runtime:browser-profile-list',
        payload,
      ) as Promise<ListBrowserProfilesResponse>,
    createBrowserProfile: (payload: CreateBrowserProfilePayload) =>
      ipcRenderer.invoke(
        'runtime:browser-profile-create',
        payload,
      ) as Promise<CreateBrowserProfileResponse>,
    renameBrowserProfile: (payload: RenameBrowserProfilePayload) =>
      ipcRenderer.invoke(
        'runtime:browser-profile-rename',
        payload,
      ) as Promise<RenameBrowserProfileResponse>,
    deleteBrowserProfile: (payload: DeleteBrowserProfilePayload) =>
      ipcRenderer.invoke(
        'runtime:browser-profile-delete',
        payload,
      ) as Promise<DeleteBrowserProfileResponse>,
    listBrowserSiteSessions: (payload: ListBrowserSiteSessionsPayload) =>
      ipcRenderer.invoke(
        'runtime:browser-profile-list-site-sessions',
        payload,
      ) as Promise<ListBrowserSiteSessionsResponse>,
    clearBrowserSiteSession: (payload: ClearBrowserSiteSessionPayload) =>
      ipcRenderer.invoke(
        'runtime:browser-profile-clear-site-session',
        payload,
      ) as Promise<ClearBrowserSiteSessionResponse>,
    browserRecording: {
      list: (payload: ListBrowserRecordingsPayload) =>
        ipcRenderer.invoke(
          'runtime:browser-recording-list',
          payload,
        ) as Promise<ListBrowserRecordingsResponse>,
      get: (payload: GetBrowserRecordingPayload) =>
        ipcRenderer.invoke(
          'runtime:browser-recording-get',
          payload,
        ) as Promise<GetBrowserRecordingResponse>,
      start: (payload: StartBrowserRecordingPayload) =>
        ipcRenderer.invoke(
          'runtime:browser-recording-start',
          payload,
        ) as Promise<StartBrowserRecordingResponse>,
      stop: (payload: StopBrowserRecordingPayload) =>
        ipcRenderer.invoke(
          'runtime:browser-recording-stop',
          payload,
        ) as Promise<StopBrowserRecordingResponse>,
    },
    browserWorkflow: {
      list: (payload: ListBrowserWorkflowsPayload = {}) =>
        ipcRenderer.invoke(
          'runtime:browser-workflow-list',
          payload,
        ) as Promise<ListBrowserWorkflowsResponse>,
      get: (payload: GetBrowserWorkflowPayload) =>
        ipcRenderer.invoke(
          'runtime:browser-workflow-get',
          payload,
        ) as Promise<GetBrowserWorkflowResponse>,
      createDraft: (payload: CreateBrowserWorkflowDraftPayload) =>
        ipcRenderer.invoke(
          'runtime:browser-workflow-create-draft',
          payload,
        ) as Promise<CreateBrowserWorkflowDraftResponse>,
      createRevisionDraft: (payload: CreateBrowserWorkflowRevisionDraftPayload) =>
        ipcRenderer.invoke(
          'runtime:browser-workflow-create-revision-draft',
          payload,
        ) as Promise<CreateBrowserWorkflowRevisionDraftResponse>,
      submit: (payload: SubmitBrowserWorkflowDraftPayload) =>
        ipcRenderer.invoke(
          'runtime:browser-workflow-submit',
          payload,
        ) as Promise<SubmitBrowserWorkflowDraftResponse>,
      review: (payload: ReviewBrowserWorkflowDraftPayload) =>
        ipcRenderer.invoke(
          'runtime:browser-workflow-review',
          payload,
        ) as Promise<ReviewBrowserWorkflowDraftResponse>,
      execute: (payload: ExecuteBrowserWorkflowPayload) =>
        ipcRenderer.invoke(
          'runtime:browser-workflow-execute',
          payload,
        ) as Promise<ExecuteBrowserWorkflowResponse>,
      approveAndExecute: (payload: ApproveExecuteBrowserWorkflowPayload) =>
        ipcRenderer.invoke(
          'runtime:browser-workflow-approve-execute',
          payload,
        ) as Promise<ExecuteBrowserWorkflowResponse>,
    },
    listWaitingBrowserHandoffs: (payload: ListWaitingBrowserHandoffsPayload = {}) =>
      ipcRenderer.invoke(
        'runtime:browser-handoff-list-waiting',
        payload,
      ) as Promise<ListWaitingBrowserHandoffsResponse>,
    continueBrowserHandoff: (payload: ContinueBrowserHandoffPayload) =>
      ipcRenderer.invoke(
        'runtime:browser-handoff-continue',
        payload,
      ) as Promise<ContinueBrowserHandoffResponse>,
    cancelBrowserHandoff: (payload: CancelBrowserHandoffPayload) =>
      ipcRenderer.invoke(
        'runtime:browser-handoff-cancel',
        payload,
      ) as Promise<CancelBrowserHandoffResponse>,
    listApprovals: (payload: ListApprovalsPayload = {}) =>
      ipcRenderer.invoke('runtime:approval-list', payload) as Promise<ListApprovalsResponse>,
    evaluateApproval: (payload: EvaluateApprovalPayload) =>
      ipcRenderer.invoke('runtime:approval-evaluate', payload) as Promise<EvaluateApprovalResponse>,
    enqueueApproval: (payload: EnqueueApprovalPayload) =>
      ipcRenderer.invoke('runtime:approval-enqueue', payload) as Promise<EnqueueApprovalResponse>,
    decideApproval: (payload: DecideApprovalPayload) =>
      ipcRenderer.invoke('runtime:approval-decide', payload) as Promise<DecideApprovalResponse>,
    listMemory: (payload: ListMemoryPayload = {}) =>
      ipcRenderer.invoke('runtime:memory-list', payload) as Promise<ListMemoryResponse>,
    decideMemory: (payload: DecideMemoryPayload) =>
      ipcRenderer.invoke('runtime:memory-decide', payload) as Promise<DecideMemoryResponse>,
    rollbackMemory: (payload: RollbackMemoryPayload) =>
      ipcRenderer.invoke('runtime:memory-rollback', payload) as Promise<RollbackMemoryResponse>,
    peekContextPacket: (payload: PeekContextPacketPayload) =>
      ipcRenderer.invoke(
        'runtime:context-packet-peek',
        payload,
      ) as Promise<PeekContextPacketResponse>,
    amendContextPacket: (payload: AmendContextPacketPayload) =>
      ipcRenderer.invoke(
        'runtime:context-packet-amend',
        payload,
      ) as Promise<AmendContextPacketResponse>,
    listDiagnostics: (payload: ListDiagnosticsPayload = {}) =>
      ipcRenderer.invoke('runtime:diagnostics-list', payload) as Promise<ListDiagnosticsResponse>,
    exportDiagnostics: (payload: ExportDesktopDiagnosticsPayload = {}) =>
      ipcRenderer.invoke(
        'desktop:diagnostics-export',
        payload,
      ) as Promise<ExportDesktopDiagnosticsResponse>,
    pickFolder: (payload?: { title?: string }) =>
      ipcRenderer.invoke('desktop:pick-folder', payload) as Promise<{
        canceled: boolean;
        path: string | null;
      }>,
    pickSkillZip: () =>
      ipcRenderer.invoke('desktop:pick-skill-zip') as Promise<{
        canceled: boolean;
        path: string | null;
      }>,
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    /** Push the renderer theme preference onto the native frame/title bar. */
    setTheme: (theme: 'light' | 'dark' | 'system') =>
      ipcRenderer.invoke('desktop:set-theme', theme) as Promise<{ dark: boolean }>,
    setGlobalShortcut: (payload: { accelerator: string; enabled: boolean }) =>
      ipcRenderer.invoke('desktop:set-global-shortcut', payload) as Promise<{
        registered: boolean;
        error: string | null;
      }>,
    listProjectFiles: (payload: { root: string; query?: string; maxEntries?: number }) =>
      ipcRenderer.invoke('desktop:list-project-files', payload) as Promise<{
        root: string;
        files: Array<{ path: string; name: string; kind: 'file' | 'dir' }>;
      }>,
    searchProjectContent: (payload: SearchProjectContentPayload) =>
      ipcRenderer.invoke(
        'desktop:search-project-content',
        payload,
      ) as Promise<SearchProjectContentResult>,
    startProjectTerminal: (payload: StartProjectTerminalPayload) =>
      ipcRenderer.invoke(
        'desktop:start-project-terminal',
        payload,
      ) as Promise<StartProjectTerminalResult>,
    cancelProjectTerminal: (payload: CancelProjectTerminalPayload) =>
      ipcRenderer.invoke(
        'desktop:cancel-project-terminal',
        payload,
      ) as Promise<CancelProjectTerminalResult>,
    subscribeProjectTerminal: (listener: (event: ProjectTerminalEvent) => void) => {
      const channel = 'desktop:project-terminal-event';
      const handler = (_event: Electron.IpcRendererEvent, terminalEvent: ProjectTerminalEvent) =>
        listener(terminalEvent);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
    /** 文件 Pane：读取文本及乐观并发元数据。 */
    readProjectFile: (payload: { root: string; path: string }) =>
      ipcRenderer.invoke('desktop:read-project-file', payload) as Promise<{
        path: string;
        content: string | null;
        error: string | null;
        errorCode: string | null;
        mtimeMs: number | null;
        size: number | null;
      }>,
    writeProjectFile: (payload: {
      root: string;
      path: string;
      content: string;
      expectedMtimeMs: number | null;
      expectedSize?: number | null;
      force?: boolean;
    }) =>
      ipcRenderer.invoke('desktop:write-project-file', payload) as Promise<{
        path: string;
        ok: boolean;
        conflict: boolean;
        error: string | null;
        errorCode: string | null;
        mtimeMs: number | null;
        size: number | null;
      }>,
    watchProjectFile: (
      payload: { root: string; path: string },
      listener: (change: {
        path: string;
        exists: boolean;
        mtimeMs: number | null;
        size: number | null;
      }) => void,
    ) => {
      const subscriptionId = `renderer-file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const channel = 'desktop:project-file-changed';
      const handler = (
        _event: Electron.IpcRendererEvent,
        event: {
          subscriptionId: string;
          change: {
            path: string;
            exists: boolean;
            mtimeMs: number | null;
            size: number | null;
          };
        },
      ) => {
        if (event.subscriptionId === subscriptionId) listener(event.change);
      };
      ipcRenderer.on(channel, handler);
      const ready = ipcRenderer.invoke('desktop:watch-project-file', {
        ...payload,
        subscriptionId,
      }) as Promise<{ subscriptionId: string }>;
      let closed = false;
      return {
        ready,
        unsubscribe: async () => {
          if (closed) return;
          closed = true;
          ipcRenderer.removeListener(channel, handler);
          await ready.catch(() => undefined);
          await ipcRenderer
            .invoke('desktop:unwatch-project-file', { subscriptionId })
            .catch(() => undefined);
        },
      };
    },
    /** 右栏「文件」面板树形视图：列出项目内单层目录（懒加载展开）。 */
    listProjectDir: (payload: { root: string; dir?: string }) =>
      ipcRenderer.invoke('desktop:list-project-dir', payload) as Promise<{
        dir: string;
        entries: Array<{ name: string; path: string; kind: 'file' | 'dir' }>;
      }>,
    /** ZCode Git tools / 工作区面板共享的仓库事实快照。 */
    getGitInfo: (payload: { root: string }) =>
      ipcRenderer.invoke('desktop:git-info', payload) as Promise<ProjectGitInfo>,
    /** 打开 ZCode 式工作区更改审阅所需的前后文本快照。 */
    getGitReview: (payload: { root: string }) =>
      ipcRenderer.invoke('desktop:git-review', payload) as Promise<ProjectGitReview>,
    /** 切换分支（脏工作区需显式 stash/force 策略）。 */
    gitCheckout: (payload: {
      root: string;
      branch: string;
      strategy?: 'check' | 'stash' | 'force';
    }) => ipcRenderer.invoke('desktop:git-checkout', payload) as Promise<ProjectGitCheckoutResult>,
    gitCreateBranch: (payload: { root: string; branch: string }) =>
      ipcRenderer.invoke('desktop:git-create-branch', payload) as Promise<ProjectGitActionResult>,
    gitCommit: (payload: {
      root: string;
      message: string;
      includeUnstaged: boolean;
      push: boolean;
    }) => ipcRenderer.invoke('desktop:git-commit', payload) as Promise<ProjectGitCommitResult>,
    gitPush: (payload: { root: string }) =>
      ipcRenderer.invoke('desktop:git-push', payload) as Promise<ProjectGitPushResult>,
    /** 能力中心：主进程代理下载公网 SKILL.md 文本（renderer CSP 不放外网）。 */
    fetchSkillMd: (payload: { url: string }) =>
      ipcRenderer.invoke('desktop:fetch-skill-md', payload) as Promise<{
        url: string;
        skillMd: string;
      }>,
    getM1ExitEvidence: () =>
      ipcRenderer.invoke('desktop:m1-exit-evidence') as Promise<{
        ok: boolean;
        handtestChecked: number;
        handtestTotal: number;
        handtestBoxes?: Array<{
          index: number;
          section: string;
          sectionTitle: string;
          label: string;
          checked: boolean;
          line: number;
        }>;
        dogfoodFileCount: number;
        dogfoodRealDays: number;
        dogfoodDays?: Array<{
          date: string;
          kind: 'real' | 'scaffold' | string;
          pendingCount: number;
          checkedCount: number;
          filledSignals: number;
          fileName: string;
        }>;
        dualAutomatedOk?: boolean;
        loadNote?: string | null;
      }>,
    openM1Doc: (
      id: 'handtest' | 'dogfood' | 'dogfood-today' | 'dogfood-template' | 'dogfood-day',
      opts?: { date?: string },
    ) =>
      ipcRenderer.invoke('desktop:m1-open-doc', {
        id,
        date: opts?.date,
      }) as Promise<{
        ok: boolean;
        error: string | null;
        path: string | null;
        created: boolean;
      }>,
    onEvent: (listener: (event: Event) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, runtimeEvent: Event) => {
        listener(runtimeEvent);
      };
      ipcRenderer.on('runtime:event', handler);
      return () => ipcRenderer.removeListener('runtime:event', handler);
    },
    onOpenConversation: (listener: (conversationId: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { conversationId: string }) =>
        listener(payload.conversationId);
      ipcRenderer.on('desktop:open-conversation', handler);
      return () => ipcRenderer.removeListener('desktop:open-conversation', handler);
    },
    notifyRendererReady: () => {
      ipcRenderer.send('desktop:renderer-ready');
    },
    openHtmlInBrowser: (html: string) =>
      ipcRenderer.invoke('desktop:open-html-file', html) as Promise<{
        ok: boolean;
        error: string | null;
        path: string | null;
      }>,
  },
  updates: {
    getState: () =>
      ipcRenderer.invoke('desktop:update-get-state') as Promise<DesktopUpdateSnapshot>,
    checkForUpdates: () =>
      ipcRenderer.invoke('desktop:update-check') as Promise<DesktopUpdateActionResult>,
    downloadUpdate: () =>
      ipcRenderer.invoke('desktop:update-download') as Promise<DesktopUpdateActionResult>,
    installUpdate: () =>
      ipcRenderer.invoke('desktop:update-install') as Promise<DesktopUpdateActionResult>,
    getAutoCheck: () =>
      ipcRenderer.invoke(
        'desktop:update-get-auto-check',
      ) as Promise<DesktopUpdateAutoCheckPreference>,
    setAutoCheck: (payload: DesktopUpdateAutoCheckPreference) =>
      ipcRenderer.invoke(
        'desktop:update-set-auto-check',
        payload,
      ) as Promise<DesktopUpdateAutoCheckPreference>,
    openReleaseNotes: () =>
      ipcRenderer.invoke('desktop:update-open-release-notes') as Promise<DesktopUpdateOpenResult>,
    openLogDirectory: () =>
      ipcRenderer.invoke(
        'desktop:data-open-directory',
      ) as Promise<OpenDesktopDataDirectoryResponse>,
    subscribeState: (listener: (snapshot: DesktopUpdateSnapshot) => void) => {
      const channel = 'desktop:update-state';
      const handler = (_event: Electron.IpcRendererEvent, snapshot: DesktopUpdateSnapshot) =>
        listener(snapshot);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  },
  kernelUpdates: {
    getState: () =>
      ipcRenderer.invoke('desktop:kernel-update-get-state') as Promise<ManagedKernelUpdateSnapshot>,
    checkForUpdates: () =>
      ipcRenderer.invoke('desktop:kernel-update-check') as Promise<ManagedKernelUpdateActionResult>,
    installUpdate: (payload: Parameters<ManagedKernelUpdateBridge['installUpdate']>[0]) =>
      ipcRenderer.invoke(
        'desktop:kernel-update-install',
        payload,
      ) as Promise<ManagedKernelUpdateActionResult>,
  } satisfies ManagedKernelUpdateBridge,
  platform: 'win32' as const,
};

contextBridge.exposeInMainWorld('syncThink', api);
