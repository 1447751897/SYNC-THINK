import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Event } from '@sync-think/shared';
import type { ArtifactListItem, RunGraphResponse } from '@sync-think/protocol';
import * as m2Workspace from '../src/renderer/m2-workspace.js';
import {
  deriveM2WorkspaceIdentity,
  projectM2ExecutionGraph,
  resolveAutomaticModeBlocker,
} from '../src/renderer/m2-workspace.js';

function event(sequence: number, overrides: Partial<Event>): Event {
  return {
    id: `event-${sequence}` as never,
    workspaceId: 'workspace-1' as never,
    category: 'run',
    type: 'system.event',
    sequence,
    occurredAt: `2026-07-14T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    payload: {},
    ...overrides,
  };
}

describe('M2 desktop workspace projection', () => {
  it('derives the latest plan and orchestration Run while ignoring conversation Runs', () => {
    const events = [
      event(1, {
        taskId: 'task-1' as never,
        runId: 'conversation-run' as never,
        type: 'run.started',
        payload: { threadId: 'thread-1' },
      }),
      event(2, {
        taskId: 'task-1' as never,
        type: 'plan.drafted',
        payload: { planId: 'plan-1', planRevisionId: 'revision-1', revision: 1 },
      }),
      event(3, {
        taskId: 'task-1' as never,
        runId: 'orchestration-run-1' as never,
        type: 'run.queued',
        payload: { planId: 'plan-1', planRevisionId: 'revision-1' },
      }),
      event(4, {
        taskId: 'task-other' as never,
        runId: 'other-run' as never,
        type: 'run.queued',
        payload: { planId: 'plan-other', planRevisionId: 'revision-other' },
      }),
    ];

    expect(deriveM2WorkspaceIdentity(events, 'task-1')).toEqual({
      planId: 'plan-1',
      planRevisionId: 'revision-1',
      revision: 1,
      runId: 'orchestration-run-1',
    });
  });

  it('projects exact graph pins with review iteration and current artifact version', () => {
    const graph = {
      run: {
        id: 'run-1',
        taskId: 'task-1',
        state: 'running',
        planRevisionId: 'revision-2',
        stepIds: ['step-design'],
        createdAt: '2026-07-14T00:00:00.000Z',
        updatedAt: '2026-07-14T00:00:01.000Z',
      },
      steps: [
        {
          id: 'step-design',
          runId: 'run-1',
          agentVersionId: 'agent-version-2',
          dependsOn: [],
          state: 'reviewing',
          retries: 1,
          createdAt: '2026-07-14T00:00:00.000Z',
          updatedAt: '2026-07-14T00:00:01.000Z',
          planOrder: 0,
          title: 'Design',
          instructions: 'Create candidate.',
          modelOverrideId: 'model-design',
        },
      ],
      dependencies: [],
    } as unknown as RunGraphResponse;
    const artifacts = [
      {
        artifact: { id: 'artifact-1', name: 'design.md' },
        versions: [
          { id: 'artifact-version-1', sourceStepId: 'step-design', version: 1 },
          { id: 'artifact-version-2', sourceStepId: 'step-design', version: 2 },
        ],
      },
    ] as unknown as ArtifactListItem[];
    const events = [
      event(1, {
        taskId: 'task-1' as never,
        runId: 'run-1' as never,
        stepId: 'step-design' as never,
        type: 'review.rejected',
        payload: { iteration: 1 },
      }),
    ];

    expect(projectM2ExecutionGraph(graph, events, artifacts).steps[0]).toMatchObject({
      id: 'step-design',
      agentVersionId: 'agent-version-2',
      modelOverrideId: 'model-design',
      retries: 1,
      reviewIteration: 1,
      currentArtifactVersion: 2,
    });

    const withoutOverride = {
      ...graph,
      steps: [{ ...graph.steps[0], modelOverrideId: undefined }],
    } as unknown as RunGraphResponse;
    expect(
      projectM2ExecutionGraph(
        withoutOverride,
        events,
        artifacts,
        new Map([
          [
            'agent-version-2',
            { agentVersionId: 'agent-version-2', defaultModelId: 'model-exact-v2' },
          ],
        ]),
      ).steps[0],
    ).toMatchObject({ modelId: 'model-exact-v2' });
  });

  it('provides actionable automatic-mode blockers', () => {
    expect(resolveAutomaticModeBlocker({ hasApprovedPlan: false, hasPolicy: true })).toMatch(
      /批准计划/,
    );
    expect(resolveAutomaticModeBlocker({ hasApprovedPlan: true, hasPolicy: false })).toMatch(
      /策略/,
    );
    expect(resolveAutomaticModeBlocker({ hasApprovedPlan: true, hasPolicy: true })).toBeNull();
  });

  it('projects complete Agent definitions and preserves exact selection', () => {
    const project = (
      m2Workspace as unknown as Record<string, (...args: never[]) => unknown>
    ).projectAgentWorkspace;
    expect(typeof project).toBe('function');
    if (typeof project !== 'function') return;

    const planner = {
      agentId: 'agent-planner',
      agentVersionId: 'agent-planner-v2',
      version: 2,
      name: 'Planner',
      role: 'planner',
      developerInstructions: 'Plan against acceptance criteria.',
      inputContract: 'Task goal',
      outputContract: 'Approved plan',
      defaultModelId: 'model-planner',
      fallbackModelIds: ['model-fallback'],
      pauseOnFailure: true,
      defaultCredentialGroupId: 'group-planner',
      pinnedCredentialRefId: 'credential-planner',
      memoryScope: 'project',
      skillVersionIds: ['skill-plan-v1'],
      mcpServerIds: ['mcp-files'],
      approvalMode: 'request',
      policyId: 'policy-planner',
      description: 'Plans and reviews execution.',
      visualIdentity: { icon: 'workflow', color: '#227755' },
      mcpToolAllowlist: ['read_file'],
      permissions: {
        file: ['workspace:read'],
        command: ['pnpm test'],
        browser: ['localhost'],
        desktop: [],
        network: [],
      },
      reviewBehavior: {
        role: 'executor-reviewer',
        maxIterations: 2,
        onLimitReached: 'pause',
      },
      artifactRules: {
        retainVersions: true,
        requireReview: true,
        defaultStatus: 'candidate',
      },
      createdAt: '2026-07-14T00:00:00.000Z',
    };
    const reviewer = {
      ...planner,
      agentId: 'agent-reviewer',
      agentVersionId: 'agent-reviewer-v1',
      version: 1,
      name: 'Reviewer',
      role: 'reviewer',
      skillVersionIds: [],
      mcpServerIds: [],
    };

    expect(project([planner, reviewer], 'agent-reviewer', [reviewer])).toEqual({
      agents: [
        expect.objectContaining({
          agentId: 'agent-planner',
          version: 2,
          skillCount: 1,
          mcpCount: 1,
        }),
        expect.objectContaining({
          agentId: 'agent-reviewer',
          version: 1,
          skillCount: 0,
          mcpCount: 0,
        }),
      ],
      selectedAgentId: 'agent-reviewer',
      definition: expect.objectContaining({
        agentId: 'agent-reviewer',
        agentVersionId: 'agent-reviewer-v1',
        developerInstructions: reviewer.developerInstructions,
        description: reviewer.description,
        visualIdentity: reviewer.visualIdentity,
        permissions: reviewer.permissions,
        reviewBehavior: reviewer.reviewBehavior,
        artifactRules: reviewer.artifactRules,
      }),
      versions: [
        expect.objectContaining({
          agentVersionId: 'agent-reviewer-v1',
          createdAt: reviewer.createdAt,
          defaultModelId: reviewer.defaultModelId,
          defaultCredentialGroupId: reviewer.defaultCredentialGroupId,
          pinnedCredentialRefId: reviewer.pinnedCredentialRefId,
          fallbackModelIds: reviewer.fallbackModelIds,
          skillVersionIds: reviewer.skillVersionIds,
          mcpServerIds: reviewer.mcpServerIds,
          mcpToolAllowlist: reviewer.mcpToolAllowlist,
        }),
      ],
    });

    expect(project([planner], 'missing-agent', [])).toMatchObject({
      selectedAgentId: 'agent-planner',
    });
  });

  it('builds Agent create/version commands from the selected runtime binding', () => {
    const buildVersion = (
      m2Workspace as unknown as Record<string, (...args: never[]) => unknown>
    ).buildAgentVersionPayload;
    const buildCreate = (
      m2Workspace as unknown as Record<string, (...args: never[]) => unknown>
    ).buildAgentCreatePayload;
    expect(typeof buildVersion).toBe('function');
    expect(typeof buildCreate).toBe('function');
    if (typeof buildVersion !== 'function' || typeof buildCreate !== 'function') return;

    const binding = {
      agentId: 'agent-planner',
      agentVersionId: 'agent-planner-v2',
      version: 2,
      name: 'Planner',
      role: 'planner',
      defaultModelId: 'model-planner',
      fallbackModelIds: ['model-fallback'],
      pauseOnFailure: true,
      defaultCredentialGroupId: 'group-planner',
      pinnedCredentialRefId: 'credential-planner',
      skillVersionIds: ['skill-plan-v1'],
      mcpServerIds: ['mcp-files'],
    };
    const definition = {
      agentId: 'agent-planner',
      expectedVersion: 2,
      name: 'Planner v3',
      role: 'lead-planner',
      developerInstructions: 'Plan, verify, and revise.',
      inputContract: 'Task and constraints',
      outputContract: 'Approved plan and evidence',
      memoryScope: 'project',
      approvalMode: 'request',
      policyId: 'policy-planner',
    };

    expect(buildVersion(definition, binding)).toEqual({
      ...definition,
      defaultModelId: 'model-planner',
      fallbackModelIds: ['model-fallback'],
      pauseOnFailure: true,
      defaultCredentialGroupId: 'group-planner',
      pinnedCredentialRefId: 'credential-planner',
      skillVersionIds: ['skill-plan-v1'],
      mcpServerIds: ['mcp-files'],
    });
    expect(buildCreate({ name: 'Designer', role: 'designer' }, binding)).toMatchObject({
      name: 'Designer',
      role: 'designer',
      defaultModelId: 'model-planner',
      defaultCredentialGroupId: 'group-planner',
      pinnedCredentialRefId: 'credential-planner',
      memoryScope: 'project',
      approvalMode: 'request',
    });
  });

  it('wires the full Agent API into the product Agent workspace', () => {
    const source = readFileSync(
      new URL('../src/renderer/index.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('runtime.listAgents');
    expect(source).toContain('runtime.listAgentVersions');
    expect(source).toContain('runtime.createAgentVersion');
    expect(source).toContain('runtime.createAgent');
    expect(source).toContain('selectedAgentId={selectedAgentId}');
    expect(source).toContain('onSelectAgent=');
    expect(source).toContain('onCreateAgent=');
    expect(source).toContain('onSaveDefinition=');
    expect(source).toContain('agentLoadRequestRef');
    expect(source).toContain('requestId !== agentLoadRequestRef.current');
  });

  it('provides pure guards for Agent selection, M2 refresh events and automatic recovery', () => {
    const api = m2Workspace as unknown as Record<string, (...args: never[]) => unknown>;
    expect(typeof api.canSaveAgentBindingForSelection).toBe('function');
    expect(typeof api.isM2RefreshEvent).toBe('function');
    expect(typeof api.resolveAutomaticModeRecovery).toBe('function');
    expect(typeof api.isApprovalDelegateAgentVersion).toBe('function');
    if (
      typeof api.canSaveAgentBindingForSelection !== 'function' ||
      typeof api.isM2RefreshEvent !== 'function' ||
      typeof api.resolveAutomaticModeRecovery !== 'function' ||
      typeof api.isApprovalDelegateAgentVersion !== 'function'
    ) return;

    expect(
      api.canSaveAgentBindingForSelection(
        { agentId: 'agent-old' },
        'agent-new',
      ),
    ).toBe(false);
    expect(api.isM2RefreshEvent({ type: 'review.evidence-recorded' })).toBe(true);
    expect(api.isM2RefreshEvent({ type: 'provider.created' })).toBe(false);
    expect(
      api.resolveAutomaticModeRecovery({ hasApprovedPlan: false, hasPolicy: true }),
    ).toMatchObject({ kind: 'plan' });
    expect(
      api.resolveAutomaticModeRecovery({ hasApprovedPlan: true, hasPolicy: false }),
    ).toMatchObject({ kind: 'policy' });
    expect(api.isApprovalDelegateAgentVersion({ role: 'approval' })).toBe(true);
    expect(api.isApprovalDelegateAgentVersion({ role: 'reviewer' })).toBe(false);
    expect(api.isApprovalDelegateAgentVersion({ role: 'executor' })).toBe(false);
  });

  it('keeps Automatic readiness task-scoped behind conversation-driven collaboration', () => {
    const api = m2Workspace as unknown as Record<string, (...args: never[]) => unknown>;
    expect(typeof api.hasApprovedPlanRevision).toBe('function');
    expect(typeof api.resolveVisibleAutomaticModeRecovery).toBe('function');
    if (
      typeof api.hasApprovedPlanRevision !== 'function' ||
      typeof api.resolveVisibleAutomaticModeRecovery !== 'function'
    ) return;

    expect(
      api.hasApprovedPlanRevision([
        { revision: 1, state: 'approved' },
        { revision: 2, state: 'draft' },
      ]),
    ).toBe(true);
    expect(api.hasApprovedPlanRevision([{ revision: 2, state: 'draft' }])).toBe(false);

    expect(
      api.resolveVisibleAutomaticModeRecovery({
        hasActiveTask: true,
        hasApprovedPlan: false,
        hasPolicy: false,
        runtimeRecovery: null,
      }),
    ).toMatchObject({ kind: 'plan' });
    expect(
      api.resolveVisibleAutomaticModeRecovery({
        hasActiveTask: true,
        hasApprovedPlan: true,
        hasPolicy: false,
        runtimeRecovery: null,
      }),
    ).toMatchObject({ kind: 'policy' });
    expect(
      api.resolveVisibleAutomaticModeRecovery({
        hasActiveTask: true,
        hasApprovedPlan: true,
        hasPolicy: true,
        runtimeRecovery: null,
      }),
    ).toBeNull();
    expect(
      api.resolveVisibleAutomaticModeRecovery({
        hasActiveTask: false,
        hasApprovedPlan: false,
        hasPolicy: false,
        runtimeRecovery: null,
      }),
    ).toBeNull();

    const source = readFileSync(
      new URL('../src/renderer/index.tsx', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('<ModeSwitch');
    expect(source).toContain('inferConversationCollaborationIntent(text)');
    expect(source).toContain('collaborationIntent.shouldUpgrade');
    expect(source).toContain('prepareConversationCollaboration({');
    expect(source).toContain("runtime.setParticipationMode({");
    expect(source).toContain("mode: 'collaboration'");
    expect(source).toContain('runtime.createPlan({');
    expect(source).toContain('<PlanRevisionPanel');
    expect(source).toContain('approveCurrentPlan(input)');
  });

  it('commits only the latest scoped M2 load when Task responses resolve out of order', async () => {
    type RequestGate = {
      begin(scopeKey: string): unknown;
      invalidate(): void;
      isCurrent(token: unknown): boolean;
    };
    const createGate = (
      m2Workspace as unknown as { createM2LoadRequestGate?: () => RequestGate }
    ).createM2LoadRequestGate;
    expect(typeof createGate).toBe('function');
    if (!createGate) return;

    for (const surface of ['graph', 'artifact', 'open-task']) {
      const gate = createGate();
      const commits: string[] = [];
      let resolveA!: (value: string) => void;
      let resolveB!: (value: string) => void;
      const responseA = new Promise<string>((resolve) => {
        resolveA = resolve;
      });
      const responseB = new Promise<string>((resolve) => {
        resolveB = resolve;
      });
      const load = async (scopeKey: string, response: Promise<string>) => {
        const token = gate.begin(`${surface}/${scopeKey}`);
        const value = await response;
        if (gate.isCurrent(token)) commits.push(value);
      };

      const pendingA = load('workspace-1/task-a', responseA);
      const pendingB = load('workspace-1/task-b', responseB);
      resolveB('task-b');
      await pendingB;
      resolveA('task-a');
      await pendingA;
      expect(commits, surface).toEqual(['task-b']);

      const invalidated = gate.begin(`${surface}/workspace-1/task-b`);
      gate.invalidate();
      expect(gate.isCurrent(invalidated), surface).toBe(false);
    }

    const source = readFileSync(
      new URL('../src/renderer/index.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('approvalLoadGateRef.current.begin');
    expect(source).toContain('policyLoadGateRef.current.begin');
    expect(source).toContain('planLoadGateRef.current.begin');
    expect(source).toContain('graphLoadGateRef.current.begin');
    expect(source).toContain('artifactLoadGateRef.current.begin');
    expect(source).toContain('openTaskLoadGateRef.current.begin');
    expect(source).toContain('approvalLoadGateRef.current.invalidate()');
    expect(source).toContain('policyLoadGateRef.current.invalidate()');
    expect(source).toContain('planLoadGateRef.current.invalidate()');
    expect(source).toContain('graphLoadGateRef.current.invalidate()');
    expect(source).toContain('artifactLoadGateRef.current.invalidate()');
    expect(source).toContain('openTaskLoadGateRef.current.invalidate()');
    expect(source).toContain('graphLoadGateRef.current.isCurrent');
    expect(source).toContain('artifactLoadGateRef.current.isCurrent');
    expect(source).toContain('openTaskLoadGateRef.current.isCurrent');
    expect(source).toContain('eventRefreshHandlersRef.current.loadApprovals()');
  });

  it('applies a returned task version only to the Task that initiated the request', () => {
    const merge = (
      m2Workspace as unknown as {
        mergeTaskVersionForTarget?: <T extends { taskId: string; taskVersion: number }>(
          current: T | null,
          targetTaskId: string,
          taskVersion: number,
        ) => T | null;
      }
    ).mergeTaskVersionForTarget;
    expect(typeof merge).toBe('function');
    if (!merge) return;

    const taskB = { taskId: 'task-b', taskVersion: 3, title: 'B' };
    expect(merge(taskB, 'task-a', 99)).toBe(taskB);
    expect(merge(taskB, 'task-b', 5)).toEqual({ ...taskB, taskVersion: 5 });
    expect(merge(taskB, 'task-b', 2)).toEqual(taskB);

    const source = readFileSync(
      new URL('../src/renderer/index.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('activeTaskIdRef.current !== targetTaskId');
    expect(source).toMatch(/syncTaskVersion\([^,]+,\s*result\.taskVersion\)/);
  });

  it('finds only the nearest common Artifact ancestor and errors when none exists', () => {
    const find = (
      m2Workspace as unknown as Record<string, (...args: never[]) => unknown>
    ).findNearestCommonArtifactAncestor;
    expect(typeof find).toBe('function');
    if (typeof find !== 'function') return;

    const versions = [
      { id: 'root', parentVersionIds: [] },
      { id: 'left-parent', parentVersionIds: ['root'] },
      { id: 'right-parent', parentVersionIds: ['root'] },
      { id: 'unrelated-third', parentVersionIds: [] },
      { id: 'left', parentVersionIds: ['left-parent'] },
      { id: 'right', parentVersionIds: ['right-parent'] },
    ];
    expect(find(versions, 'left', 'right')).toBe('root');
    expect(() => find(versions, 'left', 'unrelated-third')).toThrow(/common ancestor/i);

    const withNearer = [
      ...versions,
      { id: 'shared-near', parentVersionIds: ['root'] },
      { id: 'left-near', parentVersionIds: ['shared-near'] },
      { id: 'right-near', parentVersionIds: ['shared-near'] },
    ];
    expect(find(withNearer, 'left-near', 'right-near')).toBe('shared-near');
  });
});
