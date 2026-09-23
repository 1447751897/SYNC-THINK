import type { StepId } from './types/ids.js';
import type { PlanStepDraft } from './types/plan.js';

export type PlanStepGraphIssueCode =
  | 'duplicate_step_id'
  | 'merge_dependencies_required'
  | 'self_dependency'
  | 'duplicate_dependency'
  | 'missing_dependency'
  | 'cycle';

export interface PlanStepGraphIssue {
  code: PlanStepGraphIssueCode;
  path: string;
  stepId: StepId;
  dependencyId?: StepId;
}

/** Return the first deterministic graph issue without persistence-specific error handling. */
export function findPlanStepGraphIssue(
  steps: readonly PlanStepDraft[],
): PlanStepGraphIssue | undefined {
  const ids = new Set<StepId>();
  const indexById = new Map<StepId, number>();
  for (const [index, step] of steps.entries()) {
    if (ids.has(step.id)) {
      return { code: 'duplicate_step_id', path: `steps[${index}].id`, stepId: step.id };
    }
    ids.add(step.id);
    indexById.set(step.id, index);
  }

  for (const [stepIndex, step] of steps.entries()) {
    if (step.kind === 'merge' && step.dependsOn.length < 2) {
      return {
        code: 'merge_dependencies_required',
        path: `steps[${stepIndex}].dependsOn`,
        stepId: step.id,
      };
    }
    const dependencies = new Set<StepId>();
    for (const [dependencyIndex, dependencyId] of step.dependsOn.entries()) {
      const path = `steps[${stepIndex}].dependsOn[${dependencyIndex}]`;
      if (dependencyId === step.id) {
        return { code: 'self_dependency', path, stepId: step.id, dependencyId };
      }
      if (dependencies.has(dependencyId)) {
        return { code: 'duplicate_dependency', path, stepId: step.id, dependencyId };
      }
      if (!ids.has(dependencyId)) {
        return { code: 'missing_dependency', path, stepId: step.id, dependencyId };
      }
      dependencies.add(dependencyId);
    }
  }

  const dependenciesById = new Map(steps.map((step) => [step.id, step.dependsOn]));
  const visiting = new Set<StepId>();
  const visited = new Set<StepId>();
  const visit = (stepId: StepId): PlanStepGraphIssue | undefined => {
    if (visiting.has(stepId)) {
      return {
        code: 'cycle',
        path: `steps[${indexById.get(stepId) ?? 0}].dependsOn`,
        stepId,
      };
    }
    if (visited.has(stepId)) return undefined;
    visiting.add(stepId);
    for (const dependencyId of dependenciesById.get(stepId) ?? []) {
      const issue = visit(dependencyId);
      if (issue) return issue;
    }
    visiting.delete(stepId);
    visited.add(stepId);
    return undefined;
  };

  for (const step of steps) {
    const issue = visit(step.id);
    if (issue) return issue;
  }
  return undefined;
}
