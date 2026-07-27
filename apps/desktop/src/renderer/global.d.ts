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
  ListSkillsPayload,
  ListSkillsResponse,
  DeleteSkillPayload,
  DeleteSkillResponse,
  RegisterMcpServerPayload,
  RegisterMcpServerResponse,
  ListMcpServersPayload,
  ListMcpServersResponse,
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
import type { RuntimeConnectOutcome } from '../runtime-bridge-contract.js';

declare global {
  interface Window {
    syncThink?: {
      runtime: {
        connect(): Promise<RuntimeConnectOutcome>;
        appendMessage(payload: AppendMessagePayload): Promise<AppendMessageResponse>;
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
        addProviderCredential(
          payload: { providerId: string; label?: string },
        ): Promise<AddProviderCredentialResponse>;
        removeProviderCredential(
          payload: RemoveProviderCredentialPayload,
        ): Promise<RemoveProviderCredentialResponse>;
        revealProviderCredential(
          payload: import('@sync-think/protocol').RevealProviderCredentialPayload,
        ): Promise<import('@sync-think/protocol').RevealProviderCredentialResponse>;
        updateProviderCredential(
          payload: RendererUpdateProviderCredentialPayload,
        ): Promise<import('@sync-think/protocol').UpdateProviderCredentialResponse>;
        setModelPriorities(
          payload: SetModelPrioritiesPayload,
        ): Promise<SetModelPrioritiesResponse>;
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
          listener: (event:
            | { type: 'frame'; frame: ConversationTransientFrame }
            | {
                type: 'reset';
                latestStreamSequence: number;
                snapshot?: ConversationTransientSnapshot;
              }) => void,
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
        decideToolApproval(
          payload: import('@sync-think/protocol').ConversationDecideToolApprovalPayload,
        ): Promise<import('@sync-think/protocol').ConversationDecideToolApprovalResponse>;
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
        importSkill(payload: ImportSkillPayload): Promise<ImportSkillResponse>;
        listSkills(payload?: ListSkillsPayload): Promise<ListSkillsResponse>;
        deleteSkill(payload: DeleteSkillPayload): Promise<DeleteSkillResponse>;
        getSkill(
          payload: import('@sync-think/protocol').GetSkillPayload,
        ): Promise<import('@sync-think/protocol').GetSkillResponse>;
        fetchSkillMd(payload: { url: string }): Promise<{ url: string; skillMd: string }>;
        registerMcpServer(payload: RegisterMcpServerPayload): Promise<RegisterMcpServerResponse>;
        listMcpServers(payload?: ListMcpServersPayload): Promise<ListMcpServersResponse>;
        probeMcpPolicy(payload?: ProbeMcpPolicyPayload): Promise<ProbeMcpPolicyResponse>;
        requestMcpTool(payload: RequestMcpToolPayload): Promise<RequestMcpToolResponse>;
        probeMcpSpawn(payload?: ProbeMcpSpawnPayload): Promise<ProbeMcpSpawnResponse>;
        callMcpTool(payload: CallMcpToolPayload): Promise<CallMcpToolResponse>;
        refreshMcpTools(payload: RefreshMcpToolsPayload): Promise<RefreshMcpToolsResponse>;
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
        pickFolder(): Promise<{ canceled: boolean; path: string | null }>;
        /** Push the renderer theme preference onto the native frame/title bar. */
        setTheme(theme: 'light' | 'dark' | 'system'): Promise<{ dark: boolean }>;
        listProjectFiles(payload: {
          root: string;
          query?: string;
          maxEntries?: number;
        }): Promise<{
          root: string;
          files: Array<{ path: string; name: string; kind: 'file' | 'dir' }>;
        }>;
        readProjectFile(payload: { root: string; path: string }): Promise<{
          path: string;
          content: string | null;
          error: string | null;
        }>;
        listProjectDir(payload: { root: string; dir?: string }): Promise<{
          dir: string;
          entries: Array<{ name: string; path: string; kind: 'file' | 'dir' }>;
        }>;
        getGitInfo(payload: { root: string }): Promise<{
          branch: string | null;
          branches: string[];
          changes: Array<{ status: string; path: string }>;
          recentCommits: Array<{ hash: string; subject: string }>;
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
