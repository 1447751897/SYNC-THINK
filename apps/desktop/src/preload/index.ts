// Preload runs in the renderer with contextIsolation: true. Bridge exposes a
// narrow window.api so the renderer never touches Node directly (搂19).
import { contextBridge, ipcRenderer, webUtils } from 'electron';
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
  DiscardEmptyTaskPayload,
  DiscardEmptyTaskResponse,
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
  SetExecutionModePayload,
  SetExecutionModeResponse,
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
import type { Event } from '@sync-think/shared';
import type { MessageAttachment } from '@sync-think/shared';
import type { RuntimeConnectOutcome } from '../runtime-bridge-contract.js';

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
    loadMessageAttachmentPreview: (attachment: {
      managedRef: string;
      mimeType: string;
      sha256?: string;
    }) =>
      ipcRenderer.invoke('desktop:load-message-attachment-preview', attachment) as Promise<
        string | null
      >,
    confirmApplicationTool: (payload: ResolveApplicationToolConfirmationPayload) =>
      ipcRenderer.invoke(
        'runtime:application-tool-confirm',
        payload,
      ) as Promise<ConfirmApplicationToolResponse>,
    rejectApplicationTool: (payload: ResolveApplicationToolConfirmationPayload) =>
      ipcRenderer.invoke(
        'runtime:application-tool-reject',
        payload,
      ) as Promise<RejectApplicationToolResponse>,
    createAutomation: (payload: CreateAutomationPayload) =>
      ipcRenderer.invoke(
        'runtime:automation-create',
        payload,
      ) as Promise<AutomationCommandResponse>,
    updateAutomation: (payload: UpdateAutomationPayload) =>
      ipcRenderer.invoke(
        'runtime:automation-update',
        payload,
      ) as Promise<AutomationCommandResponse>,
    deleteAutomation: (payload: DeleteAutomationPayload) =>
      ipcRenderer.invoke('runtime:automation-delete', payload) as Promise<DeleteAutomationResponse>,
    getAutomation: (payload: GetAutomationPayload) =>
      ipcRenderer.invoke('runtime:automation-get', payload) as Promise<GetAutomationResponse>,
    listAutomations: (payload: ListAutomationsPayload = {}) =>
      ipcRenderer.invoke('runtime:automation-list', payload) as Promise<ListAutomationsResponse>,
    triggerAutomation: (payload: TriggerAutomationPayload) =>
      ipcRenderer.invoke(
        'runtime:automation-trigger',
        payload,
      ) as Promise<TriggerAutomationResponse>,
    listAutomationExecutions: (payload: ListAutomationExecutionsPayload = {}) =>
      ipcRenderer.invoke(
        'runtime:automation-execution-list',
        payload,
      ) as Promise<ListAutomationExecutionsResponse>,
    cancelRun: (payload: CancelRunPayload) =>
      ipcRenderer.invoke('runtime:run-cancel', payload) as Promise<PauseResumeCancelResponse>,
    createWorkspace: (payload: CreateWorkspacePayload) =>
      ipcRenderer.invoke('runtime:workspace-create', payload) as Promise<CreateWorkspaceResponse>,
    bindWorkspaceFolder: (payload: BindWorkspaceFolderPayload) =>
      ipcRenderer.invoke(
        'runtime:workspace-bind-folder',
        payload,
      ) as Promise<BindWorkspaceFolderResponse>,
    bindWorkspaceGitRepository: (payload: BindWorkspaceGitRepositoryPayload) =>
      ipcRenderer.invoke(
        'runtime:workspace-bind-git-repository',
        payload,
      ) as Promise<BindWorkspaceGitRepositoryResponse>,
    listWorkspaces: (payload: ListWorkspacesPayload = {}) =>
      ipcRenderer.invoke('runtime:workspace-list', payload) as Promise<ListWorkspacesResponse>,
    listBrowserIdentities: () =>
      ipcRenderer.invoke(
        'runtime:browser-identity-list',
        {},
      ) as Promise<ListBrowserIdentitiesResponse>,
    createBrowserIdentity: (payload: CreateBrowserIdentityPayload) =>
      ipcRenderer.invoke(
        'runtime:browser-identity-create',
        payload,
      ) as Promise<CreateBrowserIdentityResponse>,
    updateBrowserIdentity: (payload: UpdateBrowserIdentityPayload) =>
      ipcRenderer.invoke(
        'runtime:browser-identity-update',
        payload,
      ) as Promise<UpdateBrowserIdentityResponse>,
    deleteBrowserIdentity: (payload: DeleteBrowserIdentityPayload) =>
      ipcRenderer.invoke(
        'runtime:browser-identity-delete',
        payload,
      ) as Promise<DeleteBrowserIdentityResponse>,
    createTask: (payload: CreateTaskPayload) =>
      ipcRenderer.invoke('runtime:task-create', payload) as Promise<CreateTaskResponse>,
    resolveWorktreeIntegration: (payload: ResolveWorktreeIntegrationPayload) =>
      ipcRenderer.invoke(
        'runtime:task-resolve-worktree-integration',
        payload,
      ) as Promise<ResolveWorktreeIntegrationResponse>,
    setTaskBrowserIdentity: (payload: SetTaskBrowserIdentityPayload) =>
      ipcRenderer.invoke(
        'runtime:task-set-browser-identity',
        payload,
      ) as Promise<SetTaskBrowserIdentityResponse>,
    describeTaskExecutionAccess: (payload: DescribeTaskExecutionAccessPayload) =>
      ipcRenderer.invoke(
        'runtime:task-describe-execution-access',
        payload,
      ) as Promise<DescribeTaskExecutionAccessResponse>,
    listTasks: (payload: ListTasksPayload) =>
      ipcRenderer.invoke('runtime:task-list', payload) as Promise<ListTasksResponse>,
    openTask: (payload: OpenTaskPayload) =>
      ipcRenderer.invoke('runtime:task-open', payload) as Promise<OpenTaskResponse>,
    searchTasks: (payload: SearchTasksPayload) =>
      ipcRenderer.invoke('runtime:task-search', payload) as Promise<SearchTasksResponse>,
    setParticipationMode: (payload: SetParticipationModePayload) =>
      ipcRenderer.invoke('runtime:mode-set', payload) as Promise<SetParticipationModeResponse>,
    setExecutionMode: (payload: SetExecutionModePayload) =>
      ipcRenderer.invoke(
        'runtime:execution-mode-set',
        payload,
      ) as Promise<SetExecutionModeResponse>,
    archiveTask: (payload: import('@sync-think/protocol').ArchiveTaskPayload) =>
      ipcRenderer.invoke('runtime:task-archive', payload) as Promise<
        import('@sync-think/protocol').ArchiveTaskResponse
      >,
    unarchiveTask: (payload: import('@sync-think/protocol').UnarchiveTaskPayload) =>
      ipcRenderer.invoke('runtime:task-unarchive', payload) as Promise<
        import('@sync-think/protocol').UnarchiveTaskResponse
      >,
    discardEmptyTask: (payload: DiscardEmptyTaskPayload) =>
      ipcRenderer.invoke(
        'runtime:task-discard-empty',
        payload,
      ) as Promise<DiscardEmptyTaskResponse>,
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
    listArtifacts: (payload: ListArtifactsPayload) =>
      ipcRenderer.invoke('runtime:artifact-list', payload) as Promise<ListArtifactsResponse>,
    getArtifactVersion: (payload: GetArtifactVersionPayload) =>
      ipcRenderer.invoke(
        'runtime:artifact-get-version',
        payload,
      ) as Promise<GetArtifactVersionResponse>,
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
    createGroup: (payload: CreateGroupPayload) =>
      ipcRenderer.invoke('runtime:group-create', payload) as Promise<CreateGroupResponse>,
    getGroup: (payload: GetGroupPayload) =>
      ipcRenderer.invoke('runtime:group-get', payload) as Promise<GetGroupResponse>,
    listGroups: (payload: ListGroupsPayload = {}) =>
      ipcRenderer.invoke('runtime:group-list', payload) as Promise<ListGroupsResponse>,
    updateGroup: (payload: UpdateGroupPayload) =>
      ipcRenderer.invoke('runtime:group-update', payload) as Promise<UpdateGroupResponse>,
    addGroupMember: (payload: AddGroupMemberPayload) =>
      ipcRenderer.invoke(
        'runtime:group-member-add',
        payload,
      ) as Promise<GroupMemberMutationResponse>,
    removeGroupMember: (payload: RemoveGroupMemberPayload) =>
      ipcRenderer.invoke(
        'runtime:group-member-remove',
        payload,
      ) as Promise<GroupMemberMutationResponse>,
    updateGroupMemberResponsibility: (payload: UpdateGroupMemberResponsibilityPayload) =>
      ipcRenderer.invoke(
        'runtime:group-member-responsibility',
        payload,
      ) as Promise<GroupMemberMutationResponse>,
    setGroupLead: (payload: SetGroupLeadPayload) =>
      ipcRenderer.invoke('runtime:group-set-lead', payload) as Promise<GroupMemberMutationResponse>,
    createGroupTask: (payload: CreateGroupTaskPayload) =>
      ipcRenderer.invoke('runtime:group-task-create', payload) as Promise<CreateGroupTaskResponse>,
    importSkill: (payload: ImportSkillPayload) =>
      ipcRenderer.invoke('runtime:skill-import', payload) as Promise<ImportSkillResponse>,
    listSkills: (payload: ListSkillsPayload = {}) =>
      ipcRenderer.invoke('runtime:skill-list', payload) as Promise<ListSkillsResponse>,
    registerMcpServer: (payload: RegisterMcpServerPayload) =>
      ipcRenderer.invoke('runtime:mcp-register', payload) as Promise<RegisterMcpServerResponse>,
    listMcpServers: (payload: ListMcpServersPayload = {}) =>
      ipcRenderer.invoke('runtime:mcp-list', payload) as Promise<ListMcpServersResponse>,
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
    pickFolder: () =>
      ipcRenderer.invoke('desktop:pick-folder') as Promise<{
        canceled: boolean;
        path: string | null;
      }>,
    pickMessageAttachments: (kind: 'files' | 'folder') =>
      ipcRenderer.invoke('desktop:pick-message-attachments', kind) as Promise<
        Array<MessageAttachment & { previewUrl?: string }>
      >,
    stageMessageFiles: async (files: readonly File[]) => {
      const sources = await Promise.all(
        files.map(async (file) => {
          const filePath = webUtils.getPathForFile(file);
          if (filePath) return filePath;
          return {
            name: file.name,
            mimeType: file.type || undefined,
            bytes: new Uint8Array(await file.arrayBuffer()),
          };
        }),
      );
      return ipcRenderer.invoke('desktop:stage-message-files', sources) as Promise<
        Array<MessageAttachment & { previewUrl?: string }>
      >;
    },
    stageMessageFileData: (
      sources: readonly { name: string; mimeType?: string; bytes: Uint8Array }[],
    ) =>
      ipcRenderer.invoke('desktop:stage-message-files', sources) as Promise<
        Array<MessageAttachment & { previewUrl?: string }>
      >,
    pickAgentAvatar: () =>
      ipcRenderer.invoke('desktop:pick-agent-avatar') as Promise<
        | { canceled: true }
        | {
            canceled: false;
            avatarPath: string;
            avatarUrl: string;
            width: number;
            height: number;
          }
      >,
    loadAgentAvatar: (avatarPath: string) =>
      ipcRenderer.invoke('desktop:load-agent-avatar', avatarPath) as Promise<{
        avatarPath: string;
        avatarUrl: string;
        width: number;
        height: number;
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
  },
  platform: 'win32' as const,
};

contextBridge.exposeInMainWorld('syncThink', api);
