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
  GetAgentPayload,
  GetAgentResponse,
  UpdateAgentBindingPayload,
  UpdateAgentBindingResponse,
  ImportSkillPayload,
  ImportSkillResponse,
  ListSkillsPayload,
  ListSkillsResponse,
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
} from '@sync-think/protocol';
import type {
  RendererCreateProviderPayload,
  RendererUpdateProviderPayload,
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
        createConversation(
          payload: import('@sync-think/protocol').CreateConversationPayload,
        ): Promise<import('@sync-think/protocol').ConversationResponse>;
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
        upgradeConversationTrack(
          payload: import('@sync-think/protocol').UpgradeConversationTrackPayload,
        ): Promise<import('@sync-think/protocol').ConversationResponse>;
        deleteConversation(
          payload: import('@sync-think/protocol').DeleteConversationPayload,
        ): Promise<Record<string, never>>;
        importSkill(payload: ImportSkillPayload): Promise<ImportSkillResponse>;
        listSkills(payload?: ListSkillsPayload): Promise<ListSkillsResponse>;
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
        listProjectFiles(payload: {
          root: string;
          query?: string;
          maxEntries?: number;
        }): Promise<{
          root: string;
          files: Array<{ path: string; name: string; kind: 'file' | 'dir' }>;
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
      };
      platform: 'win32';
    };
  }
}

export {};
