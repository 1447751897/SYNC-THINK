import { describe, expect, it } from 'vitest';
import type { AgentVersionId, ModelId, StepId } from '@sync-think/shared';
import { diffPlanSteps, validatePlanSteps } from './plan-revision.js';

interface TestPlanStep {
  id: StepId;
  title: string;
  instructions: string;
  agentVersionId: AgentVersionId;
  modelOverrideId?: ModelId;
  dependsOn: StepId[];
}

function step(
  id: string,
  overrides: Partial<TestPlanStep> = {},
): TestPlanStep {
  return {
    id: id as StepId,
    title: `Step ${id}`,
    instructions: `Complete ${id}`,
    agentVersionId: `agent-version-${id}` as AgentVersionId,
    dependsOn: [],
    ...overrides,
  };
}

describe('immutable plan revision helpers', () => {
  it('diffs added, removed, and changed steps by stable Step id', () => {
    const previous = [step('research'), step('draft', { dependsOn: ['research' as StepId] }), step('remove')];
    const next = [
      step('draft', {
        instructions: 'Write the final draft',
        modelOverrideId: 'model-editor' as ModelId,
        dependsOn: ['research' as StepId],
      }),
      step('research'),
      step('publish', { dependsOn: ['draft' as StepId] }),
    ];

    const diff = diffPlanSteps(previous, next);

    expect(diff.added.map((entry) => entry.id)).toEqual(['publish']);
    expect(diff.removed.map((entry) => entry.id)).toEqual(['remove']);
    expect(diff.changed.map((entry) => entry.id)).toEqual(['draft', 'research']);
    expect(diff.changed[0]).toMatchObject({
      id: 'draft',
      changedFields: ['instructions', 'modelOverrideId', 'planOrder'],
      beforePlanOrder: 1,
      afterPlanOrder: 0,
    });
    expect(diff.changed[1]).toMatchObject({
      id: 'research',
      changedFields: ['planOrder'],
      beforePlanOrder: 0,
      afterPlanOrder: 1,
    });
  });

  it('accepts a valid DAG while preserving caller-owned stable ids', () => {
    const steps = [
      step('research'),
      step('draft', { dependsOn: ['research' as StepId] }),
      step('review', { dependsOn: ['draft' as StepId] }),
    ];

    expect(validatePlanSteps(steps)).toEqual({ ok: true });
    expect(steps.map((entry) => entry.id)).toEqual(['research', 'draft', 'review']);
  });

  it.each([
    {
      label: 'duplicate Step ids',
      steps: [step('same'), step('same')],
      reason: 'duplicate-step-id',
    },
    {
      label: 'missing dependencies',
      steps: [step('draft', { dependsOn: ['missing' as StepId] })],
      reason: 'missing-dependency',
    },
    {
      label: 'self dependencies',
      steps: [step('draft', { dependsOn: ['draft' as StepId] })],
      reason: 'self-dependency',
    },
    {
      label: 'cycles',
      steps: [
        step('a', { dependsOn: ['b' as StepId] }),
        step('b', { dependsOn: ['a' as StepId] }),
      ],
      reason: 'cycle',
    },
  ])('rejects $label', ({ steps, reason }) => {
    expect(validatePlanSteps(steps)).toMatchObject({ ok: false, reason });
  });
});
