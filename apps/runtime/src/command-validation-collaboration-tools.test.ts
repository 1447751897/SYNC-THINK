import { describe, expect, it } from 'vitest';

import {
  parseDelegateSubtaskPayload,
  parseRecordHandoffPayload,
} from './command-validation.js';

describe('collaboration application command validation', () => {
  it('normalizes one bounded isolated subtask packet', () => {
    expect(
      parseDelegateSubtaskPayload({
        workspaceId: ' workspace-1 ',
        parentTaskId: ' task-parent ',
        delegateAgentVersionId: ' agent-worker ',
        title: ' Focused implementation ',
        goal: ' Implement only the parser ',
        requiredEvidence: [' focused tests '],
        acceptanceConditions: [' all focused tests pass '],
        allowedTools: ['read_file'],
        dependsOnTaskIds: [' child-a '],
        delegatingAgentVersionId: ' lead-agent ',
        delegationBatchId: ' parent-run ',
      }),
    ).toEqual({
      workspaceId: 'workspace-1',
      parentTaskId: 'task-parent',
      delegateAgentVersionId: 'agent-worker',
      title: 'Focused implementation',
      goal: 'Implement only the parser',
      requiredEvidence: ['focused tests'],
      acceptanceConditions: ['all focused tests pass'],
      allowedTools: ['read_file'],
      dependsOnTaskIds: ['child-a'],
      delegatingAgentVersionId: 'lead-agent',
      delegationBatchId: 'parent-run',
    });
  });

  it('rejects unknown fields and oversized packet collections', () => {
    expect(
      parseDelegateSubtaskPayload({
        workspaceId: 'workspace-1',
        parentTaskId: 'task-parent',
        delegateAgentVersionId: 'agent-worker',
        title: 'Task',
        goal: 'Goal',
        hiddenContext: 'must not pass',
      }),
    ).toBeUndefined();
    expect(
      parseDelegateSubtaskPayload({
        workspaceId: 'workspace-1',
        parentTaskId: 'task-parent',
        delegateAgentVersionId: 'agent-worker',
        title: 'Task',
        goal: 'Goal',
        allowedTools: Array.from({ length: 65 }, (_, index) => `tool-${index}`),
      }),
    ).toBeUndefined();
  });

  it('requires a directional handoff between two exact Agents', () => {
    expect(
      parseRecordHandoffPayload({
        taskId: ' task-1 ',
        fromAgentVersionId: ' agent-worker ',
        toAgentVersionId: ' agent-lead ',
        summary: ' Implementation complete ',
        evidenceRefs: [' artifact-version-1 '],
        status: 'completed',
      }),
    ).toEqual({
      taskId: 'task-1',
      fromAgentVersionId: 'agent-worker',
      toAgentVersionId: 'agent-lead',
      summary: 'Implementation complete',
      evidenceRefs: ['artifact-version-1'],
      status: 'completed',
    });
    expect(
      parseRecordHandoffPayload({
        taskId: 'task-1',
        fromAgentVersionId: 'agent-same',
        toAgentVersionId: 'agent-same',
        summary: 'invalid self handoff',
      }),
    ).toBeUndefined();
  });
});
