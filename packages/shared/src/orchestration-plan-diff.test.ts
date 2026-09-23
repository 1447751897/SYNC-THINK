import { describe, expect, it } from 'vitest';
import type { AgentVersionId, PlanStepDraft, StepId } from './index.js';
import { diffPlanSteps } from './orchestration-plan-diff.js';

const agentId = 'agent-version-1' as AgentVersionId;

function step(id: string, overrides: Partial<PlanStepDraft> = {}): PlanStepDraft {
  return {
    id: id as StepId,
    title: `Step ${id}`,
    instructions: `Do ${id}`,
    agentVersionId: agentId,
    dependsOn: [],
    ...overrides,
  };
}

describe('diffPlanSteps', () => {
  it('reports added and removed steps as detached snapshots', () => {
    const removed = step('removed', { dependsOn: ['base' as StepId] });
    const added = step('added', {
      imageGeneration: { size: '1024x1024', quality: 'high', count: 1 },
    });
    const diff = diffPlanSteps([removed], [added]);
    expect(diff).toEqual({ added: [added], removed: [removed], changed: [] });

    removed.dependsOn.push('later' as StepId);
    added.imageGeneration!.quality = 'low';
    expect(diff.removed[0]?.dependsOn).toEqual(['base']);
    expect(diff.added[0]?.imageGeneration?.quality).toBe('high');
  });

  it('treats dependency ordering as equivalent while reporting plan order changes', () => {
    const base = step('base');
    const target = step('target', { dependsOn: ['a', 'b'] as StepId[] });
    const diff = diffPlanSteps(
      [base, target],
      [step('target', { dependsOn: ['b', 'a'] as StepId[] }), base],
    );
    expect(diff.changed).toEqual([
      expect.objectContaining({ id: 'target', changedFields: ['planOrder'] }),
      expect.objectContaining({ id: 'base', changedFields: ['planOrder'] }),
    ]);
  });

  it('reports every changed execution field in stable contract order', () => {
    const before = step('work', {
      title: 'Before',
      imageGeneration: { size: 'auto', quality: 'low', count: 1 },
    });
    const after = step('work', {
      kind: 'merge',
      title: 'After',
      instructions: 'Changed',
      modelOverrideId: 'model-2' as PlanStepDraft['modelOverrideId'],
      imageGeneration: { size: '1536x1024', quality: 'high', count: 2 },
      dependsOn: ['producer-a', 'producer-b'] as StepId[],
    });
    expect(diffPlanSteps([before], [after]).changed[0]?.changedFields).toEqual([
      'kind',
      'title',
      'instructions',
      'modelOverrideId',
      'imageGeneration',
      'dependsOn',
    ]);
  });
});
