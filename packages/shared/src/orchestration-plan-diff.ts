import type {
  PlanDiff,
  PlanStepChange,
  PlanStepChangedField,
  PlanStepDraft,
} from './types/plan.js';
import type { StepId } from './types/ids.js';

function cloneStep(step: PlanStepDraft): PlanStepDraft {
  return {
    ...step,
    ...(step.imageGeneration ? { imageGeneration: { ...step.imageGeneration } } : {}),
    dependsOn: [...step.dependsOn],
  };
}

function sameDependencies(left: readonly StepId[], right: readonly StepId[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}

export function changedPlanStepFields(
  before: PlanStepDraft,
  after: PlanStepDraft,
  beforePlanOrder: number,
  afterPlanOrder: number,
): PlanStepChangedField[] {
  const fields: PlanStepChangedField[] = [];
  if ((before.kind ?? 'execution') !== (after.kind ?? 'execution')) fields.push('kind');
  if (before.title !== after.title) fields.push('title');
  if (before.instructions !== after.instructions) fields.push('instructions');
  if (before.agentVersionId !== after.agentVersionId) fields.push('agentVersionId');
  if (before.modelOverrideId !== after.modelOverrideId) fields.push('modelOverrideId');
  if (
    JSON.stringify(before.imageGeneration ?? null) !== JSON.stringify(after.imageGeneration ?? null)
  ) {
    fields.push('imageGeneration');
  }
  if (!sameDependencies(before.dependsOn, after.dependsOn)) fields.push('dependsOn');
  if (beforePlanOrder !== afterPlanOrder) fields.push('planOrder');
  return fields;
}

/** Compare immutable plan revisions without persistence or transaction concerns. */
export function diffPlanSteps(
  previous: readonly PlanStepDraft[],
  next: readonly PlanStepDraft[],
): PlanDiff {
  const previousById = new Map(previous.map((step, index) => [step.id, { step, index }]));
  const nextById = new Map(next.map((step, index) => [step.id, { step, index }]));
  const added = next.filter((step) => !previousById.has(step.id)).map(cloneStep);
  const removed = previous.filter((step) => !nextById.has(step.id)).map(cloneStep);
  const changed: PlanStepChange[] = [];

  for (const [afterPlanOrder, after] of next.entries()) {
    const prior = previousById.get(after.id);
    if (!prior) continue;
    const fields = changedPlanStepFields(prior.step, after, prior.index, afterPlanOrder);
    if (fields.length === 0) continue;
    changed.push({
      id: after.id,
      before: cloneStep(prior.step),
      after: cloneStep(after),
      changedFields: fields,
      beforePlanOrder: prior.index,
      afterPlanOrder,
    });
  }
  return { added, removed, changed };
}
