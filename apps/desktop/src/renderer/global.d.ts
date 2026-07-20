import type {
  AppendMessagePayload,
  AppendMessageResponse,
  BindWorkspaceFolderPayload,
  BindWorkspaceFolderResponse,
  BindWorkspaceGitRepositoryPayload,
  BindWorkspaceGitRepositoryResponse,
  ResolveWorktreeIntegrationPayload,
  ResolveWorktreeIntegrationResponse,
  ListBrowserIdentitiesResponse,
  CreateBrowserIdentityPayload,
  CreateBrowserIdentityResponse,
  UpdateBrowserIdentityPayload,
  UpdateBrowserIdentityResponse,
  DeleteBrowserIdentityPayload,
  DeleteBrowserIdentityResponse,
  SetTaskBrowserIdentityPayload,
  SetTaskBrowserIdentityResponse,
  DescribeTaskExecutionAccessPayload,
  DescribeTaskExecutionAccessResponse,
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
  GetArtifactVersionPayload,
  GetArtifactVersionResponse,
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
  CreateGroupPayload,
  CreateGroupResponse,
  GetGroupPayload,
  GetGroupResponse,
  ListGroupsPayload,
  ListGroupsResponse,
  UpdateGroupPayload,
  UpdateGroupResponse,
  AddGroupMemberPayload,
  RemoveGroupMemberPayload,
  UpdateGroupMemberResponsibilityPayload,
  SetGroupLeadPayload,
  GroupMemberMutationResponse,
  CreateGroupTaskPayload,
  CreateGroupTaskResponse,
  ResolveApplicationToolConfirmationPayload,
  ConfirmApplicationToolResponse,
  RejectApplicationToolResponse,
  CreateAutomationPayload,
  UpdateAutomationPayload,
  DeleteAutomationPayload,
  GetAutomationPayload,
  ListAutomationsPayload,
  TriggerAutomationPayload,
  ListAutomationExecutionsPayload,
  AutomationCommandResponse,
  DeleteAutomationResponse,
  GetAutomationResponse,
  ListAutomationsResponse,
  TriggerAutomationResponse,
  ListAutomationExecutionsResponse,
} from '@sync-think/protocol';
import type {
  RendererCreateProviderPayload,
  RendererUpdateProviderPayload,
} from '../provider-payloads.js';
import type { Event, MessageAttachment } from '@sync-think/shared';
import type { RuntimeConnectOutcome } from '../runtime-bridge-contract.js';

