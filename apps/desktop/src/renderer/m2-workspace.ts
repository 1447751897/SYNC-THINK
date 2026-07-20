import type { Event } from '@sync-think/shared';
import type {
  AgentDefinitionSummary,
  ArtifactListItem,
  CreateAgentPayload,
  CreateAgentVersionPayload,
  RunGraphResponse,
} from '@sync-think/protocol';
import type {
  AgentBindingCredentialOption,
  AgentBindingModelOption,
  AgentBindingView,
  AgentCreateInput,
  AgentDefinitionSaveInput,
  AgentDefinitionView,
  AgentVersionHistoryView,
  AgentWorkspaceListItem,
  ExecutionGraphView,
} from '@sync-think/ui-kit';

export interface M2WorkspaceIdentity {
  planId?: string;
  planRevisionId?: string;
  revision?: number;
  runId?: string;
}

export interface AgentWorkspaceProjection {
  agents: AgentWorkspaceListItem[];
  selectedAgentId: string | null;
  definition: AgentDefinitionView | null;
  versions: AgentVersionHistoryView[];
}

export interface M2LoadRequestToken {
  generation: number;
  scopeKey: string;
}

export interface M2LoadRequestGate {
  begin(scopeKey: string): M2LoadRequestToken;
  invalidate(): void;
  isCurrent(token: M2LoadRequestToken): boolean;
}

export function createM2LoadRequestGate(): M2LoadRequestGate {
  let generation = 0;
  let currentScopeKey = '';
  return {
    begin(scopeKey) {
      generation += 1;
      currentScopeKey = scopeKey;
      return { generation, scopeKey };
    },
    invalidate() {
      generation += 1;
      currentScopeKey = '';
    },
    isCurrent(token) {
      return token.generation === generation && token.scopeKey === currentScopeKey;
    },
  };
}

export function mergeTaskVersionForTarget<T extends { taskId: string; taskVersion: number }>(
  current: T | null,
  targetTaskId: string,
  taskVersion: number,
): T | null {
  if (!current || current.taskId !== targetTaskId) return current;
  const nextTaskVersion = Math.max(current.taskVersion, taskVersion);
  return nextTaskVersion === current.taskVersion
    ? current
    : { ...current, taskVersion: nextTaskVersion };
}

function projectAgentDefinition(agent: AgentDefinitionSummary): AgentDefinitionView {
  return {
    agentId: String(agent.agentId),
    agentVersionId: String(agent.agentVersionId),
    version: agent.version,
    name: agent.name,
    description: agent.description,
    visualIdentity: { ...agent.visualIdentity },
    role: agent.role,
    developerInstructions: agent.developerInstructions,
    inputContract: agent.inputContract,
    outputContract: agent.outputContract,
    maxConcurrency: agent.maxConcurrency,
    memoryScope: agent.memoryScope,
    approvalMode: agent.approvalMode,
    mcpToolAllowlist: [...agent.mcpToolAllowlist],
    permissions: {
      file: [...agent.permissions.file],
      command: [...agent.permissions.command],
      browser: [...agent.permissions.browser],
      desktop: [...agent.permissions.desktop],
      network: [...agent.permissions.network],
    },
    reviewBehavior: { ...agent.reviewBehavior },
    artifactRules: { ...agent.artifactRules },
    defaultModelId: String(agent.defaultModelId),
    defaultCredentialGroupId: agent.defaultCredentialGroupId
      ? String(agent.defaultCredentialGroupId)
      : undefined,
    pinnedCredentialRefId: agent.pinnedCredentialRefId
      ? String(agent.pinnedCredentialRefId)
      : undefined,
    pauseOnFailure: agent.pauseOnFailure,
    fallbackModelIds: agent.fallbackModelIds.map(String),
    skillVersionIds: agent.skillVersionIds.map(String),
    mcpServerIds: agent.mcpServerIds.map(String),
    ...(agent.policyId ? { policyId: agent.policyId } : {}),
  } as AgentDefinitionView;
}

