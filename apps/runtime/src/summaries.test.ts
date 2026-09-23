import { describe, expect, it } from 'vitest';
import type {
  AgentId,
  AgentVersionId,
  ApprovalRequestId,
  ApprovalRequestRecord,
  ConversationId,
  CredentialGroupId,
  MemoryChangeId,
  ModelId,
  RunId,
  TaskId,
  TeamId,
  WorkspaceId,
} from '@sync-think/shared';
import type {
  AgentVersionRecord,
  CapabilityOrganizeReportRecord,
  CapabilityUsageSummary,
  CapabilityWorkspaceActivationRecord,
  ConversationRecord,
  DiagnosticRecord,
  DurableMemoryEntry,
  GlobalAgentRecord,
  MemoryChangeRecord,
  SkillPublishDraftRecord,
  TeamRecord,
  TeamRunRecord,
  WorkspaceRecord,
} from '@sync-think/storage';
import {
  toAgentBindingSummary,
  toAgentDefinitionSummary,
  toApprovalRequestSummary,
  toCapabilityOrganizeReportSummary,
  toCapabilityUsageSummary,
  toCapabilityWorkspaceActivationSummary,
  toConversationSummary,
  toDiagnosticSummary,
  toDurableMemoryEntrySummary,
  toGlobalAgentSummary,
  toTeamRunSummary,
  toTeamSummary,
  toSkillPublishDraftSummary,
  toMemoryChangeSummary,
  toWorkspaceSummary,
} from './summaries.js';

const agentId = 'agent-fixture' as AgentId;
const secondAgentId = 'agent-second' as AgentId;
const teamId = 'team-fixture' as TeamId;
const conversationId = 'conversation-fixture' as ConversationId;

const agentVersion: AgentVersionRecord = {
  id: 'agent-version-fixture' as AgentVersionId,
  agentId,
  version: 3,
  name: 'Reviewer',
  description: 'Reviews changes',
  visualIdentity: { icon: 'code', color: '#2563eb' },
  role: 'reviewer',
  developerInstructions: 'Review carefully.',
  inputContract: 'A repository change',
  outputContract: 'Prioritized findings',
  defaultModelId: 'model-primary' as ModelId,
  defaultCredentialGroupId: 'credential-group-fixture' as CredentialGroupId,
  pauseOnFailure: true,
  fallbackModelIds: ['model-fallback' as ModelId],
  memoryScope: 'project',
  skillVersionIds: ['skill-version-review'],
  mcpServerIds: ['source-control'],
  mcpToolAllowlist: ['git_status'],
  permissions: {
    file: ['read'],
    command: ['git'],
    browser: [],
    desktop: [],
    network: [],
  },
  approvalMode: 'request',
  reviewBehavior: { role: 'reviewer', maxIterations: 2, onLimitReached: 'pause' },
  artifactRules: { retainVersions: true, requireReview: true, defaultStatus: 'candidate' },
  createdAt: '2026-09-20T00:00:00.000Z',
};

