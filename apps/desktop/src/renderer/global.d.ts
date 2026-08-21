import type {
  ExportDesktopDiagnosticsPayload,
  ExportDesktopDiagnosticsResponse,
} from '../diagnostics-export-contract.js';
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
  ListSkillsPayload,
  ListSkillsResponse,
  DeleteSkillPayload,
  DeleteSkillResponse,
  SetSkillEnabledPayload,
  SetSkillEnabledResponse,
  RegisterMcpServerPayload,
  RegisterMcpServerResponse,
  RegisterRemoteMcpPayload,
  RegisterRemoteMcpResponse,
  ListMcpServersPayload,
  ListMcpServersResponse,
  SetMcpServerEnabledPayload,
  SetMcpServerEnabledResponse,
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
  ConversationSendMessagePayload,
  ConversationSendMessageResponse,
  ConversationTransientFrame,
  ConversationTransientSnapshot,
} from '@sync-think/protocol';
import type {
  RendererCreateProviderPayload,
  RendererUpdateProviderPayload,
  RendererUpdateProviderCredentialPayload,
} from '../provider-payloads.js';
import type { Event } from '@sync-think/shared';
import type { ArtifactImagePreviewResponse } from '../artifact-image-preview-contract.js';
import type { RuntimeConnectOutcome } from '../runtime-bridge-contract.js';
import type {
  DesktopUpdateActionResult,
  DesktopUpdateSnapshot,
} from '../desktop-update-contract.js';
import type {
  CancelProjectTerminalPayload,
  CancelProjectTerminalResult,
  ProjectTerminalEvent,
  SearchProjectContentPayload,
  SearchProjectContentResult,
  StartProjectTerminalPayload,
  StartProjectTerminalResult,
} from '../workspace-tools-contract.js';