export function projectAgentWorkspace(
  latestVersions: readonly AgentDefinitionSummary[],
  preferredAgentId: string | null | undefined,
  selectedVersions: readonly AgentDefinitionSummary[],
): AgentWorkspaceProjection {
  const selected =
    latestVersions.find((agent) => String(agent.agentId) === preferredAgentId) ??
    latestVersions[0] ??
    null;
  return {
    agents: latestVersions.map((agent) => ({
      agentId: String(agent.agentId),
      name: agent.name,
      role: agent.role,
      version: agent.version,
      visualIdentity: { ...agent.visualIdentity },
      defaultModelId: String(agent.defaultModelId),
      skillCount: agent.skillVersionIds.length,
      mcpCount: agent.mcpServerIds.length,
    })),
    selectedAgentId: selected ? String(selected.agentId) : null,
    definition: selected ? projectAgentDefinition(selected) : null,
    versions: selectedVersions.map((version) => ({
      ...projectAgentDefinition(version),
      createdAt: version.createdAt,
    })),
  };
}

export function buildAgentVersionPayload(
  definition: AgentDefinitionSaveInput,
  binding: AgentBindingView,
): CreateAgentVersionPayload {
  const { visualIdentity: visualIdentityView, ...definitionWithoutVisualIdentity } = definition;
  const visualIdentity = visualIdentityView
    ? {
        icon: visualIdentityView.icon,
        color: visualIdentityView.color,
        ...(visualIdentityView.avatarPath ? { avatarPath: visualIdentityView.avatarPath } : {}),
      }
    : undefined;
  return {
    ...definitionWithoutVisualIdentity,
    approvalMode: 'full',
    ...(visualIdentity ? { visualIdentity } : {}),
    defaultModelId: binding.defaultModelId,
    fallbackModelIds: [...binding.fallbackModelIds],
    pauseOnFailure: binding.pauseOnFailure,
    ...(binding.defaultCredentialGroupId
      ? { defaultCredentialGroupId: binding.defaultCredentialGroupId }
      : {}),
    pinnedCredentialRefId: binding.pinnedCredentialRefId,
    skillVersionIds: [...(binding.skillVersionIds ?? [])],
    mcpServerIds: [...(binding.mcpServerIds ?? [])],
  } as CreateAgentVersionPayload;
}

export function buildAgentCreatePayload(
  input: AgentCreateInput,
  binding: AgentBindingView,
): CreateAgentPayload {
  const name = input.name.trim();
  const role = input.role.trim();
  return {
    name,
    description: input.description.trim(),
    visualIdentity: { icon: 'bot', color: '#64748b' },
    role,
    developerInstructions: input.developerInstructions.trim(),
    inputContract: 'Task goal, context, constraints, and acceptance criteria.',
    outputContract: 'Completed work, artifacts, and verification evidence.',
    maxConcurrency: input.maxConcurrency,
    defaultModelId: binding.defaultModelId,
    fallbackModelIds: [...binding.fallbackModelIds],
    pauseOnFailure: binding.pauseOnFailure,
    ...(binding.defaultCredentialGroupId
      ? { defaultCredentialGroupId: binding.defaultCredentialGroupId }
      : {}),
    ...(binding.pinnedCredentialRefId
      ? { pinnedCredentialRefId: binding.pinnedCredentialRefId }
      : {}),
    memoryScope: 'project',
    skillVersionIds: [...(binding.skillVersionIds ?? [])],
    mcpServerIds: [...(binding.mcpServerIds ?? [])],
    mcpToolAllowlist: [],
    permissions: { file: [], command: [], browser: [], desktop: [], network: [] },
    approvalMode: 'full',
    reviewBehavior: { role: 'none', maxIterations: 0, onLimitReached: 'pause' },
    artifactRules: {
      retainVersions: true,
      requireReview: false,
      defaultStatus: 'candidate',
    },
  } as unknown as CreateAgentPayload;
}

