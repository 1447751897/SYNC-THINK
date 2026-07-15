import { describe, expect, it } from 'vitest';
import {
  assertRendererSafeOrchestrationPayload,
  parseAgentCreatePayload,
  parseAgentCreateVersionPayload,
  parseAgentListPayload,
  parseAgentVersionsPayload,
  parseArtifactComparePayload,
  parseArtifactConflictListPayload,
  parseArtifactConflictResolutionPayload,
  parseArtifactListPayload,
  parseArtifactMergePayload,
  parseArtifactSelectPayload,
  parseModeSetPayload,
  parsePlanApprovePayload,
  parsePlanCreatePayload,
  parsePlanListPayload,
  parsePlanRevisePayload,
  parsePolicyListPayload,
  parsePolicySavePayload,
  parseRunGraphPayload,
  parseRunMutationPayload,
} from '../src/orchestration-payloads.js';

const ids = {
  workspaceId: '01J00000000000000000000001',
  taskId: '01J00000000000000000000002',
  runId: '01J00000000000000000000003',
  planId: '01J00000000000000000000004',
  stepId: '01J00000000000000000000005',
  agentVersionId: '01J00000000000000000000006',
  artifactId: '01J00000000000000000000007',
  baseVersionId: '01J00000000000000000000008',
  leftVersionId: '01J00000000000000000000009',
  rightVersionId: '01J0000000000000000000000A',
  operationId: '01J0000000000000000000000B',
  conflictId: '01J0000000000000000000000C',
};

const step = {
  id: ids.stepId,
  kind: 'execution' as const,
  title: 'Design',
  instructions: 'Create an isolated candidate.',
  agentVersionId: ids.agentVersionId,
  dependsOn: [],
};