declare global {
  interface Window {
    syncThink?: {
      runtime: {
        connect(): Promise<RuntimeConnectOutcome>;
        appendMessage(payload: AppendMessagePayload): Promise<AppendMessageResponse>;
        confirmApplicationTool(
          payload: ResolveApplicationToolConfirmationPayload,
        ): Promise<ConfirmApplicationToolResponse>;
        rejectApplicationTool(
          payload: ResolveApplicationToolConfirmationPayload,
        ): Promise<RejectApplicationToolResponse>;
        createAutomation(payload: CreateAutomationPayload): Promise<AutomationCommandResponse>;
        updateAutomation(payload: UpdateAutomationPayload): Promise<AutomationCommandResponse>;
        deleteAutomation(payload: DeleteAutomationPayload): Promise<DeleteAutomationResponse>;
        getAutomation(payload: GetAutomationPayload): Promise<GetAutomationResponse>;
        listAutomations(payload?: ListAutomationsPayload): Promise<ListAutomationsResponse>;
        triggerAutomation(payload: TriggerAutomationPayload): Promise<TriggerAutomationResponse>;
        listAutomationExecutions(
          payload?: ListAutomationExecutionsPayload,
        ): Promise<ListAutomationExecutionsResponse>;
        cancelRun(payload: CancelRunPayload): Promise<PauseResumeCancelResponse>;
        createWorkspace(payload: CreateWorkspacePayload): Promise<CreateWorkspaceResponse>;
        bindWorkspaceFolder(
          payload: BindWorkspaceFolderPayload,
        ): Promise<BindWorkspaceFolderResponse>;
        bindWorkspaceGitRepository(
          payload: BindWorkspaceGitRepositoryPayload,
        ): Promise<BindWorkspaceGitRepositoryResponse>;
        listWorkspaces(payload?: ListWorkspacesPayload): Promise<ListWorkspacesResponse>;
        listBrowserIdentities(): Promise<ListBrowserIdentitiesResponse>;
        createBrowserIdentity(
          payload: CreateBrowserIdentityPayload,
        ): Promise<CreateBrowserIdentityResponse>;
        updateBrowserIdentity(
          payload: UpdateBrowserIdentityPayload,
        ): Promise<UpdateBrowserIdentityResponse>;
        deleteBrowserIdentity(
          payload: DeleteBrowserIdentityPayload,
        ): Promise<DeleteBrowserIdentityResponse>;
        createTask(payload: CreateTaskPayload): Promise<CreateTaskResponse>;
        resolveWorktreeIntegration(
          payload: ResolveWorktreeIntegrationPayload,
        ): Promise<ResolveWorktreeIntegrationResponse>;
        setTaskBrowserIdentity(
          payload: SetTaskBrowserIdentityPayload,
        ): Promise<SetTaskBrowserIdentityResponse>;
        describeTaskExecutionAccess(
          payload: DescribeTaskExecutionAccessPayload,
        ): Promise<DescribeTaskExecutionAccessResponse>;
        listTasks(payload: ListTasksPayload): Promise<ListTasksResponse>;
        openTask(payload: OpenTaskPayload): Promise<OpenTaskResponse>;
        loadMessageAttachmentPreview(attachment: {
          managedRef: string;
          mimeType: string;
          sha256?: string;
        }): Promise<string | null>;
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
        discardEmptyTask(
          payload: import('@sync-think/protocol').DiscardEmptyTaskPayload,
        ): Promise<import('@sync-think/protocol').DiscardEmptyTaskResponse>;
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
        getArtifactVersion(payload: GetArtifactVersionPayload): Promise<GetArtifactVersionResponse>;
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
        createGroup(payload: CreateGroupPayload): Promise<CreateGroupResponse>;
        getGroup(payload: GetGroupPayload): Promise<GetGroupResponse>;
        listGroups(payload?: ListGroupsPayload): Promise<ListGroupsResponse>;
        updateGroup(payload: UpdateGroupPayload): Promise<UpdateGroupResponse>;
        addGroupMember(payload: AddGroupMemberPayload): Promise<GroupMemberMutationResponse>;
        removeGroupMember(payload: RemoveGroupMemberPayload): Promise<GroupMemberMutationResponse>;
        updateGroupMemberResponsibility(
          payload: UpdateGroupMemberResponsibilityPayload,
        ): Promise<GroupMemberMutationResponse>;
        setGroupLead(payload: SetGroupLeadPayload): Promise<GroupMemberMutationResponse>;
        createGroupTask(payload: CreateGroupTaskPayload): Promise<CreateGroupTaskResponse>;
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
        pickMessageAttachments(
          kind: 'files' | 'folder',
        ): Promise<Array<MessageAttachment & { previewUrl?: string }>>;
        stageMessageFiles(
          files: readonly File[],
        ): Promise<Array<MessageAttachment & { previewUrl?: string }>>;
        stageMessageFileData(
          sources: readonly { name: string; mimeType?: string; bytes: Uint8Array }[],
        ): Promise<Array<MessageAttachment & { previewUrl?: string }>>;
        loadMessageAttachmentPreview(attachment: {
          managedRef: string;
          mimeType: string;
          sha256?: string;
        }): Promise<string | null>;
        pickAgentAvatar(): Promise<
          | { canceled: true }
          | {
              canceled: false;
              avatarPath: string;
              avatarUrl: string;
              width: number;
              height: number;
            }
        >;
        loadAgentAvatar(avatarPath: string): Promise<{
          avatarPath: string;
          avatarUrl: string;
          width: number;
          height: number;
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