export function buildAgentBootstrapBinding(
  input: AgentCreateInput,
  models: readonly AgentBindingModelOption[],
  credentials: readonly AgentBindingCredentialOption[],
): AgentBindingView | null {
  const model = models[0];
  if (!model) return null;
  const credential =
    credentials.find(
      (candidate) => model.providerName && candidate.providerName === model.providerName,
    ) ?? credentials[0];
  return {
    agentId: 'agent-bootstrap',
    agentVersionId: 'agent-version-bootstrap',
    version: 0,
    name: input.name.trim(),
    role: input.role.trim(),
    defaultModelId: model.modelId,
    fallbackModelIds: [],
    pauseOnFailure: true,
    ...(credential ? { defaultCredentialGroupId: credential.credentialGroupId } : {}),
    pinnedCredentialRefId: credential?.credentialRefId ?? null,
    skillVersionIds: [],
    mcpServerIds: [],
  };
}

function belongsToTask(event: Event, taskId: string): boolean {
  const payloadTaskId = typeof event.payload.taskId === 'string' ? event.payload.taskId : undefined;
  return String(event.taskId ?? '') === taskId || payloadTaskId === taskId;
}

export function deriveM2WorkspaceIdentity(
  events: readonly Event[],
  taskId?: string | null,
): M2WorkspaceIdentity {
  if (!taskId) return {};
  const identity: M2WorkspaceIdentity = {};
  const orchestrationRunIds = new Set<string>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (!belongsToTask(event, taskId)) continue;
    const planId = typeof event.payload.planId === 'string' ? event.payload.planId : undefined;
    const planRevisionId =
      typeof event.payload.planRevisionId === 'string' ? event.payload.planRevisionId : undefined;
    const revision =
      typeof event.payload.revision === 'number' ? event.payload.revision : undefined;
    if (planId) identity.planId = planId;
    if (planRevisionId) identity.planRevisionId = planRevisionId;
    if (revision !== undefined) identity.revision = revision;

    if (event.runId && planRevisionId) {
      orchestrationRunIds.add(String(event.runId));
      identity.runId = String(event.runId);
      continue;
    }
    if (event.runId && orchestrationRunIds.has(String(event.runId))) {
      identity.runId = String(event.runId);
    }
  }
  return identity;
}

export function projectM2ExecutionGraph(
  graph: RunGraphResponse,
  events: readonly Event[],
  artifacts: readonly ArtifactListItem[],
  agentVersions: ReadonlyMap<string, { defaultModelId: string }> = new Map(),
): ExecutionGraphView {
  const runId = String(graph.run.id);
  return {
    run: {
      id: runId,
      state: graph.run.state,
      planRevisionId: String(graph.run.planRevisionId),
    },
    steps: graph.steps.map((step) => {
      let reviewIteration: number | undefined;
      for (const event of events) {
        if (
          String(event.runId ?? '') !== runId ||
          String(event.stepId ?? event.payload.stepId ?? '') !== String(step.id) ||
          !event.type.startsWith('review.')
        ) {
          continue;
        }
        if (typeof event.payload.iteration === 'number') {
          reviewIteration = Math.max(reviewIteration ?? 0, event.payload.iteration);
        }
      }

      let currentArtifactVersion: number | undefined;
      for (const item of artifacts) {
        for (const version of item.versions) {
          if (String(version.sourceStepId) !== String(step.id)) continue;
          currentArtifactVersion = Math.max(currentArtifactVersion ?? 0, version.version);
        }
      }

      const modelOverrideId = step.modelOverrideId ? String(step.modelOverrideId) : undefined;
      const exactDefaultModelId = agentVersions.get(String(step.agentVersionId))?.defaultModelId;
      return {
        id: String(step.id),
        title: step.title,
        agentVersionId: String(step.agentVersionId),
        state: step.state,
        dependsOn: step.dependsOn.map(String),
        ...(modelOverrideId ? { modelOverrideId } : {}),
        ...(!modelOverrideId && exactDefaultModelId
          ? { modelId: String(exactDefaultModelId) }
          : {}),
        retries: step.retries,
        ...(reviewIteration === undefined ? {} : { reviewIteration }),
        ...(currentArtifactVersion === undefined ? {} : { currentArtifactVersion }),
      };
    }),
  };
}