describe('orchestration payload validation', () => {
  it('accepts exact typed mode and plan commands', () => {
    expect(
      parseModeSetPayload({
        taskId: ids.taskId,
        mode: 'collaboration',
        expectedTaskVersion: 4,
      }),
    ).toEqual({ taskId: ids.taskId, mode: 'collaboration', expectedTaskVersion: 4 });

    expect(
      parsePlanCreatePayload({
        taskId: ids.taskId,
        expectedTaskVersion: 4,
        title: 'M2',
        steps: [step],
      }),
    ).toMatchObject({ title: 'M2', steps: [step] });
    expect(
      parsePlanRevisePayload({
        planId: ids.planId,
        expectedRevision: 2,
        title: 'M2 revised',
        steps: [step],
      }),
    ).toMatchObject({ expectedRevision: 2 });
    expect(parsePlanListPayload({ planId: ids.planId })).toEqual({ planId: ids.planId });
    expect(parsePlanApprovePayload({ planId: ids.planId, revision: 2 })).toEqual({
      planId: ids.planId,
      revision: 2,
    });
  });

  it('accepts graph, run and scoped policy commands', () => {
    const scope = {
      workspaceId: ids.workspaceId,
      taskId: ids.taskId,
      runId: ids.runId,
    };
    expect(parseRunGraphPayload(scope)).toEqual(scope);
    expect(parseRunMutationPayload({ ...scope, expectedTaskVersion: 7 })).toEqual({
      ...scope,
      expectedTaskVersion: 7,
    });
    expect(
      parsePolicySavePayload({
        workspaceId: ids.workspaceId,
        scopeType: 'task',
        scopeId: ids.taskId,
        approvalMode: 'request',
        rules: [{ action: 'shell.exec', approvalMode: 'request' }],
      }),
    ).toMatchObject({ scopeType: 'task', approvalMode: 'request' });
    expect(parsePolicyListPayload({ workspaceId: ids.workspaceId, taskId: ids.taskId })).toEqual({
      workspaceId: ids.workspaceId,
      taskId: ids.taskId,
    });
  });

  it('accepts exact artifact, merge-conflict list, and resolution commands', () => {
    const scope = {
      workspaceId: ids.workspaceId,
      taskId: ids.taskId,
      runId: ids.runId,
    };
    expect(parseArtifactListPayload({ ...scope, limit: 8 })).toMatchObject({ limit: 8 });
    expect(
      parseArtifactComparePayload({
        ...scope,
        leftVersionId: ids.leftVersionId,
        rightVersionId: ids.rightVersionId,
      }),
    ).toMatchObject({ leftVersionId: ids.leftVersionId, rightVersionId: ids.rightVersionId });
    expect(
      parseArtifactSelectPayload({
        ...scope,
        artifactId: ids.artifactId,
        artifactVersionId: ids.leftVersionId,
        operationId: ids.operationId,
        expectedTaskVersion: 7,
      }),
    ).toMatchObject({ artifactId: ids.artifactId, expectedTaskVersion: 7 });
    expect(
      parseArtifactMergePayload({
        ...scope,
        artifactId: ids.artifactId,
        baseVersionId: ids.baseVersionId,
        leftVersionId: ids.leftVersionId,
        rightVersionId: ids.rightVersionId,
        sourceStepId: 'step-2',
        operationId: ids.operationId,
        expectedTaskVersion: 7,
      }),
    ).toMatchObject({ artifactId: ids.artifactId, sourceStepId: 'step-2' });
    expect(parseArtifactConflictListPayload(scope)).toEqual(scope);
    expect(
      parseArtifactConflictResolutionPayload({
        ...scope,
        conflictId: ids.conflictId,
        strategy: 'manual',
        content: 'resolved content',
        operationId: ids.operationId,
        expectedTaskVersion: 7,
      }),
    ).toMatchObject({ conflictId: ids.conflictId, strategy: 'manual' });
    expect(
      parseArtifactConflictResolutionPayload({
        ...scope,
        conflictId: ids.conflictId,
        strategy: 'left',
        operationId: ids.operationId,
        expectedTaskVersion: 7,
      }),
    ).toMatchObject({ strategy: 'left' });
  });

  it('rejects renderer authority claims, unknown keys and secret-like fields', () => {
    expect(() =>
      parseModeSetPayload({
        taskId: ids.taskId,
        mode: 'automatic',
        expectedTaskVersion: 4,
        approvedPlan: true,
      }),
    ).toThrow(/Invalid mode-set payload/);

    expect(() =>
      parsePlanCreatePayload({
        taskId: ids.taskId,
        expectedTaskVersion: 4,
        title: 'M2',
        steps: [step],
        apiKey: 'plaintext',
      }),
    ).toThrow(/secret-like|Invalid plan-create payload/);

    expect(() =>
      assertRendererSafeOrchestrationPayload({
        nested: { accessToken: 'plaintext' },
      }),
    ).toThrow(/secret-like/);

    const scope = {
      workspaceId: ids.workspaceId,
      taskId: ids.taskId,
      runId: ids.runId,
    };
    expect(() =>
      parseArtifactConflictResolutionPayload({
        ...scope,
        conflictId: ids.conflictId,
        strategy: 'left',
        content: 'must not accompany left',
        operationId: ids.operationId,
        expectedTaskVersion: 7,
      }),
    ).toThrow(/Invalid artifact-conflict-resolution payload/);
  });

  it('validates complete Agent list/create/version payloads without secret values', () => {
    const definition = {
      agentId: 'agent-planner',
      name: 'Planner',
      role: 'planner',
      developerInstructions: 'Plan against acceptance criteria.',
      inputContract: 'task goal',
      outputContract: 'reviewed plan',
      defaultModelId: 'model-planner',
      fallbackModelIds: ['model-fallback'],
      pauseOnFailure: true,
      memoryScope: 'project',
      skillVersionIds: [],
      mcpServerIds: [],
      description: 'Builds and reviews approved work.',
      visualIdentity: { icon: 'workflow', color: '#227755' },
      mcpToolAllowlist: ['read_file'],
      permissions: {
        file: ['workspace:read'],
        command: ['pnpm test'],
        browser: ['localhost'],
        desktop: [],
        network: ['api.example.test'],
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
      approvalMode: 'request',
    };

    expect(parseAgentListPayload({})).toEqual({});
    expect(parseAgentCreatePayload(definition)).toMatchObject({
      agentId: 'agent-planner',
      developerInstructions: definition.developerInstructions,
    });
    expect(parseAgentVersionsPayload({ agentId: 'agent-planner' })).toEqual({
      agentId: 'agent-planner',
    });
    expect(parseAgentCreateVersionPayload({ ...definition, expectedVersion: 2 })).toMatchObject({
      agentId: 'agent-planner',
      expectedVersion: 2,
    });

    expect(() => parseAgentCreatePayload({ ...definition, accessToken: 'plaintext' })).toThrow(
      /secret-like|Invalid agent-create payload/,
    );

    expect(() =>
      parseAgentCreatePayload({
        ...definition,
        visualIdentity: { ...definition.visualIdentity, unknown: true },
      }),
    ).toThrow(/Invalid agent-create payload/);
    expect(() =>
      parseAgentCreatePayload({
        ...definition,
        permissions: { ...definition.permissions, password: 'plaintext' },
      }),
    ).toThrow(/secret-like|Invalid agent-create payload/);
    expect(() =>
      parseAgentCreatePayload({
        ...definition,
        mcpToolAllowlist: ['x'.repeat(257)],
      }),
    ).toThrow(/Invalid agent-create payload/);
  });
});