describe('catalog summaries', () => {
  it('projects workspace preferences and falls back safely for malformed preferences', () => {
    const workspace: WorkspaceRecord = {
      id: 'workspace-fixture' as WorkspaceId,
      folderPath: 'D:\\projects\\workspace-fixture',
      name: 'Workspace fixture',
      uiPrefsJson: JSON.stringify({ icon: 'code', sortOrder: 4.8, hidden: true }),
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T01:00:00.000Z',
    };

    expect(toWorkspaceSummary(workspace)).toEqual({
      workspaceId: workspace.id,
      folderPath: workspace.folderPath,
      name: workspace.name,
      icon: 'code',
      sortOrder: 4,
      hidden: true,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    });
    expect(toWorkspaceSummary({ ...workspace, uiPrefsJson: '{malformed' })).toMatchObject({
      icon: undefined,
      sortOrder: undefined,
      hidden: false,
    });
  });

  it('projects a global agent with isolated capability arrays', () => {
    const record: GlobalAgentRecord = {
      id: agentId,
      name: 'Reviewer',
      avatar: 'code',
      persona: 'Review changes',
      description: 'Find regressions',
      defaultModelId: 'model-primary' as ModelId,
      fallbackModelIds: ['model-fallback' as ModelId],
      skillIds: ['review'],
      mcpServerIds: ['source-control'],
      reasoningEffort: 'high',
      enabled: true,
      source: 'user',
      availabilityScope: 'workspace',
      writePolicy: 'read-only',
      archived: false,
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T01:00:00.000Z',
    };

    const summary = toGlobalAgentSummary(record);
    summary.skillIds.push('mutated');
    expect(record.skillIds).toEqual(['review']);
    expect(summary.name).toBe('Reviewer');
  });

  it('projects team and frozen run rosters without sharing dependency arrays', () => {
    const team: TeamRecord = {
      id: teamId,
      name: 'Delivery',
      avatar: 'team',
      mission: 'Ship safely',
      strategy: 'serial',
      coordinatorAgentId: agentId,
      members: [
        {
          agentId: secondAgentId,
          memberOrder: 0,
          role: 'reviewer',
          title: 'Reviewer',
          dependsOn: [agentId],
        },
      ],
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T01:00:00.000Z',
    };
    const run: TeamRunRecord = {
      id: 'run-fixture',
      teamId,
      conversationId,
      status: 'running',
      rosterSnapshot: {
        name: team.name,
        mission: team.mission,
        strategy: team.strategy,
        coordinatorAgentId: team.coordinatorAgentId,
        members: team.members,
      },
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    };

    const teamSummary = toTeamSummary(team);
    const runSummary = toTeamRunSummary(run);
    teamSummary.members[0]!.dependsOn.push(secondAgentId);
    runSummary.rosterSnapshot.members[0]!.dependsOn.length = 0;
    expect(team.members[0]!.dependsOn).toEqual([agentId]);
    expect(run.rosterSnapshot.members[0]!.dependsOn).toEqual([agentId]);
  });

  it('projects conversation directory fields without storage-only state', () => {
    const record: ConversationRecord = {
      id: conversationId,
      track: 'agent',
      targetRef: agentId,
      workspaceId: 'workspace-fixture' as WorkspaceId,
      title: 'Review',
      pinnedAt: '2026-09-20T00:30:00.000Z',
      executionMode: 'read-only',
      interactionMode: 'execute',
      contextWindowOverride: 64_000,
      lastMessageAt: '2026-09-20T00:45:00.000Z',
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T01:00:00.000Z',
    };

    expect(toConversationSummary(record)).toMatchObject({
      id: conversationId,
      track: 'agent',
      targetRef: agentId,
      title: 'Review',
      contextWindowOverride: 64_000,
    });
  });

  it('projects agent bindings without sharing capability arrays', () => {
    const summary = toAgentBindingSummary(agentVersion);
    summary.fallbackModelIds.push('model-mutated' as ModelId);
    summary.skillVersionIds.push('skill-mutated');
    summary.mcpServerIds.push('mcp-mutated');

    expect(agentVersion.fallbackModelIds).toEqual(['model-fallback']);
    expect(agentVersion.skillVersionIds).toEqual(['skill-version-review']);
    expect(agentVersion.mcpServerIds).toEqual(['source-control']);
    expect(summary.agentVersionId).toBe(agentVersion.id);
  });

  it('projects complete agent definitions without sharing nested policy state', () => {
    const summary = toAgentDefinitionSummary(agentVersion);
    summary.visualIdentity.icon = 'mutated';
    summary.mcpToolAllowlist.push('mutated');
    summary.permissions.file.push('write');
    summary.reviewBehavior.maxIterations = 9;
    summary.artifactRules.requireReview = false;

    expect(agentVersion.visualIdentity.icon).toBe('code');
    expect(agentVersion.mcpToolAllowlist).toEqual(['git_status']);
    expect(agentVersion.permissions.file).toEqual(['read']);
    expect(agentVersion.reviewBehavior.maxIterations).toBe(2);
    expect(agentVersion.artifactRules.requireReview).toBe(true);
  });

  it('projects capability activation and usage records', () => {
    const activation: CapabilityWorkspaceActivationRecord = {
      capabilityType: 'skill',
      capabilityId: 'review',
      workspaceId: 'workspace-fixture',
      active: true,
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T01:00:00.000Z',
    };
    const usage: CapabilityUsageSummary = {
      capabilityType: 'skill',
      capabilityId: 'review',
      callCount: 5,
      successCount: 3,
      failedCount: 1,
      cancelledCount: 1,
      problemCount: 2,
      contextTokens: 1200,
      lastUsedAt: '2026-09-20T01:00:00.000Z',
    };

    expect(toCapabilityWorkspaceActivationSummary(activation)).toEqual(activation);
    expect(toCapabilityUsageSummary(usage)).toEqual(usage);
  });

  it('projects publish drafts with a detached public attachment shape', () => {
    const record: SkillPublishDraftRecord = {
      id: 'draft-fixture',
      skillVersionId: 'skill-version-review',
      skillId: 'review',
      displayName: 'Review',
      description: 'Review changes',
      skillMd: '# Review',
      category: 'engineering',
      version: '1.0.0',
      icon: 'code',
      attachments: [{ name: 'guide.md', size: 42, localPath: 'private/guide.md' }],
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T01:00:00.000Z',
    };

    const summary = toSkillPublishDraftSummary(record);
    summary.attachments[0]!.name = 'mutated.md';
    expect(record.attachments[0]!.name).toBe('guide.md');
    expect(summary.attachments).toEqual([{ name: 'mutated.md', size: 42 }]);
  });

  it('projects organize reports without sharing category or count objects', () => {
    const record: CapabilityOrganizeReportRecord = {
      id: 'report-fixture',
      workspaceId: 'workspace-fixture',
      contextBudgetTokens: 8000,
      categories: {
        unused: ['unused-skill'],
        inactive: ['inactive-skill'],
        problematic: ['problematic-mcp'],
        contextWarning: ['large-skill'],
        highContext: ['very-large-skill'],
      },
      summary: {
        capabilityCount: 5,
        unusedCount: 1,
        inactiveCount: 1,
        problematicCount: 1,
        contextWarningCount: 1,
        highContextCount: 1,
      },
      createdAt: '2026-09-20T01:00:00.000Z',
    };

    const summary = toCapabilityOrganizeReportSummary(record);
    summary.categories.unused.push('mutated');
    summary.summary.capabilityCount = 99;
    expect(record.categories.unused).toEqual(['unused-skill']);
    expect(record.summary.capabilityCount).toBe(5);
  });

  it('projects memory changes without sharing mutable entry or evidence arrays', () => {
    const record: MemoryChangeRecord = {
      id: 'memory-change-fixture' as MemoryChangeId,
      workspaceId: 'workspace-fixture' as WorkspaceId,
      taskId: 'task-fixture' as TaskId,
      targetScope: 'project',
      additions: [{ id: 'entry-new', key: 'goal', value: 'Ship', targetScope: 'project' }],
      modifications: [
        { id: 'entry-existing', key: 'owner', value: 'Team', targetScope: 'project' },
      ],
      deprecations: ['old-key'],
      evidenceRefs: ['message-1'],
      confidence: 0.9,
      approvalState: 'approved',
      proposedByRunId: 'run-fixture' as RunId,
      createdAt: '2026-09-20T00:00:00.000Z',
      decidedAt: '2026-09-20T01:00:00.000Z',
    };

    const summary = toMemoryChangeSummary(record);
    summary.additions[0]!.value = 'Mutated';
    summary.modifications.length = 0;
    summary.deprecations.push('mutated');
    summary.evidenceRefs.push('message-2');
    expect(record.additions[0]!.value).toBe('Ship');
    expect(record.modifications).toHaveLength(1);
    expect(record.deprecations).toEqual(['old-key']);
    expect(record.evidenceRefs).toEqual(['message-1']);
  });

  it('projects durable memory and diagnostics without sharing diagnostic detail', () => {
    const entry: DurableMemoryEntry = {
      id: 'memory-entry-fixture',
      workspaceId: 'workspace-fixture' as WorkspaceId,
      taskId: 'task-fixture' as TaskId,
      scope: 'task',
      key: 'goal',
      value: 'Ship',
      sourceChangeId: 'memory-change-fixture' as MemoryChangeId,
      active: true,
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T01:00:00.000Z',
    };
    const diagnostic: DiagnosticRecord = {
      id: 'diagnostic-fixture',
      workspaceId: entry.workspaceId,
      taskId: entry.taskId,
      runId: 'run-fixture' as RunId,
      category: 'provider',
      failureClass: 'retryable',
      summary: 'Provider request failed',
      detail: { status: 503 },
      createdAt: entry.updatedAt,
    };

    expect(toDurableMemoryEntrySummary(entry)).toMatchObject({ key: 'goal', active: true });
    const diagnosticSummary = toDiagnosticSummary(diagnostic);
    diagnosticSummary.detail.status = 200;
    expect(diagnostic.detail).toEqual({ status: 503 });
    expect(diagnosticSummary.failureClass).toBe('retryable');
  });

  it('projects approval requests and exposes only a valid delegated Agent version id', () => {
    const record: ApprovalRequestRecord = {
      id: 'approval-fixture' as ApprovalRequestId,
      workspaceId: 'workspace-fixture' as WorkspaceId,
      taskId: 'task-fixture' as TaskId,
      runId: 'run-fixture' as RunId,
      kind: 'tool',
      action: 'git.push',
      summary: 'Push changes',
      humanOnly: false,
      mode: 'delegate',
      gate: 'require-delegate',
      state: 'pending',
      metadata: {
        delegateAgentVersionId: 'agent-version-reviewer',
        internalReason: 'must-not-leak',
      },
      createdAt: '2026-09-20T00:00:00.000Z',
    };

    expect(toApprovalRequestSummary(record)).toMatchObject({
      id: record.id,
      action: 'git.push',
      delegateAgentVersionId: 'agent-version-reviewer',
    });
    expect(
      toApprovalRequestSummary({ ...record, metadata: { delegateAgentVersionId: '  ' } })
        .delegateAgentVersionId,
    ).toBeUndefined();
    expect(toApprovalRequestSummary(record)).not.toHaveProperty('metadata');
  });
});
