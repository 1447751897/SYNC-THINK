import { describe, expect, it } from 'vitest';
import type { AgentVersionId, ModelId, PlanStepDraft, StepId } from '@sync-think/shared';
import { diffPlanSteps, validatePlanSteps } from './plan-revision.js';

function step(
  id: string,
  overrides: Partial<PlanStepDraft> = {},
): PlanStepDraft {
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
  it('diffs frozen image generation settings and deep-clones the snapshots', () => {
    const previous = [step('image')];
    const next = [
      step('image', { imageGeneration: { size: '1536x1024', quality: 'high', count: 3 } }),
    ];

    const diff = diffPlanSteps(previous, next);

    expect(diff.changed[0]?.changedFields).toEqual(['imageGeneration']);
    expect(diff.changed[0]?.after.imageGeneration).toEqual({
      size: '1536x1024',
      quality: 'high',
      count: 3,
    });
    next[0]!.imageGeneration!.count = 1;
    expect(diff.changed[0]?.after.imageGeneration?.count).toBe(3);
  });

  it.each([
    {
      reason: 'invalid-image-generation-config',
      candidate: { size: '2048x2048', quality: 'high', count: 1 },
    },
    {
      reason: 'invalid-image-generation-config',
      candidate: { size: 'auto', quality: 'ultra', count: 1 },
    },
    {
      reason: 'invalid-image-generation-config',
      candidate: { size: 'auto', quality: 'high', count: 5 },
    },
  ])('rejects malformed image generation settings: $candidate', ({ reason, candidate }) => {
    expect(
      validatePlanSteps([step('image', { imageGeneration: candidate as never })]),
    ).toMatchObject({ ok: false, reason });
  });

  it('rejects image generation settings on merge steps', () => {
    expect(
      validatePlanSteps([
        step('merge', {
          kind: 'merge',
          imageGeneration: { size: 'auto', quality: 'auto', count: 1 },
        }),
      ]),
    ).toMatchObject({ ok: false, reason: 'merge-image-generation-config' });
  });

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