export function resolveAutomaticModeBlocker(input: {
  hasApprovedPlan: boolean;
  hasPolicy: boolean;
}): string | null {
  if (!input.hasApprovedPlan) {
    return '自动模式需要已批准计划；请先在协作模式检查并批准计划。';
  }
  if (!input.hasPolicy) {
    return '自动模式需要适用的批准策略；请先在批准中心保存策略。';
  }
  return null;
}

export function hasApprovedPlanRevision(revisions: readonly { state: string }[]): boolean {
  return revisions.some((revision) => revision.state === 'approved');
}

export function canSaveAgentBindingForSelection(
  binding: { agentId?: unknown } | null | undefined,
  selectedAgentId: string | null | undefined,
): boolean {
  return Boolean(
    binding &&
    selectedAgentId &&
    typeof binding.agentId === 'string' &&
    binding.agentId === selectedAgentId,
  );
}

export function isApprovalDelegateAgentVersion(version: { role: string }): boolean {
  return version.role.trim().toLowerCase() === 'approval';
}

export function isM2RefreshEvent(event: { type: string }): boolean {
  return /^(?:plan|run|step|review|artifact|approval)\./.test(event.type);
}

export type AutomaticModeRecovery =
  | { kind: 'plan'; mode: 'collaboration'; focus: 'plan' }
  | { kind: 'policy'; railTab: 'approval' }
  | null;

export function resolveAutomaticModeRecovery(input: {
  hasApprovedPlan: boolean;
  hasPolicy: boolean;
}): AutomaticModeRecovery {
  if (!input.hasApprovedPlan) return { kind: 'plan', mode: 'collaboration', focus: 'plan' };
  if (!input.hasPolicy) return { kind: 'policy', railTab: 'approval' };
  return null;
}

export function resolveVisibleAutomaticModeRecovery(input: {
  hasActiveTask: boolean;
  hasApprovedPlan: boolean;
  hasPolicy: boolean;
  runtimeRecovery: AutomaticModeRecovery;
}): AutomaticModeRecovery {
  if (!input.hasActiveTask) return null;
  return (
    resolveAutomaticModeRecovery({
      hasApprovedPlan: input.hasApprovedPlan,
      hasPolicy: input.hasPolicy,
    }) ?? input.runtimeRecovery
  );
}

export interface ArtifactAncestorNode {
  id: string;
  parentVersionIds: readonly string[];
}

function artifactAncestorDistances(
  byId: ReadonlyMap<string, ArtifactAncestorNode>,
  startId: string,
): Map<string, number> {
  if (!byId.has(startId)) throw new Error(`Artifact version not found: ${startId}`);
  const distances = new Map<string, number>([[startId, 0]]);
  const queue = [startId];
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]!;
    const distance = distances.get(id)!;
    for (const parentId of byId.get(id)?.parentVersionIds ?? []) {
      if (!byId.has(parentId) || distances.has(parentId)) continue;
      distances.set(parentId, distance + 1);
      queue.push(parentId);
    }
  }
  return distances;
}

export function findNearestCommonArtifactAncestor(
  versions: readonly ArtifactAncestorNode[],
  leftVersionId: string,
  rightVersionId: string,
): string {
  const byId = new Map(versions.map((version) => [version.id, version]));
  const leftDistances = artifactAncestorDistances(byId, leftVersionId);
  const rightDistances = artifactAncestorDistances(byId, rightVersionId);
  const common = [...leftDistances.entries()]
    .filter(([id]) => rightDistances.has(id))
    .map(([id, leftDistance]) => ({
      id,
      leftDistance,
      rightDistance: rightDistances.get(id)!,
    }))
    .sort(
      (left, right) =>
        Math.max(left.leftDistance, left.rightDistance) -
          Math.max(right.leftDistance, right.rightDistance) ||
        left.leftDistance + left.rightDistance - (right.leftDistance + right.rightDistance) ||
        left.id.localeCompare(right.id),
    );
  const nearest = common[0];
  if (!nearest) {
    throw new Error(
      `Artifact versions ${leftVersionId} and ${rightVersionId} have no common ancestor`,
    );
  }
  return nearest.id;
}
