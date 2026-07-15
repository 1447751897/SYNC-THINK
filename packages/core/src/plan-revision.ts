import type {
  PlanDiff,
  PlanStepChange,
  PlanStepChangedField,
  PlanStepDraft,
  StepId,
} from '@sync-think/shared';

export type PlanValidationFailureReason =
  | 'invalid-step-id'
  | 'missing-agent-version'
  | 'duplicate-step-id'
  | 'duplicate-dependency'
  | 'missing-dependency'
  | 'self-dependency'
  | 'cycle';

export type PlanValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: PlanValidationFailureReason;
      stepId?: StepId;
      dependencyId?: StepId;
    };

function cloneStep(step: PlanStepDraft): PlanStepDraft {
  return { ...step, dependsOn: [...step.dependsOn] };
}

function sameDependencies(left: readonly StepId[], right: readonly StepId[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}

function changedFields(
  before: PlanStepDraft,
  after: PlanStepDraft,
  beforePlanOrder: number,
  afterPlanOrder: number,
): PlanStepChangedField[] {
  const fields: PlanStepChangedField[] = [];
  if (before.title !== after.title) fields.push('title');
  if (before.instructions !== after.instructions) fields.push('instructions');
  if (before.agentVersionId !== after.agentVersionId) fields.push('agentVersionId');
  if (before.modelOverrideId !== after.modelOverrideId) fields.push('modelOverrideId');
  if (!sameDependencies(before.dependsOn, after.dependsOn)) fields.push('dependsOn');
  if (beforePlanOrder !== afterPlanOrder) fields.push('planOrder');
  return fields;
}

export function diffPlanSteps(
  previous: readonly PlanStepDraft[],
  next: readonly PlanStepDraft[],
): PlanDiff {
  const previousById = new Map(previous.map((step, index) => [step.id, { step, index }]));
  const nextById = new Map(next.map((step, index) => [step.id, { step, index }]));

  const added = next
    .filter((step) => !previousById.has(step.id))
    .map(cloneStep);
  const removed = previous
    .filter((step) => !nextById.has(step.id))
    .map(cloneStep);
  const changed: PlanStepChange[] = [];

  for (const [afterPlanOrder, after] of next.entries()) {
    const prior = previousById.get(after.id);
    if (!prior) continue;
    const fields = changedFields(prior.step, after, prior.index, afterPlanOrder);
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

export function validatePlanSteps(steps: readonly PlanStepDraft[]): PlanValidationResult {
  const ids = new Set<StepId>();
  for (const step of steps) {
    if (!String(step.id).trim()) return { ok: false, reason: 'invalid-step-id' };
    if (!String(step.agentVersionId).trim()) {
      return { ok: false, reason: 'missing-agent-version', stepId: step.id };
    }
    if (ids.has(step.id)) {
      return { ok: false, reason: 'duplicate-step-id', stepId: step.id };
    }
    ids.add(step.id);
  }

  for (const step of steps) {
    const dependencies = new Set<StepId>();
    for (const dependencyId of step.dependsOn) {
      if (dependencyId === step.id) {
        return { ok: false, reason: 'self-dependency', stepId: step.id, dependencyId };
      }
      if (dependencies.has(dependencyId)) {
        return { ok: false, reason: 'duplicate-dependency', stepId: step.id, dependencyId };
      }
      dependencies.add(dependencyId);
      if (!ids.has(dependencyId)) {
        return { ok: false, reason: 'missing-dependency', stepId: step.id, dependencyId };
      }
    }
  }

  const dependenciesById = new Map(steps.map((step) => [step.id, step.dependsOn]));
  const visiting = new Set<StepId>();
  const visited = new Set<StepId>();

  function visit(stepId: StepId): boolean {
    if (visiting.has(stepId)) return false;
    if (visited.has(stepId)) return true;
    visiting.add(stepId);
    for (const dependencyId of dependenciesById.get(stepId) ?? []) {
      if (!visit(dependencyId)) return false;
    }
    visiting.delete(stepId);
    visited.add(stepId);
    return true;
  }

  for (const step of steps) {
    if (!visit(step.id)) return { ok: false, reason: 'cycle', stepId: step.id };
  }
  return { ok: true };
}