declare global {
  interface Window {
    syncThink?: {
      runtime: {
        connect(): Promise<RuntimeConnectOutcome>;
        appendMessage(payload: AppendMessagePayload): Promise<AppendMessageResponse>;
        detectKernels(): Promise<import('@sync-think/protocol').KernelDetectResponse>;
        getGatewayStatus?(): Promise<import('@sync-think/protocol').OpenGatewayStatusResponse>;
        getGatewayLogs?(query?: {
          offset?: number;
          limit?: number;
          filter?: {
            kernelId?: string;
            status?: 'success' | 'error';
            converted?: boolean;
          };
        }): Promise<import('@sync-think/protocol').GatewayLogsResponse>;
        clearGatewayLogs?(): Promise<void>;
        installKernel(kernelId: string): Promise<{ ok: true } | { ok: false; error: string }>;
        cancelRun(payload: CancelRunPayload): Promise<PauseResumeCancelResponse>;
        createWorkspace(payload: CreateWorkspacePayload): Promise<CreateWorkspaceResponse>;
        bindWorkspaceFolder(
          payload: BindWorkspaceFolderPayload,
        ): Promise<BindWorkspaceFolderResponse>;
        listWorkspaces(payload?: ListWorkspacesPayload): Promise<ListWorkspacesResponse>;
        updateWorkspace(payload: UpdateWorkspacePayload): Promise<UpdateWorkspaceResponse>;
        deleteWorkspace(payload: DeleteWorkspacePayload): Promise<DeleteWorkspaceResponse>;
        createTask(payload: CreateTaskPayload): Promise<CreateTaskResponse>;
        listTasks(payload: ListTasksPayload): Promise<ListTasksResponse>;
        openTask(payload: OpenTaskPayload): Promise<OpenTaskResponse>;
        searchTasks(payload: SearchTasksPayload): Promise<SearchTasksResponse>;
        setParticipationMode(
          payload: SetParticipationModePayload,
        ): Promise<SetParticipationModeResponse>;
        archiveTask(
          payload: import('@sync-think/protocol').ArchiveTaskPayload,
        ): Promise<import('@sync-think/protocol').ArchiveTaskResponse>;
        unarchiveTask(
          payload: import('@sync-think/protocol').UnarchiveTaskPayload,
        ): Promise<import('@sync-think/protocol').UnarchiveTaskResponse>;
        createPlan(payload: PlanDraftPayload): Promise<PlanDraftResponse>;
        revisePlan(payload: PlanRevisePayload): Promise<PlanReviseResponse>;
        listPlanRevisions(payload: PlanListRevisionsPayload): Promise<PlanListRevisionsResponse>;
        approvePlan(payload: PlanApprovePayload): Promise<PlanApproveResponse>;
        getRunGraph(payload: RunGetGraphPayload): Promise<RunGetGraphResponse>;
        pauseOrchestrationRun(
          payload: OrchestrationRunMutationPayload,
        ): Promise<OrchestrationRunMutationResponse>;
        resumeOrchestrationRun(
          payload: OrchestrationRunMutationPayload,
        ): Promise<OrchestrationRunMutationResponse>;
        cancelOrchestrationRun(
          payload: OrchestrationRunMutationPayload,
        ): Promise<OrchestrationRunMutationResponse>;
        savePolicy(payload: SavePolicyPayload): Promise<SavePolicyResponse>;
        listPolicies(payload: ListPoliciesPayload): Promise<ListPoliciesResponse>;
        getArtifactImagePreview(
          payload: GetArtifactVersionPayload,
        ): Promise<ArtifactImagePreviewResponse>;
        listArtifacts(payload: ListArtifactsPayload): Promise<ListArtifactsResponse>;
        compareArtifactVersions(
          payload: CompareArtifactVersionsPayload,
        ): Promise<CompareArtifactVersionsResponse>;
        selectArtifactVersion(
          payload: SelectArtifactVersionPayload,
        ): Promise<SelectArtifactVersionResponse>;
        mergeArtifactVersions(
          payload: MergeArtifactVersionsPayload,
        ): Promise<MergeArtifactVersionsResponse>;
        listArtifactMergeConflicts(
          payload: ListArtifactMergeConflictsPayload,
        ): Promise<ListArtifactMergeConflictsResponse>;
        resolveArtifactMergeConflict(
          payload: ResolveArtifactMergeConflictPayload,
        ): Promise<ResolveArtifactMergeConflictResponse>;
        createProvider(payload: RendererCreateProviderPayload): Promise<CreateProviderResponse>;
        updateProvider(payload: RendererUpdateProviderPayload): Promise<UpdateProviderResponse>;
        previewCcSwitchImport(
          payload?: PreviewCcSwitchImportPayload,
        ): Promise<PreviewCcSwitchImportResponse>;
        importCcSwitch(payload: ImportCcSwitchPayload): Promise<ImportCcSwitchResponse>;
        listProviders(payload?: ListProvidersPayload): Promise<ListProvidersResponse>;
        discoverModels(payload: DiscoverModelsPayload): Promise<DiscoverModelsResponse>;
        addModels(payload: AddModelsPayload): Promise<AddModelsResponse>;
        probeCapabilities(payload: ProbeCapabilitiesPayload): Promise<ProbeCapabilitiesResponse>;
        confirmCapabilities(
          payload: ConfirmCapabilitiesPayload,
        ): Promise<ConfirmCapabilitiesResponse>;
        reorderProviders(payload: ReorderProvidersPayload): Promise<ReorderProvidersResponse>;
        addProviderCredential(payload: {
          providerId: string;
          label?: string;
        }): Promise<AddProviderCredentialResponse>;
        removeProviderCredential(
          payload: RemoveProviderCredentialPayload,
        ): Promise<RemoveProviderCredentialResponse>;
        revealProviderCredential(
          payload: import('@sync-think/protocol').RevealProviderCredentialPayload,
        ): Promise<import('@sync-think/protocol').RevealProviderCredentialResponse>;
        updateProviderCredential(
          payload: RendererUpdateProviderCredentialPayload,
        ): Promise<import('@sync-think/protocol').UpdateProviderCredentialResponse>;
        setModelPriorities(payload: SetModelPrioritiesPayload): Promise<SetModelPrioritiesResponse>;
        updateModel(payload: UpdateModelPayload): Promise<UpdateModelResponse>;
        removeProviderModel(payload: RemoveModelPayload): Promise<RemoveModelResponse>;
        getSettings(payload?: GetSettingsPayload): Promise<GetSettingsResponse>;
        setSetting(payload: SetSettingPayload): Promise<SetSettingResponse>;
        getUsageSummary(payload?: UsageSummaryPayload): Promise<UsageSummaryResponse>;
        getAgent(payload?: GetAgentPayload): Promise<GetAgentResponse>;
        updateAgentBinding(payload: UpdateAgentBindingPayload): Promise<UpdateAgentBindingResponse>;
        listAgents(payload?: ListAgentsPayload): Promise<ListAgentsResponse>;
        createAgent(payload: CreateAgentPayload): Promise<CreateAgentResponse>;
        listAgentVersions(payload: ListAgentVersionsPayload): Promise<ListAgentVersionsResponse>;
        createAgentVersion(payload: CreateAgentVersionPayload): Promise<CreateAgentVersionResponse>;
        listGlobalAgents(
          payload?: import('@sync-think/protocol').ListGlobalAgentsPayload,
        ): Promise<import('@sync-think/protocol').ListGlobalAgentsResponse>;
        createGlobalAgent(
          payload: import('@sync-think/protocol').CreateGlobalAgentPayload,
        ): Promise<import('@sync-think/protocol').GlobalAgentResponse>;
        updateGlobalAgent(
          payload: import('@sync-think/protocol').UpdateGlobalAgentPayload,
        ): Promise<import('@sync-think/protocol').GlobalAgentResponse>;
        deleteGlobalAgent(
          payload: import('@sync-think/protocol').DeleteGlobalAgentPayload,
        ): Promise<Record<string, never>>;
        listTeams(): Promise<import('@sync-think/protocol').ListTeamsResponse>;
        createTeam(
          payload: import('@sync-think/protocol').CreateTeamPayload,
        ): Promise<import('@sync-think/protocol').TeamResponse>;
        updateTeam(
          payload: import('@sync-think/protocol').UpdateTeamPayload,
        ): Promise<import('@sync-think/protocol').TeamResponse>;
        deleteTeam(
          payload: import('@sync-think/protocol').DeleteTeamPayload,
        ): Promise<Record<string, never>>;
        startTeamRun(
          payload: import('@sync-think/protocol').StartTeamRunPayload,
        ): Promise<import('@sync-think/protocol').TeamRunResponse>;
        setTeamRunStatus(
          payload: import('@sync-think/protocol').SetTeamRunStatusPayload,
        ): Promise<import('@sync-think/protocol').TeamRunResponse>;
        listConversations(
          payload?: import('@sync-think/protocol').ListConversationsPayload,
        ): Promise<import('@sync-think/protocol').ListConversationsResponse>;
        listConversationMessages(
          payload: import('@sync-think/protocol').ConversationListMessagesPayload,
        ): Promise<import('@sync-think/protocol').ConversationListMessagesResponse>;
        getConversationContextStatus(
          payload: import('@sync-think/protocol').ConversationGetContextStatusPayload,
        ): Promise<import('@sync-think/protocol').ConversationGetContextStatusResponse>;
        getConversationRunProcess(
          payload: import('@sync-think/protocol').ConversationGetRunProcessPayload,
        ): Promise<import('@sync-think/protocol').ConversationGetRunProcessResponse>;
        subscribeConversationTransientStream(
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
        ): {
          ready: Promise<{ subscriptionId: string }>;
          unsubscribe(): Promise<void>;
        };
        createConversation(
          payload: import('@sync-think/protocol').CreateConversationPayload,
        ): Promise<import('@sync-think/protocol').ConversationResponse>;
        sendConversationMessage(
          payload: ConversationSendMessagePayload,
        ): Promise<ConversationSendMessageResponse>;
        compactConversation(
          payload: import('@sync-think/protocol').ConversationCompactPayload,
        ): Promise<import('@sync-think/protocol').ConversationCompactResponse>;
        renameConversation(
          payload: import('@sync-think/protocol').RenameConversationPayload,
        ): Promise<import('@sync-think/protocol').ConversationResponse>;
        setConversationPinned(
          payload: import('@sync-think/protocol').SetConversationPinnedPayload,
        ): Promise<import('@sync-think/protocol').ConversationResponse>;
        setConversationArchived(
          payload: import('@sync-think/protocol').SetConversationArchivedPayload,
        ): Promise<import('@sync-think/protocol').ConversationResponse>;
        setConversationExecutionMode(
          payload: import('@sync-think/protocol').SetConversationExecutionModePayload,
        ): Promise<import('@sync-think/protocol').ConversationResponse>;
        setConversationInteractionMode(
          payload: import('@sync-think/protocol').SetConversationInteractionModePayload,
        ): Promise<import('@sync-think/protocol').ConversationResponse>;
        conversationPlanSubmit(
          payload: import('@sync-think/protocol').ConversationPlanSubmitPayload,
        ): Promise<import('@sync-think/protocol').ConversationPlanResponse>;
        conversationPlanGet(
          payload: import('@sync-think/protocol').ConversationPlanGetPayload,
        ): Promise<import('@sync-think/protocol').ConversationPlanResponse>;
        conversationPlanApprove(
          payload: import('@sync-think/protocol').ConversationPlanApprovePayload,
        ): Promise<import('@sync-think/protocol').ConversationPlanApproveResponse>;
        conversationPlanRevise(
          payload: import('@sync-think/protocol').ConversationPlanRevisePayload,
        ): Promise<import('@sync-think/protocol').ConversationPlanResponse>;
        conversationPlanCancel(
          payload: import('@sync-think/protocol').ConversationPlanCancelPayload,
        ): Promise<import('@sync-think/protocol').ConversationPlanResponse>;
        conversationAskAnswer(
          payload: import('@sync-think/protocol').ConversationAskAnswerPayload,
        ): Promise<{ askId: string }>;
        conversationAskCancel(
          payload: import('@sync-think/protocol').ConversationAskCancelPayload,
        ): Promise<{ askId: string }>;
        conversationAskPending(
          payload: import('@sync-think/protocol').ConversationAskPendingPayload,
        ): Promise<import('@sync-think/protocol').ConversationAskPendingResponse>;
        createScheduledTask(
          payload: import('@sync-think/protocol').CreateScheduledTaskPayload,
        ): Promise<{ task: import('@sync-think/shared').ScheduledTask }>;
        listScheduledTasks(
          payload?: import('@sync-think/protocol').ListScheduledTasksPayload,
        ): Promise<import('@sync-think/protocol').ListScheduledTasksResponse>;
        updateScheduledTask(
          payload: import('@sync-think/protocol').UpdateScheduledTaskPayload,
        ): Promise<{ task: import('@sync-think/shared').ScheduledTask }>;
        deleteScheduledTask(
          payload: import('@sync-think/protocol').DeleteScheduledTaskPayload,
        ): Promise<{ deleted: boolean }>;
        triggerScheduledTask(
          payload: import('@sync-think/protocol').TriggerScheduledTaskPayload,
        ): Promise<import('@sync-think/protocol').TriggerScheduledTaskResponse>;
        scheduledTaskHistory(
          payload: import('@sync-think/protocol').ListScheduledTaskHistoryPayload,
        ): Promise<import('@sync-think/protocol').ListScheduledTaskHistoryResponse>;
        activityListRuns(
          payload: import('@sync-think/protocol').ActivityListRunsPayload,
        ): Promise<import('@sync-think/protocol').ActivityListRunsResponse>;
        activityListExternalEvents(
          payload: import('@sync-think/protocol').ActivityListExternalEventsPayload,
        ): Promise<import('@sync-think/protocol').ActivityListExternalEventsResponse>;
        activityRetryAnchor(
          payload: import('@sync-think/protocol').ActivityRetryAnchorPayload,
        ): Promise<import('@sync-think/protocol').ActivityRetryAnchorResponse>;
        goalPause(
          payload: import('@sync-think/protocol').GoalPausePayload,
        ): Promise<{ goal?: import('@sync-think/protocol').GoalStatus }>;
        goalResume(
          payload: import('@sync-think/protocol').GoalResumePayload,
        ): Promise<import('@sync-think/protocol').GoalResumeResponse>;
        requestDaemonStatus(): Promise<{ ok: boolean; payload?: unknown; error?: string }>;
        daemonStart(): Promise<{ ok: boolean; spawned: boolean }>;
        daemonStop(): Promise<{ ok: boolean }>;
        daemonSetAutostart(payload: { enabled: boolean }): Promise<{ ok: boolean }>;
        daemonSetMaxConcurrent(payload: {
          maxConcurrent: number;
        }): Promise<{ ok: boolean; maxConcurrent: number }>;
        daemonLogs(): Promise<string[]>;
        skillLocalScan(
          payload?: import('@sync-think/protocol').SkillLocalScanPayload,
        ): Promise<import('@sync-think/protocol').SkillLocalScanResponse>;
        skillLocalImport(
          payload: import('@sync-think/protocol').SkillLocalImportPayload,
        ): Promise<import('@sync-think/protocol').SkillLocalImportResponse>;
        decideToolApproval(
          payload: import('@sync-think/protocol').ConversationDecideToolApprovalPayload,
        ): Promise<import('@sync-think/protocol').ConversationDecideToolApprovalResponse>;
        listPendingToolApprovals(
          payload: import('@sync-think/protocol').ListPendingToolApprovalsPayload,
        ): Promise<import('@sync-think/protocol').ListPendingToolApprovalsResponse>;
        submitBrowserResult(
          payload: import('@sync-think/protocol').ConversationSubmitBrowserResultPayload,
        ): Promise<import('@sync-think/protocol').ConversationSubmitBrowserResultResponse>;
        saveBrowserScreenshot(payload: { root: string; webContentsId: number }): Promise<{
          ok: boolean;
          path?: string;
          relativePath?: string;
          embedUrl?: string;
          pageUrl?: string;
          error?: string;
        }>;
        upgradeConversationTrack(
          payload: import('@sync-think/protocol').UpgradeConversationTrackPayload,
        ): Promise<import('@sync-think/protocol').ConversationResponse>;
        rebindConversationTarget(
          payload: import('@sync-think/protocol').RebindConversationTargetPayload,
        ): Promise<import('@sync-think/protocol').ConversationResponse>;
        deleteConversation(
          payload: import('@sync-think/protocol').DeleteConversationPayload,
        ): Promise<Record<string, never>>;
        setGoal(
          payload: import('@sync-think/protocol').GoalSetPayload,
        ): Promise<import('@sync-think/protocol').GoalSetResponse>;
        getGoal(
          payload: import('@sync-think/protocol').GoalGetPayload,
        ): Promise<import('@sync-think/protocol').GoalGetResponse>;
        clearGoal(
          payload: import('@sync-think/protocol').GoalClearPayload,
        ): Promise<import('@sync-think/protocol').GoalClearResponse>;
        importSkill(payload: ImportSkillPayload): Promise<ImportSkillResponse>;
        importRemoteSkill(payload: ImportRemoteSkillPayload): Promise<ImportRemoteSkillResponse>;
        listSkills(payload?: ListSkillsPayload): Promise<ListSkillsResponse>;
        deleteSkill(payload: DeleteSkillPayload): Promise<DeleteSkillResponse>;
        setSkillEnabled(payload: SetSkillEnabledPayload): Promise<SetSkillEnabledResponse>;
        getSkill(
          payload: import('@sync-think/protocol').GetSkillPayload,
        ): Promise<import('@sync-think/protocol').GetSkillResponse>;
        fetchSkillMd(payload: { url: string }): Promise<{ url: string; skillMd: string }>;
        registerMcpServer(payload: RegisterMcpServerPayload): Promise<RegisterMcpServerResponse>;
        registerRemoteMcpServer(
          payload: RegisterRemoteMcpPayload,
        ): Promise<RegisterRemoteMcpResponse>;
        listMcpServers(payload?: ListMcpServersPayload): Promise<ListMcpServersResponse>;
        setMcpServerEnabled(
          payload: SetMcpServerEnabledPayload,
        ): Promise<SetMcpServerEnabledResponse>;
        deleteMcpServer(payload: DeleteMcpServerPayload): Promise<DeleteMcpServerResponse>;
        probeMcpPolicy(payload?: ProbeMcpPolicyPayload): Promise<ProbeMcpPolicyResponse>;
        requestMcpTool(payload: RequestMcpToolPayload): Promise<RequestMcpToolResponse>;
        probeMcpSpawn(payload?: ProbeMcpSpawnPayload): Promise<ProbeMcpSpawnResponse>;
        callMcpTool(payload: CallMcpToolPayload): Promise<CallMcpToolResponse>;
        refreshMcpTools(payload: RefreshMcpToolsPayload): Promise<RefreshMcpToolsResponse>;
        listCapabilityWorkspaceActivations(
          payload: CapabilityWorkspaceListPayload,
        ): Promise<CapabilityWorkspaceListResponse>;
        setCapabilityWorkspaceActive(
          payload: CapabilityWorkspaceSetActivePayload,
        ): Promise<CapabilityWorkspaceSetActiveResponse>;
        listCapabilityGovernance(
          payload: CapabilityGovernanceListPayload,
        ): Promise<CapabilityGovernanceListResponse>;
        saveSkillPublishDraft(
          payload: SaveSkillPublishDraftPayload,
        ): Promise<SaveSkillPublishDraftResponse>;
        listSkillPublishDrafts(
          payload?: ListSkillPublishDraftsPayload,
        ): Promise<ListSkillPublishDraftsResponse>;
        getSkillPublishDraft(
          payload: GetSkillPublishDraftPayload,
        ): Promise<GetSkillPublishDraftResponse>;
        submitSkillPublishDraft(
          payload: SubmitSkillPublishDraftPayload,
        ): Promise<SubmitSkillPublishDraftResponse>;
        previewCapabilityOrganize(
          payload: PreviewCapabilityOrganizePayload,
        ): Promise<PreviewCapabilityOrganizeResponse>;
        getLatestCapabilityOrganize(
          payload: GetLatestCapabilityOrganizePayload,
        ): Promise<GetLatestCapabilityOrganizeResponse>;
        listWaitingDesktopCommands(
          payload?: ListWaitingDesktopCommandsPayload,
        ): Promise<ListWaitingDesktopCommandsResponse>;
        continueDesktopCommand(
          payload: ContinueDesktopCommandPayload,
        ): Promise<ContinueDesktopCommandResponse>;
        cancelDesktopCommand(
          payload: CancelDesktopCommandPayload,
        ): Promise<CancelDesktopCommandResponse>;
        listBrowserProfiles(
          payload?: ListBrowserProfilesPayload,
        ): Promise<ListBrowserProfilesResponse>;
        createBrowserProfile(
          payload: CreateBrowserProfilePayload,
        ): Promise<CreateBrowserProfileResponse>;
        renameBrowserProfile(
          payload: RenameBrowserProfilePayload,
        ): Promise<RenameBrowserProfileResponse>;
        deleteBrowserProfile(
          payload: DeleteBrowserProfilePayload,
        ): Promise<DeleteBrowserProfileResponse>;
        listBrowserSiteSessions(
          payload: ListBrowserSiteSessionsPayload,
        ): Promise<ListBrowserSiteSessionsResponse>;
        clearBrowserSiteSession(
          payload: ClearBrowserSiteSessionPayload,
        ): Promise<ClearBrowserSiteSessionResponse>;
        browserRecording: {
          list(payload: ListBrowserRecordingsPayload): Promise<ListBrowserRecordingsResponse>;
          get(payload: GetBrowserRecordingPayload): Promise<GetBrowserRecordingResponse>;
          start(payload: StartBrowserRecordingPayload): Promise<StartBrowserRecordingResponse>;
          stop(payload: StopBrowserRecordingPayload): Promise<StopBrowserRecordingResponse>;
        };
        browserWorkflow: {
          list(payload?: ListBrowserWorkflowsPayload): Promise<ListBrowserWorkflowsResponse>;
          get(payload: GetBrowserWorkflowPayload): Promise<GetBrowserWorkflowResponse>;
          createDraft(
            payload: CreateBrowserWorkflowDraftPayload,
          ): Promise<CreateBrowserWorkflowDraftResponse>;
          createRevisionDraft(
            payload: CreateBrowserWorkflowRevisionDraftPayload,
          ): Promise<CreateBrowserWorkflowRevisionDraftResponse>;
          submit(
            payload: SubmitBrowserWorkflowDraftPayload,
          ): Promise<SubmitBrowserWorkflowDraftResponse>;
          review(
            payload: ReviewBrowserWorkflowDraftPayload,
          ): Promise<ReviewBrowserWorkflowDraftResponse>;
          execute(payload: ExecuteBrowserWorkflowPayload): Promise<ExecuteBrowserWorkflowResponse>;
          approveAndExecute(
            payload: ApproveExecuteBrowserWorkflowPayload,
          ): Promise<ExecuteBrowserWorkflowResponse>;
        };
        listWaitingBrowserHandoffs(
          payload?: ListWaitingBrowserHandoffsPayload,
        ): Promise<ListWaitingBrowserHandoffsResponse>;
        continueBrowserHandoff(
          payload: ContinueBrowserHandoffPayload,
        ): Promise<ContinueBrowserHandoffResponse>;
        cancelBrowserHandoff(
          payload: CancelBrowserHandoffPayload,
        ): Promise<CancelBrowserHandoffResponse>;
        listApprovals(payload?: ListApprovalsPayload): Promise<ListApprovalsResponse>;
        evaluateApproval(payload: EvaluateApprovalPayload): Promise<EvaluateApprovalResponse>;
        enqueueApproval(payload: EnqueueApprovalPayload): Promise<EnqueueApprovalResponse>;
        decideApproval(payload: DecideApprovalPayload): Promise<DecideApprovalResponse>;
        listMemory(payload?: ListMemoryPayload): Promise<ListMemoryResponse>;
        decideMemory(payload: DecideMemoryPayload): Promise<DecideMemoryResponse>;
        rollbackMemory(payload: RollbackMemoryPayload): Promise<RollbackMemoryResponse>;
        peekContextPacket(payload: PeekContextPacketPayload): Promise<PeekContextPacketResponse>;
        amendContextPacket(payload: AmendContextPacketPayload): Promise<AmendContextPacketResponse>;
        listDiagnostics(payload?: ListDiagnosticsPayload): Promise<ListDiagnosticsResponse>;
        exportDiagnostics(
          payload?: ExportDesktopDiagnosticsPayload,
        ): Promise<ExportDesktopDiagnosticsResponse>;
        pickFolder(): Promise<{ canceled: boolean; path: string | null }>;
        /** Push the renderer theme preference onto the native frame/title bar. */
        setTheme(theme: 'light' | 'dark' | 'system'): Promise<{ dark: boolean }>;
        listProjectFiles(payload: { root: string; query?: string; maxEntries?: number }): Promise<{
          root: string;
          files: Array<{ path: string; name: string; kind: 'file' | 'dir' }>;
        }>;
        searchProjectContent(
          payload: SearchProjectContentPayload,
        ): Promise<SearchProjectContentResult>;
        startProjectTerminal(
          payload: StartProjectTerminalPayload,
        ): Promise<StartProjectTerminalResult>;
        cancelProjectTerminal(
          payload: CancelProjectTerminalPayload,
        ): Promise<CancelProjectTerminalResult>;
        subscribeProjectTerminal(listener: (event: ProjectTerminalEvent) => void): () => void;
        readProjectFile(payload: { root: string; path: string }): Promise<{
          path: string;
          content: string | null;
          error: string | null;
          errorCode: string | null;
          mtimeMs: number | null;
          size: number | null;
        }>;
        writeProjectFile(payload: {
          root: string;
          path: string;
          content: string;
          expectedMtimeMs: number | null;
          expectedSize?: number | null;
          force?: boolean;
        }): Promise<{
          path: string;
          ok: boolean;
          conflict: boolean;
          error: string | null;
          errorCode: string | null;
          mtimeMs: number | null;
          size: number | null;
        }>;
        watchProjectFile(
          payload: { root: string; path: string },
          listener: (change: {
            path: string;
            exists: boolean;
            mtimeMs: number | null;
            size: number | null;
          }) => void,
        ): {
          ready: Promise<{ subscriptionId: string }>;
          unsubscribe(): Promise<void>;
        };
        listProjectDir(payload: { root: string; dir?: string }): Promise<{
          dir: string;
          entries: Array<{ name: string; path: string; kind: 'file' | 'dir' }>;
        }>;
        getGitInfo(payload: { root: string }): Promise<{
          branch: string | null;
          branches: string[];
          changes: Array<{ status: string; path: string }>;
          recentCommits: Array<{
            hash: string;
            subject: string;
            files: Array<{ status: string; path: string }>;
            truncated: boolean;
          }>;
          isRepo: boolean;
        }>;
        gitCheckout(payload: {
          root: string;
          branch: string;
          strategy?: 'check' | 'stash' | 'force';
        }): Promise<{
          ok: boolean;
          dirty: boolean;
          changes: Array<{ status: string; path: string }>;
          error: string | null;
          stashed?: boolean;
        }>;
        getM1ExitEvidence(): Promise<{
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
        }>;
        openM1Doc(
          id: 'handtest' | 'dogfood' | 'dogfood-today' | 'dogfood-template' | 'dogfood-day',
          opts?: { date?: string },
        ): Promise<{
          ok: boolean;
          error: string | null;
          path: string | null;
          created: boolean;
        }>;
        onEvent(listener: (event: Event) => void): () => void;
        onOpenConversation(listener: (conversationId: string) => void): () => void;
        notifyRendererReady(): void;
        openHtmlInBrowser(html: string): Promise<{
          ok: boolean;
          error: string | null;
          path: string | null;
        }>;
      };
      updates: {
        getState(): Promise<DesktopUpdateSnapshot>;
        checkForUpdates(): Promise<DesktopUpdateActionResult>;
        downloadUpdate(): Promise<DesktopUpdateActionResult>;
        installUpdate(): Promise<DesktopUpdateActionResult>;
        subscribeState(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void;
      };
      platform: 'win32';
    };
  }

  // Electron <webview>（内置浏览器面板）。guest 权限在 main 侧收紧。
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
