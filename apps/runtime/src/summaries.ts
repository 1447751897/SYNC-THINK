import type {
  AgentVersionId,
  ApprovalRequestRecord,
  ArtifactVersion,
  ArtifactVersionSummary,
  Conversation,
  GlobalAgent,
  Team,
  TeamRun,
} from '@sync-think/shared';
import type {
  AgentBindingSummary,
  AgentDefinitionSummary,
  ApprovalRequestSummary,
  CapabilityOrganizeReportSummary,
  CapabilityUsageSummary,
  CapabilityWorkspaceActivationSummary,
  DiagnosticSummary,
  DurableMemoryEntrySummary,
  MemoryChangeSummary,
  PolicyVersionSummary,
  SkillPublishDraftSummary,
  TaskSummary,
  WorkspaceSummary,
} from '@sync-think/protocol';
import {
  workspaceHiddenFromPrefs,
  workspaceIconFromPrefs,
  workspaceSortOrderFromPrefs,
} from '@sync-think/storage';
import type {
  AgentVersionRecord,
  CapabilityOrganizeReportRecord,
  CapabilityUsageSummary as StoredCapabilityUsageSummary,
  CapabilityWorkspaceActivationRecord,
  ConversationRecord,
  DiagnosticRecord,
  DurableMemoryEntry,
  GlobalAgentRecord,
  MemoryChangeRecord,
  PolicyVersionRecord,
  SkillPublishDraftRecord,
  TaskRecord,
  TeamRecord,
  TeamRunRecord,
  WorkspaceRecord,
} from '@sync-think/storage';

export function toTaskSummary(task: TaskRecord): TaskSummary {
  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
    parentTaskId: task.parentTaskId,
    title: task.title,
    goal: task.goal,
    status: task.status,
    participationMode: task.participationMode,
    taskVersion: task.version,
    threadId: task.threadId,
    lastOpenedAt: task.lastOpenedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function toWorkspaceSummary(workspace: WorkspaceRecord): WorkspaceSummary {
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

export function toArtifactVersionSummary(version: ArtifactVersion): ArtifactVersionSummary {
  return {
    id: version.id,
    artifactId: version.artifactId,
    contentHash: version.contentHash,
    mimeType: version.mimeType,
    sourceStepId: version.sourceStepId,
    status: version.status,
    version: version.version,
    parentVersionIds: [...version.parentVersionIds],
    createdAt: version.createdAt,
    hasInlineContent: version.content !== undefined,
    hasContentRef: version.contentRef !== undefined,
  };
}

export function toPolicyVersionSummary(policy: PolicyVersionRecord): PolicyVersionSummary {
  return {
    id: policy.id,
    policyId: policy.policyId,
    version: policy.version,
    scopeType: policy.scopeType,
    scopeId: policy.scopeId,
    approvalMode: policy.approvalMode,
    rules: policy.rules.map((rule) => ({ ...rule })),
    createdAt: policy.createdAt,
  };
}

export function toGlobalAgentSummary(record: GlobalAgentRecord): GlobalAgent {
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
    enabled: record.enabled,
    source: record.source,
    availabilityScope: record.availabilityScope,
    writePolicy: record.writePolicy,
    archived: record.archived,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toTeamMembers(record: TeamRecord | TeamRunRecord['rosterSnapshot']) {
  return record.members.map((member) => ({
    agentId: member.agentId,
    memberOrder: member.memberOrder,
    role: member.role,
    title: member.title,
    dependsOn: [...member.dependsOn],
  }));
}

export function toTeamSummary(record: TeamRecord): Team {
  return {
    id: record.id,
    name: record.name,
    avatar: record.avatar,
    mission: record.mission,
    strategy: record.strategy,
    coordinatorAgentId: record.coordinatorAgentId,
    members: toTeamMembers(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toTeamRunSummary(record: TeamRunRecord): TeamRun {
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
      members: toTeamMembers(record.rosterSnapshot),
    },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toConversationSummary(record: ConversationRecord): Conversation {
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
    contextWindowOverride: record.contextWindowOverride,
    lastMessageAt: record.lastMessageAt,
    taskId: record.taskId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toAgentBindingSummary(record: AgentVersionRecord): AgentBindingSummary {
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

export function toAgentDefinitionSummary(record: AgentVersionRecord): AgentDefinitionSummary {
  return {
    ...toAgentBindingSummary(record),
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

export function toCapabilityWorkspaceActivationSummary(
  record: CapabilityWorkspaceActivationRecord,
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

export function toCapabilityUsageSummary(
  record: StoredCapabilityUsageSummary,
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

export function toSkillPublishDraftSummary(
  record: SkillPublishDraftRecord,
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

export function toCapabilityOrganizeReportSummary(
  record: CapabilityOrganizeReportRecord,
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

export function toMemoryChangeSummary(change: MemoryChangeRecord): MemoryChangeSummary {
  return {
    id: change.id,
    workspaceId: change.workspaceId,
    taskId: change.taskId,
    targetScope: change.targetScope,
    additions: change.additions.map((entry) => ({ ...entry })),
    modifications: change.modifications.map((entry) => ({ ...entry })),
    deprecations: [...change.deprecations],
    evidenceRefs: [...change.evidenceRefs],
    confidence: change.confidence,
    unresolvedAmbiguity: change.unresolvedAmbiguity,
    approvalState: change.approvalState,
    proposedByRunId: change.proposedByRunId,
    createdAt: change.createdAt,
    decidedAt: change.decidedAt,
  };
}

export function toDurableMemoryEntrySummary(entry: DurableMemoryEntry): DurableMemoryEntrySummary {
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

export function toDiagnosticSummary(record: DiagnosticRecord): DiagnosticSummary {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    taskId: record.taskId,
    runId: record.runId,
    category: record.category,
    failureClass: record.failureClass ? String(record.failureClass) : undefined,
    summary: record.summary,
    detail: { ...record.detail },
    createdAt: record.createdAt,
  };
}

export function toApprovalRequestSummary(item: ApprovalRequestRecord): ApprovalRequestSummary {
  const delegateAgentVersionId = item.metadata.delegateAgentVersionId;
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
      typeof delegateAgentVersionId === 'string' && delegateAgentVersionId.trim().length > 0
        ? (delegateAgentVersionId as AgentVersionId)
        : undefined,
    decisionNote: item.decisionNote,
    createdAt: item.createdAt,
    decidedAt: item.decidedAt,
  };
}
