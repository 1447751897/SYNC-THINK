// Preload runs in the renderer with contextIsolation: true. Bridge exposes a
// narrow window.api so the renderer never touches Node directly (搂19).
import { contextBridge, ipcRenderer } from 'electron';
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
  CreateConversationPayload,
  ConversationResponse,
  RenameConversationPayload,
  SetConversationPinnedPayload,
  SetConversationArchivedPayload,
  SetConversationExecutionModePayload,
  UpgradeConversationTrackPayload,
  DeleteConversationPayload,
  ConversationDecideToolApprovalPayload,
  ConversationDecideToolApprovalResponse,
} from '@sync-think/protocol';
import type {
  RendererCreateProviderPayload,
  RendererUpdateProviderPayload,
} from '../provider-payloads.js';
import type { Event } from '@sync-think/shared';
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
    decideToolApproval: (payload: ConversationDecideToolApprovalPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-decide-tool-approval',
        payload,
      ) as Promise<ConversationDecideToolApprovalResponse>,
    upgradeConversationTrack: (payload: UpgradeConversationTrackPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-upgrade-track',
        payload,
      ) as Promise<ConversationResponse>,
    deleteConversation: (payload: DeleteConversationPayload) =>
      ipcRenderer.invoke(
        'runtime:conversation-delete',
        payload,
      ) as Promise<Record<string, never>>,
    sendConversationMessage: (payload: { conversationId: string; text: string; modelId?: string }) =>
      ipcRenderer.invoke('runtime:conversation-send-message', payload) as Promise<{
        messageId: string;
        threadId: string;
        taskVersion: number;
        streamId?: string;
        conversationTitle?: string;
      }>,
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
    listProjectFiles: (payload: { root: string; query?: string; maxEntries?: number }) =>
      ipcRenderer.invoke('desktop:list-project-files', payload) as Promise<{
        root: string;
        files: Array<{ path: string; name: string; kind: 'file' | 'dir' }>;
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
