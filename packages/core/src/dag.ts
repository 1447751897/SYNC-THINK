export interface DagStep {
  id: string;
  dependsOn: readonly string[];
  planOrder: number;
}

export type DagValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'duplicate-id' | 'missing-dependency' | 'self-edge' | 'cycle';
      stepId: string;
      dependencyId?: string;
    };

export type DagStepState =
  | 'pending'
  | 'ready'
  | 'running'
  | 'awaitingApproval'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export function validateDag(steps: readonly DagStep[]): DagValidationResult {
  const byId = new Map<string, DagStep>();
  for (const step of steps) {
    if (byId.has(step.id)) return { ok: false, reason: 'duplicate-id', stepId: step.id };
    byId.set(step.id, step);
  }

  for (const step of steps) {
    for (const dependencyId of step.dependsOn) {
      if (dependencyId === step.id) {
        return { ok: false, reason: 'self-edge', stepId: step.id, dependencyId };
      }
      if (!byId.has(dependencyId)) {
        return { ok: false, reason: 'missing-dependency', stepId: step.id, dependencyId };
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (step: DagStep): DagValidationResult => {
    if (visiting.has(step.id)) return { ok: false, reason: 'cycle', stepId: step.id };
    if (visited.has(step.id)) return { ok: true };

    visiting.add(step.id);
    for (const dependencyId of step.dependsOn) {
      const result = visit(byId.get(dependencyId)!);
      if (!result.ok) return result;
    }
    visiting.delete(step.id);
    visited.add(step.id);
    return { ok: true };
  };

  for (const step of steps) {
    const result = visit(step);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export function getReadyStepIds(
  steps: readonly DagStep[],
  states: Readonly<Record<string, DagStepState | undefined>>,
): string[] {
  return steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => {
      const state = states[step.id];
      return (
        (state === 'pending' || state === 'ready') &&
        step.dependsOn.every((dependencyId) => states[dependencyId] === 'completed')
      );
    })
    .sort((left, right) => left.step.planOrder - right.step.planOrder || left.index - right.index)
    .map(({ step }) => step.id);
}
